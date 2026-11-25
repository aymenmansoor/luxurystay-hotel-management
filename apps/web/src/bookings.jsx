import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi, queryDates, useAvailability } from './api.js';
import { Settlement } from './settlement.jsx';
import { Status } from './status.jsx';

const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
const mutating = (method, values, headers) => ({ method, body: JSON.stringify(values), headers });

export function bookingReturn(value) {
  if (!value?.startsWith('/book/') || value.startsWith('//') || value.includes('\\')) return '/guest';
  try {
    const target = new URL(value, 'https://luxurystay.invalid');
    return /^\/book\/[a-z0-9-]+\/[a-z0-9-]+$/.test(target.pathname) ? target.pathname + target.search : '/guest';
  } catch {
    return '/guest';
  }
}

function useAction() {
  const [state, setState] = useState({});
  async function run(callback) {
    setState({ busy: true });
    try {
      const result = await callback();
      setState({ done: true });
      return result;
    } catch (error) {
      setState({ error: error.message, status: error.status });
    }
  }
  return [state, run];
}

function ActionError({ state }) {
  return state.error ? <p className="error" role="alert">{state.error}</p> : null;
}

function Dates({ checkIn, checkOut, children, onSubmit, label, disabled }) {
  return <form className="stay-fields" onSubmit={(event) => {
    event.preventDefault();
    onSubmit(Object.fromEntries(new FormData(event.currentTarget)));
  }}>
    <label>Check-in<input type="date" name="checkIn" defaultValue={checkIn} required /></label>
    <label>Check-out<input type="date" name="checkOut" min={checkIn} defaultValue={checkOut} required /></label>
    {children}
    <button disabled={disabled}>{label}</button>
  </form>;
}

export function Book({ user, sessionError }) {
  const { slug, type } = useParams();
  const [params, setParams] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const [dateError, setDateError] = useState('');
  const branch = useApi('/branches/' + encodeURIComponent(slug) + '/room-types');
  const live = useAvailability(slug, params, revision);
  const selection = live.data?.roomTypes.find((room) => room.slug === type);
  const [state, perform] = useAction();
  const location = useLocation();
  const navigate = useNavigate();
  const dates = queryDates(params);
  const offer = params.get('offer');
  const room = branch.data?.roomTypes.find((item) => item.slug === type);
  const signIn = '/login?' + new URLSearchParams({ next: location.pathname + location.search });

  async function hold() {
    if (!dates) return;
    const payload = { branch: slug, type, ...dates, ...(offer && { offer }) };
    const storageKey = 'luxurystay.hold:' + user.id + ':' + JSON.stringify(payload);
    const result = await perform(async () => {
      const requestKey = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestKey);
      try {
        const response = await api('/reservations/holds', mutating('POST', payload, { 'Idempotency-Key': requestKey }));
        sessionStorage.removeItem(storageKey);
        return response;
      } catch (error) {
        if (error.status === 409) {
          sessionStorage.removeItem(storageKey);
          setRevision((previous) => previous + 1);
        }
        throw error;
      }
    });
    if (result) navigate('/guest/reservations/' + result.reservation.reference, { replace: true });
  }

  return <section className="section chapter">
    <p className="eyebrow">{branch.data?.branch.name ?? 'LuxuryStay'}</p>
    <h1>{room?.name ?? 'Plan your stay'}</h1>
    <Status {...branch} />
    {branch.data && !room && <p>This room category was not found.</p>}
    {room && <>
      <Dates key={location.search} checkIn={params.get('checkIn') ?? ''} checkOut={params.get('checkOut') ?? ''} label="Check availability"
        onSubmit={(fields) => {
          if (fields.checkIn >= fields.checkOut) return setDateError('Check-out must be after check-in.');
          setDateError('');
          setParams({ ...fields, ...(offer && { offer }) }, { replace: true });
          setRevision((previous) => previous + 1);
        }}>
        <label>Guests<input type="number" name="guests" min="1" max={room.capacity} defaultValue={params.get('guests') || 1} required /></label>
      </Dates>
      {dateError && <p className="error" role="alert">{dateError}</p>}
      {live.requested && <Status {...live} />}
      {live.data && <article className="card booking-card">
        {live.data.offer && <p className="eyebrow">{live.data.offer}</p>}
        <h2>{selection?.availableRooms ? 'Available for your stay' : 'Unavailable for these dates'}</h2>
        {selection?.availableRooms > 0 ? <>
          <p>{live.data.nights} {live.data.nights === 1 ? 'night' : 'nights'} · {money(selection.total, live.data.currency)} room total
          {branch.data?.branch.taxBps > 0 && ' before ' + branch.data.branch.taxBps / 100 + '% property tax'}</p>
          {sessionError && <p className="error" role="alert">{sessionError}</p>}
          {user === null && <Link className="button" to={signIn}>Guest sign-in to continue</Link>}
          {user?.role === 'guest' && <button disabled={state.busy} onClick={hold}>{state.busy ? 'Holding room…' : 'Place room hold'}</button>}
          {user && user.role !== 'guest' && <p>Use a guest account to make an online reservation.</p>}
          <p className="muted">Availability is checked again when you place a hold. Checkout uses a simulated payment.</p>
        </> : <Link to={'/rooms?' + new URLSearchParams({ branch: slug, ...dates })}>Check other room categories</Link>}
      </article>}
      <ActionError state={state} />
    </>}
  </section>;
}

