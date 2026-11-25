import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import { cookie, sessionUser } from './auth.js';
import { Audit } from './operations-models.js';

const parseCookies = cookieParser();

export function realtime(server) {
  const io = new Server(server, {
    transports: ['websocket'],
    allowRequest(req, done) {
      const origin = req.headers.origin;
      try {
        const valid = process.env.APP_ORIGIN ? origin === process.env.APP_ORIGIN :
          origin && [req.headers.host, 'localhost:5173', '127.0.0.1:5173'].includes(new URL(origin).host);
        done(null, Boolean(valid));
      } catch {
        done(null, false);
      }
    }
  });

  io.use(async (socket, next) => {
    try {
      parseCookies(socket.request, {}, () => {});
      if (!await sessionUser(socket.request.cookies[cookie])) return next(new Error('Sign in to continue.'));
      next();
    } catch {
      next(new Error('Session validation failed.'));
    }
  });

  let stream;
  let retry;
  let closed = false;
  let resumeToken;
  function refreshConnected() {
    void Promise.allSettled([...io.sockets.sockets.values()].map(async (socket) => {
      if (await sessionUser(socket.request.cookies[cookie])) socket.emit('hotel:update');
      else socket.disconnect();
    }));
  }
  function watch(recovered = false) {
    if (closed) return;
    const resumed = resumeToken;
    stream = Audit.watch([{ $match: { operationType: 'insert' } }], resumed ? { resumeAfter: resumed } : {});
    if (recovered) refreshConnected();
    stream.on('change', ({ _id, fullDocument: entry }) => {
      resumeToken = _id;
      void Promise.allSettled([...io.sockets.sockets.values()].map(async (socket) => {
        const user = await sessionUser(socket.request.cookies[cookie]);
        if (!user) return socket.disconnect();
        const personal = String(entry.guest) === user.id || String(entry.recipient) === user.id;
        const staff = user.role === 'super-admin' || (user.role !== 'guest' && user.branches.some((branch) => String(branch) === String(entry.branch)));
        if (personal || staff) socket.emit('hotel:update');
      }));
    });
    stream.on('error', () => {
      console.error('Hotel live update stream disconnected. Retrying.');
      void stream.close().catch(() => {});
      if (closed) return;
      // If a restart using a token fails, start a fresh cursor and refresh clients from MongoDB.
      if (resumed === resumeToken) resumeToken = undefined;
      retry = setTimeout(() => watch(true), 2500);
      retry.unref();
    });
  }
  server.once('close', () => {
    closed = true;
    clearTimeout(retry);
    void stream?.close();
  });
  watch();
  return io;
}
