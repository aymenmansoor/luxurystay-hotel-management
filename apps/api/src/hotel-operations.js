import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, allowRoles } from './auth.js';
import { Branch, Review, Room, RoomType, User } from './models.js';
import { Audit, Cleaning, CleaningShift, Invoice, Maintenance, NotificationState, PriceDecision, ServiceRequest, event, priorities } from './operations-models.js';
import { Complaint } from './complaints.js';
import { Settlement } from './settlement.js';
import { BookingAdjustment, Payment, Reservation, RoomNight } from './reservation-models.js';
import { BookingError, localDay } from './reservation-service.js';
import { conflict, deskRoles, managers, objectId, reference, scope, scopedBranch, staffRoles } from './desk.js';

const day = 86400000;
const minute = 60000;
const cleaningRoles = [...managers, 'housekeeping'];
const maintenanceRoles = [...managers, 'maintenance'];
const serviceRoles = [...deskRoles, 'housekeeping', 'maintenance'];
const activeTasks = ['pending', 'assigned', 'in-progress', 'reopened'];
const dirtyTasks = [...activeTasks, 'completed'];
const services = {
  'room-service': 'Front desk', 'wake-up': 'Front desk', transport: 'Front desk',
  laundry: 'Housekeeping', towels: 'Housekeeping', amenities: 'Housekeeping', cleaning: 'Housekeeping',
  assistance: 'Front desk', maintenance: 'Maintenance', other: 'Front desk'
};
const note = z.string().trim().max(500);
const priority = z.enum(priorities);
const path = '/properties/:branchId';

async function byBranch(Model, id, branch, session) {
  const row = await Model.findOne({ _id: objectId.parse(id), branch }).session(session);
  if (!row) throw new BookingError(404, 'Record not found.');
  return row;
}

async function worker(id, role, branch, session = null) {
  if (!await User.exists({ _id: id, branches: branch, role, active: true }).session(session)) {
    conflict('Choose an active team member assigned to this property.');
  }
}

async function onShift(branch, session = null) {
  const now = new Date();
  return CleaningShift.find({ branch, start: { $lte: now }, end: { $gt: now } }).session(session).distinct('worker');
}

async function roomStatus(room, status, session) {
  room.status = status;
  room.allocationVersion = (room.allocationVersion ?? 0) + 1;
  await room.save({ session });
}

async function log(req, action, resource, message, session, extra = {}) {
  return event({ branch: req.branch.id, actor: req.user.id, action, resource: String(resource), message, ...extra }, session);
}

export const hotel = Router();
hotel.use(path, authenticate, allowRoles(...staffRoles), scopedBranch);
hotel.get(path + '/team', allowRoles(...managers, 'housekeeping', 'maintenance'), async (req, res) => {
  const team = await User.find({ active: true, branches: req.branch.id,
    role: { $in: ['housekeeping', 'maintenance'] } }).select('name role').sort('name').lean();
  res.json({ team });
});
hotel.get(path + '/shifts', allowRoles(...managers), async (req, res) => {
  const shifts = await CleaningShift.find({ branch: req.branch.id }).sort('start').lean();
  res.json({ shifts });
});
hotel.put(path + '/shifts/:id', allowRoles(...managers), async (req, res) => {
  const workerId = objectId.parse(req.params.id);
  const input = z.object({ start: z.iso.datetime(), end: z.iso.datetime() }).parse(req.body);
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (end <= start || end - start > 24 * 60 * 60 * 1000) conflict('Set a shift lasting up to 24 hours.');
  const shift = await mongoose.connection.transaction(async (session) => {
    await worker(workerId, 'housekeeping', req.branch.id, session);
    const result = await CleaningShift.findOneAndUpdate({ branch: req.branch.id, worker: workerId },
      { $set: { start, end } }, { upsert: true, returnDocument: 'after', session });
    await log(req, 'cleaning.shift', result.id, 'Housekeeping shift updated.', session);
    return result;
  });
  res.json({ shift });
});
hotel.put(path + '/layout/:id', allowRoles(...managers), async (req, res) => {
  const input = z.object({ row: z.number().int().min(1).max(25), column: z.number().int().min(1).max(12),
    width: z.number().int().min(1).max(6).optional(), height: z.number().int().min(1).max(6).optional()
  }).parse(req.body);
  const right = input.column + (input.width ?? 1);
  const bottom = input.row + (input.height ?? 1);
  if (right > 13 || bottom > 26) conflict('The room must fit inside the floor grid.');
  try {
    const room = await mongoose.connection.transaction(async (session) => {
      const item = await byBranch(Room, req.params.id, req.branch.id, session);
      await Branch.updateOne({ _id: req.branch.id }, { $inc: { layoutRevision: 1 } }, { session });
      const neighbours = await Room.find({ branch: req.branch.id, floor: item.floor, _id: { $ne: item.id },
        'layout.row': { $exists: true }, 'layout.column': { $exists: true } }).select('layout').session(session);
      if (neighbours.some(({ layout }) => input.column < layout.column + (layout.width ?? 1) && right > layout.column &&
        input.row < layout.row + (layout.height ?? 1) && bottom > layout.row)) conflict('That room would overlap another room on this floor.');
      item.layout = input;
      await item.save({ session });
      await log(req, 'room.layout', item.id, 'Digital Twin room position was updated.', session);
      return item;
    });
    res.json({ room });
  } catch (error) {
    if (error.code === 11000) conflict('That position is already used on this floor.');
    throw error;
  }
});

