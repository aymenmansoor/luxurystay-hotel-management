import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { RoomType } from './models.js';
import { Offer } from './offer-model.js';
import { managers, objectId, scopedBranch } from './desk.js';
import { BookingError, localDay } from './reservation-service.js';
import { event } from './operations-models.js';

const fields = z.object({
  type: objectId, title: z.string().trim().min(3).max(100), description: z.string().trim().min(10).max(800),
  services: z.array(z.string().trim().min(1).max(80)).max(12), restrictions: z.string().trim().max(400),
  bookStart: z.iso.date(), bookEnd: z.iso.date(), stayStart: z.iso.date(), stayEnd: z.iso.date(),
  minimumNights: z.number().int().min(1).max(30), maxUses: z.number().int().min(1).max(10000),
  discountBps: z.number().int().min(100).max(9000), published: z.boolean()
}).refine((item) => item.bookStart <= item.bookEnd && item.stayStart < item.stayEnd && item.bookStart < item.stayEnd &&
  Date.parse(item.stayEnd) - Date.parse(item.stayStart) >= item.minimumNights * 86400000, 'Check booking and stay windows.');

export const offers = Router();
offers.get('/offers', async (_req, res) => {
  const rows = await Offer.find({ published: true }).populate('branch', 'name slug timeZone')
    .populate('type', 'name slug').limit(100).sort('bookEnd').lean();
  res.json({ offers: rows.filter((item) => {
    const today = item.branch && localDay(item.branch.timeZone);
    return today && item.type && item.bookStart <= today && item.bookEnd >= today && item.stayEnd > today;
  }).map(({ _id, title, description, services, restrictions, branch, type, stayStart, stayEnd, minimumNights, discountBps }) =>
    ({ _id, title, description, services, restrictions, branch: { name: branch.name, slug: branch.slug },
      type, stayStart, stayEnd, minimumNights, discountBps })) });
});
const path = '/staff/properties/:branchId/offers';
offers.use(path, authenticate, allowRoles(...managers), scopedBranch);
offers.get(path, async (req, res) => {
  res.json({ offers: await Offer.find({ branch: req.branch.id }).sort('-createdAt').limit(100).lean() });
});
async function save(req, res) {
  const input = fields.parse(req.body);
  if (!await RoomType.exists({ _id: input.type, branch: req.branch.id })) {
    throw new BookingError(400, 'Select a category from this property.');
  }
  const id = req.params.id && objectId.parse(req.params.id);
  const offer = await mongoose.connection.transaction(async (session) => {
    let item;
    if (id) {
      item = await Offer.findOneAndUpdate({ _id: id, branch: req.branch.id }, { $set: input, $inc: { revision: 1 } },
        { session, returnDocument: 'after' });
      if (!item) throw new BookingError(404, 'Offer not found.');
    } else {
      [item] = await Offer.create([{ ...input, branch: req.branch.id }], { session });
    }
    await event({ branch: req.branch.id, actor: req.user.id, action: 'offer.saved', resource: item.id,
      message: 'A property offer was updated.' }, session);
    return item;
  });
  res.status(id ? 200 : 201).json({ offer });
}
offers.post(path, save);
offers.put(path + '/:id', save);
