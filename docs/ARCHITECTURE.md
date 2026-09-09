# Architecture

## Architectural Goal

Build a modular SaaS platform for AI Lead Intelligence & Outbound Automation.

The architecture must keep:

* Lead Intelligence
* Outbound Automation
* external integrations
* workflow execution
* AI agents
* data sources

loosely coupled.

The initial implementation should be a modular monolith.

Future service extraction should remain possible without requiring a rewrite of the core domain.

---

# High-Level Architecture

```text
                         WEB UI
                           │
                           ▼
                          API
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       LEAD INTELLIGENCE          OUTBOUND AUTOMATION
             │                           │
       ┌─────┼─────┐              ┌──────┼──────┐
       ▼     ▼     ▼              ▼      ▼      ▼
    Enrich Research Score       Actions Sequences Follow-up
       │     │     │              │      │      │
       └─────┼─────┘              └──────┼──────┘
             │                           │
             └────────────┬──────────────┘
                          ▼
                       DATABASE
                          │
                          ▼
                        EVENTS
                          │
                          ▼
                        WORKER
                          │
                          ▼
                     HANDLERS
                          │
                          ▼
                         n8n
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
         WhatsApp       Email          CRM
```

---

# Architectural Domains

## 1. Data Foundation

Responsible for:

* lead ingestion
* people
* companies
* lead sources
* normalization
* identity resolution
* deduplication
* import processing

M1 establishes Lead Data Foundation as the reusable ingestion capability:

```text
Customer-owned data
        |
CSV Adapter
        |
Normalized Ingestion Row
        |
Lead Data Foundation
        |
Lead
        |
AI Lead Intelligence
```

CSV is the first adapter, not the domain model. CSV-specific parsing and flexible header recognition are isolated under the Data Foundation adapter layer. The core import service consumes normalized ingestion rows so future adapters such as Google Sheets, CRM, website forms, directories, or other customer-owned sources can produce the same contract later.

M1 flags duplicate candidates but does not merge, skip, delete, or resolve identities automatically. Strong duplicate candidates are detected by normalized email or normalized phone. Possible duplicate candidates are detected by normalized name + company.

## 2. Lead Intelligence

Core product domain.

Responsible for:

* enrichment
* research
* signal extraction
* qualification
* scoring
* segmentation
* personalization
* intelligence snapshots
* next-best-action recommendations

M2.0 establishes the foundation for this domain without external research or LLM calls:

```text
Lead
  |
  v
Intelligence Orchestrator
  |
  +--> Evidence
  +--> Claims
  +--> Signals
  +--> Qualification Foundation
  +--> Recommended Next Step
  |
  v
Versioned Intelligence Snapshot
```

The M2.0 orchestrator is deterministic. It derives data readiness, claims, and signals from stored customer-owned lead data and provenance only. It does not scrape websites, call search APIs, call LLMs, enrich records, discover leads, or execute outbound actions.

Future research/enrichment providers must plug in by producing normalized evidence. They must not directly mutate intelligence snapshots or outbound execution state.

M2.1 adds the first implementation of that boundary:

```text
Approved Evidence Adapter
        |
        v
Normalized Research Evidence
        |
        v
Research Evidence Ingestion
        |
        v
Persisted Evidence Staging
        |
        v
Future Intelligence Processing
```

The M2.1 implementation uses an approved local/manual adapter only. It validates provider output against the normalized evidence contract and persists it in research evidence staging tables. It intentionally does not call external systems and does not directly mutate intelligence snapshots, claims, signals, recommendations, actions, or outbound executions.

M2.2 adds structured synthesis and qualification on top of current intelligence evidence:

```text
Current Intelligence Snapshot
        |
        v
Staged Research Evidence
        |
        v
Structured Synthesis Agent
        |
        v
Persisted Synthesis Run
        |
        v
Qualification Foundation
```

The current M2.2 agent is deterministic and local. It validates the future LLM output contract without calling a model provider. Every finding, qualification reason, and synthesis recommendation must reference persisted snapshot evidence or staged research evidence. M2.2 does not perform real web research, enrichment, discovery, personalization, segmentation, outbound execution, or real next-best-action planning.

M2.3 adds evidence-grounded recommendation intelligence before M3 action planning:

```text
Persisted Synthesis Run
        |
        v
Recommendation Intelligence
        |
        +--> Attention Priority
        +--> Segment
        +--> Personalization Context
        +--> Recommended Next Step
```

M2.3 recommendations are not executable actions. They do not create `actions`, bypass policy, request approval, send messages, or call n8n. M3 will own action planning and policy. M2.3 only prepares evidence-backed recommendation intelligence for human review and downstream planning.

