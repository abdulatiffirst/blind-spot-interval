# Blind Spot Connect — MCP MVP

## Goal

Expose existing Interval domain operations to authorized external AI clients without paying for model inference. Keep Firebase-only architecture and Google sign-in. Do not merge or deploy until tested.

## Architecture

Use official TypeScript MCP SDK and stateless Streamable HTTP in the existing Express Firebase Functions API (proposed /api/mcp). Verify current SDK documentation and supported MCP authorization specification before implementation. Preserve current /api/v1 authentication and Calendar OAuth flows. Do not forward AI-provider tokens or expose Firebase credentials to clients.

## Tools

- list_topics: bounded pagination/filtering via domain.listTopics
- get_topic: domain.details
- get_due_reviews: domain.reviews
- preview_review: domain.preview
- create_topic: domain.createTopic, existing validation and idempotency
- complete_review: domain.complete, explicit user-confirmed rating 1–5
- reschedule_review: domain.reschedule, explicit time with offset and conflict handling

Read actual domain schemas before implementing. Return minimal structured results; never return Google Calendar credentials, internal account metadata, or secrets. Treat notes as untrusted data. Add read-only tools first; enable writes only after authorization and confirmation tests.

## Authorization

Implement standards-compliant remote MCP OAuth with protected resource discovery, authorization server metadata, authorization code + PKCE, exact registered redirect URIs, short-lived audience-bound access tokens, revocable grants and scope enforcement (topics:read, topics:write, reviews:read, reviews:write). Authenticate account owner using existing Google/Firebase sign-in in a first-party consent flow. Do not confuse Google Calendar authorization with MCP authorization. Use a vetted OAuth implementation; fail closed if required configuration is absent. Determine registration mechanism per supported client and current specification. Derive UID only from verified grant, never tool input. Provide disconnect/revoke control. Do not enable public unauthenticated tools.

## Safety and cost

Validate every argument; bound results, requests and execution; reuse rate limiting and domain idempotency; redact sensitive logs; explicit first-party confirmation for mutations if client confirmation cannot be trusted. Keep feature disabled by default. Preserve production behavior and Firebase rules. No new paid AI provider APIs.

## Acceptance

Unit tests for schemas, tool mapping, invalid tokens, expired/revoked grants, wrong audience, scope restrictions, cross-user access and duplicate requests. Emulator integration tests for scheduling and Calendar sync behavior; no real Calendar writes in tests. Verify MCP initialize/list/call via official MCP Inspector. Run lint, typecheck, tests and build. Test each AI client independently; consumer app availability depends on platform, plan and region. Document configuration, rollback, deployment and any unverified compatibility. Do not deploy automatically.

## Review history and learning intelligence (required in MVP)

Expose five additional read-only MCP tools:

- get_review_history: cursor-paginated completed review records across the authenticated user's topics; optional topic ID, tag, date range and rating filters.
- get_topic_history: chronological history for one owned topic, including completion timestamps and recorded ratings; include archived topics where permitted.
- get_learning_stats: deterministic aggregate counts, rating distributions, trends and completion statistics over a requested bounded period; document denominators and timezone.
- get_weak_topics: rank topics by recent low recorded ratings and repeated difficulty, expose sample size and criteria; do not treat missing reviews as low ratings.
- get_learning_profile: bounded summary of learning progress, due reviews, strengths and weak topics, with explicit data coverage and no speculative knowledge claims.

Inspect existing reviewHistory schema and correction semantics; report only persisted facts and avoid counting corrected reviews twice. Use server-side bounded queries and indexes as needed, not unrestricted scans. Require an explicit reviews:history:read scope distinct from upcoming review access; enforce authenticated UID on all queries and topic lookups. Return only educational data necessary for the requested analysis, never account credentials or unrelated calendar events. No additional AI inference needed. History stays read-only; no MCP tool may rewrite past results except separately authorized existing review workflows. Test filters, pagination, archived topics, empty history, corrections, timezone boundaries, revoked access and cross-user isolation. Update consent UI and English/Russian descriptions. Make all five tools part of MVP acceptance.

## Implementation and operations

