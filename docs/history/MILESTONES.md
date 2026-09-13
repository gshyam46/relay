> Historical record archived on 2026-09-11. Use [current tasks](../TASKS.md), [review](../REVIEW.md), and [roadmap](../ROADMAP.md) for current readiness. Earlier claims below are retained as history.

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
- [x] ReplyClassifier — rule-based (`LocalReplyClassifier`) with an optional LLM classifier (`LlmReplyClassifier`) that falls back to the local one on any provider error; confidence/reason/suggested-next-step persisted as first-class columns on `inbound_events` and `channel_messages`, not just embedded JSON
- [x] Positive response handling foundation
- [x] Negative response handling foundation
- [x] Question handling foundation
- [x] Opt-out handling foundation
- [x] Human escalation — `follow_up_tasks.escalated` is a real column (not a `reason LIKE 'Escalated:%'` string match) driving the dashboard Attention queue; resolved via the existing complete/cancel follow-up actions
- [x] Intelligence update — a reply auto-triggers `IntelligenceService.runForLead`, adding a `LEAD_REPLIED_POSITIVE`/`_NEGATIVE`/`LEAD_ASKED_QUESTION`/`LEAD_OPTED_OUT` signal and surfacing it on the Lead 360 Intelligence tab and Conversations
- [x] Reply tests — `test/reply-intelligence.test.js` (classification persistence, escalation, signal generation, fingerprint/versioning, idempotency)
- [x] Human QA — verified live in-browser: simulated positive reply and low-confidence reply, confirmed badges/suggested-next-step on Conversations, Lead 360, and the Escalated follow-up badge on Outbound

---

# M8 — Additional Channels

- [x] Email handler — sandbox default; real send via SendGrid or Resend (`EmailAdapter`); real inbound replies via SendGrid Inbound Parse webhook (`POST /api/webhooks/sendgrid/inbound/:token`, multipart-parsed, reuses the full M7 reply pipeline); delivery/bounce tracking via the SendGrid Event Webhook (`POST /api/webhooks/sendgrid/events/:token`, mapped through `custom_args` back to the sending action, idempotent, org-scoped)
- [x] WhatsApp handler — adapter-ready (sandbox default, Meta Cloud API path implemented), not exercised against a real account this milestone
- [x] SMS handler — adapter-ready (sandbox default, Twilio path implemented), not exercised against a real account this milestone
- [x] Voice handler — adapter-ready (sandbox default, Twilio path implemented), not exercised against a real account this milestone
- [x] Human task handler
- [ ] CRM handler
- [x] Provider abstraction tests — `test/email-webhooks.test.js` (multipart parser, inbound webhook token auth, event webhook delivered/bounce/tracking-only, cross-tenant rejection, idempotency)
- [x] Channel failure tests — `mock_behavior` (`TRANSIENT_FAIL_ONCE`/`PERMANENT_FAILURE`) covers retryable vs. permanent failures; bounce webhook covers real post-send failure
- [ ] Human channel QA — real SendGrid account not yet connected to a live workspace; verified end-to-end against the local webhook routes with synthetic SendGrid-shaped payloads only

Known gap carried into M10: webhook auth today is an opaque per-org URL token, not SendGrid's ECDSA Event Webhook signature verification — adequate to block casual discovery, not a substitute for real signature verification before production traffic.

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

# React Frontend Migration (Phase 2)

- [x] Scaffold React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui in `client/`
- [x] Vite config with API proxy to backend (localhost:3000)
- [x] App shell with sidebar navigation
- [x] Workspace store (Zustand) and org switcher
- [x] API client with typed hooks (use-leads, use-intelligence, use-outbound)
- [x] Dashboard page with KPI cards
- [x] Leads page with search, pagination, Import CSV dialog, Add Lead dialog
- [x] Lead Detail page with intelligence, timeline, actions
- [x] Intelligence page with status filters and run controls
- [x] Intelligence Detail page (dedicated intelligence workspace per lead)
- [x] Outbound page with status filters
- [x] Conversations page (placeholder)
- [x] Activity page
- [x] Settings page (General, AI Provider, Email, WhatsApp, SMS, Telegram, Call)
- [x] CSV Import: fixed field names (csv_text, filename, default_phone_region), response shape, selected_row_ids
- [x] Timeline: fixed occurred_at → timestamp mapping
- [x] Intelligence navigation: Intelligence/Outbound rows navigate to /intelligence/:leadId
- [x] Lead Detail: added feedback toasts for Run Intelligence, Send Message, Schedule Follow-Up
- [x] AI Provider settings: shows connected provider status, supported providers list
- [x] TypeScript zero errors, lint pass, format pass
- [ ] Full end-to-end human QA of all pages
- [ ] Remove legacy `public/` frontend once React frontend is complete

# LLM Provider Integration

- [x] LLM provider abstraction (Groq, OpenAI, OpenRouter, Ollama)
- [x] AI status endpoint (`GET /api/ai/status`)
- [x] Settings API for channel and AI provider categories
- [x] Groq configured and verified (llama-3.1-8b-instant)
- [ ] LLM-powered synthesis (replace localSynthesisAgent)
- [ ] LLM-powered recommendations (replace localRecommendationAgent)
- [ ] LLM-powered message generation
- [ ] ReplyClassifier with LLM

# Workspace / Tabbed Record UX Correction