M3 adds next-best-action planning as the boundary between Lead Intelligence and Outbound Automation:

```text
Recommendation Intelligence
        |
        v
Action Planner
        |
        v
Policy Engine
        |
        v
Persisted NextBestActionPlan
```

The M3 plan is not an executable outbound action. It stores action type, rationale, policy decision, approval requirement, and evidence references, but its execution contract is explicitly non-executable. M4 owns sandbox execution foundation and M5 owns persisted human approval state.


M2.0 exposes separate application concepts instead of collapsing them into one status:

- lead lifecycle status
- intelligence status: `NOT_RUN`, `READY_TO_RUN`, `GENERATED`, `NEEDS_DATA`, `FAILED`
- data readiness: `READY_FOR_INTELLIGENCE` or `NEEDS_MORE_DATA`
- persisted snapshot existence
- recommendation
- outbound action/execution state

The frontend must not infer intelligence state from a numeric readiness score. A lead can be ready to analyze before any intelligence snapshot exists.

## 3. Outbound Automation

Responsible for:

* campaigns
* sequences
* sequence steps
* scheduling
* action planning
* execution
* follow-up
* response-driven branching

## 4. Policy

Responsible for:

* contact eligibility
* opt-outs
* channel restrictions
* business hours
* approval requirements
* rate limits
* execution rules

## 5. Agents

Specialized AI capabilities.

Examples:

* ResearchAgent
* QualificationAgent
* SignalAgent
* PersonalizationAgent
* ReplyClassifier
* ActionPlanner

Agents must remain bounded and structured.

## 6. Handlers

Execute application actions.

Examples:

* EmailHandler
* WhatsAppHandler
* HumanTaskHandler
* CRMHandler
* ResearchHandler

## 7. Connectors

Provide access to external data/services.

Examples:

* Google Sheets
* CRM
* Maps
* websites
* enrichment providers
* research providers

## 8. Discovery

Optional plugin system.

Examples:

* Google Maps
* directories
* web discovery
* public registries
* external lead databases

Discovery produces `LeadCandidate` records.

---

# Dependency Direction

```text
UI
 ↓
API
 ↓
Application / Domain
 ↓
Interfaces
 ↓
Adapters
 ↓
External Systems
```

Core domain modules must not directly depend on:

* n8n
* specific LLM providers
* specific email providers
* specific WhatsApp providers
* specific discovery providers

---

# n8n Boundary

n8n is an execution/integration mechanism.

The application defines its own action contract.

Example:

```text
Action
 ├── action_id
 ├── tenant_id
 ├── lead_id
 ├── type
 ├── payload
 ├── scheduled_at
 └── idempotency_key
```

Execution flow:

```text
Application
    ↓
Action
    ↓
Handler
    ↓
n8n Adapter
    ↓
n8n Workflow
    ↓
External Provider
    ↓
Webhook / Callback
    ↓
Application
```

The application remains authoritative.

If n8n is replaced, the handler/adapter implementation can change without rewriting the domain.

---

# Connector vs Handler

## Connector

Answers:

> How do we access an external source/system?

Examples:

```text
GoogleSheetsConnector
CRMConnector
MapsConnector
ResearchConnector
EnrichmentConnector
```

## Handler

Answers:

> How do we execute an application action?

Examples:

```text
WhatsAppHandler
EmailHandler
CRMUpdateHandler
HumanTaskHandler
```

Do not mix these abstractions unnecessarily.

---

# Agent Architecture

Agents are bounded intelligence components.

Each agent has:

* input schema
* output schema
* allowed tools
* limits
* failure behavior
* confidence where appropriate
* escalation behavior

Example:

```text
Lead
 ↓
ResearchAgent
 ↓
ResearchResult
 ↓
QualificationAgent
 ↓
QualificationResult
 ↓
ActionPlanner
 ↓
ActionPlan
```

Agents must not bypass domain policy.

---

# Structured Agent Handoffs

Prefer:

```json
{
  "lead_id": "lead_123",
  "result": {},
  "confidence": 0.86,
  "evidence": [],
  "recommended_next_step": ""
}
```

over large free-form agent-to-agent conversations.

Do not persist hidden chain-of-thought.

Persist concise decision explanations and evidence where appropriate.

---

# Database

The database is the authoritative source for:

* lead state
* intelligence
* actions
* campaigns
* sequences
* approvals
* messages
* workflows
* events
* provider references
* audit information

---

# Events

Important events should be represented explicitly.

Examples:

```text
LeadCreated
LeadNormalized
LeadEnriched
ResearchCompleted
SignalsUpdated
LeadQualified
LeadScored
SegmentAssigned
ActionPlanned
ApprovalRequested
ActionApproved
ActionStarted
ActionCompleted
ActionFailed
MessageReceived
ReplyClassified
LeadSuppressed
```