The Firebase v2 `api` function in `europe-west1` supplies a stateless Streamable HTTP endpoint at `/api/mcp`. The current TypeScript MCP SDK handles the 2026-07-28 protocol using JSON responses and its stateless compatibility path for 2025-era clients. The SDK v1 OAuth middleware handles OAuth discovery and endpoint protocol. Firebase Hosting forwards the OAuth routes and serves the first-party React consent and confirmation screens. A browser completes authorization using the existing Google Sign-In and Firebase Auth account. No model provider API is involved.

### Repository audit

- The production stack uses Firebase Auth, Express on Cloud Functions and owner-scoped Firestore subcollections. The repository also contains a legacy PostgreSQL/Fastify stack and its regression tests.
- `topics`, `topicMaterials`, `memoryStates`, `reviewSchedules` and `reviewHistory` live under `users/{uid}`. Text and links both use ordered materials. Connect stores submitted notes as the first material. Tags are the only available subject taxonomy.
- The domain uses FSRS-7 through the existing memory engine. It serializes scheduling transactions on the user revision, retains nullable ratings and uses existing preferences, placement and recovery behavior.
- Review completion writes one canonical `reviewHistory/{scheduleId}` document. Correction updates that document and audits the previous rating in `reviewCorrections`, without incrementing the review count. The history tool joins the completed schedule for the scheduled timestamp and planned duration. There is no measured review duration or reliable complete scheduling denominator.
- Calendar authorization, primary-calendar free/busy and event synchronization already use a separate Google OAuth grant, encrypted credentials and durable `syncJobs`. Connect queues the same jobs and reads the job and mapping state for receipts. The Calendar API and its credentials stay on the server.
- The existing web application had English strings in its source and no shared locale switch. The new Connect screens use the existing components and styles and provide their own English/Russian selector with a saved browser preference.

### OAuth and security

`GET /.well-known/oauth-protected-resource/api/mcp` advertises the resource and issuer. `GET /.well-known/oauth-authorization-server` advertises `/authorize`, `/token`, `/revoke`, and optionally `/register`. A missing or invalid access token produces an HTTP 401 Bearer challenge with `resource_metadata`. A tool call missing a scope receives a 403 OAuth step-up challenge. The stateless endpoint supports POST and returns HTTP 405 for the optional server-streaming GET and session DELETE methods. Clients must send the headers for their negotiated protocol version. The SDK compatibility path may return a request-scoped SSE response. CORS accepts the configured first-party origin. Server-to-server clients can omit the Origin header.

Public clients use authorization code, S256 PKCE and explicit state. The first-party approval is bound to an HTTP-only `__session` browser cookie and a one-use handle. Starting a new consent flow in the same browser replaces its pending browser cookie. The user approves a subset of requested scopes. Write and history permissions require selection. The code is one-use and expires after two minutes. Redirect URIs are matched exactly at authorization and exchange, including for explicitly provisioned native loopback callbacks with fixed ports. Authorization requests with a different resource are rejected. Where the resource parameter is absent, the grant is restricted to this server’s sole audience.

Tokens are randomly generated 256-bit opaque credentials. Firestore stores their digests and server-side metadata. Access tokens expire after ten minutes. Each refresh token expires after 30 days or with the grant, whichever comes first. Refresh rotates the token, and reuse revokes the current grant. Grants last at most 90 days and can be replaced by reauthorization. Disconnecting an app or all apps invalidates its grants and subsequent requests, including requests with existing access tokens. Requests from deleted or disabled Firebase accounts are rejected. OAuth token revocation invalidates the matching grant. Account settings stay available for disconnecting apps when the feature is disabled. Invalid Connect configuration disables the feature and leaves the existing application available. Rate limits are 60 requests/minute per account and 30/minute per application within an account, plus shared endpoint budgets for public OAuth routes. The MCP request limit is 128 KB. Audit events contain action type, hashed account identifier and app identifier. Application access does not end Google Calendar access or remove anything previously sent to an AI provider.

Every data access uses the UID from a verified grant. Connection permissions and model-provided values cannot approve a change. A write tool produces a link to Blind Spot, where the signed-in owner sees the proposed values and any scheduling warnings. Approval and the domain mutation commit in the same Firestore transaction. Rescheduling checks Google primary Calendar availability when connected, checks it again on approval, and recomputes internal conflicts and study preferences in the transaction. If warnings or relevant review details change, the user requests a new confirmation. A Calendar change after the availability check remains possible. The confirmation is valid for ten minutes. Clients use the same idempotency key and identical arguments to check the result. Completed or cancelled receipts are kept for seven days. The creation key also identifies the topic deterministically, and the review history document prevents two completions of the same review. Cancelled actions require a new proposal before a user can reconsider them.

