# Blind Spot Connect — MCP MVP

## Goal
Expose existing Interval domain operations to authorized external AI clients without paying for model inference. Keep Firebase-only architecture and Google sign-in. Do not merge or deploy until tested.

## Architecture
Use official TypeScript MCP SDK and stateless Streamable HTTP in the existing Express Firebase Functions API (proposed /api/mcp). Verify current SDK documentation and supported MCP authorization specification before implementation. Preserve current /api/v1 authentication and Calendar OAuth flows. Do not forward AI-provider tokens or expose Firebase credentials to clients.

## Tools
- list_topics: bounded pagination/filtering via domain.listTopics
- get_topic: domain.details
- get_due_reviews: domain.reviews
- preview_review: domain.preview
- create_topic: domain.createTopic, existing validation and idempotency
- complete_review: domain.complete, explicit user-confirmed rating 1–5
- reschedule_review: domain.reschedule, explicit time with offset and conflict handling

Read actual domain schemas before implementing. Return minimal structured results; never return Google Calendar credentials, internal account metadata, or secrets. Treat notes as untrusted data. Add read-only tools first; enable writes only after authorization and confirmation tests.

## Authorization
Implement standards-compliant remote MCP OAuth with protected resource discovery, authorization server metadata, authorization code + PKCE, exact registered redirect URIs, short-lived audience-bound access tokens, revocable grants and scope enforcement (topics:read, topics:write, reviews:read, reviews:write). Authenticate account owner using existing Google/Firebase sign-in in a first-party consent flow. Do not confuse Google Calendar authorization with MCP authorization. Use a vetted OAuth implementation; fail closed if required configuration is absent. Determine registration mechanism per supported client and current specification. Derive UID only from verified grant, never tool input. Provide disconnect/revoke control. Do not enable public unauthenticated tools.

## Safety and cost
Validate every argument; bound results, requests and execution; reuse rate limiting and domain idempotency; redact sensitive logs; explicit first-party confirmation for mutations if client confirmation cannot be trusted. Keep feature disabled by default. Preserve production behavior and Firebase rules. No new paid AI provider APIs.

## Acceptance
Unit tests for schemas, tool mapping, invalid tokens, expired/revoked grants, wrong audience, scope restrictions, cross-user access and duplicate requests. Emulator integration tests for scheduling and Calendar sync behavior; no real Calendar writes in tests. Verify MCP initialize/list/call via official MCP Inspector. Run lint, typecheck, tests and build. Test each AI client independently; consumer app availability depends on platform, plan and region. Document configuration, rollback, deployment and any unverified compatibility. Do not deploy automatically.
