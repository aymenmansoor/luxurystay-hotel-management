import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { allowRoles, authenticate } from './auth.js';
import { managers, objectId, reference, scopedBranch } from './desk.js';
import { event } from './operations-models.js';
import { Reservation } from './reservation-models.js';
import { BookingError } from './reservation-service.js';

const { Schema, model } = mongoose;
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model, required: true });
const categories = ['room', 'dining', 'cleanliness', 'service', 'billing', 'other'];
const departments = ['front-desk', 'housekeeping', 'maintenance', 'dining', 'finance'];
const schema = new Schema({
  branch: ref('Branch'), guest: ref('User'), reservation: ref('Reservation'), reference: String,
  category: { type: String, enum: categories }, text: String, department: { type: String, enum: departments },
  status: { type: String, enum: ['submitted', 'investigating', 'resolved'], default: 'submitted' },
  resolution: String, resolvedAt: Date
}, { timestamps: true });
schema.index({ branch: 1, status: 1, createdAt: -1 });
schema.index({ guest: 1, createdAt: -1 });
export const Complaint = model('Complaint', schema);
export const complaints = Router();

complaints.use('/guest/complaints', authenticate, allowRoles('guest'));
complaints.get('/guest/complaints', async (req, res) => {
  const complaints = await Complaint.find({ guest: req.user.id }).sort({ createdAt: -1 }).limit(50)
    .select('reference category text department status resolution resolvedAt createdAt').lean();
  res.json({ complaints });
});
complaints.post('/guest/complaints', async (req, res) => {
  const input = z.object({ reference, category: z.enum(categories), text: z.string().trim().min(10).max(1000) }).parse(req.body);
  const row = await Reservation.findOne({ reference: input.reference, guest: req.user.id,
    status: { $in: ['confirmed', 'checked-in', 'checked-out'] } });
  if (!row) throw new BookingError(404, 'Select one of your reservations.');
  const complaint = await mongoose.connection.transaction(async (session) => {
    const [item] = await Complaint.create([{ ...input, branch: row.branch, guest: req.user.id, reservation: row.id }], { session });
    await event({ branch: row.branch, guest: req.user.id, actor: req.user.id, action: 'complaint.submitted',
      resource: item.id, message: 'Your hotel complaint was received.' }, session);
    return item;
  });
  res.status(201).json({ complaint });
});

const staff = '/staff/properties/:branchId/complaints';
complaints.use(staff, authenticate, allowRoles(...managers), scopedBranch);
complaints.get(staff, async (req, res) => {
  res.json({ complaints: await Complaint.find({ branch: req.branch.id }).sort({ createdAt: -1 }).limit(100).lean() });
});
complaints.put(staff + '/:id', async (req, res) => {
  const input = z.object({ status: z.enum(['investigating', 'resolved']), department: z.enum(departments),
    resolution: z.string().trim().max(1000).optional() }).parse(req.body);
  if (input.status === 'resolved' && !input.resolution) throw new BookingError(400, 'Enter a resolution before closing the complaint.');
  const complaint = await mongoose.connection.transaction(async (session) => {
    const item = await Complaint.findOne({ _id: objectId.parse(req.params.id), branch: req.branch.id }).session(session);
    if (!item) throw new BookingError(404, 'Complaint not found.');
    if (item.status === 'resolved') throw new BookingError(409, 'This complaint is already resolved.');
    item.set({ ...input, resolvedAt: input.status === 'resolved' ? new Date() : undefined });
    await item.save({ session });
    await event({ branch: item.branch, guest: item.guest, actor: req.user.id, action: 'complaint.' + item.status,
      resource: item.id, message: 'Your hotel complaint is ' + item.status + '.' }, session);
    return item;
  });
  res.json({ complaint });
});
