import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { io } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { AccountToken } from '../src/accounts.js';
import { connect, localUri } from '../src/db.js';
import { LoyaltyAccount, LoyaltyEntry } from '../src/loyalty.js';
import { Branch, Room, RoomType, User } from '../src/models.js';
import { Audit, Charge, Cleaning, Invoice, PriceDecision } from '../src/operations-models.js';
import { BookingAdjustment, Payment, Reservation, RoomNight } from '../src/reservation-models.js';
import { localDay, localTime } from '../src/reservation-service.js';
import { drainMailQueue } from '../src/mail.js';
import { syncReminders } from '../src/reminders.js';
import { realtime } from '../src/realtime.js';

const db = 'luxurystay_test_' + randomUUID().replaceAll('-', '');
const app = createApp();
const password = 'demo-operations-test-password';
const day = 86400000;
const since = (offset) => new Date(Date.parse(localDay('UTC')) + offset * day).toISOString().slice(0, 10);
let branch, other, room, spare, type, guest, manager, cleaner, tech, cleanerId, finance, stranger, admin;
let ref, walkIn;
const property = () => '/api/staff/properties/' + branch.id;
const cookie = (result) => result.headers['set-cookie'][0].split(';')[0];

async function signIn(email, staff = false) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/' + (staff ? 'staff/login' : 'login')).send({ email, password }).expect(200);
  return { agent, cookie: cookie(response) };
}

before(async () => {
  await connect(process.env.TEST_MONGODB_URI ?? localUri, { dbName: db });
  branch = await Branch.create({ name: 'Operations Hotel', slug: 'operations', city: 'London',
    currency: 'GBP', timeZone: 'UTC', facilities: ['Pool'], taxBps: 1000 });
  other = await Branch.create({ name: 'Other Hotel', slug: 'other', city: 'Paris', currency: 'EUR', timeZone: 'UTC' });
  type = await RoomType.create({ branch: branch.id, slug: 'king', name: 'King', capacity: 2, nightlyRate: 10000 });
  [room, spare] = await Room.create([
    { branch: branch.id, type: type.id, number: '101', floor: 1 },
    { branch: branch.id, type: type.id, number: '102', floor: 1 }
  ]);
  const passwordHash = await bcrypt.hash(password, 4);
  async function user(name, role, branches) {
    const email = name + '@example.test';
    const user = await User.create({ name, email, role, branches, passwordHash });
    return { ...await signIn(email, role !== 'guest'), id: user.id };
  }
  guest = await user('guest', 'guest', []);
  stranger = await user('stranger', 'guest', []);
  manager = await user('manager', 'branch-manager', [branch.id]);
  cleaner = await user('cleaner', 'housekeeping', [branch.id]);
  cleanerId = cleaner.id;
  const shiftStart = new Date(Date.now() - 3600000).toISOString();
  const shiftEnd = new Date(Date.now() + 3600000).toISOString();
  await manager.agent.put('/api/staff/properties/' + branch.id + '/shifts/' + cleanerId)
    .send({ start: shiftStart, end: shiftEnd }).expect(200);
  tech = await user('technician', 'maintenance', [branch.id]);
  finance = await user('finance', 'finance', [branch.id]);
  admin = await user('administrator', 'super-admin', []);
});

