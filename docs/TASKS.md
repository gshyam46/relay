# Task Tracker

## Status

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked

Every meaningful task should track:

- owner/agent
- dependencies
- automated tests
- human QA
- acceptance criteria

---

# M0 — Architecture + Walking Skeleton

## M0.1 Repository Foundation

- [x] Initialize repository structure
- [x] Establish application modules
- [x] Establish development environment
- [x] Configure linting/formatting
- [x] Configure CI/test execution

## M0.2 Database

- [x] Document PostgreSQL configuration path
- [x] Organization model
- [x] User model
- [x] Lead model
- [x] Migrations
- [x] Tenant isolation
- [x] Database tests

## M0.3 API

- [x] Health endpoint
- [x] Organization endpoint
- [x] Create lead endpoint
- [x] Get lead endpoint
- [x] List leads endpoint
- [x] Validation
- [x] API integration tests

## M0.4 UI

- [x] Application shell
- [x] Lead list
- [x] Lead detail
- [x] Create lead flow
- [x] Loading states
- [x] Empty states
- [x] Error states
- [x] Worker execution feedback
- [x] Action execution status
- [x] Callback status

## M0.5 Events + Worker

- [x] Event abstraction
- [x] LeadCreated event
- [x] Worker abstraction
- [x] Worker execution
- [x] Worker tests

## M0.6 Actions + Handlers

- [x] Action contract
- [x] ActionExecution model
- [x] Handler interface
- [x] Mock handler
- [x] Idempotency
- [x] Retry behavior
- [x] Failure states

## M0.7 n8n Boundary

- [x] n8n adapter interface
- [x] Mock n8n workflow
- [x] Outbound invocation
- [x] Callback/webhook
- [x] Duplicate callback handling

## M0.8 End-to-End

- [x] Create lead
- [x] Persist lead
- [x] Generate action
- [x] Execute action
- [x] Receive callback
- [x] Persist result
- [x] Display result

### Automated Verification

- [x] Unit tests
- [x] Integration tests
- [x] End-to-end test
- [x] Idempotency test
- [x] Retry test
- [x] Duplicate webhook test

### Human QA

- [ ] Create organization
- [ ] Create lead through UI
- [ ] Verify lead appears correctly
- [ ] Inspect Lead Intelligence
- [ ] Inspect recommended action
- [ ] Run worker
- [ ] Verify execution state
- [ ] Trigger callback
- [ ] Verify completed state
- [ ] Refresh browser and verify state remains visible
- [ ] Restart server and verify persisted state remains visible
- [ ] Test invalid input
- [ ] Test visible error state
- [ ] Create or select a second organization
- [ ] Verify tenant isolation in the lead list
- [ ] Simulate failure
- [ ] Verify retry
- [ ] Simulate duplicate callback
- [ ] Verify no duplicate side effect
- [ ] Verify final state in UI

### M0 Exit

- [x] Architecture validated
- [x] Automated tests pass
- [ ] Human QA passes
- [x] Documentation updated
- [x] Demonstration completed

---

# M0.1 - Product UX / State Pass

- [x] Prevent duplicate organization names
- [x] Return clear duplicate organization validation error
- [x] Display API errors in the UI
- [x] Distinguish no organization selected
- [x] Distinguish organization selected and loading
- [x] Distinguish organization selected with zero leads
- [x] Distinguish organization selected with leads available
- [x] Distinguish organization selected with loading error
- [x] Replace developer-oriented homepage with product-oriented overview
- [x] Add product navigation: Overview, Leads, Intelligence, Outbound, Activity
- [x] Show lead count from real state
- [x] Show leads needing attention from real state
- [x] Show available Lead Intelligence from real state
- [x] Show actions needing attention from real state
- [x] Show recent activity from persisted action state
- [x] Show lead list with status, data readiness, company, source, and recommended next action
- [x] Organize lead detail around product concepts
- [x] Move worker, callback, retry, and blocked-action controls into Developer / Test Controls
- [x] Keep M1 CSV import out of scope
- [x] Keep real outbound providers out of scope
- [x] Preserve Node 24 modular monolith architecture
- [x] Add automated tests for duplicate organization validation
- [x] Add automated tests for organization selection and lead loading states
- [x] Add automated tests for existing lead flow
- [x] Run lint, format check, and full test suite

