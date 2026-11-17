# Firebase migration implementation report

Completed in the selected cloud checkout on 17 November 2026. This report covers local implementation and verification, not a production deployment.

## Delivered

- Incorporated the user's Firebase scaffold commit `b8b678e`. Preserved the real default project alias `blind-spot-interval`, Firestore `(default)` database/`eur3` location, Node 24, runtime-config restriction and maxInstances 10. Functions and Hosting use `europe-west1`.
- React now observes Firebase Authentication, signs in with the Google provider, sends Firebase bearer ID tokens and signs out through the SDK. Existing onboarding, Today, topics/materials/tags, details/history/correction, review, calendar, settings, themes and mobile navigation remain connected to real backend data.
- Functions v2 implements the authenticated API, Firestore job-created trigger and scheduled reconciliation. User identity comes from verified/revocation-checked Firebase tokens; client-supplied owner IDs are ignored. Google is the accepted provider.
- Firestore owner namespaces hold preferences, topics, ordered materials, normalized tags, full memory states, review history/schedules/corrections and public event mappings. Private top-level collections hold encrypted Calendar grants, OAuth states, jobs, leases and rate limits. Rules deny all browser writes, anonymous/cross-user reads and access to private service records.
- Atomic domain transactions serialize each owner's scheduling decisions. Duplicate completion returns the existing review. A transaction saves the real timestamp/rating, original/mapped values, before/after FSRS snapshots, the next review and a durable job. Manual moves do not update memory. Latest-rating corrections have an audit trail.
- Preserved the actual ts-fsrs 6 / FSRS-7 implementation. Added regression coverage before changing scheduler behavior: preserve exact due times, reject invalid durations/dates/timezones/windows, prioritize the configured local-date window, keep recovery flags across placement, handle DST and preserve manual times.
- Ported Calendar OAuth and two-way synchronization to Firestore: separate PKCE offline consent, encrypted refresh grants and connection generations, reusable dedicated calendar, stable event IDs, material descriptions, primary free/busy, ETags/private metadata, external manual moves, bounded deletion replacement, incremental paging, expired cursor recovery, watch renewal, webhook validation/deduplication and durable retries.
- Calendar's browser state cookie uses Firebase Hosting's supported `__session` name. Firebase bearer authentication does not use that cookie. Local Hosting rewrite and state-cookie forwarding were exercised directly.
- Added safe migration tooling: explicit read-only PostgreSQL export, private exclusive-create files, UID mapping, default dry run, create-only atomic demo imports, overwrite/production refusal and a 450-document per-user limit. Nullable ratings, memory/history and material order are preserved. Non-secret Calendar IDs/event mappings are retained; grants/sessions/jobs are excluded and connections require fresh consent.
- Added root and standalone Functions lockfiles, a bundled deployable Functions artifact, Hosting/emulator configuration, CI checks and exact operating instructions. The old Fastify/PostgreSQL implementation remains available as an explicit rollback mode.

## Verification evidence

| Check                                                          | Outcome                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Original baseline before migration                             | 54 passed                                                                                                         |
| Legacy plus scheduler regressions                              | 64 passed, 0 failed, 8 files                                                                                      |
| Portable unit subset                                           | 37 passed; included in the 64 above                                                                               |
| Real demo Auth/Firestore/Functions integration and rules suite | 29 passed, 0 failed, 4 files                                                                                      |
| Firebase desktop/mobile Chromium E2E                           | 4 passed, 0 failed                                                                                                |
| Migration metadata preservation recheck                        | Passed, including NULL ratings, material order and existing Calendar/event IDs                                    |
| Strict TypeScript and ESLint                                   | Passed                                                                                                            |
| Functions artifact and frontend production build               | Passed                                                                                                            |
| Frozen root dependency install                                 | Passed                                                                                                            |
| Independent Functions runtime install/import                   | Passed with production runtime dependencies only; all three exports load                                          |
| Production dependency audit                                    | 0 known vulnerabilities after patched gRPC pin                                                                    |
| Actual headless development startup                            | Auth, Firestore, Functions, Hosting, Vite and local reconciliation started                                        |
| Functions DB health                                            | `status: ok`, backend Firebase                                                                                    |
| Hosting static index                                           | HTTP 200                                                                                                          |
| Hosting API anonymous request                                  | HTTP 401, as expected                                                                                             |
| Hosting Calendar callback cookie                               | Forwarded and single-use state consumed; missing real OAuth config correctly returns 503 before a Google exchange |
| Local delayed-job reconciliation                               | Processed after retry eligibility, not before                                                                     |

