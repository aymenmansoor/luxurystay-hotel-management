import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { allowRoles, authenticate } from './auth.js';
import { Branch, RoomType } from './models.js';
import { event } from './operations-models.js';
import { BookingError } from './reservation-service.js';
import { managers, objectId, scopedBranch } from './desk.js';

const { Schema, model } = mongoose;
const mediaRoot = () => resolve(process.env.MEDIA_DIRECTORY ?? '.local-media');
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const image = new Schema({
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  roomType: { type: Schema.Types.ObjectId, ref: 'RoomType' },
  key: { type: String, required: true, unique: true }, type: String, alt: String,
  source: String, rights: String, order: { type: Number, default: 100 }, sha256: String
}, { timestamps: true });
image.index({ branch: 1, roomType: 1, order: 1 });
export const Media = model('Media', image);

const metadata = z.object({
  roomType: objectId.optional(), alt: z.string().trim().min(3).max(180),
  source: z.string().trim().min(3).max(240), rights: z.string().trim().min(3).max(240),
  order: z.coerce.number().int().min(0).max(1000).default(100)
});
function recognizable(type, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return false;
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function view(item) {
  return { id: item.id, roomType: item.roomType, alt: item.alt, source: item.source, rights: item.rights,
    order: item.order, url: '/api/media/' + item.key };
}
const sorted = { order: 1, createdAt: -1 };
export const media = Router();
media.get('/media/:key', async (req, res, next) => {
  const key = z.string().regex(/^[a-f0-9]{48}$/).parse(req.params.key);
  const item = await Media.findOne({ key });
  if (!item) throw new BookingError(404, 'Image not found.');
  res.type(item.type).sendFile(item.key, { root: mediaRoot(), dotfiles: 'allow' }, (error) => {
    if (!error) return;
    next(error.code === 'ENOENT' ? new BookingError(404, 'Image file not found.') : error);
  });
});
media.get('/branches/:slug/media', async (req, res) => {
  const branch = await Branch.findOne({ slug: req.params.slug });
  if (!branch) throw new BookingError(404, 'Hotel not found.');
  const records = await Media.find({ branch: branch.id }).sort(sorted).limit(100);
  res.json({ media: records.map((item) => {
    const { id, roomType, alt, url } = view(item);
    return { id, roomType, alt, url };
  }) });
});
const property = '/staff/properties/:branchId/media';
media.use(property, authenticate, allowRoles(...managers), scopedBranch);
media.get(property, async (req, res) => {
  const records = await Media.find({ branch: req.branch.id }).sort(sorted).limit(100);
  res.json({ media: records.map(view) });
});
media.post(property, express.raw({ type: imageTypes, limit: '3mb' }), async (req, res) => {
  const input = metadata.parse(req.query);
  const type = req.is(imageTypes);
  if (!recognizable(type, req.body)) throw new BookingError(400, 'Upload a JPEG, PNG, or WebP image up to 3 MB.');
  if (input.roomType && !await RoomType.exists({ _id: input.roomType, branch: req.branch.id })) {
    throw new BookingError(400, 'Choose a category from this property.');
  }
  const key = randomBytes(24).toString('hex');
  const root = mediaRoot();
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, key), req.body, { flag: 'wx', mode: 0o600 });
  let item;
  try {
    item = await mongoose.connection.transaction(async (session) => {
      const [saved] = await Media.create([{ ...input, branch: req.branch.id, key, type,
        sha256: createHash('sha256').update(req.body).digest('hex') }], { session });
      await event({ branch: req.branch.id, actor: req.user.id, action: 'media.uploaded', resource: saved.id,
        message: 'A property image was published.' }, session);
      return saved;
    });
  } catch (error) {
    await unlink(resolve(root, key)).catch(() => {});
    throw error;
  }
  res.status(201).json({ image: view(item) });
});
media.put(property + '/:id', async (req, res) => {
  const id = objectId.parse(req.params.id);
  const input = metadata.omit({ roomType: true }).parse(req.body);
  const item = await Media.findOneAndUpdate({ _id: id, branch: req.branch.id }, { $set: input }, { returnDocument: 'after' });
  if (!item) throw new BookingError(404, 'Image not found.');
  res.json({ image: view(item) });
});
media.delete(property + '/:id', async (req, res) => {
  const id = objectId.parse(req.params.id);
  const item = await mongoose.connection.transaction(async (session) => {
    const removed = await Media.findOneAndDelete({ _id: id, branch: req.branch.id }).session(session);
    if (!removed) throw new BookingError(404, 'Image not found.');
    await event({ branch: req.branch.id, actor: req.user.id, action: 'media.unpublished', resource: removed.id,
      message: 'A property image was removed.' }, session);
    return removed;
  });
  await unlink(resolve(mediaRoot(), item.key)).catch((error) => {
    if (error.code !== 'ENOENT') console.error('Could not remove an unpublished property image file.');
  });
  res.sendStatus(204);
});
