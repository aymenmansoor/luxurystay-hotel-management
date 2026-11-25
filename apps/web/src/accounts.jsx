import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApi } from './api.js';
import { Status } from './status.jsx';

function useForm(onSuccess) {
  const [state, setState] = useState({});
  async function run(path, input, method = 'POST') {
    setState({ working: true });
    try {
      const response = await api(path, { method, body: JSON.stringify(input) });
      setState({ message: response?.message ?? 'Saved.' });
      onSuccess?.(response);
    } catch (error) {
      setState({ error: error.message });
    }
  }
  return [state, run];
}

function Result({ state }) {
  return <>{state.error && <p className="error" role="alert">{state.error}</p>}
    {state.message && <p role="status">{state.message}</p>}</>;
}

const form = (callback) => (event) => {
  event.preventDefault();
  callback(Object.fromEntries(new FormData(event.currentTarget)));
};

export function AccountLink() {
  const { kind } = useParams();
  const token = window.location.hash.slice(1);
  const [state, run] = useForm();
  const headings = { reset: 'Reset your password', verify: 'Verify your email address', invite: 'Accept staff invitation' };
  if (!Object.hasOwn(headings, kind)) return <section className="section"><h1>Account link not found</h1></section>;
  return <section className="section narrow"><h1>{headings[kind]}</h1>
    <Result state={state} />
    {state.message ? <Link to={kind === 'invite' ? '/staff/login' : '/login'}>Sign in</Link>
      : <form onSubmit={form((input) => run(token ? '/account/' + kind + '/complete' : '/account/reset', { ...input, token }))}>
        {token && kind !== 'verify' && <label>Choose a new password<input type="password" minLength="12" name="password" required autoComplete="new-password" /></label>}
        {!token && kind === 'reset' && <label>Email address<input name="email" type="email" autoComplete="email" required /></label>}
        {(token || kind === 'reset') && <button disabled={state.working}>{token ? 'Continue' : 'Send reset link'}</button>}
        {!token && kind !== 'reset' && <p>Open the complete link from the email.</p>}
      </form>}
  </section>;
}

export function Profile({ user, onChange }) {
  const [profile, save] = useForm((updated) => onChange({ ...user, ...updated }));
  const [verification, verify] = useForm();
  return <article className="card profile">
    <h2>Your account</h2><p>{user.email}{user.emailVerified ? ' · Verified' : ''}</p>
    {!user.emailVerified && <><button type="button" className="plain" disabled={verification.working} onClick={() => verify('/account/verify', {})}>Send email verification</button>
      <Result state={verification} /></>}
    <form onSubmit={form((input) => save('/account/profile', input, 'PUT'))}>
      <label>Name<input name="name" required minLength="2" maxLength="100" defaultValue={user.name} /></label>
      <label>Stay preferences<textarea name="preferences" rows="2" maxLength="600" defaultValue={user.preferences ?? ''} /></label>
      <button disabled={profile.working}>Save profile</button><Result state={profile} />
    </form>
  </article>;
}

export function ChangePassword() {
  const [state, save] = useForm();
  return <details>
    <summary>Change password</summary>
    {state.message ? <><Result state={state} /><Link to="/login">Guest sign-in</Link> · <Link to="/staff/login">Staff sign-in</Link></>
      : <form className="ops-form" onSubmit={form((input) => save('/account/password', input, 'PUT'))}>
        <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength="12" required /></label>
        <button disabled={state.working}>Change password</button><Result state={state} />
      </form>}
  </details>;
}

export function Loyalty() {
  const [revision, setRevision] = useState(0);
  const result = useApi('/loyalty', revision);
  const stays = useApi('/reservations', revision);
  const [state, run] = useForm(() => setRevision((n) => n + 1));
  const active = stays.data?.reservations.filter((row) => row.status === 'checked-in') ?? [];
  return <section className="ops-section"><h2>LuxuryStay Rewards</h2><Status {...result} />
    {result.data && <><p>{result.data.tier} · {result.data.points} points</p>
      {!result.data.member && <button disabled={state.working} onClick={() => run('/loyalty/join', {})}>Join rewards</button>}
      <p>Earn 100 points per completed night. Redeem {result.data.reward.points} points for a {result.data.reward.percent}% room charge credit while checked in.</p>
      {active.length > 0 && result.data.points >= result.data.reward.points && <form className="ops-form" onSubmit={form((input) => run('/loyalty/redeem', input))}>
        <label>Eligible stay<select name="reference" required>{active.map((row) => <option key={row.reference}>{row.reference}</option>)}</select></label>
        <button disabled={state.working}>Redeem credit</button></form>}
      {result.data.entries.length > 0 && <ul>{result.data.entries.map((item) => <li key={item.id}>{item.reference} · {item.points} points · {item.kind}</li>)}</ul>}
    </>}<Result state={state} />
  </section>;
}

