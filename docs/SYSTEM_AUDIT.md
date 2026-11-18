# Blind Spot Interval system audit

## A. Executive summary

Completing a future review advances memory at the actual completion time. In the Firebase emulator, the completion transaction wrote one history entry, completed the original schedule, created a pending successor, updated the topic pointer and queued one outbound job. Processing that job against a mock Google Calendar removed the original event and published the successor at the time stored in Firestore. A simulated availability outage left the job retryable. Recovery left exactly one live event.

Three faults could make the next review appear missing. A repeated completion returned no successor, Calendar cleanup could throw on an empty successful DELETE, and the internal calendar could open on a previously selected period that excluded the new review. A separate availability failure could prevent outbound publication altogether. The fixes cover these paths independently. The historical production incident lacks a request trace, so its exact cause remains unconfirmed.

Other repairs preserve topic fields on partial edits, preserve recovery scheduling across archive/restore, and keep the detail dialog from offering a correction against stale history. Live checks in this audit were limited to the published homepage (HTTP 200) and an anonymous profile request (HTTP 401). All account and scheduling writes used test environments.

## B. Feature audit

“Passed” describes the listed evidence and environment. “Fixed” identifies a behavior changed during this audit. Production-only checks appear in section I.

| Feature | Status | Evidence and scope |
|---|---|---|
| Landing, Google button, onboarding, preferences | Passed | Chromium checks the sign-in entry, loading and retry states, and first-use onboarding. The Firebase API persists timezone and study hours. |
| Google identity, profile, persistent session, logout, returning learner | Passed | Browser tests use an emulator Google credential, reload the workspace, sign out, and sign in again. Auth API tests reject missing, malformed, disabled, revoked and non-Google credentials. Forced profile 401/503 and popup startup failure/hang have browser coverage. |
| Live Google account chooser, popup/redirect on deployed origin, real-token expiry and refresh | Not verified | The emulator and forced API failures exercise application behavior. Live browser storage policies, redirect configuration and refresh after real expiry require a test account. |
| Today, upcoming, progress, active count | Fixed | Date grouping uses the learner's zone. The active count uses distinct pending topic IDs across the full upcoming list. Returning from the archived list no longer zeros it for an active topic. |
| Topic list, search/sort, details, tags, materials and links | Fixed | Validated owner-scoped reads, ordered notes, link schemes, tag deduplication and editing. Partial update tests preserve omitted fields. Tag edits are part of topic editing. |
| Create, edit, archive and restore | Fixed | Browser and API cover the lifecycle. Restore preserves memory/history and now preserves the low-rating recovery ideal date. Duplicate keyed creates yield one topic. |
| First review, initial knowledge, importance, retention | Passed | Fixed-input unit tests cover knowledge and rating ranges, null inputs and retention policy. Browser checks knowledge 3, importance 5 and 95% target. |
| FSRS-7, early/late completion, ratings 1–5 and repeated failures | Fixed | Existing model and weights retained. Repeats of a completion now return the committed successor. Negative/invalid schedule inputs, deterministic replay, recovery and clock changes have regression coverage. |
| Review history and latest rating correction | Fixed | UI loads matching details and history together. API audit record, repetition count, correction retry and recovery successor checked. |
| Default 09:00–21:00 window, 15-minute duration, custom hours/durations, internal and external conflicts | Passed | Controlled scheduler tests cover occupied slots, fallback days, morning recovery, spring and autumn clock changes. A fully busy horizon returns an unscheduled pending review and a reason. |
| Manual schedule, return to automatic, preview, warnings | Fixed | API and browser cover manual and automatic moves. Preview errors resolve visibly. Completion reports the scheduling reason when placement has no slot. |
| Internal calendar, period navigation and completion notice | Fixed | Calendar uses the configured timezone, moves by calendar months, and opens on the scheduled successor following completion. Browser tests start in a different period and exercise January to February navigation. |
| Settings, feedback, keyboard and mobile layout | Passed | Preference API and browser exercises, error/retry messages, modal Escape, sign-out and horizontal overflow checks. Mobile Chromium uses an emulated viewport. |
| Appearance, calendar event deep links and OAuth return navigation | Not verified | Inspected the theme toggle and local preference storage, review links in generated event descriptions, and Calendar return routing. No automated round trip from a real Google event or cross-browser theme persistence test. |
| Browser compatibility and accessibility beyond sampled flows | Not verified | Firefox covers signed-in reload. Native iOS Safari, live redirect, assistive technology, a complete keyboard traversal and every combination of themes, locales and screen sizes remain open. |
| Calendar OAuth, encrypted offline tokens, refresh, disconnect/reconnect | Passed | Local HTTP connect/cookie and mocked callback exchange, expiry/replay rejection, reuse of the dedicated calendar, refresh and disconnected transport checks. |
| Google event creation, updates, deletion and early replacement | Fixed | Mocked success, empty responses, stable event IDs, URL/markup escaping, app and external moves, deleted-event recovery, bounded recreation and replacement of a future event. |
| Webhooks, watches, incremental polling, expiry and resync | Passed | Tested validation/deduplication, watch renewal, sync-token 410/full scan and explicit resync. Remote notification delivery requires a live Google channel. |
| Outbound job, reconciliation and failure visibility | Fixed | Tested committed jobs, per-user leases, retry backoff, safe errors, availability failure, retry convergence and completed-job replay. Scheduler deployment and production throughput remain open. |
| Firestore rules, isolation, indexes and migration | Passed | Emulator rules and migration dry-run tests, concurrent mutations, ownership checks and source inspection of indexes/TTLs. Actual deployed indexes and TTL execution remain open. |
| Hosting, Functions runtime, build and CI configuration | Fixed | Node 24 builds, root Vite envDir and production bundle configuration verified. Hosting routes API requests to the regional function. GitHub workflows define separate Firebase and legacy verification jobs. |
| Production OAuth credentials, IAM, external Google delivery and device coverage | Not verified | See section I. |

