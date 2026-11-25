import { invoiceTotals } from './invoice-totals.js';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { Branch, Room, RoomType, User } from './models.js';
import { Audit, Charge, Cleaning, Invoice, event } from './operations-models.js';
import { Reservation, RoomNight } from './reservation-models.js';
import { invoiceAccount, settle } from './settlement.js';
import { earnStay } from './loyalty.js';
import { BookingError, bookingNetPaid, cancel, claimNights, confirm, createHold, localDay, localTime, serializeReservations, stayDates } from './reservation-service.js';

export const deskRoles = ['super-admin', 'branch-manager', 'receptionist'];
export const managers = ['super-admin', 'branch-manager'];
export const staffRoles = [...deskRoles, 'housekeeping', 'maintenance', 'finance'];
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid resource ID.');
export const reference = z.string().trim().regex(/^LS-[A-F0-9]{18}$/, 'Enter a valid reservation reference.');
export const dates = z.object({ checkIn: z.iso.date(), checkOut: z.iso.date() });

export function scope(user) {
  return user.role === 'super-admin' ? {} : { _id: { $in: user.branches } };
}

export async function scopedBranch(req, _res, next) {
  const id = objectId.parse(req.params.branchId);
  const filter = scope(req.user);
  const branch = await Branch.findOne({ $and: [{ _id: id }, filter] });
  if (!branch) throw new BookingError(404, 'Property not found.');
  req.branch = branch;
  next();
}

export function conflict(message) {
  throw new BookingError(409, message);
}

async function stay(req, session = null) {
  const row = await Reservation.findOne({ branch: req.branch.id, reference: reference.parse(req.params.reference) }).session(session);
  if (!row) throw new BookingError(404, 'Reservation not found.');
  return row;
}

async function statement(row, room, branch, session) {
  const guest = await User.findById(row.guest).select('name').session(session);
  const charges = await Charge.find({ reservation: row.id }).sort('createdAt').session(session);
  const bookingPaid = await bookingNetPaid(row.id, session);
  return { reservation: row.id, branch: row.branch, number: 'INV-' + row.reference.slice(3), currency: row.currency,
    issuedTo: row.contactName ?? guest?.name, roomNumber: room.number, checkIn: row.checkIn, checkOut: row.checkOut,
    ...invoiceTotals(row, charges, bookingPaid, branch.taxBps) };

}

async function deskEvent(req, row, action, message, session) {
  const email = ['desk.check-in', 'desk.check-out', 'desk.no-show', 'desk.extend', 'desk.late-checkout'].includes(action)
    ? row.contactEmail ?? (await User.findById(row.guest).select('email').session(session))?.email : undefined;
  await event({ branch: req.branch.id, guest: row.guest, actor: req.user.id, action, resource: row.reference, message, email }, session);
}

export const desk = Router();
desk.use('/properties/:branchId', authenticate, allowRoles(...staffRoles), scopedBranch);
const path = '/properties/:branchId';
const reservationPath = path + '/reservations/:reference';

desk.post(path + '/reservations', allowRoles(...deskRoles), async (req, res) => {
  const key = z.uuid().parse(req.get('Idempotency-Key'));
  const input = dates.extend({
    type: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), guests: z.number().int().min(1).max(50),
    name: z.string().trim().min(2).max(120), email: z.email().trim().toLowerCase().optional(),
    source: z.enum(['staff', 'walk-in']), holdOnly: z.boolean().default(false)
  }).parse(req.body);
  const identity = createHash('sha256').update(req.user.id + ':' + key).digest('hex');
  const ledgerKey = identity.slice(0, 32);
  const previous = await Reservation.findOne({ createdBy: req.user.id, requestKey: ledgerKey });
  const details = { createdBy: req.user.id, source: input.source, contactName: input.name, contactEmail: input.email };
  if (previous && (String(previous.branch) !== req.branch.id || previous.source !== input.source ||
    previous.contactName !== input.name || previous.contactEmail !== input.email)) conflict('This request key was already used.');
  const profile = previous ? await User.findById(previous.guest) :
    (input.email && await User.findOne({ email: input.email, role: 'guest', active: true })) ??
    await User.findOneAndUpdate({ email: identity + '@walkin.luxurystay.test' }, { $setOnInsert: {
      name: input.name, passwordHash: 'disabled-walk-in-' + randomBytes(32).toString('hex'), role: 'guest', active: false
    } }, { upsert: true, returnDocument: 'after' });
  const hold = await createHold(profile.id, { ...input, branch: req.branch.slug }, ledgerKey, details);
  const row = input.holdOnly ? hold : await confirm(profile.id, hold.reference, req.user.id);
  const [reservation] = await serializeReservations([row], { staff: true });
  res.status(201).json({ reservation });
});

