# Blind Spot Interval performance and release report

The consolidated branch is `performance-optimization-v1`. It starts at `3815c1f` from `origin/main`. The UX redesign at `b1ad478` merged as `ca3c504`. Connect at `d1bc367` was already on origin and merged as `c5be603`, the comparison baseline. The Connect merge reconciled the settings layout, Calendar availability and guarded topic and review mutations. The legacy backend branch was inspected at `6aed555`.

## Results

The Firebase dashboard now uses one request. At 500 topics and 10,000 historical reviews, it used 12 Firestore document reads and two aggregation queries, down from 76,040 document reads and nine requests. The fixture has three future previews and zero due-today sessions. At 500 topics, an unchanged connected fallback worker made two Google Calendar calls, down from 503. A scheduler tick with no due accounts made zero Calendar calls.

| Workload, 500 topics and 10,000 reviews                | Document reads before → after | Document writes before → after | Google Calendar calls before → after | Elapsed ms before → after | Response bytes before → after |
| ------------------------------------------------------ | ----------------------------: | -----------------------------: | -----------------------------------: | ------------------------: | ----------------------------: |
| Dashboard open                                         |    76,040 → 12 + 2 aggregates |                          9 → 1 |                                0 → 0 |               7,615 → 804 |               407,856 → 1,093 |
| First 30 topics                                        |     11,004 → 64 + 1 aggregate |                          1 → 1 |                                0 → 0 |                1,120 → 88 |               16,083 → 14,291 |
| Create a topic                                         |                  10,513 → 512 |                          7 → 6 |                                0 → 0 |               1,271 → 736 |                 1,164 → 1,164 |
| Two concurrent requests for one completion             |                  21,029 → 518 |                         10 → 9 |                                0 → 0 |             4,851 → 2,738 |                 1,819 → 1,819 |
| Correct the latest rating                              |                  10,513 → 510 |                         10 → 9 |                                0 → 0 |               863 → 1,036 |                     339 → 339 |
| Retrieve topic history                                 |                   10,009 → 23 |                          1 → 1 |                                0 → 0 |                 320 → 134 |                 2,753 → 2,753 |
| MCP statistics handler                                 |                     768 → 768 |                          0 → 0 |                                0 → 0 |                 103 → 293 |                 1,263 → 1,263 |
| Reschedule a review                                    |                  10,513 → 508 |                          4 → 4 |                                0 → 0 |                 374 → 329 |                       11 → 11 |
| Scheduler tick, connected account with no new activity |                    34,536 → 3 |                        508 → 0 |                              503 → 0 |               30,269 → 37 |                             — |
| Connected fallback job, no Calendar changes            |                   34,532 → 14 |                        507 → 5 |                              503 → 2 |              27,139 → 233 |                             — |

The 10-topic dashboard used 363 → 12 document reads and the 100-topic dashboard used 3,424 → 12. Both optimized dashboards made two aggregation queries. At those sizes, unchanged Calendar fallback calls fell from 13 → 2 and 103 → 2. The two concurrent completion requests produced one review and one successor in all three fixtures.

The largest Vite chunk fell from 663.11 kB minified to 375.71 kB. The initial JavaScript graph went from 205.01 to 176.22 kB gzip, including the optimized shared UI preload. The Vite 500 kB warning cleared. Forms, Calendar, Topics and Connect are loaded on demand. This comparison uses the Firebase client configuration with demo credentials. Fonts, CSS and resources fetched after navigation are outside the JavaScript figures.

The benchmark records Node process RSS and CPU as well as elapsed time, response bytes, operation counts and triggered entry points. For the largest fixture, peak Node RSS through the measured fallback job was 629 → 494 MiB, including fixture setup and the SDK. Dashboard process CPU was 2,013 → 17 ms. The emulator JVM runs separately. Cloud Functions billable time, peak memory, quotas, latency percentiles and index-entry reads require staging telemetry. The single-run timings show slower rating correction and statistics at the largest fixture, despite substantially fewer reads for correction.

### Reproduce

The [raw benchmark results](performance-benchmarks.json) contain each case. Use Node 24 and Java 21. The runner starts isolated Auth and Firestore demo emulators on loopback. Calendar transport is deterministic and synthetic. No real credentials, Google Calendar calls or production data are needed.

```sh
npm ci
node scripts/benchmark-firebase.mjs
node scripts/estimate-performance-cost.mjs
node scripts/estimate-performance-cost.mjs --json
```

