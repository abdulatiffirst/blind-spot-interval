> Historical PostgreSQL implementation documentation. The active Firebase migration is documented in [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [FIREBASE_ARCHITECTURE.md](FIREBASE_ARCHITECTURE.md).

# Google Calendar synchronization

Calendar consent is separate from OpenID login. Requested scopes are `calendar.app.created` for the app's secondary calendar and `calendar.events.freebusy` for availability. The initial availability implementation queries `primary`. No Calendar permission is requested during login.

The encrypted refresh grant is an AES-256-GCM envelope with random IV and authenticated tag. A stable deployment encryption key is mandatory. Access-token refresh happens only server-side. The stored dedicated calendar ID is reused on reconnect. A failed calendar creation response before its ID can be persisted remains a rare orphan-calendar risk; verify this behavior with a live account before launch.

The outbox is written in the same transaction as topic/review changes. External requests execute in the separate worker. Event IDs are deterministic per schedule generation, private metadata links each schedule, ETags avoid blindly overwriting external changes, and repeated inserts are recoverable through stable IDs. Materials appear in original order in the event description with topic review URL. Completed/cancelled events are removed, while database review history stays intact.

Inbound polling follows pages and stores the final incremental sync token only after processing the results. Expired cursors trigger a full scan. Notifications contain no trusted event payload: the validated channel/resource/token and message number enqueue a deduplicated fetch. Moves become manual overrides. Deletes retain the topic and choose a replacement slot; three deletions within a day stop recreation and display a warning to prevent loops. Reconciliation runs every five minutes, even without a public webhook. Watches renew when fewer than 24 hours remain. Old channels expire rather than requiring their process to survive.

Jobs persist attempts and exponential backoff capped at one hour; ten failed attempts mark a job failed and surface the connection error. A stale ten-minute running lease is recoverable. Disconnect stops future API sync and discards local token material; users can revoke the app's grant in Google Account permissions. Existing external events are retained on disconnect.

Live OAuth, Google scope approval, refresh-token expiry, quotas, ETag conflicts, watch delivery and consent/reconnect must be validated using a real Google test account. Automated Google tests use a mocked transport; they are not evidence of live integration success.