desk.get(path + '/invoices', allowRoles(...managers, 'finance'), async (req, res) => {
  const invoices = await Invoice.find({ branch: req.branch.id }).populate('reservation', 'reference')
    .sort({ createdAt: -1 }).limit(50);
  const accounts = await Promise.all(invoices.map(async (invoice) => ({
    ...(await invoiceAccount(invoice)), reference: invoice.reservation?.reference, issuedTo: invoice.issuedTo,
    issuedAt: invoice.createdAt
  })));
  res.json({ invoices: accounts.filter((item) => item.reference) });
});

desk.get(reservationPath, allowRoles(...deskRoles, 'finance'), async (req, res) => {
  const row = await stay(req);
  if (row.status === 'held' && !row.createdBy) throw new BookingError(404, 'Reservation not found.');
  const [reservation] = await serializeReservations([row], { staff: true });
  const charges = await Charge.find({ reservation: row.id }).select('label kind amount createdAt createdBy').lean();
  const invoice = await Invoice.findOne({ reservation: row.id });
  res.json({ reservation: { ...reservation, verifiedAt: row.verifiedAt, keysIssued: row.keysIssued, deskNotes: row.deskNotes, lateCheckoutTime: row.lateCheckoutTime },
    charges, invoice: Boolean(invoice) });
});

