import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { connect } from '../apps/api/src/db.js';

export default async function setup() {
  const uri = process.env.BROWSER_TEST_DATABASE_URI;
  const name = new URL(uri).pathname.slice(1);
  if (!/^luxurystay_browser_[a-f0-9]{32}$/.test(name)) throw new Error('Use an isolated browser test database.');
  async function cleanup() {
    try {
      await connect(uri);
      if (mongoose.connection.name === name) await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  }
  try {
    execFileSync(process.execPath, ['apps/api/src/seed.js'], { env: {
      ...process.env, NODE_ENV: 'test', MONGODB_URI: uri, DEMO_PASSWORD: process.env.BROWSER_TEST_DEMO_PASSWORD
    }, stdio: 'inherit' });
  } catch (error) {
    await cleanup();
    throw error;
  }
  return cleanup;
}