These counts are separate suites; the 37 portable tests are not additional to the 64 legacy/regression tests. The integration suite uses real demo emulators, with mocked Google Calendar transport. Browser E2E uses Firebase SDK's supported emulator Google credential, not a production-auth backdoor. No production Firestore test was run.

Initial failures were investigated and corrected: precise-time loss/invalid duration acceptance, async Express error propagation, a migration transaction lock timeout (replaced by atomic create-only batches), a background-job test racing the actual trigger, and local proxy handling for both regular and streaming requests. Early failed runs are not counted as passing.

The final gRPC 1.14.7 override updates the Firebase web SDK's old Node transport within its 1.x API line, addresses the published certificate-context advisory and preserves the current Firebase SDK. The Firebase emulator suite was rerun after the change. No package checksums, TLS checks or security assertions were disabled. A Vite bundle-size advisory remains; it is a warning, not a build failure.

## Files and decisions

The main implementation files are `functions/src/{store,domain,http,calendar,jobs,index}.ts`, `apps/web/src/{firebase,api,main}.tsx/ts`, the shared scheduler, `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, workspace/Functions package and build configuration, emulator/reconciliation/migration scripts, Firebase integration and browser tests, and CI workflows. Existing API/SQL sources remain intact.

See FIREBASE_MIGRATION_PLAN.md for the audit, FIREBASE_ARCHITECTURE.md for collections/transaction/job boundaries, FIREBASE_SETUP.md for all commands/configuration and IMPLEMENTATION_PROGRESS.md for acceptance status. Historical PostgreSQL documentation is labeled and retained.

Core emulator downloads were recovered through the official Google Cloud SDK 580.0.0 distribution of Firestore emulator 1.22.0, verified using Google's manifest SHA-256. A thin launcher references the unmodified verified JAR and its documented main class. Startup verifies cached dependency hashes. The local-only CLI proxy wrapper preserves external proxy/TLS behavior and routes HTTP loopback calls directly; it prevents loopback redirects from escaping through that direct path.

## Remaining external checks and limits

- `storage.googleapis.com` remains blocked in this cloud, so the optional Emulator UI download on port 4000 was not verified. The committed config retains it; headless mode works through the verified fallback.
- `apis.google.com` is blocked here, so the browser Google popup could not complete in this cloud. The SDK credential/ID-token path and real demo Auth verification passed; real Google login remains a separate acceptance check.
- Real Calendar client ID/secret, a stable encryption key, a consenting test account and public HTTPS/webhook configuration are required for live Google verification. They were not invented or committed. Live Calendar grants, quotas, watch delivery and Google-side behavior remain unverified.
- Firebase Hosting/Functions deployment, production rules/index rollout, real public web config, Cloud Scheduler/TTL operation, service-account permissions, native Safari/Android and production capacity are not claimed as verified.
- The scheduler currently reads an owner's schedule collection; very large histories/active collections need capacity work. Calendar availability initially uses the primary calendar. Corrections are limited to the latest review. Initial placement can be adjusted after asynchronous external availability reconciliation. A lost response after remote calendar creation can still leave an orphan calendar.
- The Cloud environment draft-edit tools were unavailable during this migration. Reusable scripts/instructions are committed in the repository; no new platform draft publication or fresh-task restoration is claimed.

No cloud function deployment or production database mutation has been performed. Production migration is not supported by the demo importer and requires a separately approved cutover.

## Run now / prepare for deployment

From the repository root in this cloud:

```sh
npm ci
npm run emulators:prepare
npm run dev:headless
```

On a machine with normal Firebase CDN access, `npm ci` then `npm run dev` starts the UI as well. Use Vite port 5174 for development; configure a matching APP_ORIGIN when testing a Hosting build instead.

Deployment preparation and exact environment-variable/redirect/secret instructions are in FIREBASE_SETUP.md. Use the existing project, verify Google provider/domains, set the real **public** Firebase web config at build time, put offline Calendar secrets in Secret Manager, run all suites, and stage the rollout. Deployment itself requires explicit approval and an explicit project ID.
