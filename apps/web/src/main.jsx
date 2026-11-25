import React, { useCallback, useEffect, useState } from 'react';
import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from 'framer-motion';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/dm-sans';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, LiveRevision, useApi } from './api.js';
import { Status } from './status.jsx';
import { About, Contact, Experiences, FAQ, Home, Hotel, Hotels, Reviews, Rooms, RoomDetails, PropertyCollection } from './public.jsx';
import { Inventory } from './inventory.jsx';
import { CommandCenter, Complaints, GuestServices, NotificationPanel, Operations } from './operations.jsx';
import { AccountLink, ChangePassword, Concierge, Loyalty, Policies, Profile, StaffAdmin } from './accounts.jsx';
import { useLive } from './live.js';
import { Book, MyReservations, ReservationDetail, bookingReturn } from './bookings.jsx';
import './styles.css';
import './public.css';

const OffersPage = React.lazy(() => import('./offers.jsx').then((module) => ({ default: module.OffersPage })));

const roleLabels = {
  'super-admin': 'Central command center',
  'branch-manager': 'Branch management',
  receptionist: 'Front desk',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  finance: 'Finance',
  guest: 'Guest portal'
};

function SignIn({ mode, onSignIn }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnPath = bookingReturn(params.get('next'));
  const returnQuery = returnPath === '/guest' ? '' : '?' + new URLSearchParams({ next: returnPath });
  const staff = mode === 'staff';
  const register = mode === 'register';
  const heading = staff ? 'Staff sign in' : register ? 'Create a guest account' : 'Guest sign in';
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const { user } = await api('/auth/' + (staff ? 'staff/login' : mode), { method: 'POST', body: JSON.stringify(values) });
      onSignIn(user);
      navigate(staff ? '/admin' : returnPath, { replace: true });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="section narrow">
    <h1>{heading}</h1>
    <form onSubmit={submit}>
      {register && <label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" minLength={register ? 12 : undefined} autoComplete={register ? 'new-password' : 'current-password'} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
    </form>
    {!register && <p><Link to="/account/reset">Forgot password?</Link></p>}
    {!staff && <p>{register ? <Link to={'/login' + returnQuery}>Already have an account? Sign in</Link> : <Link to={'/register' + returnQuery}>Create a guest account</Link>}</p>}
  </section>;
}

function StaffWorkspace({ user }) {
  const [selected, setSelected] = useState('');
  const [revision, setRevision] = useState(0);
  const { data, error } = useApi('/staff/branches', revision);
  const activeBranch = data?.branches.find((branch) => branch._id === selected) ?? data?.branches[0];
  const roomPath = activeBranch && user.role !== 'finance' ? '/staff/branches/' + activeBranch._id + '/rooms' : null;
  const rooms = useApi(roomPath, revision);
  return <>
    <h2>Properties</h2>
    <Status data={data} error={error} />
    {data && !activeBranch && <p>No properties are assigned to your account.</p>}
    {activeBranch && <label className="branch-picker">Property<select value={activeBranch._id} onChange={(event) => setSelected(event.target.value)}>
      {data.branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name}</option>)}
    </select></label>}
    {['super-admin', 'branch-manager'].includes(user.role) && <Inventory key={'inventory:' + (activeBranch?._id ?? 'new')} branch={activeBranch} rooms={rooms}
      canCreateBranch={user.role === 'super-admin'} onChange={(branchId) => {
        setSelected(branchId);
        setRevision((previous) => previous + 1);
      }} />}
    {user.role === 'super-admin' && data && <StaffAdmin branches={data.branches} />}
    {activeBranch && ['super-admin', 'branch-manager'].includes(user.role) &&
      <Policies key={'policies:' + activeBranch._id} branch={activeBranch} refresh={() => setRevision((n) => n + 1)} />}
    {activeBranch && <Operations key={'operations:' + activeBranch._id} branch={activeBranch} user={user} rooms={rooms.data?.rooms ?? []} />}
    {['super-admin', 'branch-manager', 'finance'].includes(user.role) && <CommandCenter />}
    {roomPath && <>
      <h2>Room inventory</h2>
      <Status data={rooms.data} error={rooms.error} />
      {rooms.data?.rooms.length > 0 && <div className="table-wrap" role="region" aria-label="Room inventory table" tabIndex={0}><table>
        <thead><tr><th>Room</th><th>Category</th><th>Floor</th><th>Status</th></tr></thead>
        <tbody>{rooms.data.rooms.map((room) => <tr key={room._id}>
          <td>{room.number}</td><td>{room.type?.name ?? '—'}</td><td>{room.floor}</td><td>{room.status.replaceAll('-', ' ')}</td>
        </tr>)}</tbody>
      </table></div>}
      {rooms.data?.rooms.length === 0 && <p>No rooms have been added to this property.</p>}
    </>}
  </>;
}

