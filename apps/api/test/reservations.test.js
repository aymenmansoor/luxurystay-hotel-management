import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connect, localUri } from '../src/db.js';
import { Branch, Room, RoomType, User } from '../src/models.js';
import { BookingAdjustment, Payment, Reservation, RoomNight } from '../src/reservation-models.js';

const app = createApp();
const password = 'test-reservation-password';
const database = 'luxurystay_test_' + randomUUID().replaceAll('-', '');
let branch;
let otherBranch;
let room;
let guests;
let receptionist;

function date(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}
const stay = (start, end, type = 'king') => ({
  branch: 'demo', type, checkIn: date(start), checkOut: date(end), guests: 2
});

async function signIn(email, staff = false) {
  const agent = request.agent(app);
  await agent.post('/api/auth/' + (staff ? 'staff/login' : 'login')).send({ email, password }).expect(200);
  return agent;
}
const holds = (guest, input, key = randomUUID()) => guest.post('/api/reservations/holds').set('Idempotency-Key', key).send(input);
const reservations = '/api/reservations/';
const confirm = (guest, ref) => guest.post(reservations + ref + '/confirm').send({ payment: 'simulation' });
async function available(input) {
  const response = await request(app).get('/api/availability').query(input).expect(200);
  return response.body.roomTypes.find((type) => type.slug === input.type)?.availableRooms ?? 0;
}

before(async () => {
  await connect(process.env.TEST_MONGODB_URI ?? localUri, { dbName: database });
  branch = await Branch.create({ slug: 'demo', name: 'Demo Hotel', city: 'London', currency: 'GBP', timeZone: 'Europe/London' });
  otherBranch = await Branch.create({ slug: 'other', name: 'Other Hotel', city: 'Paris', currency: 'EUR', timeZone: 'Europe/Paris' });
  const king = await RoomType.create({ branch: branch.id, slug: 'king', name: 'King', nightlyRate: 24000, capacity: 2 });
  const suite = await RoomType.create({ branch: branch.id, slug: 'suite', name: 'Suite', nightlyRate: 48000, capacity: 4 });
  room = await Room.create({ branch: branch.id, type: king.id, number: '101', floor: 1 });
  await Room.create([
    { branch: branch.id, type: suite.id, number: '201', floor: 2 },
    { branch: branch.id, type: suite.id, number: '202', floor: 2 },
    { branch: branch.id, type: suite.id, number: '203', floor: 2, status: 'maintenance' }
  ]);
  const passwordHash = await bcrypt.hash(password, 4);
  const emails = ['a@example.test', 'b@example.test', 'c@example.test'];
  await User.insertMany(emails.map((email) => ({ name: email, email, role: 'guest', passwordHash })));
  await User.create({ name: 'Staff', email: 'staff@example.test', role: 'receptionist', branches: [branch.id], passwordHash });
  guests = await Promise.all(emails.map((email) => signIn(email)));
  receptionist = await signIn('staff@example.test', true);
});

