import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi, useAvailability } from './api.js';

import { Status } from './status.jsx';

const pictures = {
  dubai: ['/images/atrium.webp', 'Sunlit hotel atrium with palms and arched windows'],
  london: ['/images/london.webp', 'A cream-stone hotel exterior in Mayfair'],
  'deluxe-king': ['/images/king.webp', 'A king bedroom with ivory linens'],
  'signature-suite': ['/images/suite.webp', 'A hotel suite with a separate sitting area'],
  'king-detail': ['/images/king-detail.webp', 'Writing desk by the king room window'],
  'suite-detail': ['/images/suite-detail.webp', 'A travertine soaking tub in the suite bathroom']
};
const faq = [
  ['How do reservations work?', 'Choose a hotel, room and dates. Sign in as a guest to place a 15-minute hold and confirm through simulated checkout.'],
  ['How do I arrange payment or cancellation?', 'Online demo payments are simulated. You can change dates or cancel a confirmed reservation from your guest account before the local check-in date.'],
  ['When can I check in or check out?', 'Contact your selected hotel to confirm its arrival and departure times and request an exception.'],
  ['Which facilities are available?', 'Each hotel page lists its own facilities. Ask the property directly about hours and any advance booking requirements.'],
  ['Can I request an accessible room or airport transfer?', 'Choose your hotel on the contact page and include your requirements in the message.']
];

function Photo({ name, className = '' }) {
  const [src, alt] = pictures[name] ?? [];
  return src ? <img className={'hotel-photo ' + className} src={src} alt={alt} loading="lazy" /> : null;
}

function Chapter({ label, title, children }) {
  return <section className="section chapter">
    {label && <p className="eyebrow">{label}</p>}
    <h1>{title}</h1>
    {children}
  </section>;
}

function HotelCard({ hotel }) {
  return <article className="editorial-card">
    <Link to={'/hotels/' + hotel.slug} aria-label={'Explore ' + hotel.name}><Photo name={hotel.slug} /></Link>
    <div className="card-copy">
      <p className="eyebrow">{hotel.city}</p>
      <h3><Link to={'/hotels/' + hotel.slug}>{hotel.name}</Link></h3>
      {hotel.description && <p>{hotel.description}</p>}
      <Link className="text-link" to={'/hotels/' + hotel.slug}>Explore hotel <span aria-hidden="true">→</span></Link>
    </div>
  </article>;
}

function roomUrl(room, branch) {
  return '/hotels/' + branch.slug + '/rooms/' + room.slug;
}

function rate(room, branch) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: branch.currency }).format(room.nightlyRate / 100);
}

function RoomCard({ room, branch = room.branch, search = '', availability }) {
  const details = roomUrl(room, branch) + search;
  return <article className="editorial-card">
    <Link to={details} aria-label={'View ' + room.name + ' at ' + branch.name}><Photo name={room.slug} /></Link>
    <div className="card-copy">
      <p className="eyebrow">{branch.name}</p>
      <h3><Link to={details}>{room.name}</Link></h3>
      <p>{room.description}</p>
      <p>{[room.bed, room.size && room.size + ' m²', 'Up to ' + room.capacity + ' guests'].filter(Boolean).join(' · ')}</p>
      <p><strong>{rate(room, branch)}</strong> per night</p>
      {availability !== undefined && <p>{availability > 0 ? availability + (availability === 1 ? ' room available' : ' rooms available') : 'Unavailable for these dates'}</p>}
      <div className="actions"><Link className="text-link" to={details}>View details</Link>
        <Link className="text-link" to={'/book/' + branch.slug + '/' + room.slug + search}>Book now →</Link></div>
    </div>
  </article>;
}