For the baseline, copy `scripts/benchmark-firebase.mjs`, `scripts/benchmark-firebase.ts`, `scripts/benchmark-safety.ts` and the current `tests/firebase/connect-fixtures.ts` into a checkout of `c5be603`. Run `npm ci` and `node scripts/benchmark-firebase.mjs --baseline` in that checkout.

The fixtures pair 10, 100 and 500 active topics with 100, 1,000 and 10,000 historical reviews. All historical rows are synthetic. The dashboard scenario excludes first sign-in and includes the consolidated baseline's eager 100-topic batches. The history row measures the compatible array endpoint. Analytics calls the stats handler directly, while Connect protocol and authorization run in separate integration tests. The fallback worker is forced due for its own measurement. The idle scheduler is invoked separately. The two worker types are measured by direct function entry, so Firestore event deliveries are modeled separately in the cost worksheet. The read counter records document results, missing document lookups and a minimum for empty queries. Aggregate and index-entry billing have separate rules. Emulator latency and CPU are illustrative, and other local tests were running during parts of the comparison.

## Implementation and audit

- **Calendar.** Validated Google notifications enqueue inbound work by account and connection generation. Per-channel message numbers deduplicate replays. A pending job can absorb additional notifications, while a notification arriving during a running sync gets a successor. Outbound jobs coalesce pending schedule IDs, keep the same ID for all corresponding MCP receipts and skip disconnected accounts. The worker reads the named records and compares a hash of the published event before fetching it again. The full repair path reads pending schedules and live mappings. Incremental cursors, 410 recovery, renewable watch channels, early watch notifications, lease fencing, ETags, stable event IDs and bounded repeated-deletion recreation remain covered. Refresh and connection changes are generation-checked. Google backoff honors Retry-After. Both review completion and external Calendar changes keep the scheduling and topic order fields consistent. A review that regains a slot gets a new event ID when Google retained the earlier deletion.
- **Recovery policy.** The scheduler selects up to 250 due connections per one-minute tick and recovers up to 100 pending retries and 100 stale leases. Healthy watches use a jittered fallback around one hour. Accounts without a working watch use an approximately five-minute fallback. Upcoming work from the app also checks primary free/busy. The existing primary free/busy permission supports periodic checks, while the wake-up webhook watches the app-created calendar. Missed notifications and primary-calendar-only edits may therefore take longer to detect with a healthy watch. `CALENDAR_WATCH_FALLBACK_MINUTES` accepts 5–60 and should be tuned against staging delivery and recovery measurements. The emulator established the per-run cost reduction. Live delivery percentiles were unavailable.
- **Firestore.** Pending queries and targeted batch reads replace scans over historical schedules. Topic date and effective importance use indexed cursors after backfill. Status and tags filter on the server. Arbitrary case-insensitive substring search and locale-aware title order use a projected status/tag query and preserve exact matching and sort behavior. These modes still read the candidate topic documents. Topic history is ordered and paged by topic, and daily completion uses a bounded timezone-aware count. Topic metadata and rating corrections update inside the same owner transaction that protects scheduling. Existing users can serve the query fallback during migration. The index file adds the due-connection, schedule, review history and topic order indexes. Index exemptions cover non-queryable data such as material arrays, encoded Calendar credentials, FSRS state and temporary job arrays. Existing TTL policies cover terminal jobs, rate limits and OAuth/confirmation records.
- **Authentication.** Firebase verifies ID token signatures, account revocation and the Google provider before account-scoped access. An existing unchanged profile uses a direct read. Initialization and profile changes use a transaction. The web client can retrieve preferences in the profile response and persist initial timezone and language in one write. The distributed per-minute rate limit remains transactional. Firebase Auth checks and Connect grant checks still run per relevant request.
- **MCP and analytics.** Audited topic listing/detail, due reviews, first-review preview, cross-topic and per-topic history, learning statistics, weak topics, learning profile and the three confirmed mutations. The official SDKs exercise both the current stateless transport and the v1 client. Topic/history retrieval builds only permitted fields and skips material reads for topic history. Fresh verified ratings are materialized beside memory state in the same completion or correction transaction, with a source-history lookup for old records. Statistics use bounded history projections and disclose sample coverage. Scan bounds, timezones, archived topics, duplicate completion, source ratings and corrections retain their existing semantics. The high-volume analytics handler still reads up to its existing 200-document sample per collection and may join older topics. No new historical summaries are precomputed. The v1 MCP SDK is still used for OAuth routing and errors, the v2 server/Node packages for transport, and the v2 client for tests. Connect and its writes default to disabled.
- **Web.** TanStack Query keys contain the account ID and are cleared on sign-out or account change. Topics fetch 30 results per request. Topic details request review history in pages of 25. Opening Calendar fetches pending reviews separately. Mutations invalidate the affected resources, query requests deduplicate, and focus or the Refresh workspace control picks up changes made through a connected client. English and Russian screens retain the redesign and Connect support. Legacy web entry points retain their existing server paths.
- **Legacy and deployment.** Legacy PostgreSQL, Fastify and worker code remain available. Source changes are in `functions/src`, `apps/web`, and two shared client-safe modules. Release configuration is in `firebase.json`, `firestore.indexes.json`, `functions/.env.example`, and `.github/workflows/firebase-release.yaml`. The scripts directory contains the benchmark, cost model and repeatable migration. Both the Hosting build-info file and Functions health endpoint include the build commit. Use `git diff --name-status c5be603..HEAD` for the optimization file list and `git diff --name-status 3815c1f..HEAD` for the consolidated release list.

