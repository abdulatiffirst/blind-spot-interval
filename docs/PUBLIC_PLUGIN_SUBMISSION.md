# Blind Spot Interval public plugin preparation

The source package and review materials are prepared for a future public submission. Public policy hosting, authenticated provider checks, and review evidence are still pending.

## Publisher and package

- Product and version are Blind Spot Interval 1.0.0. The subtitle is “Your AI study companion.”
- Publisher is Abdulatif Abdunazirov, an individual. Support is available at abdulatifabdunazirov@gmail.com.
- Directory category is Education & Research. Targeting is all available countries. Plugin access is free, with no commerce, advertising, or sale of personal data.
- Package source is `integrations/chatgpt-plugin/`. It contains `plugin.json` (Agent Plugins 1.0, listing, review and publication fields), `mcp.json` (remote server), `assets/logo.png` (the original vector mark rendered to a square PNG), and `skills/blind-spot-learning/SKILL.md`.
- Use DCR when connecting this MCP server in the OpenAI dashboard. The portable MCP descriptor declares the transport and HTTPS endpoint. Registration is discovered from OAuth metadata and selected on the connection. An inspected archive of these preparation files is at `integrations/blind-spot-interval-1.0.0.zip`. Rebuild the ZIP from the package source after adding the final URLs and review evidence. The archive root folder should be `blind-spot-interval/`.

## Architecture and deployed URLs

Firebase Hosting serves the React app and forwards API, MCP, and OAuth routes to the Firebase Functions API. Firebase Authentication handles Google sign-in. Firestore stores learner data and server-side integration state. Calendar work uses Firestore jobs, worker leases and scheduled reconciliation. Blind Spot Connect uses the same scheduler and data layer as the website.

| Destination      | URL                                         | Status                                                                                                          |
| ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Website          | https://blind-spot-interval.web.app         | Verified signed out. The landing page identifies Blind Spot Interval and shows the publisher’s support contact. |
| Privacy Policy   | https://blind-spot-interval.web.app/privacy | Awaiting deployment and signed-out verification                                                                 |
| Terms of Service | https://blind-spot-interval.web.app/terms   | Awaiting deployment and signed-out verification                                                                 |
| Support Center   | https://blind-spot-interval.web.app/support | Awaiting deployment and signed-out verification                                                                 |
| Connect          | https://blind-spot-interval.web.app/api/mcp | Public discovery and unauthenticated challenge observed. Authenticated ChatGPT connection pending.              |

Firebase Hosting already rewrites these page routes to the SPA. A 200 for the HTML shell is insufficient. Verify rendered page content, public access, navigation, language and refresh before adding the corresponding URL fields to `extensions.com.openai.interface`.

## Integration release

This branch combines the public plugin preparation at `c87e561` with Gemini OAuth and per-connection approvals at `a52a8b2`. Local emulator and GitHub validation cover the integrated behavior. Live provider checks and policy review are still pending.

## OAuth and tool audit

- The server uses stateless Streamable HTTP over POST and JSON responses. GET returns 405 after authentication. Missing credentials receive a 401 and a resource metadata challenge. The live resource metadata resolves to the canonical MCP URL and the advertised authorization server.
- Discovery advertises PKCE S256 and the token/revocation methods `none`, `client_secret_basic` and `client_secret_post`. Static clients are public. DCR supports public and confidential clients, with hashed confidential secrets and exact approved callbacks. Client authentication is bound to the registered method. Consent is bound to the first-party browser, and authorization codes are short-lived, single-use and redirect-bound. The Gemini fix accepts up to 6,000 form-encoded state characters and preserves the decoded value exactly through the callback. Ingress and provider callback size limits still apply.
- Tokens are opaque and validated against expiry, canonical audience, active grant, Firebase identity and required scopes. Refresh can narrow scopes and normally rotates credentials. Replayed rotating refresh credentials revoke the grant. The existing opt-in persistent refresh for qualifying Gemini confidential clients is retained. Identity comes from the authenticated principal and cannot be selected by tool input.
- ChatGPT requires the exact callback displayed for that connection. Copy it from the intended MCP management page when permitted and retain approved Claude and Gemini callbacks. Neither a guessed callback nor a wildcard is appropriate. Portal domain verification or other proof of control must use the challenge issued for the intended connection.
- Whole-server linking uses HTTP discovery and authorization. Tool metadata now also declares OAuth schemes. The MCP SDK handles the protocol scope challenge, and handler-level denials can carry OpenAI's tool challenge metadata. Review the actual linking and scope-upgrade experience in the host.
- ChatGPT supports an optional profile tool for labeling multiple linked accounts. The 12 existing tools are retained. No dedicated account-identity tool is declared.
- Each tool keeps its strict input/output schemas and explicit annotations. The nine internal read tools are read-only, non-destructive and closed-world. The three write tools can cause Calendar side effects within the learner’s bounded private account. They are also closed-world under OpenAI’s annotation guidance. Completing or moving an existing review can update its prior state and is marked destructive. Creation is additive. Writes are retryable with identical arguments and idempotency key during the confirmation or receipt window.
- Read principals missing required scopes receive an authorization challenge. Invalid inputs and missing or foreign records produce errors. The three write tools return `confirmation_required`, `applied`, or `cancelled` as applicable, with separate Calendar status. New and reauthorized grants default to manual confirmation. The signed-in owner can explicitly enable automatic execution per write-enabled connection. The commit transaction rechecks account deletion, the active grant, scopes, approval mode and the action record. A scheduling warning requires confirmation, and a warning introduced between preview and commit blocks the write and calls for a fresh proposal. Prior manual proposals stay manual when the mode changes. Duplicate keys with different inputs are rejected during the receipt window.

