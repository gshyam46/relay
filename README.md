# AI Lead Intelligence & Outbound Automation

Modular monolith for the AI Lead Intelligence & Outbound Automation product.

## Current Milestone

M6/M7 foundation slice - channel workflow and inbound response foundation.

The current customer-facing product supports the M0 walking skeleton, the M1 Lead Data Foundation flow, the M2.0 AI Lead Intelligence foundation, the M2.1 research evidence adapter boundary, the M2.2 structured synthesis foundation, M2.3 recommendation intelligence, M3 next-best-action planning, M5 human review over prepared outbound actions, and a provider-neutral channel/follow-up/sequence foundation:

```text
Customer-owned CSV -> CSV Adapter -> Ingestion Layer
  -> Lead Data Foundation -> Lead -> Evidence
  -> Intelligence Snapshot -> Qualification Foundation
  -> Recommended Next Step

Approved research note -> Research Evidence Adapter
  -> Normalized Research Evidence -> Persisted Evidence Staging
  -> Structured Lead Intelligence Synthesis
  -> Qualification Foundation
  -> Evidence-Grounded Recommendation Intelligence
  -> Policy-Checked Next Best Action Plan
  -> Human Review
  -> Approval Decision
  -> Outbound Execution Foundation
  -> Channel Message
  -> Inbound Event
  -> Follow-up State
  -> Sequence Workflow State
```

The codebase contains a sandbox outbound execution foundation for engineering validation. The current channel/workflow foundation records mock outbound channel activity, normalized mock inbound events, persisted follow-up tasks, campaigns, sequences, sequence steps, and workflow runs. It still does not add real email, WhatsApp, SMS, CRM, voice providers, production n8n workflows, bulk outbound sending, autonomous bots, or real message generation.

## Run Locally

Requirements:

- Node.js 24 or newer

Install dependencies:

```powershell
npm.cmd ci
```

Start the app:

```powershell
node src/server.js
```

Then open:

```text
http://localhost:3000
```

The local database is stored at `data/app.db` by default.

Run an isolated API smoke check without touching `data/app.db`:

```powershell
npm.cmd run smoke
```

Reset local development data with an automatic backup:

```powershell
npm.cmd run dev:reset
```

The reset command moves the existing local database into `data/backups/` and creates a clean `data/app.db`. Stop the local server before resetting so SQLite can release the file.

Seed deliberate M2.0 human-QA data into an empty local database:

```powershell
npm.cmd run dev:seed:qa
```

The QA seed refuses to run against a non-empty database unless `--allow-nonempty` is passed intentionally.

If port `3000` is already in use:

```powershell
$env:PORT = "3001"
node src/server.js
```

## Development Commands

```powershell
npm.cmd run lint
npm.cmd run format:check
npm.cmd run smoke
npm.cmd test
npm.cmd run ci
npm.cmd run dev:reset
npm.cmd run dev:seed:qa
```

## Configuration

- `PORT`: HTTP server port. Defaults to `3000`.
- `DATABASE_FILE`: SQLite database file. Defaults to `data/app.db`.

## M2.0 Scope

M2.0 establishes the foundation for AI Lead Intelligence without external research, enrichment, or LLM calls.

It supports:

- deterministic intelligence generation from existing lead data
- explicit separation of lead status, intelligence status, data readiness, recommendation, and outbound state
- versioned intelligence snapshots
- persisted evidence, claims, signals, qualification foundation, and recommendations
- data readiness scoring based on stored customer-owned data
- evidence provenance for manual and CSV-imported leads
- idempotent intelligence reruns for the same lead data version
- snapshot history when lead data changes
- organization-scoped intelligence APIs
- a minimal Intelligence UI showing customer-provided information, data readiness, evidence, signals, qualification foundation, and recommended next step

The current readiness value is a deterministic data-quality score. Customer-facing UI treats it as `Data readiness`, not as an AI lead score, qualification score, conversion probability, or business-priority score. M2.0 does not verify customer-provided facts externally.

M2.0 recommendations are conservative. Email or phone presence is treated as a data signal, not as enough reason to recommend automatic outreach. Real outbound providers are not implemented; M0 mock executions remain available only through Developer / Test Controls.

M2.0 APIs:

- `GET /api/leads/:id/intelligence?organization_id=...`
- `POST /api/leads/:id/intelligence/run`
- `GET /api/leads/:id/intelligence/history?organization_id=...`