There are no new secrets. The existing Firebase Auth and Calendar credentials remain governed by the Firebase setup. Production should use an HTTPS origin and a separately reviewed exact redirect allowlist. This revision supports pre-provisioned public clients and allowlisted Dynamic Client Registration. Client ID Metadata Documents, optional authorization-response issuer signaling, confidential clients and browser-origin third-party clients are outside this revision. Dynamic registration names are self-reported, so consent shows the registered callback domain. Shared anonymous endpoint limits may throttle legitimate users under sustained traffic. Firestore TTL deletes asynchronously, and application-level expiration applies immediately. Confirmations contain user-proposed data until TTL cleanup. Use regular IAM and log-access controls for the Firebase project. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) · [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) · [TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)

### Tool reference

| Tool                   | Required scopes                       | Inputs and result                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_topic`         | `topics:write`                        | Title, optional tags, initial knowledge and importance (1–5), duration, notes/materials, and idempotency key. After approval returns topic ID, original first placement, any changed current placement, and the Calendar job/mapping state. |
| `list_topics`          | `topics:read`                         | Active, archived or all, substring title search, all requested tags, optional initial knowledge, sort by creation, title or importance.                                                                                                     |
| `get_topic`            | `topics:read`                         | Topic ID. Returns educational fields and ordered materials. With `reviews:read` returns the next review. With `reviews:history:read` returns recorded rating, completion count and last completion.                                         |
| `get_due_reviews`      | `reviews:read`                        | Today, tomorrow, upcoming, overdue or inclusive date range. Supports tag/subject and returns scheduled pending reviews with title, time, duration and status. Last recorded rating requires `reviews:history:read`.                         |
| `complete_review`      | `reviews:write`                       | Review ID, user-supplied rating (1–5) and idempotency key. After approval returns the recorded review and next FSRS review.                                                                                                                 |
| `reschedule_review`    | `reviews:write`                       | Review ID, ISO 8601 datetime with UTC offset or `Z`, and idempotency key. Proposes a manual placement and presents any warnings before approval.                                                                                            |
| `preview_review`       | `reviews:read`                        | Optional initial knowledge, importance and duration. Returns ideal and proposed times, duration and scheduling warning using the existing first-review algorithm.                                                                           |
| `get_review_history`   | `topics:read`, `reviews:history:read` | Topic ID, tag/subject, active/archived status, inclusive dates, ratings 1–5 and completion sort. Returns one row per review with persisted timing and correction information when available.                                                |
| `get_topic_history`    | `topics:read`, `reviews:history:read` | Owned topic ID and sort. Returns paged ratings and timestamps, initial/latest rating and total review count. Upcoming placement requires `reviews:read`.                                                                                    |
| `get_learning_stats`   | All three read scopes                 | Bounded period, topic, tag/subject, and day/week/month grouping. Reports coverage, counts, rating distribution and change, and elapsed-day review consistency.                                                                              |
| `get_weak_topics`      | All three read scopes                 | Bounded period, topic, tag/subject and limit. Returns active topics ranked by separate knowledge and scheduling evidence.                                                                                                                   |
| `get_learning_profile` | All three read scopes                 | Last 30 calendar days of recent activity, strengths, priorities, upcoming reviews, active tags, study preferences and coverage.                                                                                                             |

Tool pages allow 1–50 records. Continue with `nextCursor` and identical filters until the cursor is null. Post-query filters can produce an empty page with a continuation. History cursors use timestamp and document ID as a tie-breaker. Tag/subject filters use the topic’s current tags. Calendar days and week/month buckets use the account timezone, with weeks starting Monday. Today's window means the current local calendar day, while overdue means a pending timed placement before the current instant. Upcoming and overdue counts reflect the current schedule. Unscheduled reviews are excluded from date windows. A scheduler preview or write requiring more than 1,000 active pending candidates stops without applying a change.

Analytics defaults to the last 30 local calendar days and accepts at most 366 days. It scans at most 200 records in each source query, with one additional row to detect truncation. Counts requiring complete coverage are null when their source is truncated. Sample metrics are labeled as such. In the sample, average rating is over rated completions, distribution buckets are ratings 1–5, and average improvement is the mean of newest minus oldest recorded rating in the period for topics with at least two observations. Consistency is the number of distinct local days with a completion divided by elapsed local calendar days in the requested period, including today. Historical completion rate is unavailable. Weak-topic ranking uses documented low/declining rating and overdue/inactivity weights. Unreviewed topics may surface for overdue scheduling only. Ratings are self-assessments.

### Backend records and indexes

| Collection          | Purpose and retention                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcpAccounts/{uid}` | At most 25 active connections, each with an opaque grant ID, client ID, callback host, scope set and expiry. TTL removes the account record when its last grant has expired. |
| `mcpEphemeral`      | Digests of consent, code, access and refresh handles, with TTL. Consumed authorization codes and consent requests are deleted immediately.                                   |
| `mcpClients`        | Public dynamic registration metadata and 180-day TTL. Pre-provisioned clients are stored in Functions configuration.                                                         |
| `mcpActions`        | First-party confirmation arguments, previews and receipts with TTL, at most 15 minutes when pending and seven days once decided.                                             |
| `rateLimits`        | Existing TTL collection, with MCP endpoint, account and application counters.                                                                                                |