### Architecture and data relationships

Firebase Hosting serves the React/Vite client and rewrites `/api/**` to the regional second-generation Express API. Firebase Auth supplies the bearer token. The API derives the user path from the verified UID. Domain transactions use the owner document revision to serialize scheduling changes for one learner. Shared packages implement validation, FSRS advancement and time-slot selection. The legacy Fastify/PostgreSQL API and worker have separate test suites.

| Store | Relationship and integrity check |
|---|---|
| `users/{uid}`, `preferences/default`, `tags`, `topicMaterials` | Owner identity/revision, study policy, tags and ordered topic material. Partial topic writes merge the supplied fields before applying schema defaults. |
| `topics`, `memoryStates`, `reviewSchedules` under the owner | Active topic points to its current pending schedule. FSRS state includes the card and latest review reference. Manual placement changes the schedule without adding a repetition. Archiving cancels the pending schedule. |
| `reviewHistory`, `reviewCorrections` under the owner | Review history is keyed by completed schedule ID. Corrections use the prior snapshot and preserve the number of actual reviews. |
| `calendarEvents` under the owner | Per-schedule mapping records the external ID, etag and sync/deletion status. Stable IDs make retrying publication possible. |
| `calendarConnections`, `oauthStates` | Server-managed connection generation, encrypted tokens, cursor and channel state. Browser-bound OAuth state expires and is single use. |
| `syncJobs`, `syncLocks` | Completion writes the job with scheduling data in one transaction. Firestore creation triggers a worker. Scheduled reconciliation runs every five minutes, creates work per connected owner and revisits due or expired leases. |
| `rateLimits`, `_health` | Authenticated per-user request buckets and the health check's Firestore read. Rules restrict direct client access. |

### Firebase HTTP surface

Paths below are relative to `/api/v1`, except the root health path. Every listed route has an HTTP exercise. Positive callback and webhook protocol behavior also use direct service tests with mocked Google responses.

| Routes | What was checked |
|---|---|
| `GET /health` (root), `GET /me`, `POST /auth/logout` | Health, initialized identity, denial/revocation, sign-out, limit and unknown-route errors. |
| `GET, PATCH /preferences`; `GET /tags` | Read/update onboarding settings, validation and tag lookup. |
| `GET, POST /topics`; `GET, PATCH /topics/:id`; `PUT /topics/:id/materials` | Creation, retries/concurrent creation, filters, owner boundaries, missing/invalid IDs, partial edits and malformed materials. |
| `POST /topics/:id/archive`, `POST /topics/:id/restore`, `GET /topics/:id/history` | Cancel/recreate schedule, preserve history and memory, retrieve the review actually completed. |
| `GET /reviews/today`, `/reviews/upcoming`, `/reviews/progress`; `GET /schedule/preview` | Dashboard queries, completion count, preview inputs and invalid duration. |
| `POST /reviews/:id/complete`, `POST /reviews/:id/correct`; `PATCH /reviews/:id/schedule`; `POST /reviews/:id/reset-auto` | Early/concurrent completion, correction replay, manual and automatic times. |
| `GET /calendar/connect`, `/calendar/callback`, `/calendar/status`; `POST /calendar/disconnect`, `/calendar/resync`, `/webhooks/google-calendar` | Browser binding, malformed callback, untrusted origin, status redaction, disconnect, explicit resync and malformed webhook. |