after(async () => {
  try {
    if (mongoose.connection.name === db && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

test('staff creation and guest QR respect ownership and branch scope', async () => {
  const input = { name: 'Guest', email: 'guest@example.test', source: 'staff', type: 'king',
    checkIn: since(0), checkOut: since(2), guests: 2 };
  const key = randomUUID();
  const result = await manager.agent.post(property() + '/reservations').set('Idempotency-Key', key).send(input).expect(201);
  ref = result.body.reservation.reference;
  assert.equal(result.body.reservation.source, 'staff');
  assert.equal((await manager.agent.post(property() + '/reservations').set('Idempotency-Key', key).send(input).expect(201))
    .body.reservation.reference, ref);
  const walk = { ...input, name: 'Walk-in', email: undefined, source: 'walk-in', checkIn: since(3), checkOut: since(4) };
  walkIn = (await manager.agent.post(property() + '/reservations').set('Idempotency-Key', randomUUID()).send(walk).expect(201))
    .body.reservation.reference;
  assert.ok(walkIn);
  await guest.agent.get('/api/reservations/' + ref + '/qr').expect('Content-Type', /png/).expect(200);
  await stranger.agent.get('/api/reservations/' + ref + '/qr').expect(404);
  await manager.agent.get('/api/staff/properties/' + other.id + '/reservations/' + ref).expect(404);
});

test('desk, billing, checkout, inspection, invoice, loyalty and audit form one lifecycle', async () => {
  const path = property() + '/reservations/' + ref;
  const action = (name, params = {}) => manager.agent.post(path + '/actions').send({ ...params, action: name });
  await action('check-in').expect(409);
  await action('verify').expect(200);
  await action('check-in').expect(200);
  assert.equal((await Room.findById(room.id)).status, 'occupied');
  await action('key').expect(200);
  const charge = { kind: 'restaurant', label: 'Dinner', amount: 3000, requestKey: randomUUID() };
  await finance.agent.post(path + '/charges').send(charge).expect(201);
  await finance.agent.post(path + '/charges').send(charge).expect(201);
  await guest.agent.post('/api/guest/services').send({ reference: ref, category: 'towels', description: 'Two extra towels, please.' }).expect(201);
  const services = await cleaner.agent.get(property() + '/services').expect(200);
  const entry = services.body.requests[0];
  await tech.agent.post(property() + '/services/' + entry._id).send({ status: 'in-progress' }).expect(404);
  await cleaner.agent.post(property() + '/services/' + entry._id).send({ status: 'in-progress' }).expect(200);
  await cleaner.agent.post(property() + '/services/' + entry._id)
    .send({ status: 'completed', completionNote: 'Towels delivered.' }).expect(200);
  const service = (await guest.agent.get('/api/guest/services').expect(200)).body.requests.find((item) => item._id === entry._id);
  assert.equal(service.completionNote, 'Towels delivered.');
  assert.deepEqual(service.timeline.map((entry) => entry.action), ['requested', 'in-progress', 'completed']);
  await action('check-out').expect(200);
  await action('check-out').expect(200);
  assert.equal((await Room.findById(room.id)).status, 'dirty');
  assert.equal(await Cleaning.countDocuments({ room: room.id }), 1);
  const invoice = await Invoice.findOne({ branch: branch.id });
  assert.equal(invoice.subtotal, 25300);
  assert.equal(invoice.paid, 20000);
  assert.equal(invoice.balance, 5300);
  assert.equal(await LoyaltyEntry.countDocuments({ guest: guest.id, kind: 'earn' }), 1);
  assert.equal((await LoyaltyAccount.findOne({ guest: guest.id })).points, 200);
  const downloaded = await guest.agent.get('/api/reservations/' + ref + '/invoice').expect('Content-Type', /pdf/).expect(200);
  assert.equal(downloaded.body.subarray(0, 4).toString(), '%PDF');
  await stranger.agent.get('/api/reservations/' + ref + '/invoice').expect(404);
  const twin = await manager.agent.get(property() + '/twin').expect(200);
  const dirty = twin.body.rooms.find((item) => item._id === room.id);
  assert.equal(dirty.status, 'dirty');
  assert.equal(dirty.readiness.recommendation.id, cleanerId);
  await manager.agent.put(property() + '/layout/' + room.id).send({ row: 1, column: 2 }).expect(200);
  await manager.agent.put(property() + '/layout/' + spare.id).send({ row: 1, column: 2 }).expect(409);
  const placed = await manager.agent.get(property() + '/twin').expect(200);
  assert.deepEqual(placed.body.rooms.find((item) => item._id === room.id).layout, { row: 1, column: 2 });
  await manager.agent.put(property() + '/layout/' + room.id).send({ row: 1, column: 2, width: 2, height: 2 }).expect(200);
  await manager.agent.put(property() + '/layout/' + spare.id).send({ row: 2, column: 3 }).expect(409);
  await manager.agent.put(property() + '/layout/' + spare.id).send({ row: 2, column: 4 }).expect(200);
  const task = property() + '/cleaning/' + dirty.readiness.task;
  await manager.agent.post(task).send({ action: 'assign', assigned: cleanerId }).expect(200);
  const starts = await Promise.all([cleaner.agent.post(task).send({ action: 'start' }),
    manager.agent.post(task).send({ action: 'start' })]);
  assert.deepEqual(starts.map((response) => response.status).sort(), [200, 409]);
  await cleaner.agent.post(task).send({ action: 'complete' }).expect(200);
  await cleaner.agent.post(task).send({ action: 'inspect' }).expect(403);
  await manager.agent.post(task).send({ action: 'inspect' }).expect(200);
  assert.equal((await Room.findById(room.id)).status, 'inspected');
  assert.equal(await Audit.countDocuments({ action: 'desk.check-out', resource: ref }), 1);
});

test('maintenance blocking, moderation, manager-only pricing and reporting', async () => {
  const details = { room: spare.id, summary: 'Air conditioning repair', equipment: 'Fan', priority: 'high', blocking: true };
  const reported = await tech.agent.post(property() + '/maintenance').send(details).expect(201);
  const target = property() + '/maintenance/' + reported.body.issue._id;
  assert.equal((await Room.findById(spare.id)).status, 'maintenance');
  const availability = await request(app).get('/api/availability')
    .query({ branch: branch.slug, checkIn: since(10), checkOut: since(11), guests: 1 }).expect(200);
  assert.equal(availability.body.roomTypes[0].availableRooms, 1);
  await tech.agent.post(target).send({ action: 'resolve', cost: 4500 }).expect(200);
  assert.equal((await Room.findById(spare.id)).status, 'available');
  const review = await guest.agent.post('/api/guest/reviews').send({ reference: ref, rating: 2, comment: 'Long wait for service.' }).expect(201);
  assert.equal((await request(app).get('/api/reviews').expect(200)).body.reviews.length, 0);
  await manager.agent.put(property() + '/reviews/' + review.body.id).send({ approved: true }).expect(200);
  assert.equal((await request(app).get('/api/reviews').expect(200)).body.reviews.length, 1);
  const price = (await manager.agent.get(property() + '/pricing').expect(200)).body.recommendations[0];
  assert.notEqual(price.current, price.recommended);
  assert.equal((await RoomType.findById(type.id)).nightlyRate, price.current);
  const approval = { type: type.id, current: price.current, recommended: price.recommended, reason: 'Review low occupancy' };
  await finance.agent.post(property() + '/pricing').send(approval).expect(403);
  await manager.agent.post(property() + '/pricing').send(approval).expect(201);
  await manager.agent.post(property() + '/pricing').send(approval).expect(409);
  assert.equal(await PriceDecision.countDocuments({ type: type.id }), 1);
  const refreshed = (await manager.agent.get(property() + '/pricing').expect(200)).body.recommendations[0];
  assert.equal(refreshed.recommended, refreshed.current);
  assert.equal(refreshed.anchor, price.current);
  const report = await manager.agent.get('/api/staff/command?days=14').expect(200);
  assert.equal(report.body.branches.length, 1);
  assert.equal(report.body.branches[0].trend.length, 14);
  assert.equal(report.body.branches[0].simulatedRevenue, 30000);
  assert.equal(report.body.branches[0].complaintTopics[0].topic, 'service');
  assert.equal(report.body.portfolio, undefined);
  const global = (await admin.agent.get('/api/staff/command').expect(200)).body;
  assert.equal(global.branches.length, 2);
  assert.equal(global.portfolio.branches, 2);
  assert.equal(global.portfolio.rooms, global.branches.reduce((sum, item) => sum + item.rooms, 0));
  assert.equal(global.portfolio.guests, await User.countDocuments({ role: 'guest', active: true }));
  assert.ok(global.portfolio.reservations >= 2);
  assert.equal((await finance.agent.get('/api/staff/command').expect(200)).body.portfolio, undefined);
});

test('account links are single-use, and staff access restricts active sessions', async () => {
  const token = randomBytes(32).toString('base64url');
  await AccountToken.create({ user: guest.id, kind: 'verify', digest: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60000) });
  await request(app).post('/api/account/verify/complete').send({ token }).expect(200);
  await request(app).post('/api/account/verify/complete').send({ token }).expect(400);
  assert.equal((await guest.agent.get('/api/auth/session').expect(200)).body.user.emailVerified, true);
  await manager.agent.put('/api/staff/admin/team/' + cleaner.id).send({ active: false, role: 'housekeeping', branches: [branch.id] }).expect(403);
  await admin.agent.put('/api/staff/admin/team/' + cleaner.id).send({ active: false, role: 'housekeeping', branches: [branch.id] }).expect(204);
  await cleaner.agent.get('/api/auth/session').expect(401);
});

test('committed events refresh the relevant connected sessions', async () => {
  const input = { branch: branch.slug, type: type.slug, checkIn: since(10), checkOut: since(12), guests: 1 };
  const hold = await guest.agent.post('/api/reservations/holds').set('Idempotency-Key', randomUUID()).send(input).expect(201);
  const active = hold.body.reservation.reference;
  await guest.agent.post('/api/reservations/' + active + '/confirm').send({ payment: 'simulation' }).expect(200);
  const server = createServer(app);
  const sockets = realtime(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const connectSocket = (cookie) => io(url, { transports: ['websocket'], reconnection: false,
    extraHeaders: { Origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', Cookie: cookie } });
  const a = connectSocket(guest.cookie);
  const b = connectSocket(stranger.cookie);
  const staff = connectSocket(manager.cookie);
  let unauthorized = 0;
  b.on('hotel:update', () => unauthorized++);
  try {
    await Promise.all([a, b, staff].map((socket) => once(socket, 'connect', { signal: AbortSignal.timeout(4000) })));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const refreshed = Promise.all([a, staff].map((socket) => once(socket, 'hotel:update', { signal: AbortSignal.timeout(5000) })));
    await guest.agent.post('/api/guest/services').send({ reference: ref, category: 'other', description: 'Cannot submit for an old stay.' }).expect(404);
    await guest.agent.post('/api/guest/services').send({ reference: active, category: 'other', description: 'Arrange a room amenity.' }).expect(201);
    await refreshed;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(unauthorized, 0);
  } finally {
    a.close();
    b.close();
    staff.close();
    await sockets.close();
  }
});

test('post-checkout settlement is scoped, concurrency-safe, idempotent, and preserves the issued invoice', async () => {
  const staffPath = property() + '/reservations/' + ref + '/settlement';
  const guestPath = '/api/reservations/' + ref + '/settlement';
  const stay = await Reservation.findOne({ reference: ref });
  const issued = await Invoice.findOne({ reservation: stay.id }).lean();
  const initial = await guest.agent.get(guestPath).expect(200);
  assert.equal(initial.body.account.balance, issued.balance);
  await stranger.agent.get(guestPath).expect(404);
  await guest.agent.post(guestPath).send({ kind: 'refund', amount: 1, requestKey: randomUUID() }).expect(403);
  const payment = { kind: 'payment', amount: issued.balance, requestKey: randomUUID() };
  const results = await Promise.all([
    guest.agent.post(guestPath).send(payment),
    finance.agent.post(staffPath).send({ ...payment, requestKey: randomUUID() })
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  if (results[0].status === 200) await guest.agent.post(guestPath).send(payment).expect(200);
  const account = (await finance.agent.get(staffPath).expect(200)).body.account;
  assert.equal(account.balance, 0);
  assert.equal(account.transactions.length, 1);
  const refund = { kind: 'refund', amount: 500, requestKey: randomUUID() };
  await finance.agent.post(staffPath).send(refund).expect(200);
  await finance.agent.post(staffPath).send(refund).expect(200);
  assert.equal((await guest.agent.get(guestPath).expect(200)).body.account.balance, 500);
  assert.equal((await manager.agent.get('/api/staff/command').expect(200)).body.branches[0].outstanding, 500);
  const credit = { kind: 'credit', amount: 500, reason: '=Correct duplicate charge', requestKey: randomUUID() };
  await guest.agent.post(guestPath).send(credit).expect(403);
  await finance.agent.post(staffPath).send({ ...credit, reason: undefined }).expect(400);
  await finance.agent.post(staffPath).send(credit).expect(200);
  const credited = (await finance.agent.post(staffPath).send(credit).expect(200)).body.account;
  assert.equal(credited.balance, 0);
  assert.equal(credited.paid, issued.paid + issued.balance - 500);
  assert.equal(credited.credits, 500);
  assert.equal((await manager.agent.get('/api/staff/command').expect(200)).body.branches[0].outstanding, 0);
  assert.deepEqual(await Invoice.findById(issued._id).lean(), issued);
});

test('authorized staff can recover and confirm a pending staff hold', async () => {
  const input = { name: 'Pending guest', source: 'staff', type: 'king', checkIn: since(40), checkOut: since(41),
    guests: 1, holdOnly: true };
  const key = randomUUID();
  const draft = await manager.agent.post(property() + '/reservations').set('Idempotency-Key', key).send(input).expect(201);
  const held = draft.body.reservation;
  assert.equal(held.status, 'held');
  const list = await manager.agent.get('/api/staff/branches/' + branch.id + '/reservations').expect(200);
  assert.ok(list.body.reservations.some((item) => item.reference === held.reference && item.status === 'held'));
  await finance.agent.post(property() + '/reservations/' + held.reference + '/actions').send({ action: 'confirm-hold' }).expect(403);
  const path = property() + '/reservations/' + held.reference + '/actions';
  await manager.agent.post(path).send({ action: 'confirm-hold' }).expect(200, { status: 'confirmed' });
  await manager.agent.post(path).send({ action: 'confirm-hold' }).expect(200, { status: 'confirmed' });
});

test('property media requires a manager, validates uploaded bytes, and publishes only scoped images', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temp = await mkdtemp(join(tmpdir(), 'luxurystay-media-'));
  const previous = process.env.MEDIA_DIRECTORY;
  process.env.MEDIA_DIRECTORY = temp;
  try {
    const bytes = await readFile(new URL('../../web/public/images/king.webp', import.meta.url));
    const path = property() + '/media';
    const metadata = { roomType: type.id, alt: 'A demonstration hotel room', source: 'Project fixture', rights: 'Internal demonstration' };
    await tech.agent.post(path).query(metadata).type('image/webp').send(bytes).expect(403);
    await manager.agent.post(path).query(metadata).type('image/webp').send(Buffer.alloc(24)).expect(400);
    const { body } = await manager.agent.post(path).query(metadata).type('image/webp').send(bytes).expect(201);
    const photo = body.image;
    const published = await request(app).get('/api/branches/operations/media').expect(200);
    assert.equal(published.body.media[0].url, photo.url);
    assert.equal(published.body.media[0].rights, undefined);
    await request(app).get(photo.url).expect('Content-Type', /image\/webp/).expect(200);
    await manager.agent.put(path + '/' + photo.id).send({ ...metadata, alt: 'Updated description', order: 1 }).expect(200);
    await manager.agent.delete(path + '/' + photo.id).expect(204);
    await request(app).get(photo.url).expect(404);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previous;
    await rm(temp, { recursive: true, force: true });
  }
});

test('a guest complaint stays private and a scoped manager can resolve it', async () => {
  const submitted = await guest.agent.post('/api/guest/complaints').send({
    reference: ref, category: 'service', text: 'The front desk wait took too long.'
  }).expect(201);
  const id = submitted.body.complaint._id;
  assert.equal((await stranger.agent.get('/api/guest/complaints').expect(200)).body.complaints.length, 0);
  const path = property() + '/complaints/' + id;
  await finance.agent.put(path).send({ status: 'resolved', department: 'front-desk', resolution: 'Responded to the guest.' }).expect(403);
  await manager.agent.put(path).send({ status: 'resolved', department: 'front-desk' }).expect(400);
  await manager.agent.put(path).send({ status: 'resolved', department: 'front-desk', resolution: 'Responded to the guest.' }).expect(200);
  assert.equal((await guest.agent.get('/api/guest/complaints').expect(200)).body.complaints[0].status, 'resolved');
});

async function deskFixture(unit, status, start, end) {
  const key = randomUUID().replaceAll('-', '');
  return Reservation.create({
    reference: 'LS-' + key.slice(0, 18).toUpperCase(), guest: guest.id, branch: branch.id, type: type.id,
    room: unit.id, checkIn: since(start), checkOut: since(end), guests: 1, status,
    nightlyRate: 10000, total: (end - start) * 10000, currency: 'GBP', requestKey: key, requestFingerprint: key
  });
}

test('no-show release and overdue extension retain prior nights and enforce conflicts', async () => {
  const unit = await Room.create({ branch: branch.id, type: type.id, number: 'POLICY', floor: 1 });
  const missed = await deskFixture(unit, 'confirmed', -2, 2);
  const past = await RoomNight.create({ room: unit.id, date: since(-1), reservation: missed.id });
  await RoomNight.create({ room: unit.id, date: since(0), reservation: missed.id });
  const missedPath = property() + '/reservations/' + missed.reference + '/actions';
  await manager.agent.post(missedPath).send({ action: 'no-show' }).expect(200, { status: 'no-show' });
  await manager.agent.post(missedPath).send({ action: 'no-show' }).expect(200);
  assert.ok(await RoomNight.exists({ _id: past.id }));
  assert.equal(await RoomNight.countDocuments({ reservation: missed.id }), 1);

  const overdueRoom = await Room.create({ branch: branch.id, type: type.id, number: 'OVERDUE', floor: 1, status: 'occupied' });
  const overdue = await deskFixture(overdueRoom, 'checked-in', -4, -2);
  const arriving = await deskFixture(overdueRoom, 'confirmed', 1, 3);
  await RoomNight.create({ room: overdueRoom.id, date: since(1), reservation: arriving.id });
  const actions = property() + '/reservations/' + overdue.reference + '/actions';
  await manager.agent.post(actions).send({ action: 'extend', newCheckout: since(2) }).expect(409);
  assert.equal(await RoomNight.countDocuments({ reservation: overdue.id }), 0);
  await manager.agent.post(actions).send({ action: 'extend', newCheckout: since(1) }).expect(200);
  assert.equal(await RoomNight.countDocuments({ reservation: overdue.id }), 3);
  assert.equal((await Reservation.findById(overdue.id)).total, 50000);
});

test('emergency blocks preserve reservations until staff relocates the guest', async () => {
  const source = await Room.create({ branch: branch.id, type: type.id, number: 'EMERGENCY', floor: 3, status: 'occupied' });
  const target = await Room.create({ branch: branch.id, type: type.id, number: 'REPLACEMENT', floor: 3, status: 'inspected' });
  const active = await deskFixture(source, 'checked-in', -1, 2);
  await RoomNight.create([{ room: source.id, date: since(-1), reservation: active.id },
    { room: source.id, date: since(0), reservation: active.id },
    { room: source.id, date: since(1), reservation: active.id }]);
  const result = await tech.agent.post(property() + '/maintenance').send({
    room: source.id, summary: 'Burst pipe in occupied room', priority: 'urgent', blocking: true, emergency: true
  }).expect(201);
  const issue = result.body.issue;
  assert.equal((await Room.findById(source.id)).status, 'maintenance');
  assert.equal(await RoomNight.countDocuments({ reservation: active.id }), 3);
  const visible = await manager.agent.get(property() + '/maintenance').expect(200);
  assert.equal(visible.body.issues.find((row) => row._id === issue._id).affected[0].reference, active.reference);
  const limited = await tech.agent.get(property() + '/maintenance').expect(200);
  assert.equal(limited.body.issues.find((row) => row._id === issue._id).affected, undefined);
  const repair = property() + '/maintenance/' + issue._id;
  await tech.agent.post(repair).send({ action: 'resolve' }).expect(409);
  await manager.agent.post(property() + '/reservations/' + active.reference + '/actions')
    .send({ action: 'reassign', room: target.id }).expect(200, { status: 'checked-in' });
  assert.equal((await Reservation.findById(active.id)).room.toString(), target.id);
  assert.equal(await RoomNight.countDocuments({ room: source.id, reservation: active.id }), 1);
  assert.equal(await RoomNight.countDocuments({ room: target.id, reservation: active.id }), 2);
  assert.equal((await Room.findById(target.id)).status, 'occupied');
  await tech.agent.post(repair).send({ action: 'resolve' }).expect(200);
});

test('published packages quote server prices and concurrent holds respect the last available use', async () => {
  const input = { type: type.id, title: 'Two-night package', description: 'A room and breakfast for the selected stay window.',
    services: ['Breakfast'], restrictions: 'Selected room category only', bookStart: since(-1), bookEnd: since(1),
    stayStart: since(70), stayEnd: since(77), minimumNights: 2, maxUses: 1, discountBps: 2000, published: false };
  const path = property() + '/offers';
  await finance.agent.post(path).send(input).expect(403);
  await manager.agent.post('/api/staff/properties/' + other.id + '/offers').send(input).expect(404);
  const { body } = await manager.agent.post(path).send(input).expect(201);
  const id = body.offer._id;
  assert.equal((await request(app).get('/api/offers').expect(200)).body.offers.length, 0);
  await manager.agent.put(path + '/' + id).send({ ...input, published: true }).expect(200);
  const published = await request(app).get('/api/offers').expect(200);
  assert.equal(published.body.offers[0]._id, id);
  const booking = { branch: branch.slug, type: type.slug, checkIn: since(70), checkOut: since(72), guests: 1, offer: id };
  await request(app).get('/api/availability').query({ ...booking, checkOut: since(71) }).expect(409);
  const quote = await request(app).get('/api/availability').query(booking).expect(200);
  const expected = Math.round((await RoomType.findById(type.id)).nightlyRate * .8);
  assert.equal(quote.body.roomTypes[0].total, expected * 2);
  const people = [guest, stranger];
  const results = await Promise.all(people.map((person) => person.agent.post('/api/reservations/holds')
    .set('Idempotency-Key', randomUUID()).send({ ...booking, total: 1 })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const winner = results.findIndex((result) => result.status === 201);
  const held = results[winner].body.reservation;
  assert.equal(held.total, expected * 2);
  assert.deepEqual(held.offer.services, ['Breakfast']);
  await people[winner].agent.post('/api/reservations/' + held.reference + '/confirm').send({ payment: 'simulation' }).expect(200);
  await people[winner].agent.put('/api/reservations/' + held.reference + '/dates')
    .send({ checkIn: since(71), checkOut: since(78), revision: 0 }).expect(409);
});

test('a change-stream interruption resumes from the previous committed event', async (t) => {
  const server = createServer(app);
  const watch = Audit.watch.bind(Audit);
  const cursors = [];
  const capture = t.mock.method(Audit, 'watch', (...args) => {
    const cursor = watch(...args);
    cursors.push(cursor);
    return cursor;
  });
  const sockets = realtime(server);
  let client;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    client = io('http://127.0.0.1:' + server.address().port, { transports: ['websocket'], reconnection: false,
      extraHeaders: { Origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', Cookie: guest.cookie } });
    await once(client, 'connect', { signal: AbortSignal.timeout(4000) });
    const audit = (action) => Audit.create({ branch: branch.id, guest: guest.id, action, message: 'Test refresh' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const initial = once(client, 'hotel:update', { signal: AbortSignal.timeout(4000) });
    await audit('test.before-interruption');
    await initial;
    const id = client.id;
    const recovery = once(client, 'hotel:update', { signal: AbortSignal.timeout(6000) });
    cursors[0].emit('error', new Error('Simulated watcher interruption'));
    await audit('test.while-interrupted');
    await recovery;
    assert.equal(client.id, id);
    assert.ok(capture.mock.calls[1].arguments[1].resumeAfter);
    const continued = once(client, 'hotel:update', { signal: AbortSignal.timeout(4000) });
    await audit('test.after-interruption');
    await continued;
  } finally {
    client?.close();
    await sockets.close();
  }
});

test('late checkout uses the property clock and reserves the room night only when conflict-free', async () => {
  const timeZone = localTime('UTC') < '22:00' ? 'UTC' : 'Pacific/Honolulu';
  const today = localDay(timeZone);
  const unit = await Room.create({ branch: branch.id, type: type.id, number: 'LATE', floor: 3, status: 'occupied' });
  const active = await deskFixture(unit, 'checked-in', -1, 0);
  await Reservation.updateOne({ _id: active.id }, { $set: { checkOut: today } });
  const arrival = await deskFixture(unit, 'confirmed', 0, 1);
  const night = await RoomNight.create({ room: unit.id, date: today, reservation: arrival.id });
  const path = property() + '/reservations/' + active.reference + '/actions';
  try {
    await Branch.updateOne({ _id: branch.id }, { $set: { timeZone } });
    await manager.agent.post(path).send({ action: 'late-checkout', lateTime: '01:00' }).expect(409);
    await manager.agent.post(path).send({ action: 'late-checkout', lateTime: '23:59' }).expect(409);
    await RoomNight.deleteOne({ _id: night.id });
    await manager.agent.post(path).send({ action: 'late-checkout', lateTime: '23:59' }).expect(200);
    await manager.agent.post(path).send({ action: 'late-checkout', lateTime: '23:59' }).expect(200);
    assert.equal((await Reservation.findById(active.id)).lateCheckoutTime, '23:59');
    assert.equal(await RoomNight.countDocuments({ room: unit.id, date: today, reservation: active.id }), 1);
  } finally {
    await Branch.updateOne({ _id: branch.id }, { $set: { timeZone: branch.timeZone } });
  }
});

test('manager relocation handles an overdue cross-category stay and preserves an audit of both rooms', async () => {
  const original = await Room.create({ branch: branch.id, type: type.id, number: 'MOVE-ORIGINAL', floor: 6, status: 'maintenance' });
  const replacementType = await RoomType.create({ branch: branch.id, slug: 'emergency-suite-test', name: 'Emergency fixture suite', capacity: 4, nightlyRate: 39900 });
  const replacement = await Room.create({ branch: branch.id, type: replacementType.id, number: 'MOVE-TARGET', floor: 6 });
  const stay = await deskFixture(original, 'checked-in', -4, -1);
  await RoomNight.create({ room: original.id, date: since(-2), reservation: stay.id });
  const arrival = await deskFixture(replacement, 'confirmed', 1, 3);
  const reserved = await RoomNight.create({ room: replacement.id, date: since(1), reservation: arrival.id });
  const path = property() + '/reservations/' + stay.reference + '/actions';
  const move = { action: 'reassign', room: replacement.id, note: 'Emergency pipe damage', newCheckout: since(2) };
  await manager.agent.post(path).send(move).expect(409);
  assert.equal((await Reservation.findById(stay.id)).room.toString(), original.id);
  assert.equal(await RoomNight.countDocuments({ room: replacement.id, reservation: stay.id }), 0);
  assert.ok(await RoomNight.exists({ _id: reserved.id }));
  await manager.agent.post(path).send({ ...move, newCheckout: since(1), note: undefined }).expect(409);
  await manager.agent.post(path).send({ ...move, newCheckout: since(1) }).expect(200);
  const moved = await Reservation.findById(stay.id);
  assert.equal(moved.room.toString(), replacement.id);
  assert.equal(moved.type.toString(), type.id);
  assert.equal(moved.total, 50000);
  assert.equal(await RoomNight.countDocuments({ room: original.id, reservation: stay.id }), 1);
  const log = await Audit.findOne({ resource: stay.reference, action: 'desk.room-moved' });
  assert.equal(log.relocation.from.toString(), original.id);
  assert.equal(log.relocation.to.toString(), replacement.id);
  assert.equal(log.relocation.reason, move.note);
  assert.equal(log.guest.toString(), guest.id);
});

test('pre-checkout partial settlements reject concurrent overpayment and retain deposit and refund history', async () => {
  const unit = await Room.create({ branch: branch.id, type: type.id, number: 'BILLING-TEST', floor: 6, status: 'occupied' });
  const stay = await deskFixture(unit, 'checked-in', -1, 1);
  const path = property() + '/reservations/' + stay.reference;
  const charge = (kind, amount, label, key = randomUUID()) => finance.agent.post(path + '/charges')
    .send({ kind, amount, label, requestKey: key });
  await charge('deposit', 4000, 'Check-in deposit').expect(201);
  await charge('room-service', 2000, 'Room service').expect(201);
  await charge('tax', 2000, 'Service tax').expect(201);
  await charge('tax', 2000, 'Duplicate tax').expect(409);
  const results = await Promise.all([charge('payment', 12000, 'Settlement A'), charge('payment', 12000, 'Settlement B')]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  await charge('refund', 20000, 'Excess refund').expect(409);
  await charge('refund', 1000, 'Deposit refund').expect(201);
  await manager.agent.post(path + '/actions').send({ action: 'check-out' }).expect(200);
  const invoice = await Invoice.findOne({ reservation: stay.id });
  assert.equal(invoice.subtotal, 24000);
  assert.equal(invoice.paid, 15000);
  assert.equal(invoice.balance, 9000);
  assert.equal(invoice.breakdown.deposits, 4000);
  assert.equal(invoice.breakdown.payments, 12000);
  assert.equal(invoice.breakdown.refunds, 1000);
});

test('financial reconciliation exports scoped immutable invoice and settlement history', async () => {
  const stay = await Reservation.findOne({ reference: ref });
  const original = await Invoice.findOne({ reservation: stay.id }).lean();
  const issued = original.createdAt.toISOString().slice(0, 10);
  const range = '?from=' + issued + '&through=' + since(0);
  const route = '/api/staff/properties/';
  const endpoint = '/finance/reconciliation';
  const path = route + branch.id + endpoint;
  await request(app).get(path + range).expect(401);
  await tech.agent.get(path + range + '&kind=invoices').expect(403);
  await finance.agent.get(route + other.id + endpoint + range + '&kind=invoices').expect(404);
  await finance.agent.get(path + '?from=2024-01-01&through=2026-01-01').expect(400);

  const result = (await finance.agent.get(path + range).expect(200)).body;
  const row = result.invoices.find((item) => item.reservation === ref);
  assert.equal(row.issuedTotal, original.subtotal);
  assert.equal(row.issuedPaid, original.paid);
  assert.deepEqual(row.movement, { payment: original.balance, refund: 500, credit: 500 });
  assert.equal(row.balance, 0);
  assert.equal(row.issueVariance, 0);
  assert.equal(result.totals[0].outstanding, result.invoices.reduce((sum, item) => sum + Math.max(item.balance, 0), 0));
  const invoices = await manager.agent.get(path + '/export' + range + '&kind=invoices')
    .expect('Content-Type', /text\/csv/).expect('Content-Disposition', /attachment/).expect(200);
  assert.ok(invoices.text.includes('"' + original.number + '","' + ref + '"'));
  const ledger = await admin.agent.get(path + '/export' + range + '&kind=settlements')
    .expect('Content-Type', /text\/csv/).expect(200);
  assert.ok(ledger.text.includes('"credit","GBP",500,"\'=Correct duplicate charge"'));
  const journal = await finance.agent.get(path + '/export' + range + '&kind=journal').expect(200);
  assert.ok(journal.text.includes('"' + ref + '","settlement","refund","GBP",500,-500,'));
  assert.ok(journal.text.includes('"' + ref + '","settlement","credit","GBP",500,,,500,'));
  assert.ok(journal.text.includes('"desk-entry","deposit","GBP",-4000,4000,'));
  assert.ok(journal.text.includes('"desk-entry","room-service","GBP",2000,,2000,'));
  assert.ok(journal.text.includes('"desk-entry","tax","GBP",2000,,2000,'));
  await finance.agent.get(route + other.id + endpoint + '/export' + range + '&kind=journal').expect(404);
  await tech.agent.get(path + '/export' + range + '&kind=invoices').expect(403);
  await finance.agent.get(route + other.id + endpoint + '/export' + range + '&kind=invoices').expect(404);

  const legacy = await Invoice.create({ reservation: new mongoose.Types.ObjectId(), branch: branch.id, number: 'LEGACY-RECON',
    currency: 'GBP', subtotal: 1400, paid: 1000, balance: 450, createdAt: new Date('2020-02-29T12:00:00Z') });
  const old = (await finance.agent.get(path + '?from=2020-02-29&through=2020-02-29').expect(200)).body;
  assert.equal(old.invoices.length, 1);
  assert.equal(old.invoices[0].legacyBreakdown, true);
  assert.equal(old.invoices[0].issueVariance, 50);
  assert.equal(old.invoices[0].balance, 450);
  assert.equal((await Invoice.findById(legacy.id)).balance, 450);
  assert.ok(old.invoices[0].exceptions.includes('reservation-missing-or-currency-mismatch'));
  const exceptions = await finance.agent.get(path + '/export?from=2020-02-29&through=2020-02-29&kind=exceptions').expect(200);
  assert.match(exceptions.text, /LEGACY-RECON.*issued-balance-variance/);
  assert.ok(await Audit.exists({ action: 'finance.export', resource: 'exceptions', actor: finance.id, branch: branch.id }));
  await guest.agent.get(path + '/export?from=2020-02-29&through=2020-02-29&kind=exceptions').expect(403);

  const legacyStay = await deskFixture(room, 'checked-out', -8, -6);
  const posting = new Date('2020-03-01T11:00:00Z');
  await Payment.create({ reservation: legacyStay.id, status: 'simulated-paid', method: 'simulation',
    currency: 'GBP', amount: 10000, createdAt: posting, updatedAt: posting });
  await Charge.create({ reservation: legacyStay.id, branch: branch.id, kind: 'restaurant', label: 'Dinner',
    amount: 500, createdBy: manager.id, requestKey: randomUUID(), createdAt: posting });
  const historical = await Invoice.create({ branch: branch.id, reservation: legacyStay.id, number: 'LEGACY-VALID',
    checkIn: legacyStay.checkIn, checkOut: legacyStay.checkOut, currency: 'GBP', subtotal: 22550, paid: 10000, balance: 12550,
    items: [{ label: 'Room · ' + legacyStay.checkIn + ' to ' + legacyStay.checkOut, amount: 20000 },
      { label: 'Dinner', amount: 500 }, { label: 'Property tax', amount: 2050 }], createdAt: new Date('2020-03-01T12:00:00Z') });
  const valid = (await finance.agent.get(path + '?from=2020-03-01&through=2020-03-01').expect(200)).body;
  assert.equal(valid.invoices[0].breakdownSource, 'reconstructed');
  assert.deepEqual(valid.invoices[0].issuedBreakdown, { room: 20000, fees: 500, tax: 2050, discounts: 0,
    payments: 10000, deposits: 0, refunds: 0 });
  assert.equal(valid.totals[0].recognizedRevenue, 20500);
  assert.equal(valid.totals[0].taxAtIssue, 2050);
  assert.equal(valid.totals[0].outstanding, 12550);
  assert.equal((await Invoice.findById(historical.id)).breakdown, undefined);
  assert.deepEqual(await Invoice.findById(original._id).lean(), original);
});

test('repeated competing settlement writes preserve every invoice and reject excess payments', async (t) => {
  const rounds = 10;
  const unit = await Room.create({ branch: branch.id, type: type.id, number: 'SETTLEMENT-RACE', floor: 8 });
  const invoices = [];
  for (let index = 0; index < rounds; index += 1) {
    const stay = await deskFixture(unit, 'checked-out', -4, -3);
    const invoice = await Invoice.create({ branch: branch.id, reservation: stay.id, number: 'RACE-' + index,
      subtotal: 10000, paid: 8000, balance: 2000, currency: 'GBP', createdAt: new Date(since(-3) + 'T12:00:00Z') });
    invoices.push({ reference: stay.reference, id: invoice.id });
  }
  const times = [];
  const statuses = [];
  const start = performance.now();
  for (const { reference } of invoices) {
    const path = property() + '/reservations/' + reference + '/settlement';
    await Promise.all([finance, manager].map(async ({ agent }) => {
      const begin = performance.now();
      const response = await agent.post(path).send({ kind: 'payment', amount: 2000, requestKey: randomUUID() });
      times.push(performance.now() - begin);
      statuses.push(response.status);
    }));
    await pause(process.env.LUXURYSTAY_EXTENDED_TEST === '1' ? 3000 : 250);
  }
  const elapsed = performance.now() - start;
  assert.deepEqual(statuses.filter((status) => status === 200).length, rounds);
  assert.deepEqual(statuses.filter((status) => status === 409).length, rounds);
  for (const { reference, id } of invoices) {
    const check = await finance.agent.get(property() + '/reservations/' + reference + '/settlement').expect(200);
    assert.equal(check.body.account.balance, 0);
    assert.equal(check.body.account.transactions.length, 1);
    assert.equal((await Invoice.findById(id)).balance, 2000);
  }
  const postingDay = since(0);
  const reportPath = property() + '/finance/reconciliation';
  const range = '?from=' + postingDay + '&through=' + postingDay;
  const journal = await finance.agent.get(reportPath + '/export' + range + '&kind=journal').expect(200);
  const cohort = await finance.agent.get(reportPath + range).expect(200);
  for (const { reference } of invoices) {
    assert.ok(journal.text.includes('"' + reference + '","settlement","payment","GBP",2000,2000,'));
    assert.ok(cohort.body.invoices.every((invoice) => invoice.reservation !== reference));
  }
  times.sort((a, b) => a - b);
  const percentile = (p) => Math.round(times[Math.ceil(times.length * p) - 1]);
  t.diagnostic('10 paired rounds, 2 concurrent staff, 20 writes: ' + rounds + ' accepted, ' + rounds +
    ' intended conflicts, 0 unexpected responses, ' + Math.round(elapsed) + ' ms elapsed; p50/p95/p99 ' +
    [percentile(.50), percentile(.95), percentile(.99)].join('/') + ' ms.');
});

test('local SMTP delivers account and operational email with queue dedupe and opt-out', async () => {
  const { createServer: createMailServer } = await import('node:net');
  const messages = [];
  const connections = new Set();
  const mail = createMailServer((socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 test-mail.local SMTP\r\n');
    let buffer = '';
    let message = null;
    socket.on('data', (data) => {
      buffer += data;
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (message !== null) {
          if (line === '.') {
            messages.push(message.replace(/=\r\n/g, ''));
            message = null;
            socket.write('250 accepted\r\n');
          } else message += line + '\r\n';
        } else if (line.startsWith('EHLO')) socket.write('250 test-mail.local\r\n');
        else if (line === 'DATA') {
          message = '';
          socket.write('354 message follows\r\n');
        } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  mail.listen(0, '127.0.0.1');
  await once(mail, 'listening');
  const variables = ['APP_ORIGIN', 'MAIL_FROM', 'SMTP_URL'];
  const prior = variables.map((key) => process.env[key]);
  process.env.APP_ORIGIN = 'https://hotel.example.test';
  process.env.MAIL_FROM = 'hotel@example.test';
  process.env.SMTP_URL = 'smtp://127.0.0.1:' + mail.address().port;
  try {
    const email = 'invited@example.test';
    await admin.agent.post('/api/staff/admin/team').send({
      name: 'Invited Staff', email, role: 'receptionist', branches: [branch.id]
    }).expect(202);
    const invite = messages[0]?.match(/\/account\/invite#([a-zA-Z0-9_-]{43})/)?.[1];
    assert.ok(invite, 'Invitation URL arrived through SMTP');
    await request(app).post('/api/account/invite/complete').send({ token: invite, password }).expect(200);
    const staff = await signIn(email, true);
    await request(app).post('/api/account/reset').send({ email }).expect(202);
    for (let attempt = 0; attempt < 15 && messages.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const reset = messages[1]?.match(/\/account\/reset#([a-zA-Z0-9_-]{43})/)?.[1];
    assert.ok(reset, 'Reset URL arrived through SMTP');
    await request(app).post('/api/account/reset/complete').send({ token: reset, password: password + '2' }).expect(200);
    await staff.agent.get('/api/auth/session').expect(401);
    const contact = 'local-transport@example.invalid';
    const booking = await manager.agent.post(property() + '/reservations').set('Idempotency-Key', randomUUID()).send({
      name: 'Mail Test Guest', email: contact, source: 'staff', type: type.slug, checkIn: since(80), checkOut: since(81), guests: 1
    }).expect(201);
    const reference = booking.body.reservation.reference;
    await drainMailQueue();
    await drainMailQueue();
    assert.equal(messages.filter((message) => message.includes(reference)).length, 1);
    assert.ok(messages.some((message) => message.includes(reference) && message.includes('confirmed')));
    assert.ok((await Audit.findOne({ action: 'booking.confirmed', resource: reference })).emailSent);
    const operationalGuest = await User.create({ name: 'Operational Mail Guest', email: 'operational@example.invalid',
      role: 'guest', passwordHash: await bcrypt.hash(password, 4) });
    const recipient = await signIn(operationalGuest.email);
    const mailType = await RoomType.create({ branch: branch.id, slug: 'mail-test', name: 'Mail test', capacity: 2, nightlyRate: 10000 });
    const mailRoom = await Room.create({ branch: branch.id, type: mailType.id, number: 'MAIL-TEST', floor: 8 });
    async function book(checkIn, checkOut) {
      const response = await manager.agent.post(property() + '/reservations').set('Idempotency-Key', randomUUID()).send({
        name: operationalGuest.name, email: operationalGuest.email, source: 'staff', type: mailType.slug, checkIn, checkOut, guests: 1
      }).expect(201);
      return response.body.reservation;
    }
    const future = await book(since(1), since(2));
    await syncReminders();
    await syncReminders();
    const futurePath = '/api/reservations/' + future.reference;
    await recipient.agent.put(futurePath + '/dates').send({
      checkIn: since(2), checkOut: since(3), revision: future.revision
    }).expect(200);
    await recipient.agent.post(futurePath + '/cancel').expect(200);
    const journal = await finance.agent.get(property() + '/finance/reconciliation/export')
      .query({ from: since(0), through: since(0), kind: 'journal' }).expect(200);
    assert.ok(journal.text.includes('"' + future.reference + '","booking-adjustment","cancellation-refund","GBP",-10000,-10000,'));

    const active = await book(since(0), since(1));
    const actions = property() + '/reservations/' + active.reference + '/actions';
    await manager.agent.post(actions).send({ action: 'verify' }).expect(200);
    await manager.agent.post(actions).send({ action: 'check-in' }).expect(200);
    const service = await recipient.agent.post('/api/guest/services').send({
      reference: active.reference, category: 'towels', description: 'Extra towels'
    }).expect(201);
    await manager.agent.post(property() + '/services/' + service.body.request._id).send({ status: 'in-progress' }).expect(200);
    await syncReminders(new Date(since(1) + 'T12:00:00Z'));
    const maintenanceRecipient = await User.create({ name: 'Operational Mail Technician', email: 'repairs@example.invalid',
      role: 'maintenance', branches: [branch.id], passwordHash: await bcrypt.hash(password, 4) });
    const issue = await manager.agent.post(property() + '/maintenance').send({
      room: mailRoom.id, summary: 'Inspect lamp', priority: 'normal', blocking: false
    }).expect(201);
    await manager.agent.post(property() + '/maintenance/' + issue.body.issue._id)
      .send({ action: 'assign', assigned: maintenanceRecipient.id }).expect(200);
    await manager.agent.post(actions).send({ action: 'check-out' }).expect(200);
    const issued = await Invoice.findOne({ number: { $exists: true }, reservation: (await Reservation.findOne({ reference: active.reference })).id });
    await finance.agent.post(property() + '/reservations/' + active.reference + '/settlement')
      .send({ kind: 'payment', amount: issued.balance, requestKey: randomUUID() }).expect(200);
    await drainMailQueue();
    await drainMailQueue();
    assert.ok((await Audit.findOne({ action: 'maintenance.assign', resource: issue.body.issue._id }))?.emailSent);
    assert.equal(messages.filter((message) => message.includes(maintenanceRecipient.email) && message.includes('Maintenance issue')).length, 1);
    for (const [action, resource, wording] of [
      ['booking.arrival-reminder', future.reference, 'is tomorrow'],
      ['booking.dates-changed', future.reference, 'Dates were updated'],
      ['booking.cancelled', future.reference, 'was cancelled'],
      ['desk.check-in', active.reference, '(check-in)'],
      ['booking.departure-reminder', active.reference, 'is today'],
      ['billing.payment', issued.number, 'recorded for ' + issued.number],
      ['desk.check-out', active.reference, '(check-out)'],
      ['service.in-progress', service.body.request._id, 'request is in-progress']
    ]) {
      assert.ok((await Audit.findOne({ action, resource }))?.emailSent, action);
      assert.equal(messages.filter((message) => message.includes(operationalGuest.email) && message.includes(wording)).length, 1, action);
    }
    await stranger.agent.put('/api/notifications').send({ bookingEmail: false }).expect(204);
    const suppressed = await Audit.create({ branch: branch.id, guest: stranger.id,
      action: 'desk.room-moved', resource: 'SUPPRESSED', email: contact, message: 'Opt-out fixture' });
    await drainMailQueue();
    assert.equal(messages.some((message) => message.includes('Opt-out fixture')), false);
    assert.ok((await Audit.findById(suppressed.id)).emailSuppressedAt);
  } finally {
    variables.forEach((key, index) => {
      if (prior[index] === undefined) delete process.env[key];
      else process.env[key] = prior[index];
    });
    for (const connection of connections) connection.destroy();
    await new Promise((resolve) => mail.close(resolve));
  }
});

test('repeated package claims, confirmation and cancellation release each hold and reconcile payment', async (t) => {
  const category = await RoomType.create({ branch: branch.id, slug: 'package-race', name: 'Package race', nightlyRate: 10000, capacity: 2 });
  await Room.create(['A', 'B'].map((number) => ({ branch: branch.id, type: category.id, number: 'PACKAGE-' + number, floor: 9 })));
  const { body } = await manager.agent.post(property() + '/offers').send({
    type: category.id, title: 'Package concurrency fixture', description: 'One use despite two available rooms.',
    services: ['Breakfast'], restrictions: 'One use at a time', bookStart: since(-1), bookEnd: since(1), stayStart: since(95), stayEnd: since(100),
    minimumNights: 2, maxUses: 1, discountBps: 2000, published: true
  }).expect(201);
  const booking = { branch: branch.slug, type: category.slug, checkIn: since(95), checkOut: since(97), guests: 1, offer: body.offer._id };
  const people = [guest, stranger];
  const times = [];
  const started = performance.now();
  async function measured(call) {
    const begin = performance.now();
    const response = await call;
    times.push(performance.now() - begin);
    return response;
  }
  for (let round = 0; round < 8; round += 1) {
    const results = await Promise.all(people.map(({ agent }) => measured(agent.post('/api/reservations/holds')
      .set('Idempotency-Key', randomUUID()).send(booking))));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    const winner = results.findIndex((result) => result.status === 201);
    const reference = results[winner].body.reservation.reference;
    const path = '/api/reservations/' + reference;
    assert.equal((await measured(people[winner].agent.post(path + '/confirm').send({ payment: 'simulation' }))).status, 200);
    assert.equal((await measured(people[winner].agent.post(path + '/cancel'))).status, 200);
    const saved = await Reservation.findOne({ reference });
    assert.equal(saved.status, 'cancelled');
    assert.equal((await Payment.findOne({ reservation: saved.id })).amount, 16000);
    assert.equal((await BookingAdjustment.findOne({ reservation: saved.id, kind: 'cancellation-refund' })).delta, -16000);
    assert.equal(await RoomNight.countDocuments({ reservation: saved.id }), 0);
    await pause(process.env.LUXURYSTAY_EXTENDED_TEST === '1' ? 4000 : 1000);
  }
  const elapsed = performance.now() - started;
  times.sort((a, b) => a - b);
  const percentile = (p) => Math.round(times[Math.ceil(times.length * p) - 1]);
  t.diagnostic('8 repeated package rounds, 2 concurrent guests, 32 HTTP requests: 24 successes, 8 intended conflicts, ' +
    '0 unexpected responses, ' + Math.round(elapsed) + ' ms elapsed; p50/p95/p99 ' +
    [percentile(.50), percentile(.95), percentile(.99)].join('/') + ' ms.');
});

test('repeated competing relocations and cleaning starts preserve room and task state', async (t) => {
  const fixture = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const [first, second, target, cleanable] = await Room.create(['FIRST', 'SECOND', 'TARGET', 'CLEAN'].map((name) => ({
      branch: branch.id, type: type.id, number: 'MIXED-' + name + '-' + index, floor: 10,
      status: name === 'FIRST' || name === 'SECOND' ? 'maintenance' : name === 'CLEAN' ? 'dirty' : 'inspected'
    })));
    const stays = await Promise.all([first, second].map((room) => deskFixture(room, 'checked-in', -1, 1)));
    for (const [position, room] of [first, second].entries()) {
      await RoomNight.create([since(-1), since(0)].map((date) => ({ room: room.id, date, reservation: stays[position].id })));
    }
    const task = await Cleaning.create({ branch: branch.id, room: cleanable.id });
    return { stays, target, task };
  }));
  const times = [];
  const people = [manager, admin];
  const started = performance.now();
  async function write(person, path, body) {
    const begin = performance.now();
    const response = await person.agent.post(path).send(body);
    times.push(performance.now() - begin);
    return response.status;
  }
  for (const { stays, target, task } of fixture) {
    const relocations = await Promise.all(stays.map((stay, index) => write(people[index],
      property() + '/reservations/' + stay.reference + '/actions', { action: 'reassign', room: target.id })));
    assert.deepEqual(relocations.sort(), [200, 409]);
    assert.equal(await Reservation.countDocuments({ room: target.id, status: 'checked-in' }), 1);
    assert.equal(await RoomNight.countDocuments({ room: target.id, date: since(0) }), 1);
    assert.equal((await Room.findById(target.id)).status, 'occupied');
    const starts = await Promise.all(people.map((person) => write(person,
      property() + '/cleaning/' + task.id, { action: 'start' })));
    assert.deepEqual(starts.sort(), [200, 409]);
    assert.equal((await Cleaning.findById(task.id)).status, 'in-progress');
    assert.equal(await Audit.countDocuments({ action: 'cleaning.start', resource: task.id }), 1);
    await pause(process.env.LUXURYSTAY_EXTENDED_TEST === '1' ? 4000 : 1000);
  }
  const elapsed = performance.now() - started;
  times.sort((a, b) => a - b);
  const percentile = (p) => Math.round(times[Math.ceil(times.length * p) - 1]);
  t.diagnostic('5 mixed relocation and cleaning rounds, 2 concurrent managers, 20 HTTP writes: 10 successes, ' +
    '10 intended conflicts, 0 unexpected responses, ' + Math.round(elapsed) + ' ms elapsed; p50/p95/p99 ' +
    [percentile(.50), percentile(.95), percentile(.99)].join('/') + ' ms.');
});
