import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (target) => ({ type: Schema.Types.ObjectId, ref: target });
export const roles = ['super-admin', 'branch-manager', 'receptionist', 'housekeeping', 'maintenance', 'finance', 'guest'];

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: roles, required: true },
  branches: [ref('Branch')],
  active: { type: Boolean, default: true },
  invited: { type: Boolean, default: false },
  bookingVersion: { type: Number, default: 0, select: false },
  credentialVersion: { type: Number, default: 0 },
  emailVerified: { type: Boolean, default: false },
  preferences: { type: String, default: '' }
}, { timestamps: true });

export const User = model('User', userSchema);
export const Session = model('Session', new Schema({
  credentialVersion: { type: Number, default: 0 },
  digest: { type: String, required: true, unique: true },
  user: { ...ref('User'), required: true },
  expiresAt: { type: Date, required: true, expires: 0 }
}));

export const Branch = model('Branch', new Schema({
  layoutRevision: { type: Number, default: 0, select: false },
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  city: { type: String, required: true },
  timeZone: { type: String, required: true },
  currency: { type: String, required: true },
  address: String,
  description: String,
  facilities: [String],
  contactEmail: String,
  phone: String,
  taxBps: { type: Number, default: 0 },
  checkInTime: { type: String, default: '15:00' },
  checkOutTime: { type: String, default: '11:00' },
  policyNotes: String
}));

const roomTypeSchema = new Schema({
  branch: { ...ref('Branch'), required: true },
  slug: { type: String, required: true },
  name: { type: String, required: true },
  capacity: { type: Number, required: true, min: 1 },
  nightlyRate: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  description: String,
  bed: String,
  size: Number,
  amenities: [String]
});
roomTypeSchema.index({ branch: 1, slug: 1 }, { unique: true });
export const RoomType = model('RoomType', roomTypeSchema);

const roomSchema = new Schema({
  branch: { ...ref('Branch'), required: true },
  type: { ...ref('RoomType'), required: true },
  number: { type: String, required: true },
  floor: { type: Number, required: true },
  allocationVersion: { type: Number, default: 0, select: false },
  layout: { row: Number, column: Number, width: Number, height: Number },
  status: { type: String, enum: ['available', 'reserved', 'occupied', 'dirty', 'cleaning', 'inspected', 'maintenance', 'out-of-service'], default: 'available' }
});
roomSchema.index({ branch: 1, number: 1 }, { unique: true });
roomSchema.index({ branch: 1, floor: 1, 'layout.row': 1, 'layout.column': 1 }, {
  unique: true, partialFilterExpression: { 'layout.row': { $exists: true }, 'layout.column': { $exists: true } }
});
export const Room = model('Room', roomSchema);

export const Inquiry = model('Inquiry', new Schema({
  name: String, email: String, message: String, branch: { ...ref('Branch'), index: true }
}, { timestamps: true }));

export const Subscription = model('Subscription', new Schema({
  email: { type: String, required: true, unique: true }, consentedAt: Date
}));

export const Review = model('Review', new Schema({
  reservation: { ...ref('Reservation'), unique: true, sparse: true },
  displayName: String, rating: { type: Number, min: 1, max: 5 },
  comment: String, branch: ref('Branch'), approved: { type: Boolean, default: false, index: true }
}, { timestamps: true }));
