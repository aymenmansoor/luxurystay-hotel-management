import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connect, localUri } from '../src/db.js';
import { Branch, Inquiry, Review, Room, RoomType, Session, Subscription, User } from '../src/models.js';

const app = createApp();
const password = 'test-password-long';
const testDatabase = 'luxurystay_test_' + randomUUID().replaceAll('-', '');
let setupComplete = false;
let assigned;
let other;

before(async () => {
  await connect(process.env.TEST_MONGODB_URI ?? localUri, { dbName: testDatabase });
  setupComplete = true;
  [assigned, other] = await Branch.create([
    { slug: 'assigned', name: 'Assigned Hotel', city: 'London', timeZone: 'Europe/London', currency: 'GBP' },
    { slug: 'other', name: 'Other Hotel', city: 'Dubai', timeZone: 'Asia/Dubai', currency: 'AED' }
  ]);
  const type = await RoomType.create({ branch: assigned.id, slug: 'king', name: 'King', capacity: 2, nightlyRate: 12000 });
  await Room.create({ branch: assigned.id, type: type.id, number: '101', floor: 1 });
  const hash = await bcrypt.hash(password, 4);
  await User.create([
    { email: 'staff@example.test', name: 'Staff', role: 'receptionist', branches: [assigned.id], passwordHash: hash },
    { email: 'admin@example.test', name: 'Admin', role: 'super-admin', passwordHash: hash },
    { email: 'manager@example.test', name: 'Manager', role: 'branch-manager', branches: [assigned.id], passwordHash: hash },
    { email: 'finance@example.test', name: 'Finance', role: 'finance', branches: [assigned.id], passwordHash: hash }
  ]);
});