- [x] Point server static serving at `client/dist`; add `client:build` npm script; SPA fallback routing
- [x] Merge Lead Detail + Intelligence Detail into one page; fix findings/recommendation data-shape bug
- [x] Server-side bulk intelligence pipeline (`POST /api/intelligence/bulk-run`) + real dashboard attention queue
- [x] Auto-run background worker; auto-complete mock/sandbox channel executions
- [x] SMS + Voice mock channels; free inbound-reply simulator; real cross-lead Conversations inbox
- [x] Outbound tabbed queues (Ready/Approved/Scheduled/Sent/Replies/Follow-ups/Failed) + bulk approve
- [x] Split `/leads/:id` into Overview / Intelligence / Outbound & Activity tabs, addressable via `?tab=`
- [x] Intelligence and Outbound workspace rows (and Dashboard attention items) deep-link to the matching tab
- [x] Intelligence workspace: attention-priority breakdown widget (HIGH/MEDIUM/LOW) added alongside existing stat cards; analyzed/not-analyzed/pending/failed/recommendations/action-ready counts
- [x] Outbound workspace: summary row now covers total/ready-for-review/approved/scheduled/sent/replies/follow-ups-due/failed
- [x] Terminology pass: "Analyze lead" / "Refresh intelligence" (context-sensitive on one CTA), removed "NBA"/"Run All Pending"/"NBA pipeline" customer-facing jargon
- [x] Provenance rendered human-readable (`Imported from CSV (filename) · Row 18`) in Overview; raw claim/evidence IDs never shown, only source_type + field labels
- [x] Distinguish customer-provided lead data (Overview: "Lead Information", explicitly labeled "not AI-generated") from AI-generated analysis (Intelligence tab: readiness, qualification, recommendation, evidence) — dropped the old "Intelligence Findings" section that just echoed lead fields
- [x] Per-lead Outbound & Activity tab: chat-bubble conversation thread (sender side by direction, channel badge, timestamp, status dot) sourced from the existing timeline API's `kind` field; follow-ups rendered as task cards with Mark done/Cancel
- [x] General UX pass: persistent contact-hero header across tabs, tab badge counts, consistent empty states
- [x] Full functional verification: individual + bulk Intelligence, individual + bulk Outbound (approve/reject/execute via new per-lead UI), deep links, callbacks/auto-complete, follow-ups, inbound events, conversation display, tenant isolation (cross-org 404 verified), restart persistence, full test suite (134/137, same 3 pre-existing failures)

