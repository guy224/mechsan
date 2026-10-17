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
