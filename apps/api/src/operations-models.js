import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (target, required = true) => ({ type: Schema.Types.ObjectId, ref: target, required });
const options = { timestamps: true };
export const priorities = ['low', 'normal', 'high', 'urgent'];

export const Audit = model('AuditLog', new Schema({
  branch: { ...ref('Branch'), index: true }, actor: ref('User', false),
  guest: { ...ref('User', false), index: true }, recipient: ref('User', false),
  action: { type: String, required: true }, resource: String, message: String,
  relocation: { type: new Schema({ from: ref('Room'), to: ref('Room'), fromNumber: String,
    toNumber: String, reason: String, oldCheckout: String, newCheckout: String }, { _id: false }) },
  dedupeKey: { type: String, unique: true, sparse: true },
  email: String, emailSent: Date, emailSuppressedAt: Date, mailLease: Date, mailAttempts: { type: Number, default: 0 }
}, options));

const task = new Schema({
  branch: { ...ref('Branch'), index: true }, room: ref('Room'), reservation: ref('Reservation', false),
  assigned: ref('User', false), priority: { type: String, enum: priorities, default: 'normal' },
  status: { type: String, enum: ['pending', 'assigned', 'in-progress', 'completed', 'inspected', 'reopened'], default: 'pending' },
  startedAt: Date, completedAt: Date, inspectedAt: Date, estimateAt: Date, note: String
}, options);
task.index({ room: 1, status: 1 });
export const Cleaning = model('Cleaning', task);

export const Maintenance = model('Maintenance', new Schema({
  branch: { ...ref('Branch'), index: true }, room: ref('Room'), assigned: ref('User', false),
  summary: String, emergency: { type: Boolean, default: false }, equipment: String, priority: { type: String, enum: priorities, default: 'normal' },
  status: { type: String, enum: ['open', 'in-progress', 'resolved'], default: 'open' },
  blocking: Boolean, scheduledFor: Date, resolvedAt: Date, cost: { type: Number, default: 0 }
}, options));

export const Charge = model('Charge', new Schema({
  branch: ref('Branch'), reservation: { ...ref('Reservation'), index: true },
  label: String, kind: String, amount: Number, requestKey: String, createdBy: ref('User')
}, options));
Charge.schema.index({ reservation: 1, requestKey: 1 }, { unique: true });
Charge.schema.index({ branch: 1, createdAt: 1 });

export const Invoice = model('Invoice', new Schema({
  reservation: { ...ref('Reservation'), unique: true }, branch: ref('Branch'), number: { type: String, unique: true },
  currency: String, issuedTo: String, roomNumber: String, checkIn: String, checkOut: String,
  items: [{ _id: false, label: String, amount: Number, kind: String }],
  breakdown: { type: new Schema({ room: Number, fees: Number, discounts: Number, tax: Number,
    deposits: Number, payments: Number, refunds: Number }, { _id: false }) },
  subtotal: Number, paid: Number, balance: Number
}, options));

Invoice.schema.index({ branch: 1, createdAt: 1, _id: 1 });

export const ServiceRequest = model('ServiceRequest', new Schema({
  branch: { ...ref('Branch'), index: true }, reservation: ref('Reservation'), guest: { ...ref('User'), index: true },
  category: String, department: String, description: String,
  priority: { type: String, enum: priorities, default: 'normal' },
  status: { type: String, enum: ['open', 'in-progress', 'completed', 'cancelled'], default: 'open' },
  completedAt: Date, completionNote: String
}, options));

export const PriceDecision = model('PriceDecision', new Schema({
  branch: { ...ref('Branch'), index: true }, type: ref('RoomType'), actor: ref('User'),
  oldRate: Number, newRate: Number, anchorRate: Number, reason: String, occupancy: Number, sampleNights: Number
}, options));

export const NotificationState = model('NotificationState', new Schema({
  user: { ...ref('User'), unique: true }, readThrough: Date, bookingEmail: { type: Boolean, default: true }
}));

const shift = new Schema({
  branch: ref('Branch'), worker: ref('User'), start: Date, end: Date
}, options);
shift.index({ branch: 1, worker: 1 }, { unique: true });
export const CleaningShift = model('CleaningShift', shift);

export const operationModels = [Audit, Cleaning, Maintenance, Charge, Invoice, ServiceRequest, PriceDecision, NotificationState, CleaningShift];

export async function event(input, session = null) {
  const record = new Audit(input);
  await record.save({ session });
  return record;
}