M2.0 explicitly does not implement web research, scraping, Google Search, Apollo, CRM enrichment, LLM calls, discovery, real outbound providers, sequencing, or automatic entity resolution.

The intelligence status model is:

- `NOT_RUN`: the lead has not been analyzed yet.
- `READY_TO_RUN`: the lead has enough data to run intelligence.
- `GENERATED`: a persisted intelligence snapshot exists.
- `NEEDS_DATA`: more customer-owned data is needed.
- `FAILED`: the last intelligence run failed and can be retried.

## M2.1 Scope

M2.1 establishes the research/evidence adapter boundary. It does not call external providers yet.

It supports:

- normalized research evidence contracts
- an approved local/manual research adapter for contract validation
- persisted research evidence ingestion records
- persisted staged research evidence items
- ingestion idempotency
- failure and retry state
- organization-scoped research evidence APIs
- audit records for successful evidence ingestion

M2.1 evidence is staged separately from intelligence snapshots. Adapters can produce normalized evidence, but they cannot directly mutate snapshots, claims, signals, recommendations, or outbound state.

M2.1 APIs:

- `POST /api/leads/:id/research-evidence`
- `GET /api/leads/:id/research-evidence?organization_id=...`

M2.1 explicitly does not implement web research, scraping, search APIs, enrichment APIs, LLM calls, discovery, real provider credentials, real outbound providers, or automatic fact synthesis.

## M2.2 Scope

M2.2 establishes a structured, evidence-grounded synthesis and qualification foundation. The current implementation uses a deterministic local synthesis agent to validate the future LLM output contract without introducing external provider calls.

It supports:

- structured synthesis output contracts
- evidence-grounded findings
- qualification outcomes based on persisted evidence
- persisted synthesis runs
- idempotent synthesis reruns for the same snapshot and staged evidence
- failure and retry state
- synthesis history
- organization-scoped synthesis APIs
- audit records for successful synthesis generation

M2.2 synthesis requires a current ready Lead Intelligence snapshot. It can also consume approved research evidence staged by M2.1. Every finding, qualification, and recommendation must reference persisted snapshot evidence or staged research evidence.

M2.2 APIs:

- `GET /api/leads/:id/synthesis?organization_id=...`
- `POST /api/leads/:id/synthesis/run`
- `GET /api/leads/:id/synthesis/history?organization_id=...`

M2.2 explicitly does not implement real LLM provider calls, web research, scraping, search APIs, enrichment APIs, discovery, real outbound providers, segmentation, personalization, or real next-best-action planning.

## M2.3 Scope

M2.3 turns current synthesis into evidence-grounded recommendation intelligence. It is still part of AI Lead Intelligence, not M3 action planning.

It supports:

- intelligence recommendation output contracts
- attention priority scoring from actual evidence
- lightweight lead segmentation from synthesis/readiness/duplicate evidence
- personalization context from evidence-backed lead facts
- persisted recommendation runs
- idempotent recommendation reruns for the same synthesis
- failure and retry state
- recommendation history
- organization-scoped recommendation APIs
- a minimal Intelligence UI panel for review

M2.3 APIs:

- `GET /api/leads/:id/intelligence-recommendation?organization_id=...`
- `POST /api/leads/:id/intelligence-recommendation/run`
- `GET /api/leads/:id/intelligence-recommendation/history?organization_id=...`

M2.3 explicitly does not create actions, execute outbound activity, implement policy approval, send messages, call real providers, or start M3.

## M3 Scope

M3 turns recommendation intelligence into a persisted, policy-checked next-best-action plan.

It supports:

- a NextBestAction plan contract
- an action planner that consumes current M2.3 recommendation intelligence
- a policy engine for contact eligibility and approval requirements
- explicit plan states: `DRAFT`, `PLANNED`, `BLOCKED`, `SUPERSEDED`, `FAILED`
- decision evidence references
- idempotent planning for unchanged recommendation inputs
- retry after failed planning
- organization-scoped planning APIs
- a minimal Outbound UI panel showing the recommended action, policy decision, approval requirement, evidence count, and planning boundary

M3 APIs:

- `GET /api/leads/:id/next-best-action?organization_id=...`
- `POST /api/leads/:id/next-best-action/plan`
- `GET /api/leads/:id/next-best-action/history?organization_id=...`

