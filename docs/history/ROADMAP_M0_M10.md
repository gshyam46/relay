> Historical M0-M10 capability roadmap archived on 2026-09-11. Superseded for delivery by [the launch roadmap](../ROADMAP.md).

# Roadmap

## Development Strategy

Build vertically.

Each milestone should produce a working, demonstrable capability.

Do not build the entire platform before validating the previous layer.

The development order deliberately establishes:

**Data → Lead Intelligence → Action Planning → Outbound Automation → Feedback → Discovery**

---

# M0 — Architecture + Walking Skeleton

## Goal

Prove the major technical boundaries.

```text
UI
 ↓
API
 ↓
Database
 ↓
Domain
 ↓
Event
 ↓
Worker
 ↓
Action
 ↓
Handler
 ↓
n8n/mock execution
 ↓
Callback
 ↓
Database
 ↓
UI
```

## Deliverables

- repository structure
- application skeleton
- database
- tenant model
- lead model
- basic API
- basic UI
- event mechanism
- worker mechanism
- action abstraction
- handler abstraction
- n8n/mock adapter
- callback mechanism
- basic observability
- automated tests

## Exit Criteria

A test lead can be created, an action generated, executed through the handler boundary, receive a simulated callback, and display its final state.

---

# M1 — Lead Data Foundation

## Goal

Make customer-owned lead data usable.

## Deliverables

- CSV import
- CSV adapter boundary
- normalized ingestion-row contract
- lead ingestion
- normalization
- phone normalization
- email normalization
- duplicate candidate detection
- identity resolution foundation metadata
- source tracking
- import state machine
- idempotent commit
- import history
- lead list
- lead detail
- search/filter

## Exit Criteria

A messy real-world dataset can be imported and converted into usable lead records.

M1 implementation note: CSV is the first ingestion adapter. Future customer-owned sources should enter through the same normalized ingestion-row contract; Google Sheets, CRM, website forms, directories, and discovery sources are not implemented in M1.

---

# M2 — AI Lead Intelligence

## Goal

Turn lead data into useful intelligence through staged, evidence-grounded milestones.

## M2.0 - AI Lead Intelligence Foundation

### Goal

Create the contracts, persistence, deterministic readiness pipeline, evidence model, claim model, signal model, qualification foundation, and recommendation boundary that future AI/research providers will use.

### Deliverables

- intelligence domain contracts
- evidence model
- claim model
- confidence model
- deterministic data readiness
- deterministic signals from current Lead Data Foundation data
- qualification foundation
- recommendation boundary
- versioned intelligence snapshots
- idempotent intelligence reruns
- intelligence APIs
- minimal Intelligence UI
- tenant isolation tests

### Exit Criteria

A lead can produce a persisted, versioned intelligence snapshot that explains which customer-provided data is available, where it came from, what deterministic signals exist, what is missing, and what next step is recommended without external research or fabricated facts.

M2.0 does not implement web research, scraping, LLM calls, enrichment APIs, discovery, outbound providers, entity resolution, external fact verification, or a genuine business qualification score. It also does not send outbound messages.

## M2.1 - Research / Evidence Adapters

### Goal

Allow approved future research providers to produce normalized evidence without directly mutating intelligence state.

### Deliverables

- research evidence provider contract
- approved local/manual evidence adapter
- normalized research evidence validation
- persisted research evidence ingestion state
- persisted research evidence staging
- idempotent evidence ingestion
- provider failure/retry handling
- organization-scoped evidence APIs

### Exit Criteria

An approved adapter can submit normalized evidence for a lead, persist it with provenance and idempotency, survive retries/restarts, and keep intelligence snapshots unchanged until a later intelligence processing stage consumes the evidence.

M2.1 does not implement real external research providers, web research, scraping, search APIs, enrichment APIs, LLM synthesis, discovery, or outbound execution.

## M2.2 - Structured Synthesis + Qualification

### Goal

Use evidence-grounded structured outputs for synthesis and qualification.

### Deliverables

- structured synthesis output contract
- evidence-grounded findings
- local deterministic synthesis agent for contract validation
- qualification outcomes from persisted evidence
- persisted synthesis run state
- idempotent synthesis reruns
- failure/retry handling
- organization-scoped synthesis APIs
- synthesis evaluation tests

### Exit Criteria

A lead with a current ready intelligence snapshot can produce a persisted synthesis run whose findings, qualification, and recommendation reference persisted evidence. Re-running synthesis for the same evidence is idempotent. Adding staged evidence creates a new version and preserves history.

M2.2 does not implement real LLM provider calls, web research, scraping, search APIs, enrichment APIs, discovery, segmentation, personalization, real next-best-action planning, or outbound execution.

## M2.3 - Real Next Best Action Intelligence

### Goal

Use richer intelligence and policy to improve next-step recommendations before outbound execution.

### Deliverables

- recommendation intelligence output contract
- attention priority model based on actual evidence
- segmentation model based on synthesis/readiness/duplicate evidence
- personalization context from evidence-backed facts
- persisted recommendation run state
- idempotent recommendation reruns
- failure/retry handling
- organization-scoped recommendation APIs
- minimal recommendation review UI
- recommendation evaluation tests

### Exit Criteria

A lead with a current synthesis can produce a persisted recommendation intelligence run that explains attention priority, segment, personalization context, and recommended next step from evidence. Re-running recommendation generation for unchanged synthesis is idempotent. New synthesis creates a new recommendation version and preserves history.

