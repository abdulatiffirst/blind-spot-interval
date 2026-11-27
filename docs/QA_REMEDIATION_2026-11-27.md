# Blind Spot Interval QA remediation

November 27, 2026. Reviewed against `main` at `0828a05` on `fix/qa-remediation-review-materials`. The production Hosting build reported `dc11adf` during the read-only checks. There were no open pull requests at the start.

## Implementation

- Reviews show the topic’s existing ordered materials above the five recall ratings. The shared renderer preserves notes, line breaks, Cyrillic and mathematical symbols. It supports plain HTTP(S) URLs and Markdown-style labeled links, renders markup as text and opens resource links in a new tab.
- The review URL retains the topic and selected schedule across refresh. A stale schedule cannot turn into a rating for the next review. The application reloads owner-scoped topic data when opening a review, so materials reflect saved edits. Long materials scroll within the dialog and the rating controls stay reachable.
- Firebase Hosting serves crawler assets from the Vite build. In production, both crawler URLs returned the same SHA-256 as the landing page HTML. The assets were absent from `apps/web/public`, so both requests fell through to the SPA rewrite.
- The landing demo shows a local note and an educational link. It explains that an external assistant is optional, runs in the user’s chosen provider and can be limited or revoked in Settings.
- Topic details, the existing scheduling engine, the completion transaction, Calendar processing and Connect authorization already had working entry points. Regression coverage exercises those paths with the new review experience. No runtime dependencies, AI inference, data migration or environment variables are required.

## Remediation matrix

| Finding | Original status | Investigation result | Action taken | Tests | Final status |
| --- | --- | --- | --- | --- | --- |
| BSI-001 crawler files | Reported HTML for both routes | Reproduced identical HTML and `text/html`. Public pages are `/`, `/privacy`, `/terms` and `/support` | Add static robots and sitemap files | Firebase Hosting MIME, body, canonical URLs and routing smoke tests | FIXED in the tested build |
| Materials during reviews | Student could only see the ratings | Existing owner-scoped data reached a collapsed “Show notes” section | Show materials by default, keep links safe, retain the selected review across refresh | NPV browser flow, URL and formatting units | FIXED |
| BSI-RISK-001 OAuth and MCP | Unverified client authentication concern | Advertised public and confidential methods match registration and token validation | Preserve existing methods, permissions and approval defaults | Enabled Connect OAuth and protocol suites | VERIFIED WORKING in emulators |
| BSI-RISK-002 security headers | Root missing CSP, Permissions-Policy and framing protection | Connect consent already had enforced framing protection and no-referrer | Add report-only CSP, restrict unused device permissions and deny framing on the public shell | Hosting smoke checks and Connect consent browser flow | PARTIALLY VERIFIED |
| Authentication | Production account unavailable | Emulator Google credentials, protected reads, session restoration, timeout, sign-out and retry paths are covered | Preserve the existing auth flow | Auth API and browser suites | REQUIRES MANUAL TESTING for real Google popup and account selection |
| Account isolation | Unverified | Rules and owner-scoped APIs deny cross-account access | Expand rules checks for materials, reviews, preferences and Calendar mappings | Auth, two-identity Firestore rules and Connect isolation | VERIFIED WORKING in emulators |
| Topic management and scheduling | Unverified | Preview, manual conflict handling, low-rating recovery and state transitions are covered | Protect selected schedule on refresh and add web–MCP completion concurrency coverage | Scheduler units, Firebase API, browser and Connect tests | VERIFIED WORKING in emulators |
| Google Calendar | Unverified | Durable jobs retry, reconcile and preserve Firestore-backed reviews. Sync tests use synthetic Google responses | Preserve optional integration and existing worker | Calendar integration and workspace error-state tests | REQUIRES MANUAL TESTING for provider consent and Calendar delivery |
| MCP study materials | Unverified | `get_topic` already serves ordered notes and URLs under `topics:read`. Due-review results provide the topic ID | Document the existing read flow and test material availability | Scoped Connect reads and SDK integration tests | VERIFIED WORKING in emulators |
| Mobile responsiveness | Untested | Long materials could force ratings out of the initial viewport | Keep a bounded materials pane that shrinks before the rating controls | Review at 320, 390, 430, 768, 1366 and 1920 px | FIXED for the review |
| Accessibility | Untested | Scrollable notes require a keyboard entry point | Add a named, focusable materials region and retain dialog focus handling | Browser keyboard link activation, dialog and rating checks | PARTIALLY VERIFIED |
| English and Russian | Existing localization | Both use the existing materials label and carry account language across reload | Translate landing demo and assistant copy | Locale units and browser tests | VERIFIED WORKING for changed screens |
| Performance | Untested in the audit | Materials use the existing topic-details response. Rendering introduces no resource prefetches | Compare built landing and initial assets, exercise offline completion retry | Local browser timings, Vite build and review regression | PARTIALLY VERIFIED |