### M0.1 Human QA

- [ ] Create/select organization
- [ ] See Overview
- [ ] Open Leads
- [ ] See lead
- [ ] Open lead
- [ ] Understand Lead Intelligence
- [ ] Understand data readiness
- [ ] Understand recommended action
- [ ] Review outbound activity
- [ ] Open Developer / Test Controls only if needed
- [ ] Confirm first-time user can understand the product flow without worker/event/n8n explanation

---

# M1 — Lead Data Foundation

- [x] CSV parser
- [x] CSV adapter boundary
- [x] Normalized ingestion-row contract
- [x] CSV validation
- [x] Lead normalization
- [x] Phone normalization
- [x] Email normalization
- [x] Basic duplicate candidate detection
- [x] Identity resolution foundation metadata
- [x] Import state machine
- [x] Idempotent import commit
- [x] Import history
- [x] Source tracking
- [x] Import-row provenance
- [x] Import UI
- [x] Lead search
- [x] Lead filtering
- [x] Data-quality tests
- [x] Tenant isolation tests
- [x] Commit retry/idempotency tests
- [ ] Messy dataset human QA

### M1 Human QA

- [ ] Prepare deliberately messy CSV
- [ ] Upload CSV
- [ ] Preview normalized rows
- [ ] Verify validation issues are visible
- [ ] Verify duplicate candidates are visible
- [ ] Select valid rows
- [ ] Commit selected rows
- [ ] Verify imported leads appear
- [ ] Verify source/provenance is visible on lead detail
- [ ] Repeat commit and verify no duplicate leads
- [ ] Restart server and verify import state persists
- [ ] Test invalid CSV/input error states

### M1 Exit

- [x] CSV adapter implemented
- [x] Lead Data Foundation persistence implemented
- [x] Import APIs implemented
- [x] Import UI implemented
- [x] Search/filter implemented
- [x] Automated tests pass
- [ ] Human QA passes

---

# M1.1 - Lead Data Foundation UX Refinement

- [x] Use Workspace language in customer-facing UI
- [x] Keep organization/tenant backend contract unchanged
- [x] Reduce workspace management prominence
- [x] Keep duplicate workspace validation visible and human-readable
- [x] Keep Leads page focused on lead list, search, filters, and actions
- [x] Move CSV import into a focused Upload, Review, Complete flow
- [x] Add import step indicator
- [x] Explain why phone region is required
- [x] Use Ready to import / Needs attention / Duplicate warnings language
- [x] Consolidate duplicate warning presentation
- [x] Keep duplicate candidates selectable
- [x] Keep invalid rows unselectable
- [x] Expose original vs stored normalized values through row details
- [x] Add clear completion state after import
- [x] Use human-readable import history states
- [x] Preserve Developer / Test Controls collapsed by default
- [x] Add/update UI-state tests for M1.1
- [x] Run lint, format check, test suite, and CI

### M1.1 Human QA

- [ ] First-time user understands what the workspace is
- [ ] First-time user understands where leads live
- [ ] First-time user understands how to import leads
- [ ] First-time user understands why phone region is required
- [ ] First-time user understands Ready to import
- [ ] First-time user understands Needs attention
- [ ] First-time user understands duplicate warnings
- [ ] First-time user understands what happens when Import is clicked
- [ ] First-time user can find imported leads
- [ ] First-time user can find import history

### M1.1 Exit

- [x] UX refinement implemented
- [x] Existing M0/M1 behavior preserved
- [x] Automated tests pass
- [ ] Human QA passes

---

# M2 — AI Lead Intelligence

## M2.0 - AI Lead Intelligence Foundation

