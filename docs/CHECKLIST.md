# Milestones

- [x] M1 Monorepo, Fastify, Google OIDC implementation, secure server-side sessions.
- [x] M2 PostgreSQL schema, transactional SQL migrations, topic CRUD and authorization.
- [x] M3 API-connected topic UI, tags and ordered materials editor.
- [x] M4 Current ts-fsrs v6 / FSRS-7 review workflow, idempotency and audited correction.
- [x] M5 Independent timezone-aware availability scheduler and manual overrides.
- [x] M6 Separate Calendar consent, durable outbox, event synchronization, polling/watches and bounded deletion recovery implementation.
- [x] M7 Preferences, onboarding, light/dark themes, responsive views and keyboard dialogs.
- [x] M8 Unit, database, protocol, worker and desktop/mobile Chromium tests.
- [x] M9 CSRF, state/nonce/PKCE, ownership checks, token encryption, safe URLs, dependency audit and reverse-proxy security configuration.
- [x] M10 Docker/CI/deployment configuration and operating documentation.

## External acceptance still pending

- [ ] Configure a real Google OAuth client and test account securely.
- [ ] Verify real sign-in, Calendar scope/refresh grants, event synchronization and public HTTPS watch delivery.
- [ ] Verify deployment images and HTTPS deployment in the target infrastructure.
- [ ] Run native iPhone Safari and Android browser checks.
- [ ] Review/save and publish the environment configuration, then independently test restoration in a new task.

These unchecked items prevent a claim of full production acceptance. Mocked Google transport/JWT tests are explicitly distinct from live verification.