## Important files

| File | Purpose |
| --- | --- |
| `apps/web/src/main.tsx`, `views/Today.tsx` | Review session selection, reload and completion, with materials visible |
| `apps/web/src/components.tsx`, `material-links.ts`, `ui.tsx`, `style.css` | Shared material rendering, safe links and review layout |
| `apps/web/src/views/Landing.tsx`, `i18n/locales/{en,ru}.json` | Local demo and optional external assistant explanation |
| `apps/web/public/{robots.txt,sitemap.xml}`, `firebase.json` | Crawler assets and Hosting headers |
| `tests/material-links.test.ts`, `tests/firebase-e2e/app.spec.ts` | Link handling and full review regression |
| `tests/firebase/{rules,connect,hosting}.test.ts` | Database isolation, concurrent completion and Hosting smoke coverage |
| `scripts/test-connect.mjs`, `.github/workflows/firebase.yaml` | Run the Hosting smoke test and retain review screenshots |

## Test report

The local stack used Node 24, Java 21, Firebase demo emulators and a disposable PostgreSQL 17 container for the repository’s legacy regression suite.

| Check | Baseline | Remediation |
| --- | --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed | Passed |
| `npm test` | 56 passed | 60 passed |
| `npm run test:firebase` and the corresponding Vitest command in the demo emulator | 46 passed, 25 Connect tests skipped | 46 passed with Connect and Hosting tests run separately under the enabled configuration |
| `npm run test:e2e` and the corresponding Playwright command in the demo emulator | 40 passed, 4 Connect tests skipped | 42 passed, 4 Connect tests skipped in the default configuration |
| `npm run test:connect` | Connect was off in the default baseline | 27 enabled OAuth, MCP and Hosting tests passed. 4 enabled Connect browser tests passed. The optional Inspector and disabled-mode browser cases were skipped in this run |
| `npm run test:legacy` | 84 passed | 88 passed |
| `npm run test:e2e:legacy` | — | 4 passed |
| Additional browser replicas | — | Firefox passed the targeted review and landing cases. WebKit was exercised with local browser dependencies |

The E2E fixture creates a real emulator NPV topic with all three requested notes and an independently checked public OpenStax resource. The external tab is intercepted during browser regression, so it exercises tab creation without making the test depend on OpenStax. Just opening the link leaves the original Firestore review pending. The suite checks persistence on reload, English and Russian, refreshed notes, manual rating and a retry after a blocked completion request. A successful submission creates one history record and one pending successor, and the finished review URL has no rating controls.

The first narrow-width review check caught a clipped rating and the layout was adjusted before the Chromium suites passed. An early branch CI run caught a regex lint error. The pattern was corrected and the branch passed lint and type checking locally.

The existing scheduler and Calendar suites cover the established next-day recovery and conflict behavior. The review concurrency regression checks one memory update and one successor when the web and MCP approve the same review simultaneously. The individual topic lifecycle is archive and restore. Permanent data deletion is supported through account deletion and covered by the existing account tests.

## Review screenshots

These captures use the disposable NPV topic except for the empty-materials example. CI can preserve raw browser captures with `REVIEW_QA_SCREENSHOTS=true`.

| Scenario | Evidence |
| --- | --- |
| Baseline, collapsed materials | [Desktop before](qa-review-evidence/desktop-before.webp) |
| English review with materials | [Desktop](qa-review-evidence/desktop-en.webp) · [Mobile](qa-review-evidence/mobile-en.webp) |
| Russian review with materials | [Mobile](qa-review-evidence/mobile-ru.webp) |
| Review without materials | [Desktop](qa-review-evidence/desktop-empty.webp) |
| Long materials and a wrapped URL | [Long notes](qa-review-evidence/mobile-long-notes.webp) · [Long URL, scrolled](qa-review-evidence/mobile-long-url.webp) |

## Local performance

