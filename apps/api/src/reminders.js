import { Branch, User } from './models.js';
import { Audit } from './operations-models.js';
import { Reservation } from './reservation-models.js';
import { localDay } from './reservation-service.js';

export async function syncReminders(now = new Date()) {
  const branches = await Branch.find().select('timeZone').lean();
  for (const branch of branches) {
    const today = localDay(branch.timeZone, now);
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const rows = await Reservation.find({ branch: branch._id, $or: [
      { status: 'confirmed', checkIn: tomorrow }, { status: 'checked-in', checkOut: today }
    ] }).select('status guest reference checkIn checkOut contactEmail').lean();
    for (const row of rows) {
      const arrival = row.status === 'confirmed';
      const action = arrival ? 'booking.arrival-reminder' : 'booking.departure-reminder';
      const resource = row.reference;
      const date = arrival ? row.checkIn : row.checkOut;
      const email = row.contactEmail ?? (await User.findById(row.guest).select('email').lean())?.email;
      await Audit.updateOne({ dedupeKey: action + ':' + resource + ':' + date }, { $setOnInsert: {
        action, resource, branch: branch._id, guest: row.guest, email, message: arrival
          ? 'Check-in for ' + resource + ' is tomorrow.'
          : 'Checkout for ' + resource + ' is today.'
      } }, { upsert: true });
    }
  }
}

export function startReminders() {
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await syncReminders();
    } catch {
      console.error('Hotel reminders could not be refreshed.');
    } finally {
      busy = false;
    }
  }
  void tick();
  setInterval(tick, 10 * 60_000).unref();
}