function dateMinimum() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function StaySearch({ branches }) {
  const [checkIn, setCheckIn] = useState('');
  const [error, setError] = useState('');
  function submit(event) {
    const form = new FormData(event.currentTarget);
    if (form.get('checkOut') && (!form.get('checkIn') || form.get('checkOut') <= form.get('checkIn'))) {
      event.preventDefault();
      setError('Choose an arrival date before departure.');
    } else if (form.get('checkIn') && !form.get('checkOut')) {
      event.preventDefault();
      setError('Choose a departure date.');
    }
  }
  return <form className="stay-search" action="/rooms" onSubmit={submit} onChange={() => setError('')}>
    <label>Destination<select name="branch"><option value="">All hotels</option>
      {branches.map((hotel) => <option key={hotel._id} value={hotel.slug}>{hotel.city}</option>)}
    </select></label>
    <label>Check-in<input name="checkIn" type="date" min={dateMinimum()} value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label>
    <label>Check-out<input name="checkOut" type="date" min={checkIn || dateMinimum()} /></label>
    <label>Guests<select name="guests" defaultValue="2">{[1, 2, 3, 4, 5, 6].map((count) => <option key={count}>{count}</option>)}</select></label>
    <button>Find rooms <span aria-hidden="true">→</span></button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function useSubmission(path) {
  const [state, setState] = useState({});
  async function submit(payload) {
    setState({ busy: true });
    try {
      const response = await api(path, { method: 'POST', body: JSON.stringify(payload) });
      setState({ success: response.message });
      return true;
    } catch (error) {
      setState({ error: error.message });
      return false;
    }
  }
  return [state, submit];
}

function Feedback({ state }) {
  return <>{state.error && <p className="error" role="alert">{state.error}</p>}
    {state.success && <p role="status">{state.success}</p>}</>;
}

function Newsletter() {
  const [state, submit] = useSubmission('/newsletter');
  return <section className="newsletter">
    <div><p className="eyebrow">LuxuryStay letters</p><h2>Good things worth travelling for.</h2></div>
    <form onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      if (await submit({ email: values.get('email'), consent: values.has('consent') })) form.reset();
    }}>
      <label>Email address<input type="email" name="email" placeholder="you@example.com" required /></label>
      <label className="checkbox"><input type="checkbox" name="consent" required /> I agree to receive LuxuryStay updates by email.</label>
      <button disabled={state.busy}>Subscribe</button><Feedback state={state} />
    </form>
  </section>;
}

export function Home() {
  const branches = useApi('/branches');
  const rooms = useApi('/room-types');
  const reviews = useApi('/reviews');
  const featured = Array.from(new Map((rooms.data?.roomTypes ?? []).map((room) => [room.slug, room])).values()).slice(0, 2);
  return <>
    <section className="public-hero">
      <div className="hero-content">
        <p className="eyebrow">LuxuryStay Hotels & Suites</p>
        <h1>Beyond a stay.<br /><em>Into an experience.</em></h1>
        <p>Discover considered stays in the heart of Dubai and London.</p>
        <div className="actions"><Link className="button light" to="/hotels">Explore hotels →</Link><a className="button ghost" href="#stay">Book your stay</a></div>
      </div>
    </section>
    <div className="booking-wrap" id="stay"><StaySearch branches={branches.data?.branches ?? []} /></div>
    {branches.data && rooms.data && <dl className="catalog-stats">
      <div><dt>City destinations</dt><dd>{new Set(branches.data.branches.map((hotel) => hotel.city)).size}</dd></div>
      <div><dt>Hotels</dt><dd>{branches.data.branches.length}</dd></div>
      <div><dt>Room and suite listings</dt><dd>{rooms.data.roomTypes.length}</dd></div>
    </dl>}
    <section className="section">
      <p className="eyebrow">Destinations</p><h2>Our hotels</h2>
      <Status {...branches} />
      <div className="grid">{branches.data?.branches.map((hotel) => <HotelCard key={hotel._id} hotel={hotel} />)}</div>
      {branches.data?.branches.length === 0 && <p>No hotels have been added yet.</p>}
    </section>
    <section className="section section-rule">
      <div className="section-heading"><div><p className="eyebrow">Rooms & suites</p><h2>A space of your own</h2></div><Link className="text-link" to="/rooms">View all rooms →</Link></div>
      <Status {...rooms} /><div className="grid">{featured.map((room) => <RoomCard room={room} key={room._id} />)}</div>
    </section>
    <section className="section experience">
      <div><p className="eyebrow">The LuxuryStay experience</p><h2>Make the stay yours.</h2>
        <p>Take a moment for wellness, find a table for the evening, or ask the concierge what’s worth exploring nearby.</p>
        <Link className="text-link" to="/experiences">View hotel experiences →</Link></div>
      <div><p className="eyebrow">Stay ideas</p><h2>Plan a weekend away.</h2>
        <p>Ask your hotel about dining, spa appointments, and transfers for your next city break.</p>
        <Link className="text-link" to="/contact?subject=Weekend%20stay">Ask about a stay →</Link></div>
    </section>
    <section className="section"><h2>Guest reviews</h2><ReviewList {...reviews} limit={2} />
      <Link className="text-link" to="/reviews">View guest reviews →</Link></section>
    <Newsletter />
  </>;
}

