# Firebase development and deployment preparation

The active architecture is Firebase Authentication → Functions v2 → Firestore, with Firebase Hosting. PostgreSQL/Fastify remain available as an explicit rollback mode; they are not used by the Firebase API.

## Preserved project settings

The user's scaffold commit `b8b678e` is incorporated. `.firebaserc` keeps the real default project `blind-spot-interval` and adds an emulator alias. The existing Firestore `(default)` database and `eur3` location are preserved. Functions and Hosting rewrites use `europe-west1` near that EU database. Node 24 and maxInstances 10 are preserved.

**All supplied local/test commands explicitly use `demo-blind-spot-interval`.** Do not use a bare CLI command that infers the real default alias for automated tests. The real project was not accessed or deployed during implementation.

## Requirements

Node 24+, npm, Java 21. Run dependency installation from the repository root, not only inside `functions`. Root workspaces contain the build tools and shared algorithms. `functions/package-lock.json` separately locks the deployable runtime dependencies.

```sh
npm ci
npm run dev
```

This builds the standalone Functions artifact and starts:

| Component                        | Port |
| -------------------------------- | ---- |
| Firebase Authentication emulator | 9099 |
| Firestore emulator               | 8080 |
| Functions emulator               | 5001 |
| Emulator UI                      | 4000 |
| Hosting emulator                 | 5000 |
| Vite development frontend        | 5174 |

The Vite proxy forwards `/api` to `/demo-blind-spot-interval/europe-west1/api` in the Functions emulator. Hosting rewrites use the same function and region. The development frontend defaults to the demo Firebase project; production builds require the real web app configuration below.

The local reconciliation process mirrors the deployed five-minute scheduled function: it processes eligible retries, recovers stale leases, and reconciles connected calendars. It refuses non-demo projects and remote Firestore hosts. The actual Functions v2 document trigger handles newly committed jobs.

Use the task's existing isolated checkout. Do not create worktrees unless explicitly requested. Dependencies and files may persist across cloud snapshots; emulator, worker and Vite processes must restart.

## Restricted cloud network fallback

This cloud blocked downloads from `storage.googleapis.com`. The repository includes a verified alternative for the core Firestore emulator:

```sh
npm run emulators:prepare
npm run dev:headless
```

`emulators:prepare` downloads Google's official Cloud SDK 580.0.0 component manifest over TLS from `dl.google.com`, verifies the Firestore component archive against Google's published SHA-256, extracts the same emulator version 1.22.0, and creates a small Java launcher manifest using Google's documented main class. It does not alter the verified emulator JAR. Every subsequent start verifies the cached JAR/launcher hashes. Java 21 is sufficient. The fallback script needs curl, tar and Python 3 on Linux; it is unnecessary when normal Firebase downloads work.

Firebase CLI 15's explicit proxy handling ignores `NO_PROXY` for localhost. `scripts/firebase-cli.mjs` routes only HTTP loopback requests directly and disallows automatic redirects on those requests. All external requests retain their existing proxy and TLS behavior. No certificate/checksum verification is disabled.

Headless mode uses an ignored generated configuration with the UI disabled; the committed `firebase.json` still configures UI port 4000. Downloading the optional UI requires `storage.googleapis.com`, which remains a network prerequisite here. Browser popup authentication also loads a Google script from `apis.google.com`; that destination was blocked in this cloud. Emulator E2E uses Firebase SDK Google credentials rather than claiming the blocked popup worked.

To verify the Hosting emulator locally, build first with appropriate public Firebase variables, then request its index and `/api/v1/me`. An unauthenticated `/me` must return 401. A live PID or open port alone is not a health check.

