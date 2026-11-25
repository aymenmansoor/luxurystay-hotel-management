import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Session, User } from './models.js';

export const cookie = 'luxurystay_session';
const lifetime = 12 * 60 * 60 * 1000;
const production = process.env.NODE_ENV === 'production';
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/' };
const digest = (token) => createHash('sha256').update(token).digest('hex');
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).refine((password) => Buffer.byteLength(password, 'utf8') <= 72)
});
const registration = credentials.extend({
  name: z.string().trim().min(2).max(100),
  password: credentials.shape.password.refine((password) => password.length >= 12, 'Use at least 12 characters')
});
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, branches: user.branches, emailVerified: user.emailVerified, preferences: user.preferences };
}

async function setSession(req, res, user) {
  const oldToken = req.cookies[cookie];
  if (oldToken) await Session.deleteOne({ digest: digest(oldToken) });
  const token = randomBytes(32).toString('base64url');
  await Session.create({ digest: digest(token), user: user.id, credentialVersion: user.credentialVersion ?? 0, expiresAt: new Date(Date.now() + lifetime) });
  res.cookie(cookie, token, { ...cookieOptions, maxAge: lifetime });
}

export async function sessionUser(token) {
  const session = token && await Session.findOne({ digest: digest(token), expiresAt: { $gt: new Date() } }).populate('user');
  return session?.user?.active && (session.credentialVersion ?? 0) === (session.user.credentialVersion ?? 0)
    ? session.user : null;
}

export async function authenticate(req, res, next) {
  const user = req.user ?? await sessionUser(req.cookies[cookie]);
  if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
  req.user = user;
  next();
}

export const allowRoles = (...allowed) => (req, res, next) => {
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Access denied.' });
  next();
};

export function authRoutes() {
  const router = Router();
  const throttle = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' } });

  router.post('/register', throttle, async (req, res) => {
    const { name, email, password } = registration.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role: 'guest' });
    await setSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  function login(staff) {
    return async (req, res) => {
      const { email, password } = credentials.parse(req.body);
      const user = await User.findOne({ email, active: true }).select('+passwordHash');
      const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
      if (!user || !passwordMatches || (user.role !== 'guest') !== staff) {
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      }
      await setSession(req, res, user);
      res.json({ user: publicUser(user) });
    };
  }

  router.post('/login', throttle, login(false));
  router.post('/staff/login', throttle, login(true));
  router.get('/session', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));
  router.post('/logout', async (req, res) => {
    const token = req.cookies[cookie];
    if (token) await Session.deleteOne({ digest: digest(token) });
    res.clearCookie(cookie, cookieOptions).sendStatus(204);
  });
  return router;
}