- [x] Intelligence domain contracts
- [x] Confidence model
- [x] Evidence model
- [x] Claim model
- [x] Signal model
- [x] Qualification foundation
- [x] Recommendation boundary
- [x] Deterministic data readiness
- [x] Versioned intelligence snapshots
- [x] Idempotent intelligence reruns
- [x] Retry after failed intelligence generation
- [x] Manual lead evidence
- [x] CSV import provenance evidence
- [x] Organization-scoped intelligence APIs
- [x] Minimal Intelligence UI
- [x] M2.0 automated tests
- [x] Separate lead status, intelligence status, data readiness, recommendation, and outbound state
- [x] Replace misleading customer-facing intelligence-ready and score language
- [x] Represent customer-owned fields as customer-provided information
- [x] Use COMPANY_PROVIDED instead of COMPANY_IDENTIFIED for deterministic M2.0 signals
- [x] Keep confidence metadata from implying external fact verification in the UI
- [x] Show human-readable CSV provenance in Lead Intelligence
- [x] Surface duplicate warnings consistently on lead list and lead detail
- [x] Use conservative M2.0 recommendations such as gather more data, review lead, and ready for deeper Lead Intelligence
- [x] Keep M0 mock outbound executions out of customer-facing Activity and Outbound views
- [x] Harden lead list/detail layout for long lists, long values, and quoted CSV values
- [x] Prevent manual invalid phone values from becoming normalized contact data
- [x] Prevent stale snapshots from appearing as current intelligence after lead data changes
- [x] Add isolated API smoke script
- [x] Add safe local development database reset with backup
- [x] Add deliberate M2.0 human-QA seed script for empty local databases
- [x] Add M2.0 hardening tests
- [x] M2.0 human intelligence QA

### M2.0 Human QA

- [x] Create/select workspace
- [x] Open Leads
- [x] Verify lead status and intelligence status are distinct
- [x] Select a lead that has never been analyzed
- [x] Confirm it says "Not analyzed yet"
- [x] Confirm data readiness is separate
- [x] Run intelligence
- [x] Confirm intelligence becomes available
- [x] Verify only customer-provided information is shown
- [x] Verify evidence is human-readable
- [x] Verify no fake verification claims
- [x] Verify duplicate warning consistency
- [x] Verify incomplete lead says "Needs more data"
- [x] Verify email-only lead does not receive fake qualification
- [x] Verify no fake outbound activity appears
- [x] Verify long lead list scrolls naturally
- [x] Verify detail panel fits viewport
- [x] Verify mobile layout
- [x] Verify quoted CSV company/email display correctly
- [x] Refresh
- [x] Restart server
- [x] Verify persistence
- [x] Run duplicate intelligence request
- [x] Verify idempotency
- [x] Verify test/smoke data is not contaminating the normal workflow

### M2.0 Exit

- [x] Foundation implementation exists
- [x] Automated tests pass
- [x] Documentation updated
- [x] Human QA passes

## M2.1 - Research / Evidence Adapters

- [x] Research provider interface implementation
- [x] Approved local/manual research adapter
- [x] Normalized research evidence contract
- [x] Research evidence ingestion persistence
- [x] Research evidence item staging
- [x] Ingestion idempotency
- [x] Provider failure handling
- [x] Retry after failed evidence ingestion
- [x] Organization-scoped research evidence APIs
- [x] Tests prove adapters do not directly mutate snapshots
- [x] M2.1 human QA

### M2.1 Human QA

- [x] Select a lead
- [x] Submit approved local/manual research evidence through API
- [x] Verify evidence ingestion is persisted
- [x] Repeat the same request and verify no duplicate evidence is created
- [x] Verify intelligence snapshot does not change automatically
- [x] Verify wrong-workspace access is rejected

### M2.1 Exit

- [x] Provider-independent evidence boundary implemented
- [x] Automated tests pass
- [x] Documentation updated
- [x] Human QA passes

## M2.2 - Structured Synthesis + Qualification

- [x] Structured AI output contracts
- [x] Evidence-grounded synthesis
- [x] Local QualificationAgent foundation
- [x] AI evaluation dataset
- [x] Research evidence consumption evaluation
- [x] Qualification evaluation
- [x] Persisted synthesis runs
- [x] Idempotent synthesis reruns
- [x] Failure/retry handling
- [x] Organization-scoped synthesis APIs
- [x] M2.2 human QA