### Bugs found and fixed during this verification pass
- Next-best-action "current plan" lookup included the lead's live `status` in its idempotency fingerprint. Since any unrelated action completing on a lead flips its status (e.g. NORMALIZED → ACTIVE), this silently orphaned every already-planned NBA record the moment *anything* executed — `next_best_action_status` would report `NOT_RUN` even though a real `PLANNED` plan (and sometimes an already-executing action) existed. Fixed in `nextBestActionService.js` by dropping `lead_status` from the fingerprint. This was latent before this session — the new always-on background worker (added this session) is what made it fire on effectively every lead.
- `Worker.runOnce()` briefly grew a bundled "auto-complete mock executions" step; in tests that share a db across multiple `test()` blocks in one file, this swept up EXECUTING actions left over from an earlier test, breaking two `m0-flow.test.js` assertions. Decoupled into a separate `Worker.autoCompleteMockExecutions()` method called only from the live-server background interval, leaving `runOnce()`'s behavior unchanged for every other caller (tests, `WorkflowsService`, `POST /api/worker/run`).
- The new per-lead Outbound & Activity tab's approve/reject/execute/follow-up-complete/follow-up-cancel mutations weren't invalidating the `lead-outbound`/`lead-timeline` query keys (those hooks didn't exist yet when the original mutations were written), so the UI silently didn't refresh after a successful action until a manual reload. Fixed by adding the missing `invalidateQueries` calls across `use-outbound.ts`, `use-follow-ups.ts`, and `use-intelligence.ts`.

# Current Milestone

**Workspace/Tab UX Correction — complete and verified**

# Current Task

**UX correction shipped and verified end-to-end (see checklist above). Next: decide the next feature phase — see the architecture-change entry below for a starting menu of options to brainstorm from before committing to one.**

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

## 2026-09-08 - React frontend migration

- decision: build a React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui frontend in `client/` alongside the legacy `public/` frontend.
- rationale: the vanilla HTML/CSS/JS frontend cannot deliver a premium SaaS experience. React provides component reuse, TypeScript type safety, and a modern ecosystem. Both frontends consume the same `/api/*` endpoints, enabling gradual migration.
- affected modules: `client/` (new), `src/api/app.js` (settings categories), Vite proxy config.
- migration requirements: `client/` requires `npm install` and runs on port 5173. Backend API unchanged. Legacy `public/` remains until React frontend is feature-complete.

## 2026-09-08 - LLM provider abstraction

- decision: add multi-provider LLM support (Groq, OpenAI, OpenRouter, Ollama) behind environment-based configuration, with deterministic local agents as fallback.
- rationale: AI-powered synthesis, recommendations, and message generation require LLM access, but the system must remain functional without an API key for local development and testing.
- affected modules: `src/modules/handlers/` (LLM provider), `src/modules/ai/` (new), `src/api/app.js` (AI status endpoint, settings categories).
- migration requirements: optional `.env` file with `LLM_PROVIDER` and provider API key. Server started with `node --env-file=.env src/server.js`. No database changes.

## 2026-09-08 - Intelligence as dedicated workspace (superseded 2026-09-08, see below)

- decision: create a dedicated Intelligence Detail page (`/intelligence/:leadId`) separate from Lead Detail (`/leads/:id`). Intelligence and Outbound row clicks navigate to the intelligence view, not the leads view.
- rationale: Intelligence is the primary workspace for understanding leads; Leads is for data management. Keeping them separate avoids confusing navigation and lets each page focus on its purpose.
- affected modules: `client/src/pages/intelligence-detail.tsx` (new), `client/src/pages/intelligence.tsx`, `client/src/pages/outbound.tsx`, `client/src/App.tsx`.
- migration requirements: none — new frontend route only.
- superseded by: two separate lead-detail-shaped pages duplicated fetch logic, split "why did AI recommend this" across two URLs, and left Conversations/timeline disconnected from the recommendation that produced them. Replaced same-day by a single unified `/leads/:id` page. See next entry for the current, further-refined shape.

## 2026-09-08 - Wire React client as the live frontend; unify Lead + Intelligence into one page

- decision: point the server's static file serving at `client/dist` instead of legacy `public/`; merge `lead-detail.tsx` and `intelligence-detail.tsx` into one `/leads/:id` page; fix the intelligence-detail data-shape bug (findings live on the synthesis object, not the snapshot, so the page always showed "no structured findings"); add a real bulk `/api/intelligence/bulk-run` pipeline and `/api/dashboard/attention` queue; auto-run the background worker on an interval so approved actions execute without a dev-tools button; auto-complete mock/sandbox channel executions (nothing was ever calling the completion callback for them); add SMS and Voice as real mock channels (`SEND_SMS`, `SEND_VOICE_CALL`) alongside existing Email/WhatsApp; add a free "simulate inbound reply" control and a real cross-lead Conversations inbox; restructure Outbound into tabbed queues (Ready for review/Approved/Scheduled/Sent/Replies/Follow-ups/Failed) with bulk approve.
- rationale: `client/` was an 80%-built, fully-wired React app that nobody had ever pointed the server at — `public/` (thin, single-lead-centric, with a permanently visible developer-controls panel) was still the live product. Finishing and shipping the already-better-shaped app was faster and more coherent than redesigning the legacy one.
- affected modules: `src/api/app.js`, `src/server.js`, `src/shared/http.js` (SPA fallback), `src/modules/events/worker.js`, `src/modules/handlers/channelRouter.js`, `src/modules/channels/channelContract.js`, `src/modules/channels/channelWorkflowService.js`, `src/modules/outbound-automation/actionContract.js`, `client/src/pages/*`, `client/src/hooks/*`.
- migration requirements: `npm run client:build` (new root script) before `npm start` in any environment serving the app for real; `public/` is left in the repo untouched but is no longer served.
- known follow-up not done in this pass: `EmailAdapter`'s real Resend/SendGrid HTTP calls are still dead code — `ChannelRouter#routeEmail` never calls them. Wiring that in requires making the action-execution call chain (`ActionExecutor.execute` → `Worker.runOnce` → `WorkflowsService`/`OutboundAutomationService` call sites) async, which is a wider, riskier change than this pass took on.

## 2026-09-08 - Three workspaces + tabbed 360 lead record

- decision: reshape the product around three distinct top-level workspaces — Leads (list/manage), Intelligence (bulk analysis workspace with KPIs), Outbound (bulk execution workspace with KPIs) — plus one individual-record page, `/leads/:id`, with Overview / Intelligence / Outbound & Activity tabs addressable via `?tab=`. Intelligence and Outbound workspace rows deep-link straight to the matching tab, never to a bare, tab-less lead page.
- rationale: the prior unified page (previous entry) put everything on one long scroll with no way to land a user directly on "why did AI recommend this" vs "what's the outbound status" from the workspace they came from; it also blurred customer-provided lead data (name/email/phone/source) together with actual AI-generated analysis (readiness, qualification, recommendation) under one "Intelligence Findings" heading, and showed raw provenance IDs (`import_batch:import_row`) as if they were content.
- affected modules: `client/src/App.tsx`, `client/src/pages/lead-detail.tsx` (rewritten with tabs), `client/src/pages/intelligence.tsx`, `client/src/pages/outbound.tsx`, `client/src/pages/dashboard.tsx`, `client/src/hooks/*`, `src/modules/next-best-action/nextBestActionService.js` (fingerprint bug fix), `src/modules/events/worker.js` (auto-complete decoupled from `runOnce`), `src/modules/channels/channelWorkflowService.js` (contextual message summaries), `src/modules/outbound-automation/actionsService.js` (manual-action copy).
- migration requirements: none — no backend contract changes; two real bugs were fixed along the way (see `## Bugs found and fixed` above the checklist) — both proven safe by the full test suite staying at the same 3 pre-existing, unrelated failures.
- status: shipped and verified end-to-end in-browser (bulk analyze, tab deep-links, approve/reject/execute, follow-up complete/cancel, inbound simulation, tenant isolation, restart persistence) plus the automated suite. Not moving to a new feature phase until this was true — see the "Next phase options" entry below for what's on the table now that it is.

## 2026-09-08 - Next phase: options to brainstorm from (not yet decided)

Recorded here as a starting menu for the next planning conversation, not a commitment. Ranked roughly by how directly each one builds on what's now solid vs. how much new surface it opens:

1. **Close the loop on `M7` reply intelligence** — `ReplyClassifier`, human escalation, and "intelligence update on reply" are the three items still unchecked in `M7`. The inbound pipeline (mock events → follow-ups → conversation thread) is now real and visibly working; classifying real reply *text* (not just a hand-picked event type) and feeding it back into the lead's intelligence/recommendation is the most natural next increment.
2. **Real provider wiring for one channel, opt-in** — `EmailAdapter`'s Resend/SendGrid code is written but dead (see the known-follow-up note above); making it live behind the existing Settings toggle would be the first channel that leaves "sandbox" for real, without touching the other three.
3. **Sequences UX** (`M6` — campaigns/sequences/wait-steps exist server-side with real tests, but there is no frontend for building or watching one run). Two of the three pre-existing test failures (`workflows.test.js`) live in this area and are worth fixing alongside giving it a UI, not before — they're pre-existing and unrelated to this session's work but block confidently building on top of the runner.
4. **Lead Discovery (`M9`)** — explicitly scoped as an optional plugin in `CLAUDE.md`; only worth picking up once the core loop (this milestone) is proven, which it now is.
5. **Auth/production hardening (`M10`)** — tenant isolation, rate limiting, secrets, observability. Not urgent for continued local/demo use, but the actual gate before this could run for a real customer.
- rationale for logging this now: the user asked for an ongoing "architect" role — surfacing a menu instead of unilaterally picking one keeps the next milestone a decision rather than a default.

## 2026-09-09 - Phase 5: production foundation (async DatabaseClient + PostgreSQL)

- decision: make the `DatabaseClient` contract asynchronous and add a PostgreSQL
  adapter, versioned migrations, environment-driven configuration, and structured
  logging/errors.
- rationale: the contract was synchronous because `node:sqlite` is synchronous,
  which made `CLAUDE.md`'s and `ARCHITECTURE.md`'s claim — "enables a future
  PostgreSQL adapter without changing any module code" — impossible to keep. Every
  PostgreSQL driver is asynchronous, and 200 call sites across 19 repositories
  consumed query results directly as values. The alternatives were a
  sync-over-async worker-thread bridge (which serialises every query and blocks
  the event loop, a permanent throughput ceiling) or staying on SQLite (no managed
  backups, single instance only). Converting now was chosen deliberately because
  every later phase builds on this layer, and the cost only grows.
- affected modules: `src/database/` (split into `database.js`, `sqliteClient.js`,
  `postgresClient.js`, `sql.js`, `migrate.js`, `migrations/`), all 19 repositories,
  every service that consumes them, `src/api/app.js`, `src/modules/events/worker.js`,
  `src/modules/handlers/*`, `src/server.js`, `src/config.js`, `src/shared/http.js`,
  new `src/shared/logger.js` and `src/shared/errors.js`, `scripts/`, `test/`.
- migration requirements: `npm install` (adds `pg`, the project's first runtime
  dependency). No schema change: migration `0001_baseline_schema` is the existing
  schema, written idempotently so existing development databases adopt the
  migration runner without being rebuilt. Setting `DATABASE_URL` is the entire
  switch to PostgreSQL.
- deviation from "zero npm dependencies": `pg` is now a runtime dependency. The
  zero-dependency property was worth keeping while the database was SQLite; it is
  not worth hand-rolling the PostgreSQL wire protocol (TLS + SCRAM-SHA-256 auth +
  connection pooling) to preserve. This is recorded as a deliberate trade, not an
  oversight.

### Bugs found and fixed along the way

- `sendError()` returned any error's `.message` verbatim, including unhandled
  defects. In production that would have leaked SQL fragments and internal state
  to browsers. Expected (4xx) errors still return their message; unexpected (5xx)
  ones now return a generic message plus a request id, with the real error in the
  structured log only.
- `X-Forwarded-Proto` was trusted unconditionally when deciding whether to set the
  `Secure` flag on session cookies. A direct client could claim HTTPS and be
  issued a Secure cookie over plaintext. Now gated on `TRUST_PROXY`, off by
  default in local development.
- The background worker interval had no overlap guard. Harmless while every query
  was synchronous; with awaited network round trips, a slow tick could have had
  the next tick start beside it and execute the same action twice.
- `client:build` was broken on `main` (`TS6133: 'prev' is declared but its value
  is never read` in `client/src/pages/outbound.tsx`), so the frontend the server
  serves could not be rebuilt. Fixed.
- `npm run smoke` was broken: it still called `POST /api/organizations`, a route
  removed when session auth landed, so the smoke check had been failing with a 401
  rather than exercising anything. It now registers a workspace and carries the
  session cookie, and additionally asserts `/api/health/ready` reports no pending
  migrations.

### Known product gaps found while verifying end to end (for the Phase 5 UX pass)

- **"Analyze eligible leads" is permanently disabled.** `client/src/pages/intelligence.tsx:171`
  disables it on `!totals.not_run`, where `not_run` counts leads with no snapshot
  at all — but every lead gets an initial readiness snapshot at creation, so that
  count is always 0. The server's own eligibility rule (`POST /api/intelligence/bulk-run`)
  is different and correct: leads without a *READY recommendation*. The bulk
  workspace action is therefore unusable exactly when it is needed.
- **The per-row "Run" in the Intelligence workspace only calls
  `/intelligence/run`**, not synthesis -> recommendation -> next-best-action. A lead
  cannot be taken to "recommendation ready" from that workspace at all; only the
  lead detail page's "Refresh intelligence" runs the full pipeline.
- **Copy mismatch on the lead detail page**: the empty states say `Click "Analyze
  lead" above` but the button is labelled "Refresh intelligence".
- The Add Lead dialog has no `role="dialog"` and is not focus-trapped.

### Verification

- `npm run ci`: lint + format + 180 tests, 176 pass, 0 fail, 4 skipped (the
  PostgreSQL integration tests, which need `TEST_DATABASE_URL`).
- Browser end-to-end against a real server on an isolated port/database
  (`npm run dev:e2e`): register -> create lead -> full intelligence pipeline ->
  outbound action created -> approve -> execute (sandbox email) -> conversation
  thread -> auto-scheduled follow-up -> simulated inbound reply classified as
  "Question / Needs reply". Zero 5xx across the run. Server restarted mid-session:
  session, data and migration state all survived.
- **Not verified: PostgreSQL against a real server.** No Docker or PostgreSQL was
  available on the development machine. `test/postgres-adapter.test.js` exists and
  covers migrations, the client contract, numeric-type coercion, unique
  constraints, and a full API flow — it runs as soon as `TEST_DATABASE_URL` points
  at a throwaway database, and is the gate for the Phase 2 staging deploy.

## 2026-09-09 - Phase 2: PostgreSQL verified for real, deployment prepared

- decision: chose **Supabase (PostgreSQL)** over MongoDB, and proved the adapter by running
  the entire test suite against a real PostgreSQL server rather than only the four
  adapter-specific tests.
- rationale for Postgres over Mongo: the data is relational and the relations are
  load-bearing. Idempotency — the property this codebase claims "everywhere" — is
  implemented as `UNIQUE(organization_id, idempotency_key)` constraints across imports,
  actions, executions, callbacks, channel messages and workflow runs; that is the
  database enforcing correctness, not the application. Multi-tenancy is
  `organization_id` foreign keys on all 22+ tables, and the dashboard is
  COUNT/SUM/GROUP BY/JOIN. Mongo would mean rewriting all 19 repositories and
  re-implementing those uniqueness guarantees in application code, where they would be
  racy. Document stores earn their place with schema-fluid, denormalized, aggregate-shaped
  data, which this is the opposite of.
- affected modules: `test/helpers/testClient.js` (PostgreSQL mode), `scripts/run-postgres-tests.js`
  (new), `.github/workflows/ci.yml`, `render.yaml` (new), `docs/DEPLOYMENT.md` (new),
  `package.json`.
- migration requirements: none.

### The Phase 1 verification gap is closed

The first Phase 1 report flagged that the PostgreSQL adapter had never run against a real
PostgreSQL, because no Docker or database was available. That turned out to be wrong:
PostgreSQL 18 was already installed on the machine as a running Windows service. Rather
than use it (its superuser password is unknown, and it holds unrelated data), a throwaway
cluster was created with `initdb --auth=trust` on port 55432, used, and discarded.

Result: **all 180 tests pass against real PostgreSQL 18.1**, not just the 4 adapter tests —
imports, intelligence, synthesis, recommendations, next-best-action, outbound, approvals,
workflows, channel workflows, bulk operations, auth, and every restart-persistence test.

`RELAY_TEST_PG=1` (via `npm run test:pg`) points every `startClient()` at PostgreSQL, giving
each test client its own schema via `search_path` in the connection string's `options`.
Schemas are milliseconds where databases are hundreds, and the suite starts ~50 servers.

### Bug found by running the full suite on PostgreSQL

- 11 "survives restart" tests failed on the first PostgreSQL run. The cause was in the new
  test harness, not the product: those tests call `startClient()` twice with the same
  database file to simulate a restart, and the harness was handing out a fresh random schema
  on each call, so the "restarted" server opened an empty database. Schema names are now
  derived from the database path (`:memory:` gets a random, dropped-on-stop schema; a file
  path gets a deterministic, persistent one), which mirrors SQLite's semantics exactly.
  Worth recording because it is precisely the class of difference that only a full
  cross-engine run surfaces.

### CI now covers what it was missing

Three jobs instead of one:

- **SQLite** — lint, format check, full suite. The fast signal, and the engine local
  development uses.
- **PostgreSQL** — the full suite against a `postgres:16` service container. Without this, a
  query that only works on SQLite reaches production.
- **Client** — typecheck and build. `client:build` had been broken on the branch and nothing
  caught it, even though the server serves `client/dist`.

Note: `node --test` auto-discovers any file matching `test-*.js` or `*-test.js` anywhere in
the repository. A helper script initially named `scripts/test-pg.js` was therefore picked up
as a test file and failed the suite; it is now `scripts/run-postgres-tests.js`.

### Deployment artifacts

- `render.yaml` — blueprint for the staging web service: client build in the build command,
  `npm run db:migrate` as `preDeployCommand` (so a bad migration fails the deploy instead of
  taking the service down), `/api/health/ready` as the health check (503 while migrations are
  pending, so a half-deployed instance never takes traffic), `TRUST_PROXY` and
  `FORCE_SECURE_COOKIES` on. Secrets are `sync: false` and never committed.
- `docs/DEPLOYMENT.md` — the runbook: why the Supabase *pooler* string (port 6543) is the one
  for `DATABASE_URL` and the direct string (5432) is for migrations and testing, the exact
  secrets to set, a 10-step post-deploy verification checklist, and operational notes on
  scaling past one instance (the in-process worker must be disabled on extra instances, or
  split into its own service, or instances will race to execute the same actions), rollback,
  and backups.

### Still blocked on account creation

Creating the Supabase project and the Render service requires Shyam's accounts and produces
secrets. Everything up to that point is done and locally proven.

## 2026-09-09 - Phase 2 (continued): deployment tooling, verified against real PostgreSQL

- decision: build the deployment verification path as scripts that read secrets from the
  environment or a gitignored `.env`, never from arguments or chat, and rehearse the whole
  Supabase/Render sequence locally before any account exists.
- rationale: the deploy sequence is where a mistake is most expensive and least reversible.
  Every step that could be proven without Shyam's credentials was proven, so what remains for
  him is account creation and dashboard configuration rather than debugging.
- affected modules: `scripts/verify-deployment.js` (new), `scripts/run-postgres-tests.js`,
  `test/postgres-adapter.test.js`, `test/helpers/testClient.js`, `render.yaml`,
  `docs/DEPLOYMENT.md`, `.env.example`, `CLAUDE.md`, `README.md`, `package.json`.
- migration requirements: none.

### A data-loss footgun, found and removed

`test/postgres-adapter.test.js` ran `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` in
two places. That was tolerable while the documented invocation pointed at a throwaway
database — but the instruction for this phase was to run `npm run test:pg` against **the
configured `DATABASE_URL`**, which is the staging database. Following the documented
workflow would have destroyed it.

Every test now creates its own schema (`relay_adapter_*`), works inside it via `search_path`,
and drops it in `t.after()` so a failing assertion still cleans up. Nothing touches `public`.
This was verified rather than assumed: after a full 180-test run against a database whose
`public` schema held a migrated Relay install, `public` still had all 33 tables, the
`schema_migrations` row still had its original timestamp, and zero test schemas were left
behind.

### One SSL variable, not two

The test harness read `TEST_DATABASE_SSL` while the application reads `DATABASE_SSL`. Setting
only `DATABASE_SSL=disable` in `.env` — the natural thing to do — left the tests trying TLS
against a non-TLS server, failing 96 tests with "The server does not support SSL connections".
`TEST_DATABASE_SSL` now falls back to `DATABASE_SSL`, so one entry configures both, and the
override still exists for when the test database genuinely differs.

Worth recording because it only appeared when the tooling was exercised the way a person
would actually use it, rather than with variables set explicitly on the command line.

### Secrets handling

- `npm start`, `db:migrate`, `db:status`, `test:pg` and `verify:deploy` all run with
  `--env-file-if-exists=.env`. `node --env-file=.env src/server.js` is no longer needed, and
  connection strings stay out of shell history.
- `verify-deployment.js` and `run-postgres-tests.js` print only host and database name.
  `describeConfig()` was already redaction-safe and is covered by a test asserting the
  password never appears in the boot summary.

### `render.yaml` validated

- `branch` corrected to `mvp` (it still said `intial-build`, which would have deployed the
  wrong branch or failed outright).
- Client install changed to `npm --prefix client ci --include=dev`. vite and typescript are
  devDependencies, which npm omits when `NODE_ENV=production`. It is `staging` here so they
  would install anyway, but the build would break the day the blueprint is copied to
  production.
- Both lockfiles confirmed in sync (`npm ci --dry-run`), since `npm ci` fails the build on
  drift.
- The blueprint's build sequence was run locally end to end and produces `client/dist`.
- Boot gating confirmed: with `NODE_ENV=staging` and no `DATABASE_URL`, both `src/server.js`
  and `scripts/db-migrate.js` log a structured `boot.invalid_configuration` and exit **1**,
  which is what makes Render fail the deploy rather than serve a broken instance.

### Rehearsal against a real PostgreSQL

A throwaway cluster (`initdb --auth=trust`, port 55433, deleted afterwards — the machine's own
PostgreSQL 18 service was never touched) stood in for Supabase for the full sequence:

1. `npm run verify:deploy` — all seven checks pass, 33 tables, 68 indexes.
2. `npm run test:pg` — **180/180**, then cleaned up 11 leftover schemas.
3. `npm run verify:deploy` again — idempotent, "already up to date".
4. `npm start` against PostgreSQL — boots, `/api/health/ready` reports ready.
5. A live `POST /api/auth/register` — the row lands in PostgreSQL.
6. Session cookie correctly has **no** `Secure` flag locally (no TLS, `TRUST_PROXY` off in
   development), which confirms the proxy gate behaves as designed rather than always-on.

### Not done

- No Supabase project and no Render service exist — both need Shyam's accounts. The exact
  remaining steps are in `docs/DEPLOYMENT.md`.
- Graceful SIGTERM shutdown is implemented but was not exercised: Windows does not deliver
  SIGTERM the way Linux does, so it will first be exercised on Render.
- No product features were added in this phase, by instruction.

## 2026-09-10 - Phase 3 (M7): reply intelligence + Intelligence workspace defects

- decision: close M7 by making an inbound reply update the lead's recommendation (not merely
  invalidate it), and fix the two Intelligence workspace defects that made the bulk pipeline
  unreachable from the UI.
