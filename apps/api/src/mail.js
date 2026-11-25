import nodemailer from 'nodemailer';
import { Audit, NotificationState } from './operations-models.js';

let transport;
let transportUrl;

export function mailReady() {
  return Boolean(process.env.SMTP_URL && process.env.MAIL_FROM && process.env.APP_ORIGIN);
}

export function sendMail(to, subject, text) {
  if (transportUrl !== process.env.SMTP_URL || !transport) {
    transport?.close();
    transportUrl = process.env.SMTP_URL;
    transport = nodemailer.createTransport(transportUrl);
  }
  return transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

let busy = false;

export async function drainMailQueue() {
  if (!mailReady() || busy) return;
  busy = true;
    try {
      for (let count = 0; count < 10; count++) {
        const now = new Date();
        const job = await Audit.findOneAndUpdate({
          email: { $exists: true, $not: /\.test$/i }, emailSent: { $exists: false }, emailSuppressedAt: { $exists: false }, mailAttempts: { $lt: 6 },
          $or: [{ mailLease: { $exists: false } }, { mailLease: { $lt: now } }]
        }, { $set: { mailLease: new Date(Date.now() + 10 * 60_000) }, $inc: { mailAttempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' });
        if (!job) break;
        try {
          const preference = job.guest && await NotificationState.findOne({ user: job.guest });
          const suppress = preference?.bookingEmail === false;
          if (!suppress) await sendMail(job.email, 'LuxuryStay reservation update', job.message);
          await Audit.updateOne({ _id: job.id, mailLease: job.mailLease },
            { $set: { [suppress ? 'emailSuppressedAt' : 'emailSent']: new Date() } });
        } catch {
          console.error('A reservation email delivery attempt failed.');
        }
      }
    } catch {
      console.error('The reservation mail queue could not be read.');
    } finally {
      busy = false;
    }
}

export function startMail() {
  if (mailReady()) setInterval(drainMailQueue, 15_000).unref();
}
