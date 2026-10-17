# Verification record

Date: 17 October 2026 (Asia/Jerusalem).

## Executed in the prior session

- Strict TypeScript application checking.
- ESLint, including Next.js and React Hooks checks.
- Optimized Next.js production build.
- `npm audit --omit=dev --audit-level=high`: zero known vulnerabilities reported.
- **28 passing PGlite SQL tests** using the actual migration and business logic; no replacement inventory/queue implementation.
- HTTP integration against the production Next.js server connected to an isolated PGlite PostgreSQL-wire server: phone/password login, registration, authenticated state, unauthorized admin denial, origin/CSRF denial, partnership creation/acceptance, shared waiting room, opening and offer generation, simultaneous partner confirmations, QR pickup/return and repeated operations, logout, and administrative recovery revocation.
- Browser inspection of mobile-width Hebrew login and instructor dashboard, including signing in with a synthetic local QA account.

## Important limits

- Native PostgreSQL launch failed because the host sandbox denied System V shared-memory allocation. The native PostgreSQL test mode is implemented but was not successfully executed here. PGlite serializes access and cannot validate every distributed/native concurrency behavior.
- Supabase connectivity is now verified with the configured runtime role. The migration schema, runtime grants, seed rows, and worker database access are active. Production still requires the Supabase root CA in `DATABASE_SSL_ROOT_CERT`; local development uses an explicit encrypted development fallback because the CA is not installed in this environment.
- The 300-participant test covers SQL workflow invariants, not a 300-device HTTP load or production latency benchmark. Measure this on the chosen host/database region before opening reservations to the troop.
- Native camera scanning, vibration, home-screen installation, and lifecycle behavior have not been tested on physical iPhones or Android phones.
- Docker configuration is provided but has not been built/run here.
- Local UI screenshots and HTTP fixtures are synthetic test data. No production data or production credentials have been created.

## Rechecked on 17 October 2026

- Formatting, ESLint, and TypeScript checks pass.
- **29 PGlite SQL tests pass**, including a 300-participant waiting-room burst and four concurrent worker transactions.
- Production build passes with Webpack (`next build --webpack`). Turbopack build could not start a child process because the environment denied local port binding; `npm run build` now selects Webpack explicitly.
- A fresh native PostgreSQL start was attempted using the bundled embedded server, but the host denied `shmget` (`Operation not permitted`). The PGlite socket server was also denied permission to bind its local test port, so HTTP end-to-end tests could not be repeated in this session; the prior HTTP pass above remains the latest result.
- Supabase TLS support now accepts a root CA file through `DATABASE_SSL_ROOT_CERT`, verifies certificates in production, and strips URL TLS query flags so they cannot silently override that policy. `.env.example` and the Hebrew setup guide describe the configuration. No real Supabase connection was possible without project credentials.
- Dependency audit was not repeated because package-registry access was unavailable. The prior recorded result was zero production dependency vulnerabilities; that is not a fresh audit.
- Supabase verification completed: `/api/health` returned `{\"ok\":true}`, both background jobs recorded successful runs, the initial administrator login succeeded in the local browser, and duplicate seed activities were marked cancelled after duplicate schedules were disabled.

## Release checklist

1. Keep the `machsan` schema private and confirm anon/authenticated Data API clients cannot access it after any future Supabase changes.
2. Run the native PostgreSQL test mode and repeat the full HTTP flow against staging with a matching test-only script configuration.
3. Run a multi-client burst, confirm no duplicates/overselling, and measure queue response time while the worker is processing. Deploy web and worker near the database.
4. Kill and restart the actual worker process during offers; verify rollback/retry and unchanged deadlines. Check monitoring alerts on `/api/health` failure.
5. Test iOS Safari and Android Chrome installation, camera allow/deny, duplicate scans, offline return, refresh, and two devices for a partnered unit.
6. Verify HTTPS, secure cookies, secret storage, recovery procedure, operational inventory, backup restore, and staff training.

## Neon migration verification — 2026-10-17

This section supersedes earlier Supabase production conclusions.

Observed Netlify production failure: `unsupported startup parameter in options: search_path`. Fixed by removing startup options and schema-qualifying runtime SQL. Pool remains two connections per warm serverless instance. Neon TLS is verified in development and production; idle errors are handled and sanitized. Transactions reject a missing singleton lock; rollback errors destroy the connection without masking the original failure.

Neon production SQL Editor was inspected read-only: 19 tables, 94 columns, 37 indexes, enabled snapshot trigger/function, migration 001, singleton lock, two weekly schedules, both background job rows, zero users. Catalog fingerprints for columns/defaults, constraints/foreign keys, indexes, trigger definition and function body/config all exactly matched a fresh execution of db/001_initial.sql. Fingerprints (db/verify-fingerprints.sql, public search_path):
- columns: a71c74789104d18dba5d33415e1a4adf
- constraints: c895fcc7c814b079dbbf6945c59d81e4
- indexes: f7a006681952502f99baacb7832c92f0
- triggers: 6a651d81c59a994a30c8eece95b0dd84
- functions: 358e5995be59cea4459f6dfbbb0a8cee

The SQL Editor role neondb_owner has required schema/table/function access. This is owner access, not evidence of least privilege. No production schema or data was changed during inspection. The old Supabase project was not modified.

Local: 35 tests pass (29 workflow tests plus six pool/TLS/rollback/logging tests). Workflow tests now run without relying on machsan in search_path. HTTP integration passes registration, password login/session, authorization, CSRF origin rejection, partnership acceptance, shared waiting room, random queue opening, simultaneous confirmations, QR lookup/distribution/repeat scan/return, logout and account recovery/session revocation. These HTTP tests used isolated PGlite via its socket adapter, not Neon or native PostgreSQL. The actual worker process ran locally during these tests. Read-only verify:db passed on the isolated database.

Native PostgreSQL startup was attempted but the execution sandbox denied shared memory creation (shmget: Operation not permitted). Therefore native 300-user concurrency and multi-worker/crash recovery remain release gates; PGlite concurrency results cannot establish native concurrency behavior. Run the existing guarded TEST_DATABASE_URL workflow only against a disposable database named machsan_test, with ALLOW_DESTRUCTIVE_NATIVE_TESTS=YES; never point this test at production.

Physical iPhone Safari/Android Chrome camera permission, scanning, home-screen installation and standalone behavior remain manual tests. Manifest, RTL direction, HTTPS camera policy, ZXing fallback and non-caching of API responses were reviewed; this is not physical-device verification. No persistent hosted worker, initial Neon administrator or production inventory is created by this change.

Production deployment confirmed: commit 6c49330 was Published by Netlify (deploy 6ad3bbd6ad7a8fa78df5d937). Post-deploy HTTP verification at https://mechsan.netlify.app: database=true, worker=false (503 correctly indicates the missing worker); /api/teams returned 200 with []; CSRF exchange and invalid credentials rejection passed; anonymous state/admin/warehouse requests returned 401; manifest, both PNG icons and service worker returned 200. A burst of 300 simultaneous /api/teams reads all succeeded in approximately 5.2 seconds. This tests read connectivity only, not 300 authenticated queue mutations. Successful production login/registration cannot be claimed: no administrator, teams or users have been initialized. Post-deployment log refresh was interrupted by browser-tool timeouts; HTTP results, not absence of log errors, establish the live connection result.

Final quality checks: production build, TypeScript and lint passed after rebuilding generated Next.js route types. A temporary type-check failure while the development server regenerated .next was resolved by stopping development and rebuilding, with no type-check exclusions. No credentials/environment values were changed on Netlify. No paid resources were created.
