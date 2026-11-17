> Historical PostgreSQL implementation documentation. The active Firebase migration is documented in [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [FIREBASE_ARCHITECTURE.md](FIREBASE_ARCHITECTURE.md).

# Verification

Commands run against the real development PostgreSQL 17 database. Tests use unique per-run users and remove their own fixtures. Never point tests at production. Vitest files run sequentially with isolated module workers. Browser tests create server-side test sessions directly in the database; they do not introduce a production login endpoint.

- `npm run db:migrate`: applies versioned SQL; rerun verifies migration idempotency.
- `npm test`: memory policy, availability, PostgreSQL API authorization/transactions, mocked Google Calendar and mocked OIDC protocol checks.
- `npm run test:e2e`: Chromium desktop and iPhone-sized Chromium profiles; real API/database. Covers topic creation/editing/materials, recall rating, history, archive/restore, preferences, calendar and keyboard focus restoration.
- `npm run lint`: ESLint.
- `npm run build`: strict TypeScript plus production Vite build.

Google transport and JWT verification are explicitly mocked in protocol tests. They exercise app state/nonce behavior and persistence but do not prove real Google credentials, signature-key discovery, refresh grant policy, quota handling or webhook delivery. Live test requirements are in DEPLOYMENT.md. Real iOS Safari/Android device checks remain separate from Chromium emulation.

Detailed current-run counts and command outcomes are recorded in FINAL_REPORT.md after final validation. Early failed runs are not reported as passing: they exposed a JSON serializer collision, random FSRS card identifiers, a sync-token recovery loop and missing dialog focus restoration, which were fixed and rechecked.

The Playwright CDN was blocked in this cloud policy. The available system Chromium is used through executablePath without disabling certificate verification. For machines without Chromium, install the Playwright browser in an allowed cache location and allow its download domains.
