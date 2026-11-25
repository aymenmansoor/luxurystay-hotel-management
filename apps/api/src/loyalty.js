import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { Charge, event } from './operations-models.js';
import { Reservation } from './reservation-models.js';
import { BookingError } from './reservation-service.js';

const { Schema, model } = mongoose;
const user = { type: Schema.Types.ObjectId, ref: 'User', required: true };
export const LoyaltyAccount = model('LoyaltyAccount', new Schema({
  guest: { ...user, unique: true }, points: { type: Number, default: 0 }, lifetime: { type: Number, default: 0 }
}, { timestamps: true }));
const entrySchema = new Schema({
  guest: user, reservation: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  kind: { type: String, enum: ['earn', 'redeem'], required: true }, points: Number
}, { timestamps: true });
entrySchema.index({ reservation: 1, kind: 1 }, { unique: true });
entrySchema.index({ guest: 1, createdAt: -1 });
export const LoyaltyEntry = model('LoyaltyEntry', entrySchema);

const reward = { points: 500, percent: 5, name: '5% room charge credit' };

export async function earnStay(row, session) {
  const nights = (Date.parse(row.checkOut) - Date.parse(row.checkIn)) / 86400000;
  const points = nights * 100;
  await LoyaltyAccount.updateOne({ guest: row.guest },
    { $inc: { points, lifetime: points } }, { session, upsert: true });
  await LoyaltyEntry.create([{ guest: row.guest, reservation: row.id, kind: 'earn', points }], { session });
}

export const loyalty = Router();
loyalty.use('/loyalty', authenticate, allowRoles('guest'));
loyalty.get('/loyalty', async (req, res) => {
  const [account, entries] = await Promise.all([
    LoyaltyAccount.findOne({ guest: req.user.id }),
    LoyaltyEntry.find({ guest: req.user.id }).populate('reservation', 'reference').sort({ createdAt: -1 }).limit(50).lean()
  ]);
  const lifetime = account?.lifetime ?? 0;
  res.json({ member: Boolean(account), points: account?.points ?? 0, tier: lifetime >= 2500 ? 'Gold' : lifetime >= 1000 ? 'Silver' : 'Classic',
    entries: entries.map((row) => ({ id: row._id, reference: row.reservation?.reference, points: row.points, kind: row.kind, at: row.createdAt })), reward });
});
loyalty.post('/loyalty/join', async (req, res) => {
  await LoyaltyAccount.updateOne({ guest: req.user.id }, { $setOnInsert: { points: 0, lifetime: 0 } }, { upsert: true });
  res.sendStatus(204);
});
loyalty.post('/loyalty/redeem', async (req, res) => {
  const { reference } = z.object({ reference: z.string().regex(/^LS-[A-F0-9]{18}$/) }).parse(req.body);
  const credit = await mongoose.connection.transaction(async (session) => {
    const row = await Reservation.findOne({ reference, guest: req.user.id }).session(session);
    if (!row) throw new BookingError(404, 'Reservation not found.');
    const previous = await Charge.findOne({ reservation: row.id, requestKey: 'loyalty-credit' }).session(session);
    if (previous) return previous;
    // Apply at the property during an active stay so checkout creates the final credit.
    if (row.status !== 'checked-in') throw new BookingError(409, 'Redeem this reward on a checked-in stay.');
    const amount = Math.floor(row.total * reward.percent / 100);
    if (!amount) throw new BookingError(409, 'This room charge is too low to receive a credit.');
    const updated = await LoyaltyAccount.updateOne({ guest: req.user.id, points: { $gte: reward.points } },
      { $inc: { points: -reward.points } }, { session });
    if (!updated.matchedCount) throw new BookingError(409, 'You need 500 points.');
    await Reservation.updateOne({ _id: row.id }, { $inc: { revision: 1 } }, { session });
    await LoyaltyEntry.create([{ guest: req.user.id, reservation: row.id, kind: 'redeem', points: -reward.points }], { session });
    const [credit] = await Charge.create([{ branch: row.branch, reservation: row.id, label: 'LuxuryStay reward credit',
      kind: 'discount', amount: -amount, requestKey: 'loyalty-credit', createdBy: req.user.id }], { session });
    await event({ branch: row.branch, guest: req.user.id, actor: req.user.id,
      action: 'loyalty.redeemed', resource: reference, message: 'A loyalty credit was applied to ' + reference + '.' }, session);
    return credit;
  });
  res.json({ amount: -credit.amount });
});
