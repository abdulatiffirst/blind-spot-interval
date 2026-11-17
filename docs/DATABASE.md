# Database

Versioned SQL under `packages/database/migrations` is the migration source of truth. `npm run db:migrate` takes a migration advisory lock and applies unapplied files transactionally. The Drizzle schema was introspected from the applied PostgreSQL schema; update it when migrations change. Never run schema push against production.

- `users`: UUID, unique Google sub, current email/name/timezone. Email is not the identity key.
- `user_preferences`: one JSON settings record per user, validated by the shared Zod contract.
- `sessions`: hash of opaque session token, CSRF value, user, expiry.
- `oauth_states`: short-lived single-use hashed state, nonce, PKCE verifier, purpose and owner.
- `topics`: nullable initial knowledge/importance, derived target retention, duration, active/archived state. Optional user-scoped idempotency key for creation.
- `topic_materials`: individual text/URL/position with unique ordering per topic.
- `tags`, `topic_tags`: normalized per-user uniqueness and topic associations.
- `memory_states`: complete FSRS JSON card including fast stability; indexed numeric stability/difficulty; algorithm/weights, actual timestamp and review count.
- `review_schedules`: ideal and selected instants, duration, manual/automatic mode, lifecycle and reason. One pending schedule per topic.
- `review_logs`: original/mapped rating, before/after card, actual completion instant, revlog, version and weights. One log per schedule.
- `review_corrections`: previous rating/state and correction timestamp. Existing completion timestamp remains unchanged.
- `calendar_connections`: dedicated calendar ID, AES-GCM token envelope, scopes, cursor and watch metadata. Credentials never leave the server.
- `calendar_events`: per-schedule external ID/ETag/status and deletion loop counter.
- `sync_jobs`: durable payload, state, attempts, retry/lease timestamps and unique idempotency key.

All persisted instants use timestamptz. JSON card timestamps use UTC ISO strings and are hydrated to Date before calling FSRS. Deleting user data is not exposed as an API operation; history tables deliberately restrict casual cascading deletion. Operational erasure must explicitly remove dependent audit/event/history records.