desk.post(reservationPath + '/actions', allowRoles(...deskRoles), async (req, res) => {
  const input = z.object({
    action: z.enum(['verify', 'key', 'note', 'check-in', 'check-out', 'reassign', 'extend', 'guest-count', 'cancel', 'confirm-hold', 'no-show', 'late-checkout']),
    note: z.string().trim().min(1).max(500).optional(),
    lateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    room: objectId.optional(), newCheckout: z.iso.date().optional(), guests: z.number().int().min(1).max(50).optional()
  }).parse(req.body);
  if (input.action === 'confirm-hold') {
    const row = await stay(req);
    if (!row.createdBy) throw new BookingError(404, 'Staff hold not found.');
    const confirmed = await confirm(row.guest, row.reference, req.user.id);
    return res.json({ status: confirmed.status });
  }
  if (input.action === 'cancel') {
    const row = await stay(req);
    if (row.status === 'held' && !row.createdBy) throw new BookingError(404, 'Staff hold not found.');
    const cancelled = await cancel(row.guest, row.reference, req.user.id);
    return res.json({ status: cancelled.status });
  }
  try {
    const outcome = await mongoose.connection.transaction(async (session) => {
      const row = await stay(req, session);
      const room = await Room.findById(row.room).session(session);
      const today = localDay(req.branch.timeZone);
      const { action } = input;
      if (action === 'check-in' && row.status === 'checked-in') return row.status;
      if (action === 'check-out' && row.status === 'checked-out') return row.status;
      if (action === 'no-show' && row.status === 'no-show') return row.status;
      if (!['confirmed', 'checked-in'].includes(row.status)) conflict('This reservation is closed.');
      if (action === 'no-show') {
        if (row.status !== 'confirmed' || row.checkIn >= today) conflict('A no-show can only be recorded after the local arrival day.');
        row.status = 'no-show';
        row.noShowAt = new Date();
        await RoomNight.deleteMany({ reservation: row.id, date: { $gte: today } }, { session });
      }
      if (action === 'late-checkout') {
        const clock = localTime(req.branch.timeZone);
        if (row.status !== 'checked-in' || row.checkOut !== today || !input.lateTime ||
            input.lateTime <= (req.branch.checkOutTime || '11:00') || input.lateTime <= clock) {
          conflict('Choose a later time today, after the property checkout time and the current local time.');
        }
        await Room.updateOne({ _id: room.id }, { $inc: { allocationVersion: 1 } }, { session });
        const arrival = await RoomNight.exists({ room: room.id, date: today, reservation: { $ne: row.id },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).session(session);
        if (arrival) conflict('This room has an arrival allocation today. Resolve it before approving late checkout.');
        if (!await RoomNight.exists({ room: room.id, date: today, reservation: row.id }).session(session)) {
          await claimNights({ room: room.id, dates: [today], reservation: row.id, expiry: null, now: new Date(), session });
        }
        row.lateCheckoutTime = input.lateTime;
      }
      if (action === 'verify') row.verifiedAt ??= new Date();
      if (action === 'key') {
        if (row.status !== 'checked-in' || row.keysIssued >= 20) conflict('Keys can be issued to checked-in stays, up to twenty per reservation.');
        row.keysIssued += 1;
      }
      if (action === 'note') {
        if (!input.note || row.deskNotes.length >= 30) conflict('Enter a note. Up to 30 notes are supported per stay.');
        row.deskNotes.push({ text: input.note, actor: req.user.id, at: new Date() });
      }
      if (action === 'guest-count') {
        const type = await RoomType.findById(room.type).session(session);
        if (!input.guests || input.guests > type.capacity) conflict('Guest count must fit the assigned room category.');
        row.guests = input.guests;
      }
      if (action === 'reassign') {
        const relocating = row.status === 'checked-in' && room.status === 'maintenance';
        if ((!relocating && row.status !== 'confirmed') || !input.room) conflict('Choose a room before arrival or relocate a blocked occupied room.');
        const replacement = await Room.findOne({ _id: input.room, branch: row.branch,
          status: relocating ? { $in: ['available', 'inspected'] } : { $nin: ['maintenance', 'out-of-service'] } }).session(session);
        if (!replacement) conflict('Choose a bookable replacement room.');
        if (replacement.id === room.id) return row.status;
        const crossCategory = String(replacement.type) !== String(row.type);
        const overdue = row.checkOut <= today;
        if (crossCategory && (!relocating || !managers.includes(req.user.role) || !input.note)) {
          conflict('Cross-category emergency moves require manager approval and a reason.');
        }
        if (overdue && (!relocating || !managers.includes(req.user.role) || !input.note || !input.newCheckout || input.newCheckout <= today)) {
          conflict('Overdue emergency moves require management approval, a reason and a new checkout date.');
        }
        if (crossCategory) {
          const replacementType = await RoomType.findById(replacement.type).session(session);
          if (!replacementType || replacementType.capacity < row.guests) conflict('The replacement room cannot accommodate the guest party.');
        }
        const oldCheckout = row.checkOut;
        const checkout = overdue ? input.newCheckout : row.checkOut;
        if (row.offer && checkout > row.offerTerms.stayEnd) conflict('The replacement dates exceed the booked package window.');
        const nights = stayDates({ checkIn: row.checkIn < today ? today : row.checkIn, checkOut: checkout }, req.branch);
        await Room.updateOne({ _id: replacement.id }, { $inc: { allocationVersion: 1 } }, { session });
        await claimNights({ room: replacement.id, dates: nights, reservation: row.id, expiry: null, now: new Date(), session });
        await RoomNight.deleteMany({ reservation: row.id, room: room.id, date: { $gte: today } }, { session });
        if (relocating) {
          replacement.status = 'occupied';
          await replacement.save({ session });
        }
        if (overdue) {
          const extra = stayDates({ checkIn: oldCheckout, checkOut: checkout }, req.branch, { allowPast: true });
          row.total += extra.length * row.nightlyRate;
          row.checkOut = checkout;
          row.lateCheckoutTime = undefined;
        }
        row.room = replacement.id;
        const guest = await User.findById(row.guest).select('email').session(session);
        await event({ branch: row.branch, guest: row.guest, actor: req.user.id, action: 'desk.room-moved',
          resource: row.reference, message: 'Your room assignment for reservation ' + row.reference + ' changed. Please contact the property front desk.',
          email: row.contactEmail ?? guest?.email, relocation: { from: room.id, to: replacement.id, fromNumber: room.number,
            toNumber: replacement.number, reason: input.note || (relocating ? 'Emergency maintenance' : 'Front desk reassignment'),
            oldCheckout, newCheckout: checkout } }, session);
      }
      if (action === 'extend') {
        if (!input.newCheckout || input.newCheckout <= row.checkOut || input.newCheckout <= today) conflict('Choose a later checkout date.');
        if (['maintenance', 'out-of-service'].includes(room.status)) conflict('The room is blocked.');
        if (row.offer && input.newCheckout > row.offerTerms.stayEnd) conflict('The extension is outside the booked package window.');
        const nights = stayDates({ checkIn: row.checkOut, checkOut: input.newCheckout }, req.branch, { allowPast: row.status === 'checked-in' });
        await Room.updateOne({ _id: room.id }, { $inc: { allocationVersion: 1 } }, { session });
        await claimNights({ room: room.id, dates: nights, reservation: row.id, expiry: null, now: new Date(), session });
        row.checkOut = input.newCheckout;
        row.lateCheckoutTime = undefined;
        row.total += nights.length * row.nightlyRate;
      }
      if (action === 'check-in') {
        if (row.status !== 'confirmed' || !row.verifiedAt || today >= row.checkOut) conflict('Verify the guest and check in within a valid stay.');
        if (!['available', 'inspected', 'reserved'].includes(room.status)) conflict('The assigned room is not ready.');
        if (today < row.checkIn) {
          if (row.offer && today < row.offerTerms.stayStart) conflict('Early arrival is outside the booked package window.');
          const nights = stayDates({ checkIn: today, checkOut: row.checkIn }, req.branch);
          await claimNights({ room: room.id, dates: nights, reservation: row.id, expiry: null, now: new Date(), session });
          row.checkIn = today;
          row.total += nights.length * row.nightlyRate;
        }
        row.status = 'checked-in';
        row.checkedInAt = new Date();
        room.status = 'occupied';
        room.allocationVersion = (room.allocationVersion ?? 0) + 1;
        await room.save({ session });
      }
      if (action === 'check-out') {
        if (row.status !== 'checked-in' || room.status !== 'occupied') conflict('Only an occupied stay can be checked out.');
        row.status = 'checked-out';
        row.checkedOutAt = new Date();
        room.status = 'dirty';
        room.allocationVersion = (room.allocationVersion ?? 0) + 1;
        await room.save({ session });
        await RoomNight.deleteMany({ reservation: row.id, date: { $gte: today } }, { session });
        await Cleaning.create([{ branch: row.branch, room: room.id, reservation: row.id }], { session });
        await Invoice.create([await statement(row, room, req.branch, session)], { session });
        const membership = await User.findById(row.guest).select('active').session(session);
        if (membership?.active) await earnStay(row, session);
      }
      if (action !== 'note') row.revision += 1;
      await row.save({ session });
      if (action !== 'reassign') await deskEvent(req, row, 'desk.' + action, 'Front desk updated reservation ' + row.reference + ' (' + action + ').', session);
      return row.status;
    });
    res.json({ status: outcome });
  } catch (error) {
    if (error.code === 11000) conflict('The selected dates overlap another allocation. The original stay was preserved.');
    throw error;
  }
});

const chargeInput = z.object({
  kind: z.enum(['room-service', 'extra-guest', 'laundry', 'transport', 'restaurant', 'tax', 'discount', 'deposit',
    'payment', 'refund', 'cancellation', 'other']),
  label: z.string().trim().min(2).max(120), amount: z.number().int().min(1).max(100000000), requestKey: z.uuid()
});

desk.post(reservationPath + '/charges', allowRoles(...deskRoles, 'finance'), async (req, res) => {
  const input = chargeInput.parse(req.body);
  const { kind, label, requestKey } = input;
  const amount = ['discount', 'deposit', 'payment'].includes(kind) ? -input.amount : input.amount;
  const charge = await mongoose.connection.transaction(async (session) => {
    const row = await stay(req, session);
    const existing = await Charge.findOne({ reservation: row.id, requestKey }).session(session);
    if (existing) {
      if (existing.amount !== amount || existing.kind !== kind || existing.label !== label) conflict('This request key was already used.');
      return existing;
    }
    if (!['confirmed', 'checked-in'].includes(row.status)) conflict('Charges can be added to active stays.');
    const entries = await Charge.find({ reservation: row.id }).session(session);
    const bookingPaid = await bookingNetPaid(row.id, session);
    const totals = invoiceTotals(row, entries, bookingPaid, req.branch.taxBps);
    if (['deposit', 'payment'].includes(kind) && input.amount > totals.balance) conflict('Payment exceeds the current balance.');
    if (kind === 'refund' && input.amount > totals.paid) conflict('Refund exceeds recorded net payments.');
    if (kind === 'tax' && entries.some((entry) => entry.kind === 'tax')) conflict('A manual tax entry was already recorded.');
    row.revision += 1;
    await row.save({ session });
    const [saved] = await Charge.create([{ branch: row.branch, reservation: row.id, kind, label, amount, requestKey, createdBy: req.user.id }], { session });
    await deskEvent(req, row, 'billing.entry', 'A billing entry was recorded for ' + row.reference + '.', session);
    return saved;
  });
  res.status(201).json({ charge });
});

function sendInvoice(res, invoice, branch) {
  const money = (amount) => new Intl.NumberFormat('en', { style: 'currency', currency: invoice.currency }).format(amount / 100);
  const pdf = new PDFDocument({ margin: 55, bufferPages: true, info: { Title: invoice.number } });
  res.type('application/pdf').attachment(invoice.number + '.pdf');
  pdf.pipe(res);
  pdf.fillColor('#300817').fontSize(28).text('LuxuryStay Intelligence');
  pdf.fontSize(17).text(branch.name);
  if (branch.address) pdf.fontSize(10).text(branch.address);
  pdf.moveDown().fillColor('#211B1D').fontSize(14).text('Invoice ' + invoice.number);
  pdf.fontSize(11).text('Guest: ' + invoice.issuedTo).text('Room: ' + invoice.roomNumber)
    .text('Stay: ' + invoice.checkIn + ' to ' + invoice.checkOut)
    .text('Reservation: LS-' + invoice.number.slice(4)).moveDown();
  for (const item of invoice.items) pdf.text(item.label + '   ' + money(item.amount)).moveDown(.25);
  pdf.moveDown().text('Subtotal: ' + money(invoice.subtotal)).text('Simulated payment: ' + money(invoice.paid))
    .text('Balance: ' + money(invoice.balance));
  pdf.moveDown().fontSize(9).text('Demo invoice. Payment entries are recorded for demonstration.');
  pdf.end();
}

desk.get(reservationPath + '/settlement', allowRoles(...deskRoles, 'finance'), async (req, res) => {
  const row = await stay(req);
  const invoice = await Invoice.findOne({ reservation: row.id });
  if (!invoice) throw new BookingError(404, 'Invoice not found.');
  res.json({ account: await invoiceAccount(invoice) });
});

desk.post(reservationPath + '/settlement', allowRoles(...deskRoles, 'finance'), async (req, res) => {
  const row = await stay(req);
  res.json({ account: await settle(row, req.user, req.body, [...managers, 'finance'].includes(req.user.role)) });
});

desk.get(reservationPath + '/invoice', allowRoles(...deskRoles, 'finance'), async (req, res) => {
  const row = await stay(req);
  const invoice = await Invoice.findOne({ reservation: row.id });
  if (!invoice) throw new BookingError(404, 'The invoice is issued at checkout.');
  sendInvoice(res, invoice, req.branch);
});

export const guestDocuments = Router();
guestDocuments.use('/reservations/:reference', authenticate, allowRoles('guest'));
guestDocuments.get('/reservations/:reference/qr', async (req, res) => {
  const row = await Reservation.findOne({ guest: req.user.id, reference: reference.parse(req.params.reference),
    status: { $in: ['confirmed', 'checked-in', 'checked-out'] } });
  if (!row) throw new BookingError(404, 'Booking QR not found.');
  // Encode the reference only. The staff lookup still authenticates and checks the property.
  res.type('png').send(await QRCode.toBuffer(row.reference, { width: 220, margin: 2 }));
});
guestDocuments.get('/reservations/:reference/settlement', async (req, res) => {
  const row = await Reservation.findOne({ guest: req.user.id, reference: reference.parse(req.params.reference) });
  const invoice = row && await Invoice.findOne({ reservation: row.id });
  if (!invoice) throw new BookingError(404, 'Invoice not found.');
  res.json({ account: await invoiceAccount(invoice) });
});
guestDocuments.post('/reservations/:reference/settlement', async (req, res) => {
  const row = await Reservation.findOne({ guest: req.user.id, reference: reference.parse(req.params.reference) });
  if (!row) throw new BookingError(404, 'Invoice not found.');
  res.json({ account: await settle(row, req.user, req.body, false) });
});

guestDocuments.get('/reservations/:reference/invoice', async (req, res) => {
  const row = await Reservation.findOne({ guest: req.user.id, reference: reference.parse(req.params.reference) });
  const invoice = row && await Invoice.findOne({ reservation: row.id });
  if (!invoice) throw new BookingError(404, 'Invoice not found.');
  sendInvoice(res, invoice, await Branch.findById(row.branch));
});

desk.get(path + '/audit', allowRoles(...managers), async (req, res) => {
  const entries = await Audit.find({ branch: req.branch.id }).select('action resource actor relocation createdAt').populate('actor', 'name')
    .sort({ createdAt: -1 }).limit(100).lean();
  res.json({ entries });
});
