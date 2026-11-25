import { isIP } from 'node:net';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { z, ZodError } from 'zod';
import { authRoutes, authenticate, allowRoles } from './auth.js';
import { Branch, Room, roles } from './models.js';
import { catalog, inventory } from './catalog.js';
import { reservations } from './reservations.js';
import { accounts } from './accounts.js';
import { complaints } from './complaints.js';
import { finance } from './finance.js';
import { offers } from './offers.js';
import { media } from './media.js';
import { loyalty } from './loyalty.js';
import { desk, guestDocuments } from './desk.js';
import { guestServices, hotel, notifications } from './hotel-operations.js';
import { BookingError } from './reservation-service.js';

const staffRoles = roles.filter((role) => role !== 'guest');
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid branch ID');
const inventoryRoles = ['super-admin', 'branch-manager', 'receptionist', 'housekeeping', 'maintenance'];

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const proxies = process.env.TRUST_PROXY_CIDRS?.split(',').map((item) => item.trim()) ?? [];
  if (proxies.length) {
    for (const proxy of proxies) {
      const [address, prefix, extra] = proxy.split('/');
      const family = isIP(address);
      if (!family || extra !== undefined || (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
        throw new Error('TRUST_PROXY_CIDRS must contain explicit proxy IP addresses or CIDR ranges.');
      }
    }
    app.set('trust proxy', proxies);
  }
  app.use(helmet());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && (req.get('Sec-Fetch-Site') === 'cross-site' ||
      (req.get('Origin') && process.env.APP_ORIGIN && req.get('Origin') !== process.env.APP_ORIGIN))) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await mongoose.connection.db.command({ ping: 1 });
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRoutes());
  app.use('/api', catalog);
  app.use('/api', guestDocuments);
  app.use('/api', reservations);
  app.use('/api', guestServices);
  app.use('/api', notifications);
  app.use('/api', accounts);
  app.use('/api', loyalty);
  app.use('/api', media);
  app.use('/api', offers);
  app.use('/api', finance);
  app.use('/api', complaints);
  app.use('/api/staff', desk);
  app.use('/api/staff', hotel);
  app.use('/api/staff/inventory', inventory);
  app.get('/api/staff/branches', authenticate, allowRoles(...staffRoles), async (req, res) => {
    const filter = req.user.role === 'super-admin' ? {} : { _id: { $in: req.user.branches } };
    res.json({ branches: await Branch.find(filter).sort('name').lean() });
  });
  app.get('/api/staff/branches/:branchId/rooms', authenticate, allowRoles(...inventoryRoles), async (req, res) => {
    const branchId = id.parse(req.params.branchId);
    const filter = { _id: branchId };
    if (req.user.role !== 'super-admin') filter._id = { $eq: branchId, $in: req.user.branches };
    const branch = await Branch.findOne(filter).lean();
    if (!branch) return res.status(404).json({ error: 'Branch not found.' });
    const rooms = await Room.find({ branch: branch._id }).select('number floor status type').populate('type', 'name').sort('floor number').lean();
    res.json({ rooms });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (process.env.NODE_ENV === 'production') {
    const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
  }
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof BookingError) return res.status(error.status).json({ error: error.message });
    if (error instanceof ZodError) return res.status(400).json({ error: error.issues[0].message });
    if (error.code === 11000) return res.status(409).json({ error: error.keyPattern?.email ? 'An account with this email already exists.' : 'That identifier is already in use.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error(error.name);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  });
  return app;
}