| Tools                                                           | Required scopes                                       |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `list_topics`, `get_topic`                                      | `topics:read`                                         |
| `get_due_reviews`, `preview_review`                             | `reviews:read`                                        |
| `get_review_history`, `get_topic_history`                       | `topics:read`, `reviews:history:read`                 |
| `get_learning_stats`, `get_weak_topics`, `get_learning_profile` | `topics:read`, `reviews:read`, `reviews:history:read` |
| `create_topic`                                                  | `topics:write`                                        |
| `complete_review`, `reschedule_review`                          | `reviews:write`                                       |

Some topic and review responses expose extra fields only when the associated read scope is present. See [Blind Spot Connect](blind-spot-connect.md) for the field and configuration reference. See [OpenAI OAuth guidance](https://developers.openai.com/plugins/build/auth), [OpenAI public submission](https://developers.openai.com/plugins/deploy/submission), [OpenAI tool review guidance](https://developers.openai.com/plugins/deploy/app-review#common-rejection-reasons), [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and [MCP transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

## Privacy and Google API use

- Firebase Auth supplies the UID, email and display name used by the account. The MCP tools return scoped learning and schedule data. The tool schemas have no Google identity, Calendar credential, personal event detail or raw free/busy output. Schedule placements and sync status can reflect Calendar processing. The Calendar integration sends learning data needed for the app-created review events to Google.
- The optional Calendar integration requests `calendar.app.created` and `calendar.events.freebusy` for the dedicated calendar and primary calendar availability. Verify consent, minimum access, storage and transfer in the Cloud project. The Workspace-specific Limited Use rules cover data derived from sensitive and restricted scopes. Keep such data tied to prominent user-facing features, obtain consent for permitted transfers, restrict human access to the policy exceptions and prohibit general model training with that data. Review Calendar-influenced placements, availability warnings and reschedule checks with each AI provider. Validate transfer consent and provider data-use terms or isolate those outputs from Connect before release. After verifying actual compliance, include the required affirmative Limited Use disclosure in the public privacy policy.
- Google’s Workspace AI Tools Addendum takes effect February 1, 2027 and requires Google MCP for covered AI-driven access to Workspace data. The existing Calendar sync and reschedule availability checks call Google Calendar REST. Determine whether the AI-driven reschedule path or Calendar-derived results fall within the addendum and resolve any required migration or isolation before the applicable deadline.
- Before public use, confirm the Google OAuth branding, consent text, verified domains and public policy URL in the actual Google Cloud project. Confirm the production configuration for access controls, Firebase/Cloud Logging retention and request URL logging, Firestore TTL, backup/PITR retention, backup restores, and privacy-request handling. Validate hosting and any third-party provider handling against the final policy. No specific retention commitment is made for logs or backups.
- Logs include operational event types and can contain hashed account identifiers and client IDs. Do not include requests containing learning data, OAuth codes, or credentials in review materials or debug logs. If backups are enabled, document how deletion markers are preserved or reapplied before restored data is accessible. Platform-provided infrastructure logs and backup lifecycle must be handled through their configured controls.

[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) · [Google Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy#limited-use-of-user-data) · [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth) · [Workspace AI Tools Addendum](https://workspace.google.com/terms/ai-tools) · [Google Workspace release notes](https://developers.google.com/workspace/release-notes)

## Account deletion

In **Settings → Account → Delete account**, the user reviews the consequences and reauthenticates with the same Google account. The API requires explicit confirmation, a valid Firebase Google session and a recent auth time. Acceptance returns HTTP 202. Sign-out follows acceptance. Repeating an authenticated request while pending returns the same accepted state.

The acceptance transaction freezes backend and Firestore access, removes MCP grants and stops Calendar synchronization from claiming new work. The existing `reconcileCalendar` scheduled function also processes deletions. The deletion worker waits for active Calendar leases, revokes Google tokens it still holds, then deletes the Calendar connection, sync jobs and locks, Calendar OAuth state, account-scoped MCP token/action records, the complete `users/{uid}` tree and Firebase Authentication identity. A concurrently finishing Calendar OAuth callback is fenced and queues its newly issued credential for revocation. Disconnects completed before the deletion request may have already discarded the stored Google credentials. The user can revoke remaining access in their Google Account. Existing Calendar events are left intact. Copies previously disclosed to AI providers are subject to those providers' controls.

The Firestore deletion queue keeps encrypted credentials only until revocation and uses leases, retries with backoff and repeat-safe cleanup. Calendar reconciliation and the deletion queue run independently during the existing scheduler invocation. A failed workload is reported after both finish. The completed job becomes a minimal tombstone keyed by a SHA-256 digest of the Firebase UID, with no raw UID or learning content. It prevents stale requests from recreating the old account. This is an additive database change with no data migration, composite index or new secret. Client access to the queue remains denied. Restricted operators should investigate persistent scheduled job failures and overdue jobs. Verify Cloud Scheduler invocation and alerting in the target project. For an intermittent Google failure, the account stays blocked while cleanup is retried.

## Controlled production rollout

The production rollout uses the existing `api`, `syncJob` and `reconcileCalendar` Functions and the existing Calendar Scheduler job. The [manual production workflow](../.github/workflows/firebase-release.yaml) releases one explicitly approved `main` SHA to `blind-spot-interval`. Obtain separate approval for merge and deployment. Confirm the approved merge result and its checks before dispatch.

1. Capture current Hosting and Cloud Run versions, the active ruleset, per-function environment fingerprints, secret version metadata, and the Scheduler job state. Verify the worker runtime identity has the effective `firebaseauth.users.delete` permission and the deployment identity can publish Firestore rules. The directly assigned Firebase Auth Viewer role does not include deletion. Any IAM change requires separate production approval. Check current recovery and logging policies. The read-only preflight found Firestore PITR disabled and no scheduled backups.
2. Use a clean checkout and preserve the existing per-function environments and Secret Manager values. Deploy the current Calendar and Firestore workers first, followed by the reviewed Firestore rules, the API and then Hosting. Keep the existing database, indexes, OAuth choices, service identities and Calendar grants. Exercise newly available writes and deletion only with disposable test accounts.
3. Verify the served commit, legal pages, OAuth discovery and Google sign-in. With the dedicated account and calendar, verify scheduling, approval modes, duplicate requests, warning fallback, revocation and deletion. Record provider-specific outcomes as live checks.

For rollback, restore the captured Hosting version from release history and direct traffic to compatible prior revisions. While any deletion is pending, retain the deletion-aware API guard, rules and the worker that processes the queue. Use a compatible fix if the queue cannot drain. Rolling back code or configuration cannot recover deleted records. [Firebase Hosting rollback](https://firebase.google.com/docs/hosting/manage-hosting-resources#roll-back-to-a-previous-version-of-your-site) · [Cloud Run rollback](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration#roll-back)

## Optional staging reference

Use a dedicated Firebase staging project and a synthetic reviewer account. Confirm the checked-in `firebase.json` targets Hosting, Functions, Firestore Rules and indexes. Deploy this set together after approval so that the API, worker, Firestore Rules and UI agree. Review [Firebase setup](FIREBASE_SETUP.md) and the manual [Firebase release workflow](../.github/workflows/firebase-release.yaml). The production workflow gates release on an explicitly approved `main` SHA.

1. In staging, configure Google sign-in and authorize the exact first-party hostname. Verify the Google Calendar OAuth redirect if testing Calendar. Set project variables and existing Secret Manager values. Build with `npm ci` and `npm run build`.
2. With staging deployment authorization, run `npx firebase deploy --project "$BLIND_SPOT_STAGING_PROJECT" --only hosting,functions,firestore` using the dedicated staging project ID. This includes the API, existing Calendar workers with account deletion, rules and indexes. Confirm the scheduled function runs under its expected service identity with Firebase Auth and Firestore permissions and Calendar secret access. Verify that it does not log credentials.
3. Verify the three URLs in a signed-out browser in English and Russian. Validate DCR with the exact callback shown on the intended ChatGPT connection, then check Google sign-in, consent, scopes, refresh, revoke and all cases. Re-run live Claude and Gemini flows separately. In Gemini on the web, open **Customize → Connectors → Custom**, paste the MCP server URL, select **Next**, and follow the sign-in and consent prompts. If Gemini reports an unapproved callback, escalate the exact URL to the Blind Spot administrator. Verify exact state round-tripping, confidential registration, refresh and revoke. Start with global Connect writes disabled. Enable them only for the write-validation window and use a dedicated synthetic account. Verify default manual approval, explicit per-connection opt-in, immediate receipts, retries, warning fallback, revocation and account deletion. Use a disposable Google Calendar connection to verify synchronization and credential revocation.
4. After an authorized production rollout, repeat public URL checks against the production host. Record authenticated connection and review evidence. Add verified URLs and the verified demo URL to the manifest, produce a ZIP containing only the package, and verify the actual archive before opening the submission flow.

Existing configuration to reconcile per environment:

| Scope                   | Configuration                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web build               | `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`, `VITE_BACKEND=firebase`, `VITE_USE_FIREBASE_EMULATORS=false`     |
| Functions and Calendar  | `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, optional `CALENDAR_REDIRECT_URI`, existing secrets `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`                                        |
| Connect                 | `BLIND_SPOT_CONNECT_ENABLED`, `BLIND_SPOT_CONNECT_WRITES`, `BLIND_SPOT_CONNECT_ORIGIN`, `BLIND_SPOT_CONNECT_REGISTRATION_REDIRECTS`, optional `BLIND_SPOT_CONNECT_CLIENTS` |
| Existing Gemini options | `BLIND_SPOT_CONNECT_GEMINI_REGISTRY`, `BLIND_SPOT_CONNECT_GEMINI_PERSISTENT_REFRESH`, optional exact approved callback registry in Firestore                               |

## Reviewer account, cases and demo

Provision a dedicated Google-backed reviewer account on the reviewed deployment and a second isolated account for negative authorization checks. Use synthetic material. Verify that the intended reviewer can sign in without depending on the publisher's personal device, mailbox, or account. Supply login URL, account and sign-in instructions only in secure Review details. The current app requires Google sign-in. If the reviewer cannot use that login independently, agree on a supported test-access route with OpenAI before submitting.

Use an explicit study timezone, date-relative pending reviews, a recently completed series with multiple recorded ratings, a declining topic and an overdue topic. Seed fixtures using the app and supported test setup, refresh dates before review, and remove or reset the created topic and shifted review between rehearsals. Using Calendar is optional for the baseline cases. Use a dedicated test calendar for an additional sync case.

Exercise automatic and manual modes on separate synthetic fixtures or reset each connection to manual after testing. The actual prompts, setup instructions, tool calls and expected outcomes are in [the manifest](../integrations/chatgpt-plugin/plugin.json). Results below are for the ChatGPT review cases, distinct from local regression tests.

| Case                   | Expected behavior                                                         | ChatGPT evidence |
| ---------------------- | ------------------------------------------------------------------------- | ---------------- |
| Today's reviews        | `get_due_reviews` today returns account-local titles, times and durations | Not run          |
| Learning progress      | `get_learning_stats` summarizes recorded trends and coverage              | Not run          |
| Weak topics            | `get_weak_topics` distinguishes rating and scheduling evidence            | Not run          |
| Create topic           | `create_topic` applies once after explicit automatic opt-in               | Not run          |
| Reschedule review      | `reschedule_review` with a warning stays pending even in automatic mode   | Not run          |
| Email schedule         | Explain unsupported operation, with no call                               | Not run          |
| Access another account | Confirm the authorization boundary and disclose no cross-account data     | Not run          |
| Edit history           | Explain restriction, with no mutation and original rating preserved       | Not run          |

Record a short screen walkthrough of the exact reviewed build in ChatGPT using the dedicated account. Show first-party consent without displaying secrets, then run the due-review prompt and the learning-progress prompt. Show a weak-topic response grounded in returned data. Show the default manual setting and explicitly enable automatic actions for the test connection. Run the create prompt twice with the same tool arguments and key and show the single applied receipt. Run the reschedule prompt with a conflict, pause on the pending confirmation, approve in Blind Spot, and show the applied receipt and updated schedule. Include the historical-edit refusal. Verify readability, remove sensitive account details, and confirm the video plays from a reviewer-accessible URL before adding it to the manifest. The script and test prompts are prepared. Recording and playback evidence are pending.

## Submission checklist

- [x] Prepare Agent Plugins 1.0 package source, branded icon, localized listing, instructions, and eight review cases.
- [x] Implement public pages and account deletion in source.
- [ ] Confirm publisher decisions, Google Workspace Limited Use and AI Tools applicability, scope classification, consent and OAuth verification.
- [ ] Verify the shared deletion scheduler, Google Calendar revocation and signed-out policy pages on the released version.
- [ ] Verify exact ChatGPT OAuth callback and live DCR, consent, refresh, revoke and tool scans. Recheck live Claude and Gemini compatibility, including Gemini state round-tripping and approval settings.
- [ ] Publish and verify the four listing destinations, finish authenticated case runs, and verify the review video and reviewer access.
- [ ] Confirm an eligible OpenAI project with global data residency, verify developer identity and domain control, add final package metadata, and complete applicable portal checks and attestations with authorized publisher access.