hotel.get(path + '/cleaning', allowRoles(...deskRoles, 'housekeeping'), async (req, res) => {
  const filter = { branch: req.branch.id };
  if (req.user.role === 'housekeeping') filter.$or = [{ assigned: req.user.id }, { assigned: null }];
  const tasks = await Cleaning.find(filter).populate('room', 'number floor status').populate('assigned', 'name')
    .sort({ createdAt: -1 }).limit(100).lean();
  res.json({ tasks });
});
hotel.post(path + '/cleaning', allowRoles(...managers), async (req, res) => {
  const input = z.object({ room: objectId, priority, note: note.optional() }).parse(req.body);
  const task = await mongoose.connection.transaction(async (session) => {
    const room = await byBranch(Room, input.room, req.branch.id, session);
    if (['occupied', 'maintenance', 'out-of-service'].includes(room.status)) conflict('This room cannot enter cleaning now.');
    if (await Cleaning.exists({ room: room.id, status: { $in: dirtyTasks } }).session(session)) conflict('An open cleaning task already exists.');
    await roomStatus(room, 'dirty', session);
    const [task] = await Cleaning.create([{ ...input, branch: req.branch.id }], { session });
    await log(req, 'cleaning.created', task.id, 'A cleaning task was opened for room ' + room.number + '.', session);
    return task;
  });
  res.status(201).json({ task });
});
hotel.post(path + '/cleaning/:id', allowRoles(...cleaningRoles), async (req, res) => {
  const input = z.object({ action: z.enum(['assign', 'start', 'complete', 'inspect', 'reopen', 'priority']),
    assigned: objectId.optional(), priority: priority.optional(), note: note.optional() }).parse(req.body);
  const task = await mongoose.connection.transaction(async (session) => {
    const task = await byBranch(Cleaning, req.params.id, req.branch.id, session);
    const room = await byBranch(Room, String(task.room), req.branch.id, session);
    const { action } = input;
    if (req.user.role === 'housekeeping') {
      if (!['start', 'complete'].includes(action) || (task.assigned && String(task.assigned) !== req.user.id)) {
        throw new BookingError(403, 'Only a manager or the assigned cleaner can perform this action.');
      }
    }
    if (['occupied', 'maintenance', 'out-of-service'].includes(room.status)) conflict('The room is currently blocked from cleaning.');
    if (action === 'assign') {
      if (!['pending', 'assigned', 'reopened'].includes(task.status) || !input.assigned) conflict('Choose a worker for a pending task.');
      await worker(input.assigned, 'housekeeping', req.branch.id, session);
      if (!(await onShift(req.branch.id, session)).some((id) => String(id) === input.assigned)) {
        conflict('Choose a cleaner whose shift is currently active.');
      }
      task.assigned = input.assigned;
      task.status = 'assigned';
    }
    if (action === 'priority') {
      if (!input.priority || !activeTasks.includes(task.status)) conflict('Choose a priority for an active task.');
      task.priority = input.priority;
    }
    if (action === 'start') {
      if (!['pending', 'assigned', 'reopened'].includes(task.status)) conflict('The cleaning task is already underway or closed.');
      task.status = 'in-progress';
      if (!task.assigned && req.user.role === 'housekeeping') {
        if (!(await onShift(req.branch.id, session)).some((id) => String(id) === req.user.id)) {
          conflict('An active housekeeping shift is required to take this task.');
        }
        task.assigned = req.user.id;
      }
      task.startedAt = new Date();
      const history = await Cleaning.find({ branch: req.branch.id, room: room.id, status: 'inspected',
        startedAt: { $exists: true }, completedAt: { $exists: true } }).sort({ updatedAt: -1 }).limit(15).session(session);
      task.estimateAt = new Date(Date.now() + duration(history, 35) * minute);
      await roomStatus(room, 'cleaning', session);
    }
    if (action === 'complete') {
      if (task.status !== 'in-progress') conflict('Start the task before completing it.');
      task.status = 'completed';
      task.completedAt = new Date();
      await roomStatus(room, 'cleaning', session);
    }
    if (action === 'inspect') {
      if (task.status !== 'completed') conflict('Only completed cleaning can be inspected.');
      task.status = 'inspected';
      task.inspectedAt = new Date();
      await roomStatus(room, 'inspected', session);
    }
    if (action === 'reopen') {
      if (!['completed', 'inspected'].includes(task.status) || !input.note?.trim()) conflict('Enter a reason to reopen completed cleaning.');
      if (await Cleaning.exists({ room: room.id, _id: { $ne: task.id }, status: { $in: dirtyTasks } }).session(session)) {
        conflict('A newer cleaning task is already active.');
      }
      task.status = 'reopened';
      task.startedAt = undefined;
      task.completedAt = undefined;
      task.inspectedAt = undefined;
      task.estimateAt = undefined;
      await roomStatus(room, 'dirty', session);
    }
    if (input.note) task.note = input.note;
    await task.save({ session });
    await log(req, 'cleaning.' + action, task.id, action === 'inspect' ? 'Room ' + room.number + ' is ready.' :
      'Cleaning for room ' + room.number + ' changed to ' + task.status + '.',
    session, action === 'assign' ? { recipient: task.assigned, email: (await User.findById(task.assigned).select('email').session(session))?.email } : {});
    return task;
  });
  res.json({ task });
});

function impactedStays(branch, room, today, session = null) {
  return Reservation.find({ branch, room, $or: [
    { status: 'checked-in' },
    { status: 'confirmed', checkOut: { $gt: today } },
    { status: 'held', expiresAt: { $gt: new Date() } }
  ] }).select('reference status checkIn checkOut').session(session);
}

