# School 21 server integration (backend-server only)

This is a **portable preparation**, not a live deployment. The School 21 OS,
SSH access, outbound connectivity, persistent process support, public URL and
secrets mechanism are not known yet.

## Architecture

- Firebase Authentication and Firestore remain authoritative.
- Existing Firebase HTTPS API and web frontend remain in Firebase initially.
- School 21 runs an optional background reconciliation worker, using the
  **same** Firestore job collection and transaction leases as Cloud Functions.
- Google Calendar OAuth credentials and refresh-token encryption keys must be
  provided securely at runtime. Do not commit secrets.
- The server does not need an inbound public port for this worker. Calendar
  callbacks still use the existing public Firebase HTTPS API.

## Safety / important limitation

The existing deployed Firebase `reconcileCalendar` scheduled function and
`syncJob` Firestore trigger may also process the same jobs. Firestore job
leases reduce collisions but do not guarantee exactly-once external Calendar
operations. **Do not enable the School 21 worker in production until you have
disabled the Firebase scheduled reconciler and verified a single scheduler
owner.** Keep the `syncJob` trigger during initial testing only, and audit
job idempotency before using two execution environments concurrently.

No production changes are performed by these files.

## Local test with emulators

First start the Firebase emulators in a separate terminal. Then run:

```powershell
$env:FIREBASE_PROJECT_ID="demo-blind-spot-interval"
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
$env:ALLOW_FIREBASE_EMULATOR="true"
$env:ENABLE_SERVER_RECONCILIATION="true"
npm run server:worker
```

Stop the existing `npm run firebase:worker` process first to avoid duplicate
local reconcilers. This worker uses Application Default Credentials, which
may need local setup; emulators should be tested without production secrets.

## Production prerequisites

1. Confirm Linux or Windows, Node 24 support or Docker availability.
2. Confirm outbound HTTPS access to Google APIs and Firebase/Firestore.
3. Obtain a dedicated, least-privilege service identity and configure
   Application Default Credentials securely. Do not put a JSON key in Git.
4. Set `FIREBASE_PROJECT_ID=blind-spot-interval`,
   `ENABLE_SERVER_RECONCILIATION=true`, and required Google OAuth secrets
   through the server's secret manager or protected environment.
5. Ensure `FIRESTORE_EMULATOR_HOST` is **unset** in production.
6. Configure a supervisor (systemd, Docker restart policy, or platform equivalent)
   and health monitoring once server capabilities are confirmed.
7. Disable the existing Firebase scheduled reconciler **before** enabling the
   server scheduler. Test retries, lease recovery, shutdown and Calendar sync.

The Dockerfile is an optional packaging starting point; it has not been built
or tested on the School 21 server. Do not deploy without validation.