- rationale: the inbound half of M7 (classification, escalation, follow-ups, conversation
  threading) was already real. What was missing was the loop closing: a reply changed the
  snapshot, which made the existing synthesis and recommendation stale, and nothing rebuilt
  them — so a lead sat showing a recommendation that predated what they had just said.
- affected modules: `src/api/app.js`, `src/modules/events/worker.js`,
  `src/modules/channels/channelWorkflowService.js`, `client/src/hooks/use-intelligence.ts`,
  `client/src/pages/intelligence.tsx`, `client/src/pages/lead-detail.tsx`,
  `test/intelligence-workspace.test.js` (new), `test/reply-classifier.test.js` (new),
  `test/reply-intelligence.test.js`.
- migration requirements: none.

### Intelligence workspace defects

**"Analyze eligible leads" was permanently disabled.** The button disabled on
`!totals.not_run`, where `not_run` counts leads with no intelligence *snapshot* — but the
worker creates a readiness snapshot for every lead within seconds of creation, so that count
is effectively always 0. The server's own rule was different and correct: leads without a
READY recommendation *for their current inputs*.

Fixed by extracting one `collectEligibleLeadIds()` helper used by **both**
`POST /api/intelligence/bulk-run` and `GET /api/intelligence/summary`, so the button and the
endpoint cannot drift apart again. The summary now returns `totals.eligible_for_analysis` and
`eligible_lead_ids`; the client passes those exact ids back, so a bulk run does not make the
server scan for eligibility twice. The "Not analyzed" stat card became "Needs analysis" for
the same reason — it was reporting a number that was always zero.