---

# State

Important application state must not exist only inside:

* n8n
* agent memory
* frontend state
* provider state

Workflow execution should update application state through defined events/contracts.

---

# Idempotency

Any operation capable of producing an external side effect must support idempotency.

Examples:

* send message
* create CRM record
* process webhook
* update state

Duplicate requests must not create duplicate side effects.

---

# Retry Strategy

Retryable:

* temporary network failure
* provider timeout
* temporary service unavailable
* rate limit

Non-retryable:

* invalid recipient
* permanent rejection
* policy violation
* opt-out
* malformed request

Retries must be bounded and use appropriate backoff.

---

# Observability

Important executions should record:

* execution ID
* tenant ID
* lead ID
* workflow ID where applicable
* agent ID where applicable
* action ID
* timestamps
* status
* duration
* provider
* error
* relevant decision metadata

Secrets must never be logged unnecessarily.

---

# Scalability

Start with a modular monolith.

Potential future extraction boundaries:

```text
API
Worker
Lead Intelligence
Outbound Execution
Discovery
```

Only extract services when justified by:

* scale
* reliability
* team ownership
* deployment independence
* resource isolation

Do not introduce distributed architecture prematurely.

---

# M0 Implementation Note

The current walking skeleton is a Node.js modular monolith using:

- `node:http` for the API and static UI.
- `node:sqlite` for the local development/test database.
- Repository and service modules under `src/modules`.
- A mock n8n adapter behind the handler boundary.

SQLite is used to keep the M0 local skeleton dependency-light. Core domain modules depend on repository/service boundaries rather than SQLite directly, and repositories depend on a small database-client contract:

- `exec(sql)`
- `run(sql, params)`
- `get(sql, params)`
- `all(sql, params)`
- `close()`

The only direct `node:sqlite` usage is isolated in `src/database/database.js`. A PostgreSQL adapter should implement the same contract under `src/database` when production database work begins.

> **Superseded on 2026-09-09.** The PostgreSQL adapter now exists, and building it
> required changing this contract -- see *Phase 5 Implementation Note* at the end of
> this document. The contract is now asynchronous (`await db.get(...)`), because
> `node:sqlite` is synchronous while every PostgreSQL driver is not. The sentence
> above was not achievable as written.

Architecture review results for the current M0 implementation:

- SQLite coupling is isolated to the database adapter.
- HTTP coupling is isolated to `src/api/app.js` and static UI files.
- Mock n8n coupling is isolated to the handler adapter and application composition root.
- The callback service uses a provider-neutral execution callback contract.
- No real outbound provider, discovery provider, or LLM provider is coupled into the core domain.

M0.1 product UX/state pass:

- The primary UI is organized around product concepts: Overview, Leads, Intelligence, Outbound, and Activity.
- Developer/test controls remain available but are separated from the normal product experience.
- Main product UI avoids implementation terms such as worker, handler, callback, and mock n8n except inside Developer / Test Controls.
- Organization and lead state are derived from explicit selected/loading/empty/error/success states.
- Duplicate organization names are rejected by the API with a clear validation error.

M3.1 product UX / information architecture pass:

- The normal customer flow is customer data -> Lead Data Foundation -> Lead Intelligence -> Next Best Action -> Human review -> outbound later.
- Overview uses real workspace metrics and compact attention/activity sections instead of listing every lead or exposing execution internals.
- Lead detail prioritizes source, data quality, Lead Intelligence, recommendation, and customer-facing activity.
- Intelligence UI hides snapshot versions, pipeline versions, fingerprints, raw evidence identifiers, and deterministic implementation labels from the default view.
- Outbound UI presents the recommended next step and explicitly states that nothing has been sent.
- Sandbox action execution remains available only as engineering validation, not as the customer-facing product path.

---

# M1 Implementation Note

The current Lead Data Foundation implementation keeps the modular monolith and persistence boundary from M0.

- `src/modules/data-foundation/csvParser.js` parses CSV without external dependencies.
- `src/modules/data-foundation/csvAdapter.js` maps flexible CSV headers into a normalized ingestion contract.
- `src/modules/data-foundation/normalization.js` normalizes strings, email, phone, and source values.
- `src/modules/data-foundation/importsService.js` owns preview, validation, duplicate candidate detection, state transitions, and idempotent commit.
- `src/modules/data-foundation/importsRepository.js` persists import batches, rows, issues, and row commit state.

SQLite remains the local database. M1 adds portable tables for `import_batches`, `import_rows`, and `import_issues`, plus additive lead provenance fields. Core domain/application modules continue to depend on repository/service boundaries instead of direct SQLite APIs.