hotel.get(path + '/maintenance', allowRoles(...deskRoles, 'maintenance'), async (req, res) => {
  const issues = await Maintenance.find({ branch: req.branch.id }).populate('room', 'number floor').populate('assigned', 'name')
    .sort({ createdAt: -1 }).limit(100).lean();
  if (deskRoles.includes(req.user.role)) {
    const today = localDay(req.branch.timeZone);
    for (const issue of issues) {
      if (issue.blocking && issue.status !== 'resolved' && issue.room) {
        issue.affected = await impactedStays(req.branch.id, issue.room._id, today).lean();
      }
    }
  }
  res.json({ issues });
});
hotel.post(path + '/maintenance', allowRoles(...deskRoles, 'maintenance'), async (req, res) => {
  const input = z.object({
    room: objectId, summary: z.string().trim().min(3).max(500), equipment: note.optional(),
    priority, blocking: z.boolean(), emergency: z.boolean().default(false), scheduledFor: z.iso.datetime().optional()
  }).parse(req.body);
  const issue = await mongoose.connection.transaction(async (session) => {
    const room = await byBranch(Room, input.room, req.branch.id, session);
    if (input.emergency && !input.blocking) conflict('An emergency room restriction must block inventory.');
    const today = localDay(req.branch.timeZone);
    if (input.blocking) {
      if (!input.emergency && ['occupied', 'out-of-service'].includes(room.status)) conflict('Move the guest or unblock the room first.');
      const existing = await RoomNight.exists({
        room: room.id, date: { $gte: localDay(req.branch.timeZone) },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      }).session(session);
      if (existing && !input.emergency) conflict('Reassign upcoming stays before blocking this room.');
      await roomStatus(room, 'maintenance', session);
    }
    const [issue] = await Maintenance.create([{ ...input, branch: req.branch.id }], { session });
    const impacted = input.emergency ? await impactedStays(req.branch.id, room.id, today, session) : [];
    await log(req, input.emergency ? 'maintenance.emergency' : 'maintenance.opened', issue.id,
      (input.emergency ? 'Emergency room block. ' + impacted.length + ' booking(s) need review for room ' : 'Maintenance was reported for room ') +
      room.number + '.', session);
    return issue;
  });
  res.status(201).json({ issue });
});
hotel.post(path + '/maintenance/:id', allowRoles(...maintenanceRoles), async (req, res) => {
  const input = z.object({ action: z.enum(['assign', 'start', 'resolve']), assigned: objectId.optional(),
    cost: z.number().int().min(0).max(100000000).optional() }).parse(req.body);
  const issue = await mongoose.connection.transaction(async (session) => {
    const issue = await byBranch(Maintenance, req.params.id, req.branch.id, session);
    if (issue.status === 'resolved') conflict('This issue is closed.');
    if (req.user.role === 'maintenance' && issue.assigned && String(issue.assigned) !== req.user.id) {
      throw new BookingError(403, 'This issue is assigned to another team member.');
    }
    if (input.action === 'assign') {
      if (!managers.includes(req.user.role) || !input.assigned) throw new BookingError(403, 'A manager must choose the assignee.');
      await worker(input.assigned, 'maintenance', req.branch.id, session);
      issue.assigned = input.assigned;
    }
    if (input.action === 'start') issue.status = 'in-progress';
    if (input.action === 'resolve') {
      issue.status = 'resolved';
      issue.resolvedAt = new Date();
      issue.cost = input.cost ?? 0;
      if (issue.blocking) {
        const room = await byBranch(Room, String(issue.room), req.branch.id, session);
        await Room.updateOne({ _id: room.id }, { $inc: { allocationVersion: 1 } }, { session });
        if (issue.emergency && await Reservation.exists({ branch: req.branch.id, room: room.id, status: 'checked-in' }).session(session)) {
          conflict('Relocate the checked-in guest before closing this emergency.');
        }
        const other = await Maintenance.exists({ _id: { $ne: issue.id }, room: room.id, blocking: true,
          status: { $ne: 'resolved' } }).session(session);
        if (!other && room.status === 'maintenance') {
          const task = await Cleaning.findOne({ room: room.id, status: { $in: dirtyTasks } }).sort({ createdAt: -1 }).session(session);
          if (task?.status === 'in-progress') {
            task.status = 'reopened';
            task.startedAt = undefined;
            await task.save({ session });
          }
          room.status = task?.status === 'completed' ? 'cleaning' : task ? 'dirty' : 'available';
          await room.save({ session });
        }
      }
    }
    await issue.save({ session });
    await log(req, 'maintenance.' + input.action, issue.id, 'Maintenance issue: ' + issue.status + '.', session,
      input.action === 'assign' ? { recipient: issue.assigned, email: (await User.findById(issue.assigned).select('email').session(session))?.email } : {});
    return issue;
  });
  res.json({ issue });
});

function duration(history, fallback) {
  const minutes = history.filter((task) => task.startedAt && task.completedAt)
    .map((task) => (task.completedAt - task.startedAt) / minute).filter((value) => value > 0 && value < 240);
  return minutes.length ? Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length) : fallback;
}