**Per-row "Run" only ran the readiness snapshot.** It called `/intelligence/run`, so a lead
could never reach "recommendation ready" from the workspace at all. It now calls the bulk
endpoint with a single id, which is the one server-side definition of the pipeline order.
The button reads "Analyze" / "Re-analyze" to match what it does.

`useRunFullPipeline` (used by the lead detail page) previously issued five sequential requests
from the browser — a second definition of the pipeline order that could leave a lead
half-analysed if one request failed. It now delegates to the same single endpoint.

Empty states on the lead detail page said `Click "Analyze lead" above` while the button read
"Refresh intelligence" depending on state; they now use the button's actual current label.

### Reply -> intelligence and recommendation

An inbound reply now does two things, deliberately split by cost:

1. **Inline**, on the write path: re-run the readiness snapshot, so the reply appears as a
   signal immediately. Deterministic, cheap, and wrapped so it can never fail the provider's
   webhook.
2. **Queued**, as a `LeadReplyReceived` domain event: re-run synthesis -> recommendation ->
   next best action. This is the expensive half (with an LLM configured it makes network
   calls), so it belongs on the retryable event queue rather than inside a webhook. A slow or
   failing re-analysis can never make a provider see a failed webhook and redeliver.

Two boundaries were drawn explicitly and are covered by tests:

- **Re-analysis stops at planning.** A plan is an opinion; turning it into a queued outbound
  message stays a human decision, so a reply can never cause the system to send something on
  its own.
- **An opted-out or suppressed lead is not re-analysed** into a fresh reason to contact them.
  The skip is recorded in the audit log rather than happening silently.

Low-confidence escalation already existed (the `escalated` column on `follow_up_tasks`, and
the high-priority attention queue) and is now covered by dedicated tests rather than only
incidentally.

### Bug found while testing: lead status could be resurrected

`LeadCreated` handling wrote `status = NORMALIZED` unconditionally. That event can be
processed well after it was queued — a backed-up queue, a restart, a worker that was disabled —
and by then the lead may have replied (ACTIVE), converted, or **opted out**. Processing the
stale event would put an opted-out lead back into the normal outbound flow. It now only
normalises a lead still in `NEW`.

This surfaced because a test asserted an opted-out lead stays opted out, and the assertion
failed for a reason that had nothing to do with the feature being tested.

### Tests

- `test/reply-classifier.test.js` (new, 9 tests) — dedicated coverage of the classifier
  itself: opt-out precedence over affirmative wording ("yes please unsubscribe me" is an
  opt-out, not a positive reply), each intent category, LOW-confidence UNKNOWN as the
  escalation trigger, null/empty input, auditability (every result carries a reason and a
  next step), case/whitespace tolerance, and purity.
- `test/intelligence-workspace.test.js` (new, 4 tests) — the eligibility parity invariant
  (what the summary advertises is exactly what bulk-run processes), a fresh lead being
  eligible despite having a snapshot, single-lead analysis running the complete pipeline, and
  tenant scoping.