PostgreSQL remains the documented production path. It should implement the same database-client contract before production database work begins.

---

# M2.0 Implementation Note

The current AI Lead Intelligence Foundation implementation keeps intelligence provider-independent:

- `src/modules/lead-intelligence/intelligenceContract.js` defines snapshot, confidence, evidence, claim, signal, qualification, and recommendation vocabulary.
- `src/modules/lead-intelligence/readiness.js` contains deterministic data-readiness, signal, qualification-foundation, and recommendation rules.
- `src/modules/lead-intelligence/intelligenceService.js` orchestrates lead data into persisted intelligence snapshots.
- `src/modules/lead-intelligence/intelligenceRepository.js` persists versioned snapshots, evidence, claims, signals, qualifications, and recommendations.
- `src/modules/lead-intelligence/researchProviderContract.js` defines the future provider boundary without implementing any provider.

M2.0 intentionally treats the existing numeric value as `readiness_score`, not an AI qualification score. It indicates data quality/readiness from stored fields such as name, company, normalized email, normalized phone, source, provenance, and duplicate warnings.

The action planner still consumes the snapshot recommendation through the existing repository boundary for the M0 walking skeleton. The intelligence layer recommends; outbound automation executes separately. Normal customer-facing M2.0 UI hides M0 mock executions from Activity and Outbound so the product does not imply real outbound sending.

Evidence and claims in M2.0 represent customer-provided data and local provenance. They do not represent external fact verification. UI should show human-readable provenance such as file name and row number instead of raw import IDs as the primary evidence experience.

SQLite remains the local database. New intelligence tables are additive and organization scoped. Core intelligence services depend on repository interfaces and do not directly depend on SQLite APIs.

---

# M2.1 Implementation Note

M2.1 adds:

- `src/modules/lead-intelligence/researchProviderContract.js`
- `src/modules/lead-intelligence/approvedResearchAdapter.js`
- `src/modules/lead-intelligence/researchEvidenceRepository.js`
- `src/modules/lead-intelligence/researchEvidenceService.js`

Persistence is additive:

- `research_evidence_ingestions`
- `research_evidence_items`

Research evidence ingestion is idempotent through an ingestion-level idempotency key. Failed ingestions can be retried safely with the same key. All read/write access is organization scoped.

---

# M2.2 Implementation Note

M2.2 adds:

- `src/modules/lead-intelligence/synthesisContract.js`
- `src/modules/lead-intelligence/localSynthesisAgent.js`
- `src/modules/lead-intelligence/synthesisRepository.js`
- `src/modules/lead-intelligence/synthesisService.js`

Persistence is additive:

- `intelligence_synthesis_runs`

Synthesis runs are idempotent by current snapshot, staged research evidence, and pipeline version. Failed runs can be retried safely with the same input fingerprint. New staged evidence creates a new synthesis version and supersedes the earlier ready run.

The implementation remains provider-independent. A future LLM adapter should satisfy the same structured output contract instead of replacing the Lead Intelligence persistence model.

---

# M2.3 Implementation Note

M2.3 adds:

- `src/modules/lead-intelligence/intelligenceRecommendationContract.js`
- `src/modules/lead-intelligence/localRecommendationAgent.js`
- `src/modules/lead-intelligence/intelligenceRecommendationRepository.js`
- `src/modules/lead-intelligence/intelligenceRecommendationService.js`

Persistence is additive:

- `intelligence_recommendation_runs`

Recommendation runs are idempotent by current synthesis, current snapshot, and pipeline version. Failed runs can be retried safely with the same input fingerprint. A new synthesis creates a new recommendation version and supersedes the earlier ready run.

The recommendation layer remains inside Lead Intelligence. It creates attention priority, segment, personalization context, and a recommended next step, but it does not create outbound actions or execute anything.

---

# M3 Implementation Note

M3 adds:

- `src/modules/next-best-action/nextBestActionContract.js`
- `src/modules/next-best-action/actionPlanner.js`
- `src/modules/next-best-action/policyEngine.js`
- `src/modules/next-best-action/nextBestActionRepository.js`
- `src/modules/next-best-action/nextBestActionService.js`

Persistence is additive:

- `next_best_action_plans`

Next-best-action planning consumes the current ready M2.3 recommendation intelligence and produces a persisted plan with:

- action type
- title and rationale
- policy decision
- approval requirement
- decision evidence references
- non-executable execution contract

Planning is idempotent by lead status, current recommendation input, evidence references, and pipeline version. Failed planning can retry safely. A new recommendation creates a new plan version and supersedes the prior current plan.

