> Historical PostgreSQL implementation documentation. The active Firebase migration is documented in [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and [FIREBASE_ARCHITECTURE.md](FIREBASE_ARCHITECTURE.md).

# Local configuration and deployment

## Google OAuth setup

1. Create/select a Google Cloud project and enable Google Calendar API.
2. Configure Google Auth Platform branding, consent audience and test users. During testing, explicitly allow each test account. Configure only the scopes used below. Publication/verification is a separate Google dashboard process.
3. Create an OAuth **Web application** client. For development register these exact redirect URIs:
   - `http://localhost:3001/api/v1/auth/google/callback`
   - `http://localhost:3001/api/v1/calendar/callback`
4. Copy client ID and client secret into your private `.env` or deployment secret manager. Do not send secret values in chat. Set `TOKEN_ENCRYPTION_KEY` to the output of `openssl rand -hex 32` and preserve it securely across deployments.
5. For production use a single public HTTPS origin, set both APP_ORIGIN and API_ORIGIN to it, and register the same two callback paths under that origin in Google. No trailing slash on origin values. The frontend reverse-proxies `/api` to the API.
6. Login requests only `openid email profile`. The optional Calendar connection requests `https://www.googleapis.com/auth/calendar.app.created` and `https://www.googleapis.com/auth/calendar.events.freebusy`. Verify the final grant and consent text with a test account. No broad Calendar scope is intentionally requested.
7. To receive pushes, set WEBHOOK_ORIGIN to the publicly reachable HTTPS API origin. Endpoint: `/api/v1/webhooks/google-calendar`. The worker creates and renews token-validated watch channels. Polling reconciliation works without this value.
8. Outbound network access needs `accounts.google.com`, `oauth2.googleapis.com`, and `www.googleapis.com` in addition to package registries. Google's user-facing consent page opens in the user's browser.

## Environment variables

| Name                 | Required for                        | Notes                                           |
| -------------------- | ----------------------------------- | ----------------------------------------------- |
| DATABASE_URL         | API, worker, migrations, tests      | PostgreSQL connection string, TLS in production |
| APP_ORIGIN           | Browser redirects and CSRF          | Exact frontend origin; default local 5173       |
| API_ORIGIN           | OAuth redirects                     | Exact callback origin; default local 3001       |
| GOOGLE_CLIENT_ID     | Interactive sign-in                 | OAuth web client ID                             |
| GOOGLE_CLIENT_SECRET | Google token exchange               | Secret manager / private env only               |
| TOKEN_ENCRYPTION_KEY | Calendar consent and refresh grants | 64 hex characters, stable, back up securely     |
| WEBHOOK_ORIGIN       | Optional push sync                  | Public HTTPS origin; polling is fallback        |
| NODE_ENV             | Production                          | Set production for Secure cookies               |
| PORT                 | API listener                        | Default 3001                                    |
| POSTGRES_PASSWORD    | Production Compose DB               | Choose securely; match DATABASE_URL             |

Local defaults in `.env.example` are for development only. For production Compose DATABASE_URL must address `db:5432`, not localhost, and use the configured password.

## Production steps

1. Provision a managed PostgreSQL database or persistent Compose volume. Configure encrypted backups, private connectivity and a least-privilege application role. Use verified TLS for managed DB connections.
2. Configure secrets and origins. Never put real credentials in image layers, Git or `.env.example`.
3. Run `npm ci`, `npm run lint`, `npm test`, `npm run build` and browser tests against a disposable test DB.
4. Build the API/worker runtime target and the static-web target from Dockerfile. Runtime currently retains build dependencies for reproducible TypeScript execution; a slim compiled runtime is a later optimization.
5. Run versioned migrations once before rolling out code. Example using production Compose:

   ```sh
   docker compose -f compose.production.yaml up -d db
   docker compose -f compose.production.yaml build
   docker compose -f compose.production.yaml run --rm api npm run db:migrate
   docker compose -f compose.production.yaml up -d api worker web
   ```

6. Terminate HTTPS in your ingress/reverse proxy and forward to the web service. Local Compose port 8080 is bound to loopback for the ingress. Do not expose PostgreSQL. Enable HSTS at the HTTPS ingress. Secure cookies require HTTPS.
7. Probe `/health` through the API/ingress, verify assets and sign-in, then run the live acceptance below. `/health` proves DB connectivity, not Google sync or worker readiness.
8. Collect Fastify JSON logs and worker errors; monitor pending/failed sync_jobs, connection errors, stale last_sync_at and database capacity. No external monitoring vendor is configured automatically.
9. Back up PostgreSQL and the encryption key separately, test restore, and perform expand/contract migrations for future rolling releases. Never rotate away the only key without re-encrypting existing grants or deliberately requiring reconnection.

## Live acceptance before production

- Login/logout/returning login; verify nonce/state rejection and Secure HTTP-only cookie behavior over HTTPS.
- Connect Calendar separately, confirm exact scopes and refresh grant, reuse the calendar on reconnect.
- Create a topic, inspect ordered materials and review URL in its real Google event.
- Move from app, move from Google, edit materials, complete review, archive/restore, delete event and observe bounded recreation.
- Verify free/busy uses the primary calendar and respects full duration. Test a fully busy tomorrow.
- Verify incremental sync, temporary Google failures, expired access token, watch delivery/renewal, resync and disconnect.
- Test iPhone Safari and Android Chrome on actual devices; Chromium mobile emulation is not a substitute for native browser verification.

These operations require real credentials and have not been verified live by the local mocked transport tests. No deployment is performed by saving files or environment draft instructions.