- `test/reply-intelligence.test.js` — four more: recommendation regenerated after a reply,
  no outbound action created by re-analysis, opted-out leads skipped, and a redelivered
  webhook not queuing a second re-analysis.

### Verification

199 tests: 195 pass + 4 PostgreSQL-only skipped on SQLite, **199/199 on real PostgreSQL**.
Verified live in a browser: three leads created, `not_run: 0` while
`eligible_for_analysis: 3` (the exact bug condition), button enabled and labelled
"Analyze 3 eligible leads", per-row Analyze taking one lead to a planned next action, and a
reply moving the recommendation READY -> stale -> regenerated with a new id.

## 2026-09-10 - Phase 4 (M8): email as the first real production channel

- decision: make email production-ready end to end, keeping sandbox the default, without
  adding any other channel.
- rationale: one channel that genuinely works — configured safely, sending correctly, handling
  failure, retry and redelivery — is worth more than four that are almost wired.
- affected modules: `src/modules/handlers/channelRouter.js`, `src/modules/handlers/emailAdapter.js`,
  `src/modules/settings/secretSettings.js` (new), `src/api/app.js`,
  `test/email-channel.test.js` (new), `test/email-webhooks.test.js`.
- migration requirements: none.

### Correction to an earlier note

`docs/TASKS.md` recorded that "`EmailAdapter`'s real Resend/SendGrid HTTP calls are still dead
code — `ChannelRouter#routeEmail` never calls them". That was true when written but has not
been for some time: `ChannelRouter` reads the per-organization provider setting and routes to
the adapter whenever it is anything other than `sandbox`. The wiring existed; what was missing
was everything around it being fit to point at real recipients.

### Credentials no longer reach the browser

`GET /api/settings` returned every stored setting, including the provider `api_key`, in
plaintext. The Settings page renders it into a password input, so **every settings page load
put a live provider credential into the browser** — reachable by any XSS, browser extension,
screen share, or client-side error reporter. The key is only ever needed server-side.

`src/modules/settings/secretSettings.js` now masks credential-shaped keys on read and returns a
`<key>_configured` boolean so the UI can still show what is set. The other half matters just as
much: a secret submitted back as the mask means "unchanged" and is dropped, so saving the form
after editing only the from-address does not overwrite the real key with the mask. Submitting
an empty string still clears it deliberately.

### The subject line was the body

`#routeEmail` passed `bodyFor(payload)` as **both** the subject and the body, so a real email
would have gone out with its entire message as the subject line. There is now a real
`subjectFor()`: an explicit `subject` on the action payload (including a human-reviewed edit)
wins, otherwise a short line that names the company when known.

### Other correctness work on the real path

- **Idempotency.** The router passes `relay-action-<action id>` as Resend's `Idempotency-Key`.
  The id is stable across retries of the same action, so retrying an attempt that actually
  succeeded but whose response was never seen does not deliver twice.
- **Plain text was being sent as raw HTML.** The stored message is plain text; sending it as
  `html` swallowed line breaks and let a stray `<` mangle the message. Both providers now get
  a real `text/plain` part plus an escaped HTML part, so lead-supplied data cannot inject
  markup into an outgoing email either.

### Tests

`test/email-channel.test.js` (new, 12 tests) stubs `fetch`, so the real provider path is
exercised without a byte leaving the machine and without an API key:

- sandbox default makes **no** HTTP call at all;
- a configured Resend send: correct URL, auth header, idempotency key, normalized recipient,
  a subject that is not the body, and both content parts;
- an explicit payload subject overriding the generated one;
- lead data cannot inject markup into the HTML part;
- a 5xx leaves the action RETRYING and the retry succeeds;
- a 4xx BLOCKS the action rather than retrying a bad API key forever;
- a missing key and a lead with no email address both fail *before* any network call;
- SendGrid's two content parts and the `custom_args` the Event Webhook needs to attribute a
  delivery back to the right action and tenant;
- credentials masked on read, preserved across a save that did not retype them, and clearable.

`test/email-webhooks.test.js` gains an assertion that a redelivered inbound webhook does not
queue a second `LeadReplyReceived`, so a provider retrying does not cost an extra pass of the
whole intelligence pipeline each time.

### Verification

211 tests: 207 pass + 4 PostgreSQL-only skipped on SQLite, **211/211 on real PostgreSQL**.

### Deliberately not done

- No other channel was touched. SMS, WhatsApp and voice remain sandbox-only by default and
  their adapters are unchanged.
- **No real provider send has been made.** These tests prove what would be sent; they do not
  prove Resend accepts it. That needs an API key and a verified sending domain, and is a
  staging step.
- Webhook signature verification is still not implemented — the SendGrid routes authenticate
  with an opaque per-organization token in the URL, not a signature. Recorded in
  `docs/DEPLOYMENT.md` as an outstanding `M10` item.

## 2026-09-10 - Phase 5: product UX, and the message a lead actually receives

- decision: finish the existing product surface without changing its scope, and fix the one
  thing that made both the conversation view and the real email channel wrong — outbound
  messages containing our internal reasoning rather than customer-facing copy.
- affected modules: `src/modules/outbound-automation/messageComposer.js` (new),
  `src/modules/outbound-automation/outboundAutomationService.js`,
  `src/modules/channels/channelWorkflowService.js`, `src/api/app.js`,
  `client/src/pages/outbound.tsx`, `client/src/pages/conversations.tsx`,
  `client/src/pages/lead-detail.tsx`, `test/message-composer.test.js` (new),
  `test/channel-workflow.test.js`.
- migration requirements: none.

### The outbound message was internal reasoning

An outbound action's payload carried only `title` and `rationale` — "Prepare outbound review",
"Use the evidence-backed intelligence to prepare the next outbound review. No outbound action
is created yet." The channel router falls back to `rationale` for the message body, so:

- the sandbox conversation thread read like an audit log, and
- **once a real email provider was configured, that internal reasoning is what would have been
  emailed to the lead.**

