# Firebase implementation

Firebase Auth's stable UID replaces Google sub as the internal owner key; Google remains the only accepted sign-in provider. The frontend observes auth state and sends a fresh Firebase bearer ID token. Functions verifies the token and revocation status. Cookie session CSRF tokens are not used for Firebase bearer-authenticated API mutations. Calendar OAuth retains its own browser-bound state cookie and offline grant. Its short-lived cookie uses the Firebase Hosting-supported `__session` name so rewrites can forward it; Firebase bearer authentication does not use that cookie.

The existing React screens use the same request/response shapes through `api.ts`. The Fastify API and SQL worker remain intact for rollback via explicit legacy scripts. Shared memory and availability packages stay independent of persistence. The Functions artifact bundles those packages and the REST adapter; firebase-admin/firebase-functions are runtime dependencies with an independent deployment lockfile.

## Firestore model

- `users/{uid}`: safe profile, timezone and transaction revision.
- Owner subcollections `preferences/default`, `topics/{id}`, `topicMaterials/{topicId}` (ordered bullet array), `tags/{normalizedHash}`, `memoryStates/{topicId}`, `reviewHistory/{scheduleId}`, `reviewSchedules/{id}`, `reviewCorrections/{id}`, `calendarEvents/{scheduleId}`.
- `calendarConnections/{uid}`: encrypted offline tokens, dedicated calendar ID, connection generation, scopes, cursor and watch metadata. Server-only.
- `oauthStates/{stateHash}`: PKCE verifier, owner and TTL expiry. Server-only and single-use.
- `syncJobs/{keyHash}`: owner, type, durable state, attempts, retry eligibility and fenced lease token. Terminal records can expire after 30 days.
- `syncLocks/{uid}`: per-owner external synchronization lease, longer than the Functions execution timeout.
- `rateLimits/{bucketHash}`: server-only per-user counters with expiry.

Firestore rules permit owner reads of safe user documents and deny all direct browser writes. The Admin API is the sole mutation boundary. Other owners, anonymous clients, broad user enumeration and direct access to tokens/jobs/state/locks are denied. Zod validates inputs, ownership comes from verified tokens, and IDs in paths never select another owner's namespace.

## Transaction boundaries

Every domain mutation reads the owner revision before any writes and advances it on commit. Concurrent creations therefore retry even if their initial availability queries were both empty. Topic `pendingScheduleId` plus a transaction maintains one pending review per active topic. Review log ID equals the completed schedule ID, making duplicate completion exactly once. The same transaction writes the real rating/time, FSRS state, immutable before/after snapshots, next review and durable synchronization job. Correction replays only the latest real review at its original timestamp and writes an audit record.

Material order and tags are stored with explicit normalization; optional initial knowledge/importance remain null. Cold-start estimates do not fabricate reviews. Recovery flags are persisted so availability reconciliation and reset-auto cannot move failed-review recovery before its local target day. Actual scheduled times and ideal memory due instants remain separate.

Domain scheduling is deterministic for identical inputs, validates durations/timezones/windows, preserves precise ideal times, and gives available candidates inside the configured local-date window priority over fallback days. Changing study preferences reflows automatic sessions but keeps manual overrides. Calendar moves never invoke FSRS.

## Calendar and jobs

Calendar OAuth is separate from Firebase login. Connections retain encrypted grants and a generation counter so token refresh cannot overwrite a disconnected/reconnected grant. External calls occur outside Firestore transactions. Stable per-generation Google IDs, ETags/private metadata and idempotent writes prevent duplicate events. Inbound paging stores a final cursor only after processing; expired cursors reset once. Notifications enqueue a fetch rather than trusting notification content as event data. Moves become manual, deletions replace sessions safely, and repeated deletion pauses recreation until explicit resync.

New committed jobs invoke a Functions v2 document-created trigger. Eligible retries and expired leases are handled by the scheduled reconciler; a demo-only local process mirrors it in development. Claim transactions fence per-owner jobs, and stale completions cannot release a newer worker's lock. No external API request runs inside a domain transaction. Free/busy currently reads the authorized primary calendar. Push watches renew before expiration, with polling as fallback.

## Operating limits

The MVP reads a user's schedule collection when placing reviews. Large histories/very large active collections need indexed range queries and capacity validation before broad rollout. Settings changes can reflow multiple schedules in a transaction; imports cap each atomic user batch at 450 documents. The production deployment and live Google account flow are separate acceptance steps. Neither modifying Firebase config nor running demo emulators touches production.