hotel.get(path + '/twin', allowRoles(...deskRoles, 'housekeeping', 'maintenance'), async (req, res) => {
  const today = localDay(req.branch.timeZone);
  const [rooms, tasks, issues, stays, history, team, shiftWorkers] = await Promise.all([
    Room.find({ branch: req.branch.id }).select('number floor status type layout').populate('type', 'name').sort('floor number').lean(),
    Cleaning.find({ branch: req.branch.id, status: { $in: dirtyTasks } }).sort({ createdAt: -1 }).lean(),
    Maintenance.find({ branch: req.branch.id, status: { $ne: 'resolved' } }).select('summary blocking status room').lean(),
    Reservation.find({ branch: req.branch.id, status: 'confirmed', checkIn: { $gte: today } }).select('room checkIn').sort('checkIn').lean(),
    Cleaning.find({ branch: req.branch.id, status: 'inspected' }).select('room startedAt completedAt estimateAt').sort({ updatedAt: -1 }).limit(200).lean(),
    User.find({ branches: req.branch.id, role: 'housekeeping', active: true }).select('name').lean(),
    onShift(req.branch.id)
  ]);
  const onDuty = new Set(shiftWorkers.map(String));
  const activeByWorker = new Map();
  for (const entry of tasks.filter((task) => activeTasks.includes(task.status) && task.assigned)) {
    const key = String(entry.assigned);
    activeByWorker.set(key, [...(activeByWorker.get(key) ?? []), entry]);
  }
  const roomFor = new Map(rooms.map((room) => [String(room._id), room]));
  res.json({ rooms: rooms.map((room) => {
    const id = String(room._id);
    const task = tasks.find((item) => String(item.room) === id);
    const byCategory = history.filter((item) => String(roomFor.get(String(item.room))?.type?._id) === String(room.type?._id));
    const estimatedMinutes = duration(byCategory, room.type?.name?.toLowerCase().includes('suite') ? 55 : 35);
    const arrival = stays.find((item) => String(item.room) === id);
    const queue = activeByWorker.get(String(task?.assigned))?.length ?? 0;
    const estimate = task && (task.estimateAt || new Date(task.createdAt.getTime() + (estimatedMinutes * Math.max(queue, 1) + 10) * minute));
    const urgency = arrival?.checkIn === today;
    const selected = task && !task.assigned && team.filter((person) => onDuty.has(String(person._id))).map((person) => {
      const assigned = activeByWorker.get(String(person._id)) ?? [];
      const sameFloor = assigned.filter((item) => roomFor.get(String(item.room))?.floor === room.floor).length;
      const minutes = assigned.reduce((sum, item) => sum + (roomFor.get(String(item.room))?.type?.name?.toLowerCase().includes('suite') ? 55 : 35), 0);
      return { id: person._id, name: person.name, workload: assigned.length, after: assigned.length + 1, sameFloor, estimatedQueueMinutes: minutes,
        score: minutes - sameFloor * (urgency || task.priority === 'urgent' ? 2 : 8) };
    }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))[0];
    return { ...room,
      displayStatus: room.status === 'available' && urgency ? 'reserved' : room.status,
      ...(deskRoles.includes(req.user.role) && { nextArrival: arrival?.checkIn }),
      maintenance: issues.filter((item) => String(item.room) === id),
      ...(task && { readiness: { task: task._id, status: task.status, priority: task.priority, estimate,
        risk: urgency ? (queue > 1 || task.status !== 'completed' ? 'elevated' : 'monitor') : 'normal',
        explanation: task.estimateAt && task.startedAt
          ? 'Estimate recorded when cleaning started: ' + Math.round((task.estimateAt - task.startedAt) / minute) + ' minutes.'
          : (byCategory.length ? 'Historical category cleaning durations' : 'Category baseline') + ': ' +
            estimatedMinutes + ' minutes; ' + queue + ' active tasks for the assigned worker.',
        ...(managers.includes(req.user.role) && selected && { recommendation: selected }) } }),
      previous: history.find((item) => String(item.room) === id)
    };
  }) });
});