M3 explicitly does not execute outbound actions, send messages, create provider work, call n8n, implement approval queues, or start M4/M5. Plans are stored separately from the M0 executable `actions` table so recommendation planning cannot accidentally trigger outbound execution.

## M4 Scope

M4 turns eligible next-best-action plans into persisted outbound actions and executes eligible actions through the mock handler/n8n boundary.

It supports:

- preparing an outbound action from a current M3 next-best-action plan
- preserving the plan/action link
- approval-gated action state with `AWAITING_APPROVAL`
- sandbox execution through the existing mock n8n adapter boundary
- persisted execution attempts
- retryable and non-retryable execution failure handling
- idempotent repeated execution requests for in-progress or completed actions
- organization-scoped outbound activity APIs
- scoped callback handling
- callback idempotency and callback history
- Activity and Outbound UI visibility for action, approval, execution, and callback state

M4 APIs:

- `GET /api/leads/:id/outbound?organization_id=...`
- `POST /api/next-best-action-plans/:id/action`
- `POST /api/actions/:id/execute`
- `POST /api/actions/:id/callback`

M4 still uses sandbox/mock execution. It does not implement real email, WhatsApp, SMS, CRM providers, production n8n workflows, message generation, approval queues, approve/reject/edit workflow, campaigns, sequences, or follow-up automation.

## M5 Scope

M5 makes human review a first-class persisted workflow before approval-required outbound actions can proceed.

It supports:

- creating a pending approval request for approval-required actions
- listing organization-scoped approval requests
- approving an action
- rejecting an action
- editing review instructions while approving
- persisting reviewer note, reviewer name, decision timestamp, and edited payload
- idempotent repeated approval decisions
- blocking execution when an approval is rejected
- allowing sandbox execution after approval
- showing approval state in the Outbound UI

M5 APIs:

- `GET /api/approvals?organization_id=...`
- `GET /api/approvals?organization_id=...&status=PENDING`
- `GET /api/actions/:id/approval?organization_id=...`
- `POST /api/actions/:id/approval/approve`
- `POST /api/actions/:id/approval/edit-and-approve`
- `POST /api/actions/:id/approval/reject`

M5 does not implement authentication, multi-user permissions, approval assignment, real message editing, real provider sending, production n8n workflows, campaigns, sequences, follow-up automation, or bulk outbound.

## M6/M7 Foundation Slice

This slice establishes consistent inbound/outbound channel, follow-up, and sequence state before real connectors are added.

It supports:

- provider-neutral channel vocabulary for email, WhatsApp, SMS, voice, human task, and CRM
- campaign, sequence, and sequence-step persistence
- idempotent lead enrollment into a sequence
- multi-lead sequence enrollment through the API
- due workflow runner for active/waiting sequence runs
- wait steps
- approval-gated sequence steps
- continuation after approval
- response-driven stop conditions
- persisted `ChannelMessage` records for outbound and inbound activity
- persisted normalized `InboundEvent` records through a mock channel API
- idempotent inbound event processing by provider event id
- planned no-response follow-ups after completed outbound email/WhatsApp sandbox activity
- question/unknown inbound events creating due follow-ups for human review
- positive, negative, and opt-out inbound events stopping open follow-ups
- opt-out responses updating lead status to `OPTED_OUT`
- organization-scoped lead timeline and follow-up APIs
- UI timeline and follow-up visibility in Overview, Lead detail, Outbound, and Activity
- Developer / Test Controls for mock inbound events
- lightweight Outbound UI controls to create a simple follow-up sequence and enroll the selected lead

M6/M7 foundation APIs:

- `GET /api/channels`
- `POST /api/campaigns`
- `GET /api/campaigns?organization_id=...`
- `POST /api/sequences`
- `GET /api/sequences?organization_id=...`
- `POST /api/sequences/:id/enroll`
- `GET /api/workflow-runs?organization_id=...`
- `POST /api/workflows/run-due`
- `GET /api/leads/:id/timeline?organization_id=...`
- `GET /api/follow-ups?organization_id=...`
- `GET /api/follow-ups?organization_id=...&status=DUE`
- `POST /api/follow-ups/:id/complete`
- `POST /api/inbound-events/mock`

This slice deliberately does not implement a full visual sequence builder, production scheduler service, real WhatsApp/email/SMS/voice/CRM providers, production n8n workflows, autonomous bots, bulk outbound sending, AI reply classification, or automatic Lead Intelligence regeneration from responses. Those remain later milestone work.