## C. Bugs found

| Severity and symptom | Reproduction and root cause | Fix and evidence |
|---|---|---|
| High · lost topic metadata | Create a topic with tags, notes, importance and a nondefault duration. PUT only materials or PATCH only title. Parsing a partial schema inserted defaults before merging with existing fields. | Merge supplied fields into the stored representation, then validate the result. Shared schema helper and both domain services. PostgreSQL merges fields under its per-user transaction lock. Both API suites cover partial writes, including simultaneous legacy edits and a malformed materials replacement. |
| High · successful review appears to lack a successor | Submit the same early completion concurrently. The replay branch returned history alone, even though the first transaction had created a successor. | Firebase domain and legacy service return the current pending schedule on replay. Both API suites check identical successor IDs and exactly-once review advancement. |
| High · next Google event delayed or missing | Complete a future review with an existing event. Empty HTTP 200 on deletion entered JSON parsing. Independently, a failed free/busy call skipped all outbound work. | `functions/src/calendar.ts` accepts bodyless successful deletes. `jobs.ts` attempts publication of the committed schedule even if availability fails and leaves the job retryable. The lifecycle test in `tests/firebase/calendar.test.ts` checks original mapping, history, successor, exact job, replacement time, eventual success and one live event. |
| Medium · sync status misleading or overly detailed | Successful inbound polling cleared the previous error before outbound completed. A thrown transport message could become user-visible and persist in Firestore. | Finalize the status with the leased job result for the same connected generation. Store a controlled error or HTTP status. Mocked transport failure and recovery assert both job and connection status. |
| Medium · retries create additional correction records or replace the successor | Submit the same correction twice for the latest review. The original path replayed FSRS and recreated its schedule on every call. | Both backends return the existing result for an identical correction. API regressions check the stable pending ID. The Firebase assertion also counts the correction records. The legacy API now rejects corrections on archived topics. |
| Medium · restore loses recovery policy | Complete with rating 1–2, archive and restore. Restore used the raw FSRS due time and set recovery to false. | Restore uses the last recorded rating and local recovery day on both backends. API checks cover unchanged memory, history and recovery ideal time. DST and repeated-failure unit tests exercise the underlying rule. |
| Medium · wrong rating correction presented | Complete twice, immediately open details and correct the visible review. Details rendered before history, and each old entry offered a button that the backend could reject. | Fetch details/history together, discard superseded requests and expose only the eligible entry. The Firebase browser lifecycle corrects the latest of two persisted reviews. |
| Medium · Calendar hides its new review or misses a month | Browse another week, complete early and reopen Calendar. The old anchor remained in effect. From January 1, a 30-day “month” stayed in January. | Set the anchor from the committed schedule in the learner's zone and use calendar-month arithmetic. Browser regressions in `tests/firebase-e2e/app.spec.ts`. |
| Medium · preview hangs or shows the preceding selection | Fail the preview API while adding a topic, or change inputs before the previous request resolves. Failures were swallowed and prior values retained. | `forms.tsx` clears obsolete state, cancels obsolete requests, reports an unavailable preview and uses configured retention. Browser regression forces HTTP 503. |
| Low · incorrect count or stale dashboard data | Select Archived and return to Today. Active count was computed from the filtered topics page. Overlapping refreshes could also display an older response. | Count distinct pending topic IDs and apply only the newest refresh. Browser tests cover return from Archived and delayed refresh/session transitions. |
| Medium · production build can miss Firebase configuration | Build with public VITE variables in the repository root. The web project root otherwise controls where Vite searches for env files. | Set envDir relative to the config file, retain the web app root and ignore root env variants. `tests/web-config.test.ts` checks resolved paths. A separate scratch build verified a marker from a root production env file reached the bundle. |

