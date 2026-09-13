# Contributor Handoff

## Identity and authority

The product is **AI Lead Intelligence & Outbound Automation**. Relay is an existing working brand, not another product category. Lead Intelligence is core; Outbound Automation executes its decisions; Lead Discovery is optional.

Follow [AGENTS.md](AGENTS.md). Read PRODUCT, ARCHITECTURE, DOMAIN, ROADMAP, TASKS and TESTING before work; consult DECISIONS/DEPLOYMENT for affected design and operations.

Current delivery is L0-L6 in [ROADMAP](docs/ROADMAP.md), with status in [TASKS](docs/TASKS.md). Earlier phases/checklists remain in [history](docs/history/MILESTONES.md). docs/status.html is not authoritative.

## Current implementation

- Node.js 24+ ESM modular monolith; HTTP API in src/api/app.js.
- React/TypeScript/Vite in client/; server serves client/dist. public/ is retired UI but still referenced by legacy tests.
- SQLite for fast local work; async pg adapter for PostgreSQL.
- Ordered migrations in src/database/migrations/index.js and src/database/migrate.js. Schema is not inline in database.js.
- Repository/service boundaries exist; API also contains raw SQL/integration logic. Complete separation is a target.
- Optional LLM agents are wired in createServices; deterministic fallbacks exist. Process-wide configuration and provenance need planned controls.
- Channel adapters and auth exist, with unfinished live verification and unsafe mutations in [REVIEW](docs/REVIEW.md).

Never claim duplicate requests cannot duplicate effects or complete tenant isolation before the regression gates prove it.

## Commands and hazards

Use [README](README.md), [TESTING](docs/TESTING.md) and [DEPLOYMENT](docs/DEPLOYMENT.md).

Common local checks: npm.cmd run ci, npm.cmd run smoke, npm.cmd run client:build. A direct-node Windows frontend build fallback is documented.

npm start reads .env; DATABASE_URL overrides DATABASE_FILE. npm test now uses scripts/run-tests.js to launch isolated SQLite tests. test:pg requires TEST_DATABASE_URL plus TEST_DATABASE_DISPOSABLE=1 and uses a random run namespace; no application DB fallback. dev:e2e refuses inherited DB/provider settings and creates only in-memory SQLite. verify:workflows requires that isolated loopback harness before mutation. verify:deploy/db:status/readiness inspect without DDL. Normal startup requires existing compatible migrations; use db:migrate deliberately. Staging/production migration commands require MIGRATION_DATABASE_URL in a separate job, never the web runtime. Only the isolated E2E memory harness bootstraps on server start.

## Contracts

- Application owns domain policy; React, n8n and providers cannot bypass it.
- Tenant and actor identity are server-derived. OWNER is the only current HTTP write/settings/approval role; additional roles require L5-02. Simulation routes default off and cannot be enabled in staging/production. GET /api/auth/me reports capabilities.test_controls for UI gating; it does not grant server authority.
- Retry identity belongs to one intended action; a genuine new message needs a new identity.
- Durable restrictions, immutable exact review, fenced leases, action due checks, bounded retries, exact callbacks and owner recovery are implemented locally. L1-07 adds durable receipts and bounded callback/inbound effect replay. L1-06 adds fair normal scheduling, staged bounded domain-event recovery, owner sequence controls, delivery-gated advancement and explicit due-task transitions. All canonical replies stop existing sequences; new stop_on_reply=false inputs are rejected. See docs/verification/L1-06.md; PostgreSQL/provider/browser acceptance remains pending.
- PostgreSQL-specific operational persistence belongs behind an explicit tested boundary and ADR; don't force unsafe behavior to preserve identical SQL.
- Use immutable additive migrations. No DB transaction across a network call. L1-03 adds createUnitOfWork and distinct transactionBound clients; all participating repositories use the same scoped handle. Parent escapes/nested or expired scope use reject. Approval, settings, restrictions, dispatch and inbox processing use a shared workspace gate; full import atomicity remains tracked. Pending receipt policy defers workspace sends without consuming attempts; no owner decision can waive an unresolved restriction. Permanently invalid pending-policy events need operator remediation before customer readiness.
- L1-10 adds verified database TLS, strict bounded configuration, separate deployed migration credentials, canonical PUBLIC_APP_ORIGIN and AUTH_RATE_LIMIT_SECRET. HTTP/auth/provider work is bounded; routine logs omit private payload/exception data. Typed workspace_dispatch_controls in migration0008 provides owner revisioned pause/limits; deployed OUTBOUND_DISPATCH_ENABLED defaults false. All SEND authorization checks occur under the workspace transaction and use one UTC authorization timestamp. Socket close does not complete handler work; shutdown drains both before database close. See docs/verification/L1-10.md.
- Require real-provider evidence and human QA for customer/pilot gates. L2-01 now implements append-only business/enquiry revisions, owner forms/history, exact money/manual source facts and current-analysis/review binding. See docs/L2-01_BUSINESS_CONTEXT.md and docs/verification/L2-01.md. Never score business fit from stored criteria or treat inferred/conflicted/unknown values as customer facts. L2-02 now adds mapped/reviewed CSV, raw cells, audited row corrections, frozen selected chunks, durable outcomes and exact IMPORT_ROW provenance. See docs/L2-02_REVIEWED_IMPORT.md and docs/verification/L2-02.md. Never replay ambiguous unfinished legacy batches or clear restrictions on import. L2-03 now implements owner-reviewed source-only linking or separate enquiry creation, with an immutable resolution ledger and unchanged original import outcomes. See docs/L2-03_IDENTITY_RESOLUTION.md and docs/verification/L2-03.md. Exact sources and restrictions survive; shared-contact ambiguous replies stop directly matched automation and remain unassigned for recovery. Next is L2-04 contact correction/archive/export and complete data work; external L1-L2 acceptance stays open.

The requested interactive landing page is specified in docs/LANDING_PAGE.md, with L4-07 prototype, L5-07 production funnel and L6-04 publication. Current auth-gated React routing is unchanged; do not claim the proposed public/auth/app routes or CTA endpoints exist.

## Parallel work and docs

Assign concrete file ownership first. One integrating owner controls shared API wiring, global contracts/configuration, migration registry and package scripts per batch. Agents request shared changes rather than editing overlapping files.

Update TASKS at start; update affected product/domain/architecture/testing/deployment docs alongside implementation. Record actual commands/environment and human QA state. Handoffs report Completed, Files Changed, Contracts Changed, Tests, Known Issues, Human QA and Next Step.

A documentation task does not imply production deployment, real sends or customer-data mutation.
