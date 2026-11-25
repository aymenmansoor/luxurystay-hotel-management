import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { Branch, Room, RoomType, User } from './models.js';
import { BookingAdjustment, Payment, Reservation, RoomNight } from './reservation-models.js';

import { Offer } from './offer-model.js';
import { event } from './operations-models.js';

const holdMinutes = Number(process.env.BOOKING_HOLD_MINUTES ?? 15);
if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 30) {
  throw new Error('BOOKING_HOLD_MINUTES must be between 1 and 30.');
}
const holdDuration = holdMinutes * 60_000;
const guestHoldLimit = 5;
const day = 24 * 60 * 60 * 1000;
const bookableRoom = { status: { $nin: ['maintenance', 'out-of-service'] } };

export class BookingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function localDay(timeZone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function localTime(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function stayDates(input, branch, { allowPast = false } = {}) {
  const start = Date.parse(input.checkIn);
  const count = (Date.parse(input.checkOut) - start) / day;
  if (!Number.isInteger(count) || count < 1 || count > 30 || (!allowPast && input.checkIn < localDay(branch.timeZone))) {
    throw new BookingError(400, 'Choose a stay of 1–30 nights starting today or later at the hotel.');
  }
  return Array.from({ length: count }, (_, index) => new Date(start + index * day).toISOString().slice(0, 10));
}

async function property(slug, session = null) {
  const branch = await Branch.findOne({ slug }).session(session);
  if (!branch) throw new BookingError(404, 'Hotel not found.');
  return branch;
}

function activeNights(roomIds, dates, now) {
  return { room: { $in: roomIds }, date: { $in: dates }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

function unavailable() {
  throw new BookingError(409, 'This offer is unavailable for the selected hotel, room or dates.');
}

async function offerQuote(branch, input, nights, session = null) {
  if (!input.offer) return null;
  const offer = await Offer.findOne({ _id: input.offer, branch: branch.id, published: true }).session(session);
  if (!offer) unavailable();
  const today = localDay(branch.timeZone);
  if (today < offer.bookStart || today > offer.bookEnd || input.checkIn < offer.stayStart ||
    input.checkOut > offer.stayEnd || nights < offer.minimumNights) unavailable();
  if (session) await Offer.updateOne({ _id: offer.id }, { $inc: { revision: 1 } }, { session });
  const used = await Reservation.countDocuments({ offer: offer.id, $or: [
    { status: { $in: ['confirmed', 'checked-in', 'checked-out', 'no-show'] } },
    { status: 'held', expiresAt: { $gt: new Date() } }
  ] }).session(session);
  if (used >= offer.maxUses) throw new BookingError(409, 'This offer has reached its booking limit.');
  return offer;
}

export async function availability(input) {
  const branch = await property(input.branch);
  const dates = stayDates(input, branch);
  const offer = await offerQuote(branch, input, dates.length);
  const types = await RoomType.find({ branch: branch.id, capacity: { $gte: input.guests }, ...(offer && { _id: offer.type }) })
    .select('slug name capacity nightlyRate').sort('name').lean();
  const sameDay = input.checkIn === localDay(branch.timeZone);
  const rooms = await Room.find({
    ...bookableRoom, branch: branch.id, type: { $in: types.map((type) => type._id) },
    ...(sameDay && { status: { $in: ['available', 'inspected'] } })
  }).select('type').lean();
  const busy = new Set((await RoomNight.distinct('room', activeNights(rooms.map((room) => room._id), dates, new Date()))).map(String));
  const counts = new Map();
  for (const room of rooms) {
    if (!busy.has(String(room._id))) {
      const type = String(room.type);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  return { branch: branch.slug, currency: branch.currency, nights: dates.length, offer: offer?.title, roomTypes: types.map((type) => {
    const nightlyRate = offer ? Math.round(type.nightlyRate * (10000 - offer.discountBps) / 10000) : type.nightlyRate;
    return { slug: type.slug, name: type.name, capacity: type.capacity, nightlyRate,
      total: nightlyRate * dates.length, availableRooms: counts.get(String(type._id)) ?? 0 };
  }) };
}

export async function availabilityCalendar(input) {
  const branch = await property(input.branch);
  const checkIn = input.start ?? localDay(branch.timeZone);
  const checkOut = new Date(Date.parse(checkIn) + input.days * day).toISOString().slice(0, 10);
  const dates = stayDates({ checkIn, checkOut }, branch);
  const type = await RoomType.findOne({ branch: branch.id, slug: input.type, capacity: { $gte: input.guests } });
  if (!type) throw new BookingError(404, 'This room category is unavailable for your party.');
  const rooms = await Room.find({ ...bookableRoom, branch: branch.id, type: type.id }).select('status').lean();
  const alloc = await RoomNight.find(activeNights(rooms.map((room) => room._id), dates, new Date())).select('room date').lean();
  const ready = rooms.filter((room) => ['available', 'inspected'].includes(room.status));
  const today = localDay(branch.timeZone);
  const roomIds = new Set(ready.map((room) => String(room._id)));
  return { days: dates.map((date) => ({
    date, availableRooms: (date === today ? ready.length : rooms.length) -
      alloc.filter((night) => night.date === date && (date !== today || roomIds.has(String(night.room)))).length
  })) };
}

async function ownedReservation(reference, guest, session = null) {
  const reservation = await Reservation.findOne({ reference, guest }).session(session);
  if (!reservation) throw new BookingError(404, 'Reservation not found.');
  return reservation;
}

function assertHold(reservation, now) {
  if (reservation.status !== 'held' || reservation.expiresAt <= now) {
    throw new BookingError(409, 'This hold has expired or closed. Check availability for a new hold.');
  }
}

export async function claimNights({ room, dates, reservation, expiry, now, session }) {
  for (const date of dates) {
    await RoomNight.updateOne({
      room, date, expiresAt: { $lte: now, $ne: null }
    }, { $set: { reservation, expiresAt: expiry }, $setOnInsert: { room, date } }, { upsert: true, session });
  }
}

function holdReplay(reservation, fingerprint) {
  if (reservation.requestFingerprint !== fingerprint) {
    throw new BookingError(409, 'This request key was already used with different stay details.');
  }
  return reservation;
}

export async function createHold(guest, input, requestKey, details = {}) {
  const fingerprint = JSON.stringify([input.branch, input.type, input.checkIn, input.checkOut, input.guests, ...(input.offer ? [input.offer] : [])]);
  try {
    return await mongoose.connection.transaction(async (session) => {
      const prior = await Reservation.findOne({ guest, requestKey }).session(session);
      if (prior) return holdReplay(prior, fingerprint);
      if (!details.createdBy) {
        await User.updateOne({ _id: guest }, { $inc: { bookingVersion: 1 } }, { session });
        const active = await Reservation.countDocuments({ guest, status: 'held', expiresAt: { $gt: new Date() } }).session(session);
        if (active >= guestHoldLimit) throw new BookingError(409, 'Release a room hold or finish checkout before starting another.');
      }
      const branch = await property(input.branch, session);
      const dates = stayDates(input, branch);
      const type = await RoomType.findOne({ branch: branch.id, slug: input.type, capacity: { $gte: input.guests } }).session(session);
      if (!type) throw new BookingError(409, 'This room category cannot accommodate your party at this hotel.');
      const offer = await offerQuote(branch, input, dates.length, session);
      if (offer && String(offer.type) !== type.id) throw new BookingError(409, 'This offer is for a different room category.');
      const nightlyRate = offer ? Math.round(type.nightlyRate * (10000 - offer.discountBps) / 10000) : type.nightlyRate;
      const now = new Date();
      const roomFilter = {
        ...bookableRoom, branch: branch.id, type: type.id,
        ...(input.checkIn === localDay(branch.timeZone, now) && { status: { $in: ['available', 'inspected'] } })
      };
      const rooms = await Room.find(roomFilter).sort('number').select('_id').session(session);
      const occupied = await RoomNight.distinct('room', activeNights(rooms.map((room) => room._id), dates, now)).session(session);
      const blocked = new Set(occupied.map(String));
      const candidate = rooms.find((room) => !blocked.has(room.id));
      if (!candidate) throw new BookingError(409, 'This room category is no longer available for these dates.');
      // A write on the candidate serializes allocators and concurrent changes to that room.
      await Room.updateOne({ ...roomFilter, _id: candidate.id }, { $inc: { allocationVersion: 1 } }, { session });
      const reservation = new Reservation({
        reference: 'LS-' + randomBytes(9).toString('hex').toUpperCase(),
        guest, branch: branch.id, type: type.id, room: candidate.id,
        checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests,
        status: 'held', expiresAt: new Date(now.getTime() + holdDuration),
        nightlyRate, total: dates.length * nightlyRate,
        ...(offer && { offer: offer.id, offerTerms: { title: offer.title, stayStart: offer.stayStart,
          stayEnd: offer.stayEnd, minimumNights: offer.minimumNights, discountBps: offer.discountBps, services: offer.services } }),
        currency: branch.currency, requestKey, requestFingerprint: fingerprint, ...details
      });
      await claimNights({ room: candidate.id, dates, reservation: reservation.id, expiry: reservation.expiresAt, now, session });
      return reservation.save({ session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await Reservation.findOne({ guest, requestKey });
    if (prior) return holdReplay(prior, fingerprint);
    throw new BookingError(409, 'This room category is no longer available for these dates.');
  }
}

export async function confirm(guest, reference, actor = guest) {
  return mongoose.connection.transaction(async (session) => {
    const reservation = await ownedReservation(reference, guest, session);
    if (reservation.status === 'confirmed') return reservation;
    const now = new Date();
    assertHold(reservation, now);
    const branch = await Branch.findById(reservation.branch).session(session);
    const today = localDay(branch.timeZone, now);
    if (reservation.checkIn < today) throw new BookingError(409, 'Check-in has passed. Start a new hold.');
    const filter = {
      _id: reservation.room, ...bookableRoom, type: reservation.type,
      ...(reservation.checkIn === today && { status: { $in: ['available', 'inspected'] } })
    };
    const updated = await Room.updateOne(filter, { $inc: { allocationVersion: 1 } }, { session });
    if (!updated.matchedCount) throw new BookingError(409, 'The hotel changed this room. Start a new hold.');
    const nights = (Date.parse(reservation.checkOut) - Date.parse(reservation.checkIn)) / day;
    const result = await RoomNight.updateMany({ reservation: reservation.id, expiresAt: { $gt: now } }, {
      $set: { expiresAt: null }
    }, { session });
    if (result.matchedCount !== nights) throw new BookingError(409, 'Your room hold is no longer active.');
    await Payment.create([{
      reservation: reservation.id, method: 'simulation', status: 'simulated-paid',
      amount: reservation.total, currency: reservation.currency
    }], { session });
    const profile = await User.findById(guest).select('email').session(session);
    await event({ branch: reservation.branch, actor, guest, action: 'booking.confirmed', resource: reference,
      message: 'Reservation ' + reference + ' confirmed with a simulated payment.',
      email: reservation.contactEmail ?? profile?.email }, session);
    reservation.status = 'confirmed';
    reservation.expiresAt = undefined;
    return reservation.save({ session });
  });
}

export async function bookingNetPaid(reservation, session = null) {
  const payment = await Payment.findOne({ reservation }).session(session);
  if (!payment || payment.status !== 'simulated-paid') return 0;
  const entries = await BookingAdjustment.find({ reservation }).select('delta').session(session).lean();
  return payment.amount + entries.reduce((sum, entry) => sum + entry.delta, 0);
}

export async function cancel(guest, reference, staffActor) {
  return mongoose.connection.transaction(async (session) => {
    const reservation = await ownedReservation(reference, guest, session);
    if (reservation.status === 'cancelled') return reservation;
    const branch = await Branch.findById(reservation.branch).session(session);
    if (reservation.status !== 'held' &&
      (reservation.status !== 'confirmed' || (!staffActor && reservation.checkIn <= localDay(branch.timeZone)))) {
      throw new BookingError(409, 'This reservation can no longer be cancelled online.');
    }
    await RoomNight.deleteMany({ reservation: reservation.id }, { session });
    const net = await bookingNetPaid(reservation.id, session);
    if (net > 0) await BookingAdjustment.create([{ reservation: reservation.id, actor: staffActor ?? guest,
      kind: 'cancellation-refund', delta: -net, currency: reservation.currency,
      revision: reservation.revision, reason: 'Refund of simulated booking payment on cancellation' }], { session });
    const profile = await User.findById(guest).select('email').session(session);
    await event({ branch: reservation.branch, actor: staffActor ?? guest, guest, action: 'booking.cancelled', resource: reference,
      message: 'Reservation ' + reference + ' was cancelled.', email: reservation.contactEmail ?? profile?.email }, session);
    reservation.status = 'cancelled';
    reservation.cancelledAt = new Date();
    reservation.expiresAt = undefined;
    return reservation.save({ session });
  });
}

export async function changeDates(guest, reference, input) {
  try {
    return await mongoose.connection.transaction(async (session) => {
      const reservation = await ownedReservation(reference, guest, session);
      const branch = await Branch.findById(reservation.branch).session(session);
      if (reservation.status !== 'confirmed' || reservation.checkIn <= localDay(branch.timeZone)) {
        throw new BookingError(409, 'This reservation can no longer be changed online.');
      }
      if (input.checkIn === reservation.checkIn && input.checkOut === reservation.checkOut) return reservation;
      if (input.revision !== reservation.revision) throw new BookingError(409, 'This reservation changed. Reload it before trying again.');
      const dates = stayDates(input, branch);
      if (reservation.offer && (input.checkIn < reservation.offerTerms.stayStart ||
        input.checkOut > reservation.offerTerms.stayEnd || dates.length < reservation.offerTerms.minimumNights)) {
        throw new BookingError(409, 'Revised dates must satisfy the original offer conditions.');
      }
      const priorDates = await RoomNight.distinct('date', { reservation: reservation.id }).session(session);
      const updated = await Room.updateOne({
        _id: reservation.room, ...bookableRoom, type: reservation.type,
        ...(input.checkIn === localDay(branch.timeZone) && { status: { $in: ['available', 'inspected'] } })
      }, { $inc: { allocationVersion: 1 } }, { session });
      if (!updated.matchedCount) throw new BookingError(409, 'This room is unavailable for the revised dates.');
      await claimNights({
        room: reservation.room, dates: dates.filter((date) => !priorDates.includes(date)),
        reservation: reservation.id, expiry: null, now: new Date(), session
      });
      await RoomNight.deleteMany({ reservation: reservation.id, date: { $nin: dates } }, { session });
      reservation.set({ checkIn: input.checkIn, checkOut: input.checkOut, total: dates.length * reservation.nightlyRate });
      reservation.revision += 1;
      const net = await bookingNetPaid(reservation.id, session);
      if (reservation.total !== net) await BookingAdjustment.create([{ reservation: reservation.id, actor: guest,
        kind: 'date-change', delta: reservation.total - net, currency: reservation.currency,
        revision: reservation.revision, reason: 'Simulated settlement for changed stay dates' }], { session });
      await event({ branch: reservation.branch, actor: guest, guest, action: 'booking.dates-changed', resource: reference,
        message: 'Dates were updated for reservation ' + reference + '.',
        email: reservation.contactEmail ?? (await User.findById(guest).select('email').session(session))?.email }, session);
      return reservation.save({ session });
    });
  } catch (error) {
    if (error.code === 11000) throw new BookingError(409, 'This room is unavailable for the revised dates. Your original stay was kept.');
    throw error;
  }
}

export async function serializeReservations(reservations, { staff = false } = {}) {
  const refs = reservations.map((reservation) => reservation._id);
  await Reservation.populate(reservations, [
    { path: 'branch', select: 'name slug timeZone' }, { path: 'type', select: 'name slug' },
    ...(staff ? [{ path: 'room', select: 'number' }, { path: 'guest', select: 'name email' }] : [])
  ]);
  const payments = new Map((await Payment.find({ reservation: { $in: refs } }).lean()).map((payment) => [String(payment.reservation), payment.status]));
  const refunded = new Set((await BookingAdjustment.distinct('reservation', {
    reservation: { $in: refs }, kind: 'cancellation-refund'
  })).map(String));
  const now = new Date();
  return reservations.map((item) => ({
    reference: item.reference, branch: item.branch?.name, branchSlug: item.branch?.slug, roomType: item.type?.name, roomTypeSlug: item.type?.slug,
    checkIn: item.checkIn, checkOut: item.checkOut, guests: item.guests,
    status: item.status === 'held' && item.expiresAt <= now ? 'expired' : item.status,
    expiresAt: item.expiresAt, nightlyRate: item.nightlyRate, total: item.total, currency: item.currency,
    paymentStatus: refunded.has(String(item._id)) ? 'simulated-refunded' : payments.get(String(item._id)) ?? 'unpaid',
    revision: item.revision, offer: item.offerTerms?.title ? item.offerTerms : undefined,
    canChange: item.status === 'confirmed' && !!item.branch && item.checkIn > localDay(item.branch.timeZone, now),
    ...(staff && { room: item.room?.number, guest: item.contactName ?? item.guest?.name, email: item.contactEmail ?? item.guest?.email, source: item.source })
  }));
}