A fresh Chromium page loaded each built landing three times at 390 and 1366 px over loopback. Both variants requested two initial JavaScript files and produced no failed requests or JavaScript errors. Layout shift stayed between 0 and 0.003. The initial JavaScript graph was about 194 kB gzip at baseline and 195 kB gzip with the changes. Local load times ranged from 150–428 ms at baseline and 124–223 ms afterward. These short local runs do not measure production latency. The review browser tests also assert that opening a review makes no request to its linked resource before explicit activation.

## Security verification

Hosting currently applies HSTS, nosniff and a referrer policy in production. The Connect consent and confirmation paths already deny framing. The new policy keeps its script allowlist to application assets, the theme script’s hash and Firebase Auth’s Google loader. It lists the production auth iframe and Firebase Identity Toolkit and Secure Token APIs. Google Calendar and external resource links use top-level navigation, and Calendar API calls originate on the server. The CSP is report-only pending live Google compatibility testing. Browser handling of the local emulator’s HTTP origin differs from production HTTPS. No reporting endpoint or telemetry was added.

Application and Firestore reads use the authenticated owner. The rule tests cover owner, signed-out and second-identity access to topics, materials, schedules, history, preferences, memory and Calendar mappings. Calendar credentials and Connect grants, registrations and actions are server-only. The review UI reads material strings as React text and reuses the shared HTTP(S) URL validator.

Connect registration validates exact approved callbacks and the registered authentication method. Its public and confidential flows use S256. Authorization codes expire after two minutes and are single-use. Access tokens expire after ten minutes and are bound to the MCP resource and an active user grant. Refresh handling maintains or narrows scopes. The opt-in Gemini persistent-refresh path is available to eligible confidential clients, and other clients use rotation with replay revocation. Replacement becomes effective at successful authorization-code exchange. Existing tests exercise these properties and first-party and OAuth revocation. No vulnerability was confirmed in the advertised-method finding during the emulator checks.

The SDK tests cover MCP `2025-11-25` and `2026-07-28`. The server enforces `topics:read`, `topics:write`, `reviews:read`, `reviews:write` and `reviews:history:read` by tool. The mutation transaction checks the active grant and its approval at commit. Scheduling warnings require confirmation, and fresh connections use manual approval. Use `get_due_reviews` with `reviews:read` to identify an existing review, then `get_topic` with `topics:read` to retrieve its materials. `preview_review` calculates a first review and does not access topic materials. Material content is labeled untrusted. Provider menus remain conditional on provider and account settings. See the project’s [provider publication notes](CONNECT_PROVIDER_PUBLICATION.md) for the verification and approval gates.

## Release and rollback

Hosting is the only changed deployable component. The approved Hosting build must use the existing production Firebase web configuration. There are no Functions, Firestore rule, index or migration changes to deploy. Retain the currently deployed Hosting release identifier before publishing. If rollback is needed, use Firebase Console’s Hosting release history to restore that release. That restores the matching assets and headers without changing Firestore.

After an approved release:

```sh
origin=https://blind-spot-interval.web.app
curl -fsS "$origin/build-info.json"
curl -fsSi "$origin/robots.txt"
curl -fsSi "$origin/sitemap.xml"
curl -fsSI "$origin/"
curl -fsSI "$origin/connect/authorize"
curl -fsS "$origin/.well-known/oauth-authorization-server"
curl -fsS "$origin/.well-known/oauth-protected-resource/api/mcp"
curl -sS -D - -o /dev/null "$origin/api/mcp"
curl -sS -D - -o /dev/null "$origin/.well-known/google-connected-apps"
```

- Compare the build SHA to the approved commit. Check crawler MIME types and sitemap entries, legal pages, SPA navigation and the OAuth metadata. The unauthenticated MCP endpoint should challenge with HTTP 401 when Connect is enabled.
- The Google connected-apps verification URL returned 404 before remediation. For Google publication, provide the Console challenge file through the existing Hosting path and verify exact JSON bytes and a direct 200. This is a Google publication gate.
- Use dedicated accounts to exercise real Google Sign-In, cancellation and reload, optional Calendar consent, Calendar event recovery, and authorized ChatGPT, Claude and Gemini connections. Capture CSP report-only violations on staging during these flows before considering enforcement. Validate native Safari or Edge separately if either is a release gate.
- Use a disposable NPV topic for the English/Russian review flow. Check all five ratings, the external tab and that completion creates one successor. Also check an empty topic and a topic with long materials.

Production was inspected through public read-only requests. No deployment or production data changes were made.
