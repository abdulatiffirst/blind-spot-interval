# Firebase migration audit and plan

The selected checkout is the Linux cloud checkout of `abdulatiffirst/blind-spot-interval`, initially at `3bde9d9`. It is clean and matches remote main. The Windows Firebase initialization described in the supplied prompt is not present in either location. No Firebase config will be inferred from production credentials or overwritten.

## Existing implementation

- React frontend: Google login entry, onboarding, Today/progress, topics/search/tags/archive/restore, ordered materials, detail/history/correction, five recall ratings, calendar views/manual overrides and preferences. `apps/web/src/api.ts` is the transport boundary.
- Fastify API: versioned auth/preferences/topics/reviews/scheduling/Calendar endpoints. Cookie sessions, CSRF, validation and ownership checks. Business transactions in `apps/api/src/service.ts`.
- PostgreSQL: users/preferences/topics/materials/tags/associations/memory/logs/schedules/connections/events/jobs plus OAuth/session/audit records. SQL and Drizzle schema under `packages/database`.
- Memory: pinned ts-fsrs 6.0.0, FSRS-7 card snapshots and weights; cold start has no fabricated reviews; ratings 1/2 recover tomorrow locally. Calendar scheduler is independent and timezone-aware but currently discards the exact ideal time by rounding to local midnight; window fallback and invalid input need regression coverage before changes.
- Calendar: separate PKCE offline consent, AES-GCM encrypted refresh tokens, dedicated calendar, primary free/busy, deterministic IDs, ETags, incremental cursor/pagination, watches, deletion loop protection, polling and durable PostgreSQL worker.
- Dependencies: web → shared contracts; API → memory + calendar + SQL; worker → existing Calendar service → SQL. Algorithms are portable, existing Calendar persistence is not.
- Existing tests: 54 Vitest tests last recorded plus four Chromium E2E cases. A new baseline is run during migration; results will be recorded rather than assumed.

## Implementation

1. Keep PostgreSQL implementation and tests intact as an explicit legacy mode. Add Firebase Functions v2 REST adapter with Firebase ID-token verification, preserving response shapes used by the UI.
2. Use user-scoped Firestore topic/material/tag/memory/history/schedule/event collections, a preferences document, and server-only OAuth/Calendar/job/lease collections. All domain writes go through Admin SDK transactions; rules permit only owner reads of public user data and deny browser writes/server-private access. Serialize schedules per user using a revision document.
3. Bundle Functions with portable algorithms into a standalone Node 24 artifact. Add demo-only emulator configuration and production Hosting rewrites without inventing a real project ID.
4. Replace frontend Google login with Firebase Auth popup/redirect and bearer ID tokens. Keep offline Calendar consent separate, initiated through an authenticated API and bound to a short-lived, single-use browser state.
5. Port Calendar persistence and durable leased jobs to Firestore. Add Functions document trigger and scheduled reconciliation; no network operations inside Firestore transactions.
6. Test rules, ownership, idempotent transactions, complete workflow and Calendar protocol against real demo Auth/Firestore/Functions emulators. Mock external Google transport only. Run frontend desktop/mobile E2E and original algorithm suites.
7. Provide a dry-run-first PostgreSQL export/import tool with explicit UID mapping; no migration/deployment to production is authorized.

No deployment or production data changes are part of this task. Credentials and real Google consent/webhook verification remain external prerequisites.

## User scaffold incorporated

During implementation the user pushed `b8b678e` containing the Firebase scaffold. It was fetched and incorporated before finalizing the migration. The real default project alias `blind-spot-interval`, Firestore `(default)` database and `eur3` location, runtime-config restriction, Node 24 and maxInstances 10 were preserved. Functions and Hosting rewrites use `europe-west1` to colocate with the EU database. Demo scripts always pass their own explicit demo project and never infer production from the default alias. The generated CommonJS ESLint reference was renamed `.eslintrc.cjs`; active Functions lint/type-check/build uses the compatible workspace configuration and standalone deployment lockfile.
