# מחסן · Machsan

A Hebrew, RTL, mobile-first warehouse PWA for a Scouts troop. This repository contains a real Next.js application, server-managed phone/password authentication, a private PostgreSQL schema, a persistent reservation queue, a separate worker, QR passes, warehouse operations, and administration.

**Deployment state:** implemented and locally verified; not connected to your Supabase project or deployed. No production credentials are included. Local SQL/HTTP tests use PGlite. A native PostgreSQL concurrency run and real iPhone/Android camera/install testing remain release gates; see [verification](VERIFICATION.md).

## Quick start

Requires Node.js 24 LTS, npm, and PostgreSQL 15+ (Supabase recommended).

1. Run `npm ci`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`. Generate the secret with `openssl rand -base64 32`. For production, set `DATABASE_SSL_ROOT_CERT` to the path of the downloaded Supabase root CA certificate. The app verifies the TLS certificate; do not add `sslmode` options to the connection URL. Use direct PostgreSQL access or a session pool. Transaction pooling does not support the realtime listener. See the step-by-step [Hebrew Supabase and deployment guide](SUPABASE-DEPLOY-HE.md).
3. With a migration-owner database connection, run `npm run migrate` once.
4. Create a dedicated PostgreSQL login `machsan_app` with a strong password using your database administration tool. Run `db/runtime-role.sql` as the migration owner. Change the web/worker `DATABASE_URL` to this restricted account. Do not use a Supabase service-role key in browser code; this application uses server-only SQL connections and no public Supabase Data API.
5. Set `ADMIN_NAME`, `ADMIN_PHONE`, and a unique `ADMIN_PASSWORD` of at least 12 characters in the server environment. Run `npm run bootstrap`. It refuses to run if any administrator already exists. Remove these three values afterward. The setup creates an initial instructor team so registration can begin.
6. Start `npm run worker` in a separate terminal. It generates dated activities four weeks ahead and processes queue jobs every second.
7. Start `npm run dev` and open `http://localhost:3000`. If the local OS sandbox blocks Turbopack file watching, use `npm run dev -- --webpack`, or `npm run build` followed by `npm start`.
8. Sign in as administrator. Configure the real teams and mat inventory. Until inventory is configured, queue entry is disabled. There is no fabricated stock, queue position, reservation, or user account in the application.

Passwords are Argon2id hashes. Login uses normalized Israeli mobile numbers directly; it does not use email aliases, SMS, or Supabase Auth. NextAuth manages encrypted JWT session cookies, CSRF tokens for its routes, and expiry. App mutations enforce the configured origin and validate inputs. Every authenticated request checks the database for disabled accounts and session version revocation. Administrative role changes and recovery revoke existing sessions.

Phone ownership is **not verified**. Staff must verify identity in person or through a known troop coordinator before account recovery; knowing a phone number is not identity proof. Recovery requires an audit note. Use fictitious data for tests and collect no additional information about minors.

## Production deployment

