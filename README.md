# Blind Spot Interval

Make room for what you know. A TypeScript spaced-repetition app with a real PostgreSQL API, FSRS-7, internal availability scheduling, and optional Google Calendar synchronization.

## Run locally

Requires Node **24+**, npm, Docker with Compose, and a Google OAuth web client for interactive sign-in. There is deliberately no development login backdoor.

```sh
npm ci
docker compose up -d db
cp .env.example .env
# Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY in .env.
npm run db:migrate
npm run dev
```

The development commands start Vite (5173), Fastify (3001), and the durable-job worker. Vite proxies `/api` so browser requests and cookies remain same-origin. See [Google setup and deployment](docs/DEPLOYMENT.md) for exact redirect URIs and required configuration. Without Google credentials the services and automated tests run, but interactive Google-only sign-in is unavailable. Internal scheduling does not require Calendar authorization.

```sh
npm run test         # Real PostgreSQL plus unit tests; mocks Google transport
npm run test:e2e     # Desktop + mobile Chromium; creates isolated test sessions in DB
npm run typecheck
npm run lint
npm run build
```

For browser tests, installed `/usr/bin/chromium` is used when present. Otherwise run `PLAYWRIGHT_BROWSERS_PATH=/tmp/blindspot-browsers npx playwright install chromium`. Tests must use a disposable development/test database, never production.

## Structure

```text
apps/web/                   React, Vite, Tailwind, Radix dialog primitives
apps/api/                   Fastify REST API, Google OIDC, Calendar transport
apps/worker/                Durable PostgreSQL jobs, reconciliation and watches
packages/database/          SQL migrations and introspected Drizzle schema
packages/shared/            Zod contracts, defaults and shared types
packages/memory-engine/     ts-fsrs 6 / FSRS-7, original-rating policy
packages/calendar-scheduler/ Availability and timezone policies
 tests/                     Vitest integration/unit and Playwright tests
 docs/                      Specification, architecture and operating instructions
```

## Features

- Google-only OIDC sign-in, server-side opaque sessions, separate optional Calendar consent.
- Today queue and completion progress; searchable/filterable topics; archive and restore with history intact.
- Nullable initial knowledge/importance; custom tags; ordered text/link materials; duration and scheduling preview.
- Five recall ratings; transactional exactly-once completion; audited correction of the latest rating.
- FSRS-7 state, weights, version and actual timestamps persisted with each review.
- Day/week/month internal calendar; local study hours and scheduling windows; protected manual overrides.
- Google events, incremental inbound synchronization, deletion replacement with loop protection, primary-calendar free/busy, durable retries, polling and optional push watches.
- Light/dark themes, mobile navigation, keyboard dialogs and self-hosted fonts.

## Status and limits

See [test evidence](docs/TESTING.md) and [decisions](docs/DECISIONS.md). Local automated verification is separate from live Google verification and deployment. Google login, refresh grants, Calendar scopes and webhooks require a real configured client and consenting test account before production acceptance. The initial implementation reads external availability from the primary Google calendar, not a multi-calendar picker. Latest-review corrections are supported; earlier-history corrections are rejected rather than silently replaying history.

No live deployment or Google verification is implied by building the code. Do not publish this as production-ready until the live acceptance checklist in the deployment guide is complete.