The planner is deliberately separate from the older M0 `actions` execution table so M3 cannot accidentally send, execute, or enqueue outbound work. Execution remains the responsibility of M4/M5.

---

# M4 Implementation Note

M4 formalizes the outbound execution foundation using the existing modular monolith boundaries:

- `src/modules/outbound-automation/actionContract.js`
- `src/modules/outbound-automation/actionsRepository.js`
- `src/modules/outbound-automation/executionsRepository.js`
- `src/modules/outbound-automation/callbacksRepository.js`
- `src/modules/outbound-automation/callbacksService.js`
- `src/modules/outbound-automation/outboundAutomationService.js`
- `src/modules/handlers/actionExecutor.js`
- `src/modules/handlers/mockN8nAdapter.js`

Persistence is additive:

- action rows now record `next_best_action_plan_id`, `approval_requirement`, `execution_mode`, `provider`, and `last_error`.
- callback rows now record organization, lead, execution, callback status, and provider reference.
- execution idempotency is enforced with a unique execution idempotency index.

M4 converts a current M3 plan into one outbound action. The action is idempotent by plan id. Approval-required plans become `AWAITING_APPROVAL` and require M5 approval before execution. Non-approval actions can execute through the sandbox/mock handler boundary.

The M3.1 customer UI intentionally does not expose M4 prepare/execute controls as normal product actions. Those mechanics remain available for engineering validation and future approval/execution milestones.

Execution remains provider-independent at the service boundary:

```text
OutboundAction
        |
        v
ActionExecutor
        |
        v
Handler / Adapter
        |
        v
Mock n8n Boundary
        |
        v
Scoped Callback
        |
        v
Persisted Execution History
```

M4 does not implement real outbound providers, production n8n workflows, approval queues, message generation, campaigns, sequences, or follow-up automation.

---

# M5 Implementation Note

M5 adds persisted human approval state for approval-required outbound actions:

- `src/modules/outbound-automation/approvalContract.js`
- `src/modules/outbound-automation/approvalsRepository.js`
- `src/modules/outbound-automation/approvalsService.js`

Persistence is additive:

- `action_approvals`

The approval service is organization scoped. It creates one pending approval request per approval-required action, approves actions idempotently, stores edit-and-approve payload metadata, rejects actions by blocking the action, and records audit events for each decision.

M5 does not add real outbound providers, approval assignment, authentication, multi-user permissions, campaigns, sequences, bulk sending, or production n8n workflows. Approved actions still use the existing sandbox execution foundation until real providers are introduced later.

---

# M6/M7 Channel Workflow Foundation Note

The current implementation adds the first provider-neutral channel and follow-up foundation without completing full M6 sequences or M7 response intelligence.

New modules:

- `src/modules/channels/channelContract.js`
- `src/modules/channels/channelMessagesRepository.js`
- `src/modules/channels/inboundEventsRepository.js`
- `src/modules/channels/followUpsRepository.js`
- `src/modules/channels/channelWorkflowService.js`

Persistence is additive:

- `channel_messages`
- `inbound_events`
- `follow_up_tasks`

The foundation normalizes channel activity into application-owned state:

```text
OutboundAction
        |
        v
Handler / Mock n8n Boundary
        |
        v
ChannelMessage
        |
        v
Execution Callback
        |
        v
FollowUpTask

Inbound Provider Event / Mock Event
        |
        v
InboundEvent
        |
        v
ChannelMessage
        |
        v
FollowUpTask / Lead State
```

Channels are represented by a shared vocabulary for `EMAIL`, `WHATSAPP`, `SMS`, `VOICE`, `HUMAN_TASK`, and `CRM`. Current email and WhatsApp activity remains mock/sandbox only. Voice, SMS, and CRM are contract paths only, not real providers.

Inbound events are idempotent by organization, provider, and provider event id. Duplicate inbound events do not create duplicate messages or follow-ups. Outbound channel messages are idempotent by organization and execution-derived idempotency key.

This slice introduces basic follow-up behavior:

- completed sandbox email/WhatsApp outbound activity creates one planned no-response follow-up.
- inbound questions or unknown responses create due human-review follow-ups.
- positive, negative, and opt-out responses stop open follow-ups.
- opt-out responses update the lead state to `OPTED_OUT`.

The normal UI shows communication and follow-up activity in product language. Mock inbound event buttons remain isolated inside Developer / Test Controls.

M6 sequence foundation adds:

- `src/modules/workflows/workflowContract.js`
- `src/modules/workflows/workflowsRepository.js`
- `src/modules/workflows/workflowsService.js`

Persistence is additive:

- `campaigns`
- `sequences`
- `sequence_steps`
- `workflow_runs`