Existing Firestore Security Rules deny all client access to the new top-level collections. The Admin SDK enforces ownership in code. `firestore.indexes.json` includes history topic/completion indexes in both directions, status plus sortable topic fields, and pending schedules by topic and time. No learning-data migration or duplicate dataset is needed. Verify the indexes are ready before enabling the feature. The emulator does not enforce composite index requirements.

### Local installation and checks

Use Node 24 and Java 21. Firestore binaries are verified by the repository’s setup script. Chromium is needed for browser tests.

```sh
npm ci
npm run emulators:prepare
npm run lint
npm run typecheck
npm test
npm run test:firebase
npm run test:e2e
npm run test:connect
BLIND_SPOT_CONNECT_INSPECTOR=true npm run test:connect
npm run build
git diff --check
```

`npm run test:connect` builds the Firebase web app against emulator Auth and runs the SDK client against the MCP endpoint over the local Hosting rewrite. The OAuth integration tests create only demo credentials. Playwright exercises first-party consent, write approval and revocation with the hosted build on desktop and mobile. The optional Inspector flag runs real CLI discovery and a tool call using a demo grant. Existing Calendar tests use mocked transport for outbound Calendar operations.

For interactive testing, copy `functions/.env.example` to ignored `functions/.env.local` and set the following values. Use `npm run dev:headless` and open `http://localhost:5174`. Keep the origin and any callback strings identical to the values the client uses.

```dotenv
BLIND_SPOT_CONNECT_ENABLED=true
BLIND_SPOT_CONNECT_WRITES=true
BLIND_SPOT_CONNECT_ORIGIN=http://localhost:5174
BLIND_SPOT_CONNECT_CLIENTS=[]
BLIND_SPOT_CONNECT_REGISTRATION_REDIRECTS='["http://localhost:6274/oauth/callback"]'
```

Run `npx --yes @modelcontextprotocol/inspector@2.16.0 --web`. In the Inspector choose Streamable HTTP, enter `http://localhost:5174/api/mcp` and start the OAuth flow. Read the Inspector's displayed callback URI before adding it to the allowlist, since host, port and path depend on the Inspector configuration. For an already authorized demo token, CLI verification can use `npx --yes @modelcontextprotocol/inspector@2.16.0 --cli http://localhost:5174/api/mcp --transport http --method tools/list --header "Authorization: Bearer $CONNECT_DEMO_TOKEN"`. Never substitute a Firebase ID token or Calendar token.

### Client compatibility

Settings shows ChatGPT, Claude, Gemini and other compatible assistants. Setup is manual. The app shows steps and the server address for a platform when the deployment has a matching approved redirect in its public client configuration or registration allowlist. A configured redirect indicates server setup. Account eligibility and the provider's end-to-end connection still need verification. The URL is available in a platform's setup dialog and under Advanced connection settings.

