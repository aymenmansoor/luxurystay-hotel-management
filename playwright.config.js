import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const database = 'luxurystay_browser_' + randomUUID().replaceAll('-', '');
const uri = process.env.BROWSER_TEST_DATABASE_URI ?? 'mongodb://127.0.0.1:27017/' + database + '?replicaSet=rs0';
if (!/^mongodb:\/\/127\.0\.0\.1:27017\/luxurystay_browser_[a-f0-9]{32}\?replicaSet=rs0$/.test(uri)) {
  throw new Error('Browser tests require an isolated local MongoDB database.');
}
const password = 'Browser fixture password 2026';
process.env.BROWSER_TEST_DATABASE_URI = uri;
process.env.BROWSER_TEST_DEMO_PASSWORD = password;

export default defineConfig({
  testDir: './browser',
  workers: 1,
  timeout: 45_000,
  globalSetup: './browser/setup.js',
  use: {
    baseURL: 'http://127.0.0.1:5181',
    launchOptions: process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined
  },
  webServer: [
    { command: 'node apps/api/src/server.js', url: 'http://127.0.0.1:3301/api/health',
      env: { NODE_ENV: 'test', PORT: '3301', MONGODB_URI: uri, APP_ORIGIN: 'http://127.0.0.1:5181', SMTP_URL: '' },
      reuseExistingServer: false },
    { command: 'npm run dev -w @luxurystay/web -- --port 5181 --strictPort', url: 'http://127.0.0.1:5181',
      env: { LUXURYSTAY_API_PROXY: 'http://127.0.0.1:3301' }, reuseExistingServer: false }
  ]
});