after(async () => {
  try {
    if (setupComplete) await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

async function staffLogin(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/staff/login').send({ email, password }).expect(200);
  return agent;
}

test('database can commit a multi-document transaction', async () => {
  await mongoose.connection.transaction(async (session) => {
    const branch = new Branch({ slug: 'transaction', name: 'Transaction Hotel', city: 'Paris', timeZone: 'Europe/Paris', currency: 'EUR' });
    await branch.save({ session });
    const type = new RoomType({ branch: branch.id, slug: 'double', name: 'Double', capacity: 2, nightlyRate: 9000 });
    await type.save({ session });
  });
  const branch = await Branch.findOne({ slug: 'transaction' });
  assert.equal(await RoomType.countDocuments({ branch: branch.id }), 1);
  await RoomType.deleteMany({ branch: branch.id });
  await branch.deleteOne();
});

test('guests can browse the catalog without signing in', async () => {
  await request(app).get('/api/health').expect(200, { status: 'ok' });
  const result = await request(app).get('/api/branches/assigned/room-types').expect(200);
  assert.equal(result.body.roomTypes[0].nightlyRate, 12000);
  await request(app).get('/api/staff/branches').expect(401);
});

test('guest registration, sign-in, session revocation and role isolation', async () => {
  const guest = request.agent(app);
  const email = 'guest@example.test';
  const result = await guest.post('/api/auth/register').send({ name: 'Guest', email, password, role: 'super-admin' }).expect(201);
  assert.equal(result.body.user.role, 'guest');
  assert.match(result.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(result.headers['set-cookie'][0], /SameSite=Lax/i);
  const stored = await User.findOne({ email }).select('+passwordHash');
  assert.notEqual(stored.passwordHash, password);
  await guest.get('/api/auth/session').expect(200);
  await guest.get('/api/staff/branches').expect(403);
  await guest.post('/api/auth/staff/login').send({ email, password }).expect(401);
  await guest.post('/api/auth/logout').expect(204);
  assert.equal(await Session.countDocuments({ user: stored.id }), 0);
  await guest.get('/api/auth/session').expect(401);
  await guest.post('/api/auth/login').send({ email, password }).expect(200);
  await guest.post('/api/auth/register').send({ name: 'Guest', email, password }).expect(409);
});

test('staff can only read permitted branches and data', async () => {
  await request(app).post('/api/auth/login').send({ email: 'staff@example.test', password }).expect(401);
  const staff = await staffLogin('staff@example.test');
  const { body } = await staff.get('/api/staff/branches').expect(200);
  assert.deepEqual(body.branches.map((branch) => branch._id), [assigned.id]);
  const inventory = await staff.get('/api/staff/branches/' + assigned.id + '/rooms').expect(200);
  assert.equal(inventory.body.rooms[0].number, '101');
  await staff.get('/api/staff/branches/' + other.id + '/rooms').expect(404);
  await staff.get('/api/staff/branches/invalid/rooms').expect(400);
  const finance = await staffLogin('finance@example.test');
  await finance.get('/api/staff/branches/' + assigned.id + '/rooms').expect(403);
  const admin = await staffLogin('admin@example.test');
  assert.equal((await admin.get('/api/staff/branches').expect(200)).body.branches.length, 2);
  await admin.get('/api/staff/branches/' + other.id + '/rooms').expect(200);
});

test('invalid registration and cross-site mutations are rejected', async () => {
  await request(app).post('/api/auth/register').send({ email: 'invalid' }).expect(400);
  await request(app).post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site').expect(403);
});

test('inventory writes respect branch, role, uniqueness and category scope', async () => {
  const manager = await staffLogin('manager@example.test');
  const admin = await staffLogin('admin@example.test');
  const receptionist = await staffLogin('staff@example.test');
  const base = '/api/staff/inventory/branches';
  const branchFields = { slug: 'paris', name: 'Paris Hotel', city: 'Paris', currency: 'EUR', timeZone: 'Europe/Paris' };
  await manager.post(base).send(branchFields).expect(403);
  const created = await admin.post(base).send(branchFields).expect(201);
  assert.equal(created.body.branch.slug, 'paris');
  await manager.put(base + '/' + other.id).send(branchFields).expect(404);
  await manager.put(base + '/' + assigned.id).send({
    ...branchFields, city: 'London', name: 'Updated London', address: 'Mayfair', facilities: ['Spa']
  }).expect(200);
  const detail = await request(app).get('/api/branches/assigned/room-types').expect(200);
  assert.equal(detail.body.branch.name, 'Updated London');
  assert.equal(detail.body.branch.currency, 'GBP');
  assert.deepEqual(detail.body.branch.facilities, ['Spa']);

  const fields = { slug: 'suite', name: 'Suite', capacity: 4, nightlyRate: 29900, amenities: ['Wi-Fi'], size: 60 };
  const typePath = base + '/' + assigned.id + '/room-types';
  const roomsPath = base + '/' + assigned.id + '/rooms';
  await receptionist.post(typePath).send(fields).expect(403);
  await manager.post(base + '/' + other.id + '/room-types').send(fields).expect(404);
  const { body: { record: category } } = await manager.post(typePath).send(fields).expect(201);
  await manager.post(typePath).send(fields).expect(409);
  await manager.put(typePath + '/' + category._id).send({ ...fields, name: 'Corner Suite', size: null }).expect(200);
  await manager.put(typePath + '/' + category._id).set('Sec-Fetch-Site', 'cross-site').send(fields).expect(403);
  const foreign = await RoomType.create({ branch: other.id, ...fields });
  await manager.post(roomsPath).send({ number: '201', floor: 2, type: foreign.id }).expect(400);
  const { body: { record: room } } = await manager.post(roomsPath).send({ number: '201', floor: 2, type: category._id }).expect(201);
  await manager.post(roomsPath).send({ number: '201', floor: 2, type: category._id }).expect(409);
  await manager.put(roomsPath + '/' + room._id).send({ number: '202', floor: 2, type: category._id }).expect(200);
  assert.equal((await Room.findById(room._id)).number, '202');
  const publicRooms = await request(app).get('/api/room-types').expect(200);
  assert.ok(publicRooms.body.roomTypes.some((type) => type.name === 'Corner Suite' && type.branch.slug === 'assigned'));
});

test('public inquiries, consented subscriptions and approved review visibility', async () => {
  const manager = await staffLogin('manager@example.test');
  const appRequest = request(app);
  const inquiry = { name: 'Guest Name', email: 'request@example.test', branch: assigned.id, message: 'I would like to inquire about a stay.' };
  await appRequest.post('/api/contact').send(inquiry).expect(201);
  assert.equal(await Inquiry.countDocuments({ branch: assigned.id }), 1);
  const base = '/api/staff/inventory/branches/';
  const inbox = await manager.get(base + assigned.id + '/inquiries').expect(200);
  assert.equal(inbox.body.inquiries[0].message, inquiry.message);
  await manager.get(base + other.id + '/inquiries').expect(404);

  await appRequest.post('/api/newsletter').send({ email: inquiry.email, consent: false }).expect(400);
  await appRequest.post('/api/newsletter').send({ email: inquiry.email, consent: true }).expect(200);
  await appRequest.post('/api/newsletter').send({ email: inquiry.email, consent: true }).expect(200);
  assert.equal(await Subscription.countDocuments({ email: inquiry.email }), 1);

  await Review.create([
    { displayName: 'Public guest', rating: 5, comment: 'Approved comment', branch: assigned.id, approved: true },
    { displayName: 'Private guest', rating: 1, comment: 'Unapproved comment', branch: assigned.id }
  ]);
  const result = await appRequest.get('/api/reviews').expect(200);
  assert.deepEqual(result.body.reviews.map((item) => item.comment), ['Approved comment']);
});

test('changing a password requires the old password and revokes existing sessions', async () => {
  const email = 'password-change@example.test';
  const password = 'Original password 123';
  const replacement = 'Replacement password 456';
  const first = request.agent(app);
  const second = request.agent(app);
  await first.post('/api/auth/register').send({ name: 'Password Change Guest', email, password }).expect(201);
  await second.post('/api/auth/login').send({ email, password }).expect(200);
  await first.put('/api/account/password').send({ current: 'incorrect', password: replacement }).expect(403);
  await first.put('/api/account/password').send({ current: password, password: replacement }).expect(200);
  await first.get('/api/auth/session').expect(401);
  await second.get('/api/auth/session').expect(401);
  await second.post('/api/auth/login').send({ email, password }).expect(401);
  await second.post('/api/auth/login').send({ email, password: replacement }).expect(200);
});

test('production startup rejects missing and malformed configuration before opening a listener', () => {
  const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));
  const valid = { PATH: process.env.PATH, NODE_ENV: 'production', APP_ORIGIN: 'https://hotel.example',
    MONGODB_URI: 'mongodb://127.0.0.1:1/local?replicaSet=test' };
  for (const [overrides, message] of [
    [{ MONGODB_URI: '' }, /Set MONGODB_URI explicitly/],
    [{ APP_ORIGIN: 'http://hotel.example' }, /public HTTPS origin/],
    [{ SMTP_URL: 'smtps://mail.example' }, /both SMTP_URL and MAIL_FROM/],
    [{ SMTP_URL: 'https://mail.example', MAIL_FROM: 'reservations@hotel.example' }, /must use smtp/],
    [{ TRUST_PROXY_CIDRS: '0.0.0.0/0' }, /explicit proxy IP addresses/],
    [{ PORT: '3001.5' }, /PORT must be an integer/]
  ]) {
    const run = spawnSync(process.execPath, [entry], {
      env: { ...valid, ...overrides }, encoding: 'utf8', timeout: 5000
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1);
    assert.match(run.stderr, message);
    assert.doesNotMatch(run.stdout, /listening/);
  }
});