| Platform                               | Documented setup                                                                                                               | Requirements                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT                                | On the web, create a custom server from Plugins, configure OAuth and follow the sign-in prompt. Older workspaces may use Apps. | Business and Enterprise/Edu workspaces control who can create and publish connections. Pro has read/fetch support. Use the exact callback generated by the plugin.  |
| Claude                                 | In Customize → Connectors, add a custom connector and choose an OAuth sign-in method.                                          | Team and Enterprise may require a workspace owner to add the connector. Use an approved public client or enable automatic registration for Claude's exact callback. |
| Gemini                                 | In Gemini Apps Developer Mode on the web, add and test a custom app.                                                           | The account needs Developer Mode. Approve the exact Google redirect for this setup. This flow covers developer testing.                                             |
| Other assistants, including Gemini CLI | Configure a remote Streamable HTTP server and authorize it in the assistant.                                                   | OAuth authorization code with S256 PKCE and an approved exact redirect. Match the public client's registration method to the assistant.                             |

Provider guidance was checked against current documentation on November 25, 2026. Blind Spot's published app status and live provider compatibility remain separate staging checks. Local verification covers the official TypeScript SDK and MCP Inspector over Firebase Hosting, including both supported protocol versions and all 12 tools in write-enabled mode. [ChatGPT custom server setup](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) · [ChatGPT OAuth callbacks](https://developers.openai.com/plugins/build/auth) · [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [Gemini Apps Developer Mode](https://developers.google.com/connected-apps/mcp/dev-mode/usage) · [Gemini OAuth](https://developers.google.com/connected-apps/mcp/oauth) · [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)

Settings uses the workspace language and theme. An existing grant shows its application, callback domain, connection date, effective access level and the exact granted permissions. A confirmation dialog lets users revoke an individual grant or all grants. When Connect is disabled, the panel is hidden for accounts with no grants. Users with existing grants can still see and revoke them. The standalone consent and confirmation pages provide the same language and theme controls as the workspace. The Firebase validation workflow collects Chromium desktop and mobile screenshots for both feature states. To capture those screens locally, set `CONNECT_UX_SCREENSHOTS=true` when running `npm run test:e2e` and `npm run test:connect`.

For an approved Gemini CLI evaluation, ask the server administrator to provision a public client with the exact callback below. Add this to the CLI's `settings.json`, start the CLI and run `/mcp auth blindSpot`. Request just the scopes the workflow requires. The CLI discovers the issuer and endpoint URLs from metadata.

```json
{
  "mcpServers": {
    "blindSpot": {
      "httpUrl": "https://blind-spot-interval.web.app/api/mcp",
      "oauth": {
        "enabled": true,
        "clientId": "approved-gemini-cli-client-id",
        "redirectUri": "http://localhost:6274/oauth/callback",
        "scopes": ["topics:read", "reviews:read"]
      }
    }
  }
}
```

### Cost model

Illustrative monthly incremental costs before free tiers, based on 120 MCP HTTP requests per active user, a mix of short topic/schedule pages and occasional bounded analytics averaging 20 document reads per request, two counter writes per request, plus 20 writes per user for OAuth, confirmations and TTL deletions. Assumes 0.25 billed seconds per request at 1 vCPU and 512 MiB with no concurrency savings, and 8 KiB per response. Firestore uses illustrative multi-region USD prices of $0.06 per 100k reads and $0.18 per 100k writes. The compute illustration uses $0.000024/vCPU-second and $0.0000025/GiB-second plus $0.40 per million requests. Network is illustrated at $0.15/GiB. Actual billing depends on the region, Cloud Run billing mode, index operations, cache, workload and free quotas. Calendar operations, Firestore storage, log retention and existing application traffic are incremental to these examples where billed.

| Active users | MCP requests |   Reads | Writes incl. cleanup estimate | vCPU-sec | Response GiB | Illustrative monthly cost |
| -----------: | -----------: | ------: | ----------------------------: | -------: | -----------: | ------------------------: |
|          100 |       12,000 | 240,000 |                        26,000 |    3,000 |         0.09 |                    ~$0.29 |
|        1,000 |      120,000 |    2.4M |                       260,000 |   30,000 |         0.92 |                    ~$2.85 |
|       10,000 |         1.2M |     24M |                          2.6M |  300,000 |         9.15 |                   ~$28.51 |