Run the web process and a continuously running worker near the database. A conventional Node hosting service or Docker host is sufficient for approximately 300 users. A minute-level cron or browser timer is insufficient for 90-second offers.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm start
# Separate supervised process, with the same server environment:
npm run worker
```

Or use `docker compose up --build -d` after configuring `.env` and applying migrations. The Docker services share an image and connect to external Supabase PostgreSQL. Place an HTTPS reverse proxy in front of port 3000, configure the real `NEXTAUTH_URL`, and retain `restart: unless-stopped` for the worker. Containerization has been supplied but Docker execution was not available in this session.

HTTPS is required for real-device camera access and service workers. NextAuth uses secure cookies for HTTPS deployments. Configure host-level body-size and request-rate limits, database backups, restore tests, log retention, and monitoring. `/api/health` returns 503 if the database is unavailable or the queue worker has not succeeded within 30 seconds; it discloses no user data. The app also warns about delayed queue processing. Monitor `background_jobs.attempts`, `last_success`, and `last_error`.

Use direct/session PostgreSQL access for `LISTEN/NOTIFY`. Each web process owns one listener and fans out **empty change events**, with no user data, over authenticated SSE connections. Clients refetch their authorized state. Four-second polling remains active as fallback. The HTTP host must allow streaming; functionality survives hosts that buffer SSE. SSE reconnects periodically so disabled sessions cannot subscribe indefinitely.

`NEXTAUTH_SECRET` and `DATABASE_URL` must remain server secrets. Never prefix them with `NEXT_PUBLIC_`. Preserve the private `machsan` schema and do not add it to Supabase exposed schemas. The migration owner and runtime database login should be separate. Audit and inventory history are append-only for the runtime login.

## Reservation and inventory rules

- One current unit membership per instructor; paired units are created only on acceptance. Team-scoped partner search returns at most five names and IDs and is rate-limited.
- A unit has one queue entry and at most one reservation per activity, enforced by unique constraints. Changes to a unit are blocked during an open activity in which it participated, including after expiry or cancellation, and while it has live reservations/loans. Historical borrower IDs/names/teams are snapshotted on reservation creation.
- Pre-opening participants are shuffled with Node's cryptographic random generator. Randomization and subsequent entries are serialized. Late entries receive the next persisted position.
- Queue membership creates no reservation. The worker grants one hold per available mat and an exact server deadline 90 seconds later. Only explicit confirmation creates a reservation. No new offer starts with fewer than 90 seconds left in registration.
- Expired or declined offers cannot re-enter automatically. Repeated confirmation returns the existing reservation; it never consumes another mat. Cancellation is allowed only before distribution and does not grant a fresh queue attempt.
- A singleton PostgreSQL row lock serializes all business mutations. This deliberately simple choice covers queue, partnerships, physical stock, manual reservations, and administrative changes with one lock order. A queued request waits for this lock and then revalidates session revocation. Never bypass these services with uncoordinated writes.
- Capacity accounts for activity allocations, holds, overlapping scheduled activity allocations, and all physically outstanding loans from other activities. Outstanding mats are never released by cancellation. Physical availability is checked again at pickup. Pickup opens one hour before an activity and closes at its end; returns remain available afterward, including for cancelled activities.
- A mat reserved for a non-overlapping future activity can become unavailable if a previous borrower later fails to return it. Pickup remains blocked rather than making stock negative; staff must recover the missing equipment or resolve the shortage. The software cannot guarantee a future physical return.
- Stock reductions are conservatively blocked while any active reservation, hold, or loan exists. Returned mats can serve the next waiting unit before registration closes. Staff manual reservations consume capacity and require an audit reason.
- The worker's persisted jobs commit together with transitions and scheduling. A crash rolls back the transaction; another worker retries the due job. Row locking prevents concurrent workers from duplicating work. Failures use bounded exponential retry and persist a generic diagnostic. Restarting a worker never resets an offer deadline.

## Staff and administrator usage

Staff can scan with the rear camera, search by name/phone/team, distribute, return, and create an audited manual reservation. A QR contains only an unpredictable UUID and is a lookup key, not authorization. Both partners have the same pass. Duplicate confirmed pickup/return requests are idempotent and generate one inventory event. Unknown, cancelled, wrong-time, and unauthorized requests do not mutate stock.

Administrators can configure inventory and announcements, create/rename/disable teams, change users' teams and roles, disable users, reset passwords with an identity-verification note, resolve partnerships, manage real activity instances and weekly templates, pause/resume/open/close queues, cancel activities, and review queue/audit records. Existing dated activities retain their schedule when a weekly template changes; edit individual eligible instances separately. Exceptions and manual bypasses are audited.

All schedules use `Asia/Jerusalem`. Defaults are Tuesday 17:00–19:00 and Friday 16:00–18:30; opening is exactly 24 elapsed hours before start, waiting opens 15 minutes earlier, closing is activity start. UTC instants are persisted and displayed in Jerusalem time. A change crossing a DST boundary uses elapsed-hour offsets explicitly.

## PWA and offline behavior

The manifest includes Hebrew metadata, standalone mode, theme color, and 192/512 PNG icons. The service worker caches only an offline explanation and a non-sensitive icon. It does not cache authenticated pages or API responses and does not queue offline mutations. Existing queue state survives refresh/login because PostgreSQL owns it. Offer time continues while disconnected. There are no background push notifications.

iPhone: Safari → Share → Add to Home Screen. Android: Chrome → Install app/Add to Home screen. Actual installation and camera scanning must be verified on the troop's devices over HTTPS. The QR display includes a high-contrast quiet zone. Scanning suppresses duplicate reads; after a confirmed staff operation the scanner reopens. Manual lookup remains available when camera permissions or hardware are unavailable.

## Testing

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The default suite executes the real schema and business functions in PGlite. It uses serialized SQL transactions to test deterministic outcomes, including a 300-participant burst. This **does not prove native PostgreSQL multi-session lock behavior**.

For that release gate, create a disposable database named exactly `machsan_test` and run:

```sh
TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@HOST:5432/machsan_test' ALLOW_DESTRUCTIVE_NATIVE_TESTS=YES npm test
```

This mode requires an explicit `ALLOW_DESTRUCTIVE_NATIVE_TESTS=YES` and refuses to run with `NODE_ENV=production`. It drops and recreates the `machsan` schema **only in that named disposable database**, uses a 20-connection PostgreSQL pool, and sends simultaneous transaction requests without a JavaScript mutex. Never point it at production.

For HTTP integration, run a disposable local application/database, bootstrap a test administrator, keep the worker running, and set `ADMIN_PHONE` / `ADMIN_PASSWORD` for that test account. Then run `npm run test:http`. The script refuses non-localhost destinations and creates real SQL test accounts/activities. It exercises authentication cookies and CSRF, role denial, partnerships, shared confirmation, warehouse operations, logout, and account-recovery revocation. Never run it against your operational dataset.

## Source map

- `app/`: Next.js routes, authenticated API, SSE, health check, manifest integration, and RTL shell.
- `components/`: instructor experience, QR/camera workflows, admin forms, shadcn-style Button primitive using Radix/CVA.
- `lib/auth.ts`: phone credentials, session validation, server role gates, persistent rate limits.
- `lib/queue.ts`: inventory accounting, randomized queue, offers, confirmation, cancellation.
- `lib/operations.ts`: registration, partnerships, warehouse transitions, audited administrative operations.
- `lib/schedule.ts`: dated Jerusalem-time activities and recurrence generation.
- `db/`: migration and least-privilege runtime grants.
- `scripts/`: migration, one-time admin bootstrap, unattended worker, HTTP integration test.
- `tests/`: database-backed workflow, concurrency-request, rollback, access, and DST tests.

The item catalog has `requires_return`, loans reference an inventory item, and units/actor audits are reusable for general equipment. Consumable requests, speech announcements, and personal equipment QR passes are deliberately outside version one.

## Neon / Netlify (2026-10-17)

The application supports Neon's pooled PostgreSQL endpoint. All runtime SQL explicitly names `machsan`; no `search_path` startup option is sent. TLS verifies Neon's certificate using the system trust store. Leave `DATABASE_SSL_ROOT_CERT` unset for Neon. Never put the database URL in a `NEXT_PUBLIC_` variable.

Netlify needs `DATABASE_URL`, `NEXTAUTH_URL=https://mechsan.netlify.app` and the existing `NEXTAUTH_SECRET` in the production Functions environment. Keep the secret unchanged. Publish the GitHub main branch using `npm run build`; Netlify's Next.js adapter manages the web server. Do not run migrations as part of every web build.