async function pricing(branch) {
  const today = localDay(branch.timeZone);
  const dates = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(today) + index * day).toISOString().slice(0, 10));
  const [types, rooms, historical, decisions] = await Promise.all([
    RoomType.find({ branch: branch.id }).sort('name').lean(),
    Room.find({ branch: branch.id, status: { $nin: ['maintenance', 'out-of-service'] } }).select('type').lean(),
    Reservation.find({ branch: branch.id, status: { $in: ['confirmed', 'checked-in', 'checked-out'] },
      checkIn: { $gte: new Date(Date.parse(today) - 90 * day).toISOString().slice(0, 10), $lt: today } })
      .select('type checkIn createdAt').lean(),
    PriceDecision.aggregate([{ $match: { branch: branch._id } }, { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$type', last: { $first: '$$ROOT' } } }])
  ]);
  const nights = await RoomNight.find({ room: { $in: rooms.map((room) => room._id) }, date: { $in: dates }, expiresAt: null })
    .select('room date').lean();
  const roomType = new Map(rooms.map((room) => [String(room._id), String(room.type)]));
  const latest = new Map(decisions.map((entry) => [String(entry._id), entry.last]));
  return types.map((type) => {
    const capacity = rooms.filter((room) => String(room.type) === String(type._id)).length * dates.length;
    const booked = nights.filter((night) => roomType.get(String(night.room)) === String(type._id)).length;
    const occupancy = capacity ? booked / capacity : 0;
    const samples = historical.filter((item) => String(item.type) === String(type._id));
    const lead = samples.length ? Math.round(samples.reduce((sum, item) => sum +
      Math.max(0, (Date.parse(item.checkIn) - item.createdAt.getTime()) / day), 0) / samples.length) : null;
    const peakDates = new Set(dates.filter((date) => [5, 6].includes(new Date(date).getUTCDay())));
    const peakNights = nights.filter((night) => roomType.get(String(night.room)) === String(type._id) && peakDates.has(night.date)).length;
    const peakCapacity = capacity / dates.length * peakDates.size;
    const peakDemand = peakCapacity ? peakNights / peakCapacity : 0;
    const month = today.slice(5, 7);
    const seasonSample = samples.filter((item) => item.checkIn.slice(5, 7) === month).length;
    const historicalSignal = samples.length >= 5 && lead >= 14 && occupancy >= .4 ? .02 : 0;
    const weekendSignal = peakDemand >= .75 && peakDemand > occupancy + .1 ? .02 : 0;
    const occupancySignal = occupancy >= .8 ? .12 : occupancy >= .6 ? .06 : occupancy <= .25 && capacity ? -.07 : 0;
    const signal = Math.min(.15, occupancySignal + historicalSignal + weekendSignal);
    const prior = latest.get(String(type._id));
    const anchor = prior?.newRate === type.nightlyRate ? (prior.anchorRate ?? prior.oldRate) : type.nightlyRate;
    const recommended = Math.round(anchor * (1 + signal));
    return { type: type._id, name: type.name, current: type.nightlyRate, recommended, anchor, occupancy,
      booked, capacity, historicalSample: samples.length, averageLeadDays: lead, peakDemand, seasonSample,
      impact: (recommended - type.nightlyRate) * booked,
      explanation: (capacity ? Math.round(occupancy * 100) + '% booked over the next seven days; ' +
        Math.round(peakDemand * 100) + '% on Friday and Saturday.' : 'No bookable room inventory.') +
        ' ' + (samples.length ? samples.length + ' observed recent stays; mean lead time ' + lead + ' days; ' +
          seasonSample + ' stays in the same calendar month.' : 'Historical demand unavailable; estimate uses current occupancy.') +
        ' Rate factors: ' + Math.round(occupancySignal * 100) + '% occupancy, +' + Math.round(weekendSignal * 100) +
        '% peak demand, +' + Math.round(historicalSignal * 100) + '% lead-time signal (maximum total +15%). Impact assumes unchanged demand.' };
  });
}

hotel.get(path + '/pricing', allowRoles(...managers, 'finance'), async (req, res) => {
  const history = await PriceDecision.find({ branch: req.branch.id }).populate('type', 'name').sort({ createdAt: -1 }).limit(25).lean();
  res.json({ recommendations: await pricing(req.branch), history });
});
hotel.post(path + '/pricing', allowRoles(...managers), async (req, res) => {
  const input = z.object({ type: objectId, current: z.number().int().nonnegative(),
    recommended: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
  const proposed = (await pricing(req.branch)).find((item) => String(item.type) === input.type);
  if (!proposed || input.current !== proposed.current || input.recommended !== proposed.recommended || proposed.current === proposed.recommended) {
    conflict('The recommendation changed. Reload pricing and review again.');
  }
  const history = await mongoose.connection.transaction(async (session) => {
    const result = await RoomType.updateOne({ _id: input.type, branch: req.branch.id, nightlyRate: input.current },
      { $set: { nightlyRate: input.recommended } }, { session });
    if (!result.matchedCount) conflict('The price changed. Reload pricing and review again.');
    const [history] = await PriceDecision.create([{ branch: req.branch.id, type: input.type, actor: req.user.id,
      oldRate: input.current, newRate: input.recommended, anchorRate: proposed.anchor, reason: input.reason, occupancy: proposed.occupancy,
      sampleNights: proposed.booked }], { session });
    await log(req, 'pricing.approved', history.id, 'A price recommendation was approved for ' + proposed.name + '.', session);
    return history;
  });
  res.status(201).json({ history });
});

const department = { housekeeping: 'Housekeeping', maintenance: 'Maintenance' };
const serviceScope = (user) => department[user.role] ? { department: department[user.role] } : {};
hotel.get(path + '/services', allowRoles(...serviceRoles), async (req, res) => {
  const requests = await ServiceRequest.find({ branch: req.branch.id, ...serviceScope(req.user) })
    .populate('reservation', 'reference').sort({ createdAt: -1 }).limit(100).lean();
  res.json({ requests });
});
hotel.post(path + '/services/:id', allowRoles(...serviceRoles), async (req, res) => {
  const input = z.object({ status: z.enum(['in-progress', 'completed', 'cancelled']), priority: priority.optional(),
    completionNote: note.optional() }).parse(req.body);
  const request = await mongoose.connection.transaction(async (session) => {
    const entry = await ServiceRequest.findOne({ branch: req.branch.id, _id: objectId.parse(req.params.id),
      ...serviceScope(req.user) }).session(session);
    if (!entry) throw new BookingError(404, 'Service request not found.');
    if (input.completionNote && !['completed', 'cancelled'].includes(input.status)) conflict('Add a completion note when closing the request.');
    if (entry.status === input.status && (!input.priority || input.priority === entry.priority) &&
      (!input.completionNote || input.completionNote === entry.completionNote)) return entry;
    if (['completed', 'cancelled'].includes(entry.status) || (entry.status !== 'in-progress' && input.status === 'completed')) {
      conflict('Start the request before completing it. Closed requests cannot change.');
    }
    entry.status = input.status;
    if (input.priority) entry.priority = input.priority;
    if (['completed', 'cancelled'].includes(input.status)) {
      entry.completedAt = new Date();
      entry.completionNote = input.completionNote || undefined;
    }
    await entry.save({ session });
    const email = (await User.findById(entry.guest).select('email').session(session))?.email;
    await log(req, 'service.' + input.status, entry.id, 'Your ' + entry.category + ' request is ' + input.status + '.', session, { guest: entry.guest, email });
    return entry;
  });
  res.json({ request });
});

export const guestServices = Router();
guestServices.use('/guest', authenticate, allowRoles('guest'));
guestServices.get('/guest/services', async (req, res) => {
  const requests = await ServiceRequest.find({ guest: req.user.id }).populate('reservation', 'reference')
    .sort({ createdAt: -1 }).limit(100).lean();
  const entries = await Audit.find({ guest: req.user.id, action: /^service\./, resource: { $in: requests.map((item) => String(item._id)) } })
    .select('action resource createdAt').sort('createdAt').limit(500).lean();
  const timeline = new Map();
  for (const entry of entries) {
    if (!timeline.has(entry.resource)) timeline.set(entry.resource, []);
    timeline.get(entry.resource).push({ action: entry.action.slice(8), at: entry.createdAt });
  }
  res.json({ requests: requests.map((item) => ({ ...item, timeline: timeline.get(String(item._id)) ?? [] })) });
});
guestServices.post('/guest/services', async (req, res) => {
  const input = z.object({ reference, category: z.enum(Object.keys(services)), description: z.string().trim().min(3).max(600) }).parse(req.body);
  const request = await mongoose.connection.transaction(async (session) => {
    const stay = await Reservation.findOne({ guest: req.user.id, reference: input.reference,
      status: { $in: ['confirmed', 'checked-in'] } }).session(session);
    if (!stay) throw new BookingError(404, 'Select an active reservation.');
    await Reservation.updateOne({ _id: stay.id }, { $inc: { revision: 1 } }, { session });
    const [request] = await ServiceRequest.create([{ guest: req.user.id, branch: stay.branch, reservation: stay.id,
      category: input.category, description: input.description, department: services[input.category] }], { session });
    await event({ branch: stay.branch, actor: req.user.id, guest: req.user.id, action: 'service.requested', resource: request.id,
      message: 'Your ' + request.category + ' request was received.' }, session);
    return request;
  });
  res.status(201).json({ request });
});

guestServices.post('/guest/reviews', async (req, res) => {
  const input = z.object({ reference, rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(10).max(1200) }).parse(req.body);
  const row = await Reservation.findOne({ guest: req.user.id, reference: input.reference, status: 'checked-out' });
  if (!row) throw new BookingError(404, 'A completed stay is required.');
  const review = await mongoose.connection.transaction(async (session) => {
    const prior = await Review.findOne({ reservation: row.id }).session(session);
    if (prior) conflict('A review has already been submitted for this stay.');
    await Reservation.updateOne({ _id: row.id }, { $inc: { revision: 1 } }, { session });
    const [review] = await Review.create([{ reservation: row.id, branch: row.branch, rating: input.rating, comment: input.comment,
      displayName: req.user.name.split(' ')[0] }], { session });
    await event({ branch: row.branch, actor: req.user.id, action: 'review.submitted', resource: review.id,
      message: 'A guest review is awaiting moderation.' }, session);
    return review;
  });
  res.status(201).json({ id: review.id, approved: false });
});
hotel.get(path + '/reviews', allowRoles(...managers), async (req, res) => {
  res.json({ reviews: await Review.find({ branch: req.branch.id }).sort({ createdAt: -1 }).limit(100).lean() });
});
hotel.put(path + '/reviews/:id', allowRoles(...managers), async (req, res) => {
  const input = z.object({ approved: z.boolean() }).parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    const review = await byBranch(Review, req.params.id, req.branch.id, session);
    review.approved = input.approved;
    await review.save({ session });
    await log(req, 'review.moderated', review.id, 'Guest review visibility was updated.', session);
  });
  res.json({ approved: input.approved });
});

function propertyMidnight(date, timeZone) {
  const midnight = Date.parse(date);
  const format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  let candidate = midnight;
  for (let attempt = 0; attempt < 2; attempt++) {
    const zone = format.formatToParts(candidate).find((part) => part.type === 'timeZoneName')?.value;
    const offset = zone?.match(/GMT([+-])(\d{2}):(\d{2})/);
    candidate = midnight - (offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * minute : 0);
  }
  return new Date(candidate);
}

async function metrics(branch, length) {
  const today = localDay(branch.timeZone);
  const start = new Date(Date.parse(today) - (length - 1) * day).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(today) + day).toISOString().slice(0, 10);
  const startUtc = propertyMidnight(start, branch.timeZone);
  const [rooms, bookings, tasks, issues, reviews, requests, roomNights, payments, invoices, repairs, complaints, cashMovements] = await Promise.all([
    Room.find({ branch: branch.id }).select('status').lean(),
    Reservation.find({ branch: branch.id, $or: [
      { createdAt: { $gte: startUtc } }, { status: 'confirmed', checkIn: { $gte: today, $lt: tomorrow } }
    ] }).select('status checkIn createdAt source').lean(),
    Cleaning.find({ branch: branch.id, $or: [{ status: { $in: dirtyTasks } }, { updatedAt: { $gte: startUtc } }] })
      .select('status completedAt startedAt').lean(),
    Maintenance.countDocuments({ branch: branch.id, status: { $ne: 'resolved' } }),
    Review.find({ branch: branch.id, createdAt: { $gte: startUtc } }).select('rating comment approved').lean(),
    ServiceRequest.countDocuments({ branch: branch.id, status: { $in: ['open', 'in-progress'] } }),
    RoomNight.aggregate([
      { $match: { date: { $gte: start, $lte: today }, expiresAt: null } },
      { $lookup: { from: 'reservations', localField: 'reservation', foreignField: '_id', as: 'booking' } },
      { $match: { 'booking.branch': branch._id } },
      { $group: { _id: '$date', count: { $sum: 1 } } }
    ]),
    Payment.aggregate([
      { $match: { createdAt: { $gte: startUtc }, status: 'simulated-paid' } },
      { $unionWith: { coll: BookingAdjustment.collection.name, pipeline: [
        { $match: { createdAt: { $gte: startUtc } } },
        { $project: { reservation: 1, createdAt: 1, amount: '$delta' } }
      ] } },
      { $lookup: { from: 'reservations', localField: 'reservation', foreignField: '_id', as: 'booking' } },
      { $match: { 'booking.branch': branch._id } },
      { $group: { _id: { type: { $arrayElemAt: ['$booking.type', 0] },
        date: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: branch.timeZone } } }, amount: { $sum: '$amount' } } },
      { $lookup: { from: 'roomtypes', localField: '_id.type', foreignField: '_id', as: 'type' } },
      { $project: { amount: 1, category: { $arrayElemAt: ['$type.name', 0] } } }
    ]),
    Invoice.aggregate([
      { $match: { branch: branch._id } },
      { $lookup: { from: Settlement.collection.name, localField: '_id', foreignField: 'invoice', as: 'settlements' } },
      { $project: { balance: { $subtract: ['$balance', { $sum: { $map: {
        input: '$settlements', as: 'item', in: { $cond: [{ $in: ['$$item.kind', ['payment', 'credit']] }, '$$item.amount',
          { $multiply: ['$$item.amount', -1] }] }
      } } }] } } },
      { $match: { balance: { $gt: 0 } } }, { $group: { _id: null, amount: { $sum: '$balance' } } }
    ]),
    Maintenance.aggregate([{ $match: { branch: branch._id, status: 'resolved', resolvedAt: { $gte: startUtc } } },
      { $group: { _id: null, amount: { $sum: '$cost' } } }]),
    Complaint.countDocuments({ branch: branch.id, status: { $ne: 'resolved' } }),
    Settlement.aggregate([
      { $match: { branch: branch._id, createdAt: { $gte: startUtc } } },
      { $group: { _id: { kind: '$kind', date: { $dateToString: {
        date: '$createdAt', format: '%Y-%m-%d', timezone: branch.timeZone
      } } }, amount: { $sum: '$amount' } } }
    ])
  ]);
  const bookable = rooms.filter((room) => !['maintenance', 'out-of-service'].includes(room.status)).length;
  const occupied = rooms.filter((room) => room.status === 'occupied').length;
  const byCategory = new Map();
  const byDate = new Map();
  for (const row of payments) {
    const category = row.category ?? 'Uncategorized';
    byCategory.set(category, (byCategory.get(category) ?? 0) + row.amount);
    byDate.set(row._id.date, (byDate.get(row._id.date) ?? 0) + row.amount);
  }
  const sources = Object.fromEntries(['online', 'staff', 'walk-in'].map((source) => [source, bookings.filter((row) =>
    (row.source ?? 'online') === source && row.createdAt >= startUtc && row.status !== 'held').length]));
  const bookingDays = new Map();
  for (const row of bookings) {
    if (row.status === 'held') continue;
    const date = localDay(branch.timeZone, row.createdAt);
    bookingDays.set(date, (bookingDays.get(date) ?? 0) + 1);
  }
  const complaintTopics = Object.entries({
    cleanliness: /clean|dirty|dust|towel/i, noise: /noise|noisy|loud/i,
    maintenance: /repair|broken|leak|conditioner/i, service: /delay|staff|service|wait/i,
    dining: /breakfast|restaurant|meal|food/i
  }).map(([topic, pattern]) => ({ topic, count: reviews.filter((review) => review.rating <= 3 && pattern.test(review.comment)).length }))
    .filter((item) => item.count).sort((a, b) => b.count - a.count);
  return {
    branch: { id: branch.id, name: branch.name, currency: branch.currency }, rooms: rooms.length, occupied, bookable,
    occupancy: bookable ? occupied / bookable : 0, ready: rooms.filter((room) => ['available', 'inspected'].includes(room.status)).length,
    arrivals: bookings.filter((row) => row.checkIn === today && row.status === 'confirmed').length,
    simulatedRevenue: payments.reduce((sum, row) => sum + row.amount, 0),
    outstanding: invoices[0]?.amount ?? 0, repairCosts: repairs[0]?.amount ?? 0,
    revenueByCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })), sources,
    cancelled: bookings.filter((row) => row.status === 'cancelled' && row.createdAt >= startUtc).length,
    confirmed: bookings.filter((row) => ['confirmed', 'checked-in', 'checked-out'].includes(row.status) && row.createdAt >= startUtc).length,
    cleaningCompleted: tasks.filter((task) => task.completedAt && task.completedAt >= startUtc).length,
    cleaningPending: tasks.filter((task) => dirtyTasks.includes(task.status)).length,
    cleaningMinutes: duration(tasks.filter((task) => task.completedAt), null), issues, requests,
    reviewCount: reviews.length, averageRating: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null,
    openComplaints: complaints,
    settlementPayments: cashMovements.filter((row) => row._id.kind === 'payment').reduce((sum, row) => sum + row.amount, 0),
    settlementRefunds: cashMovements.filter((row) => row._id.kind === 'refund').reduce((sum, row) => sum + row.amount, 0),
    complaints: reviews.filter((review) => review.rating <= 2).length,
    positiveReviews: reviews.filter((review) => review.rating >= 4).length, complaintTopics,
    trend: Array.from({ length }, (_, index) => {
      const date = new Date(Date.parse(start) + index * day).toISOString().slice(0, 10);
      return { date, simulatedRevenue: byDate.get(date) ?? 0, bookedNights: roomNights.find((item) => item._id === date)?.count ?? 0,
        bookings: bookingDays.get(date) ?? 0 };
    })
  };
}

