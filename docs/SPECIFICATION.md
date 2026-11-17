# MASTER DEVELOPMENT PROMPT — BLIND SPOT INTERVAL

## YOUR ROLE

You are a senior full-stack engineer, software architect, UI/UX designer, database engineer, and QA engineer.

Your responsibility is to **build the complete, working Blind Spot Interval MVP from scratch**.

Do not merely provide a plan, code snippets, or mockups. Implement the application, create all necessary files, write database migrations, integrate the backend and frontend, implement the scheduling algorithms, and test the system.

**IMPORTANT: Complete all development phases, not just Phase 1.**

Work autonomously through every milestone. Do not stop after creating the project foundation or ask for approval between normal implementation stages.

When you encounter technical problems, investigate and fix them.

Do not invent API credentials, OAuth secrets, database URLs, or successful test results. If external credentials or dashboard configuration are needed, implement everything possible locally, document the exact setup procedure, and continue developing other features.

Do not claim an external integration works until it has been tested with real credentials.

If the repository already contains files, inspect them first and preserve useful existing work.

---

# 1. PRODUCT OVERVIEW

**Product:** Blind Spot Interval

**Parent brand:** Blind Spot

**Type:** Intelligent knowledge-review task manager.

**Core idea:** Users record topics they have learned. The application estimates when they should review those topics using an adaptive spaced-repetition algorithm.

Blind Spot Interval then schedules reviews automatically, taking into account the user's availability and Google Calendar.

After every review, the user rates how well they remembered the topic from 1 to 5. The algorithm updates its memory estimates and schedules the next review.

The product must be suitable for anyone learning new knowledge or skills.

Examples:

- Logarithms
- Present Perfect
- Supply and Demand
- Python functions
- Historical events
- Biology concepts

**Product philosophy:**

"Spend more time remembering knowledge, not managing reminders."

The application should be minimalist, fast, responsive, understandable, and easy to use.

Do not turn it into a complicated project-management platform.

---

# 2. TECH STACK

Use a TypeScript monorepo.

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Lucide icons

Backend:

- Node.js 24 LTS or newer compatible runtime
- Fastify
- TypeScript
- Zod for input validation

Database:

- PostgreSQL
- Drizzle ORM
- Versioned SQL migrations

Authentication:

- Google OpenID Connect
- Secure server-side sessions
- HTTP-only cookies

Algorithms:

- ts-fsrs v6 with FSRS-7
- Custom cold-start and calendar-scheduling policies

Google integration:

- Google Calendar API
- OAuth 2.0 authorization
- Free/busy API
- Calendar event synchronization

Background processing:

- PostgreSQL-backed durable jobs
- Dedicated worker process

Testing:

- Vitest
- Integration tests
- Playwright E2E tests

Use a workspace-based monorepo with shared TypeScript types.

Follow the current official documentation for all dependencies. Pin compatible dependency versions and commit the lockfile.

Before installing ts-fsrs, read:
https://open-spaced-repetition.github.io/ts-fsrs/guide/quick-start

Do not use obsolete ts-fsrs APIs.

---

# 3. PROJECT STRUCTURE

Create:

```text
blind-spot-interval/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── database/
│   ├── shared/
│   ├── memory-engine/
│   └── calendar-scheduler/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── MEMORY_ALGORITHM.md
│   ├── CALENDAR_SYNC.md
│   ├── TESTING.md
│   └── DEPLOYMENT.md
├── .env.example
├── README.md
└── package.json
```

Organize code into reusable modules.

Avoid huge components, duplicated logic, deeply nested business rules, and hardcoded credentials.

---

# 4. DESIGN SYSTEM

The product must have a polished, modern interface.

Visual direction:

- Bold but minimalist
- Youthful, without looking childish
- Clean typography
- Spacious layouts
- Consistent spacing
- Smooth, subtle interactions
- Fully responsive

Brand colors:

