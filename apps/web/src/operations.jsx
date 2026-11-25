import React, { lazy, Suspense, useState } from 'react';
import { api, useApi } from './api.js';
import { Settlement } from './settlement.jsx';
import { Status } from './status.jsx';
import './operations.css';

const FinanceReport = lazy(() => import('./finance.jsx').then((module) => ({ default: module.FinanceReport })));
const OfferManager = lazy(() => import('./offers.jsx').then((module) => ({ default: module.OfferManager })));
const Trend = lazy(() => import('./trend.jsx'));
const managers = ['super-admin', 'branch-manager'];
const deskRoles = [...managers, 'receptionist'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const root = (branch) => '/staff/properties/' + branch._id;
const labels = {
  'no-show': 'Record no-show', 'late-checkout': 'Approve late checkout',
  'check-in': 'Check in', 'check-out': 'Check out', verify: 'Verify guest',
  key: 'Record key issuance', 'guest-count': 'Update guest count', note: 'Save note',
  reassign: 'Reassign room', extend: 'Extend checkout', 'in-progress': 'In progress'
};
const label = (text) => labels[text] ?? text?.replaceAll('-', ' ');
const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
const today = () => new Date().toLocaleDateString('en-CA');

async function change(path, values, method = 'POST', key) {
  return api(path, { method, body: JSON.stringify(values), headers: key ? { 'Idempotency-Key': key } : undefined });
}

function useMutation(refresh) {
  const [state, setState] = useState({});
  async function run(task) {
    setState({ busy: true });
    try {
      await task();
      refresh();
      setState({ saved: true });
      return true;
    } catch (error) {
      setState({ error: error.message });
      return false;
    }
  }
  return { ...state, run };
}

function Feedback({ operation }) {
  return <>{operation.error && <p className="error" role="alert">{operation.error}</p>}
    {operation.saved && <p role="status">Saved.</p>}</>;
}

function submit(callback) {
  return (event) => {
    event.preventDefault();
    callback(Object.fromEntries(new FormData(event.currentTarget)), event.currentTarget);
  };
}

function Select({ name, title, options, required = true, defaultValue }) {
  return <label>{title}<select name={name} required={required} defaultValue={defaultValue ?? ''}>
    <option value="">Choose {title.toLowerCase()}</option>
    {options.map((choice) => {
      const [value, text] = Array.isArray(choice) ? choice : [choice, label(choice)];
      return <option key={value} value={value}>{text}</option>;
    })}
  </select></label>;
}

function FrontDesk({ branch, user, rooms }) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [lookup, setLookup] = useState('');
  const [scanError, setScanError] = useState('');
  async function scan(file) {
    if (!file) return;
    setScanError('');
    let picture;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error();
      const { default: decode } = await import('jsqr');
      picture = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1000 / Math.max(picture.width, picture.height));
      canvas.width = Math.max(1, Math.floor(picture.width * scale));
      canvas.height = Math.max(1, Math.floor(picture.height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const value = decode(frame.data, frame.width, frame.height)?.data;
      if (!/^LS-[A-F0-9]{18}$/.test(value ?? '')) throw new Error();
      setLookup(value);
      setSelected(value);
    } catch {
      setScanError('Choose a clear LuxuryStay booking QR image under 8 MB.');
    } finally {
      picture?.close();
    }
  }
  const [key, setKey] = useState(() => crypto.randomUUID());
  const refresh = () => setRevision((n) => n + 1);
  const canDesk = deskRoles.includes(user.role);
  const result = useApi(canDesk ? '/staff/branches/' + branch._id + '/reservations' : null, revision);
  const invoices = useApi(user.role === 'finance' || managers.includes(user.role) ? root(branch) + '/invoices' : null, revision);
  const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: branch.timeZone }).format(new Date());
  const [queue, setQueue] = useState('all');
  const [guestFilter, setGuestFilter] = useState('');
  const rows = result.data?.reservations ?? [];
  const views = [
    ['all', 'All records', () => true],
    ['arrivals', 'Arrivals today', (row) => row.checkIn === localDate && row.status === 'confirmed'],
    ['departures', 'Departures today', (row) => row.checkOut <= localDate && row.status === 'checked-in'],
    ['upcoming', 'Upcoming stays', (row) => row.checkIn > localDate && row.status === 'confirmed'],
    ['occupied', 'Checked-in stays', (row) => row.status === 'checked-in'],
    ['held', 'Active staff holds', (row) => row.status === 'held']
  ];
  const matchesQueue = views.find(([id]) => id === queue)[2];
  const filter = guestFilter.trim().toLowerCase();
  const visible = rows.filter((row) => matchesQueue(row) && (!filter || [row.guest, row.email].some(
    (value) => value?.toLowerCase().includes(filter)
  )));
  const categories = useApi(canDesk ? '/branches/' + branch.slug + '/room-types' : null);
  const create = useMutation(refresh);
  return <section className="ops-section">
    <h2>{canDesk ? 'Front desk' : 'Billing and invoices'}</h2>
    <form className="ops-form" onSubmit={submit(({ reference }) => setSelected(reference.trim().toUpperCase()))}>
      <label>Booking reference or scanned QR<input value={lookup} onChange={(event) => setLookup(event.target.value)} name="reference"
        placeholder="LS-…" required pattern="[Ll][Ss]-[0-9a-fA-F]{18}" /></label><button>Find reservation</button>
    </form>
    {canDesk && <label className="qr-upload">Scan a booking QR image<input type="file" accept="image/*"
      onChange={(event) => {
        void scan(event.target.files[0]);
        event.target.value = '';
      }} /></label>}
    {scanError && <p className="error" role="alert">{scanError}</p>}
    {canDesk && <details><summary>Create a staff or walk-in reservation</summary>
      <form className="ops-form" onSubmit={submit((values, form) => create.run(async () => {
        const { reservation } = await change(root(branch) + '/reservations', {
          ...values, guests: Number(values.guests), email: values.email || undefined, holdOnly: values.holdOnly === 'on'
        }, 'POST', key);
        setKey(crypto.randomUUID());
        setSelected(reservation.reference);
        form.reset();
      }))}>
        <Select name="source" title="Source" defaultValue="staff" options={['staff', 'walk-in']} />
        <label>Guest name<input name="name" required minLength="2" maxLength="120" /></label>
        <label>Guest email<input name="email" type="email" /></label>
        <Select name="type" title="Room category" options={(categories.data?.roomTypes ?? []).map((type) => [type.slug, type.name])} />
        <label>Check-in<input name="checkIn" type="date" defaultValue={today()} required /></label>
        <label>Check-out<input name="checkOut" type="date" required /></label>
        <label>Guest count<input name="guests" type="number" min="1" max="50" defaultValue="1" required /></label>
        <label className="checkbox"><input name="holdOnly" type="checkbox" /> Hold room without payment</label>
        <button disabled={create.busy}>Create reservation</button>
      </form><Feedback operation={create} />
    </details>}
    {selected && <DeskStay key={selected} branch={branch} reference={selected} canDesk={canDesk} canApproveMove={managers.includes(user.role)} canRefund={managers.includes(user.role) || user.role === 'finance'} rooms={rooms} onChange={refresh} />}
    {invoices.data?.invoices.length > 0 && <details><summary>Recent invoices and outstanding balances</summary>
      <div className="table-wrap" role="region" aria-label="Scrollable hotel records" tabIndex={0}><table>
        <thead><tr><th>Invoice</th><th>Guest</th><th>Outstanding</th><th>Net paid</th></tr></thead>
        <tbody>{invoices.data.invoices.map((invoice) => <tr key={invoice.number}>
          <td><button className="plain" onClick={() => setSelected(invoice.reference)}>{invoice.number}</button></td>
          <td>{invoice.issuedTo}</td><td>{money(invoice.balance, invoice.currency)}</td><td>{money(invoice.paid, invoice.currency)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {canDesk && <><Status {...result} />
      <label>Reservation queue<select value={queue} onChange={(event) => setQueue(event.target.value)}>
        {views.map(([id, name, filter]) => <option key={id} value={id}>{name} ({rows.filter(filter).length})</option>)}
      </select></label>
      <label>Filter this queue by guest name or email<input type="search" value={guestFilter}
        onChange={(event) => setGuestFilter(event.target.value)} /></label>
      {result.data && <p role="status">{visible.length} {visible.length === 1 ? 'reservation' : 'reservations'} match this queue.</p>}
      {visible.length > 0 && <div className="table-wrap" role="region" aria-label="Scrollable hotel records" tabIndex={0}><table>
        <thead><tr><th>Reference</th><th>Guest</th><th>Room</th><th>Arrival</th><th>Source</th><th>Status</th></tr></thead>
        <tbody>{visible.map((item) => <tr key={item.reference}>
          <td><button className="plain" onClick={() => setSelected(item.reference)}>{item.reference}</button></td>
          <td>{item.guest}</td><td>{item.room}</td><td>{item.checkIn}</td><td>{label(item.source)}</td><td>{label(item.status)}</td>
        </tr>)}</tbody></table></div>}</>}
  </section>;
}

function DeskStay({ branch, reference, canDesk, canApproveMove, canRefund, rooms, onChange }) {
  const [revision, setRevision] = useState(0);
  const [chargeKey, setChargeKey] = useState(() => crypto.randomUUID());
  const path = root(branch) + '/reservations/' + reference;
  const result = useApi(path, revision);
  const changeStay = useMutation(() => { setRevision((n) => n + 1); onChange(); });
  const row = result.data?.reservation;
  const action = (name, params) => changeStay.run(() => change(path + '/actions', { ...params, action: name }));
  return <article className="card ops-detail">
    <h3>{reference}</h3><Status {...result} />
    {row && <>
      <p><strong>{row.guest}</strong> · Room {row.room} · {row.checkIn} to {row.checkOut}</p>
      <p>{label(row.status)} · {label(row.paymentStatus)} · {row.guests} guest(s) · {money(row.total, row.currency)} room total</p>
      {row.lateCheckoutTime && <p>Approved checkout today at {row.lateCheckoutTime} (property time).</p>}
      <p>{row.verifiedAt ? 'Identity verified' : 'Identity verification pending'} · {row.keysIssued} key(s) issued</p>
      {canDesk && row.status === 'held' && <div className="actions">
        <button disabled={changeStay.busy} onClick={() => action('confirm-hold')}>Confirm hold with simulated payment</button>
        <button disabled={changeStay.busy} onClick={() => {
          if (window.confirm('Release this staff hold?')) action('cancel');
        }}>Release hold</button>
      </div>}
      {canDesk && ['confirmed', 'checked-in'].includes(row.status) && <>
        <div className="actions">
          {!row.verifiedAt && <button type="button" disabled={changeStay.busy} onClick={() => action('verify')}>Verify guest</button>}
          {row.status === 'confirmed' && <>
            <button type="button" disabled={!row.verifiedAt || changeStay.busy} onClick={() => {
              const localToday = new Intl.DateTimeFormat('sv-SE', { timeZone: branch.timeZone }).format(new Date());
              if (row.checkIn <= localToday || window.confirm('Check in early and add the intervening nights at the booked rate?')) action('check-in');
            }}>Check in</button>
            <button type="button" className="plain destructive" disabled={changeStay.busy} onClick={() => {
              if (window.confirm('Cancel this reservation and release its allocated nights?')) action('cancel');
            }}>Cancel reservation</button>
          </>}
          {row.status === 'checked-in' && <>
            <button type="button" disabled={changeStay.busy} onClick={() => action('key')}>Record key issuance</button>
            <button type="button" disabled={changeStay.busy} onClick={() => action('check-out')}>Check out & issue invoice</button>
          </>}
        </div>
        <details><summary>Stay adjustments and desk notes</summary>
          {(row.status === 'confirmed' || (row.status === 'checked-in' && rooms.some((room) => room.number === row.room && room.status === 'maintenance')))
          && <form className="ops-form" onSubmit={submit((values) => action('reassign', { ...values, note: values.note || undefined, newCheckout: values.newCheckout || undefined }))}>
            <Select name="room" title="Replacement room" options={rooms.filter((room) => !['maintenance', 'out-of-service'].includes(room.status)
              && ((canApproveMove && row.status === 'checked-in') || room.type?.name === row.roomType)
              && room.number !== row.room).map((room) => [room._id, room.number + ' · ' + room.type?.name])} />
            {row.status === 'checked-in' && canApproveMove && <>
              <label>Reason (required for manager override)<input name="note" maxLength="500" /></label>
              <label>New checkout date for overdue relocation<input name="newCheckout" type="date" /></label>
            </>}
            <button disabled={changeStay.busy}>Reassign room</button></form>}
          {row.status === 'checked-in' && <form className="ops-form" onSubmit={submit((values) => action('late-checkout', values))}>
            <label>Late checkout time (property local)<input name="lateTime" type="time" required /></label>
            <button disabled={changeStay.busy}>Approve late checkout</button>
          </form>}
          {row.status === 'confirmed' && <button type="button" className="plain destructive" disabled={changeStay.busy}
            onClick={() => { if (window.confirm('Record a no-show and release the remaining room nights?')) action('no-show'); }}>Record no-show</button>}
          <form className="ops-form" onSubmit={submit((values) => action('extend', values))}>
            <label>New checkout date<input name="newCheckout" type="date" min={row.checkOut} required /></label><button disabled={changeStay.busy}>Extend checkout</button></form>
          <form className="ops-form" onSubmit={submit((values) => action('guest-count', { guests: Number(values.guests) }))}>
            <label>Guests<input name="guests" type="number" min="1" max="50" defaultValue={row.guests} required /></label>
            <button disabled={changeStay.busy}>Update guest count</button></form>
          <form className="ops-form" onSubmit={submit((values, form) => changeStay.run(async () => {
            await change(path + '/actions', { action: 'note', note: values.note }); form.reset();
          }))}>
            <label>Desk note<input name="note" maxLength="500" required /></label><button disabled={changeStay.busy}>Save note</button></form>
          {row.deskNotes.map((entry, index) => <p key={index}>{entry.text} · {new Date(entry.at).toLocaleString()}</p>)}
        </details>
      </>}
      {['confirmed', 'checked-in'].includes(row.status) && <details><summary>Add a billing entry</summary>
        <form className="ops-form" onSubmit={submit((values, form) => changeStay.run(async () => {
          await change(path + '/charges', { ...values, amount: Math.round(Number(values.amount) * 100), requestKey: chargeKey });
          setChargeKey(crypto.randomUUID()); form.reset();
        }))}>
          <Select name="kind" title="Entry type" options={['room-service', 'extra-guest', 'laundry', 'transport', 'restaurant',
            'tax', 'discount', 'deposit', 'payment', 'refund', 'cancellation', 'other']} />
          <label>Description<input name="label" minLength="2" maxLength="120" required /></label>
          <label>Amount ({row.currency})<input name="amount" type="number" min=".01" max="1000000" step=".01" required /></label>
          <button disabled={changeStay.busy}>Record entry</button>
        </form>
        <p>Manual payments and refunds are demonstration entries.</p>
      </details>}
      {result.data.charges.length > 0 && <ul>{result.data.charges.map((entry) => <li key={entry._id}>
        {entry.label} · {money(entry.amount, row.currency)}</li>)}</ul>}
      {result.data.invoice && <>
        <a className="button" href={'/api' + path + '/invoice'}>Download PDF invoice</a>
        <Settlement path={path + '/settlement'} canRefund={canRefund} />
      </>}
    </>}<Feedback operation={changeStay} />
  </article>;
}

function ShiftEditor({ branch, team }) {
  const [revision, refresh] = useState(0);
  const path = root(branch) + '/shifts';
  const result = useApi(path, revision);
  const op = useMutation(() => refresh((n) => n + 1));
  return <details><summary>Housekeeping shifts</summary>
    <p>Set the current or next shift for an eligible cleaner. Times are entered in this device’s time zone.</p>
    <form className="ops-form" onSubmit={submit((values) => op.run(() => change(path + '/' + values.worker, {
      start: new Date(values.start).toISOString(), end: new Date(values.end).toISOString()
    }, 'PUT')))}>
      <Select name="worker" title="Cleaner" options={team.map((person) => [person._id, person.name])} />
      <label>Shift start<input name="start" type="datetime-local" required /></label>
      <label>Shift end<input name="end" type="datetime-local" required /></label>
      <button disabled={op.busy}>Save shift</button>
    </form>
    <Status {...result} /><Feedback operation={op} />
    {result.data?.shifts.length ? <ul>{result.data.shifts.map((shift) => <li key={shift._id}>
      {team.find((person) => person._id === shift.worker)?.name ?? 'Former cleaner'} ·{' '}
      {new Date(shift.start).toLocaleString()} to {new Date(shift.end).toLocaleString()}
    </li>)}</ul> : null}
  </details>;
}

function Housekeeping({ branch, user, rooms }) {
  const [revision, setRevision] = useState(0);
  const url = root(branch) + '/cleaning';
  const manager = managers.includes(user.role);
  const canClean = manager || user.role === 'housekeeping';
  const [queue, setQueue] = useState('all');
  const result = useApi(url, revision);
  const team = useApi(manager ? root(branch) + '/team' : null);
  const op = useMutation(() => setRevision((n) => n + 1));
  const action = (task, name, extra = {}) => op.run(() => change(url + '/' + task._id, { action: name, ...extra }));
  const tasks = result.data?.tasks ?? [];
  const visible = tasks.filter((task) => {
    if (queue === 'mine') return task.assigned?._id === user.id;
    if (queue === 'pending') return ['pending', 'assigned', 'reopened'].includes(task.status);
    if (queue === 'finished') return ['completed', 'inspected'].includes(task.status);
    return queue === 'all' || task.status === queue;
  });
  return <section className="ops-section"><h2>Housekeeping</h2><Status {...result} />
    {manager && <ShiftEditor branch={branch} team={(team.data?.team ?? []).filter((person) => person.role === 'housekeeping')} />}
    {manager && <details><summary>Open cleaning task</summary>
      <form className="ops-form" onSubmit={submit((values, form) => op.run(async () => { await change(url, values); form.reset(); }))}>
        <Select name="room" title="Room" options={rooms.map((room) => [room._id, room.number])} />
        <Select name="priority" title="Priority" options={priorities} defaultValue="normal" />
        <label>Notes<input name="note" maxLength="500" /></label><button disabled={op.busy}>Open task</button>
      </form></details>}
    <Feedback operation={op} />
    <label>Cleaning queue<select value={queue} onChange={(event) => setQueue(event.target.value)}>
      <option value="all">All visible tasks</option>
      {user.role === 'housekeeping' && <option value="mine">Assigned to me</option>}
      <option value="pending">Pending cleaning</option><option value="in-progress">In progress</option>
      <option value="finished">Completed or inspected</option>
    </select></label>
    {result.data && <p role="status">{visible.length} cleaning tasks in this queue.</p>}
    <div className="grid">{visible.map((task) => <article className="card" key={task._id}>
      <h3>Room {task.room?.number}</h3><p>{label(task.status)} · {task.priority} · {task.assigned?.name ?? 'Unassigned'}</p>
      {task.note && <p>{task.note}</p>}
      {task.status === 'in-progress' && task.estimateAt && <p>Estimated ready for inspection <time dateTime={task.estimateAt}>
        {new Date(task.estimateAt).toLocaleString(undefined, { timeZone: branch.timeZone })}</time> · Hotel local time</p>}
      <div className="actions">
        {canClean && ['pending', 'assigned', 'reopened'].includes(task.status) && <button disabled={op.busy} onClick={() => action(task, 'start')}>Start cleaning</button>}
        {canClean && task.status === 'in-progress' && <button disabled={op.busy} onClick={() => action(task, 'complete')}>Complete cleaning</button>}
        {manager && task.status === 'completed' && <button disabled={op.busy} onClick={() => action(task, 'inspect')}>Inspect and mark ready</button>}
      </div>
      {manager && ['pending', 'assigned', 'reopened'].includes(task.status) && <form className="ops-form" onSubmit={submit((values) => action(task, 'assign', values))}>
        <Select name="assigned" title="Cleaner" options={(team.data?.team ?? []).filter((person) => person.role === 'housekeeping').map((person) => [person._id, person.name])} />
        <button disabled={op.busy}>Assign task</button></form>}
      {manager && ['pending', 'assigned', 'reopened', 'in-progress'].includes(task.status) && <form className="ops-form" onSubmit={submit((values) => action(task, 'priority', values))}>
        <Select name="priority" title="Priority" options={priorities} defaultValue={task.priority} /><button disabled={op.busy}>Update priority</button></form>}
      {manager && ['completed', 'inspected'].includes(task.status) && <form className="ops-form" onSubmit={submit((values) => action(task, 'reopen', values))}>
        <label>Reopening reason<input name="note" maxLength="500" required /></label><button disabled={op.busy}>Reopen task</button></form>}
    </article>)}</div>
  </section>;
}

function Maintenance({ branch, user, rooms }) {
  const [revision, setRevision] = useState(0);
  const url = root(branch) + '/maintenance';
  const manager = managers.includes(user.role);
  const canChange = (issue) => manager || (user.role === 'maintenance' && (!issue.assigned || issue.assigned._id === user.id));
  const [queue, setQueue] = useState('all');
  const result = useApi(url, revision);
  const team = useApi(manager ? root(branch) + '/team' : null);
  const op = useMutation(() => setRevision((n) => n + 1));
  const action = (issue, name, extra = {}) => op.run(() => change(url + '/' + issue._id, { action: name, ...extra }));
  const visible = (result.data?.issues ?? []).filter((issue) => {
    if (queue === 'mine') return issue.assigned?._id === user.id;
    if (queue === 'priority') return issue.status !== 'resolved' && ['high', 'urgent'].includes(issue.priority);
    if (queue === 'active') return issue.status !== 'resolved';
    return queue === 'all' || issue.status === 'resolved';
  });
  return <section className="ops-section"><h2>Maintenance</h2>
    <details><summary>Report a maintenance issue</summary><form className="ops-form" onSubmit={submit((values, form) => op.run(async () => {
      const issue = { ...values, blocking: values.blocking === 'on' || values.emergency === 'on', emergency: values.emergency === 'on', scheduledFor: values.scheduledFor ? new Date(values.scheduledFor).toISOString() : undefined };
      await change(url, issue); form.reset();
    }))}>
      <Select name="room" title="Room" options={rooms.map((room) => [room._id, room.number])} />
      <label>Issue<input name="summary" minLength="3" maxLength="500" required /></label><label>Equipment<input name="equipment" /></label>
      <Select name="priority" title="Priority" options={priorities} defaultValue="normal" />
      <label>Scheduled time<input name="scheduledFor" type="datetime-local" /></label>
      <label className="checkbox"><input name="blocking" type="checkbox" /> Block room inventory now</label>
      <label className="checkbox"><input name="emergency" type="checkbox" /> Emergency block with guest relocation review</label>
      <button disabled={op.busy}>Report issue</button>
    </form></details><Feedback operation={op} /><Status {...result} />
    <label>Maintenance queue<select value={queue} onChange={(event) => setQueue(event.target.value)}>
      <option value="all">All issues</option><option value="active">Open and in progress</option>
      {user.role === 'maintenance' && <option value="mine">Assigned to me</option>}
      <option value="priority">High priority</option><option value="resolved">Repair history</option>
    </select></label>
    {result.data && <p role="status">{visible.length} maintenance issues in this queue.</p>}
    <div className="grid">{visible.map((issue) => <article className="card" key={issue._id}>
      <h3>Room {issue.room?.number}</h3><p>{issue.summary}</p>
      <p>{label(issue.status)} · {issue.priority}{issue.blocking ? ' · Blocking' : ''}</p>
      <p>{issue.assigned?.name ?? 'Unassigned'}{issue.equipment && ' · ' + issue.equipment}</p>
      {issue.scheduledFor && <p>Scheduled {new Date(issue.scheduledFor).toLocaleString()}</p>}
      {issue.emergency && issue.status !== 'resolved' && <p>Emergency block{issue.affected?.length ? ' · ' +
        issue.affected.map((row) => row.reference + ' (' + label(row.status) + ')').join(', ') : ''}. Use front-desk lookup to relocate affected stays.</p>}
      {issue.status === 'resolved' && <p>Repair cost {money(issue.cost, branch.currency)}</p>}
      {canChange(issue) && issue.status === 'open' && <button disabled={op.busy} onClick={() => action(issue, 'start')}>Start repair</button>}
      {manager && issue.status !== 'resolved' && <form className="ops-form" onSubmit={submit((values) => action(issue, 'assign', values))}>
        <Select name="assigned" title="Technician" options={(team.data?.team ?? []).filter((person) => person.role === 'maintenance').map((person) => [person._id, person.name])} />
        <button disabled={op.busy}>Assign repair</button></form>}
      {canChange(issue) && issue.status !== 'resolved' && <form className="ops-form" onSubmit={submit((values) => action(issue, 'resolve', { cost: Math.round(Number(values.cost) * 100) }))}>
        <label>Repair cost ({branch.currency})<input name="cost" type="number" min="0" max="1000000" step=".01" defaultValue="0" required /></label>
        <button disabled={op.busy}>Resolve issue</button></form>}
    </article>)}</div>
  </section>;
}

function Twin({ branch, manager }) {
  const [zoom, setZoom] = useState(100);
  const [floor, setFloor] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(null);
  const [revision, setRevision] = useState(0);
  const op = useMutation(() => setRevision((value) => value + 1));
  const result = useApi(root(branch) + '/twin', revision);
  const rooms = result.data?.rooms ?? [];
  const floors = [...new Set(rooms.map((room) => room.floor))];
  const current = floor || (floors.length ? String(floors[0]) : '');
  const displayed = rooms.filter((room) => String(room.floor) === current && (!status || room.displayStatus === status)
    && (room.number + ' ' + (room.type?.name ?? '')).toLowerCase().includes(search.toLowerCase()));
  const details = displayed.find((room) => room._id === active);
  const rec = details?.readiness?.recommendation;
  return <section className="ops-section">
    <h2>Hotel Digital Twin</h2><p>Room schematic for {branch.name}</p><Status {...result} />
    {rooms.length > 0 && <div className="ops-form">
      <label>Floor<select value={current} onChange={(event) => setFloor(event.target.value)}>
        {floors.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>
        {[...new Set(rooms.map((room) => room.displayStatus))].sort().map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Room or category<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>}
    {result.data && displayed.length === 0 && <p>No rooms match this floor and search.</p>}
    {displayed.length > 0 && <div className="table-wrap" role="region" aria-label="Scrollable floor plan" tabIndex={0}>
      <label className="floor-zoom">Floor plan zoom ({zoom}%)<input type="range" min="75" max="175" step="25"
        value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <div className="floor-plan" aria-label={'Floor ' + current} style={{ '--floor-tile-width': (7 * zoom / 100) + 'rem' }}>
      {displayed.map((room) => <button className={'room-tile state-' + room.displayStatus} key={room._id}
        style={room.layout?.row ? { gridRow: room.layout.row + ' / span ' + (room.layout.height ?? 1),
          gridColumn: room.layout.column + ' / span ' + (room.layout.width ?? 1) } : undefined}
        aria-pressed={room._id === active} onClick={() => setActive(room._id)}>
        <strong>{room.number}</strong><span>{room.type?.name}</span><small>{label(room.displayStatus)}</small>
      </button>)}
    </div></div>}
    {details && <article className="card ops-detail">
      <h3>Room {details.number}</h3>
      {manager && <details key={details._id}><summary>Set room position on this floor</summary>
        <form className="ops-form" onSubmit={submit((values) => op.run(() => change(root(branch) + '/layout/' + details._id,
          { row: Number(values.row), column: Number(values.column), width: Number(values.width), height: Number(values.height) }, 'PUT')))}>
          <label>Row<input name="row" type="number" min="1" max="25" defaultValue={details.layout?.row ?? 1} required /></label>
          <label>Column<input name="column" type="number" min="1" max="12" defaultValue={details.layout?.column ?? 1} required /></label>
          <label>Width (cells)<input name="width" type="number" min="1" max="6" defaultValue={details.layout?.width ?? 1} required /></label>
          <label>Height (cells)<input name="height" type="number" min="1" max="6" defaultValue={details.layout?.height ?? 1} required /></label>
          <button disabled={op.busy}>Save position</button>
        </form>
      </details>}
      <p>{details.type?.name} · {label(details.displayStatus)}</p>
      {details.nextArrival && <p>Next arrival {details.nextArrival}</p>}
      {details.maintenance.map((issue) => <p key={issue._id}>Maintenance: {issue.summary}{issue.blocking && ' (blocking)'}</p>)}
      {details.readiness && <>
        <h4>Room readiness estimate</h4>
        <p>{new Date(details.readiness.estimate).toLocaleString(undefined, { timeZone: branch.timeZone })} · {details.readiness.risk} risk · {details.readiness.priority} priority · Hotel local time</p>
        <p>{details.readiness.explanation}</p>
      </>}
      {details.previous?.completedAt && <p>Last cleaning finished {new Date(details.previous.completedAt).toLocaleString()}
        {details.previous.estimateAt && ' versus estimate ' + new Date(details.previous.estimateAt).toLocaleTimeString()}.</p>}
      {rec && <><h4>Suggested cleaner</h4><p>{rec.name} · {rec.workload} → {rec.after} active tasks. {rec.sameFloor} on this floor.
        {' '}Estimated queue {rec.estimatedQueueMinutes} minutes.</p>
        <button disabled={op.busy} onClick={() => op.run(() => change(root(branch) + '/cleaning/' + details.readiness.task,
          { action: 'assign', assigned: rec.id }))}>Approve assignment</button></>}
      <Feedback operation={op} />
    </article>}
  </section>;
}

function Pricing({ branch, canApprove }) {
  const [revision, setRevision] = useState(0);
  const path = root(branch) + '/pricing';
  const result = useApi(path, revision);
  const operation = useMutation(() => setRevision((n) => n + 1));
  return <section className="ops-section"><h2>Pricing recommendations</h2><Status {...result} /><Feedback operation={operation} />
    {result.data?.recommendations.length === 0 && <p>No room categories are configured.</p>}
    <div className="grid">{result.data?.recommendations.map((item) => <article className="card" key={item.type}>
      <h3>{item.name}</h3><p>{money(item.current, branch.currency)} current · <strong>{money(item.recommended, branch.currency)} suggested</strong></p>
      <p>{item.explanation}</p><p>Estimated seven-night revenue impact: {money(item.impact, branch.currency)}</p>
      {canApprove && item.current !== item.recommended && <form onSubmit={submit(({ reason }) => operation.run(() => change(path, {
        type: item.type, current: item.current, recommended: item.recommended, reason
      })))}>
        <label>Approval reason<input name="reason" minLength="3" maxLength="300" required /></label>
        <button disabled={operation.busy}>Approve new nightly rate</button></form>}
    </article>)}</div>
    {result.data?.history.length > 0 && <><h3>Approval history</h3><ul>{result.data.history.map((item) => <li key={item._id}>
      {item.type?.name}: {money(item.oldRate, branch.currency)} → {money(item.newRate, branch.currency)} · {item.reason}</li>)}</ul></>}
  </section>;
}

export function CommandCenter() {
  const [days, setDays] = useState('7');
  const [branch, setBranch] = useState('');
  const result = useApi('/staff/command?days=' + days);
  const portfolio = result.data?.portfolio;
  const visible = (result.data?.branches ?? []).filter((item) => !branch || item.branch.id === branch);
  function exportReport() {
    const csv = [['Property', 'Date', 'Reservations created', 'Booked room-nights', 'Currency', 'Net simulated booking receipts'],
      ...visible.flatMap(({ branch, trend }) => trend.map((row) => [branch.name, row.date, row.bookings, row.bookedNights, branch.currency, (row.simulatedRevenue / 100).toFixed(2)]))]
      .map((row) => row.map((value) => {
        const text = String(value);
        return '"' + (/^[=+@\-\s]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
      }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'luxurystay-booking-trends.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="ops-section command"><h2>Property performance</h2>
    <div className="ops-form"><label>Date window<select value={days} onChange={(event) => setDays(event.target.value)}>
      <option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>
      <label>Property<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All permitted properties</option>
        {result.data?.branches.map((item) => <option key={item.branch.id} value={item.branch.id}>{item.branch.name}</option>)}
      </select></label><button onClick={exportReport} disabled={!visible.length}>Export trends CSV</button></div>
    <Status {...result} />
    {portfolio && <article className="card">
      <h3>Portfolio totals</h3>
      <dl className="metrics">
        <div><dt>Properties</dt><dd>{portfolio.branches}</dd></div>
        <div><dt>Rooms</dt><dd>{portfolio.rooms}</dd></div>
        <div><dt>Reservations excluding holds</dt><dd>{portfolio.reservations}</dd></div>
        <div><dt>Active guest accounts</dt><dd>{portfolio.guests}</dd></div>
        <div><dt>Current occupancy</dt><dd>{Math.round(portfolio.occupancy * 100)}%</dd></div>
      </dl>
    </article>}
    {visible.length > 1 && <div className="table-wrap" role="region" aria-label="Compare properties table" tabIndex={0}><table>
      <caption>Compare properties</caption>
      <thead><tr><th>Property</th><th>Occupancy</th><th>Ready rooms</th><th>Arrivals today</th><th>Net simulated booking receipts</th><th>Open issues</th></tr></thead>
      <tbody>{visible.map((item) => <tr key={item.branch.id}>
        <th scope="row">{item.branch.name}</th><td>{Math.round(item.occupancy * 100)}%</td><td>{item.ready} / {item.rooms}</td>
        <td>{item.arrivals}</td><td>{money(item.simulatedRevenue, item.branch.currency)}</td><td>{item.issues}</td>
      </tr>)}</tbody>
    </table></div>}
    {visible.map((item) => <article className="card ops-detail" key={item.branch.id}>
      <h3>{item.branch.name}</h3>
      <dl className="metrics">
        <div><dt>Current occupancy</dt><dd>{Math.round(item.occupancy * 100)}%</dd></div>
        <div><dt>Rooms ready</dt><dd>{item.ready} / {item.rooms}</dd></div>
        <div><dt>Arrivals today</dt><dd>{item.arrivals}</dd></div>
        <div><dt>Net simulated booking receipts</dt><dd>{money(item.simulatedRevenue, item.branch.currency)}</dd></div>
        <div><dt>Post-checkout payments</dt><dd>{money(item.settlementPayments, item.branch.currency)}</dd></div>
        <div><dt>Post-checkout refunds</dt><dd>{money(item.settlementRefunds, item.branch.currency)}</dd></div>
        <div><dt>Open complaints</dt><dd>{item.openComplaints}</dd></div>
        <div><dt>Outstanding invoice balances</dt><dd>{money(item.outstanding, item.branch.currency)}</dd></div>
        <div><dt>Repair costs</dt><dd>{money(item.repairCosts, item.branch.currency)}</dd></div>
        <div><dt>Confirmed stays</dt><dd>{item.confirmed}</dd></div>
        <div><dt>Cancelled reservations</dt><dd>{item.cancelled}</dd></div>
        <div><dt>Completed cleaning</dt><dd>{item.cleaningCompleted}</dd></div>
        <div><dt>Pending cleaning</dt><dd>{item.cleaningPending}</dd></div>
        <div><dt>Mean cleaning time</dt><dd>{item.cleaningMinutes ?? '—'} min</dd></div>
        <div><dt>Open maintenance</dt><dd>{item.issues}</dd></div>
        <div><dt>Open guest requests</dt><dd>{item.requests}</dd></div>
        <div><dt>Guest rating</dt><dd>{item.averageRating?.toFixed(1) ?? '—'}</dd></div>
        <div><dt>Low-rated feedback</dt><dd>{item.complaints}</dd></div>
      </dl>
      <p>Booking sources: {Object.entries(item.sources).map(([name, count]) => label(name) + ' ' + count).join(' · ')}</p>
      {item.revenueByCategory.length > 0 && <p>Net simulated booking receipts by room category: {item.revenueByCategory.map((row) =>
        row.category + ' ' + money(row.amount, item.branch.currency)).join(' · ')}</p>}
      {item.reviewCount > 0 && <p>{item.positiveReviews} ratings of 4 or 5 out of {item.reviewCount} reviews.
        {item.complaintTopics.length > 0 && ' Keyword matches in reviews rated 3 or below: ' +
          item.complaintTopics.map((item) => item.topic + ' (' + item.count + ')').join(', ') + '. Review comments to verify issues.'}</p>}
      <Suspense fallback={<p role="status">Loading chart…</p>}><Trend data={item.trend} /></Suspense>
    </article>)}
  </section>;
}

function StaffRequests({ branch }) {
  const [revision, setRevision] = useState(0);
  const path = root(branch) + '/services';
  const result = useApi(path, revision);
  const operation = useMutation(() => setRevision((n) => n + 1));
  return <section className="ops-section"><h2>Guest service requests</h2><Status {...result} /><Feedback operation={operation} />
    {result.data?.requests.length === 0 && <p>No requests assigned to this workspace.</p>}
    <div className="grid">{result.data?.requests.map((entry) => <article className="card" key={entry._id}>
      <h3>{label(entry.category)}</h3><p>{entry.description}</p>
      <p>{entry.department} · {entry.reservation?.reference} · {label(entry.status)}</p>
      {['open', 'in-progress'].includes(entry.status) && <form className="ops-form" onSubmit={submit((values) => operation.run(() => change(path + '/' + entry._id, values)))}>
        <Select name="status" title="Next status" options={entry.status === 'open' ? ['in-progress', 'cancelled'] : ['completed', 'cancelled']} />
        <Select name="priority" title="Priority" options={priorities} defaultValue={entry.priority} />
        <label>Completion note visible to guest<input name="completionNote" maxLength="500" /></label>
        <button disabled={operation.busy}>Update request</button>
      </form>}
    </article>)}</div>
  </section>;
}

function FeedbackModeration({ branch }) {
  const [revision, setRevision] = useState(0);
  const path = root(branch) + '/reviews';
  const result = useApi(path, revision);
  const op = useMutation(() => setRevision((n) => n + 1));
  return <section className="ops-section"><h2>Review moderation</h2><Status {...result} /><Feedback operation={op} />
    {result.data?.reviews.length === 0 && <p>No guest reviews yet.</p>}
    <div className="grid">{result.data?.reviews.map((review) => <article className="card" key={review._id}>
      <h3>{review.rating} / 5 · {review.displayName}</h3><p>{review.comment}</p><p>{review.approved ? 'Published' : 'Private'}</p>
      <button disabled={op.busy} onClick={() => op.run(() => change(path + '/' + review._id, { approved: !review.approved }, 'PUT'))}>
        {review.approved ? 'Remove from public site' : 'Approve for public site'}</button>
    </article>)}</div>
  </section>;
}

export function Complaints({ branch }) {
  const [revision, refresh] = useState(0);
  const path = branch ? root(branch) + '/complaints' : '/guest/complaints';
  const result = useApi(path, revision);
  const stays = useApi(branch ? null : '/reservations');
  const op = useMutation(() => refresh((n) => n + 1));
  const eligible = stays.data?.reservations.filter((row) => ['confirmed', 'checked-in', 'checked-out'].includes(row.status)) ?? [];
  return <section className="ops-section"><h2>Guest complaints</h2>
    {eligible.length > 0 && <details><summary>Report a concern</summary>
      <form className="ops-form" onSubmit={submit((values, form) => op.run(async () => { await change(path, values); form.reset(); }))}>
        <Select name="reference" title="Reservation" options={eligible.map((row) => [row.reference, row.reference + ' · ' + row.branch])} />
        <Select name="category" title="Category" options={['room', 'dining', 'cleanliness', 'service', 'billing', 'other']} />
        <label>What happened?<textarea name="text" minLength="10" maxLength="1000" required /></label>
        <button disabled={op.busy}>Send concern</button>
      </form></details>}
    <Status {...result} /><Feedback operation={op} />
    {result.data?.complaints.length === 0 && <p>No complaints recorded.</p>}
    <div className="grid">{result.data?.complaints.map((item) => <article className="card" key={item._id}>
      <h3>{label(item.category)} · {label(item.status)}</h3><p>{item.reference}</p><p>{item.text}</p>
      {item.department && <p>Department · {label(item.department)}</p>}
      {item.resolution && <p>{item.resolution}</p>}
      {branch && item.status !== 'resolved' && <form className="ops-form" onSubmit={submit((values) => op.run(() => change(path + '/' + item._id, values, 'PUT')))}>
        <Select name="department" title="Department" options={['front-desk', 'housekeeping', 'maintenance', 'dining', 'finance']} defaultValue={item.department} />
        <Select name="status" title="Status" options={['investigating', 'resolved']} defaultValue="investigating" />
        <label>Resolution<textarea name="resolution" maxLength="1000" /></label>
        <button disabled={op.busy}>Update complaint</button>
      </form>}
    </article>)}</div>
  </section>;
}

function AuditTrail({ branch }) {
  const result = useApi(root(branch) + '/audit');
  return <section className="ops-section"><h2>Audit trail</h2><Status {...result} />
    {result.data?.entries.length === 0 && <p>No recorded operations yet.</p>}
    <ul>{result.data?.entries.map((entry) => <li key={entry._id}>
      {new Date(entry.createdAt).toLocaleString()} · {entry.actor?.name ?? 'System'} · {entry.action} · {entry.resource}
    </li>)}</ul>
  </section>;
}

export function Operations({ branch, rooms, user }) {
  const [section, setSection] = useState('');
  const manager = managers.includes(user.role);
  const desk = deskRoles.includes(user.role);
  const finance = user.role === 'finance';
  const cleaning = user.role === 'housekeeping';
  const technician = user.role === 'maintenance';
  const buttons = [
    [desk || finance, 'desk', finance ? 'Billing' : 'Front desk'],
    [desk || cleaning, 'cleaning', 'Housekeeping'],
    [desk || technician, 'maintenance', 'Maintenance'],
    [desk || cleaning || technician, 'twin', 'Digital Twin'],
    [manager || finance, 'reconciliation', 'Reconciliation'],
    [manager || finance, 'pricing', 'Pricing'],
    [desk || cleaning || technician, 'services', 'Guest services'],
    [manager, 'offers', 'Offers'],
    [manager, 'reviews', 'Reviews'],
    [manager, 'complaints', 'Complaints'],
    [manager, 'audit', 'Audit trail']
  ].filter(([show]) => show);
  const current = section || buttons[0]?.[1];
  return <div className="hotel-operations">
    <nav className="ops-tabs" aria-label="Hotel operations">
      {buttons.map(([, value, title]) => <button type="button" key={value} aria-pressed={current === value}
        onClick={() => setSection(value)}>{title}</button>)}
    </nav>
    {current === 'desk' && <FrontDesk branch={branch} user={user} rooms={rooms} />}
    {current === 'cleaning' && <Housekeeping branch={branch} user={user} rooms={rooms} />}
    {current === 'maintenance' && <Maintenance branch={branch} user={user} rooms={rooms} />}
    {current === 'twin' && <Twin branch={branch} manager={manager} />}
    {current === 'pricing' && <Pricing branch={branch} canApprove={manager} />}
    {current === 'services' && <StaffRequests branch={branch} />}
    {current === 'reviews' && <FeedbackModeration branch={branch} />}
    {current === 'complaints' && <Complaints branch={branch} />}
    {current === 'offers' && <Suspense fallback={<p role="status">Loading offers…</p>}><OfferManager branch={branch} /></Suspense>}
    {current === 'reconciliation' && <Suspense fallback={<p role="status">Loading reconciliation…</p>}><FinanceReport branch={branch} /></Suspense>}
    {current === 'audit' && <AuditTrail branch={branch} />}
  </div>;
}

export function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const result = useApi(open ? '/notifications' : null, revision);
  const op = useMutation(() => setRevision((n) => n + 1));
  const unread = result.data?.entries.filter((entry) => !result.data.readThrough || entry.createdAt > result.data.readThrough).length ?? 0;
  return <details className="notifications" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Notifications {unread > 0 && '(' + unread + ' unread)'}</summary>
    <Status {...result} /><Feedback operation={op} />
    {result.data && <>
      <div className="actions"><button type="button" disabled={op.busy || !unread} onClick={() => op.run(() => change('/notifications', { markRead: true }, 'PUT'))}>Mark read</button>
        <label className="checkbox"><input type="checkbox" checked={result.data.bookingEmail} disabled={op.busy}
          onChange={(event) => op.run(() => change('/notifications', { bookingEmail: event.target.checked }, 'PUT'))} /> Reservation email updates</label></div>
      {!result.data.entries.length && <p>No notifications yet.</p>}
      <ul>{result.data.entries.map((entry) => <li key={entry._id}>{entry.message} · {new Date(entry.createdAt).toLocaleString()}</li>)}</ul>
    </>}
  </details>;
}

export function GuestServices() {
  const [revision, setRevision] = useState(0);
  const result = useApi('/guest/services', revision);
  const stays = useApi('/reservations');
  const op = useMutation(() => setRevision((n) => n + 1));
  const active = stays.data?.reservations.filter((row) => ['confirmed', 'checked-in'].includes(row.status)) ?? [];
  const completed = stays.data?.reservations.filter((row) => row.status === 'checked-out') ?? [];
  return <section className="ops-section"><h2>Guest services</h2>
    <Status {...stays} />
    {stays.data && active.length === 0 && <p>Service requests are available with a confirmed or checked-in reservation.</p>}
    {active.length > 0 && <form className="ops-form" onSubmit={submit((values, form) => op.run(async () => { await change('/guest/services', values); form.reset(); }))}>
      <Select name="reference" title="Reservation" options={active.map((row) => [row.reference, row.reference + ' · ' + row.branch])} />
      <Select name="category" title="Service" options={['room-service', 'wake-up', 'laundry', 'transport', 'towels', 'amenities', 'cleaning', 'assistance', 'maintenance', 'other']} />
      <label>Request details<textarea name="description" rows="2" minLength="3" maxLength="600" required /></label>
      <button disabled={op.busy}>Send request</button>
    </form>}
    <Status {...result} />
    {result.data?.requests.length > 0 && <ul>{result.data.requests.map((entry) => <li key={entry._id}>
      <details><summary>{label(entry.category)} · {entry.reservation?.reference} · {label(entry.status)}</summary>
        {entry.completionNote && <p>{entry.completionNote}</p>}
        <ol>{entry.timeline?.map((event, index) => <li key={index}>
          {label(event.action)} · {new Date(event.at).toLocaleString()}
        </li>)}</ol>
      </details>
    </li>)}</ul>}
    {completed.length > 0 && <details><summary>Review a completed stay</summary>
      <form className="ops-form" onSubmit={submit((values, form) => op.run(async () => {
        await change('/guest/reviews', { ...values, rating: Number(values.rating) }); form.reset();
      }))}>
        <Select name="reference" title="Reservation" options={completed.map((row) => [row.reference, row.reference + ' · ' + row.branch])} />
        <Select name="rating" title="Rating" options={['5', '4', '3', '2', '1']} />
        <label>Review<textarea rows="3" name="comment" minLength="10" maxLength="1200" required /></label>
        <button disabled={op.busy}>Submit for moderation</button></form></details>}
    <Feedback operation={op} />
  </section>;
}
