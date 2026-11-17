# Firebase implementation progress

- [x] Audit existing API/schema/algorithms/UI and record the original 54-test baseline.
- [x] Incorporate the user's Firebase scaffold from main, preserving the real alias and EU database settings.
- [x] Add scheduler regression tests before fixes and retain FSRS-7.
- [x] Implement Firestore ownership model, secure rules, query/TTL definitions and transaction boundaries.
- [x] Implement authenticated Functions v2 topic/preferences/review/scheduling API and exact-once completion.
- [x] Port separate offline Calendar OAuth, encryption, two-way event synchronization, leases/retries, reconciliation and watches.
- [x] Integrate Firebase Authentication/bearer transport with existing real-data screens and themes.
- [x] Configure explicit demo emulators, Hosting, source bundling, workspace/standalone locks and CI.
- [x] Add dry-run/read-only/create-only migration tooling without production writes.
- [x] Run strict types, lint, production build, 64 legacy/regression tests, 29 Firebase emulator tests and four Firebase browser tests.
- [x] Verify headless startup, independent runtime artifact, Hosting rewrites/Calendar cookie and delayed local retries.
- [x] Audit production dependencies and pin patched gRPC transport; final audit reports zero known vulnerabilities.
- [x] Document exact startup, project settings, credentials, migration limits and deployment preparation.

## External acceptance remains pending

- [ ] Allow the optional Emulator UI download (`storage.googleapis.com`) and browser popup bootstrap (`apis.google.com`) where needed in this cloud.
- [ ] Configure/reuse real Google Calendar credentials and stable encryption key securely; verify live consent, offline refresh, two-way changes and watch delivery.
- [ ] Verify real Firebase Google popup login with the project's public web config and authorized domains.
- [ ] Obtain explicit deployment/production-migration approval before any cloud changes; verify staging, permissions, backups, scheduler/TTL and capacity.
- [ ] Check native iPhone Safari and Android browsers.
- [ ] Independently verify a newly restored Cloud task if publishing an environment snapshot.

All executed automated suites pass. Emulator Google credentials and mocked Calendar tests are distinct from live Google verification. Production has not been deployed or modified.