hotel.get('/command', authenticate, allowRoles(...managers, 'finance'), async (req, res) => {
  const days = z.coerce.number().int().min(7).max(30).catch(7).parse(req.query.days);
  const branches = await Branch.find(scope(req.user)).sort('name');
  const statistics = await Promise.all(branches.map((branch) => metrics(branch, days)));
  if (req.user.role !== 'super-admin') return res.json({ branches: statistics });
  const [reservations, guests] = await Promise.all([
    Reservation.countDocuments({ branch: { $in: branches.map((branch) => branch.id) },
      status: { $in: ['confirmed', 'checked-in', 'checked-out', 'cancelled', 'no-show'] } }),
    User.countDocuments({ role: 'guest', active: true })
  ]);
  const rooms = statistics.reduce((sum, branch) => sum + branch.rooms, 0);
  const bookable = statistics.reduce((sum, branch) => sum + branch.bookable, 0);
  const occupied = statistics.reduce((sum, branch) => sum + branch.occupied, 0);
  res.json({ branches: statistics, portfolio: { branches: branches.length, rooms, reservations, guests,
    occupancy: bookable ? occupied / bookable : 0 } });
});

export const notifications = Router();
notifications.use('/notifications', authenticate);
function notificationFilter(user) {
  const personal = [{ guest: user.id }, { recipient: user.id }];
  if (deskRoles.includes(user.role)) {
    personal.push({ ...(user.role === 'super-admin' ? {} : { branch: { $in: user.branches } }),
      action: { $in: ['cleaning.inspect', 'maintenance.opened', 'maintenance.emergency', 'review.submitted', 'service.requested', 'complaint.submitted'] } });
  }
  return { $or: personal };
}
notifications.get('/notifications', async (req, res) => {
  const [entries, settings] = await Promise.all([
    Audit.find(notificationFilter(req.user)).select('message action createdAt').sort({ createdAt: -1 }).limit(50).lean(),
    NotificationState.findOne({ user: req.user.id }).lean()
  ]);
  res.json({ entries, bookingEmail: settings?.bookingEmail ?? true, readThrough: settings?.readThrough });
});
notifications.put('/notifications', async (req, res) => {
  const input = z.object({ markRead: z.literal(true).optional(), bookingEmail: z.boolean().optional() }).parse(req.body);
  const changes = { ...(input.markRead && { readThrough: new Date() }),
    ...(input.bookingEmail !== undefined && { bookingEmail: input.bookingEmail }) };
  if (Object.keys(changes).length) await NotificationState.updateOne({ user: req.user.id }, { $set: changes }, { upsert: true });
  res.sendStatus(204);
});

