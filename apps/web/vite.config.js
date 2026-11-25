import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.LUXURYSTAY_API_PROXY ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api,
    '/socket.io': { target: api, ws: true } } }
});