export function MyReservations() {
  const result = useApi('/reservations');
  const [view, setView] = useState('all');
  const reservations = result.data?.reservations ?? [];
  const visible = reservations.filter(({ status }) => {
    if (view === 'upcoming') return ['confirmed', 'checked-in'].includes(status);
    if (view === 'past') return status === 'checked-out';
    return true;
  });
  return <section className="section-rule reservations-list">
    <h2>My reservations</h2>
    <Status {...result} />
    {result.data && <><label>Reservation history<select value={view} onChange={(event) => setView(event.target.value)}>
      <option value="all">All reservations</option><option value="upcoming">Confirmed and checked-in stays</option>
      <option value="past">Previous stays</option>
    </select></label>
      {visible.length === 0 && <p role="status">{view === 'all' ? 'You haven’t made a reservation yet.' : 'No stays match this view.'}</p>}</>}
    <div className="grid">{visible.map((reservation) => <article className="card" key={reservation.reference}>
      <p className="eyebrow">{reservation.status.replaceAll('-', ' ')}</p>
      <h3>{reservation.branch} · {reservation.roomType}</h3>
      <p>{reservation.checkIn} to {reservation.checkOut}</p>
      <Link to={'/guest/reservations/' + reservation.reference}>View {reservation.reference}</Link>
    </article>)}</div>
  </section>;
}

function HoldCountdown({ expiresAt, onExpire }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  useEffect(() => { if (!seconds) onExpire(); }, [seconds, onExpire]);
  return <p>Room hold expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}.</p>;
}

export function ReservationDetail({ user, sessionError }) {
  const { reference } = useParams();
  const [revision, setRevision] = useState(0);
  const [expired, setExpired] = useState(false);
  const [state, perform] = useAction();
  const path = '/reservations/' + encodeURIComponent(reference);
  const result = useApi(user?.role === 'guest' ? path : null, revision);
  const booking = result.data?.reservation;
  if (sessionError) return <section className="section"><p className="error" role="alert">{sessionError}</p></section>;
  if (user === null) return <Navigate to="/login" replace />;
  if (user && user.role !== 'guest') return <Navigate to="/admin" replace />;
  async function update(suffix, method, values) {
    const response = await perform(() => api(path + suffix, mutating(method, values)));
    if (response) setRevision((value) => value + 1);
  }
  return <section className="section chapter">
    <Link to="/guest">Back to my reservations</Link>
    <h1>{booking?.status === 'confirmed' ? 'Reservation confirmed' : 'Reservation details'}</h1>
    <Status {...result} />
    {booking && <>
      <article className="card booking-card">
        <p className="eyebrow">{expired && booking.status === 'held' ? 'Expired' : booking.status.replaceAll('-', ' ')}</p>
        <h2>{booking.branch} · {booking.roomType}</h2>
        <p>Reference <strong>{booking.reference}</strong></p>
        {booking.offer && <p>Package: {booking.offer.title}{booking.offer.services?.length ? ' · ' + booking.offer.services.join(', ') : ''}</p>}
        <p>{booking.checkIn} to {booking.checkOut} · {booking.guests} {booking.guests === 1 ? 'guest' : 'guests'}</p>
        <p><strong>{money(booking.total, booking.currency)}</strong> total · {booking.paymentStatus.replaceAll('-', ' ')}</p>
        {['confirmed', 'checked-in', 'checked-out'].includes(booking.status) && <>
          <p>Show this booking QR at reception.</p>
          <img className="booking-qr" width="168" height="168" src={'/api' + path + '/qr'} alt={'Booking QR for ' + booking.reference} />
        </>}
        {booking.status === 'checked-out' && <>
          <a className="button" href={'/api' + path + '/invoice'}>Download PDF invoice</a>
          <Settlement path={path + '/settlement'} />
        </>}
        {booking.status === 'held' && !expired && <>
          <HoldCountdown expiresAt={booking.expiresAt} onExpire={() => setExpired(true)} />
          <p>This is a simulated payment. No money will be charged.</p>
          <button disabled={state.busy} onClick={() => update('/confirm', 'POST', { payment: 'simulation' })}>Simulate payment & confirm</button>
        </>}
        {(booking.status === 'expired' || (booking.status === 'held' && expired)) && <Link to={'/book/' + booking.branchSlug + '/' + booking.roomTypeSlug + '?' + new URLSearchParams({
          checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests
        })}>Check availability for a new hold</Link>}
      </article>
      {booking.canChange && <div className="booking-card">
        <h2>Change stay dates</h2>
        <p>The nightly rate stays the same. A change in nights adjusts the simulated payment total.</p>
        <Dates key={booking.revision} checkIn={booking.checkIn} checkOut={booking.checkOut} label="Save new dates" disabled={state.busy}
          onSubmit={(fields) => update('/dates', 'PUT', { ...fields, revision: booking.revision })} />
      </div>}
      {(booking.status === 'held' || booking.canChange) && <button className="plain destructive" disabled={state.busy}
        onClick={() => {
          if (window.confirm(booking.status === 'held' ? 'Release this room hold?' : 'Cancel this reservation?')) update('/cancel', 'POST', {});
        }}>{booking.status === 'held' ? 'Release hold' : 'Cancel reservation'}</button>}
      <ActionError state={state} />
    </>}
  </section>;
}
