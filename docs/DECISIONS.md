# Engineering decisions and current limitations

- Use the task's existing isolated checkout; do not create worktrees unless explicitly requested.
- Node 24, npm workspaces and a committed exact-version lockfile. No additional message broker: PostgreSQL is the durable outbox.
- PostgreSQL row/unique constraints plus per-user locks protect reviews and scheduling. Google calls stay outside transactions.
- Drizzle typed schema and ORM reads coexist with postgres.js for explicit locking/transaction semantics; separate clients avoid conflicting JSON serializers.
- Radix Dialog supplies the shadcn-style accessible primitive; local Button/Dialog components use class composition and Tailwind with a custom brand stylesheet. Fonts are served locally.
- All scheduling is user-timezone aware. Cold-start knowledge is provisional, stored separately from genuine FSRS review state. Initial knowledge is immutable through edit; learned state cannot be reset by editing it.
- Rating correction is restricted to the latest review. Full historical replay and optimized personal weights are outside MVP.
- Availability currently uses the primary external calendar only. Calendar selection UI is deferred. The internal scheduler remains fully functional without a connection.
- Preference changes affect future memory computations. Study-hours/timezone changes are used by new scheduling and reset-auto; manual reviews remain fixed. Existing ideal dates/history are preserved.
- Scheduling previews use internal availability; Google free/busy is checked asynchronously before outbound sync. A newly saved time can change during reconciliation if it conflicts externally.
- Topic filtering/sorting/pagination is performed in PostgreSQL. The initial UI loads successive pages into its collection; history is bounded to the latest 100 entries. Very large accounts may benefit from virtualized lists later.
- Login has no dev bypass. Tests directly seed isolated server-side sessions in PostgreSQL; production never exposes that operation.
- Live Google credentials, public HTTPS, consent-screen setup and webhook configuration are external prerequisites. No deployment has been performed.
- Official documentation pages were blocked by network policy. FSRS was verified from its published README, repository, installed typings and runtime tests. Google scope/protocol behavior remains subject to live verification.
- No external analytics/error-monitoring vendor is configured. JSON application logs and durable per-connection errors are available; connect your chosen monitor during deployment.