## Automated checks

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:firebase
npm run test:e2e
```

`npm test` runs portable memory/scheduler/security unit tests. `test:firebase` starts the actual demo Auth/Firestore/Functions emulators and runs API, rule, Calendar protocol and migration checks. `test:e2e` uses those emulators plus Vite and desktop/mobile Chromium. Test guards reject a non-demo project or a missing/wrong emulator host before importing Admin SDK. No production Firestore test is authorized or necessary.

For machines without system Chromium, install Playwright's browser using `PLAYWRIGHT_BROWSERS_PATH=/tmp/blindspot-browsers npx playwright install chromium` (PowerShell: set `$env:PLAYWRIGHT_BROWSERS_PATH` first). The test config automatically uses `/usr/bin/chromium` when available in this cloud.

Legacy validation is still available with `npm run test:legacy`, `npm run test:e2e:legacy`, and `npm run dev:legacy`; those commands require the local PostgreSQL database. Legacy Docker files target the PostgreSQL mode, not Firebase deployment.

## Firebase web app configuration

In the existing Firebase project, enable Google as an Authentication provider and add the actual Hosting/custom domain and development localhost domain to authorized domains. Copy the public web app configuration from Firebase project settings into an ignored root `.env.local` or CI build variables:

```text
VITE_BACKEND=firebase
VITE_USE_FIREBASE_EMULATORS=false
VITE_FIREBASE_PROJECT_ID=blind-spot-interval
VITE_FIREBASE_API_KEY=<Firebase web config>
VITE_FIREBASE_AUTH_DOMAIN=<Firebase web config>
VITE_FIREBASE_APP_ID=<Firebase web config>
```

These Firebase web values are public application identifiers, not service-account credentials. Never put service-account JSON, Calendar client secrets or encryption keys in VITE variables. For local emulators use `.env.firebase.example`; emulator mode refuses a non-demo project. Production builds do not silently fall back to emulator credentials.

## Separate offline Google Calendar grant

Firebase Google Sign-In identifies the user. It is **not** an offline Calendar authorization grant.

1. Enable Google Calendar API in the existing Google Cloud project and configure its consent/test users.
2. Create/use an OAuth Web client and register the exact Calendar redirect URI. Local Vite: `http://localhost:5174/api/v1/calendar/callback`. Production Hosting: `https://YOUR_HOST/api/v1/calendar/callback`.
3. Set non-secret Functions values in an appropriate private Functions environment file: APP_ORIGIN, CALENDAR_REDIRECT_URI, GOOGLE_CLIENT_ID; WEBHOOK_ORIGIN is optional public HTTPS. Copy `functions/.env.example` as a starting point. Keep actual local configuration untracked.
4. Store GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY in Secret Manager for production. The encryption key must be 64 hex characters and stable across deployments. For local testing with a real Calendar account, put them in ignored `functions/.secret.local`. Never send these values in chat or expose them to the browser.
5. Calendar connect requests only `calendar.app.created` and `calendar.events.freebusy`, uses PKCE and single-use browser-bound state, and stores the offline refresh grant as an AES-GCM envelope in a server-private collection. Internal scheduling remains usable without consent.
6. Public HTTPS push notifications use `/api/v1/webhooks/google-calendar`. Polling/reconciliation remains a fallback. Primary-calendar availability is the initial external availability source.

Real Google consent, quotas, offline grants, watch delivery/renewal and popup login must be verified with a real test account before production acceptance. Mocked Calendar tests and emulator Google identity are not evidence of live Google operation.

## PostgreSQL migration tooling

The tool is dry-run-first and production writes are deliberately unsupported.

```sh
# Set DATABASE_URL explicitly; this export is read-only.
npm run firebase:migrate -- export --file /PRIVATE_PATH/export.json
# Supply a JSON object mapping old PostgreSQL user UUIDs to Firebase Auth UIDs.
npm run firebase:migrate -- import --file /PRIVATE_PATH/export.json --uid-map /PRIVATE_PATH/uids.json
```

Exports are created with mode 0600 and fail if the output exists. They contain personal notes/history, so keep them outside Git. Session cookies, OAuth states, Calendar credentials and transient jobs are excluded. Non-secret dedicated-calendar IDs and event mappings are retained so reconnecting can reuse the existing calendar; connections remain disconnected with no token envelope. Calendar must be reconnected after migration.

The apply flag is accepted only with project `demo-blind-spot-interval`, Firestore host `127.0.0.1:8080` and Auth host `127.0.0.1:9099`. A mapped Auth account must exist and the destination Firestore documents must be empty. Per-user atomic batches use create-only preconditions, refuse overwrites, and reject imports exceeding 450 documents per user before writing that user. The tests exercise nullable ratings, ordered materials, dry-run behavior, overwrite refusal and production refusal. This tool does not authorize or perform a production cutover. A future approved production migration needs a backup, UID mapping, maintenance window and reviewed large-account batching strategy.

## Deployment preparation — requires separate explicit approval

No deployment has been run. After approval and live verification:

1. Confirm billing/Blaze, region, enabled Google APIs, service-account permissions, Auth provider/domains and Secret Manager bindings in the existing project.
2. Back up Firestore, retain the Calendar encryption key separately and verify restoration procedures. Do not overwrite existing production documents.
3. Install from root and run all checks. Build Vite using the real public Firebase config. Build Functions from the monorepo before deployment; `gcp-build` is intentionally empty so Cloud Build uses the prepared standalone `lib/index.js` instead of rebuilding imports outside the Functions source directory.
4. Review Firestore rules/indexes and deploy to a staging project first, using an explicit project ID. The deployable functions are `api`, `syncJob` and `reconcileCalendar`, in `europe-west1`. Deploying the cron function configures Cloud Scheduler; TTL declarations clean expired OAuth/rate-limit/terminal job records where enabled by the project.
5. The reviewed command would be `firebase deploy --project YOUR_EXPLICIT_PROJECT --only firestore,functions,hosting`. Do not execute it without approval.
6. Verify Hosting asset delivery and rewrites, real sign-in, cross-user isolation, create/review/correction/archive flows, real Calendar event content and two-way moves/deletes, scheduler retries, sync cursor recovery and watch delivery. Monitor function errors and private job statuses. Test native Safari/Android separately from Chromium emulation.