const roles = ['branch-manager', 'receptionist', 'housekeeping', 'maintenance', 'finance'];
function Roles({ role }) {
  return <label>Role<select name="role" defaultValue={role ?? roles[0]}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>;
}

function Properties({ branches, initial = [] }) {
  return <label>Properties<select required multiple name="branches" defaultValue={initial.map((branch) => branch._id)}>
    {branches.map((branch) => <option value={branch._id} key={branch._id}>{branch.name}</option>)}
  </select></label>;
}

export function StaffAdmin({ branches }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const result = useApi(open ? '/staff/admin/team' : null, revision);
  const [state, run] = useForm(() => setRevision((n) => n + 1));
  function submit(event, member) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assignments = { role: data.get('role'), branches: data.getAll('branches') };
    if (member) run('/staff/admin/team/' + member._id, { ...assignments, active: data.has('active') }, 'PUT');
    else run('/staff/admin/team', { ...assignments, name: data.get('name'), email: data.get('email') });
  }
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Staff accounts and invitations</summary>
    {open && <><Status {...result} /><Result state={state} />
      <form className="ops-form" onSubmit={(event) => submit(event)}>
        <label>Name<input name="name" required minLength="2" /></label>
        <label>Email<input name="email" type="email" required /></label><Roles /><Properties branches={branches} />
        <button disabled={state.working || !branches.length}>Send staff invitation</button>
      </form>
      {result.data?.team.map((member) => <details key={member._id}>
        <summary>{member.name} · {member.role}{member.invited ? ' · invitation pending' : ''}</summary>
        <p>{member.email}</p>
        {!member.invited && <form className="ops-form" onSubmit={(event) => submit(event, member)}>
          <Roles role={member.role} /><Properties branches={branches} initial={member.branches} />
          <label className="checkbox"><input name="active" type="checkbox" defaultChecked={member.active} /> Active</label>
          <button disabled={state.working}>Save access</button>
        </form>}
      </details>)}
    </>}
  </details>;
}

export function Policies({ branch, refresh }) {
  const [state, run] = useForm(refresh);
  return <details><summary>Taxes and stay policies</summary><form className="ops-form" onSubmit={form((input) => run(
    '/staff/admin/properties/' + branch._id + '/policies', { ...input, taxBps: Math.round(Number(input.taxBps) * 100) }, 'PUT'))}>
    <label>Tax (%)<input name="taxBps" type="number" min="0" max="25" step=".01" defaultValue={(branch.taxBps ?? 0) / 100} required /></label>
    <label>Check-in time<input name="checkInTime" type="time" defaultValue={branch.checkInTime ?? '15:00'} required /></label>
    <label>Checkout time<input name="checkOutTime" type="time" defaultValue={branch.checkOutTime ?? '11:00'} required /></label>
    <label>Public policy notes<textarea name="policyNotes" maxLength="800" defaultValue={branch.policyNotes ?? ''} /></label>
    <button disabled={state.working}>Save policies</button>
  </form><Result state={state} /></details>;
}

export function Concierge() {
  const properties = useApi('/branches');
  const stays = useApi('/reservations');
  const [branch, setBranch] = useState('');
  const [answer, setAnswer] = useState(null);
  const [state, run] = useForm(setAnswer);
  const valid = stays.data?.reservations.filter((row) => properties.data?.branches.some((item) => item._id === branch && row.branchSlug === item.slug)) ?? [];
  return <details><summary>Hotel concierge</summary>
    <p>Ask about listed facilities, property policies or a reservation of your own.</p>
    <Status {...properties} />
    {properties.data && <form className="ops-form" onSubmit={form((input) => run('/guest/concierge', { ...input, reference: input.reference || undefined }))}>
      <label>Property<select name="branch" value={branch} onChange={(event) => setBranch(event.target.value)} required>
        <option value="">Choose a hotel</option>{properties.data.branches.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}</select></label>
      <label>Reservation (optional)<select name="reference" key={branch}><option value="">General question</option>
        {valid.map((row) => <option key={row.reference}>{row.reference}</option>)}</select></label>
      <label>Question<input name="question" minLength="3" maxLength="350" required /></label>
      <button disabled={state.working}>Ask concierge</button>
    </form>}
    {state.error && <Result state={state} />}
    {answer && <div role="status"><p>{answer.answer}</p><small>Source — {answer.source}</small></div>}
  </details>;
}