Before initial use, a trusted operator runs `npm run verify:db` with the real runtime DATABASE_URL. This is read-only and compares schema definitions with `db/schema-manifest.json`, generated from the unchanged initial SQL. It verifies required migration/lock/job records and runtime privileges. If it fails, inspect the reported category; never reset production to fix it. `npm run migrate` now rejects an incomplete existing schema rather than reporting success based solely on the migrations table.

Local setup: `npm ci`, copy `.env.example` to `.env`, enter the Neon pooled URL and a local NEXTAUTH_SECRET, keep NEXTAUTH_URL at http://localhost:3000, then `npm run verify:db`. For an empty database, set ADMIN_NAME, ADMIN_PHONE and a strong ADMIN_PASSWORD privately in `.env`, run `npm run bootstrap` once, then remove the ADMIN_* entries. Run `npm run dev` and, in a second terminal, `npm run worker`. Use `npm run dev -- --webpack` with WATCHPACK_POLLING=true if the local environment restricts filesystem watchers. Do not bootstrap a second administrator automatically.

The queue requires a continuously running worker (`npm run worker`, restart on failure) on an approved server, with the same Neon DATABASE_URL. Netlify web functions alone do not keep this process alive. Minute-based scheduled invocations do not satisfy 90-second offer timing. Multiple workers are serialized by the transaction lock and claim jobs transactionally. A worker restart catches up expired offers; confirmation always checks the deadline. No worker hosting service is provisioned by this code change.

Polling remains enabled for signed-in, visible, online pages and avoids overlapping requests. LISTEN/SSE is off by default and always disabled on Netlify or a recognized transaction-pool endpoint. Optional DATABASE_REALTIME=true is for a persistent host with a direct PostgreSQL connection only.

`/api/health` reports separate database and worker status and returns 503 when either is unavailable. An empty database still needs an initial administrator, real team names and actual inventory quantities; do not invent stock counts. `db/runtime-role.sql` contains generic PostgreSQL grants, but requires a separately provisioned `machsan_app` role; do not run it against a differently named Neon role without review. Prefer a limited runtime role over the database owner before opening registration to the public.
