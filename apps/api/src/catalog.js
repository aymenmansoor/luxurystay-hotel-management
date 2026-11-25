import mongoose from 'mongoose';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Branch, Room, RoomType, Inquiry, Subscription, Review } from './models.js';
import { authenticate, allowRoles } from './auth.js';
import { RoomNight } from './reservation-models.js';
import { BookingError, localDay } from './reservation-service.js';

const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid record ID');
const line = z.string().trim().min(1).max(160);
const optionalLine = z.string().trim().max(160).optional();
const email = z.string().trim().toLowerCase().email().max(254);
const description = z.string().trim().max(2500).optional();
const list = z.array(line).max(30).optional();
const typeFields = z.object({
  slug, name: line, capacity: z.number().int().min(1).max(50),
  nightlyRate: z.number().int().min(0).max(100000000),
  description, bed: optionalLine, size: z.number().int().min(1).max(3000).nullable().optional(), amenities: list
});
const roomFields = z.object({ number: line, floor: z.number().int().min(-10).max(250), type: id });
const branchFields = z.object({
  slug, name: line, city: line, address: optionalLine, description, facilities: list,
  contactEmail: email.optional(), phone: optionalLine,
  currency: z.enum(['AED', 'GBP', 'USD', 'EUR', 'PKR']),
  timeZone: line.refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
    catch { return false; }
  }, 'Enter a valid IANA time zone.')
});
const publicBranch = 'slug name city address description facilities contactEmail phone currency checkInTime checkOutTime policyNotes taxBps';
const publicType = 'slug name capacity nightlyRate description bed size amenities branch';

export const catalog = Router();
catalog.get('/branches', async (_req, res) => {
  res.json({ branches: await Branch.find().select(publicBranch).sort('name').lean() });
});
catalog.get('/branches/:slug/room-types', async (req, res) => {
  const branch = await Branch.findOne({ slug: req.params.slug }).select(publicBranch).lean();
  if (!branch) return res.status(404).json({ error: 'Hotel not found.' });
  const roomTypes = await RoomType.find({ branch: branch._id }).select(publicType).sort('name').lean();
  res.json({ branch, roomTypes });
});
catalog.get('/room-types', async (_req, res) => {
  const roomTypes = await RoomType.find().select(publicType).populate('branch', 'slug name city currency').sort('name').lean();
  res.json({ roomTypes: roomTypes.filter((type) => type.branch) });
});
catalog.get('/reviews', async (_req, res) => {
  const reviews = await Review.find({ approved: true }).select('displayName rating comment branch')
    .populate('branch', 'name').sort({ createdAt: -1 }).limit(30).lean();
  res.json({ reviews });
});
const formLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many submissions. Try again later.' } });
catalog.post('/contact', formLimit, async (req, res) => {
  const input = z.object({ name: line, email, branch: id, message: z.string().trim().min(10).max(3000) }).parse(req.body);
  if (!await Branch.exists({ _id: input.branch })) return res.status(400).json({ error: 'Choose an existing hotel.' });
  await Inquiry.create(input);
  res.status(201).json({ message: 'Your inquiry was received.' });
});
catalog.post('/newsletter', formLimit, async (req, res) => {
  const input = z.object({ email, consent: z.literal(true) }).parse(req.body);
  await Subscription.updateOne({ email: input.email }, { $setOnInsert: { consentedAt: new Date() } }, { upsert: true });
  res.json({ message: 'You’re on the list.' });
});

async function assignedBranch(req, res, next) {
  const branchId = id.parse(req.params.branchId);
  const filter = { _id: branchId };
  if (req.user.role !== 'super-admin') filter._id = { $eq: branchId, $in: req.user.branches };
  const branch = await Branch.findOne(filter);
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });
  req.branch = branch;
  next();
}

export const inventory = Router();
inventory.use(authenticate, allowRoles('super-admin', 'branch-manager'));
inventory.post('/branches', allowRoles('super-admin'), async (req, res) => {
  const branch = await Branch.create(branchFields.parse(req.body));
  res.status(201).json({ branch });
});
inventory.use('/branches/:branchId', assignedBranch);
inventory.put('/branches/:branchId', async (req, res) => {
  const input = branchFields.parse(req.body);
  // Keep published URLs and the currency used by existing prices stable.
  req.branch.set({ ...input, slug: req.branch.slug, currency: req.branch.currency, contactEmail: input.contactEmail });
  await req.branch.save();
  res.json({ branch: req.branch });
});
inventory.get('/branches/:branchId/room-types', async (req, res) => {
  res.json({ roomTypes: await RoomType.find({ branch: req.branch.id }).sort('name').lean() });
});
function saveRecord(Model, schema, extra) {
  return async (req, res) => {
    const input = schema.parse(req.body);
    if (extra && !await extra(input, req.branch.id)) return res.status(400).json({ error: 'Choose a room category from this property.' });
    const branch = req.branch.id;
    if (!req.params.recordId) {
      const record = await Model.create({ ...input, branch });
      return res.status(201).json({ record });
    }
    const recordId = id.parse(req.params.recordId);
    async function update(session) {
      const record = await Model.findOne({ _id: recordId, branch }).session(session);
      if (!record) throw new BookingError(404, 'Inventory record not found.');
      if (Model === RoomType) input.slug = record.slug;
      if (Model === Room && String(record.type) !== input.type) {
        const now = new Date();
        const used = await RoomNight.exists({
          room: recordId, date: { $gte: localDay(req.branch.timeZone, now) },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
        }).session(session);
        if (used) throw new BookingError(409, 'Choose a room without current or upcoming allocations before changing its category.');
      }
      if (Model === Room && record.floor !== input.floor && record.layout?.row) {
        await Branch.updateOne({ _id: branch }, { $inc: { layoutRevision: 1 } }, { session });
        // Coordinates belong to the old floor. Reposition this room in the Twin after moving it.
        record.layout = undefined;
      }
      record.set(input);
      return record.save({ session });
    }
    const record = Model === Room ? await mongoose.connection.transaction(update) : await update(null);
    res.json({ record });
  };
}
const saveType = saveRecord(RoomType, typeFields);
const saveRoom = saveRecord(Room, roomFields, (input, branch) => RoomType.exists({ _id: input.type, branch }));
inventory.post('/branches/:branchId/room-types', saveType);
inventory.put('/branches/:branchId/room-types/:recordId', saveType);
inventory.post('/branches/:branchId/rooms', saveRoom);
inventory.put('/branches/:branchId/rooms/:recordId', saveRoom);

inventory.get('/branches/:branchId/inquiries', async (req, res) => {
  const inquiries = await Inquiry.find({ branch: req.branch.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ inquiries });
});
