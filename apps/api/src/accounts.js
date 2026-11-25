import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { Branch, Session, User, roles } from './models.js';
import { event } from './operations-models.js';
import { BookingError } from './reservation-service.js';
import { managers, objectId, scopedBranch } from './desk.js';
import { mailReady, sendMail } from './mail.js';

const { Schema, model } = mongoose;
const hash = (token) => createHash('sha256').update(token).digest('hex');

const tokenSchema = new Schema({
  user: { type: Schema.Types.ObjectId, required: true }, kind: String,
  digest: { type: String, unique: true, required: true },
  expiresAt: { type: Date, expires: 0, required: true }
});
tokenSchema.index({ user: 1, kind: 1 }, { unique: true });
export const AccountToken = model('AccountToken', tokenSchema);

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).refine((value) => Buffer.byteLength(value) <= 72, 'Use a password of at most 72 bytes.');
const kinds = ['reset', 'verify', 'invite'];
const staff = roles.filter((role) => !['guest', 'super-admin'].includes(role));
const limit = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many account requests. Try again later.' } });
const cleanName = z.string().trim().min(2).max(100);
const unavailable = () => new BookingError(503, 'Email delivery is not configured for this environment.');

async function sendToken(user, kind) {
  const token = randomBytes(32).toString('base64url');
  const minutes = kind === 'reset' ? 30 : 1440;
  await AccountToken.findOneAndUpdate({ user: user.id, kind },
    { $set: { digest: hash(token), expiresAt: new Date(Date.now() + minutes * 60_000) } }, { upsert: true });
  const origin = new URL(process.env.APP_ORIGIN);
  const title = { reset: 'Reset your LuxuryStay password', verify: 'Verify your LuxuryStay email', invite: 'Accept your LuxuryStay staff invitation' }[kind];
  return sendMail(user.email, title, title + ':\n' + new URL('/account/' + kind + '#' + token, origin).href + '\n\nThis link expires in ' + minutes + ' minutes.');
}

export const accounts = Router();
accounts.post('/account/reset', limit, async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  if (!mailReady()) throw unavailable();
  const user = await User.findOne({ email: input.email, active: true, emailVerified: true });
  if (user) {
    // Respond identically for existing and unknown email addresses.
    void sendToken(user, 'reset').catch(() => console.error('An account recovery email could not be sent.'));
  }
  res.status(202).json({ message: 'If the account is eligible, an email will arrive with reset instructions.' });
});
accounts.post('/account/verify', authenticate, limit, async (req, res) => {
  if (!mailReady()) throw unavailable();
  if (!req.user.emailVerified) await sendToken(req.user, 'verify');
  res.status(202).json({ message: req.user.emailVerified ? 'Your email is already verified.' : 'Check your email for the verification link.' });
});
accounts.post('/account/:kind/complete', limit, async (req, res) => {
  const kind = z.enum(kinds).parse(req.params.kind);
  const input = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: password.optional() }).parse(req.body);
  if (kind !== 'verify' && !input.password) throw new BookingError(400, 'Choose a new password.');
  const passwordHash = kind === 'verify' ? undefined : await bcrypt.hash(input.password, 12);
  await mongoose.connection.transaction(async (session) => {
    const record = await AccountToken.findOneAndDelete({ kind, digest: hash(input.token), expiresAt: { $gt: new Date() } }).session(session);
    if (!record) throw new BookingError(400, 'This link expired or was already used.');
    const user = await User.findOne({ _id: record.user, ...(kind === 'invite' ? { invited: true } : { active: true }) }).session(session);
    if (!user) throw new BookingError(400, 'This account is no longer eligible.');
    if (kind !== 'reset') user.emailVerified = true;
    if (kind === 'invite') {
      user.active = true;
      user.invited = false;
    }
    if (passwordHash) {
      user.passwordHash = passwordHash;
      user.credentialVersion = (user.credentialVersion ?? 0) + 1;
      await Session.deleteMany({ user: user.id }, { session });
    }
    await user.save({ session });
    await AccountToken.deleteMany({ user: user.id, kind }, { session });
  });
  res.json({ message: kind === 'verify' ? 'Email verified.' : 'Password saved. You can now sign in.' });
});
accounts.put('/account/profile', authenticate, async (req, res) => {
  const input = z.object({ name: cleanName, preferences: z.string().trim().max(600) }).parse(req.body);
  await User.updateOne({ _id: req.user.id }, { $set: input });
  res.json({ ...input });
});

