import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connect } from './db.js';
import { User } from './models.js';

const values = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(16).refine((value) => Buffer.byteLength(value) <= 72)
}).safeParse({
  email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  name: process.env.BOOTSTRAP_ADMIN_NAME,
  password: process.env.BOOTSTRAP_ADMIN_PASSWORD
});
if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI to the intended database.');
if (!values.success) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and a 16–72 byte bootstrap password.');

try {
  await connect();
  const { email, name, password } = values.data;
  const admin = await User.findOne({ role: 'super-admin' });
  if (admin?.email === email && admin.active) {
    console.log('An active super admin already exists for this email.');
  } else if (admin) {
    throw new Error('A super admin already exists. Use the existing account.');
  } else {
    await User.create({ email, name, role: 'super-admin', emailVerified: true, passwordHash: await bcrypt.hash(password, 12) });
    console.log('The first super admin is ready.');
  }
} finally {
  await mongoose.disconnect();
}