### M2.2 Human QA

- [x] Select a lead with generated Lead Intelligence
- [x] Run synthesis
- [x] Verify the summary is understandable and evidence-grounded
- [x] Verify findings reference current Lead Intelligence evidence
- [x] Add approved local/manual research evidence
- [x] Run synthesis again
- [x] Verify the new synthesis includes staged evidence
- [x] Verify previous synthesis is preserved in history
- [x] Repeat the same synthesis request and verify no duplicate current run is created
- [x] Verify wrong-workspace access is rejected
- [x] Confirm the UI/API does not imply real LLM research or outbound execution

### M2.2 Exit

- [x] Structured synthesis foundation implemented
- [x] Automated tests pass
- [x] Documentation updated
- [x] Human QA passes

## M2.3 - Real Next Best Action Intelligence

- [x] Next-step intelligence rules
- [x] Scoring/priority model based on actual evidence
- [x] Segmentation model
- [x] Personalization context
- [x] Persisted recommendation runs
- [x] Idempotent recommendation reruns
- [x] Failure/retry handling
- [x] Organization-scoped recommendation APIs
- [x] Minimal recommendation review UI
- [x] Recommendation evaluation tests
- [x] Human intelligence QA

### M2.3 Human QA

- [x] Select a lead with generated Lead Intelligence and synthesis
- [x] Run recommendation
- [x] Verify attention priority is understandable
- [x] Verify segment is understandable
- [x] Verify recommended next step is not presented as an executed action
- [x] Verify personalization context only uses evidence-backed facts
- [x] Verify duplicate-warning leads recommend duplicate review
- [x] Verify incomplete leads recommend gathering more data
- [x] Repeat recommendation and verify no duplicate current run is created
- [x] Add approved evidence, rerun synthesis, rerun recommendation, and verify history is preserved
- [x] Verify wrong-workspace access is rejected

### M2.3 Exit

- [x] Recommendation intelligence implementation exists
- [x] Automated tests pass
- [x] Documentation updated
- [x] Human QA passes

---

# M3 — Next Best Action

- [x] NextBestAction model
- [x] ActionPlanner
- [x] Action contract
- [x] Policy engine
- [x] Action eligibility
- [x] Approval requirements
- [x] Decision evidence
- [x] Recommendation UI
- [x] Planner tests
- [x] Policy tests
- [x] Human recommendation QA

### M3 Human QA

- [x] Select a lead with generated Lead Intelligence, synthesis, and recommendation intelligence
- [x] Open Outbound
- [x] Plan next best action
- [x] Verify the recommended action is understandable
- [x] Verify the rationale is understandable
- [x] Verify review status is understandable
- [x] Verify available data point count is understandable
- [x] Confirm no outbound work is executed
- [x] Repeat planning and verify no duplicate current plan is created
- [x] Test duplicate-warning lead recommendation
- [x] Test incomplete lead recommendation
- [x] Refresh browser and verify plan remains visible
- [x] Restart server and verify plan persists

### M3 Exit

- [x] Next-best-action planning implementation exists
- [x] Automated tests pass
- [x] Documentation updated
- [x] Human QA passes

---

# M4 — Outbound Automation Foundation

- [x] ActionExecution
- [x] Handler interface
- [x] Mock channel
- [x] n8n adapter
- [x] Execution state
- [x] Retry logic
- [x] Idempotency
- [x] Callback handling
- [x] Execution history
- [x] Failure tests
- [ ] Human execution QA

### M4 Human QA