## Monthly cost model

Pricing was checked on November 25, 2026. Firestore is configured for `eur3`, at $0.06 per 100,000 reads, $0.18 per 100,000 writes, $0.02 per 100,000 deletes and $0.18 per GiB-month. Request-based Functions in Belgium use $0.000024 per vCPU-second, $0.0000025 per GiB-second and $0.40 per million requests. Hosting transfer is $0.15 per GB above the included allowance. The worksheet accounts for API egress, job delivery, Logging, storage, priced TTL deletes and shared fixed allowances. Ordinary Firebase social sign-in is included. If Identity Platform is enabled, add $275 at 100,000 signed-in MAU or $4,415 at 1,000,000 for the modeled social sign-in tier. Inactive accounts have no sign-in charge. [Firestore pricing](https://cloud.google.com/firestore/pricing) · [Cloud Run pricing](https://cloud.google.com/run/pricing) · [Firebase Hosting pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing) · [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing) · [Cloud Logging pricing](https://cloud.google.com/products/observability/pricing) · [Eventarc pricing](https://cloud.google.com/eventarc/pricing) · [Network tiers](https://cloud.google.com/network-tiers/pricing)

The model assumes 30 evenly distributed days, idle scale-to-zero, one scheduler job, 1 GiB of retained build images, two active secret versions and use of otherwise unclaimed free allowances. Fixed cost is approximately $0.32 gross or $0.05 with those allowances. Each API request is budgeted 0.30 billable seconds and each Calendar worker 0.40 seconds, at one vCPU and 512 MiB without concurrency savings. One KiB of logs per invocation is a planning allowance. Backup, PITR, unusually large materials, retry storms and unusual egress destinations can raise costs. Billing data and Google project quota overrides were outside this analysis. [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing) · [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing) · [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)

| Monthly use per account                        |  Inactive |    Light |    Normal |        Heavy |
| ---------------------------------------------- | --------: | -------: | --------: | -----------: |
| Topic/history fixture                          | 100/1,000 |   10/100 | 100/1,000 |   500/10,000 |
| Dashboard visits                               |         0 |        8 |        25 |           90 |
| Topic pages and history requests               |         0 |        5 |        14 |           62 |
| Create, complete, correct, reschedule          |         0 |  2/8/1/1 |  4/28/3/2 | 30/120/12/12 |
| MCP statistics equivalent                      |         0 |        0 |        12 |           60 |
| Calendar connected, healthy share of connected |  25%, 95% | 10%, 95% |  25%, 95% |     60%, 90% |
| Hosting transfer GiB                           |         0 |    0.006 |     0.018 |        0.065 |

The operation budget uses the measured reads and writes. It adds estimates for OAuth, token verification, distributed limits, Google webhook traffic, changed-event jobs and calendar-view requests. It budgets 780 monthly fallback jobs for watched connections and 8,640 for unwatched connections, with pending reviews in both cases. Inactive means no app visits or sign-ins, with Calendar grants and historical data retained. Calendar was historically the primary cost driver. For example, the 1,000-normal-account baseline extrapolates to roughly $5,654/month on cloud infrastructure alone and about 7.4 million Calendar calls per day. That is a demand estimate. Project quotas and runtime capacity can prevent the workload from being served.

| Population | Inactive USD/mo | Light USD/mo | Normal USD/mo | Heavy USD/mo | Normal USD/MAU | Normal Calendar calls/day |
| ---------: | --------------: | -----------: | ------------: | -----------: | -------------: | ------------------------: |
|        100 |            0.06 |         0.07 |          0.27 |        11.43 |         0.0027 |                     2,109 |
|      1,000 |            5.26 |         1.52 |         15.13 |       153.50 |         0.0151 |                    21,092 |
|     10,000 |           99.92 |        52.84 |        224.01 |     1,621.06 |         0.0224 |                   210,917 |
|    100,000 |        1,073.43 |       612.85 |      2,327.94 |    16,336.95 |         0.0233 |                 2,109,167 |
|  1,000,000 |       10,925.07 |     6,270.69 |     23,536.84 |   162,847.53 |         0.0235 |                21,091,667 |

Google's published Scaled Tier Calendar REST pricing begins April 1, 2027. It charges $0.25 per 1,000 successful requests after the shared one-million-per-day allowance and applies volume discounts. Standard usage remains free within its quotas. Blind Spot Connect supplies its own MCP transport and Calendar synchronization uses Calendar REST. [Calendar quotas](https://developers.google.com/workspace/calendar/api/guides/quotas) · [Calendar pricing and discounts](https://developers.google.com/workspace/guides/quota-pricing)

| Population | Inactive USD/mo with Scaled Tier |     Light |     Normal |      Heavy | Normal USD/MAU |
| ---------: | -------------------------------: | --------: | ---------: | ---------: | -------------: |
|        100 |                             0.06 |      0.07 |       0.27 |      11.43 |         0.0027 |
|      1,000 |                             5.26 |      1.52 |      15.13 |     153.50 |         0.0151 |
|     10,000 |                            99.92 |     52.84 |     224.01 |   1,621.06 |         0.0224 |
|    100,000 |                         8,235.93 |    612.85 |  10,646.69 |  63,007.95 |         0.1065 |
|  1,000,000 |                       102,562.57 | 53,025.69 | 118,643.09 | 518,527.53 |         0.1186 |

The normal-use current-price model meets $0.05 per MAU. Future Calendar charges push the 100,000 and 1,000,000 normal scenarios above both $0.05 and $0.10. Those scenarios also exceed the current scheduler's theoretical 250-due-connections-per-minute dispatch cap at the modeled connected share. Project quota approval, a higher-throughput dispatch design and live budgeting are needed before accepting either capacity claim.

## Test and security results

| Verification                                                | Result                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Lint, typecheck and Firebase production-mode build          | Passed                                                                                     |
| Unit suite                                                  | 54 passed                                                                                  |
| Legacy PostgreSQL and API suite                             | 82 passed                                                                                  |
| Legacy Chromium desktop and mobile suite                    | 4 passed after reducing duplicate reads                                                    |
| Firebase emulator integration                               | 42 passed with Connect disabled                                                            |
| Firebase Chromium desktop and mobile suite                  | 28 passed with Connect disabled                                                            |
| Enabled Connect integration with official MCP Inspector     | 9 passed                                                                                   |
| Enabled Connect browser consent and revocation              | 2 passed                                                                                   |
| Final focused Calendar integration                          | 16 passed                                                                                  |
| Repeated Firebase onboarding and session restore            | 6 passed, three desktop and three mobile                                                   |
| Synthetic migration dry-run, apply, repeat and repair       | Passed                                                                                     |
| GitHub workflow validation and production dependency audits | Passed. npm reported zero advisories in the root and standalone Functions production locks |

Default-off runs intentionally skip the enabled-only Connect cases, which pass in the separate Connect run. The suites cover Firebase Google-provider validation and account revocation, account isolation, scheduling conflicts, FSRS, correction and recovery, guarded MCP mutations, scopes, PKCE, refresh rotation and replay, grant revocation, Calendar moves and deletions, locks, retries, localization and responsive layouts. Calendar protocol tests use synthetic transport. Playwright uses Chromium on desktop and for mobile emulation.

The previously reported Firebase onboarding timeout did not reproduce on the merged baseline or in six targeted optimized runs. Baseline traces showed several seconds of emulator work and lock waits during concurrent startup requests. Bundled preferences and a single onboarding save remove two startup round trips for new users. The earlier failure's precise trigger remains unverified. A separate legacy mobile timeout was traced to HTTP 429 from the shared local Fastify IP budget. Reusing pending reviews, preferences and Calendar status stopped redundant legacy requests and the complete legacy browser suite passed with the same server rate limit.

## Monitoring and staging acceptance

1. Use the Cloud Run service request count, latency, CPU and memory metrics for `api`, `syncJob` and `reconcileCalendar`. Compare p50, p95 and p99 by revision. The application samples 1% of API and MCP requests, recording only surface, status and elapsed time. Use 401/403 and 429 cohorts to track authentication and abuse controls. Compare Firestore read and write counts in Cloud Monitoring with query execution counts.
2. In the Calendar API quota dashboard, track request rate, quota utilization, 429/5xx responses and watch renewal. Use the safe exhausted-retry logs and periodic indexed counts for pending and stale jobs. Track age of the oldest eligible job and due connection as well as backlog size. Compare normal webhook delivery latency with intentionally dropped notifications. Alert if due age exceeds two scheduler ticks for a sustained window or exceeds the selected recovery objective.
3. Inspect Hosting, proxy and Cloud Run automatic request logs in staging. Query strings can contain topic search text or OAuth callback parameters. Exclude raw URL-bearing request logs from retained and exported application datasets ahead of real traffic. Keep the redacted application samples, native request counters and required audit logs. Verify that token headers, content, material text and event descriptions appear nowhere in application log payloads.
4. Compute monthly infrastructure cost divided by signed-in MAU from the existing billing export or SKU-level reports. Track connected inactive accounts and Calendar traffic independently. Compare 1-, 7- and 30-day windows and confirm observed throughput and spend against the workload assumptions.
5. Verify a consenting real Google sign-in, Calendar consent, delivery on public HTTPS, time changes, cancellations, dropped notifications, watch renewal, expired cursor, retry after throttling, disconnect/reconnect during a job and subsequent scheduling. Check a real iOS browser and a desktop browser in English and Russian. Run live AI-client acceptance independently with the selected provider. Browser emulation and SDK tests establish the local behavior. No live Google Calendar account or consumer AI provider was exercised here.

## Migration and release checklist

Use an explicit staging project throughout rehearsal. The following commands target only a configured staging project.

```sh
npm ci
npm run lint
npm run build
npx firebase deploy --project "$STAGING_PROJECT" --only firestore:indexes
node --import tsx scripts/backfill-performance.ts --project="$STAGING_PROJECT" --only=calendars
node --import tsx scripts/backfill-performance.ts --project="$STAGING_PROJECT" --only=calendars --apply
npx firebase deploy --project "$STAGING_PROJECT" --only "functions:api,functions:syncJob,functions:reconcileCalendar,hosting"
node --import tsx scripts/backfill-performance.ts --project="$STAGING_PROJECT" --only=topics
node --import tsx scripts/backfill-performance.ts --project="$STAGING_PROJECT" --only=topics --apply
```

- Set the staging app origin, public Firebase web parameters and webhook origin. Verify allowed Google redirect URIs, Calendar scopes, Firebase Google provider, existing Secret Manager bindings and the selected project. Keep both Connect flags disabled for the first release smoke test. Use explicit staging-only client IDs and redirect allowlists when exercising Connect.
- Wait for new indexes to become ready. Run the calendar backfill before switching schedulers. It fills missing due timestamps on connected documents, with a five-minute spread. It is additive and repeatable. Topic sort metadata backfill runs after the new writers are deployed. It reads each current schedule transactionally and marks each account when complete. Accounts without the marker use the compatible projected query. Check dry-run counts again and verify sampled records. The material, memory, legacy schedule and review history collections are preserved.
- Check the deployed SHA in `/build-info.json` and the Functions `/health` endpoint. Review real Auth, Calendar and browser acceptance, the Firestore index and TTL policies, scheduler queue age and costs before expanding the cohort. Use `CALENDAR_WATCH_FALLBACK_MINUTES` to test the recovery and cost trade-off while preserving an active watch.
- After separate approval and a staged commit, the manual GitHub workflow accepts the exact approved `main` SHA. Configure the GitHub `production` environment with required reviewers, the Firebase project and public web configuration, and Workload Identity Federation variables. The release workflow deploys application code. Index deployment and backfill are explicit runbook steps. Use a production deployment identity scoped to the existing target project.
- **Rollback.** Redeploy the previously verified Hosting build and Functions revision as a pair to restore their API contract. Keep the additive Firestore fields, indexes and existing data. Restoring the older scheduler resumes its former polling behavior. New jobs already committed in staging can drain before a planned rollback. If rolling forward after old writers have run, set `TOPIC_INDEX_ENABLED=false`, deploy the optimized writers, run the topics backfill with `--repair --apply` and validate the ordering before enabling indexed reads. Recheck Calendar due timestamps, watch state, generation and stuck jobs before restoring traffic. Reserve Hosting or Functions recovery actions and configuration changes for the approved target project.