export function Hotels() {
  const { data, error } = useApi('/branches');
  const [query, setQuery] = useState('');
  const matches = data?.branches.filter((hotel) => (hotel.name + ' ' + hotel.city + ' ' + (hotel.address ?? '')).toLowerCase().includes(query.trim().toLowerCase()));
  return <Chapter label="Destinations" title="Our hotels">
    <label className="filter-field">Search by hotel or location<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <Status data={data} error={error} />
    <div className="grid">{matches?.map((hotel) => <HotelCard key={hotel._id} hotel={hotel} />)}</div>
    {matches?.length === 0 && <p>No hotels match your search.</p>}
  </Chapter>;
}

function PropertyPhotos({ branch, roomType, fallback }) {
  const result = useApi('/branches/' + encodeURIComponent(branch) + '/media');
  const photos = result.data?.media.filter((item) => roomType ? item.roomType === roomType : !item.roomType) ?? [];
  if (!photos.length) return <figure className="property-media">{fallback}<figcaption>Illustrative demo imagery</figcaption></figure>;
  return <div className="property-media">{photos.map((item) => <img className="hotel-photo" key={item.id}
    src={item.url} alt={item.alt} loading="lazy" />)}</div>;
}

export function Hotel() {
  const { slug } = useParams();
  const result = useApi('/branches/' + encodeURIComponent(slug) + '/room-types');
  if (!result.data) return <Chapter title="Hotel"><Status {...result} /></Chapter>;
  const { branch, roomTypes } = result.data;
  return <Chapter label={branch.city} title={branch.name}>
    <div className="feature-split"><PropertyPhotos branch={slug} fallback={<Photo name={slug} />} /><div>
      <p>{branch.description}</p><p>{branch.address}</p>
      {branch.phone && <p>{branch.phone}</p>}
      {branch.contactEmail && !branch.contactEmail.endsWith('.test') && <p><a href={'mailto:' + branch.contactEmail}>{branch.contactEmail}</a></p>}
      {branch.facilities?.length > 0 && <><h2>Facilities</h2><Tags list={branch.facilities} /></>}
      <Link className="button" to={'/contact?branch=' + branch.slug}>Contact this hotel</Link>
    </div></div>
    <h2>Rooms & suites</h2>
    <div className="grid">{roomTypes.map((room) => <RoomCard room={room} branch={branch} key={room._id} />)}</div>
    {!roomTypes.length && <p>No rooms have been listed for this property yet.</p>}
  </Chapter>;
}

function Tags({ list }) {
  return <ul className="tags">{list.map((item) => <li key={item}>{item}</li>)}</ul>;
}

