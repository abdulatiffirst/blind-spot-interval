# Blind Spot Interval — Firebase Migration and Full Backend Implementation

You are working in my existing repository:

`D:\Blind Spot\blind-spot-interval`

## Current state

The repository already contains:

- `apps/web` — React frontend
- `apps/api` — existing Fastify backend
- `apps/worker` — existing background worker
- `packages/memory-engine` — FSRS-7 scheduling logic
- `packages/calendar-scheduler` — calendar availability scheduling
- `packages/database` — existing PostgreSQL database implementation
- `packages/shared` — shared application types
- `functions` — initialized Firebase Functions project

Firebase CLI, Java 21, Node.js 24, Firebase Authentication, Cloud Firestore, and Firebase Emulator Suite have already been configured.

The local emulator project ID is:

`demo-blind-spot-interval`

The real Firebase project already exists in Google Cloud.

## Objective

Migrate the existing application to the following final architecture:

- React + TypeScript frontend
- Firebase Authentication with Google Sign-In
- Cloud Firestore
- Firebase Cloud Functions v2
- Firebase Emulator Suite
- Firebase Hosting
- Existing FSRS-7 Memory Engine
- Existing Calendar Scheduler
- Google Calendar API with secure offline OAuth and two-way synchronization

The objective is to preserve as much existing working code as possible while building a complete Firebase-based MVP.

## Step 1 — Audit

Inspect the entire repository.

Identify:

1. Existing implemented frontend features.
2. Existing API routes and backend logic.
3. Existing database schema.
4. Existing review and scheduling workflows.
5. Existing Google Calendar integration.
6. Existing tests and their results.
7. Dependencies between modules.

Document findings in `docs/FIREBASE_MIGRATION_PLAN.md`.

Do not delete or overwrite useful functionality.

## Step 2 — Preserve existing algorithms

Review:

`packages/memory-engine/src/index.ts`

`packages/calendar-scheduler/src/index.ts`

Preserve their existing functionality.

Fix identified edge cases, including:

- Cold-start memory initialization.
- Timezone handling.
- Exact due-time calculations.
- Configurable scheduling-window boundaries.
- Recovery reviews.
- Scheduling conflicts.
- Manual overrides.
- Double submissions.
- Invalid durations.
- Daylight-saving transitions.

Use the actual ts-fsrs 6.x API.

Do not replace FSRS with a basic fixed interval algorithm.

Write automated tests before changing core scheduling behavior.

## Step 3 — Firestore migration

Implement Firestore collections for:

- users
- user preferences
- topics
- topic materials
- tags
- memory states
- review history
- review schedules
- calendar connections
- calendar events
- synchronization jobs

Use secure document ownership and Firestore Security Rules.

Preserve nullable initial knowledge and importance ratings.

Use Firestore transactions for completing reviews and creating the next schedule.

Implement migration tooling for existing PostgreSQL data if needed, but do not overwrite production data.

## Step 4 — Firebase Cloud Functions

Implement Cloud Functions v2 for:

- Creating topics
- Listing topics
- Editing topics
- Archiving and restoring topics
- Managing ordered material bullet points
- Managing tags
- Completing reviews with ratings 1–5
- Calculating next reviews
- Updating scheduling preferences
- Manual rescheduling
- Connecting Google Calendar
- Synchronizing calendar events

Authenticate every user-facing function and validate input.

Never trust a user ID supplied by the client.

Prevent duplicate review completion through idempotency and transactions.

## Step 5 — Google Calendar

Implement:

- Separate Calendar OAuth authorization
- Secure offline refresh-token management
- Dedicated Blind Spot Interval calendar
- Reading authorized free/busy information
- Creating events
- Updating event descriptions
- Rescheduling events from Google Calendar
- Detecting deleted events
- Automatically finding replacement slots
- Preventing infinite recreation loops
- OAuth reconnection handling
- Watch channel renewal and synchronization recovery

Study materials must appear as ordered bullet points in Google Calendar descriptions.

Do not use Firebase Sign-In tokens as a substitute for server-side offline Calendar authorization.

## Step 6 — Frontend integration

Connect the existing React frontend to Firebase Authentication and backend functions.

Implement working screens:

- Login
- Onboarding
- Today
- Add Topic
- Topic Management
- Topic Details
- Review
- Calendar
- Settings

Preserve the existing Blind Spot visual identity.

All screens must use real Firestore/backend data rather than static placeholders.

## Step 7 — Local development

Configure the application to work with:

- Authentication Emulator: 9099
- Firestore Emulator: 8080
- Functions Emulator: 5001
- Emulator UI: 4000

Use local project ID:

`demo-blind-spot-interval`

Ensure that automated local tests never access production Firestore.

Check the existing `firebase.json`, `.firebaserc`, and project configuration before changing them.

## Step 8 — Testing

Run:

- TypeScript type checks
- ESLint
- Unit tests
- Integration tests
- Firebase Emulator tests
- Frontend production build
- End-to-end tests where supported

Verify the following complete flow:

Google Sign-In → Add Logarithms → Assign knowledge 3/5 → Assign importance 5/5 → Add materials → Schedule first review → Complete review with rating 4 → Calculate next review → Update calendar.

Use mocked Google Calendar APIs until real credentials are available.

## Step 9 — Safety

Do not:

- Delete the existing backend before replacement is validated.
- Change the production Firebase database without approval.
- Deploy cloud functions without explicit permission.
- Commit `.env` files or OAuth secrets.
- Claim that untested integrations work.

Document all architectural decisions and unresolved issues.

## Step 10 — Completion

Continue implementing all phases that can be completed locally.

Maintain `docs/IMPLEMENTATION_PROGRESS.md`.

At the end, report:

- Features implemented
- Files changed
- Tests run
- Tests passed and failed
- Remaining blockers
- Required Google Cloud configuration
- Exact local startup commands
- Deployment preparation steps

Do not stop after writing the migration plan. Implement the application and test it.
