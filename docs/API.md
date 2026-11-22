# REST API

All routes below start with `/api/v1`. Private requests use the `bs_session` HTTP-only cookie. Mutations require both the configured Origin and `x-csrf-token` returned by `GET /me`. Resource IDs must be UUIDs. Errors return `{error, details?}` with 400, 401, 403, 404, 409 or 503 as appropriate; unexpected internal errors do not disclose SQL or credentials.

| Method    | Path                            | Behavior                                                          |
| --------- | ------------------------------- | ----------------------------------------------------------------- |
| GET       | /auth/google/start              | Login consent, state/nonce/PKCE                                   |
| GET       | /auth/google/callback           | Verify OIDC, create user/session                                  |
| POST      | /auth/logout                    | Delete session, clear cookie                                      |
| GET       | /me                             | Current user and CSRF token                                       |
| GET/PATCH | /preferences                    | Read/save complete validated preferences                          |
| PATCH     | /preferences/language           | Save en or ru independently of study settings                     |
| GET       | /topics                         | List: q, tag, sort=date/title/importance, archived, offset, limit |
| POST      | /topics                         | Create with optional Idempotency-Key header                       |
| GET/PATCH | /topics/:id                     | Detail / partial topic update                                     |
| POST      | /topics/:id/archive             | Cancel pending review, preserve history                           |
| POST      | /topics/:id/restore             | Resume using existing memory                                      |
| PUT       | /topics/:id/materials           | Replace ordered material list                                     |
| GET       | /topics/:id/history             | Latest 100 review log entries                                     |
| GET       | /tags                           | User's tag names                                                  |
| GET       | /reviews/today                  | Pending due/overdue through end of local day                      |
| GET       | /reviews/upcoming               | Pending reviews including unscheduled                             |
| GET       | /reviews/progress               | Count completed on local day                                      |
| POST      | /reviews/:scheduleId/complete   | `{rating:1..5}`, idempotent                                       |
| POST      | /reviews/:scheduleId/correct    | Audited latest-review correction                                  |
| PATCH     | /reviews/:scheduleId/schedule   | `{scheduledAt: ISO}`, future manual override                      |
| POST      | /reviews/:scheduleId/reset-auto | Restore automatic placement                                       |
| GET       | /schedule/preview               | knowledge?, importance?, duration?, scheduledAt?                  |
| GET       | /calendar/connect               | Separate optional Calendar authorization                          |
| GET       | /calendar/callback              | Save encrypted offline grant                                      |
| GET       | /calendar/status                | Safe connection metadata, no credentials                          |
| POST      | /calendar/disconnect            | Stop synchronization, discard token envelope                      |
| POST      | /calendar/resync                | Queue incremental/full reconciliation                             |
| POST      | /webhooks/google-calendar       | Validate channel token/resource, deduplicate and enqueue          |

`GET /health` is outside the versioned namespace and checks PostgreSQL connectivity.

Topic input: title; nullable initialKnowledge and importance; duration 5–180; tags (20 maximum, 40 characters each); materials (100 maximum, 2000 characters each); optional scheduledAt override. Input properties use camelCase; persisted response records use snake_case. Initial knowledge is immutable in the edit implementation to protect learned state. Preferences require timezone, studyStart, studyEnd, duration, daysBefore, daysAfter, retention[5], onboarded.

### First-review preview and language preferences

Both API implementations accept the following authenticated requests.

- `GET /api/v1/schedule/preview` accepts optional knowledge, importance, duration and a future ISO timestamp in `scheduledAt`. It runs the scheduling engine against pending reviews and, when connected, queries free/busy on the primary Google calendar. A manual override keeps its chosen time and can return a warning. A successful automatic calculation can return a null start when there is no free slot.
- `POST /api/v1/topics` accepts optional `expectedStart` (an ISO timestamp or null). The editor sends the displayed start and reuses its idempotency key on retries. Creation rechecks availability and compares the placement inside the database transaction. A changed automatic slot returns HTTP 409 so the editor can refresh before saving. Existing clients can omit the field.
- `PATCH /api/v1/preferences/language` accepts `{"language":"en"}` or `{"language":"ru"}`. It merges the language into the existing preferences record independently of study settings. Older records need no migration.

For Firebase, release the updated API function with the Hosting bundle. The optional preference field uses the existing collection and access rules.