- [ ] Select a lead with generated Lead Intelligence, synthesis, recommendation, and next-best-action plan
- [ ] Open Outbound
- [ ] Prepare outbound action
- [ ] Verify approval-required action waits for approval
- [ ] Verify waiting-for-approval action cannot execute
- [ ] Test a gather-more-data plan
- [ ] Prepare the gather-more-data action
- [ ] Run sandbox execution
- [ ] Verify execution state is visible
- [ ] Trigger callback
- [ ] Verify completed action and execution state
- [ ] Repeat callback and verify no duplicate side effect
- [ ] Test retryable execution failure and retry
- [ ] Test non-retryable execution failure
- [ ] Refresh browser and verify outbound activity remains visible
- [ ] Restart server and verify outbound state persists

### M4 Exit

- [x] Outbound execution foundation exists
- [x] Automated tests pass
- [x] Documentation updated
- [ ] Human QA passes

---

# M3.1 — Product UX / Information Architecture Consistency

- [x] Audit customer-facing UI terminology against actual M0-M3 capabilities
- [x] Redesign Overview as a compact dashboard with real workspace metrics
- [x] Keep Lead list compact with visible Import leads and Add lead actions
- [x] Add search, source, status, intelligence, and attention filters
- [x] Redesign Lead detail around source, data quality, Lead Intelligence, recommendation, and activity
- [x] Remove sandbox execution controls from normal Outbound UI
- [x] Keep Developer / Test Controls isolated and collapsed
- [x] Prevent seeded QA workspaces from being auto-selected on startup
- [x] Document clean local reset and QA seed behavior
- [x] Add UI state/layout regression tests
- [x] Human UX QA

### M3.1 Human QA

- [ ] Create or select a clean workspace
- [ ] Confirm Overview explains what is happening, what needs attention, and what happened recently
- [ ] Open Leads and verify Import leads remains visible with many leads
- [ ] Search and filter by source, status, intelligence, and attention
- [ ] Select a lead and verify the detail panel is understandable without internal IDs
- [ ] Refresh Lead Intelligence and verify data readiness is not shown as lead quality
- [ ] Prepare insights and recommendation without implying external research
- [ ] Open Outbound and confirm nothing has been sent
- [ ] Open Activity and verify it shows customer-facing workspace events
- [ ] Use Developer / Test Controls only for engineering validation
- [ ] Refresh browser and verify the selected workspace behavior is clear
- [ ] Restart server and verify persisted state remains available

### M3.1 Exit

- [x] Product UX consistency implementation exists
- [x] UI tests pass
- [x] Full automated verification passes
- [x] Human UX QA passes

---

# M5 — Human-in-the-Loop

- [x] Approval model
- [x] Approval queue
- [x] Approve
- [x] Reject
- [x] Edit and approve
- [x] Audit history
- [x] Approval UI
- [x] Approval tests
- [ ] Human QA

### M5 Human QA

- [ ] Select a lead with generated Lead Intelligence, synthesis, recommendation, and next-best-action plan
- [ ] Open Outbound
- [ ] Prepare the recommended step for human review
- [ ] Verify pending approval is visible
- [ ] Approve the recommended step
- [ ] Verify the action becomes approved
- [ ] Prepare another approval-required action
- [ ] Edit and approve it
- [ ] Verify reviewer edits persist
- [ ] Prepare another approval-required action
- [ ] Reject it
- [ ] Verify rejected action is blocked from execution
- [ ] Refresh browser and verify approval state remains visible
- [ ] Restart server and verify approval state persists
- [ ] Try wrong-workspace access through API and verify it is rejected

### M5 Exit

- [x] Approval implementation exists
- [x] Full automated verification passes
- [x] Documentation updated
- [ ] Human QA passes

---

# M6 — Sequences + Follow-Up

- [x] Channel workflow foundation slice
- [x] Provider-neutral channel vocabulary
- [x] Persisted outbound channel messages
- [x] Planned no-response follow-up after completed sandbox email/WhatsApp activity
- [x] Follow-up queue API
- [x] Lead timeline API
- [x] Campaign model
- [x] Sequence model
- [x] SequenceStep model
- [x] Explicit due-step runner
- [x] Wait state
- [ ] Conditional branch
- [x] Basic reply/opt-out stop conditions
- [x] Follow-up logic foundation
- [x] Sequence execution tests
- [ ] Human sequence QA

---

# M7 — Response / Event Intelligence