after(async () => {
  try {
    if (mongoose.connection.name === database && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

test('concurrent overlapping requests for the only room yield one hold and one conflict', async () => {
  const [first, second] = guests;
  const input = stay(5, 8);
  assert.equal(await available(input), 1);
  const results = await Promise.all([holds(first, input), holds(second, input)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await RoomNight.countDocuments({ room: room.id, date: { $gte: input.checkIn, $lt: input.checkOut } }), 3);
  assert.equal(await available(input), 0);
  const calendar = await request(app).get('/api/availability/calendar')
    .query({ branch: input.branch, type: input.type, guests: 2, start: date(5), days: 4 }).expect(200);
  assert.deepEqual(calendar.body.days.map((day) => day.availableRooms), [0, 0, 0, 1]);
  assert.equal(await available(stay(8, 10)), 1);
  await holds(guests[2], stay(8, 10)).expect(201);
});

test('category availability counts physical rooms and excludes maintenance rooms', async () => {
  const input = stay(9, 12, 'suite');
  assert.equal(await available(input), 2);
  const outcomes = await Promise.all(guests.map((guest) => holds(guest, input)));
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [201, 201, 409]);
  assert.equal(await available(input), 0);
});

test('hold and simulated payment retries are idempotent and require ownership', async () => {
  const [guest, stranger] = guests;
  const input = stay(15, 17);
  const key = randomUUID();
  const attempts = await Promise.all([holds(guest, input, key), holds(guest, input, key)]);
  assert.deepEqual(attempts.map((result) => result.status), [201, 201]);
  const ref = attempts[0].body.reservation.reference;
  assert.equal(attempts[1].body.reservation.reference, ref);
  await holds(guest, { ...input, guests: 1 }, key).expect(409);
  await stranger.get(reservations + ref).expect(404);
  await confirm(stranger, ref).expect(404);
  await stranger.post(reservations + ref + '/cancel').expect(404);
  const results = await Promise.all([confirm(guest, ref), confirm(guest, ref)]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.ok(results.every((result) => result.body.reservation.paymentStatus === 'simulated-paid'));
  const saved = await Reservation.findOne({ reference: ref });
  assert.equal(await Payment.countDocuments({ reservation: saved.id }), 1);
  assert.equal(await RoomNight.countDocuments({ reservation: saved.id, expiresAt: null }), 2);
  const scoped = await receptionist.get('/api/staff/branches/' + branch.id + '/reservations').expect(200);
  const row = scoped.body.reservations.find((item) => item.reference === ref);
  assert.equal(row.room, '101');
  await receptionist.get('/api/staff/branches/' + otherBranch.id + '/reservations').expect(404);
  await receptionist.get('/api/reservations').expect(403);
});

test('expired nights can be reclaimed atomically and old holds cannot confirm or release new holds', async () => {
  const [guest, next] = guests;
  const input = stay(20, 23);
  const first = await holds(guest, input).expect(201);
  const ref = first.body.reservation.reference;
  const old = await Reservation.findOne({ reference: ref });
  const expiredAt = new Date(Date.now() - 1000);
  await Reservation.updateOne({ _id: old.id }, { expiresAt: expiredAt });
  await RoomNight.updateMany({ reservation: old.id }, { expiresAt: expiredAt });
  assert.equal((await guest.get(reservations + ref).expect(200)).body.reservation.status, 'expired');
  assert.equal(await available(input), 1);
  const second = await holds(next, input).expect(201);
  await confirm(guest, ref).expect(409);
  await guest.post(reservations + ref + '/cancel').expect(200);
  await confirm(next, second.body.reservation.reference).expect(200);
  assert.equal(await available(input), 0);
});

test('date changes are atomic, preserve pricing, and cancellation releases inventory', async () => {
  const [guest, other] = guests;
  const initial = stay(31, 34);
  const created = await holds(guest, initial).expect(201);
  const ref = created.body.reservation.reference;
  await confirm(guest, ref).expect(200);
  const conflict = stay(35, 37);
  await holds(other, conflict).expect(201);
  const path = reservations + ref + '/dates';
  const stored = await Reservation.findOne({ reference: ref });
  const originalPayment = await Payment.findOne({ reservation: stored.id }).lean();
  await guest.put(path).send({ checkIn: date(32), checkOut: date(36), revision: 0 }).expect(409);
  assert.equal((await guest.get(reservations + ref).expect(200)).body.reservation.checkIn, initial.checkIn);
  const changed = { checkIn: date(32), checkOut: date(34), revision: 0 };
  const response = await guest.put(path).send(changed).expect(200);
  assert.equal(response.body.reservation.revision, 1);
  const adjustment = await BookingAdjustment.findOne({ reservation: stored.id, kind: 'date-change' });
  assert.equal(adjustment.delta, -stored.nightlyRate);
  await guest.put(path).send(changed).expect(200);
  await guest.put(path).send({ ...changed, checkIn: date(33) }).expect(409);
  assert.equal(await available(stay(31, 32)), 1);
  assert.equal(await available(stay(33, 34)), 0);
  assert.equal(await available(stay(34, 35)), 1);
  const result = await guest.post(reservations + ref + '/cancel').expect(200);
  assert.equal(result.body.reservation.paymentStatus, 'simulated-refunded');
  await guest.post(reservations + ref + '/cancel').expect(200);
  assert.deepEqual(await Payment.findById(originalPayment._id).lean(), originalPayment);
  assert.equal(await BookingAdjustment.countDocuments({ reservation: stored.id, kind: 'cancellation-refund' }), 1);
  const refund = await BookingAdjustment.findOne({ reservation: stored.id, kind: 'cancellation-refund' });
  assert.equal(refund.delta, -2 * stored.nightlyRate);
  assert.equal(await available(stay(32, 35)), 1);
});

test('concurrent holds from one account cannot exceed its active-hold quota', async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  await User.create({ name: 'Quota fixture', email: 'quota@example.test', role: 'guest', passwordHash });
  const guest = await signIn('quota@example.test');
  const requests = await Promise.all([50, 52, 54, 56, 58, 60].map((start) => holds(guest, stay(start, start + 1))));
  assert.equal(requests.filter((result) => result.status === 201).length, 5);
  const rejected = requests.findIndex((result) => result.status === 409);
  assert.ok(rejected >= 0);
  assert.match(requests[rejected].body.error, /Release a room hold/);
  const held = requests.find((result) => result.status === 201).body.reservation;
  await guest.post(reservations + held.reference + '/cancel').expect(200);
  const start = 50 + rejected * 2;
  await holds(guest, stay(start, start + 1)).expect(201);
});
