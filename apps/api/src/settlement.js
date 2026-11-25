import mongoose from 'mongoose';
import { z } from 'zod';
import { Invoice, event } from './operations-models.js';
import { User } from './models.js';
import { Reservation } from './reservation-models.js';
import { BookingError } from './reservation-service.js';

const { Schema, model } = mongoose;
const ref = (target) => ({ type: Schema.Types.ObjectId, ref: target, required: true });
const schema = new Schema({
  invoice: ref('Invoice'), reservation: ref('Reservation'), branch: ref('Branch'), actor: ref('User'),
  kind: { type: String, enum: ['payment', 'refund', 'credit'], required: true },
  amount: { type: Number, required: true },
  reason: String,
  currency: { type: String, required: true },
  requestKey: { type: String, required: true }
}, { timestamps: true });
schema.index({ invoice: 1, requestKey: 1 }, { unique: true });
schema.index({ branch: 1, createdAt: 1 });
export const Settlement = model('Settlement', schema);
const entry = z.object({
  kind: z.enum(['payment', 'refund', 'credit']), amount: z.number().int().min(1).max(100000000), requestKey: z.uuid(),
  reason: z.string().trim().min(3).max(300).optional()
});

export async function invoiceAccount(invoice, session = null) {
  const transactions = await Settlement.find({ invoice: invoice.id }).session(session).sort('createdAt _id')
    .select('kind amount currency reason createdAt').lean();
  return reconcileIssuedInvoice(invoice, transactions);
}

export function reconcileIssuedInvoice(invoice, transactions) {
  const movement = { payment: 0, refund: 0, credit: 0 };
  for (const item of transactions) movement[item.kind] += item.amount;
  const net = movement.payment - movement.refund;
  return {
    number: invoice.number, currency: invoice.currency, originalBalance: invoice.balance,
    issuedTotal: invoice.subtotal, issuedPaid: invoice.paid, issuedBreakdown: invoice.breakdown,
    balance: invoice.balance - net - movement.credit, paid: invoice.paid + net,
    credits: movement.credit, movement, transactions,
    issueVariance: invoice.balance - (invoice.subtotal - invoice.paid)
  };
}

export async function settle(reservation, actor, raw, canRefund) {
  const input = entry.parse(raw);
  if (input.kind !== 'payment' && !canRefund) throw new BookingError(403, 'Only finance or management can issue refunds or credits.');
  if (input.kind === 'credit' && !input.reason) throw new BookingError(400, 'Enter a reason for the credit.');
  const reason = input.reason ?? (input.kind === 'payment' ? 'Invoice settlement' : 'Refund against issued invoice');
  return mongoose.connection.transaction(async (session) => {
    const invoice = await Invoice.findOne({ reservation: reservation.id }).session(session);
    if (!invoice) throw new BookingError(404, 'No issued invoice for this reservation.');
    const prior = await Settlement.findOne({ invoice: invoice.id, requestKey: input.requestKey }).session(session);
    if (prior) {
      if (prior.kind !== input.kind || prior.amount !== input.amount || (prior.reason ?? (prior.kind === 'payment' ? 'Invoice settlement' : 'Refund against issued invoice')) !== reason || String(prior.actor) !== actor.id) {
        throw new BookingError(409, 'This settlement key was previously used for a different transaction.');
      }
      return invoiceAccount(invoice, session);
    }
    // Serialize ledger writers using the reservation, preserving the issued invoice.
    await Reservation.updateOne({ _id: reservation.id }, { $inc: { revision: 1 } }, { session });
    const account = await invoiceAccount(invoice, session);
    if (['payment', 'credit'].includes(input.kind) && input.amount > account.balance) {
      throw new BookingError(409, 'This entry exceeds the outstanding balance.');
    }
    if (input.kind === 'refund' && input.amount > account.paid) {
      throw new BookingError(409, 'Refund exceeds recorded net payments.');
    }
    await Settlement.create([{ ...input, reason, invoice: invoice.id, reservation: reservation.id,
      branch: reservation.branch, currency: invoice.currency, actor: actor.id }], { session });
    const email = reservation.contactEmail ?? (await User.findById(reservation.guest).select('email').session(session))?.email;
    await event({ branch: reservation.branch, actor: actor.id, guest: reservation.guest, email,
      action: 'billing.' + input.kind, resource: invoice.number,
      message: 'A simulated ' + input.kind + ' was recorded for ' + invoice.number + '.' }, session);
    return invoiceAccount(invoice, session);
  });
}