- [x] Mock inbound event intake
- [x] Persisted inbound event model
- [x] Inbound message model
- [x] Message ingestion foundation
- [x] Idempotent provider event handling
- [x] Question creates human-review follow-up
- [x] Opt-out updates lead state and stops follow-ups
- [ ] ReplyClassifier
- [x] Positive response handling foundation
- [x] Negative response handling foundation
- [x] Question handling foundation
- [x] Opt-out handling foundation
- [ ] Human escalation
- [ ] Intelligence update
- [ ] Reply tests
- [ ] Human QA

---

# M8 — Additional Channels

- [ ] Email handler
- [ ] WhatsApp handler
- [ ] Human task handler
- [ ] CRM handler
- [ ] Provider abstraction tests
- [ ] Channel failure tests
- [ ] Human channel QA

---

# M9 — Lead Discovery Plugins

- [ ] Discovery interface
- [ ] LeadCandidate contract
- [ ] First discovery provider
- [ ] Normalization
- [ ] Deduplication against existing leads
- [ ] Discovery UI
- [ ] Provider failure tests
- [ ] Human QA

---

# M10 — Production Hardening

- [ ] Tenant isolation audit
- [ ] Authentication audit
- [ ] Authorization audit
- [ ] Secret handling
- [ ] Webhook verification
- [ ] Rate limiting
- [ ] Observability
- [ ] Cost tracking
- [ ] Backup strategy
- [ ] Error monitoring
- [ ] Load testing
- [ ] Security testing

---

# Current Milestone

**M6 - Sequence and Follow-Up Foundation Slice**

# Current Task

**Campaigns, sequences, sequence steps, idempotent enrollment, due-step runner, and basic stop conditions implemented; ready for human sequence QA**

# Current Blockers

None recorded.

# Architecture Changes

Record significant changes here with:

- date
- decision
- rationale
- affected modules
- migration requirements

## 2026-09-06 - M0 persistence boundary

- decision: keep SQLite as the default local development database and document PostgreSQL as the production configuration path.
- rationale: M0 needs a reliable walking skeleton, not production database infrastructure.
- affected modules: `src/database`, repository modules under `src/modules`.
- migration requirements: future PostgreSQL work should add a PostgreSQL database-client adapter and versioned migrations.

## 2026-09-06 - M1 ingestion adapter boundary

- decision: implement CSV as the first ingestion adapter while keeping Lead Data Foundation independent from CSV-specific parsing.
- rationale: future customer-owned sources should produce the same normalized ingestion-row contract without changing lead domain logic.
- affected modules: `src/modules/data-foundation`, `src/api`, `public`.
- migration requirements: M1 adds `import_batches`, `import_rows`, `import_issues`, and additive lead provenance columns.

## 2026-09-07 - M2.0 intelligence evidence boundary

- decision: implement AI Lead Intelligence as an evidence-first deterministic foundation before adding research/LLM providers.
- rationale: the product must explain what is known, where it came from, confidence, missing data, signals, and recommended next step without fabricating intelligence.
- affected modules: `src/modules/lead-intelligence`, `src/api`, `src/database`, `public`.
- migration requirements: M2.0 adds version/status/readiness fields to `intelligence_snapshots` and adds `intelligence_evidence`, `intelligence_claims`, `intelligence_signals`, `intelligence_qualifications`, and `intelligence_recommendations`.

## 2026-09-07 - M2.0 state and UX hardening

- decision: separate lead lifecycle status, intelligence status, data readiness, recommendations, and outbound execution in API and UI.
- rationale: M2.0 is deterministic intelligence from customer-owned data only; it must not imply external verification, AI qualification scoring, or real outbound sending.
- affected modules: `src/modules/lead-intelligence`, `src/api`, `public`, `test`.
- migration requirements: no additional schema migration beyond the existing M2.0 additive intelligence tables and fields.

## 2026-09-07 - M2.1 research evidence adapter boundary