guestServices.post('/guest/concierge', async (req, res) => {
  const input = z.object({ branch: objectId, question: z.string().trim().min(3).max(350),
    reference: reference.optional() }).parse(req.body);
  const branch = await Branch.findById(input.branch);
  if (!branch) throw new BookingError(404, 'Property not found.');
  const question = input.question.toLowerCase();
  let answer;
  let source = branch.name + ' property information';
  if (/price|availability|book|reserve/.test(question) && !/my booking|my reservation/.test(question)) {
    answer = 'Use the room catalog to check current availability and the rate for your dates.';
  } else if (/reservation|my booking|my stay/.test(question)) {
    const stay = input.reference && await Reservation.findOne({ branch: branch.id, reference: input.reference, guest: req.user.id });
    if (stay) {
      const status = stay.status === 'held' && stay.expiresAt <= new Date() ? 'expired' : stay.status;
      answer = stay.reference + ' is ' + status + '. Your stay is ' + stay.checkIn + ' to ' + stay.checkOut + ' for ' + stay.guests + ' guest(s).';
      source = 'Your reservation record';
    } else answer = 'Select one of your own reservations at this property for stay details.';
  } else if (/facility|facilities|spa|pool|gym|restaurant|dining|experience/.test(question)) {
    answer = branch.facilities.length ? branch.name + ' lists ' + branch.facilities.join(', ') + '.' : 'Ask the hotel about its current facilities.';
  } else if (/check.in|check.out|policy|policies|cancell/.test(question)) {
    answer = 'Check-in is at ' + branch.checkInTime + ', and checkout is at ' + branch.checkOutTime + ' in local time.' +
      (branch.policyNotes ? ' ' + branch.policyNotes : '') + ' Online cancellations are available before the local check-in date.';
  } else if (/address|located|direction/.test(question)) {
    answer = branch.name + ' is located at ' + (branch.address || branch.city) + '.';
  } else if (/towel|laundry|housekeeping|service|assistance|transport/.test(question)) {
    answer = 'Use the guest services form to send this request to the property. Select the relevant reservation and service.';
  } else {
    answer = 'I can find listed facilities, location, check-in policies, and details about your own reservation. For another question, contact the property.';
    source = 'Concierge routing rules';
  }
  res.json({ answer, source });
});
