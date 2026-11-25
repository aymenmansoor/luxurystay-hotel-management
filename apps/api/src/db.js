import mongoose from 'mongoose';
import { Branch, Inquiry, Review, Room, RoomType, Session, Subscription, User } from './models.js';

import { Complaint } from './complaints.js';
import { Offer } from './offer-model.js';
import { Media } from './media.js';
import { Settlement } from './settlement.js';
import { AccountToken } from './accounts.js';
import { LoyaltyAccount, LoyaltyEntry } from './loyalty.js';
import { operationModels } from './operations-models.js';
import { BookingAdjustment, Payment, Reservation, RoomNight } from './reservation-models.js';

export const localUri = 'mongodb://127.0.0.1:27017/luxurystay?replicaSet=rs0';

export async function connect(uri = process.env.MONGODB_URI ?? localUri, options = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, ...options });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await mongoose.disconnect();
    throw new Error('MongoDB must support transactions. Configure a replica set or use a sharded cluster.');
  }
  await Promise.all([Branch, Inquiry, Review, Room, RoomType, Session, Subscription, User, Payment, BookingAdjustment, Reservation, RoomNight, ...operationModels, AccountToken, LoyaltyAccount, LoyaltyEntry, Settlement, Media, Complaint, Offer].map((model) => model.init()));
}
