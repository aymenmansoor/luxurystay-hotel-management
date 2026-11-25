import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const reference = (ref) => ({ type: Schema.Types.ObjectId, ref, required: true });

const reservation = new Schema({
  reference: { type: String, required: true, unique: true },
  guest: reference('User'),
  branch: reference('Branch'),
  type: reference('RoomType'),
  room: reference('Room'),
  checkIn: { type: String, required: true },
  checkOut: { type: String, required: true },
  guests: { type: Number, required: true },
  status: { type: String, enum: ['held', 'confirmed', 'cancelled', 'checked-in', 'checked-out', 'no-show'], required: true },
  expiresAt: Date,
  offer: { type: Schema.Types.ObjectId, ref: 'Offer' },
  offerTerms: { title: String, stayStart: String, stayEnd: String, minimumNights: Number, discountBps: Number, services: [String] },
  nightlyRate: { type: Number, required: true },
  total: { type: Number, required: true },
  currency: { type: String, required: true },
  requestKey: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  revision: { type: Number, default: 0 },
  cancelledAt: Date,
  noShowAt: Date,
  lateCheckoutTime: String,
  source: { type: String, enum: ['online', 'staff', 'walk-in'], default: 'online' },
  createdBy: Schema.Types.ObjectId,
  contactName: String,
  contactEmail: String,
  verifiedAt: Date,
  checkedInAt: Date,
  checkedOutAt: Date,
  keysIssued: { type: Number, default: 0 },
  deskNotes: [{ _id: false, text: String, actor: Schema.Types.ObjectId, at: Date }]
}, { timestamps: true });
reservation.index({ guest: 1, requestKey: 1 }, { unique: true });
reservation.index({ createdBy: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { createdBy: { $exists: true } } });
reservation.index({ guest: 1, createdAt: -1 });
reservation.index({ guest: 1, status: 1, expiresAt: 1 });
reservation.index({ branch: 1, checkIn: 1 });
reservation.index({ offer: 1, status: 1, expiresAt: 1 });

const allocation = new Schema({
  room: reference('Room'),
  date: { type: String, required: true },
  reservation: reference('Reservation'),
  expiresAt: { type: Date, default: null }
});
allocation.index({ room: 1, date: 1 }, { unique: true });
allocation.index({ reservation: 1 });

const payment = new Schema({
  reservation: { ...reference('Reservation'), unique: true },
  method: { type: String, enum: ['simulation'], required: true },
  status: { type: String, enum: ['simulated-paid', 'simulated-refunded'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true }
}, { timestamps: true });

export const Reservation = model('Reservation', reservation);
export const RoomNight = model('RoomNight', allocation);
payment.index({ createdAt: 1 });
export const Payment = model('Payment', payment);

const adjustment = new Schema({
  reservation: reference('Reservation'), actor: reference('User'),
  kind: { type: String, enum: ['date-change', 'cancellation-refund'], required: true },
  delta: { type: Number, required: true }, currency: { type: String, required: true },
  revision: { type: Number, required: true }, reason: { type: String, required: true }
}, { timestamps: true });
adjustment.index({ reservation: 1, revision: 1, kind: 1 }, { unique: true });
adjustment.index({ createdAt: 1 });
export const BookingAdjustment = model('BookingAdjustment', adjustment);