During development a Vite hot reload could mount another React root. The entry point disposes the previous root on hot replacement. This development-only fix was exercised during browser testing. There is no dedicated hot-reload automation.

## D. Security findings

- The Firebase API calls Admin `verifyIdToken(token, true)` and checks the Google sign-in provider. The emulator rejected a previously valid token after revocation, a disabled identity, a non-Google provider and cross-owner access. Requests bind data access to the decoded UID.
- Rules allow explicitly scoped owner reads and deny client writes, cross-owner reads and access to server-only state. The backend uses Admin privileges, so HTTP authorization is also covered independently.
- Calendar OAuth uses PKCE and a browser-bound single-use state. The cookie is HttpOnly. Grants are encrypted on the server. The status API exposes connection metadata. Webhook validation and duplicate notification handling are covered by protocol tests.
- Retained sync errors previously included arbitrary exception messages. Job and connection records now store bounded, non-sensitive descriptions. An injected private message is excluded by a regression assertion.
- Input validation covers ratings, identifiers, timezone/duration and link schemes. Origin checks and the authenticated per-UID request limit were exercised. A saturated user received 429 while another user could continue.
- At audit time, npm reported **0 runtime advisories** for both the root production dependency graph and the Functions production package. The full development tree reported **18 moderate, 0 high, 0 critical**. Development tooling remediation remains open. Review compatible updates to Firebase CLI and Drizzle tooling, including transitive branches, and rerun emulator and migration tests after upgrading.
- Effective production IAM roles, OAuth console grants, Secret Manager bindings and operational logs were outside emulator visibility. Existing credentials, grants and roles were preserved.

## E. Test results

Commands run from the repository root on Node 24 with Java 21, local Firebase Auth/Firestore/Functions emulators and PostgreSQL 17. Test account records were disposable. The Chromium mobile project uses an iPhone viewport. Calendar HTTP responses were mocked to exercise both failure and recovery.

| Command | Result |
|---|---|
| `npm test` | 40 passed |
| `METADATA_SERVER_DETECTION=none npm run test:firebase` | 36 passed across HTTP/Auth, Firestore, rules, Calendar/jobs and migration |
| `METADATA_SERVER_DETECTION=none npm run test:e2e` | 18 passed, nine workflows in each of desktop and mobile Chromium |
| `npm run db:migrate`, then `npm run test:legacy` with the local test DATABASE_URL | 68 passed. This suite overlaps the unit suite. |
| `npm run test:e2e:legacy` with the local test DATABASE_URL | 4 passed, desktop and mobile Chromium |
| Firefox session restore with the Firebase emulators running | 1 passed. Command below. |
| `npm run lint`, `npm run lint -w functions`, `npm run typecheck`, `git diff --check` | All passed |
| `npm run build`; `npx vite build --config apps/web/vite.config.ts --mode production` | Passed. The final production bundle contained the four expected public Firebase web configuration values. Main JS chunk 586.23 kB minified, 179.57 kB gzip. |
| `npm audit --json`; `npm audit --omit=dev --json`; `(cd functions && npm audit --workspaces=false --omit=dev --json)` | Full tree returned advisories. Both production-only scans were clean. |

The Firefox run used a temporary Playwright configuration extending the Firebase one, with a Firefox-only project, default Firefox executable and the repository's existing test directory.

```sh
GCLOUD_PROJECT=demo-blind-spot-interval \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/blindspot-browsers \
npx playwright test --config ../audit-firefox.config.ts \
  --grep 'loads the workspace with a Firebase token'
```

No tests were skipped in the full suites listed above. The exploratory Chromium run had 16 passes and two desktop failures. A cold emulator exceeded the initial browser assertion timeout, and the review-correction test exposed stale history. The cold-onboarding assertion now allows 40 seconds. An initial Calendar assertion also counted a cancelled Google tombstone as a live event. The final assertion checks live records and verifies the presence and time of the specific successor. The focused Firefox run selected one case intentionally. Final suite totals exclude unrelated runs and setup.

## F. Remaining risks

**Confirmed limitations**