export function Rooms() {
  const { data, error } = useApi('/room-types');
  const [params, setParams] = useSearchParams();
  const [branch, setBranch] = useState(params.get('branch') ?? '');
  const [category, setCategory] = useState('');
  const [guestCount, setGuestCount] = useState(params.get('guests') ?? '');
  const [amenity, setAmenity] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [dateError, setDateError] = useState('');
  const [currency, setCurrency] = useState(params.get('currency') ?? '');
  const availabilityParams = new URLSearchParams(params);
  availabilityParams.set('guests', guestCount || '1');
  const live = useAvailability(branch, availabilityParams);
  const available = new Map((live.data?.roomTypes ?? []).map((item) => [item.slug, item.availableRooms]));
  const rooms = data?.roomTypes ?? [];
  const branches = [...new Map(rooms.map((room) => [room.branch.slug, room.branch])).values()];
  const categories = [...new Map(rooms.map((room) => [room.slug, room.name])).entries()];
  const amenities = [...new Set(rooms.flatMap((room) => room.amenities ?? []))].sort();
  const currencies = [...new Set(rooms.map((room) => room.branch.currency))].sort();
  const matches = rooms.filter((room) => (!branch || room.branch.slug === branch)
    && (!category || room.slug === category) && (!amenity || room.amenities?.includes(amenity))
    && room.capacity >= Number(guestCount)
    && (!currency || room.branch.currency === currency)
    && (!minimum || room.nightlyRate >= Number(minimum) * 100)
    && (!maximum || room.nightlyRate <= Number(maximum) * 100));
  const search = new URLSearchParams();
  for (const key of ['checkIn', 'checkOut']) if (params.get(key)) search.set(key, params.get(key));
  if (guestCount) search.set('guests', guestCount);
  return <Chapter label="Accommodation" title="Rooms & suites">
    <form className="catalog-filters" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const arrival = fields.get('checkIn');
      const departure = fields.get('checkOut');
      if ((arrival || departure) && (!arrival || !departure || arrival >= departure)) {
        setDateError('Choose an arrival date before departure.');
        return;
      }
      setDateError('');
      const next = new URLSearchParams(params);
      for (const key of ['checkIn', 'checkOut']) {
        if (fields.get(key)) next.set(key, fields.get(key));
        else next.delete(key);
      }
      setParams(next, { replace: true });
    }}>
      <label>Hotel<select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All hotels</option>{branches.map((hotel) => <option key={hotel.slug} value={hotel.slug}>{hotel.name}</option>)}</select></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <label>Guests<input type="number" min="1" max="50" value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /></label>
      <label>Amenity<select value={amenity} onChange={(event) => setAmenity(event.target.value)}><option value="">Any amenity</option>{amenities.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>Currency<select value={currency} onChange={(event) => { setCurrency(event.target.value); setMinimum(''); setMaximum(''); }}><option value="">All currencies</option>{currencies.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>Minimum nightly price<input type="number" min="0" disabled={!currency} value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
      <label>Maximum nightly price<input type="number" min={minimum || 0} disabled={!currency} value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label>
      <label>Arrival<input type="date" name="checkIn" min={dateMinimum()} defaultValue={params.get('checkIn') ?? ''} /></label>
      <label>Departure<input type="date" name="checkOut" min={dateMinimum()} defaultValue={params.get('checkOut') ?? ''} /></label>
      <button>Check availability</button>
    </form>
    {dateError && <p className="error" role="alert">{dateError}</p>}
    {params.get('checkIn') && !branch && <p className="muted">Select a hotel to check availability for these dates.</p>}
    {live.requested && <Status {...live} />}
    <p className="muted">Rooms are subject to availability when you place a hold.</p>
    <Status data={data} error={error} />
    <div className="grid">{matches.map((room) => <RoomCard key={room._id} room={room} search={'?' + search.toString()} availability={live.data ? available.get(room.slug) ?? 0 : undefined} />)}</div>
    {data && !matches.length && <p>No room categories match these filters.</p>}
  </Chapter>;
}

const extraPhotos = { 'deluxe-king': 'king-detail', 'signature-suite': 'suite-detail' };

function RoomGallery({ room }) {
  const [selected, setSelected] = useState(room);
  if (!pictures[room]) return null;
  const gallery = [room, extraPhotos[room]].filter(Boolean);
  return <div>
    <Photo name={selected} />
    {gallery.length > 1 && <div className="gallery-options" aria-label="Room gallery">
      {gallery.map((view, index) => <button key={view} type="button" aria-pressed={view === selected} onClick={() => setSelected(view)}>
        {index === 0 ? 'Room view' : 'Room detail'}
      </button>)}
    </div>}
  </div>;
}

function AvailabilityCalendar({ branch, room, params }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const query = new URLSearchParams({ branch, type: room, guests: params.get('guests') || '1' });
  if (start) query.set('start', start);
  const result = useApi(open ? '/availability/calendar?' + query : null);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Browse the availability calendar</summary>
    {open && <>
      <label className="filter-field">Show 14 nights starting<input type="date" value={start} min={dateMinimum()}
        onChange={(event) => setStart(event.target.value)} /></label>
      <Status {...result} />
      {result.data && <ul className="availability-calendar">{result.data.days.map((item) => {
        const date = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
          .format(new Date(item.date));
        return <li key={item.date}>
          {item.availableRooms ? <Link to={'/book/' + branch + '/' + room + '?' + new URLSearchParams({
            checkIn: item.date, guests: params.get('guests') || '1'
          })}>{date}</Link> : <span>{date}</span>}
          <small>{item.availableRooms ? item.availableRooms + ' open' : 'Sold out'}</small>
        </li>;
      })}</ul>}
      <p className="muted">Counts are for individual nights. Check your full stay before placing a hold.</p>
    </>}
  </details>;
}

export function RoomDetails() {
  const { slug, roomSlug } = useParams();
  const [params] = useSearchParams();
  const result = useApi('/branches/' + encodeURIComponent(slug) + '/room-types');
  if (!result.data) return <Chapter title="Room details"><Status {...result} /></Chapter>;
  const { branch, roomTypes } = result.data;
  const room = roomTypes.find((item) => item.slug === roomSlug);
  if (!room) return <Chapter title="Room category not found"><Link to={'/hotels/' + slug}>Back to hotel</Link></Chapter>;
  const subject = [room.name, params.get('checkIn'), params.get('checkOut'), params.get('guests') && params.get('guests') + ' guest(s)'].filter(Boolean).join(' · ');
  const inquiry = new URLSearchParams({ branch: slug, subject });
  return <Chapter label={branch.name} title={room.name}>
    <div className="feature-split"><PropertyPhotos branch={slug} roomType={room._id} fallback={<RoomGallery key={room.slug} room={room.slug} />} /><div>
      <p>{room.description}</p>
      <p>{[room.bed, room.size && room.size + ' m²', 'Up to ' + room.capacity + ' guests'].filter(Boolean).join(' · ')}</p>
      <p><strong>{rate(room, branch)}</strong> per night</p>
      {room.amenities?.length > 0 && <><h2>Amenities</h2><Tags list={room.amenities} /></>}
      <div className="actions"><Link className="button" to={'/book/' + slug + '/' + roomSlug + '?' + params}>Book now</Link>
        <Link to={'/contact?' + inquiry}>Send a stay inquiry</Link></div>
    </div></div>
    <section id="plan"><h2>Plan your stay</h2>
      {branch.checkInTime && <p>Check-in {branch.checkInTime} · Checkout {branch.checkOutTime} · Hotel local time</p>}
      {branch.policyNotes && <p>{branch.policyNotes}</p>}<p>Use Book now to check availability and see the total for your dates. Contact the hotel about arrival and departure times.</p>
      <AvailabilityCalendar key={room.slug} branch={slug} room={room.slug} params={params} />
    </section>
    {roomTypes.length > 1 && <><h2>Explore other rooms</h2><div className="grid">
      {roomTypes.filter((item) => item._id !== room._id).map((item) => <RoomCard key={item._id} room={item} branch={branch} search={'?' + params.toString()} />)}
    </div></>}
  </Chapter>;
}

export function About() {
  return <Chapter label="About LuxuryStay" title="Hospitality with a sense of place">
    <div className="feature-split"><Photo name="dubai" /><div>
      <h2>Our story</h2><p>LuxuryStay brings together city hotels with a shared approach to hospitality. Each property takes its character from its neighbourhood.</p>
      <h2>Our philosophy</h2><p>Make arrivals easy, give guests room to slow down, and help them discover the places our hotel teams know best.</p>
      <h2>Our hotel teams</h2><p>Front-desk and concierge teams help guests plan each visit. Housekeeping and property teams care for rooms and shared spaces throughout the stay.</p>
      <Link className="text-link" to="/hotels">Meet our hotels →</Link>
    </div></div>
  </Chapter>;
}

export function Experiences() {
  const result = useApi('/branches');
  return <Chapter label="Facilities & experiences" title="Make time for what you enjoy">
    <Status {...result} />
    <div className="grid">{result.data?.branches.map((hotel) => <article className="editorial-card" key={hotel._id}>
      <Photo name={hotel.slug} /><div className="card-copy">
        <h2>{hotel.name}</h2>
        {hotel.facilities?.length ? <Tags list={hotel.facilities} /> : <p>Contact the hotel for facility details.</p>}
        <Link className="text-link" to={'/contact?branch=' + hotel.slug}>Ask the hotel →</Link>
      </div>
    </article>)}</div>
  </Chapter>;
}

export function PropertyCollection({ kind }) {
  const result = useApi('/branches');
  const title = { dining: 'Dining', facilities: 'Facilities & amenities', gallery: 'Hotel gallery' }[kind];
  return <section className="section chapter"><p className="eyebrow">Explore LuxuryStay</p><h1>{title}</h1>
    <Status {...result} />
    <div className="grid">{result.data?.branches.map((hotel) => {
      const items = kind === 'dining' ? (hotel.facilities ?? []).filter((facility) =>
        /dining|restaurant|breakfast|tea|bar/i.test(facility)) : hotel.facilities ?? [];
      return <article className="card" key={hotel._id}>
        <p className="eyebrow">{hotel.city}</p><h2>{hotel.name}</h2>
        {kind === 'gallery' ? <PropertyPhotos branch={hotel.slug} fallback={<Photo name={hotel.slug} />} /> :
          items.length ? <Tags list={items} /> : <p>Ask this hotel what is available for your visit.</p>}
        <div className="actions"><Link className="text-link" to={'/hotels/' + hotel.slug}>Explore hotel</Link>
          <Link className="text-link" to={'/contact?branch=' + hotel.slug}>Contact {hotel.city}</Link></div>
      </article>;
    })}</div>
  </section>;
}

export function Contact() {
  const result = useApi('/branches');
  const [params] = useSearchParams();
  const [choice, setChoice] = useState(null);
  const [state, submit] = useSubmission('/contact');
  const hotels = result.data?.branches ?? [];
  const selected = choice ?? hotels.find((hotel) => hotel.slug === params.get('branch'))?._id ?? '';
  return <Chapter label="Get in touch" title="Contact LuxuryStay">
    <div className="contact-layout">
      <form onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (await submit(Object.fromEntries(new FormData(form)))) {
          form.reset();
          setChoice('');
        }
      }}>
        <label>Hotel<select name="branch" value={selected} onChange={(event) => setChoice(event.target.value)} required>
          <option value="">Choose a hotel</option>{hotels.map((hotel) => <option key={hotel._id} value={hotel._id}>{hotel.name}</option>)}
        </select></label>
        <label>Your name<input name="name" autoComplete="name" maxLength={160} required /></label>
        <label>Email address<input type="email" name="email" autoComplete="email" required /></label>
        <label>Message<textarea name="message" rows="5" minLength={10} maxLength={3000} defaultValue={params.get('subject') ?? ''} required /></label>
        <button disabled={state.busy || !hotels.length}>Send inquiry</button><Feedback state={state} />
      </form>
      <aside><h2>Our properties</h2><Status {...result} />
        {hotels.map((hotel) => <div key={hotel._id}><h3>{hotel.name}</h3><p>{hotel.address || hotel.city}</p>
          {hotel.phone && <p>{hotel.phone}</p>}
          {hotel.contactEmail && !hotel.contactEmail.endsWith('.test') && <p><a href={'mailto:' + hotel.contactEmail}>{hotel.contactEmail}</a></p>}
        </div>)}<Link className="text-link" to="/faq">Frequently asked questions →</Link>
      </aside>
    </div>
  </Chapter>;
}

function ReviewList({ data, error, limit = 30 }) {
  return <><Status data={data} error={error} />
    {data?.reviews.length === 0 && <p>No guest reviews have been published yet.</p>}
    <div className="grid">{data?.reviews.slice(0, limit).map((review) => <article className="card" key={review._id}>
      <p>{review.rating} / 5</p><blockquote>{review.comment}</blockquote>
      <p>{review.displayName}{review.branch && ' · ' + review.branch.name}</p></article>)}</div>
  </>;
}

export function Reviews() {
  const result = useApi('/reviews');
  return <Chapter title="Guest reviews"><ReviewList {...result} /></Chapter>;
}

export function FAQ() {
  return <Chapter title="Frequently asked questions">
    <div className="faq">{faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
    <p><Link className="text-link" to="/contact">Ask your hotel a question →</Link></p>
  </Chapter>;
}