Sequence execution deliberately reuses the existing outbound action boundary:

```text
Campaign
        |
        v
Sequence
        |
        v
SequenceStep
        |
        v
WorkflowRun
        |
        v
Action
        |
        v
Approval / Handler / ChannelMessage
```

Workflow runs are idempotent by organization, sequence, and lead. Sequence steps create ordinary `actions` using step-derived idempotency keys, so retries do not create duplicate outbound work. Approval-required steps create `AWAITING_APPROVAL` actions and wait until the action is approved before the workflow runner continues. Non-approval steps execute only through the existing sandbox handler boundary.

The current due-step runner is an explicit API call, not a production scheduler service. It supports wait steps, approval wait states, step action creation, and basic response-driven stop conditions. Positive, negative, and opt-out inbound events stop open workflow runs for the lead.

This slice does not implement a full visual sequence builder, production scheduler loop, conditional branch editor, production provider credentials, production n8n workflows, autonomous bots, bulk outbound sending, real voice agents, AI reply classification, or automatic intelligence regeneration from inbound events.

---

# React Frontend Migration Note

`client/` is the live, shipped frontend — the server's static file serving points at `client/dist` (built via `npm run client:build`). The legacy vanilla HTML/CSS/JS frontend in `public/` still exists in the repo but is no longer served by anything; it is not maintained further. Both historically consumed the same backend API (`/api/*`); only `client/` does now. The Vite dev server at port 5173 (`npm run dev` inside `client/`) proxies API requests to the backend at port 3000 for hot-reload iteration — `npm run client:build && npm start` is the real, production-shaped path.

Stack:

- React 19 + TypeScript
- Vite 8 (build + dev server)
- TailwindCSS v4 (utility-first CSS)
- shadcn/ui (copy-paste component library, not a dependency)
- Zustand (workspace state management)
- TanStack Query (server state + caching)
- react-router-dom (routing)

Architecture:

```text
client/src/
    pages/              → Page-level components (one per route)
    components/ui/      → Reusable shadcn/ui components
    components/layout/  → App shell, sidebar, header
    hooks/              → Custom hooks wrapping API calls (use-leads, use-intelligence, etc.)
    stores/             → Zustand stores (workspace/org selection)
    lib/                → API client, utility functions
    types/              → Shared TypeScript type definitions
```

Navigation — three workspaces plus one tabbed individual record:

- `/` → Dashboard (KPI cards, pipeline charts, a real attention queue with per-lead reasons, "Analyze eligible leads" bulk entry point)
- `/leads` → Leads workspace: list, search, CSV import, add lead. Purely data management — rows open the individual record's Overview tab.
- `/intelligence` → Intelligence workspace: bulk analysis. Stat cards (total/not-analyzed/analyzing/analyzed/failed/recommendations-ready/action-ready) plus an attention-priority breakdown, a table, and a server-side bulk "Analyze eligible leads" action (`POST /api/intelligence/bulk-run`). Rows deep-link to `/leads/:id?tab=intelligence`.
- `/outbound` → Outbound workspace: bulk execution. Summary widgets (total/ready-for-review/approved/scheduled/sent/replies/follow-ups-due/failed) and tabbed queues of the same names, with row multi-select + bulk approve (`POST /api/actions/bulk-approve`). Rows deep-link to `/leads/:id?tab=outbound`.
- `/leads/:id` → the individual 360° record. One persistent header (contact info, status, "Message" channel picker, "Analyze lead"/"Refresh intelligence") above three tabs addressable via `?tab=`:
  - **Overview** (default, no query param): customer-provided lead data only (name/email/phone/company/source/status), explicitly labeled as not AI-generated, plus human-readable provenance (`Imported from CSV (file.csv) · Row 18` — never a raw `import_batch_id:import_row_id` string) and a one-line pointer into the Intelligence tab.
  - **Intelligence** (`?tab=intelligence`): readiness, qualification assessment, external research findings (only shown if any exist), the recommendation (priority/segment/label/reason/personalization), the resulting next-best-action status with a "Review outbound" jump, and a compact evidence-citation list (source type + field, never raw evidence IDs).
  - **Outbound & Activity** (`?tab=outbound`): per-lead outbound actions with inline Approve/Reject/Send-now, a chat-bubble conversation thread (built from the existing lead-timeline API's `kind: "message"` entries — direction determines bubble side, channel badge, status dot), and follow-ups as task cards (`kind: "follow_up"` entries) with Mark done/Cancel.
- `/conversations` → cross-lead inbox (all channels, all leads) plus a free "Simulate inbound reply" control (no API keys — wired to the existing mock inbound-event endpoint) for testing any channel end to end.
- `/activity` → Follow-ups queue + audit log feed.
- `/settings` → General, AI Provider, Email, WhatsApp, SMS, Telegram, Call — each channel's sandbox option is explicitly labeled "free, simulated, no API key needed."

Key design decisions:

- Intelligence and Outbound are bulk *workspaces* (list + KPIs + bulk actions); the individual record lives at one URL (`/leads/:id`) with tabs, not separate per-concern pages. An earlier iteration tried a fully separate `/intelligence/:leadId` page and then a single un-tabbed merged page; both made "why did AI recommend this" and "what's the outbound status" hard to jump to directly from the workspace that raised them. Tabs-with-deep-links is the current answer — see `docs/TASKS.md` history for the two prior shapes this went through in one day.
- Customer-provided lead fields (name/email/phone/company/source) are never presented as "AI intelligence" — they live in Overview under an explicit "not AI-generated" label. The Intelligence tab only shows genuinely-generated output: readiness scoring, qualification reasoning, recommendation, and (if present) external research findings.
- The conversation thread and follow-up tasks are built entirely from the pre-existing `GET /api/leads/:id/timeline` endpoint (it already tags each entry with `kind: "message" | "follow_up"`, direction, channel, and status) — no new backend endpoint was needed for this.
- CSV import dialog handles the full preview → select valid rows → commit flow inline.

---

# LLM Provider Abstraction Note

The backend supports multiple LLM providers through environment-based configuration:

```text
.env:
    LLM_PROVIDER=groq|openai|openrouter|ollama
    GROQ_API_KEY=...
    OPENAI_API_KEY=...
    OPENROUTER_API_KEY=...
```

Start the server with `node --env-file=.env src/server.js` to load provider configuration.

The AI status endpoint (`GET /api/ai/status`) reports:

- `configured`: boolean
- `provider`: provider name
- `model`: model identifier (e.g., `llama-3.1-8b-instant` for Groq)

When no LLM provider is configured, the system falls back to deterministic local agents (`localSynthesisAgent.js`, `localRecommendationAgent.js`). This preserves the existing M2 intelligence pipeline without requiring an API key.

The provider abstraction uses OpenAI-compatible APIs. Groq, OpenRouter, and OpenAI all expose the same chat completions endpoint shape. Ollama provides a local alternative for offline development.

Future LLM integration points:

- Replace `localSynthesisAgent.js` with LLM-powered synthesis
- Replace `localRecommendationAgent.js` with LLM-powered recommendations
- Add message generation service for personalized outbound
- Add ReplyClassifier for inbound message intent detection
- Add chatbot response engine using org knowledge base context

# Phase 5 Implementation Note — Production Foundation

Delivered 2026-09-09. This is the work that makes a real deployment possible: a
PostgreSQL adapter, versioned migrations, environment-driven configuration, and
structured logging/errors.

## The asynchronous DatabaseClient contract

The original contract was synchronous because `node:sqlite`'s `DatabaseSync` is
synchronous. That made the documented promise — "a PostgreSQL adapter without
changing any module code" — impossible to keep: every PostgreSQL driver is
asynchronous, and 200 call sites across 19 repositories consumed results directly
as values.

The contract is now:

```text
exec(sql)                   -> Promise<void>            multi-statement DDL
run(sql, params)            -> Promise<{ changes }>     writes
get(sql, params)            -> Promise<row | undefined> single row
all(sql, params)            -> Promise<row[]>           many rows
columnExists(table, column) -> Promise<boolean>         migrations only
transaction(fn)             -> Promise<T>               migrations only
close()                     -> Promise<void>
```

Both implementations satisfy it identically:

- `SqliteDatabaseClient` (`src/database/sqliteClient.js`) still calls
  `DatabaseSync` synchronously underneath; the methods are merely declared
  `async`. Awaiting a synchronous result costs one microtask, so local
  development and the test suite keep SQLite's real semantics — a write is
  durable the instant the promise settles.
- `PostgresDatabaseClient` (`src/database/postgresClient.js`) wraps a `pg` pool
  and returns real promises.

Repositories, services, the worker, the handlers and the API layer were converted
to `async`/`await` accordingly. Repository methods that never touch the database
(`messageDetail`, `stepDetail`, `actionPayload`, and the other pure serialisers)
deliberately stayed synchronous, so `.map()` call sites over them did not have to
change.

## One SQL dialect

Repositories write SQLite-flavoured SQL with `?` placeholders. Two translations
happen inside the PostgreSQL client and nowhere else:

1. **Placeholders.** `?` is rewritten to `$1..$n` by `src/database/sql.js`, which
   skips string literals, quoted identifiers and comments so a `?` inside a value
   is never mistaken for a bind parameter.
2. **Numeric types.** `pg` returns BIGINT (`COUNT(*)`) and NUMERIC (`SUM(...)`)
   as JavaScript strings to avoid precision loss. Both are parsed to `Number` to
   match SQLite exactly — otherwise every dashboard total would silently become
   string concatenation on PostgreSQL and a number on SQLite.

The three genuinely SQLite-only expressions that existed
(`datetime('now','-7 days')`, `datetime('now','-30 days')`, `date(created_at)`)
were replaced with JS-computed ISO cutoffs passed as parameters and
`substr(created_at, 1, 10)`, both of which behave identically in either engine.
`created_at` is an ISO 8601 TEXT column, so string comparison is chronological.

## Migrations

DDL moved out of an inline `db.exec()` block into versioned migrations under
`src/database/migrations/`, tracked in a `schema_migrations` table.

- Migrations are listed explicitly in `migrations/index.js`; the order is the
  contract.
- Each migration runs inside its own transaction together with the row that
  records it, so an interrupted deploy leaves no half-applied schema. Both
  engines support transactional DDL.
- Migration `0001_baseline_schema` is the schema as it stood before the runner
  existed, written to be fully idempotent (`IF NOT EXISTS`, plus `ensureColumn`).
  Applying it to a database created by the old code is a no-op that simply
  records the version — existing development databases adopt the runner without
  being rebuilt.
- Never edit or reorder a released migration. Deployed databases have recorded it
  and will not run it again.

`npm run db:migrate` applies pending migrations and exits non-zero on failure
(intended as a deploy pre-step, so a bad migration fails *before* old instances
are replaced). `npm run db:status` reports applied/pending without changing
anything.

## Configuration and secrets

`src/config.js` is the only module that reads `process.env` for anything that
differs between environments. `.env.example` documents every variable.

- Setting `DATABASE_URL` is the *entire* switch from SQLite to PostgreSQL — no
  code path or build flag changes.
- `validateConfig()` refuses to boot `NODE_ENV=staging|production` on SQLite, or
  with a non-PostgreSQL connection string, so a misconfigured deploy fails at boot
  instead of on the first request that needs the missing value.
- `describeConfig()` produces the redacted summary logged at boot; it reports the
  database host but never the connection string, which carries the password.

## Observability and error handling

- `src/shared/logger.js` emits one JSON object per line when deployed and readable
  text locally. Logs are an event name plus a flat field bag — never an
  interpolated sentence — so they can be filtered by `event` and
  `organization_id` rather than grepped. `child()` binds a request id onto every
  line of a request.
- `src/shared/errors.js` gives every error an HTTP status *and* a machine-readable
  `code`, and marks whether it was `expected` (a validation failure, a missing
  record) or a defect.
- `sendError()` returns an expected error's message to the caller, because that
  message is the product telling the user what to fix. An unexpected error returns
  a generic message plus the request id; the real message goes to the log only.
  Previously any error's `.message` was returned verbatim, which would have leaked
  SQL fragments and internal detail to browsers in production.
- `GET /api/health` is liveness and deliberately does not touch the database, so a
  database blip never causes the platform to restart a healthy process.
  `GET /api/health/ready` is readiness: it checks that the database answers and
  that no migration is pending, returning 503 otherwise.

## Operational behaviour

- The server handles `SIGTERM`/`SIGINT`: it stops the worker, drains in-flight
  requests, closes the database, and force-exits after 10s. Container platforms
  send SIGTERM before replacing an instance; without this a deploy can cut a
  request mid-write.
- The background worker tick is guarded against overlap. Now that a tick awaits
  real network round trips, a slow tick must not have the next one start beside it
  and execute the same action twice.
- `WORKER_ENABLED=false` allows an instance to serve HTTP only, which is what
  splitting the worker into its own service will need.

## Verification status

- 176 automated tests pass against the abstraction on SQLite; 4 PostgreSQL
  integration tests in `test/postgres-adapter.test.js` are skipped unless
  `TEST_DATABASE_URL` is set, and are the gate for the staging deploy.
- One full product cycle was driven through the browser against a real server:
  register, create lead, intelligence pipeline, outbound action, approve, execute,
  conversation thread, auto-scheduled follow-up, inbound reply classified. No 5xx
  occurred. Restart persistence and migration adoption were confirmed against the
  same database.
- **The PostgreSQL adapter has not yet run against a real PostgreSQL server.** No
  Docker or local PostgreSQL was available on the development machine. Its
  correctness rests on unit-tested SQL translation plus review until the staging
  deploy runs `test/postgres-adapter.test.js` against Supabase.
