> Historical PostgreSQL implementation documentation. The active Firebase migration is documented in [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [FIREBASE_ARCHITECTURE.md](FIREBASE_ARCHITECTURE.md).

# Architecture

The npm workspace shares Zod contracts and TypeScript types. React fetches the versioned Fastify API through the same origin. PostgreSQL persists all user state, opaque hashed session IDs and synchronization jobs. Drizzle provides a typed schema and ORM preference reads; postgres.js tagged SQL implements transactions and explicit locks. These clients are separate because Drizzle changes its client's JSON serializers.

Memory-engine wraps the current `DefaultScheduler` public API from ts-fsrs 6. Calendar-scheduler is a pure function over an ideal instant, preferences, time, and busy intervals. Google synchronization is a third concern; it cannot complete a review or update a memory card.

Review transactions serialize per user with PostgreSQL advisory locks. They update the completed schedule, review log, memory state, next schedule and outbox atomically. A partial unique index allows one pending review per topic. A unique log per schedule makes duplicate completions idempotent. User ownership is checked before access to every private topic and review resource.

The separate worker claims jobs with SKIP LOCKED, persists attempts/backoff, recovers expired leases, and serializes a user's external jobs with a distinct advisory lock. Network calls stay outside API database transactions. Reconciliation runs every five minutes. Processes must restart after restoring an environment snapshot.

Production uses an HTTPS reverse proxy for static assets and `/api`. Authentication has no implicit trust in proxy-supplied user IDs or browser-local identities.
