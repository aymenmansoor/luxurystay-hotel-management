import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const schema = new Schema({
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  type: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  title: String, description: String, services: [String], restrictions: String,
  bookStart: String, bookEnd: String, stayStart: String, stayEnd: String,
  minimumNights: Number, maxUses: Number, discountBps: Number,
  published: { type: Boolean, default: false }, revision: { type: Number, default: 0 }
}, { timestamps: true });
schema.index({ branch: 1, published: 1, bookEnd: 1 });
export const Offer = model('Offer', schema);