This was found by looking at the seeded product rather than by any test, and it undercut both
Phase 4 (a real channel is worthless if it sends the wrong text) and Phase 5 (conversations
cannot look like conversations if the messages are notes to ourselves).

`messageComposer.js` now composes the copy, deterministically, with no LLM required — the same
pattern as `localSynthesisAgent`. It is grounded by the same rule as the intelligence agents:
it personalises from the lead's own record (first name, company, the channel they came in
through) and states nothing else. It never invents a price, a product, a timeline, a mutual
contact, or a claim about intent. Where it cannot ground something it leaves it out, because a
shorter message is correct and an invented one is not. It also reads the lead's latest
classified reply, so a question gets an answer rather than the same opener again.

Composition happens when the action is created from a plan, and only for `SEND_*` types —
human tasks are internal and keep `title`/`rationale`. The result lands in the payload as
`subject`/`message`, which the router already prefers, so a human-reviewed edit still wins.

### Conversations now look like conversations

Three separate reasons the screens read as logs:

1. **The lead's own words were replaced by our description of them.** `listLeadTimeline`
   returned `summary || body`, and for a classified reply the summary is "Classified as
   Question received (medium confidence): Message contains a question or question word." The
   bubble now shows `body` — what the lead actually said — and `summary` is returned separately
   for the badge that already existed. A test asserted the old behaviour (`message.message`
   containing "Classified as"), so the bug was pinned in place by its own coverage; that test
   now asserts the correct contract.
2. **Internal human tasks appeared as conversation bubbles.** They share `channel_messages` so
   they show on the activity timeline, but "You: Follow up with X based on the current lead
   intelligence" is a note to ourselves. Both the Conversations inbox and the lead's
   Conversation panel now show only genuinely conversational channels; human tasks remain in
   Outbound Actions and on the activity feed.
3. The message bodies themselves were internal (see above).

### An approval queue you can actually approve from

Clicking a row in Outbound navigated away to the lead page, so a reviewer could not read what
was about to be sent without leaving the queue — for a *bulk* approval workspace that is the
wrong flow. Rows now expand in place to show the recipient, subject and full message, with the
recommendation rationale shown separately and explicitly labelled as internal. "Open full lead
record" is still there for when the reviewer wants the whole picture. The lead detail page's
action rows show the composed subject and message too, for the same reason.

### Layout

The Outbound KPI row used `flex-wrap` for eight tiles, which produced three ragged rows with a
gap at the end. It is a responsive grid now (2 / 4 / 8 columns), so the tiles stay aligned at
every width. Verified at 1440px and at a narrow pane.

### Tests

`test/message-composer.test.js` (new, 8 tests). The important one asserts the grounding rule
directly: across every channel and reply-intent variant, the output must not match any of a
set of fabrication patterns (currency and percentages, "discount", "as we discussed", "last
time we spoke", named furniture the lead never mentioned, "within N days", "guarantee"). Plus:
a lead we know less about gets a *shorter* message rather than a guessed one; junk names
("unknown", "N/A", an email address) are not used as a greeting; a question gets an answer;
short-form channels get one line; and end to end, an action's payload carries sendable copy
whose text contains none of the product's internal vocabulary.

### Verification

219 tests: 215 pass + 4 PostgreSQL-only skipped on SQLite, **219/219 on real PostgreSQL**.
Verified in a browser against seeded data: the composed email visible in the approval queue
before approving, the lead's actual words in the conversation thread, and the KPI grid at two
widths.

## 2026-09-10 - Functional verification of every workflow

- decision: add `npm run verify:workflows` — 55 black-box checks driven over HTTP against a
  running server — and treat it as a peer of `npm test` rather than a one-off script.
- rationale: the unit suite proves each module; it does not prove the chain works together
  against a real server, a real database and the session auth gate. Three of the defects found
  in these phases (the permanently-disabled bulk button, outbound messages containing internal
  reasoning, credentials reaching the browser) were all invisible to unit tests and obvious the
  moment the running product was exercised.
- affected modules: `scripts/verify-workflows.js` (new), `package.json`, `docs/DEPLOYMENT.md`,
  `README.md`, `CLAUDE.md`.

### What it covers

Signup, the auth gate on an unauthenticated request, wrong-password rejection, login, session
cookie flags; CSV import including a malformed row and duplicate detection on re-import; the
intelligence summary's eligibility matching what bulk-run actually processes; a bulk run and
its no-op re-run; evidence grounding; approval-gated action creation; that the action carries
customer-facing copy and a subject distinct from the body; reject, bulk approve, bulk execute;
sandbox as the email default and credential masking on read; inbound question classification,
follow-up scheduling, webhook redelivery idempotency, low-confidence escalation; the
conversation showing the lead's own words; reply-driven recommendation refresh; opt-out
handling; follow-up completion; dashboard totals being numbers and matching the lead list; the
attention queue and activity feed; and four tenant-isolation checks including cross-tenant
analyse and approve.

It creates its own workspace with a timestamped email, so it is safe to run repeatedly against
the same database and never touches existing data. `VERIFY_BASE_URL` points it at staging.

### Results

- **55/55 against SQLite** and **55/55 against real PostgreSQL 18.1**.
- 219 automated tests: 215 + 4 PostgreSQL-only skipped on SQLite, 219/219 on PostgreSQL.
- `npm run smoke` passes; client typecheck and build clean.
- Restart persistence checked directly: after a full process restart, migrations report clean,
  the session still authenticates, and leads, actions and messages are all intact.

### Two things the script itself taught us

- One check was **racing the background worker**. Sandbox channels have no provider to send a
  delivery webhook, so the server simulates one on its interval — deliberately not inside
  `POST /api/worker/run`. Asserting immediately passed on SQLite and failed on PostgreSQL
  purely on timing. It now polls for that state. A test that passes for timing reasons is worse
  than no test.
- Several first-draft assertions encoded the wrong response shapes (`succeeded` where the bulk
  endpoints return `approved`/`rejected`/`executed`, `activity` where the feed returns
  `events`). Worth recording because each failure had to be investigated to tell "my assumption
  was wrong" apart from "the product is broken" — and one of them, the recommendation-staleness
  race, genuinely could have been either.
