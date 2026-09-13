# L1 Batch A - Integrated Implementation Evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Scope: authorized first implementation batch after the L0 documentation plan.

## Delivered scope

| Slice | Implemented result | Detail |
| --- | --- | --- |
| L1-01 | Disposable test children, explicit PostgreSQL opt-in, run-owned cleanup and pre-mutation E2E target verification | [Harness evidence](L1-01.md) |
| L1-02 | Tenant-scoped callbacks/workers, owner authorization, production-disabled simulations, session-derived reviewer and sequence preflight | [Boundary evidence](L1-02.md) |
| L1-09 | Exact evidence selection/attribution, default/configured safety parity, deterministic recommendations/plans and neutral customer copy | [AI evidence](L1-09.md) |
| Integration correction | Shared customer-message subject/body rules at provider dispatch and conversation persistence; internal reasons never become customer-copy fallbacks | src/modules/outbound-automation/renderedMessage.js; test/rendered-message.test.js |
| React compatibility | Simulation visibility follows server capability; AI settings describe current bounded behavior | Auth hook, Conversations, Outbound and Settings |

The integrating owner controlled API/configuration, callback/worker/approval contracts, package/CI integration and shared docs. Separate agents owned harnesses, AI behavior, and independent boundary/frontend review. Work stayed in the modular monolith.

## Verified final tree

| Check | Result | Limits |
| --- | --- | --- |
| npm.cmd run ci | Passed: 138 JavaScript syntax checks; formatting; 274 tests total, 270 pass, four PostgreSQL-only skips | Syntax is not semantic lint/security audit; backend suite uses sanitized SQLite |
| node scripts/smoke-api.js | Passed | Owned temporary SQLite file; synthetic providers |
| HTTP workflow verifier | 57/57 passed on final code | Fresh owned memory server; capability verified before writes; no real send; child stopped afterward |
| React TypeScript and Vite build | Passed | Direct Node invocation in client/; no browser interaction |
| Provider/conversation copy parity | 24/24 related tests passed, including four dedicated payload/edit/fallback cases | Injected provider double, no external network calls |
| Independent review | Tenant boundaries and reported AI bypasses rechecked; discovered issues corrected | Bounded source review and synthetic reproductions |
| Documentation | Links, task references, dependency consistency and final formatting checked separately | Current docs distinguish implementation, proposals and unperformed QA |

The final frontend bundle has Vite's size advisory (about 842 kB minified / 237 kB gzip). Performance/browser acceptance remains open.

## Contract and behavior changes

- No database migration, schema, dependency version, cloud resource or real provider account changed.
- npm test now always uses a sanitized SQLite child; test:pg is the explicit PostgreSQL entry point with TEST_DATABASE_DISPOSABLE=1.
- Synthetic HTTP routes are unavailable by default and always unavailable in staging/production. This is intentional compatibility tightening.
- Callback service receives required organization context. Worker HTTP scope comes from the session. Approval actor comes from the session and audit metadata.
- GET /api/auth/me includes capabilities.test_controls; isolated E2E health includes its narrowly validated test_harness marker.
- All synthesis/recommendation/planner pipeline versions increased. Planner receives trusted lead/snapshot context. Existing JSON columns persist bounded-generation provenance; historical outputs remain history.
- Free-form model recommendation/planning calls are held in deterministic safety mode. Source quotes establish what the record says, not whether it is true. Broader business intelligence remains L2/L3.
- Adapter copy and conversation body/subject use the same renderer. Legacy edited_payload.instruction and edited_payload.message are supported before the original message. Immutable approved envelopes remain L1-08.

## Open acceptance and risks

The code and local automated slice are delivered. L1-01/L1-02/L1-09 remain partially open in TASKS because required human and/or external evidence is still pending; the L1 milestone and all customer/pilot gates remain open.

- Local Docker exists but its daemon was unavailable. No live PostgreSQL, concurrent PG-run cleanup, PG abort, migration/restore or production TLS proof was substituted with SQLite results.
- No real LLM/provider calls, customer data, campaigns, deployment, paid account changes or cloud operations occurred.
- Human/browser QA remains pending, including simulation visibility, two-workspace operator walkthrough, exact evidence drilldown and fallback clarity.
- Old queued/approved drafts are not rewritten or revoked by pipeline version changes. Contact suppression, atomic claims, due-time enforcement, immutable approval, durable callbacks and production operations remain launch blockers.
- Neutral drafts do not complete the reply/composer experience or establish customer usefulness. Unknown action capability and human-task completion remain later tasks.

## Next implementation

L1-03: define and review the smallest transaction-scoped repository contract, add immutable forward migrations/upgrade evidence, and remove runtime/readiness DDL requirements. Then L1-04 contact restrictions and L1-08 reviewed revisions can establish inputs for atomic execution.

Update relevant docs and verification evidence in each implementation slice. Complete the pending human and disposable-PostgreSQL checks before marking their tasks complete.