## M1 Scope

M1 turns customer-owned lead data into a clean, normalized, validated, traceable foundation ready for AI Lead Intelligence.

CSV is the first ingestion adapter. The core import service works from a normalized ingestion row contract so future sources such as Google Sheets, CRM, website forms, and directories can produce the same shape later. Those future connectors are not implemented in M1.

The UI supports:

- importing leads from CSV
- a focused Upload -> Review -> Complete import flow
- selecting default phone region: `IN`, `US`, or `INTERNATIONAL_ONLY`
- previewing parsed rows before commit
- reviewing human-readable validation issues
- reviewing consolidated duplicate warnings
- selecting valid rows
- committing selected rows idempotently
- viewing human-readable import history
- searching leads by name, company, email, or phone
- filtering leads by source and status
- seeing source/import provenance on lead detail

Customer-facing UI uses `Workspace` for the tenant context. Backend and database contracts still use `organization_id`.

The import API supports:

- `POST /api/imports/csv/preview`
- `POST /api/imports/:id/commit`
- `GET /api/imports?organization_id=...`
- `GET /api/imports/:id?organization_id=...`

The lead list API supports:

- `GET /api/leads?organization_id=...&search=...&source=...&status=...`

The import state machine is persisted:

```text
UPLOADED -> PREVIEWED -> READY_TO_COMMIT -> COMMITTING -> COMMITTED
COMMITTING -> FAILED -> retry safely
```

Commit is idempotent at the import row level. Repeating a commit for already committed rows does not create duplicate leads.

## M0 Scope

The UI supports:

- creating and selecting organizations
- preventing duplicate organization names
- product navigation across Overview, Leads, Intelligence, Outbound, and Activity
- creating leads
- listing tenant-scoped leads
- viewing lead detail
- viewing simple overview metrics from real application state
- inspecting the initial Lead Intelligence snapshot
- inspecting the recommended action
- reviewing the next recommended step before outbound sending exists
- seeing loading, empty, success, and error states
- using Developer / Test Controls for worker execution, retry/failure simulation, and callback simulation

The API supports the same M0 path through:

- `GET /api/health`
- `POST /api/organizations`
- `GET /api/organizations`
- `POST /api/leads`
- `GET /api/leads?organization_id=...`
- `GET /api/leads/:id?organization_id=...`
- `POST /api/leads/:id/actions`
- `POST /api/worker/run`
- `POST /api/callbacks/mock`

## PostgreSQL Path

The M0 skeleton uses Node's built-in SQLite module for a zero-dependency local database. The persistence boundary is isolated under `src/database`, so a PostgreSQL-backed adapter can replace it without changing the domain modules.

SQLite remains the default local development database. PostgreSQL is the intended production database path, but it is not implemented yet because adding a production driver, migrations tool, and runtime configuration would add infrastructure before M0 needs it.

The current persistence contract expected by repositories is:

- `exec(sql)`
- `run(sql, params)`
- `get(sql, params)`
- `all(sql, params)`
- `close()`

Future PostgreSQL work should add a PostgreSQL implementation of that contract under `src/database` and move schema migrations into versioned migration files.

## Human QA Focus

The current channel workflow slice is ready for human channel/follow-up review. The critical product question is:

```text
Can a user understand the selected lead's recommended step, outbound activity, inbound response, and follow-up state without needing to understand handlers, callbacks, n8n, or provider internals?
```

The intended product flow is:

```text
Create/select organization
  -> See Overview
  -> Open Leads
  -> Import customer-owned CSV data or add a lead
  -> Select a lead
  -> Understand source, data quality, and duplicate warnings
  -> Refresh Lead Intelligence
  -> Add approved local/manual research evidence if needed
  -> Prepare insights
  -> Prepare recommendation
  -> Review the next best action
  -> Prepare for review
  -> Approve, edit and approve, or reject
  -> Use Developer / Test Controls to execute sandbox activity and simulate a response
  -> Confirm communication activity and follow-up state persist
```

If seeded QA data such as `M2 QA Workspace`, `Long Lead ...`, or `m2-qa-leads.csv` appears, it came from `npm.cmd run dev:seed:qa`. Use `npm.cmd run dev:reset` after stopping the server to back up `data/app.db` and create a clean local database.
