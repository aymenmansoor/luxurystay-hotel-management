import { invoiceTotals } from './invoice-totals.js';

const tenderKinds = new Set(['deposit', 'payment', 'refund']);

export function reconstructLegacyInvoice(invoice, { reservation, charges, payment, adjustments }) {
  const failure = (exception) => ({ exception });
  if (!reservation || reservation.currency !== invoice.currency) return failure('reservation-missing-or-currency-mismatch');
  const [room, ...items] = invoice.items ?? [];
  if (!room || room.label !== 'Room · ' + invoice.checkIn + ' to ' + invoice.checkOut ||
      !Number.isSafeInteger(room.amount) || room.amount < 0) return failure('missing-issued-room-item');
  if (payment && (payment.status !== 'simulated-paid' || payment.currency !== invoice.currency ||
      payment.updatedAt > invoice.createdAt || !Number.isSafeInteger(payment.amount))) {
    return failure('ambiguous-booking-payment');
  }
  if (adjustments.length) return failure('legacy-booking-adjustment-present');
  const chargesAtIssue = charges.filter((charge) => charge.createdAt <= invoice.createdAt);
  if (chargesAtIssue.some((charge) => !Number.isSafeInteger(charge.amount))) return failure('invalid-desk-entry');
  const billable = chargesAtIssue.filter((charge) => !tenderKinds.has(charge.kind));
  const unmatched = items.slice();
  for (const charge of billable) {
    const index = unmatched.findIndex((item) => item.label === charge.label && item.amount === charge.amount);
    if (index < 0) return failure('desk-entries-do-not-match-invoice');
    unmatched.splice(index, 1);
  }
  // The legacy issuer appended an automatic tax item with this exact label.
  const automaticTax = unmatched[0];
  if (unmatched.length && (unmatched.length !== 1 || automaticTax !== items.at(-1) ||
      automaticTax.label !== 'Property tax' || !Number.isSafeInteger(automaticTax.amount) || automaticTax.amount < 0 ||
      billable.some((charge) => charge.kind === 'tax' || charge.label === 'Property tax'))) {
    return failure('unmatched-issued-items');
  }
  const entries = automaticTax ? [...chargesAtIssue, { ...automaticTax, kind: 'tax' }] : chargesAtIssue;
  const result = invoiceTotals({ ...invoice, total: room.amount }, entries, payment?.amount ?? 0, 0);
  if (result.subtotal !== invoice.subtotal || result.paid !== invoice.paid || result.balance !== invoice.balance) {
    return failure('issued-totals-do-not-reconcile');
  }
  return { breakdown: result.breakdown };
}
