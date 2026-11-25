import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connect, localUri } from '../src/db.js';
import { Branch, Room, RoomType } from '../src/models.js';

test('32 parallel availability reads return consistent room counts', async (t) => {
  const database = 'luxurystay_load_' + randomUUID().replaceAll('-', '');
  try {
    await connect(localUri, { dbName: database });
    const branch = await Branch.create({ name: 'Load fixture', slug: 'load-fixture', city: 'Fixture', timeZone: 'UTC', currency: 'GBP' });
    const type = await RoomType.create({ branch: branch.id, name: 'Twin', slug: 'twin', capacity: 2, nightlyRate: 10000 });
    await Room.create({ branch: branch.id, type: type.id, number: '101', floor: 1 });
    const app = createApp();
    const dateIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const query = { branch: branch.slug, checkIn: dateIn(7), checkOut: dateIn(9), guests: 2 };
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: 32 }, async () => {
      const begin = performance.now();
      const response = await request(app).get('/api/availability').query(query);
      return { response, ms: performance.now() - begin };
    }));
    const elapsed = performance.now() - started;
    assert.ok(results.every(({ response }) => response.status === 200 && response.body.roomTypes?.[0]?.availableRooms === 1));
    const latencies = results.map(({ ms }) => ms).sort((a, b) => a - b);
    t.diagnostic('Local single replica set, 32 requests: wall ' + Math.round(elapsed) +
      ' ms, observed p95 ' + Math.round(latencies[Math.ceil(latencies.length * .95) - 1]) + ' ms.');
  } finally {
    if (mongoose.connection.name === database && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