function Workspace({ user, sessionError, staff, onProfile }) {
  if (sessionError) return <section className="section"><p className="error" role="alert">{sessionError}</p></section>;
  if (user === undefined) return <section className="section"><p role="status">Loading your session…</p></section>;
  if (!user) return <Navigate to={staff ? '/staff/login' : '/login'} replace />;
  if (staff === (user.role === 'guest')) return <Navigate to={staff ? '/guest' : '/admin'} replace />;
  return <section className="section">
    <h1>{roleLabels[user.role]}</h1>
    <p>Welcome, {user.name}.</p>
    <NotificationPanel />
    <ChangePassword />
    {staff ? <StaffWorkspace user={user} /> : <>
      <Profile user={user} onChange={onProfile} />
      <MyReservations />
      <GuestServices />
      <Complaints />
      <Concierge />
      <Loyalty />
    </>}
  </section>;
}

function App() {
  const reducedMotion = useReducedMotion();
  const location = useLocation();
  useEffect(() => {
    if (location.pathname.startsWith('/account/')) return;
    if (location.hash) {
      requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, location.hash]);
  const [user, setUser] = useState(undefined);
  const [liveRevision, setLiveRevision] = useState(0);
  const refreshLive = useCallback(() => setLiveRevision((previous) => previous + 1), []);
  useLive(user, refreshLive);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api('/auth/session', { signal: controller.signal }).then(({ user }) => setUser(user)).catch((failure) => {
      if (controller.signal.aborted) return;
      if (failure.status === 401) setUser(null);
      else setError(failure.message);
    });
    return () => controller.abort();
  }, []);
  function signIn(account) {
    setError('');
    setUser(account);
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      setError('');
    } catch (failure) {
      setError(failure.message);
    }
  }
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation}><LiveRevision.Provider value={liveRevision}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="header">
      <Link to="/" className="brand">LuxuryStay<span>INTELLIGENCE</span></Link>
      <nav aria-label="Primary">
        <Link to="/hotels">Hotels</Link>
        <Link to="/rooms">Rooms & suites</Link>
        <Link to="/experiences">Experiences</Link>
        <Link to="/offers">Offers</Link>
        <Link to="/contact">Contact</Link>
        {user ? <>
          <Link to={user.role === 'guest' ? '/guest' : '/admin'}>{user.role === 'guest' ? 'My account' : 'Workspace'}</Link>
          <button className="plain" onClick={logout}>Sign out</button>
        </> : <Link to="/login">Sign in</Link>}
      </nav>
    </header>
    {error && <p className="section error" role="alert">{error}</p>}
    <m.main id="main-content" tabIndex={-1} key={location.pathname} initial={reducedMotion ? false : { opacity: 0.84 }} animate={{ opacity: 1 }} transition={{ duration: .2 }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/hotels" element={<Hotels />} />
        <Route path="/hotels/:slug" element={<Hotel />} />
        <Route path="/hotels/:slug/rooms/:roomSlug" element={<RoomDetails />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/about" element={<About />} />
        <Route path="/experiences" element={<Experiences />} />
        <Route path="/offers" element={<React.Suspense fallback={<p role="status">Loading offers…</p>}><OffersPage /></React.Suspense>} />
        <Route path="/facilities" element={<PropertyCollection kind="facilities" />} />
        <Route path="/dining" element={<PropertyCollection kind="dining" />} />
        <Route path="/gallery" element={<PropertyCollection kind="gallery" />} />
        <Route path="/contact" element={<Contact key={location.search} />} />
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/login" element={<SignIn key="login" mode="login" onSignIn={signIn} />} />
        <Route path="/register" element={<SignIn key="register" mode="register" onSignIn={signIn} />} />
        <Route path="/staff/login" element={<SignIn key="staff" mode="staff" onSignIn={signIn} />} />
        <Route path="/book/:slug/:type" element={<Book user={user} sessionError={error} />} />
        <Route path="/guest/reservations/:reference" element={<ReservationDetail key={location.pathname} user={user} sessionError={error} />} />
        <Route path="/account/:kind" element={<AccountLink key={location.pathname} />} />
        <Route path="/guest" element={<Workspace user={user} sessionError={error} onProfile={setUser} staff={false} />} />
        <Route path="/admin" element={<Workspace user={user} sessionError={error} staff />} />
        <Route path="*" element={<section className="section"><h1>Page not found</h1><Link to="/">Return home</Link></section>} />
      </Routes>
    </m.main>
    <footer className="footer"><Link className="brand" to="/">LuxuryStay<span>INTELLIGENCE</span></Link>
      <nav aria-label="Footer"><Link to="/about">About</Link><Link to="/facilities">Facilities</Link><Link to="/dining">Dining</Link><Link to="/gallery">Gallery</Link><Link to="/faq">FAQs</Link><Link to="/reviews">Reviews</Link><Link to="/staff/login">Staff sign in</Link></nav>
    </footer>
  </LiveRevision.Provider></LazyMotion></MotionConfig>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