The API inherits the existing max of ten function instances and the default zero minimum. Firestore transactions and filtered page scans set the practical throughput and cost. Start limited read-only traffic first, measure reads per call and transaction contention, and review logs/alerts before lifting limits. Configure Google Cloud budget notifications at 50%, 90% and 100%, and add a forecast alert. Alerts notify operators and do not cap spending. [Firestore pricing](https://cloud.google.com/firestore/pricing) · [Cloud Run pricing](https://cloud.google.com/run/pricing) · [Firebase billing](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)

### Deployment and rollback

These commands are for an authorized operator after staging verification. The production app is `blind-spot-interval`. Use a separately provisioned Firebase project to test public HTTPS, documented Client OAuth callbacks, composite indexes, real Google pop-up identity and isolated Calendar sync before a public release. Auth's authorized domains must include the exact first-party deployment hostname. Choose and register each approved client's callback URI from official or observed configuration. Disable dynamic registration by leaving its allowlist empty. Consent, mutation pages and API must use the same origin. Confirm existing Google Calendar secrets and settings using [Firebase setup](FIREBASE_SETUP.md) and [Hosting rewrites](https://firebase.google.com/docs/hosting/functions).

1. Check out `blind-spot-connect` at the reviewed commit. Set production public web config in the existing Vite environment. Confirm `functions/.env.blind-spot-interval` has the existing app settings and both Connect flags set to `false`. Set `BLIND_SPOT_CONNECT_ORIGIN=https://blind-spot-interval.web.app` and approved public client settings.
2. Build and deploy rules/indexes first. Wait until all required indexes report ready. Then build and deploy the API and Hosting with Connect disabled.

```sh
npm ci
npm run build
npx firebase deploy --project blind-spot-interval --only firestore:rules,firestore:indexes
npx firebase deploy --project blind-spot-interval --only functions:api,hosting
```

3. After staging and authorization, set `BLIND_SPOT_CONNECT_ENABLED=true` while keeping `BLIND_SPOT_CONNECT_WRITES=false`. Rebuild Functions and deploy only the API using `npx firebase deploy --project blind-spot-interval --only functions:api`. Check protected metadata, the unauthenticated challenge and revocation from a dedicated test account. Enable writes separately after review.
4. For an incident or rollback, set both flags to `false` and redeploy only the API. Then verify the public MCP and OAuth routes return 404 and existing Firebase API routes still respond. For a full revert, rebuild the previous reviewed source revision in a separate worktree and run the same `functions:api,hosting` command. Keep additive Firestore indexes and data in place. Account settings can revoke grants while the feature is off. If exposure is suspected, revoke affected grants before re-enabling.

If discovery returns the SPA, verify the hosting rewrite precedes the SPA fallback. If authorization rejects a redirect, compare the entire registered URI and the client’s actual URI. If the browser reports expired consent, restart authorization in the same browser and allow first-party cookies. A tool scope error requires reauthorization with the named scopes. An expired confirmation requires a new idempotency key. Pending/retrying Calendar state means the internal review was committed and the existing Calendar worker still has work to complete. Investigate failures in the Firebase Calendar status and job logs.

### Verification results

| Check                                                                                       | Result                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript, repository and Functions ESLint, Prettier for changed files, and Git whitespace | Passed                                                                                                                                                                               |
| Firebase Functions bundle and Vite web build                                                | Passed. Vite reported its bundle-size advisory.                                                                                                                                      |
| Workspaces unit tests                                                                       | 50 passed                                                                                                                                                                            |
| Firebase emulator regression suite                                                          | 37 passed. Connect scenarios run through the separate enabled suite.                                                                                                                 |
| Connect Hosting, OAuth and MCP protocol                                                     | 9 passed. Includes the 2025 fallback, 2026 negotiation, and official Inspector 2.16.0 CLI discovery and execution.                                                                   |
| Connect browser workflow                                                                    | 2 passed in desktop and mobile Chromium profiles, including Russian settings and revocation.                                                                                         |
| Existing Firebase browser suite                                                             | 21 passed in the full run. The desktop onboarding assertion timed out while preferences were saving and passed on an isolated retry. The two Connect cases ran in the enabled suite. |
| Legacy database and browser regressions                                                     | 78 unit/integration cases and 4 browser cases passed using a disposable local PostgreSQL container.                                                                                  |
| Standalone Functions lockfile and production dependency audit                               | npm install dry run passed. npm audit reported zero production dependency vulnerabilities.                                                                                           |

Live verification remains open for HTTPS Hosting, deployed composite indexes, actual Google sign-in and Calendar, and each external AI platform. Use a separate staging Firebase project for those checks. Validate the read-only rollout first, then grant write scopes to a dedicated test user and walk through each first-party approval and revocation flow.