- Midnight: #111322
- Electric lime: #CCFF4D
- Violet: #7C3AED

Typography:

- Space Grotesk for headings
- Inter for body text

Use electric lime mainly for primary actions and important accents, not every component.

Create consistent light and dark themes with accessible contrast.

The interface must work on:

- Desktop
- Tablets
- Android browsers
- iPhone browsers

Use responsive navigation and accessible components.

Provide loading indicators, empty states, error states, success feedback, and confirmation dialogs where appropriate.

Use real application state, not hardcoded demonstration data in production views.

---

# 5. APPLICATION NAVIGATION

Create four main sections.

## Today

Display:

- Today's scheduled reviews
- Overdue reviews
- Upcoming reviews
- Number of active topics
- Review completion progress
- Quick Add Topic button

Users should immediately understand what they need to review.

## Topics

Display:

- All active topics
- Search by topic name
- Filter by tags
- Sort by next review date, importance, or alphabetically
- Archive and restore topics
- Edit topics
- Open topic details

## Calendar

Provide:

- Day, week, and month views as appropriate
- Upcoming review sessions
- Manual review rescheduling
- Clear connection status
- Google Calendar integration controls
- Conflict and scheduling warnings

The internal calendar must still work without Google Calendar connected.

## Settings

Include:

- Account details
- Timezone
- Preferred study hours
- Default review duration
- Scheduling flexibility
- Retention settings
- Advanced algorithm preferences
- Google Calendar connection
- Disconnect functionality

---

# 6. GOOGLE AUTHENTICATION

Authentication must use Google Sign-In only.

Implement secure Google OpenID Connect authentication.

Requirements:

- Login with Google
- Callback handling
- Secure sessions
- Logout
- Authenticated routes
- Session expiration
- User creation on first login
- Returning-user login
- CSRF/state and nonce protection
- Secure cookie configuration

Use Google's stable account identifier (`sub`) as the identity key.

Do not use email as the permanent unique identity.

Google Calendar authorization must be separate from authentication.

A user must be able to sign in without granting access to Calendar.

Do not automatically request unnecessary Calendar permissions during login.

---

# 7. ONBOARDING

After first login, provide lightweight onboarding.

Collect:

- Timezone, automatically detected but editable
- Preferred study hours
- Optional Google Calendar connection

Default study hours:

09:00–21:00

Default review duration:

15 minutes

Default automatic rescheduling window:

- 1 day before
- 2 days after

These settings must be editable later.

Do not force users to connect Google Calendar.

---

# 8. ADD TOPIC

Create a fast single-screen topic-creation interface.

Avoid a multi-step wizard.

Only the topic name is required.

Fields:

### 8.1 Topic name

Required text field.

Examples:

- Logarithms
- Present Perfect
- Market Equilibrium

Validate nonempty titles and enforce a reasonable length limit.

### 8.2 Initial knowledge

Optional rating from 1 to 5.

Definitions:
1 — Completely new
2 — Limited knowledge
3 — Moderate knowledge
4 — Good knowledge
5 — Excellent knowledge

Users must be able to leave this field unset.

Do not automatically select a visible rating on behalf of the user.

If omitted, store NULL and apply an internal scheduling default.

Initial knowledge influences the first review and provisional initial memory assumptions.

It must not create a fake successful review.

Even when the user selects 5/5, the topic must receive a future review.

### 8.3 Importance

Optional rating from 1 to 5.

Definitions:
1 — Low importance
2 — Somewhat important
3 — Normal
4 — Very important
5 — Essential

Importance influences target retention and therefore review frequency.

Importance must not be treated as memory difficulty.

Default retention mapping:

1 → 85%
2 → 88%
3 → 90%
4 → 93%
5 → 95%

If importance is omitted, use 90%.

Users can customize this mapping in advanced settings.

Store the original importance separately from the calculated retention target.

### 8.4 Tags

Allow multiple custom tags per topic.

Requirements:

- Create tags
- Reuse existing tags
- Tag suggestions
- Remove tags
- Search and filter by tags
- Prevent accidental duplicates

Do not require predefined subjects.

### 8.5 Study materials

Implement a simple bullet-point text editor.

Example:

- Review logarithm properties
- Solve logarithmic equations
- Watch https://www.khanacademy.org
- Remember the change-of-base formula

Behavior:

- Press Enter to create the next bullet
- Backspace on an empty bullet removes it
- Edit bullet text
- Delete bullet
- Reorder bullets
- Support normal text
- Detect and link valid URLs
- Support pasting URLs

Keep this feature lightweight.

Do not implement complex rich-text editing, PDF uploads, or AI generation in MVP.

Store individual bullet points in their original order.

### 8.6 Review duration

Default 15 minutes.

Users can change it for individual topics.

Validate a reasonable range such as 5–180 minutes.

### 8.7 Scheduling preview

After entering the topic, show:

- Suggested first review date
- Approximate duration
- Target retention
- Whether the schedule is automatic or manually modified

Allow users to change the date before saving.

When the user creates the topic, save it to the backend and generate the initial review schedule.

---

# 9. TOPIC MANAGEMENT

Create a topic details page.

Display:

- Topic title
- Tags
- Initial knowledge
- Importance
- Target retention
- Ordered study materials
- Review duration
- Next ideal review date
- Actual scheduled review date
- Previous review history
- Current scheduling status

Allow editing:

- Title
- Tags
- Materials
- Importance
- Duration
- Next scheduled date

Changing the original knowledge assessment after real reviews must not silently reset learned memory parameters.

Archive functionality:

- Archive a topic
- Preserve all review history
- Stop future automatic scheduling
- Remove or cancel upcoming Blind Spot calendar events
- Restore the topic later

On restoration, determine an appropriate new review based on previous history and elapsed time.

Do not delete topic history merely because a topic is archived.

---

# 10. REVIEW EXPERIENCE

When a review is due, the user can open a dedicated review page.

Display:

- Topic title
- Tags
- Study materials
- Relevant links

Ask:

"How well did you remember this topic?"

Provide exactly five ratings.

1 — Forgot completely
2 — Mostly forgot
3 — Recalled with difficulty
4 — Good recall
5 — Effortless recall

Explain that ratings should reflect recall or application before consulting notes, not whether the user enjoyed the session.

When the user selects a rating:

- Complete the review immediately
- Save the rating
- Record the actual completion timestamp
- Update memory parameters
- Calculate the next review
- Create the new schedule
- Queue Calendar synchronization
- Show a compact completion confirmation and next review date

Do not require a second confirmation button after rating.

Prevent accidental double submission.

Include an accessible way to correct an accidental rating, with a safe recalculation or reversal mechanism and an audit trail.

---

# 11. MEMORY ALGORITHM

Use FSRS-7 through the current ts-fsrs public API.

Build a dedicated memory-engine package.

Do not implement a simplistic multiplication-based interval algorithm and present it as FSRS.

Persist:

- Difficulty
- Stability
- Retrievability-related state as required
- Review count
- Last review date
- Algorithm version
- FSRS model parameters
- Previous review results

Use appropriate supported types and serialization from the selected library.

## Rating mapping

Blind Spot rating → FSRS rating:

1 → Again
2 → Again
3 → Hard
4 → Good
5 → Easy

Preserve the original 1–5 rating in review history.

## Failed reviews

If the user rates the review 1 or 2:

- Update the FSRS memory state
- Mark the current review completed
- Target the following local calendar day for recovery
- Pass the target date to the Calendar Scheduler

If no suitable slot exists tomorrow, schedule the nearest available future slot.

Do not treat a reschedule as a successful review.

## First review cold-start policy

Use these provisional first-review intervals:

Knowledge 1 → 1 day
Knowledge 2 → 1 day
Knowledge 3 → 2 days
Knowledge 4 → 4 days
Knowledge 5 → 7 days
Knowledge omitted → 1 day

The initial review should be based on the creation date and user's timezone.

These are product defaults, not scientifically validated optimal intervals.

Implement the initial knowledge-to-memory-parameter initialization carefully, using documented library capabilities. If the library cannot support an exact desired cold-start state, preserve the provisional estimate separately instead of fabricating an FSRS review.

## Importance-based retention

Use the retention mapping described earlier.

Allow advanced users to customize retention values.

Maintain reasonable validation bounds, initially 80–97%, unless the library documents a narrower supported range.

## Critical rules

- Store the real review timestamp
- Never insert fake reviews
- Never change memory stability when a calendar event is moved
- Never treat a missed review as completed
- Preserve review history
- Store algorithm versions
- Make scheduling deterministic when given identical inputs
- Preserve the distinction between recommended and actual scheduled dates

Provide automated tests for all of these rules.

---

# 12. CALENDAR SCHEDULER

Build a separate Calendar Scheduler module.

It must be independent from the Memory Engine.

The Memory Engine decides when a review is ideally needed.

The Calendar Scheduler decides when the user can realistically perform it.

Inputs:

- Ideal due date
- Review duration
- Timezone
- Preferred study hours
- Rescheduling window
- Existing Blind Spot sessions
- Google Calendar availability, if connected
- Topic importance
- Estimated forgetting risk

Default study hours:

09:00–21:00 local time.

Default flexible window:

1 day before / 2 days after the recommended date.

Allow the user to customize both values.

## Scheduling process

1. Obtain the ideal review date.
2. Generate candidate time slots.
3. Exclude past times.
4. Exclude conflicting Blind Spot sessions.
5. Exclude Google Calendar busy intervals when authorized.
6. Ensure the complete review duration fits.
7. Rank available slots by distance from ideal date and memory urgency.
8. Select the best available slot.
9. Store the ideal date and selected time separately.
10. Queue synchronization with Google Calendar.

Use a reasonable slot granularity, such as five minutes.

Prefer human-friendly times where reasonable.

## If no slot is available

Search the nearest future free day.

Do not indefinitely postpone the task.

Use a bounded search horizon, initially 30 days.

If no suitable slot exists:

- Keep the review pending
- Mark it unscheduled
- Explain the conflict to the user

When a review is shifted beyond the configured window, record and display the reason.

## Manual override

Users can modify review dates in Blind Spot Interval.

Manual changes must take precedence over automatic scheduling.

The scheduler must not immediately overwrite them.

Provide a "Return to automatic scheduling" action.

Manual date changes must never change the underlying memory model.

## Without Google Calendar

The scheduling system must remain fully functional.

Use:

- User's preferred study hours
- Existing internal review sessions
- Configured flexible window

Do not claim to know the user's external availability when the Calendar is disconnected.

---

# 13. GOOGLE CALENDAR INTEGRATION

Google Calendar is optional but a major product feature.

Use the official Google Calendar API.

## Authorization

After Google Sign-In, allow the user to connect their calendar separately.

Request the narrowest scopes that support:

- Creating a dedicated Blind Spot calendar
- Creating and managing events in that calendar
- Checking availability in calendars the user authorizes

Consult the current Google Calendar scope documentation.

Avoid broad permissions unless genuinely required.

Store OAuth refresh tokens encrypted on the server.

Never expose them to the browser.

## Dedicated calendar

On connection:

1. Check whether the application already has a linked Blind Spot calendar.
2. Reuse it when possible.
3. Otherwise create a secondary calendar called "Blind Spot Interval".
4. Save its Google Calendar ID.
5. Synchronize upcoming reviews.

Do not create duplicate calendars during reconnects.

## Calendar events

Create one active upcoming review event per topic.

Example:

Title:
Blind Spot · Logarithms

Duration:
15 minutes, unless customized.

Description:

Study materials:
• Review logarithm properties
• Solve logarithmic equations
• https://www.khanacademy.org

Tags:
Mathematics, Exam preparation

Importance: 5/5

Open Blind Spot Interval to review and rate your recall:
[topic-specific review URL]

Include all material bullet points in their original order.

Preserve valid URLs.

Make the description readable on desktop and mobile.

HTML may be used where supported, but maintain a readable plain-text representation.

Escape or sanitize user-controlled content appropriately.

Do not put sensitive access tokens or user secrets in descriptions.

## Two-way synchronization

Support these actions:

A. Blind Spot creates an event:

- Google Calendar receives it.

B. Blind Spot reschedules:

- Google Calendar event time changes.

C. User moves event in Google Calendar:

- Blind Spot updates the scheduled time.
- Treat the change as a manual override.
- Do not change the memory rating.

D. User deletes event in Google Calendar:

- Keep the topic.
- Automatically find another available slot.
- Create a replacement event.
- Prevent infinite deletion/recreation loops.

E. User edits topic materials:

- Update the description of the upcoming event.

F. User completes a review:

- Mark the current review completed.
- Remove or update its old event according to a consistent event-history policy.
- Create the next review event.

G. User disconnects:

- Preserve topics and review history.
- Stop external synchronization.
- Let the app continue scheduling internally.

## Synchronization infrastructure

Implement:

- Event ID mapping
- Private event metadata
- Idempotent event creation
- Retry logic
- Exponential backoff
- Incremental synchronization
- Push notifications where supported
- Recovery when sync tokens expire
- Watch-channel renewal
- Reconciliation jobs
- Conflict handling

Implement deduplication to avoid sync loops when the application receives notifications about its own changes.

Use a transactional outbox or equivalent durable job pattern.

Google Calendar webhooks must be validated and processed safely.

Google webhook notifications alone should not be treated as complete event-change data.

Use the current API documentation for the exact implementation.

---

# 14. DATABASE

Use PostgreSQL with Drizzle migrations.

Implement these entities:

- users
- user_preferences
- topics
- topic_materials
- tags
- topic_tags
- memory_states
- review_logs
- review_schedules
- calendar_connections
- calendar_events
- sync_jobs

Key requirements:

Users:

- UUID ID
- Google sub identifier
- Email
- Display name
- Timezone

Topics:

- UUID ID
- User ID
- Title
- Nullable initial knowledge
- Nullable importance
- Duration
- Active/archived status
- Timestamps

Topic materials:

- Topic ID
- Text
- Optional URL
- Position

Memory states:

- Topic ID
- FSRS state
- Stability
- Difficulty
- Algorithm version
- Last review timestamp
- Review count

Review logs:

- Original 1–5 rating
- Mapped FSRS rating
- Actual completion time
- Previous and new memory states

Review schedules:

- Ideal due date
- Scheduled start time
- Duration
- Automatic/manual mode
- Status
- Adjustment reason

Calendar connections:

- Google Calendar ID
- Encrypted token references
- Granted scopes
- Sync state
- Webhook metadata

Calendar events:

- Internal schedule ID
- Google event ID
- ETag
- Sync status

Sync jobs:

- Type
- Payload
- Status
- Attempts
- Retry time
- Idempotency key

Add appropriate indexes, constraints, unique keys, and foreign keys.

All dates should be stored in UTC with timezone-aware application logic.

Use PostgreSQL transactions for review completion and schedule creation.

External Google API calls must not run inside long database transactions.

---

# 15. REST API

Implement versioned REST endpoints.

Authentication:

- GET /api/v1/auth/google/start
- GET /api/v1/auth/google/callback
- POST /api/v1/auth/logout
- GET /api/v1/me

Preferences:

- GET /api/v1/preferences
- PATCH /api/v1/preferences

Topics:

- GET /api/v1/topics
- POST /api/v1/topics
- GET /api/v1/topics/:id
- PATCH /api/v1/topics/:id
- POST /api/v1/topics/:id/archive
- POST /api/v1/topics/:id/restore
- PUT /api/v1/topics/:id/materials
- GET /api/v1/topics/:id/history

Tags:

- GET /api/v1/tags

Reviews:

- GET /api/v1/reviews/today
- GET /api/v1/reviews/upcoming
- POST /api/v1/reviews/:scheduleId/complete
- PATCH /api/v1/reviews/:scheduleId/schedule
- POST /api/v1/reviews/:scheduleId/reset-auto

Scheduling:

- GET /api/v1/schedule/preview

Google Calendar:

- GET /api/v1/calendar/connect
- GET /api/v1/calendar/callback
- GET /api/v1/calendar/status
- POST /api/v1/calendar/disconnect
- POST /api/v1/calendar/resync
- POST /api/v1/webhooks/google-calendar

Implement typed request and response schemas with Zod.

Add validation, authorization, pagination, and useful error responses.

Users must never access another user's data by changing resource IDs.

---

# 16. SECURITY

Implement production-oriented security from the start.

Requirements:

- Secure authentication
- HTTP-only session cookies
- CSRF protection for cookie-authenticated mutations
- Appropriate SameSite and Secure cookie settings
- OAuth state and nonce validation
- Rate limiting
- Server-side input validation
- Authorization on every private resource
- Encrypted sensitive tokens
- Safe secrets management
- Secure logging
- Controlled CORS
- Content Security Policy where practical
- Protection against stored XSS
- Safe handling of external URLs
- Idempotent mutations
- No credentials in source control

Use least-privilege Google Calendar scopes.

Create `.env.example` with placeholders only.

Do not commit real API keys or tokens.

---

# 17. AUTOMATED TESTING

Write meaningful automated tests rather than just checking that files exist.

## Memory Engine

Test:

- Topic creation without optional ratings
- Initial knowledge 1 through 5
- Importance 1 through 5
- Initial rating 5 does not mark a topic mastered
- Review rating 1
- Review rating 2
- Review rating 3
- Review rating 4
- Review rating 5
- Sequence 5 → 4 → 2 → 5
- Missed review
- Early review
- Manual rescheduling
- Changes in retention preferences
- Algorithm version preservation
- Duplicate review submission

## Calendar Scheduler

Test:

- Ideal slot available
- Ideal slot busy
- Several reviews at the same time
- Different review durations
- Configurable scheduling windows
- Tomorrow unavailable after failed review
- No available time within the window
- Search beyond the configured window
- Entire 30-day search horizon unavailable
- Manual overrides
- Timezone changes
- Daylight-saving transitions
- Operation without Google Calendar

## Google Calendar

Test:

- First connection
- Calendar creation
- Reconnection
- Event creation
- Event rescheduling from Blind Spot
- Event rescheduling from Google
- Calendar event deletion
- Event recreation without infinite loops
- Description changes
- Material bullet ordering
- Duplicate notifications
- Expired synchronization token
- Expired OAuth token
- Disconnect and reconnect
- Temporary API failures

## Security and E2E

Test:

- Google login flow
- Session expiration
- Unauthorized API requests
- Cross-user data access
- Invalid input
- Topic creation
- Topic editing
- Review completion
- Archive and restore
- Mobile interface
- Keyboard interactions
- Accessibility-critical flows

Use mocks for external services in automated tests.

Clearly identify tests that need live Google credentials.

---

# 18. IMPLEMENTATION MILESTONES

Complete the following sequentially.

M1 — Monorepo, infrastructure, authentication

M2 — PostgreSQL schema, migrations, topic CRUD

M3 — Full topic-management UI and materials editor

M4 — FSRS memory engine and review workflow

M5 — Internal Calendar Scheduler

M6 — Google Calendar authorization and synchronization

M7 — Settings, responsive UI polish, accessibility

