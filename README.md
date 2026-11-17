# Blind Spot Interval

Make room for what you know. An adaptive knowledge-review app with **Firebase Authentication, Firestore, Cloud Functions v2 and Firebase Hosting**. React/Vite provides the interface; the existing FSRS-7 and availability packages remain shared and independent.

## Run the Firebase app locally

Requires Node 24+, npm and Java 21. Install from the repository root.

```sh
npm ci
npm run dev
```

This runs the demo Auth (9099), Firestore (8080), Functions (5001), Emulator UI (4000), Hosting (5000), Vite (5174), and a local retry/reconciliation process. Scripts explicitly select **`demo-blind-spot-interval`**, even though the user's real project alias remains `blind-spot-interval`.

In this restricted cloud, use the verified Firestore download fallback and headless mode:

```sh
npm run emulators:prepare
npm run dev:headless
```

The core emulators work through a checksum-verified official Google SDK distribution. The optional Emulator UI download and browser Google-popup script remain blocked by network policy here. [Setup instructions](docs/FIREBASE_SETUP.md) explain the workaround, exact commands, public Firebase web configuration and separate offline Calendar OAuth.

## Validate

```sh
npm run typecheck
npm run lint
npm run build
npm test                  # Portable algorithm/security tests
npm run test:firebase     # Real demo Auth/Firestore/Functions and rules tests
npm run test:e2e          # Real Firebase backend, desktop/mobile Chromium
```

Tests reject non-demo projects and wrong/missing emulator hosts before loading Admin SDK. Google Calendar transport is mocked. Browser E2E authenticates with a supported demo Google credential through Firebase Auth; it does not claim real Google consent or popup verification.

## Features

- Google Sign-In through Firebase Authentication, verified bearer tokens and owner-isolated Firestore data.
- Onboarding and editable timezone, study hours, duration, scheduling window and retention mapping.
- Today queue/progress, searchable/tagged topics, archive/restore, details/history, and a lightweight ordered materials editor.
- Nullable initial knowledge/importance; scheduling preview; five recall ratings; exactly-once review completion and audited latest-rating correction.
- Pinned ts-fsrs 6.0.0 / FSRS-7 with real timestamps, full card snapshots, fast stability, model version and weights.
- Independent calendar scheduling with precise due times, configurable date windows, recovery tomorrow/nearest free day, conflicts, DST and protected manual overrides.
- Optional separate Calendar offline consent, encrypted refresh grants, dedicated events with materials, primary free/busy, two-way moves/deletes, bounded deletion recreation, incremental sync, watches, retries and reconciliation.
- Light/dark themes, mobile navigation, keyboard dialogs and locally served fonts.

## Structure

```text
apps/web/                    React UI and Firebase Auth/bearer transport
functions/src/               Authenticated REST API, Firestore transactions, Calendar/jobs
packages/memory-engine/      Existing FSRS-7 implementation
packages/calendar-scheduler/ Existing scheduler plus tested edge-case fixes
packages/shared/             Zod contracts and shared preferences
scripts/                     Demo runners, reconciliation and safe migration tooling
firestore.rules              Owner reads, server-only mutations/private data
firestore.indexes.json       Job/query indexes and expiry policies
firebase.json                Functions, Hosting and emulator configuration
apps/api/, apps/worker/,
packages/database/           Preserved PostgreSQL rollback implementation
```

The user's initial Firebase scaffold is incorporated. The real project alias, Firestore `eur3` location and Node 24 settings are preserved; Functions use `europe-west1`. Nothing has been deployed and no production database has been changed.

## Migration and deployment

Read [the implementation report](docs/FIREBASE_IMPLEMENTATION_REPORT.md), [the migration audit](docs/FIREBASE_MIGRATION_PLAN.md), [architecture](docs/FIREBASE_ARCHITECTURE.md), [setup/deployment preparation](docs/FIREBASE_SETUP.md), and [implementation progress](docs/IMPLEMENTATION_PROGRESS.md). The migration tool is read-only for PostgreSQL export, dry-run by default, and only allows create-only imports into the explicit demo emulator. Production migration and deployment require separate approval.

The old backend remains available through `npm run dev:legacy` and its original tests. [PostgreSQL instructions](docs/POSTGRES_README.md) are retained for rollback; Docker/production Compose files explicitly target that legacy mode.

Real Google popup login, Calendar grants/webhooks, the optional emulator UI, deployed Functions/Hosting and native Safari/Android remain separate live acceptance checks. Do not treat emulator or mocked tests as evidence of production readiness.
