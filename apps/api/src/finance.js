import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { managers, scopedBranch } from './desk.js';
import { Charge, Invoice, event } from './operations-models.js';
import { BookingAdjustment, Payment, Reservation } from './reservation-models.js';
import { reconstructLegacyInvoice } from './legacy-invoice.js';
import { BookingError } from './reservation-service.js';
import { reconcileIssuedInvoice, Settlement } from './settlement.js';

const day = 86400000;
const maxInvoices = 5000;
const path = '/staff/properties/:branchId/finance/reconciliation';
const windowSchema = z.object({ from: z.iso.date(), through: z.iso.date() }).refine(({ from, through }) =>
  through >= from && Date.parse(through) - Date.parse(from) < 366 * day, 'Select a UTC reporting window of up to 366 days.');

export const finance = Router();
finance.use(path, authenticate, allowRoles(...managers, 'finance'), scopedBranch);

function groupBy(items, field) {
  const grouped = new Map();
  for (const item of items) {
    const key = String(item[field]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function breakdownReconciles(invoice, breakdown) {
  if (!breakdown) return false;
  const { room, fees, discounts, tax, deposits, payments, refunds } = breakdown;
  return [room, fees, discounts, tax, deposits, payments, refunds].every(Number.isSafeInteger) &&
    room + fees - discounts + tax === invoice.subtotal &&
    deposits + payments - refunds === invoice.paid &&
    invoice.subtotal - invoice.paid === invoice.balance;
}

async function history(branch, input) {
  const { from, through } = windowSchema.parse(input);
  const end = new Date(Date.parse(through) + day);
  return mongoose.connection.transaction(async (session) => {
    const invoices = await Invoice.find({
      branch, createdAt: { $gte: new Date(from), $lt: end }
    }).sort({ createdAt: 1, _id: 1 }).limit(maxInvoices + 1).session(session).lean();
    if (invoices.length > maxInvoices) throw new BookingError(400, 'More than 5,000 invoices match. Select a shorter date range.');
    const ids = invoices.map((invoice) => invoice._id);
    const reservations = await Reservation.find({ branch, _id: { $in: invoices.map((invoice) => invoice.reservation) } })
      .select('reference currency').session(session).lean();
    const references = new Map(reservations.map((item) => [String(item._id), item]));
    const legacyIds = invoices.filter((item) => !item.breakdown && references.has(String(item.reservation))).map((item) => item.reservation);
    const chargeSources = await Charge.find({ branch, reservation: { $in: legacyIds } }).session(session).lean();
    const paymentSources = await Payment.find({ reservation: { $in: legacyIds } }).session(session).lean();
    const adjustmentSources = await BookingAdjustment.find({ reservation: { $in: legacyIds } }).session(session).lean();
    const legacyCharges = groupBy(chargeSources, 'reservation');
    const legacyPayments = groupBy(paymentSources, 'reservation');
    const legacyAdjustments = groupBy(adjustmentSources, 'reservation');
    const entries = await Settlement.find({ branch, invoice: { $in: ids }, createdAt: { $lt: end } })
      .select('invoice kind amount currency reason actor createdAt requestKey').sort({ createdAt: 1, _id: 1 }).session(session).lean();
    const byInvoice = groupBy(entries, 'invoice');
    const totals = new Map();
    const rows = invoices.map((invoice) => {
      const account = reconcileIssuedInvoice(invoice, byInvoice.get(String(invoice._id)) ?? []);
      const { transactions, ...amounts } = account;
      const key = String(invoice.reservation);
      const reservation = references.get(key);
      const legacy = invoice.breakdown ? {} : reconstructLegacyInvoice(invoice, { reservation,
        charges: legacyCharges.get(key) ?? [],
        payment: legacyPayments.get(key)?.find((item) => item.createdAt <= invoice.createdAt),
        adjustments: (legacyAdjustments.get(key) ?? []).filter((item) => item.createdAt <= invoice.createdAt) });
      const breakdown = invoice.breakdown ?? legacy.breakdown;
      const reconciled = breakdownReconciles(invoice, breakdown);
      const recognizedRevenue = reconciled ? invoice.subtotal - breakdown.tax : null;
      const exceptions = [legacy.exception, invoice.breakdown && !reconciled && 'stored-breakdown-does-not-reconcile',
        account.issueVariance !== 0 && 'issued-balance-variance'].filter(Boolean);
      const row = { ...amounts, issuedBreakdown: breakdown, issuedAt: invoice.createdAt, reservation: reservation?.reference ?? '',
        legacyBreakdown: !invoice.breakdown, recognizedRevenue, exceptions,
        breakdownSource: invoice.breakdown ? 'stored' : legacy.breakdown ? 'reconstructed' : 'unavailable' };
      const summary = totals.get(row.currency) ?? { currency: row.currency, invoices: 0, legacy: 0, varianceInvoices: 0,
        recognizedRevenue: 0, taxAtIssue: 0, unclassifiedIssuedTotal: 0, issuedTotal: 0, issuedPaid: 0, issuedBalance: 0, payments: 0, refunds: 0, credits: 0, outstanding: 0, creditOwed: 0 };
      summary.invoices += 1;
      summary.legacy += Number(row.legacyBreakdown);
      summary.varianceInvoices += Number(row.issueVariance !== 0);
      summary.recognizedRevenue += row.recognizedRevenue ?? 0;
      summary.taxAtIssue += reconciled ? breakdown.tax : 0;
      if (!reconciled) summary.unclassifiedIssuedTotal += row.issuedTotal;
      summary.issuedTotal += row.issuedTotal;
      summary.issuedPaid += row.issuedPaid;
      summary.issuedBalance += row.originalBalance;
      summary.payments += row.movement.payment;
      summary.refunds += row.movement.refund;
      summary.credits += row.movement.credit;
      summary.outstanding += Math.max(row.balance, 0);
      summary.creditOwed += Math.max(-row.balance, 0);
      totals.set(row.currency, summary);
      return { ...row, transactions };
    });
    return { from, through, totals: Array.from(totals.values()), invoices: rows };
  }, { readConcern: { level: 'snapshot' } });
}

finance.get(path, async (req, res) => {
  const result = await history(req.branch.id, req.query);
  res.json({ ...result, invoices: result.invoices.map(({ transactions, ...row }) => row) });
});

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  const safe = /^[\s=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

const journalSources = [
  { model: Payment, name: 'booking-payment' },
  { model: BookingAdjustment, name: 'booking-adjustment' },
  { model: Charge, name: 'desk-entry', scoped: true },
  { model: Settlement, name: 'settlement', scoped: true }
];
const tender = new Set(['payment', 'deposit', 'refund']);
const maxJournalEntries = 20000;
const journalHeader = ['Posted UTC', 'Reservation', 'Source', 'Type or status', 'Currency', 'Stored minor',
  'Net receipts minor', 'Desk charge minor', 'Invoice credit minor', 'Reason', 'Actor ID', 'Entry ID', 'Request key', 'Reservation revision'];

function journalAmounts(source, row) {
  if (source === 'booking-payment') {
    // Legacy records marked refunded in place lack an immutable refund event.
    return [row.status === 'simulated-paid' ? row.amount : null, null, null];
  }
  if (source === 'booking-adjustment') return [row.delta, null, null];
  if (source === 'desk-entry') return tender.has(row.kind) ? [-row.amount, null, null] : [null, row.amount, null];
  return row.kind === 'credit' ? [null, null, row.amount] : [row.kind === 'refund' ? -row.amount : row.amount, null, null];
}

async function journal(branch, from, through) {
  const branchId = new mongoose.Types.ObjectId(branch);
  const createdAt = { $gte: new Date(from), $lt: new Date(Date.parse(through) + day) };
  const entries = await mongoose.connection.transaction(async (session) => {
    const results = [];
    for (const { model, name, scoped } of journalSources) {
      const rows = await model.aggregate([
        { $match: { createdAt, ...(scoped && { branch: branchId }) } },
        { $lookup: { from: Reservation.collection.name, localField: 'reservation', foreignField: '_id', as: 'stay',
          pipeline: [{ $match: { branch: branchId } }, { $project: { reference: 1, currency: 1 } }] } },
        { $unwind: '$stay' },
        { $limit: maxJournalEntries - results.length + 1 }
      ]).session(session);
      if (rows.length + results.length > maxJournalEntries) {
        throw new BookingError(400, 'More than 20,000 journal entries match. Select a shorter date range.');
      }
      for (const row of rows) {
        const actor = row.actor ?? row.createdBy;
        results.push([row.createdAt, row.stay.reference, name, row.kind ?? row.status, row.currency ?? row.stay.currency,
          row.amount ?? row.delta, ...journalAmounts(name, row), row.reason ?? row.label, actor, row._id, row.requestKey, row.revision]);
      }
    }
    return results.sort((first, second) => first[0] - second[0] || String(first[11]).localeCompare(String(second[11])));
  }, { readConcern: { level: 'snapshot' } });
  return [journalHeader, ...entries];
}

function sendCsv(res, kind, from, through, rows) {
  res.attachment('luxurystay-' + kind + '-' + from + '-to-' + through + '.csv')
    .type('text/csv').send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
}

async function exportCsv(req, res, kind, from, through, rows) {
  await event({ branch: req.branch.id, actor: req.user.id, action: 'finance.export',
    resource: kind, message: 'Prepared ' + kind + ' CSV for ' + from + ' through ' + through + ' UTC (' + (rows.length - 1) + ' rows).' });
  sendCsv(res, kind, from, through, rows);
}

finance.get(path + '/export', async (req, res) => {
  const kind = z.enum(['invoices', 'settlements', 'journal', 'exceptions']).parse(req.query.kind);
  if (kind === 'journal') {
    const { from, through } = windowSchema.parse(req.query);
    return exportCsv(req, res, kind, from, through, await journal(req.branch.id, from, through));
  }
  const report = await history(req.branch.id, req.query);
  if (kind === 'exceptions') {
    const rows = [['Invoice', 'Reservation', 'Issued UTC', 'Currency', 'Issue variance minor', 'Exception'],
      ...report.invoices.flatMap((row) => row.exceptions.map((code) =>
        [row.number, row.reservation, row.issuedAt, row.currency, row.issueVariance, code]))];
    return exportCsv(req, res, kind, report.from, report.through, rows);
  }
  const rows = kind === 'invoices' ? [
    ['Invoice', 'Reservation', 'Issued UTC', 'Currency', 'Room minor', 'Fees minor', 'Discount minor', 'Tax minor', 'Deposits minor',
      'Payments at issue minor', 'Refunds at issue minor', 'Issued total minor', 'Issued net paid minor', 'Issued balance minor',
      'Later payments minor', 'Later refunds minor', 'Later credits minor', 'Closing balance minor', 'Issue variance minor', 'Legacy breakdown', 'Breakdown source', 'Recognized revenue minor'],
    ...report.invoices.map((row) => [row.number, row.reservation, row.issuedAt, row.currency, row.issuedBreakdown?.room,
      row.issuedBreakdown?.fees, row.issuedBreakdown?.discounts, row.issuedBreakdown?.tax, row.issuedBreakdown?.deposits,
      row.issuedBreakdown?.payments, row.issuedBreakdown?.refunds, row.issuedTotal, row.issuedPaid, row.originalBalance,
      row.movement.payment, row.movement.refund, row.movement.credit, row.balance, row.issueVariance, row.legacyBreakdown, row.breakdownSource, row.recognizedRevenue])
  ] : [
    ['Invoice', 'Reservation', 'Transaction ID', 'UTC timestamp', 'Type', 'Currency', 'Amount minor', 'Reason', 'Actor ID', 'Request key'],
    ...report.invoices.flatMap((row) => row.transactions.map((item) => [row.number, row.reservation, item._id,
      item.createdAt, item.kind, item.currency, item.amount, item.reason, item.actor, item.requestKey]))
  ];
  return exportCsv(req, res, kind, report.from, report.through, rows);
});