M8 — Unit, integration, and E2E tests

M9 — Security review and production configuration

M10 — Deployment preparation and final documentation

**Do not stop after M1 or M2.**

Continue through every milestone that can be completed with the available environment.

Commit work at logical milestones if Git is available and doing so is safe.

Do not overwrite unrelated user changes.

After implementing a milestone:

1. Run appropriate tests.
2. Fix failures.
3. Verify TypeScript.
4. Verify linting.
5. Update documentation.
6. Proceed to the next milestone.

Do not repeatedly ask for confirmation.

---

# 19. DEPLOYMENT

Prepare the application for deployment.

Include:

- Production environment configuration
- Database migrations
- Backend deployment instructions
- Frontend deployment instructions
- Worker deployment instructions
- HTTPS requirements
- Google OAuth redirect URIs
- Google Calendar webhook configuration
- Health checks
- Logging
- Backup considerations
- Error monitoring
- CI checks
- Production build scripts

Provide Docker configuration for local PostgreSQL and optional local services.

The app must be runnable locally with documented commands.

If live deployment requires credentials, domain configuration, or access to external accounts, do not fabricate those details.

Implement everything else and provide exact setup instructions.

Do not claim the app is live until deployment is actually verified.

---

# 20. FINAL ACCEPTANCE CRITERIA

Do not declare the project complete unless:

1. Frontend builds successfully.
2. Backend starts successfully.
3. Database migrations run successfully.
4. Authentication implementation is complete.
5. Users can create, edit, search, and archive topics.
6. Optional ratings work.
7. Tags work.
8. Bullet-point materials work.
9. Review ratings 1–5 work.
10. Memory Engine updates correctly.
11. Upcoming reviews are calculated.
12. Scheduling conflicts are handled.
13. Manual date overrides work.
14. Internal calendar functions without Google.
15. Google Calendar integration is implemented.
16. Event descriptions include materials.
17. Two-way rescheduling is implemented.
18. Deleted events are handled safely.
19. Automated tests pass.
20. All secrets are excluded from Git.
21. The README explains installation and configuration.
22. Deployment documentation is complete.

For functionality requiring real third-party credentials, report it as "implemented but awaiting live verification" until tested.

---

# 21. DEVELOPMENT AUTONOMY

You have permission to make reasonable engineering decisions that are consistent with this specification.

When details are unspecified:

- Choose secure defaults.
- Prefer simplicity.
- Avoid unnecessary dependencies.
- Avoid unnecessary infrastructure.
- Follow documented industry practices.
- Record assumptions in `docs/DECISIONS.md`.

Do not invent new major product features.

Do not introduce AI functionality, subscription systems, payments, complex gamification, or unrelated modules.

When encountering errors, prioritize fixing the current implementation over replacing the entire architecture.

Avoid mock interfaces that are disconnected from the actual backend.

Do not leave unfinished placeholder functions presented as completed features.

Maintain clear separation between:

- Memory scheduling
- Calendar availability scheduling
- Google Calendar synchronization

---

# 22. REQUIRED FINAL REPORT

After completing development, provide:

1. Project architecture summary.
2. Implemented feature checklist.
3. Repository file structure.
4. Database schema summary.
5. API endpoint list.
6. Memory algorithm explanation.
7. Google Calendar integration explanation.
8. Automated test results.
9. Security considerations.
10. Exact commands to run locally.
11. Required environment variables.
12. Deployment instructions.
13. Features requiring external credentials.
14. Known limitations.
15. Outstanding bugs, if any.

Be precise about which tests were executed and which were not.

Never invent successful test outcomes.

---

# START NOW

Inspect the repository and available development environment.

Create a detailed task checklist and begin implementing the complete Blind Spot Interval MVP.

**Do not stop at project setup. Build the actual application from end to end.**

Continue automatically through all development milestones that can be completed in the current working environment.

Make the implementation functional, maintainable, secure, and ready for real-world testing.
