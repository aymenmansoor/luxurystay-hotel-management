import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceTotals } from '../src/invoice-totals.js';

const stay = { checkIn: '2026-11-20', checkOut: '2026-11-22', total: 20000 };

test('invoice reconciliation separates charges, taxes, discounts, deposits, payments and refunds', () => {
  const entries = [
    { kind: 'restaurant', amount: 3000 }, { kind: 'discount', amount: -1000 },
    { kind: 'deposit', amount: -2000 }, { kind: 'payment', amount: -5000 }, { kind: 'refund', amount: 1000 }
  ];
  const invoice = invoiceTotals(stay, entries, 10000, 1000);
  assert.equal(invoice.subtotal, 24200);
  assert.equal(invoice.paid, 16000);
  assert.equal(invoice.balance, 8200);
  assert.deepEqual(invoice.breakdown, { room: 20000, fees: 3000, discounts: 1000, tax: 2200,
    deposits: 2000, payments: 15000, refunds: 1000 });
  assert.equal(invoice.items.reduce((sum, item) => sum + item.amount, 0), invoice.subtotal);
});

test('manual tax replaces automatic tax and each invoice uses integer minor units', () => {
  const invoice = invoiceTotals(stay, [{ kind: 'tax', amount: 333 }], 0, 1000);
  assert.equal(invoice.subtotal, 20333);
  assert.equal(invoice.items.filter((item) => item.kind === 'tax').length, 1);
  assert.equal(invoiceTotals({ ...stay, total: 333 }, [], 0, 750).balance, 358);
});
