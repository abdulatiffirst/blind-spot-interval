# Implementation report — 17 November 2026

## Outcome

Implemented the MVP in the selected checkout. Local application workflows are verified; **full production acceptance remains pending real Google credentials and deployment verification**. The original repository had no commits or application files. The uploaded master specification is preserved in SPECIFICATION.md.

## Architecture and features

React/Vite/Tailwind frontend, Fastify API, PostgreSQL/Drizzle schema, shared Zod contracts, an FSRS-7 package, an independent availability package and a PostgreSQL-backed worker. No AI, billing or unrelated modules were added.

Today, Topics, internal day/week/month Calendar and Settings are connected to real database state. Topic create/edit/search/tag filtering, ordered materials with links, optional ratings, preview, archive/restore, five recall outcomes, completion progress, manual scheduling, return-to-auto and audited latest-rating correction are implemented. There are no hardcoded example topics in production views. Visual-check fixtures were removed afterward.

Google-only OIDC includes single-use state, nonce, PKCE, JWT issuer/audience checks and opaque expiring server-side sessions. Calendar consent is separate. Calendar synchronization implements encrypted grants, reusable dedicated calendar ID, stable external IDs, ETags, incremental pagination, expired-cursor recovery, validated/deduplicated webhook jobs, watch renewal, reconciliation, retries and bounded deletion recreation. This is **implemented but awaiting live verification**.

## Structure, schema and API

See README.md for the repository layout, DATABASE.md for all tables/constraints, and API.md for every endpoint and input contract. The database contains all twelve specified product entities plus sessions, OAuth states, migration tracking and correction audit tables. SQL migration files are the source of truth; the Drizzle schema mirrors the applied database. Topic creation accepts user-scoped Idempotency-Key, and review completion is exactly-once per schedule.

## Algorithm

Pinned ts-fsrs 6.0.0, explicit FSRS-7 and default model weights. Knowledge cold-start intervals are provisional schedules, never fake reviews. Real reviews preserve original ratings and map 1/2→Again, 3→Hard, 4→Good, 5→Easy. Full memory state, fast stability, actual timestamps, version, weights and revlogs are saved. Ratings 1/2 override the ideal recovery day to tomorrow locally. Availability uses full duration, local study hours, five-minute candidates, internal/external conflicts and a bounded search. Calendar changes do not advance memory. See MEMORY_ALGORITHM.md.

## Executed validation

| Check                                                     | Result                                          |
| --------------------------------------------------------- | ----------------------------------------------- |
| Frozen `npm ci`                                           | Passed                                          |
| PostgreSQL 17 startup                                     | Passed                                          |
| SQL migrations and repeat application                     | Passed                                          |
| Strict TypeScript                                         | Passed                                          |
| ESLint                                                    | Passed                                          |
| Production frontend build                                 | Passed                                          |
| Vitest                                                    | **54 passed, 0 failed**, 7 files                |
| Playwright                                                | **4 passed, 0 failed**, desktop/mobile Chromium |
| Dedicated worker consumes committed job                   | Passed, included in Vitest                      |
| API database health request                               | Passed, `status: ok`                            |
| Visual inspection / document overflow at 1440px and 390px | Passed, no horizontal document overflow         |
| `npm audit --omit=dev`                                    | 0 known vulnerabilities reported                |

The protocol tests mock Google transport and, for OIDC tests, JWT verification. They do not verify real credentials, Google's consent policy, JWKS discovery or live webhook behavior. Native Safari/device checks, production image builds, GitHub-hosted CI and live deployment were not executed. The Playwright CDN download was blocked, so tests used installed system Chromium. No TLS or artifact verification was disabled.

## Security

HTTP-only SameSite cookies, Secure in production; server-side expiry; CSRF token plus exact-Origin validation on mutations; ownership checks; rate limits; Zod validation; safe HTTP/HTTPS links; React escaping; escaped Google event description content; AES-256-GCM token encryption; parameterized SQL; redacted/no-query request logging and generic internal errors. Nginx configuration adds static-web CSP and security headers. These are implemented safeguards and automated checks, not an independent security audit.

## Run and configure

From the repository root:

```sh
npm ci
docker compose up -d db
cp .env.example .env
# Set the Google client credentials and a stable encryption key privately.
npm run db:migrate
npm run dev
```

Required interactive-login values: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Calendar also needs TOKEN_ENCRYPTION_KEY (64 hex characters). DATABASE_URL defaults to the local Compose development DB. APP_ORIGIN, API_ORIGIN, NODE_ENV and optional WEBHOOK_ORIGIN are documented in DEPLOYMENT.md, including exact redirect URIs, Google scopes, production Compose commands, HTTPS, backups and live acceptance steps. Do not enter secret values in chat.

## Environment persistence

Saved `install_script`, `start_skill`, requirements for the three Google/encryption variables and restricted-domain additions `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`. Package-manager presets were preserved. Draft persistence was confirmed. Configuration review/publication and fresh-task restoration have not been performed. Review/save the draft and publish through environment settings when ready.

## Limitations and outstanding work

- Interactive sign-in cannot be verified until a Google client and consenting account are configured. Live Calendar behavior is likewise unverified.
- External availability currently covers the primary Google calendar; there is no multi-calendar selection UI.
- External free/busy is reconciled asynchronously; an initial internally calculated preview may move after Google availability is fetched.
- Corrections support the latest review only and reject changes when the next review has a manual override. Older-history replay is intentionally unavailable.
- Existing automatic sessions use changed timezone/study settings when newly scheduled or reset to automatic. Preference edits do not rewrite historical memory due dates or manual times.
- Three external deletions in a day pause event recreation and surface a warning. Explicit Resync clears the pause and creates a fresh event generation; this is covered by a mocked-protocol test.
- Google calendar creation that succeeds remotely but loses its response before ID persistence can leave an orphan calendar. Validate this rare failure case before launch.
- Disconnect removes local token material and stops synchronization; existing external events are retained. Users can revoke Google grants through Google Account settings.
- Runtime Docker image retains development dependencies; images, production database access, HTTPS and monitoring must be validated in the deployment target.
- No known failures remain in the executed local suites. Untested external behavior is not described as bug-free or production-ready.

Code is saved in the local repository. No remote push or deployment is implied.
