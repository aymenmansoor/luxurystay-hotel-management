import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { Reservation } from './reservation-models.js';
import { availability, availabilityCalendar, BookingError, cancel, changeDates, confirm, createHold, serializeReservations } from './reservation-service.js';

const slug = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const offer = z.string().regex(/^[a-f0-9]{24}$/i).optional();
const dateFields = z.object({ checkIn: z.iso.date(), checkOut: z.iso.date() });
const availabilityFields = dateFields.extend({ branch: slug, offer, guests: z.coerce.number().int().min(1).max(50) });
const holdFields = dateFields.extend({ branch: slug, type: slug, offer, guests: z.number().int().min(1).max(50) });
const dateChange = dateFields.extend({ revision: z.number().int().min(0) });
const reference = z.string().regex(/^LS-[A-F0-9]{18}$/, 'Invalid reservation reference.');
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid branch ID.');
const limited = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many booking requests. Wait a moment and try again.' } });

export const reservations = Router();
reservations.get('/availability', limited, async (req, res) => {
  res.json(await availability(availabilityFields.parse(req.query)));
});

reservations.get('/availability/calendar', limited, async (req, res) => {
  const fields = z.object({ branch: slug, type: slug, start: z.iso.date().optional(),
    days: z.coerce.number().int().min(1).max(30).default(14), guests: z.coerce.number().int().min(1).max(50).default(1) });
  res.json(await availabilityCalendar(fields.parse(req.query)));
});

reservations.use('/reservations', authenticate, allowRoles('guest'));
reservations.get('/reservations', async (req, res) => {
  const rows = await Reservation.find({ guest: req.user.id }).sort({ createdAt: -1 }).limit(100);
  res.json({ reservations: await serializeReservations(rows) });
});
reservations.get('/reservations/:reference', async (req, res) => {
  const row = await Reservation.findOne({ reference: reference.parse(req.params.reference), guest: req.user.id });
  if (!row) throw new BookingError(404, 'Reservation not found.');
  await respond(res, row);
});
reservations.post('/reservations/holds', limited, async (req, res) => {
  const key = z.string().uuid().parse(req.get('Idempotency-Key'));
  await respond(res, await createHold(req.user.id, holdFields.parse(req.body), key), 201);
});
reservations.post('/reservations/:reference/confirm', limited, async (req, res) => {
  z.object({ payment: z.literal('simulation') }).parse(req.body);
  await respond(res, await confirm(req.user.id, reference.parse(req.params.reference)));
});
reservations.post('/reservations/:reference/cancel', limited, async (req, res) => {
  await respond(res, await cancel(req.user.id, reference.parse(req.params.reference)));
});
reservations.put('/reservations/:reference/dates', limited, async (req, res) => {
  await respond(res, await changeDates(req.user.id, reference.parse(req.params.reference), dateChange.parse(req.body)));
});

reservations.get('/staff/branches/:branchId/reservations', authenticate,
  allowRoles('super-admin', 'branch-manager', 'receptionist'), async (req, res) => {
    const branch = id.parse(req.params.branchId);
    if (req.user.role !== 'super-admin' && !req.user.branches.some((value) => String(value) === branch)) {
      throw new BookingError(404, 'Branch not found.');
    }
    const rows = await Reservation.find({ branch, $or: [
      { status: { $in: ['confirmed', 'cancelled', 'checked-in', 'checked-out', 'no-show'] } },
      { status: 'held', createdBy: { $exists: true }, expiresAt: { $gt: new Date() } }
    ] })
      .sort({ checkIn: -1 }).limit(100);
    res.json({ reservations: await serializeReservations(rows, { staff: true }) });
  });

async function respond(res, reservation, status = 200) {
  const [body] = await serializeReservations([reservation]);
  res.status(status).json({ reservation: body });
}