accounts.put('/account/password', authenticate, limit, async (req, res) => {
  const input = z.object({ current: z.string().min(1).refine((value) => Buffer.byteLength(value) <= 72),
    password }).parse(req.body);
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user?.active || !await bcrypt.compare(input.current, user.passwordHash)) {
    throw new BookingError(403, 'The current password is incorrect.');
  }
  if (input.current === input.password) throw new BookingError(400, 'Choose a different password.');
  const passwordHash = await bcrypt.hash(input.password, 12);
  await mongoose.connection.transaction(async (session) => {
    const result = await User.updateOne({ _id: user.id, active: true, passwordHash: user.passwordHash },
      { $set: { passwordHash }, $inc: { credentialVersion: 1 } }, { session });
    if (!result.matchedCount) throw new BookingError(409, 'The account changed. Sign in again.');
    await Session.deleteMany({ user: user.id }, { session });
    await AccountToken.deleteMany({ user: user.id, kind: 'reset' }, { session });
  });
  res.json({ message: 'Password changed. Sign in again.' });
});

accounts.get('/staff/admin/team', authenticate, allowRoles('super-admin'), async (_req, res) => {
  const team = await User.find({ role: { $in: staff } }).select('name email role branches active invited')
    .populate('branches', 'name').sort('name').limit(300).lean();
  res.json({ team });
});
accounts.post('/staff/admin/team', authenticate, allowRoles('super-admin'), limit, async (req, res) => {
  const input = z.object({ name: cleanName, email, role: z.enum(staff), branches: z.array(objectId).min(1).max(50) }).parse(req.body);
  if (!mailReady()) throw unavailable();
  const branches = [...new Set(input.branches)];
  if (await Branch.countDocuments({ _id: { $in: branches } }) !== branches.length) throw new BookingError(400, 'Select valid properties.');
  const account = await mongoose.connection.transaction(async (session) => {
    let user = await User.findOne({ email: input.email }).session(session);
    if (user && !user.invited) throw new BookingError(409, 'An account with this email already exists.');
    if (!user) user = new User({ ...input, branches, active: false, invited: true,
      passwordHash: await bcrypt.hash(randomBytes(24).toString('base64url'), 12) });
    else user.set({ name: input.name, role: input.role, branches });
    await user.save({ session });
    await teamAudit(req.user, user, branches, 'team.invited', session);
    return user;
  });
  await sendToken(account, 'invite');
  res.status(202).json({ message: 'Staff invitation sent.' });
});
accounts.put('/staff/admin/team/:id', authenticate, allowRoles('super-admin'), async (req, res) => {
  const id = objectId.parse(req.params.id);
  const input = z.object({ active: z.boolean(), role: z.enum(staff), branches: z.array(objectId).min(1).max(50) }).parse(req.body);
  const branches = [...new Set(input.branches)];
  if (await Branch.countDocuments({ _id: { $in: branches } }) !== branches.length) throw new BookingError(400, 'Select valid properties.');
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ _id: id, role: { $in: staff }, invited: { $ne: true } }).session(session);
    if (!user) throw new BookingError(404, 'Staff account not found or invitation pending.');
    const previous = user.branches.map(String);
    user.set({ ...input, branches });
    await user.save({ session });
    if (!input.active) await Session.deleteMany({ user: user.id }, { session });
    await teamAudit(req.user, user, [...new Set([...previous, ...branches])], 'team.changed', session);
  });
  res.sendStatus(204);
});
async function teamAudit(actor, user, branches, action, session) {
  for (const branch of branches) await event({ branch, actor: actor.id, action, resource: user.id, message: 'Staff access was updated.' }, session);
}

accounts.put('/staff/admin/properties/:branchId/policies', authenticate, allowRoles(...managers), scopedBranch, async (req, res) => {
  const input = z.object({ taxBps: z.number().int().min(0).max(2500), checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), policyNotes: z.string().trim().max(800) }).parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    await Branch.updateOne({ _id: req.branch.id }, { $set: input }, { session });
    await event({ branch: req.branch.id, actor: req.user.id, action: 'property.policies',
      resource: req.branch.id, message: 'Property policies were updated.' }, session);
  });
  res.json(input);
});