M2.3 does not implement the M3 action planner, policy engine, approval workflow, executable action contract changes, outbound sending, real providers, discovery, or autonomous execution.

---

# M3 — Next Best Action

## Goal

Convert recommendation intelligence into a persisted, policy-checked next-best-action plan.

## Deliverables

- NextBestAction plan contract
- ActionPlanner consuming M2.3 recommendation intelligence
- policy engine
- non-executable action plan contract
- approval requirements
- decision evidence
- idempotent planning
- failure/retry handling
- organization-scoped planning APIs
- minimal Outbound planning UI

## Exit Criteria

The system can determine an appropriate next action from lead intelligence, persist the policy and approval decision, preserve decision evidence, and avoid directly executing outbound work.

M3 does not implement outbound execution, n8n calls, real providers, approval queues, message generation, sequencing, or M4/M5 behavior.

---

# M3.1 — Product UX / Information Architecture Consistency

## Goal

Make the existing M0-M3 product understandable, compact, and customer-facing before expanding outbound execution.

## Deliverables

- Overview dashboard based on real workspace state
- compact Leads workspace with visible import/add actions
- customer-facing Lead detail view
- simplified Lead Intelligence page
- Outbound review page that does not imply messages were sent
- isolated Developer / Test Controls
- UI-state and layout regression tests
- clean local reset/QA seed documentation

## Exit Criteria

A first-time user can understand customer data -> Lead Data Foundation -> Lead Intelligence -> Next Best Action -> Human review -> outbound later without being told about workers, handlers, callbacks, sandbox execution, pipeline versions, or raw evidence identifiers.

M3.1 does not implement new providers, LLM calls, discovery, CRM/Sheets connectors, campaigns, sequences, approval queues, or real outbound sending.

---

# M4 — Outbound Automation Foundation

## Goal

Build the reliable outbound execution foundation using sandbox/mock execution.

## Deliverables

- ActionExecution
- handler interface
- mock channel
- n8n adapter
- execution state
- retries
- idempotency
- webhook/callback
- execution history
- plan-to-action conversion

## Exit Criteria

A planned action can be prepared from a next-best-action plan, respect approval gating, execute through the sandbox handler boundary when eligible, receive an idempotent callback, and persist execution history.

M4 does not implement real providers, production n8n workflows, approval queues, approve/reject/edit workflow, campaigns, sequences, follow-up automation, or real message generation.

---

# M5 — Human-in-the-Loop

## Goal

Allow users to review AI-generated actions before execution.

## Deliverables

- approval model
- approval queue
- approve
- reject
- edit and approve
- audit history
- approval UI

## Exit Criteria

A user can review an AI-recommended outbound action, modify it if necessary, approve it, and observe execution.

---

# M6 — Sequences + Follow-Up

## Goal

Automate multi-step outbound processes.

## Current Foundation Slice

The current implementation adds provider-neutral channel activity, persisted follow-up tasks, campaigns, sequences, sequence steps, workflow runs, idempotent enrollment, wait states, approval-gated sequence actions, an explicit due-step runner, and basic response-driven stop conditions. It is not the full campaign/sequence milestone yet.

## Deliverables

- channel workflow foundation
- persisted channel messages
- persisted follow-up tasks
- follow-up queue API
- lead timeline API
- campaigns
- sequences
- sequence steps
- explicit due-step runner
- wait states
- approval-gated sequence actions
- idempotent multi-lead enrollment
- conditions
- stop conditions
- follow-up logic

## Exit Criteria

A lead can progress through a multi-step outbound sequence based on time and events.

---

# M7 — Response / Event Intelligence

## Goal

Use outbound outcomes to improve Lead Intelligence and determine subsequent actions.

## Current Foundation Slice

The current implementation adds mock inbound event intake and normalized inbound channel messages. It proves idempotent inbound processing, basic reply outcome handling, opt-out handling, and follow-up changes before real provider webhooks or AI reply classification are added.

## Deliverables

- mock inbound event intake
- persisted inbound events
- inbound message model
- inbound events
- ReplyClassifier
- response states
- positive/negative/question/opt-out handling
- human escalation
- intelligence updates

## Exit Criteria

An inbound response changes the appropriate lead/workflow state and can generate a new next-best-action recommendation.

---

# M8 — Additional Outbound Channels

## Goal

Expand execution capabilities based on validated customer demand.

Potential channels:

- WhatsApp
- email
- SMS
- human tasks
- CRM actions
- other channels

Only add channels that fit the product and customer requirements.

---

# M9 — Lead Discovery Plugins

## Goal

Allow customers to obtain additional lead candidates when their existing data is insufficient.

Potential providers:

- Google Maps/Places
- business directories
- public company websites
- permitted public web data
- public registries
- external lead databases
- other providers

Architecture:

```text
Discovery Provider
 ↓
LeadCandidate
 ↓
Normalization
 ↓
Lead Intelligence
 ↓
Outbound Automation
```

No discovery provider becomes a core dependency.

---

# M10 — Production Hardening

## Goal

Prepare for real customer usage.

Focus on:

- tenant isolation
- authentication
- authorization
- secrets
- webhook verification
- rate limits
- observability
- cost controls
- backups
- security
- performance
- data retention
- operational tooling

---

# Milestone Rule

A milestone is not complete because code compiles.

It requires:

- implementation
- automated tests
- integration tests where relevant
- failure testing where relevant
- human QA
- acceptance criteria
- working demonstration
- task tracker updated
- documentation updated
