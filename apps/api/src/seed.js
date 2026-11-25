import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { demoBranches, demoRoomTypes } from './demo-catalog.js';
import { connect } from './db.js';
import { Branch, Room, RoomType, User, roles } from './models.js';

if (process.env.NODE_ENV === 'production') throw new Error('The demo seed is for development only.');
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12 || Buffer.byteLength(password) > 72) {
  throw new Error('Set DEMO_PASSWORD to a local password of at least 12 characters and at most 72 bytes.');
}
try {
  await connect();
  const passwordHash = await bcrypt.hash(password, 12);
  const branches = [];
  for (const data of [
    { slug: 'dubai', name: 'LuxuryStay Dubai', city: 'Dubai', timeZone: 'Asia/Dubai', currency: 'AED' },
    { slug: 'london', name: 'LuxuryStay London', city: 'London', timeZone: 'Europe/London', currency: 'GBP' }
  ]) {
    const branch = await Branch.findOneAndUpdate({ slug: data.slug }, { $setOnInsert: { ...data, ...demoBranches[data.slug] } }, { upsert: true, returnDocument: 'after' });
    branches.push(branch);
    if (!branch.description) {
      await Branch.updateOne({ _id: branch.id, description: { $exists: false } }, { $set: demoBranches[data.slug] });
    }
    for (const [index, type] of [
      { slug: 'deluxe-king', name: 'Deluxe King', capacity: 2, nightlyRate: data.currency === 'AED' ? 96000 : 24500 },
      { slug: 'signature-suite', name: 'Signature Suite', capacity: 4, nightlyRate: data.currency === 'AED' ? 195000 : 49500 }
    ].entries()) {
      const roomType = await RoomType.findOneAndUpdate({ branch: branch.id, slug: type.slug }, { $setOnInsert: { ...type, ...demoRoomTypes[type.slug] } }, { upsert: true, returnDocument: 'after' });
      if (!roomType.description) {
        await RoomType.updateOne({ _id: roomType.id, description: { $exists: false } }, { $set: demoRoomTypes[type.slug] });
      }
      for (const offset of [1, 2]) {
        const number = String((index + 1) * 100 + offset);
        await Room.updateOne({ branch: branch.id, number }, { $setOnInsert: { type: roomType.id, floor: index + 1 } }, { upsert: true });
      }
    }
  }
  for (const role of roles) {
    await User.updateOne({ email: `${role}@demo.luxurystay.test` }, { $setOnInsert: {
      name: role.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
      passwordHash, role, branches: ['super-admin', 'guest'].includes(role) ? [] : [branches[0].id]
    } }, { upsert: true });
  }
  console.log('Demo branches, rooms and accounts are available.');
} finally {
  await mongoose.disconnect();
}