- decision: persist approved research/evidence adapter output in staging tables instead of writing directly into intelligence snapshots.
- rationale: provider adapters should produce normalized evidence, while the intelligence domain remains responsible for deciding when and how evidence affects snapshots, claims, signals, and recommendations.
- affected modules: `src/modules/lead-intelligence`, `src/api`, `src/database`, `test`.
- migration requirements: M2.1 adds `research_evidence_ingestions` and `research_evidence_items`.

## 2026-09-07 - M2.2 structured synthesis boundary

- decision: implement structured local synthesis and qualification over current snapshots and staged evidence before adding a real LLM provider.
- rationale: M2.2 needs evidence-grounded output contracts, persistence, idempotency, and evaluation tests without coupling the product to a specific model provider or implying unimplemented external research.
- affected modules: `src/modules/lead-intelligence`, `src/api`, `src/database`, `test`.
- migration requirements: M2.2 adds `intelligence_synthesis_runs`.

## 2026-09-07 - M2.3 recommendation intelligence boundary

- decision: implement evidence-grounded recommendation intelligence before M3 action planning.
- rationale: M2.3 should explain attention priority, segment, personalization context, and recommended next step from evidence without creating actions, bypassing policy, or implying outbound execution.
- affected modules: `src/modules/lead-intelligence`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M2.3 adds `intelligence_recommendation_runs`.

## 2026-09-07 - M3 next-best-action planning boundary

- decision: persist next-best-action plans separately from executable M0/M4 actions.
- rationale: M3 must turn recommendation intelligence into a policy-checked plan without creating outbound side effects or coupling planning to n8n/provider execution.
- affected modules: `src/modules/next-best-action`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M3 adds `next_best_action_plans`.

## 2026-09-07 - M4 outbound execution foundation

- decision: reuse and formalize the existing action/execution/handler/mock-n8n boundary, with M3 plan linkage and scoped callback history.
- rationale: M4 should prove reliable execution mechanics without adding real providers, approval queues, campaigns, sequences, or production n8n workflows.
- affected modules: `src/modules/outbound-automation`, `src/modules/handlers`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M4 adds action provenance columns, callback scope/history columns, and execution idempotency indexes.

## 2026-09-07 - M3.1 product UX consistency boundary

- decision: keep sandbox outbound execution foundation available for engineering validation, but remove execution-oriented controls and state from the normal customer product flow.
- rationale: the customer-facing MVP must clearly communicate customer data -> Lead Data Foundation -> Lead Intelligence -> Next Best Action -> Human review -> outbound later, without implying real providers, web research, LLM work, or sent messages.
- affected modules: `public`, `test`, `README.md`, `docs`.
- migration requirements: none.

## 2026-09-08 - M5 human approval boundary

- decision: add persisted `ActionApproval` state for approval-required outbound actions before introducing real providers, campaigns, or bulk sending.
- rationale: human approval must be a domain concept with auditable, idempotent decisions, not only a frontend button.
- affected modules: `src/modules/outbound-automation`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M5 adds `action_approvals`.

## 2026-09-08 - M6/M7 channel workflow foundation boundary

- decision: add provider-neutral channel activity, normalized mock inbound event intake, and persisted follow-up tasks before real providers, bots, voice agents, campaigns, or bulk outbound.
- rationale: inbound, outbound, and follow-up behavior must share application-owned state and idempotency rules before provider-specific integrations are introduced.
- affected modules: `src/modules/channels`, `src/modules/handlers`, `src/modules/outbound-automation`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M6/M7 foundation adds `channel_messages`, `inbound_events`, and `follow_up_tasks`.

## 2026-09-08 - M6 sequence workflow foundation boundary

- decision: add campaigns, sequences, sequence steps, workflow runs, idempotent enrollment, and an explicit due-step runner while reusing existing actions, approvals, handlers, and channel messages.
- rationale: sequence automation must not create a second outbound execution path or bypass human review/idempotency rules.
- affected modules: `src/modules/workflows`, `src/api`, `src/database`, `public`, `test`.
- migration requirements: M6 foundation adds `campaigns`, `sequences`, `sequence_steps`, and `workflow_runs`.
