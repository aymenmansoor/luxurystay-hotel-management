# LuxuryStay implementation progress

[Current independent acceptance pass](#independent-acceptance-pass) supersedes older status entries where they overlap. The earlier entries document their respective snapshots.

The existing React/Vite and Express/Mongoose modular monolith is the implementation baseline. The previous 64.2% audit used 104 grouped requirement units with double weight for authentication, reservations, and security. That estimate predates this implementation brief and is not a production-readiness score.

## Baseline
- VERIFIED — the same running app served the health endpoint and MongoDB was healthy.
- VERIFIED — all 18 baseline integration tests passed.
- VERIFIED — a source checkpoint outside the checkout was tested for ZIP integrity and excludes local credentials.
- PARTIAL — the original Git commit tracks only the README. Source can be staged locally for review. A durable commit or push requires explicit authorization.

## Phase tracker

| Phase | Status | Remaining acceptance work |
| --- | --- | --- |
| 1. Foundation | PARTIAL | Account recovery UX, production proxy verification, route-by-route access matrix |
| 2. Finance | PARTIAL | Immutable invoice reconciliation, post-checkout settlement, reporting and regression tests |
| 3. Reservations | PARTIAL | Hold quotas and staff recovery, conflict alternatives, property dates and overdue stays |
| 4. Signature intelligence | PARTIAL | Stable pricing, readiness estimates, shift eligibility, floor geometry, command approvals |
| 5. Dashboards | PARTIAL | Tailored arrivals/departures, staff and finance queues, guest histories |
| 6. Public and media | PARTIAL | Dining, facility/gallery/offer pages, licensing register, authorized media lifecycle |
| 7. Operations | PARTIAL | Emergency maintenance, complaints, service timeline, complete loyalty verification |
| 8. Analytics and realtime | PARTIAL | Recovery, broader scoped reports, event coverage and notification verification |
| 9. Experience | PARTIAL | Specified fonts and motion, skeletons, dialogs/toasts, accessibility and mobile validation |
| 10. Delivery | PARTIAL | Clean-checkout validation, CI, reproducible browser tests, API and recovery documentation |
| Hosted deployment and real mail | BLOCKED | Authorized HTTPS host, production MongoDB, and SMTP sender required |
| Live payment provider | NOT APPLICABLE | Explicit simulated payment is permitted for the university demonstration |

## Implementation evidence

| Scope | Current status | Evidence or remaining work |
| --- | --- | --- |
| Source safety | VERIFIED | Source ZIP was read back successfully. Repository source staged locally. No commit or push authorized. |
| Password change | VERIFIED | `foundation.test.js` verifies current-password validation, revocation of both existing sessions, and signing in with the replacement. |
| Trusted proxy | IMPLEMENTED, NOT VERIFIED | `createApp` accepts only explicit IP/CIDR configuration. Hosted proxy verification needs infrastructure. |
| Verification and reset | PARTIAL | Single-use tokens and local SMTP pass. Email correction and live sender verification remain open. |
| Financial settlement | VERIFIED | `operations.test.js` verifies competing payments, one refund on replay, branch/guest scope, current outstanding balance, and immutable invoice. |
| Financial reporting | PARTIAL | Settlement payments, refunds, and outstanding balances are separate metrics. Payment/charge history predating the new ledger is retained. Consolidated historical accounting, manual-tax policy, correction notes and complete export remain open. |
| Staff holds | VERIFIED | Staff can create, list and confirm scoped pending holds. Repeated confirmation stays idempotent. |
| Guest hold caps and expiry | VERIFIED | Six concurrent holds yield five claims. Release frees quota. Server expiry is configurable. |
| Booking details and edge cases | PARTIAL | Cross-date alternatives, phone source, guest special requests, no-show, overdue extensions, branch-local clock policies, and booking-time discounts remain open. |
| Stable rate recommendations | VERIFIED | A fresh recommendation after approval equals the published rate when demand is unchanged. Seasonal forecasting and separate approval queue remain partial. |
| Room readiness | PARTIAL | Pending estimate is anchored and running estimate matches its saved calculation. Historical prediction quality and deadline behavior are not verified. |
| Cleaner eligibility and room positions | PARTIAL | Assignment requires an active shift and the Twin saves numbered coordinates with collision checks. Multi-shift calendars, worker workload simulation and physical geometry beyond a grid remain open. |
| Role workspaces | PARTIAL | Reception queues and scoped recent invoice list added. Remaining aggregate, search, history and role-specific views are open. |
| Media | PARTIAL | Integration verifies role, byte signature, public projection and removal. Hotel/category gallery management exists. Facility and offer media, replacement in one action, variants, richer optimization, and quota controls remain open. |
| Public pages and packages | PARTIAL | Existing editorial pages and galleries retained. Dedicated dining, facilities, offers/packages, sort controls and expanded content remain open. |
| Complaints | VERIFIED | Guest-owned submission and view, manager department routing, required resolution and permission checks exercised. |
| Other hotel operations | PARTIAL | Main workflows remain covered. Emergency maintenance, preventive schedules, fuller service timeline, and thorough loyalty verification remain open. |
| Real-time and analytics | PARTIAL | Change stream resume token and snapshot refresh fallback added. Existing scoped event test passes. Forced-outage recovery, report reconciliation and wider exports still need tests. |
| Design and accessibility | PARTIAL | Requested fonts and reduced-motion-aware page transitions are installed. Detailed accessibility, skeleton/toast patterns and cross-device validation remain open. |
| Delivery and API documentation | PARTIAL | CI workflow, Playwright setup, architecture diagram, route summary, storage and proxy guidance added. Full OpenAPI, hosted deployment, backup drill and independent long-running validation remain open. |

## Scoring comparison

Use the previous audit's denominator of 127 weighted points for a like-for-like
comparison. The new master brief adds requirements, so this is not a score for
its complete expanded scope. The old audit's 81.5 points (64.2%) gain 5.0 points
from A5 typography (+1), A6 motion (+0.5), E8 media (+0.5), G8 settlement (+1),
I7 complaint workflow (+1), J5 shift/layout scope (+0.5), and M7 delivery assets
(+0.5). Revised comparable coverage is 86.5/127 (68.1%). Existing partial
categories retain partial credit where their remaining requirements are open.

## Release checks

- VERIFIED — 24 integration tests passed.
- VERIFIED — both Playwright Chromium journeys passed. One verified both fonts, booking restoration, confirmation, QR and history. The other verified staff checkout, PDF availability, a finance payment reducing the balance to zero, and the dirty room in the Twin.
- VERIFIED — the production frontend build succeeded.
- IMPLEMENTED, NOT VERIFIED — GitHub Actions workflow was added and its equivalent steps ran locally. No remote workflow run or public deployment was exercised.

The current work still needs the outstanding feature groups above. The
specification score is not a security or deployment clearance. TLS proxy
operation, actual SMTP delivery, backup/restore, rate-limit behavior at the
host, accessibility conformance, and sustained load remain unverified.
- VERIFIED — exported the Git index to a fresh directory, installed with `npm ci`, built successfully, and ran `npm audit --omit=dev` with zero known vulnerabilities.

## Final-product brief follow-up

The previous staged baseline was preserved. This follow-up is stored in the
working tree and release ZIP. No commit or push was performed.

| Phase / requirement | State | Interface, backend, storage, permission, and evidence |
| --- | --- | --- |
| 1. Preserve existing project and establish baseline | VERIFIED | Staged Git baseline retained. 24 integration tests passed at the start. Existing app and replica-set configuration reused. |
| 2. Invoice credits and settlement reconciliation | VERIFIED | Finance/manager settlement UI and scoped API. Immutable invoice plus append-only Settlement entries. Tests cover duplicate credit, required reason, guest denial, amount due, actual paid amount and report totals. |
| 2. Remaining accounting | PARTIAL | Full historic ledger reconciliation, deposit allocation, tax policies and financial reporting granularity are still open. No real card transactions are configured. |
| 2. No-show, overdue extension and late checkout | VERIFIED | Reception stay actions, property-local clock, Reservation status, and atomic RoomNight claims. Tests cover after-arrival no-show, release, preserved history, overdue rollback and success, invalid late times and allocation conflicts. |
| 2. Remaining reservation work | PARTIAL | Broader alternative-date suggestions, phone reservations, early-arrival clock-time policy, and no-show fee/refund policy are still open. |
| 3. Emergency block and relocation | VERIFIED | Maintenance can open an emergency block. Affected references are limited to desk roles. A desk transaction moves the current occupant to a ready same-category room, preserves prior nights and records an event. Integration covers scoping, inventory, relocation and resolution. Overdue and cross-category moves remain open. |
| 3. Role dashboards and operations depth | PARTIAL | Existing role workspaces retained. Preventive calendar, complete dashboard queues, workload and dedicated reporting remain open. |
| 4. Bookable offers and packages | VERIFIED | Public offer page and scoped manager editor. Offer records and reservation term snapshots. Server quote, date eligibility, room eligibility, concurrent usage limit, persisted price and protected date changes covered by integration. Mobile browser journey reaches a simulated paid reservation. Included services are not dispatched automatically. |
| 4. Guest request history | VERIFIED | Guest-only API and UI show the status timeline and optional completion note. Integration asserts ownership route, three status events and delivered note. |
| 4. Complaint, feedback and loyalty depth | PARTIAL | Existing private complaint resolution, review moderation and rewards retained. Internal complaint notes, richer assignment, loyalty redemption breadth and report detail remain open. |
| 5. Intelligence and command center | PARTIAL | Prior stable pricing, saved readiness calculations and shift-aware assignment retained. Predictive accuracy, complete analytics and financial reporting remain open. |
| 6. Digital Twin layout | VERIFIED | Manager can set room row, column, width and height; backend checks grid bounds and overlaps, and serializes branch layout edits. Persistence and overlapping cell rejection are verified. UI offers zoom. Drag tools and comprehensive multi-floor editing remain open. |
| 7. Design and public pages | PARTIAL | Existing palette, typography and motion preserved. Dedicated facilities, dining, gallery and offers routes added using property data. Full public/dashboard visual treatment and responsive review remain open. |
| 8. Media | PARTIAL | Property uploads and demo-fallback labeling remain in use. Full licensed asset inventory, responsive variants and facility/offer media management remain open. |
| 9. Realtime recovery | VERIFIED | A regression test interrupts the audit cursor, leaves the client connected and verifies a resume token and continued delivery. Hosted failover, process restart and long disconnects remain unverified. |
| 9. Security, accessibility and performance | PARTIAL | Existing branch checks and guest ownership tests remain green. Mobile package test exercises keyboard link activation and reduced motion. Full accessibility audit, production proxy verification and load testing remain open. |
| 10. Release | PARTIAL | Local integration, browser and build checks are documented below. Remote CI, public deployment, production SMTP and operational recovery exercises remain unverified or require credentials. |

### Comparable coverage

The last baseline was 86.5/127 (68.1%) on the second-pass audit rubric.
B6 (bookable offers) increases by 1.0 and G4 (late and overdue checkout)
increases by 0.5. Related requirements with open obligations retain their
previous partial credit. The comparable estimate is **88/127 (69.3%)**.
This is not a score for the expanded final-product brief.

Verified functional scope is the behavior of the named integration and browser
scenarios, not a percentage of the application. No line-coverage or
accessibility conformance score was collected. Hosted security, production
performance and public deployment have separate open acceptance criteria.

### Final verification for this update

- VERIFIED — 29 integration tests passed, including the simulated change-stream interruption and property-local late checkout.
- VERIFIED — three isolated Chromium journeys passed, including the mobile, keyboard-activated package booking journey with reduced motion enabled.
- VERIFIED — the current source ZIP was extracted into a fresh directory, installed with the lockfile, and built successfully. The production dependency audit returned zero known vulnerabilities.
- VERIFIED — the existing development API and frontend restarted and reported healthy after verification.
- IMPLEMENTED, NOT VERIFIED — the CI definition remains present; no remote CI job or public deployment was run.

## Production-readiness assignment verification

| Requirement | Status | Interface, persistence and current evidence |
| --- | --- | --- |
| Preserve baseline, source and Git index | VERIFIED | Previous ZIP matched the working files before edits. The staged index fingerprint remained unchanged. No commit or push. |
| Explain invoice and settlement balances | VERIFIED | The settlement panel shows the issued total, paid amount, deposits, payments, refunds, tax, credits and later entries. New invoice breakdowns are saved with the issued invoice. Legacy invoices retain their stored amounts. |
| Immutable booking payments and refunds | VERIFIED | BookingAdjustment appends cancellation and date-change deltas, with actor, revision, reason and timestamp. Reservation tests check unchanged Payment records and exactly one refund. |
| Financial integrity | VERIFIED | Two invoice calculation tests and integration cases for deposits, manual tax, simultaneous pre/post-checkout payments, credits, refunds and immutable issued invoices passed. Historical backfill and detailed accounting exports remain partial. |
| Emergency relocation | VERIFIED | Manager-approved cross-category and overdue moves retain original rates and room history, reserve replacement nights, reject conflicts, and record a reason and both room numbers. A guest audit event enters in-app notifications and optional booking email. |
| Seven dashboard role landing screens | VERIFIED | Playwright verifies each mobile landing screen, a representative available control, role-scoped command API, and the automated accessibility scan. An audit of every control in every state remains partial. |
| Accessibility | PARTIAL | The 7 public routes and 7 role landing screens passed automated axe A/AA checks at 390 px. Keyboard skip-link and reduced-motion booking were exercised. Fixed the non-focusable comparison table. Manual screen-reader review and full conformance remain unverified. |
| Reliability | VERIFIED | Tests cover two-way room, package, payment, and housekeeping competition, six concurrent hold requests, hold expiry, relocation conflict rollback, and simulated cursor interruption. A bounded 32-request local availability burst returned all expected counts. This does not establish production capacity or MongoDB failover behavior. |
| SMTP | VERIFIED | Local SMTP transport exercised invitations, reset, and booking confirmation queue. Tests check one confirmation on repeated drain and explicit suppression for an opted-out guest. Provider delivery and actual operational email remain unverified. |
| Build, lint and CI | PARTIAL | Local lint, 34 automated backend tests, production frontend build and 11 Chromium tests passed. The CI YAML includes lint. No remote workflow was run. |
| Backup and recovery | PARTIAL | A synthetic local invoice was backed up and restored into an isolated database. Production database/media recovery, retention and credentials remain external. |
| Public deployment | BLOCKED | Requires explicit approval and a configured HTTPS host, MongoDB and operational secrets. Payments remain simulated. |

Comparable coverage on the previous 127-point rubric increases from 88/127
(69.3%) to 88.5/127 (69.7%) for the newly verified scoped finance breakdown
and settlement behavior (G6). Larger dashboard, accessibility and production
requirements remain partial. The score is not a security or deployment rating.

### Original specification coverage map

Repeated requirements in the original objectives, stage plan, and final
expectations are linked to the corresponding product area below. These statuses
refer to the full requirement scope. Accepted demo substitutions are called out.

| Original sections | Requirement area | Status and evidence |
| --- | --- | --- |
| §§1–4, 24 | MERN monolith, three experiences, prescribed palette and fonts | VERIFIED for shared database/API and palette/typography. Browser journeys and current production build. Full visual polish remains partial. |
| §5 | Public navigation; home, catalog, rooms, facilities, dining, galleries, offers, contact, FAQs, reviews, booking CTA | PARTIAL. Public mobile scan, gallery and package journeys, consent and review API tests pass. Configurable editorial content, testimonials, complete guest search and localized content remain incomplete. |
| §§6–7 | Registration, login, password reset, invitations, session controls, branch and ownership checks | VERIFIED at tested scope. Foundation auth cases plus localhost SMTP and role browser checks. Hosted cookie/proxy behavior and full permission matrix remain not fully verified. |
| §§8–9 | Dedicated dashboards and multi-branch management | PARTIAL. Seven mobile landing screens and scoped reports exercised. Staff assignment, financial detail, deeper role-specific work queues and portfolio controls remain incomplete. |
| §§10–11 | Room management, inventory, reservations, date changes, cancellation, holds, expiry, concurrency and physical room history | VERIFIED for tabled reservation/inventory cases. Room archive and fuller availability suggestions remain partial. |
| §12 | Desk, walk-ins, QR, verification, keys, arrivals/departures, time policies, late/no-show and stay amendments | PARTIAL. Checkout, overdue moves and late checkout have current tests. Complete policy and desk-search handling remain open. |
| §13 | Room/service charges, discounts, taxes, deposits, payments, refunds, adjustments, PDF and balances | VERIFIED for new calculation and settlement flows. Historic reconstruction, full exports and real card processing remain open. Simulated payments meet the demo fallback. |
| §§14–15 | Housekeeping assignment, shifts, progress, inspection; maintenance reporting, emergency block and relocation | VERIFIED for the tested workflow and concurrent start/relocation protection. Preventive maintenance calendar and complete shift scheduling remain partial. |
| §§16–18 | Guest services, concierge, feedback/moderation, complaints, loyalty | PARTIAL. Timeline, complaint resolution and review moderation work. Full department workflow, service staffing, and rewards coverage are incomplete. |
| §19 | Twin, readiness, assignment, pricing and centralized intelligence | PARTIAL. Real room data, editable positions, dimensions, collision checks and pricing stability tested. Forecast accuracy and complete approval/report workflows remain open. |
| §§20–22 | Reports, filtering/exports, Socket.IO and notifications | PARTIAL. Scoped comparison, event audience and cursor recovery tests pass. Complete reports, all notification channels and hosted reconnect/failover are open. |
| §§23 and 25 | Administration, global settings, data modeling, audit, integrity and indexes | PARTIAL. Scoped administration, indexes, queue records and immutable financial writes exist. Global settings and comprehensive audit evidence remain incomplete. |
| §26 | Security, privacy and backup/recovery | PARTIAL. Auth scope, validation, rate limits, dependency audit and synthetic restore are verified. Hosted HTTPS, production secrets and privacy/recovery operating procedures remain open. |
| §§27–29 | Performance, UX, responsive states, animation and accessibility | PARTIAL. A local 32-read burst and selected mobile/keyboard/axe checks pass. Full conformance, real-device checks, and sustained load remain unverified. |
| §30 | Automated testing | VERIFIED for the named current 34 backend and 11 Chromium cases. No line-coverage number collected. |
| §§31–33 | Packaging, documentation, CI and production delivery | PARTIAL. Clean install, lint and build pass; source and prior Git index preserved. Remote CI and hosted deployment remain blocked or unrun. |

Final local evidence for this assignment:
- The exact repository snapshot ran lint, all 34 backend tests, the production build and all 11 Chromium tests successfully. A later backend rerun also passed after adding assertions for a nonzero date-change adjustment.
- The 32-request burst observed p95 values of 187 ms and 213 ms in two successful local runs. The first attempt shared a rate-limit window with booking tests and got HTTP 429. The isolated rerun kept the normal limiter enabled.
- The fresh export installed 370 packages using the lockfile, linted, built, and returned zero findings from the production dependency audit.
- The final production image ran as the non-root node user and served the health endpoint, hotel catalog, and frontend admin route over local loopback. A hosted HTTPS proxy was not involved.
- The staged index SHA-256 remained f3001acd27a9dc7a6e79154b43a9b7a44b2b7ca1b13756d23eb1e70bd52a8442.

## Remaining requirements closure

### What changed

| Requirement | Status | Implementation and local evidence |
| --- | --- | --- |
| Reconcile immutable invoices and subsequent movements | VERIFIED for stored invoice records. | [`reconcileIssuedInvoice`](apps/api/src/settlement.js) drives the individual account and branch report. [`history`](apps/api/src/finance.js) uses a snapshot read transaction with an inclusive UTC issue window. Tests check payments, refunds, credits, variance detection, currency totals, historical cutoff and an unchanged invoice. |
| Export booking payments, booking adjustments, desk charges and settlements | VERIFIED for the covered accounting sources. | [`journal`](apps/api/src/finance.js) filters by posting period and joins the parent reservation inside branch scope. Tests check deposits, service and tax amounts, signed cancellation refunds, credits, unauthorized branch access, and postings on invoices issued outside the report window. |
| Export invoice balances and settlement audit details | VERIFIED. | [`sendCsv`](apps/api/src/finance.js) serves named downloads restricted to finance and management. Tests cover the legacy gap marker, amount columns, transaction attribution, and neutralization of spreadsheet formulas. [`FinanceReport`](apps/web/src/finance.jsx) provides the UI. |
| Backfill legacy historical accounting | PARTIAL. | Older stored invoice totals remain authoritative and independently flagged where the breakdown is missing or issue arithmetic differs. Booking payments previously edited in place to refunded lack a trustworthy refund posting. No inferred events were written. Recognized revenue, complete historical tax sourcing, and period certification remain open. |
| Desk queue guest search | PARTIAL. | [`FrontDesk`](apps/web/src/operations.jsx) filters loaded branch-scoped records by guest name/email. Browser tests cover match and empty state. Server-side directory search across older records remains open. |
| Housekeeping and maintenance role queues | PARTIAL. | [`Housekeeping` and `Maintenance`](apps/web/src/operations.jsx) show task/status filters, saved in-progress estimates, priority and repair history, and hide mutations where the API would deny the role or assignee. Chromium exercises receptionist read-only access and the backend independently denies an attempted start. Individual technician/cleaner browser workflows still need deeper coverage. |
| Operational email | PARTIAL. | [`deskEvent`](apps/api/src/desk.js), [`changeDates` and `cancel`](apps/api/src/reservation-service.js), [`settle`](apps/api/src/settlement.js), [service/assignment routes](apps/api/src/hotel-operations.js) and [`syncReminders`](apps/api/src/reminders.js) enqueue committed audit events. Local SMTP proves invitations, reset, confirmation, cancellation, date change, check-in, checkout, both reminders, service progress, settlement payment and maintenance assignment. It also checks repeated-drain dedupe and guest opt-out. Housekeeping assignment transport and all other event variants remain untested as SMTP scenarios. Hosted delivery remains unverified. |
| Accessibility beyond automated scanning | PARTIAL. | [Browser journeys](browser/journey.spec.js) exercise keyboard activation for finance and the floor plan. [Accessibility tests](browser/accessibility.spec.js) verify selected labels, mobile axe checks, skip-link focus and seven landing layouts at 390 and 1,440 px. Full keyboard review of every control, screen-reader sessions, other browsers and real devices remain open. |
| Repeat write workloads and recovery | PARTIAL. | [Operations tests](apps/api/test/operations.test.js) repeat conflict scenarios across settlement, holds, package claims, confirmation, cancellation, relocation and cleaning starts. [Availability test](apps/api/test/availability-load.test.js) measures burst latency. The existing cursor interruption regression exercises MongoDB watch resumption. Long-running mixed workload, primary election/failover, and operator restore on representative data remain open. |
| Hosted configuration and health | PARTIAL. | [Production startup](apps/api/src/server.js) requires an explicit MongoDB URI and canonical HTTPS origin, checks paired SMTP settings and valid port, and constructs the app before opening the listener. [Foundation tests](apps/api/test/foundation.test.js) check fail-fast configuration. [Dockerfile](Dockerfile) checks the configured port. [Hosted launch checks](README.md#hosted-launch-checks) document the private staging verification. Hosted proxy behavior, production secrets, alerting and remote CI require an authorized environment. |

### Original dashboard requirements, section 8

Verified means the named behavior is exercised by a local test. Implemented means
a corresponding control or API was found and verification is limited. Each role
remains partial overall. All seven landing views were checked at mobile and
desktop widths. Action-specific evidence is listed separately.

| Role | Individual requirements and status | Evidence and gaps |
| --- | --- | --- |
| Super Admin | Total branches, rooms and reservations **partial**; total guests **missing**; overall occupancy and revenue **partial**; branch performance and comparison **verified**; system alerts **partial**; pending approvals **missing** as a portfolio queue; staff overview **implemented**; operational trends **implemented**. | [`StaffWorkspace`](apps/web/src/main.jsx) and [`CommandCenter`](apps/web/src/operations.jsx) show scoped properties and branch metrics. [`metrics`](apps/api/src/hotel-operations.js) has per-property aggregates, without certified organization-wide occupancy, guest totals or multi-currency revenue. |
| Branch Manager | Branch occupancy **implemented**; today's arrivals and departures **implemented**; available and occupied rooms **implemented**; maintenance rooms **verified**; housekeeping progress and pending tasks **verified** for task lifecycle; branch revenue **partial**; complaints **verified**; performance analytics **partial**. | [`FrontDesk`, `Housekeeping`, `Complaints`, `CommandCenter`](apps/web/src/operations.jsx). Operations tests verify branch scoping, cleaning, maintenance, complaints and selected report totals. |
| Receptionist | Today's check-ins, checkouts and upcoming arrivals **implemented** as scoped queues; walk-ins and available-room data **verified** at API/operational scope; guest search **partial**; booking management, check-in/out and payment status **verified** at tested scope. | [`FrontDesk` and `DeskStay`](apps/web/src/operations.jsx) and [desk router](apps/api/src/desk.js). The queue filter covers the loaded records. A receptionist can read housekeeping state. The browser and API reject receptionist cleaning mutations. |
| Housekeeping | Assigned rooms, pending, in-progress and completed queues **implemented**; priority **implemented**; expected guest arrivals **partial** through limited readiness risk; estimated readiness **verified** at saved-calculation scope; staff workload **partial** through the manager assignment recommendation. | [`Housekeeping` and `Twin`](apps/web/src/operations.jsx) and [cleaning/twin routes](apps/api/src/hotel-operations.js). The timed race verifies one start and one audit event. Full worker scheduling, arrivals display and comparative workload history remain open. |
| Maintenance | Open requests, assigned issues and high-priority queues **implemented**; room maintenance status **verified**; repair history **implemented**; pending inspections **missing** as a dedicated maintenance workflow. | [`Maintenance`](apps/web/src/operations.jsx) and [maintenance routes](apps/api/src/hotel-operations.js). Integration covers blocking, room reassignment, authorization, and repair resolution. Calendar and inspections remain open. |
| Finance | Revenue **partial**; payments, outstanding balances, refunds and invoices **verified** for scoped local billing; daily transactions **verified** in the posting journal; branch financial performance **partial**. | [`FinanceReport`](apps/web/src/finance.jsx), [`FrontDesk`](apps/web/src/operations.jsx), [scoped report and settlement routes](apps/api/src/finance.js). The browser exercises payment through CSV download. Period-level recognized revenue and comprehensive statement reporting remain open. |
| Guest | Welcome **implemented**; upcoming reservations, previous stays and booking history **partial** as a combined list; invoices **verified** at tested ownership and checkout scope; loyalty membership/points **verified** at tested accrual scope; service requests **verified** at tested scope; preferences **implemented**; notifications **verified** for tested event and opt-out cases. | [`Workspace`](apps/web/src/main.jsx), [`MyReservations` and `ReservationDetail`](apps/web/src/bookings.jsx), [`Profile` and `Loyalty`](apps/web/src/accounts.jsx). Upcoming/past separation, complete reward verification and staff/guest end-to-end error flows remain open. |

### Original specification status by section

This updates the earlier original-spec map with individual feature statuses
where this pass gathered evidence. Items grouped under a shared status use the
same implementation references. A full atomic checklist for the original
document, including every repeated design and delivery instruction, remains
incomplete. The 69.7% value is the prior comparable baseline. No fresh weighted
percentage was calculated from this pass because the exact old row-by-row score
and an equally granular new review are required for a comparable result.

| Original section | Feature statuses and reference |
| --- | --- |
| 1–2. Role and objectives | **Implemented** MERN hotel system and real-data operations. **Partial** full operating scope, polished interaction and predictive quality. See `README.md` and the signature-feature rows below. |
| 3–4. Design and app spaces | **Verified** typography in Chromium and distinct public, guest and staff paths. **Partial** design-system consistency and responsive treatment for every state. See [`App`](apps/web/src/main.jsx), [public routes](apps/web/src/public.jsx), [styles](apps/web/src/styles.css). |
| 5. Public pages | **Verified** catalog, hotel/room booking entry, galleries, facilities, dining, offers, public review moderation and consent at tested scope. **Implemented** contact/inquiries, FAQs and public navigation. **Partial** complete search/filters, CMS-controlled editorial content, testimonials and licensed media coverage. See [public pages](apps/web/src/public.jsx), [`catalog`](apps/api/src/catalog.js), [`offers`](apps/api/src/offers.js). |
| 6. Authentication | **Verified** registration, guest/staff login, reset, invitations, session revocation and password change. **Implemented** email verification and profile preferences. **Partial** hosted delivery and full browser recovery/error coverage. See [auth routes](apps/api/src/auth.js), [account routes](apps/api/src/accounts.js), [foundation and operations tests](apps/api/test). |
| 7. RBAC | **Verified** representative guest ownership, cross-branch authorization, finance, desk, housekeeping and maintenance mutation gates. **Partial** exhaustive access cases on every resource and role. See [`allowRoles`](apps/api/src/auth.js), [`scopedBranch`](apps/api/src/desk.js) and tests. |
| 8. Dashboards | **Partial** for all seven roles. Individual dashboard items are in the preceding table. |
| 9. Multi-branch | **Verified** branch-scoped inventory, finance reports and manager visibility. **Implemented** branch identity, photos, inventory, staff links, reservations, rates, policies and tax settings. **Partial** portfolio configuration and full role matrix. See [branch models](apps/api/src/models.js), [branch/inventory routes](apps/api/src/catalog.js). |
| 10. Room management | **Verified** scoped inventory and availability, dirty-room checkout, maintenance restrictions and room state progression. **Implemented** number, floor, category metadata, amenities, photos and status. **Partial** archive lifecycle and broader editor validation. See [`inventory`](apps/api/src/catalog.js), [desk/cleaning routes](apps/api/src/desk.js). |
| 11. Reservations | **Verified** online/staff/walk-in availability, confirmation, reference/QR, date change, cancellation, holds, expiry, idempotency, and competing claims. **Partial** alternative-date suggestions, expanded guest requests and fees. See [`createHold`, `confirm`, `changeDates`, `cancel`](apps/api/src/reservation-service.js). |
| 12. Front desk | **Verified** verification, check-in/out, key issuance, room reassignment, late checkout, no-show, charges/account inquiries and actor attribution at tested scope. **Implemented** notes, guest-count changes and QR image entry. **Partial** early-arrival policy, long-range guest lookup and dedicated arrival operations. See [desk router](apps/api/src/desk.js), [`DeskStay`](apps/web/src/operations.jsx). |
| 13. Billing | **Verified** minor-unit calculations, room/fees/tax/discount math, deposits/payments/refunds, immutable invoices, concurrent/retried settlement and scoped CSVs. **Implemented** extra-guest, room-service, laundry, transport, restaurant and cancellation charge types plus PDF generation. **Partial** formally checked PDF field completeness, legacy reconstruction, cancellation fee policies and full-period accounting. Card processing **not applicable** to the explicitly labelled simulation path. See [`invoiceTotals`](apps/api/src/invoice-totals.js), [`settle`](apps/api/src/settlement.js), [finance router](apps/api/src/finance.js). |
| 14. Housekeeping | **Verified** create/assign/start/complete/inspect, room transition, shift eligibility, concurrency and in-app readiness event. **Implemented** task priority, reopening and timing. **Partial** stand-alone problem reporting, workload and recurring shifts. See [cleaning routes](apps/api/src/hotel-operations.js). |
| 15. Maintenance | **Verified** reporting, blocking, conflict protection, emergency relocation, resolution and assignment email. **Implemented** equipment, priority, assignments, costs, history, scheduled time and event logging. **Partial** preventive scheduling and completion notifications. See [maintenance routes](apps/api/src/hotel-operations.js). |
| 16. Guest service and concierge | **Verified** owned request, progress, note and timeline. **Implemented** rule-based directory and reservation-aware concierge. **Partial** complete departments, routing/assignment, escalation and full request coverage. See [`guestServices`](apps/api/src/hotel-operations.js). |
| 17. Feedback and reviews | **Verified** restricted complaint workflow and public approval gate. **Implemented** ratings and heuristic keyword topics. **Partial** feedback trend, response and intelligence depth. See [complaint routes](apps/api/src/complaints.js), [`metrics`](apps/api/src/hotel-operations.js). |
| 18. Loyalty | **Verified** checkout accrual at tested scope. **Implemented** membership, balance/ledger, fixed earn rate and one redemption rule. **Partial** reward breadth and boundary/replay testing. See [loyalty routes](apps/api/src/loyalty.js). |
| 19.1 Digital Twin | **Verified** real rooms, status changes, position persistence, collision prevention and keyboard activation. **Implemented** floors, category and status labels, filters/search, details, and scoped upcoming arrivals. **Partial** full multi-floor layout authoring and accessibility. Full 3D **not applicable** to the required 2D MVP. See [`Twin`](apps/web/src/operations.jsx), [twin/layout routes](apps/api/src/hotel-operations.js). |
| 19.2 Readiness | **Verified** anchored estimate and saved running estimate. **Implemented** history-based durations, risk, priority, workload, arrival input, fallback and actual/estimate display. **Partial** calibration, accuracy, explainability across all states. See [`duration` and twin route](apps/api/src/hotel-operations.js). |
| 19.3 Assignment | **Verified** active shift/branch enforcement and supported manager approval. **Implemented** workload, queue minutes, same-floor scoring and before/after recommendation. **Partial** eligibility for every scheduled scenario and overall workload comparison. See [cleaning and twin routes](apps/api/src/hotel-operations.js). |
| 19.4 Pricing | **Verified** manager-only approval, quote stability and saved decision. **Partial** revenue forecast, lead-time/seasonal coverage and approval queue. See [pricing router](apps/api/src/hotel-operations.js). |
| 19.5 Command | **Verified** authorized branch comparisons. **Implemented** occupancy, simulated booking receipts, ready rooms, arrivals, cleaning, maintenance, complaints and trends. **Partial** cross-branch totals, consolidated approvals and alert workflows. See [`CommandCenter`](apps/web/src/operations.jsx). |
| 20. Analytics and reporting | **Implemented** booking sources/trends, current occupancy, cleaning, maintenance costs, ratings, date/property filtering, Recharts and trends CSV. **Verified** finance invoice/settlement/journal exports. **Partial** categorized recognized revenue, monthly finance reports, utilization and staff workload reporting. See [`metrics`](apps/api/src/hotel-operations.js), [`Trend`](apps/web/src/trend.jsx). |
| 21. Real time | **Verified** authenticated scope, delivery after committed events and reconnect of a forced audit cursor interruption. **Partial** multi-instance behavior, process restart and database failover. See [`realtime`](apps/api/src/realtime.js). |
| 22. Notifications | **Verified** the emails and preference behaviors listed above. **Implemented** in-app alerts, assignment and activity events. **Partial** complete event-specific routing, recovery, sender-domain checks and live delivery. See [`drainMailQueue`](apps/api/src/mail.js), [`NotificationPanel`](apps/web/src/operations.jsx). |
| 23. Administration | **Verified** staff invite/deactivation, policy/pricing changes at tested scope, and actor/branch/resource/time audit fields. **Implemented** branch, category, tax and rate controls. **Partial** global settings, audit completeness and centralized approvals. See [`StaffAdmin`, `Policies`](apps/web/src/accounts.jsx), [`Audit`](apps/api/src/operations-models.js). |
| 24–25. Stack and data | **Verified** MERN, Socket.IO, Recharts, rule-based intelligence, scoped persisted data, replica-set transactions and uniqueness at tested scope. **Implemented** hosted container artifacts. **Partial** final schema coverage and operational data lifecycle. See [`connect`](apps/api/src/db.js), [schema definitions](apps/api/src). |
| 26. Security/privacy | **Verified** local ownership/branch/role denial, validated amounts and writes, production configuration rejections and synthetic backup/restore from the preceding pass. **Implemented** HTTP headers, same-origin mutation checks, Secure production cookies, rate limits, hashing and secrets via env. **Partial** hosted HTTPS/proxy/CORS behavior, privacy operations and production recovery. See [`createApp`](apps/api/src/app.js), [`server.js`](apps/api/src/server.js). |
| 27. Performance | **Verified** bounded local read and repeat-write scenarios. **Implemented** selected indexes, deferred images, queue processing and response limits. **Partial** consistent pagination, large queries, monitoring, failover and capacity. See [local measurements below](#closure-test-results). |
| 28–29. UX and accessibility | **Verified** sampled keyboard, reduced motion, mobile navigation/booking, tested role layouts and selected axe scans. **Implemented** core loading, empty, success, error and validation states. **Partial** keyboard order across every workflow, screen-reader use, dialogs, animation consistency, pagination and WCAG 2.2 AA. See [browser tests](browser). |
| 30. Testing | **Verified** for named cases and results below. **Partial** complete operation boundary matrix, provider failure delivery, endurance testing and production recovery. |
| 31–33. Sprint/delivery | **Implemented** local setup, Docker image, README, deployment checks and CI workflow. **Partial** complete original acceptance and public delivery. Remote CI and hosted checks **unverified**. Public deployment requires approval. |

### Closure test results

| Check | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm test` | 39 passed, zero failures or skips, 26.27 s. MongoDB local replica set. |
| `npm run build` | Production Vite build passed. Reconciliation is loaded only when opened. |
| `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser` | 11 passed in 22.4 s. Includes seven mobile/desktop role landings, public axe/skip link, guest booking, desktop and mobile finance, floor-plan keyboard activation, and receptionist read-only cleaning permissions. |
| Fresh temporary source export | Installed 370 packages from the lockfile using the local package cache. Lint and build passed. The initial uncached install had registry tarball retries. The cached install warned about the esbuild postinstall allowlist and the build succeeded. |
| `npm audit --omit=dev` | Zero reported production dependency vulnerabilities in the audit run. |
| Local production image | Built and ran with UID 1000. The admin sign-in returned HTTP 200. The container health check passed on port 3314. A loopback test checked Secure, HttpOnly and SameSite=Lax cookies plus allowed and denied Origin headers. |
| Git preservation | The SHA-256 of `git ls-files --stage` matched the baseline, `f3001acd27a9dc7a6e79154b43a9b7a44b2b7ca1b13756d23eb1e70bd52a8442`. `git diff --check` passed. |

| Local workload | Wall time | Concurrency and requests | Outcomes | Latency |
| --- | --- | --- | --- | --- |
| Availability burst | 358 ms | 32 concurrent reads, 32 requests | 32 successful, 0 unexpected | p95 354 ms |
| Settlement writes | 2.712 s | 2 staff, 10 paired rounds, 20 writes | 10 accepted, 10 expected conflicts, 0 unexpected | p50/p95/p99 17/27/30 ms |
| Package holds, confirmation and cancellation | 8.599 s | 2 guests, 8 rounds, 32 writes | 24 successes, 8 expected conflicts, 0 unexpected | p50/p95/p99 21/57/63 ms |
| Room relocation and housekeeping start | 5.253 s | 2 managers, 5 rounds, 20 writes | 10 successes, 10 expected conflicts, 0 unexpected | p50/p95/p99 19/38/42 ms |

The write runs use intentional pauses between rounds and direct HTTP test clients.
The timings describe this local snapshot and fixture size. Database and media
backup/restore, primary elections, network splits and long-lived load are
separate hosted acceptance checks.

### Release assessment and open work

- **Feature completeness:** Invoice and posting exports work, and the desk,
  housekeeping and maintenance queues use live branch data. Historical
  backfill, recognized revenue, every role's full action coverage, portfolio
  approvals, richer reports, preventive maintenance, and other partial
  original requirements above remain open.
- **Verification:** Local integration, Chromium, SMTP, config, build and
  dependency checks passed within the described scope. A complete atomic
  specification checklist, full keyboard and screen-reader review, longer
  mixed-load tests, and multi-node recovery remain open.
- **Production readiness:** Docker, a local production-mode check, a launch
  checklist and a recovery runbook are available. Hosted reverse-proxy
  behavior, production database/media recovery, live deliverability and
  operational monitoring require authorized infrastructure and credentials.
  Remote CI was not verified.
- **Public deployment:** No public deployment or push was performed. Live
  payment processing remains outside the permitted simulated payment mode.

## Independent acceptance pass

The worktree started from the preceding closure submission. Staged, unstaged
and untracked changes were inspected separately. The staged listing matched
its preserved SHA-256 fingerprint. The current pass adds working-tree changes
only.

### Finance

- [Legacy reconstruction](apps/api/src/legacy-invoice.js) checks the original
  room item, the pre-issue desk entries, booking payment, invoice tax item and
  issued arithmetic before returning a derived breakdown. It uses the stored
  tax item, so a later property tax configuration cannot rewrite history.
  Reconstruction stays read-only. Missing, ambiguous or unreconciled records
  are excluded from classified revenue and identified in the exception export.
- [Finance reports](apps/api/src/finance.js) distinguish reconciled revenue at
  invoice issue excluding tax, tax, unclassified issued amounts, issued net
  paid, later payments/refunds/credits, receivables and credit owed. The posting
  journal distinguishes receipt movements from billable desk entries and
  invoice credits. No accrual schedule or tax allocation for post-issue
  credit/refund entries was introduced.
- Each invoice, settlement, posting journal and exception CSV requires finance
  or management authorization within the requested branch. An audit event
  records the responsible user, branch, export type, requested dates and row
  count. It records export preparation, since completion of a browser download
  cannot be observed by the server.
- [Operations tests](apps/api/test/operations.test.js) reconstruct a legacy
  22,550 minor-unit invoice into 20,500 recognized revenue and 2,050 tax, with
  10,000 paid and 12,550 outstanding. A legacy exception stays unchanged and
  exports its variance. The same suite covers partial payments, refunds,
  credits, unauthorized CSV access and competing writes.

### Role acceptance evidence

This table complements the per-item roles in sections 7–8 of the
[specification matrix](SPECIFICATION_ACCEPTANCE.md). It identifies covered
cases and the next role-specific gaps.

| Role | Exercised evidence | Open acceptance |
| --- | --- | --- |
| Super Admin | Backend verifies exclusive access to portfolio branch, room, reservation, active guest and occupancy totals. Chromium checks that the portfolio is visible. Staff invitation and deactivation have backend cases. | Complete role lifecycle and negative-case browser coverage, dedicated approvals, global settings and consolidated financial reporting. |
| Branch Manager | Branch-only access, invalid and cross-branch inputs, pricing replay, maintenance relocation and invoice issue are exercised through operations tests and Chromium. Portfolio totals are absent. | Deep task and complaint browser workflows and delegated employee administration. |
| Reception | Chromium exercises queue access and API denial of an unauthorized cleaning write. Desk reservations, QR and checkout have lifecycle tests. | Exercise full desk action and failure matrix while signed in as Reception, including older-record search. |
| Housekeeping | Assigned/eligible worker and cleaning lifecycle checks, including competing starts. Chromium verifies the landing and available controls. | Browser coverage for assignments, inspection boundaries, unavailable tasks and shift changes. |
| Maintenance | Exercise issue reporting, blocking, assignment email, resolution, rejected resolution while a guest remains, relocation and scoped data. | Dedicated pending inspections, recurring preventive schedules and full repair-browser error cases. |
| Finance | Verify scoped reports and CSVs, guest/wrong-branch denial, invalid dates, partial settlement and concurrent overpayment prevention. Chromium exercises settlement and the reconciliation interface. | Full period close, reconciliation of migrated production data and independent provider acceptance. |
| Guest | Exercise reservation ownership, cancellation, expired holds, conflicts, service requests and invoice access. Chromium exercises keyboard confirmation and the previous-stays filter empty state. | Dedicated full-profile, guest-feedback, preference and loyalty workflow acceptance on actual assistive technology. |

### Accessibility evidence and limits

Headless Chromium sent actual key events to the public skip link, booking hold
and confirmation controls, the guest reservation-history selector, finance
reconciliation controls and the Digital Twin room tile. The accessibility suite
checks public routes and all role landings with axe and responsive viewport
assertions. This environment had no available headed display or screen reader.
Manual keyboard order and screen-reader announcements, zoom, menus, dialogs
and validation across every public and staff route remain open.

### Test and recovery evidence

| Check | Observed result |
| --- | --- |
| API and backend | 39 tests passed in 26.99 s, including authorization, legacy reconciliation, export auditing, portfolio scoping and local SMTP. |
| Frontend | Vite production build and lint passed. Vite warns about a minified chunk over 500 kB. UI acceptance is exercised by the browser suite. |
| Chromium | 11 tests passed in 21.6 s. |
| Production dependency audit | Zero reported vulnerabilities. |
| Production-mode container on loopback | Built and ran as UID 1000. Health and staff sign-in route passed. Confirmed permitted and rejected Origin headers plus Secure, HttpOnly and SameSite=Lax cookie flags. Hosted TLS and proxy behavior remain unverified. |
| Extended settlement | 30.460 s, 2 concurrent clients, 20 writes (0.66/s), 10 accepted and 10 intentional conflicts. p50/p95/p99 31/103/107 ms. |
| Extended booking and package claims | 32.694 s, 2 concurrent clients, 32 writes (0.98/s), 24 accepted and 8 intentional conflicts. p50/p95/p99 29/52/56 ms. |
| Extended relocation and housekeeping | 20.351 s, 2 concurrent clients, 20 writes (0.98/s), 10 accepted and 10 intentional conflicts. p50/p95/p99 16/62/71 ms. |
| MongoDB restart | 1 isolated client, 3 probes, 1 observed unavailable probe. 1.026 s elapsed to recovered transaction and validated records. Probe p50/p95 3/713 ms. One record survived restart and the recovered connection committed a second. |
| Socket.IO | The integration test forces a MongoDB change-stream cursor failure and checks delivery after resume. Transport loss and database primary election remain separate cases. |
| Source integrity | The SHA-256 of `git ls-files --stage` remains `f3001acd27a9dc7a6e79154b43a9b7a44b2b7ca1b13756d23eb1e70bd52a8442`. |

The 72 extended writes returned zero unexpected responses. The measured
throughput includes planned pauses between rounds. These measurements describe
the local fixtures and give no hosted capacity or uptime estimate.

### Acceptance scoring and release blockers

The [original specification matrix](SPECIFICATION_ACCEPTANCE.md) indexes
1,007 source items, with 1,005 applicable and 343 individually mapped.
The strict verified score is 161/1,005 (16.0%). The evidence-weighted
score is 28.3% under the documented scoring method. The 664 section-only
rows earn zero credit, so both figures measure the evidence in the matrix.
The prior 69.7% grouped score uses a different denominator. Individual
assessment of the remaining rows and full role acceptance are still open.

| Blocker or outstanding acceptance | Required input or action |
| --- | --- |
| Remote CI | GitHub returned Forbidden when listing runs. Grant read access to Actions and provide an approved remote branch containing the release snapshot. A push requires explicit approval. |
| Hosted behavior and live delivery | Provide an authorized private HTTPS staging target, its proxy and secret-store configuration, an authenticated replica set, writable media storage and an approved SMTP sender with controlled recipients. Keep production credentials out of chat and Git. |
| Manual accessibility | Provide access to a headed test machine with a screen reader or a tester who can exercise the named routes on an assistive-technology setup. |
| Historical exceptions | Provide trustworthy original journal or invoice records if available. In their absence the exception stays unclassified. |
| Hosted recovery and release | Approve an isolated staging restore/failover exercise and supply a representative backup with coordinated media. Public release requires separate approval. |
