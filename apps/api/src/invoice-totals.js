const tenderKinds = new Set(['payment', 'deposit', 'refund']);

export function invoiceTotals(stay, entries, bookingPaid, taxBps) {
  const items = [{ label: 'Room · ' + stay.checkIn + ' to ' + stay.checkOut, amount: stay.total, kind: 'room' }];
  const breakdown = { room: stay.total, fees: 0, discounts: 0, tax: 0, deposits: 0, payments: bookingPaid, refunds: 0 };
  for (const entry of entries) {
    const { amount, kind, label } = entry;
    if (!tenderKinds.has(kind)) items.push({ label, amount, kind });
    switch (kind) {
      case 'payment': breakdown.payments -= amount; break;
      case 'deposit': breakdown.deposits -= amount; break;
      case 'refund': breakdown.refunds += amount; break;
      case 'discount': breakdown.discounts -= amount; break;
      case 'tax': breakdown.tax += amount; break;
      default: breakdown.fees += amount;
    }
  }
  const taxable = breakdown.room + breakdown.fees - breakdown.discounts;
  if (taxable > 0 && taxBps && !entries.some((entry) => entry.kind === 'tax')) {
    breakdown.tax = Math.round(taxable * taxBps / 10000);
    items.push({ label: 'Property tax', amount: breakdown.tax, kind: 'tax' });
  }
  const subtotal = taxable + breakdown.tax;
  const paid = breakdown.deposits + breakdown.payments - breakdown.refunds;
  return { items, breakdown, subtotal, paid, balance: subtotal - paid };
}