- Free/busy fetches the primary calendar for 32 days. Later reviews can be published before their external availability is known. During an outage the committed slot is visible, the job records the failure, and a later successful availability check can move an automatic slot.
- A fully occupied search horizon yields a pending review with no time. That review cannot have a timed external event until it receives a slot. The UI now exposes the reason after completion.
- A worker lease lasts 10 minutes. Retries back off, cap at one hour and a job becomes terminal after 10 attempts. Regular reconciliation can create fresh work while a connection remains active. Terminal jobs have a 30-day expiry field. Actual cleanup depends on the deployed TTL policy.
- Firebase rule tests do not establish the effective permissions of the production Admin service account. The default client uses popup sign-in. A dedicated redirect fallback and physical-device browser policies were not validated.
- The full dependency tree has 18 moderate findings in development tooling. The production web build also emits a bundle-size warning. Neither blocked the tested flows.

**Risks identified by inspection, without a production reproduction**

- Several endpoints and per-user transactions scan whole subcollections. Reconciliation walks connected owners and reads at most 100 due plus 100 stale jobs per pass. Large histories, contention or sustained quota failures may increase latency and cost. No production-scale throughput or latency measurement was authorized.
- Dedicated-calendar creation crosses a network/durable-storage boundary. A crash after a successful calendar creation and before persisting its ID could leave an additional remote calendar. Event-level stable IDs cover event retries. Crash injection at calendar creation and account reconnect during an in-flight remote operation remain unverified.
- Recovery during restore relies on a usable latest review reference in Firestore. Legacy or manually damaged data without one falls back to the stored card or cold-start policy. The audit did not scan or repair production records.
- Production-only failure modes include disabled triggers, delayed Eventarc delivery, missing indexes, expired or revoked external consent, and Google quota exhaustion. The original production incident cannot be attributed to one of these or to a specific fixed path without a trace.

## G. Deployment instructions

**Required for the Firebase fixes:** Hosting and the Cloud Functions `api`, `syncJob` and `reconcileCalendar`. The latter two share the worker implementation. This revision requires no Firestore rules, index, database migration, IAM, credential or OAuth setting change. Legacy API fixes apply only where the PostgreSQL service is separately operated.

For an approved release, build from the reviewed commit at the repository root, using the existing production Vite configuration. Confirm the public Firebase project, API key, auth domain and application ID point to the intended web app and that emulator mode is off. Vite's envDir resolves to the repository root even though the web project's root is `apps/web`. Local env files can stay in place. Keep confidential server credentials in the existing Functions secret configuration.

```sh
npm ci
npm run build
npx firebase deploy --project blind-spot-interval --only "functions:api,functions:syncJob,functions:reconcileCalendar,hosting"
```

The deploy command is for the release operator. This audit ran local builds and a read-only production smoke check.

## H. Git information

Repository `abdulatiffirst/blind-spot-interval`, branch `main`. The working tree started clean at `7093bd8845a8738eb9ddcc9eaab0822d4be472cc`, after fetching and verifying the upstream branch. The audit report and fixes are included in the same commit. The final handoff supplies its SHA and upstream verification. The commit can also be located with `git log -1 --format=%H -- docs/SYSTEM_AUDIT.md`.

## I. Production verification checklist

Use a designated test account after an authorized deployment.

1. Verify the deployed Hosting version, Functions revisions and five-minute scheduler target. Check that the existing indexes for due and stale jobs are ready and the runtime identity has the expected grants.
2. Open the published site in a fresh profile, sign in with Google, reload, sign out and sign in again. Check onboarding for a new account and preservation of topics for a returning one. Repeat on native Safari/iOS and one browser with restricted storage.
3. Connect the test Google Calendar, complete consent, and verify the dedicated calendar and connected status. Create a topic, schedule a future review, and record the original schedule ID, external event and time.
4. Review early. For ratings 1–2, check the following local recovery day and applicable study-hour/availability limits. For a higher rating, compare the displayed successor with the stored ideal and scheduled times. Verify one original completion, one history entry, one pending successor and a matching topic pointer.
5. Follow the outbound job to completion and compare the external event timestamp with Firestore. Confirm the old event disappears, the successor appears once in both calendars, and a reload or explicit resync preserves that same event. Check the scheduled reconciliation logs for deferred work.
6. Move the test event in Google and confirm the internal schedule becomes manual without advancing memory. Try return-to-automatic, latest-rating correction, archive/restore, and disconnect/reconnect. Confirm manual changes and warnings follow the test account's timezone.
7. If publication is delayed, collect the schedule ID, job ID, timestamps, status, attempt count and sanitized error. Check Functions, Eventarc, Scheduler and Google quota status. Keep bearer tokens, cookies and OAuth grants out of reports.
