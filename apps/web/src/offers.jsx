import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from './api.js';
import { Status } from './status.jsx';

export function OffersPage() {
  const result = useApi('/offers');
  return <section className="section chapter">
    <p className="eyebrow">LuxuryStay packages</p><h1>Offers & packages</h1><Status {...result} />
    {result.data?.offers.length === 0 && <p>There are no published offers for the current booking window.</p>}
    <div className="grid">{result.data?.offers.map((offer) => <article className="card" key={offer._id}>
      <p className="eyebrow">{offer.branch.name}</p><h2>{offer.title}</h2><p>{offer.description}</p>
      <p>{offer.discountBps / 100}% off {offer.type.name}. Minimum {offer.minimumNights} nights.</p>
      <p>Stay window: {offer.stayStart} to {offer.stayEnd}</p>
      {offer.services.length > 0 && <ul>{offer.services.map((service) => <li key={service}>{service}</li>)}</ul>}
      {offer.restrictions && <p>{offer.restrictions}</p>}
      <Link className="button" to={'/book/' + offer.branch.slug + '/' + offer.type.slug + '?offer=' + offer._id}>Check package availability</Link>
    </article>)}</div>
  </section>;
}

export function OfferManager({ branch }) {
  const path = '/staff/properties/' + branch._id + '/offers';
  const [revision, refresh] = useState(0);
  const result = useApi(path, revision);
  const types = useApi('/branches/' + branch.slug + '/room-types');
  const [selected, select] = useState('');
  const [state, setState] = useState({});
  const current = result.data?.offers.find((item) => item._id === selected);
  async function save(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setState({ busy: true });
    try {
      await api(current ? path + '/' + current._id : path, {
        method: current ? 'PUT' : 'POST',
        body: JSON.stringify({ ...data, minimumNights: Number(data.minimumNights), maxUses: Number(data.maxUses),
          discountBps: Math.round(Number(data.discount) * 100), published: data.published === 'on',
          services: [...new Set(data.services.split(',').map((item) => item.trim()).filter(Boolean))] })
      });
      refresh((n) => n + 1);
      setState({ message: 'Offer saved.' });
    } catch (error) {
      setState({ error: error.message });
    }
  }
  return <section className="ops-section"><h2>Offers and packages</h2><Status {...result} /><Status {...types} />
    <label>Offer to edit<select value={selected} onChange={(event) => { select(event.target.value); setState({}); }}>
      <option value="">Create an offer</option>{result.data?.offers.map((item) => <option key={item._id} value={item._id}>
        {item.title}{item.published ? ' · published' : ' · draft'}
      </option>)}</select></label>
    {types.data && <form className="ops-form" key={selected} onSubmit={save}>
      <label>Title<input name="title" minLength="3" maxLength="100" defaultValue={current?.title} required /></label>
      <label>Room category<select name="type" defaultValue={current?.type ?? ''} required><option value="">Choose a category</option>
        {types.data.roomTypes.map((type) => <option value={type._id} key={type._id}>{type.name}</option>)}
      </select></label>
      <label>Description<textarea name="description" defaultValue={current?.description} minLength="10" maxLength="800" required /></label>
      <label>Included services<input name="services" defaultValue={current?.services.join(', ')} placeholder="Separate services with commas" /></label>
      <label>Restrictions<input name="restrictions" defaultValue={current?.restrictions} maxLength="400" /></label>
      {Object.entries({ bookStart: 'Book from', bookEnd: 'Book through', stayStart: 'Stay from', stayEnd: 'Latest checkout' }).map(([key, label]) =>
        <label key={key}>{label}<input type="date" name={key} defaultValue={current?.[key]} required /></label>)}
      <label>Minimum nights<input type="number" name="minimumNights" min="1" max="30" defaultValue={current?.minimumNights ?? 1} required /></label>
      <label>Maximum bookings<input type="number" name="maxUses" min="1" max="10000" defaultValue={current?.maxUses ?? 10} required /></label>
      <label>Discount (%)<input type="number" name="discount" min="1" max="90" step=".01" defaultValue={(current?.discountBps ?? 1000) / 100} required /></label>
      <label className="checkbox"><input type="checkbox" name="published" defaultChecked={current?.published} /> Published</label>
      <button disabled={state.busy}>Save offer</button>
    </form>}
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}
  </section>;
}
