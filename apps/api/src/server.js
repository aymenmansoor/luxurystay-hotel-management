import { createServer } from 'node:http';
import { realtime } from './realtime.js';
import { startReminders } from './reminders.js';
import { startMail } from './mail.js';
import { createApp } from './app.js';
import { connect } from './db.js';

if (process.env.NODE_ENV === 'production') {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI explicitly in production.');
  if (Boolean(process.env.SMTP_URL) !== Boolean(process.env.MAIL_FROM)) {
    throw new Error('Configure both SMTP_URL and MAIL_FROM to enable outgoing mail.');
  }
  if (process.env.SMTP_URL && !['smtp:', 'smtps:'].includes(URL.parse(process.env.SMTP_URL)?.protocol)) {
    throw new Error('SMTP_URL must use smtp:// or smtps://.');
  }
  const origin = URL.parse(process.env.APP_ORIGIN ?? '');
  if (origin?.protocol !== 'https:' || origin.origin !== process.env.APP_ORIGIN) {
    throw new Error('Set APP_ORIGIN to the public HTTPS origin without a path or trailing slash.');
  }
}
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const app = createApp();
await connect();
const server = createServer(app);
realtime(server);
startMail();
startReminders();
server.listen(port, '0.0.0.0', () => console.log('LuxuryStay API listening on port', port));
