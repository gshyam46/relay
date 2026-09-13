# L1-06 scheduling and domain-event recovery contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: contract recorded before dependent implementation for the user-authorized L1-06 continuation. This adopts ADR-002/005/006/007 on the current modular monolith and shared workspace transaction gate. No broker, microservice, provider change or deployment is introduced.

## Outcome and bounds

The normal server advances due sequences and human follow-up visibility, retries interrupted lead-processing work within persisted limits, and gives active workspaces bounded turns. Approval/acceptance/unknown provider outcomes do not count as completed sequence steps. Pausing or stopping a sequence/run also gates its already-created actions at dispatch.

Keep action dispatch, webhook receipt processing and domain-event processing distinct. This slice adds runtime scheduling and minimal owner controls/visibility. The complete composer, thread/assignment journey, notifications through external providers, business timezone/quiet-hours configuration, cost quotas, live PostgreSQL/provider proof and customer acceptance remain their existing L2/L4/L5 gates. Explicit schedule inputs must contain an offset and normalize to canonical UTC; do not interpret ambiguous local strings.

## Additive migration 0007

Keep 0001-0006 unchanged. Preserve existing event/run/action history and use separate managed-processing markers; old status alone is not proof of completed effects.

domain_events gains processing_version (0 legacy, 1 managed), payload_hash (nullable for legacy; SHA-256 for managed), max_attempts default 5 (1..100), first_processing_at, retry_deadline_at, next_attempt_at, lease_owner, lease_expires_at, processing_fence default 0, processing_hold_reason, last_error_code and updated_at. New publish writes version 1/hash/update time. Existing legacy unfinished PENDING/FAILED events retain status/body/attempt/error history and gain LEGACY_EVENT_REVIEW_REQUIRED; no automatic replay or fabricated stage completion. Historical processed events remain historical.

Managed event statuses: PENDING -> PROCESSING -> PROCESSED or RETRY_PENDING or QUARANTINED; owner closure is DISMISSED. Existing legacy FAILED remains inspectable. Receipt/event payloads cannot select handlers. Known notification event types have an explicit no-op handler; unknown types quarantine visibly.

domain_event_stages: id, organization_id, event_id FK, stage_key, input_fingerprint (SHA-256), status PREPARED/DONE/SKIPPED, artifact_type/id nullable, prepared_at, completed_at; unique(event_id,stage_key). Current stage input and outcome are written only under the parent's active lease/fence. Re-preparing after changed lead evidence replaces only that event's stage cursor under ownership; prior intelligence versions remain history.

domain_event_reviews: id, organization_id, event_id, expected_fence, decision RETRY/CLOSE, evidence_note (1..2000), reviewer_user_id (1..256), created_at; unique(event_id,expected_fence). No budget reset, payload editing or automatic legacy promotion.

scheduler_state: singleton id='default', last_organization_id nullable, updated_at. Seed once.
scheduler_workspaces: organization_id PK/FK, lease_owner nullable, lease_expires_at nullable, visit_fence default 0, next_phase default 0 (0..5), last_served_at nullable. Short cursor transactions reserve one workspace visit, persist the cursor before work, and serialize across processes. Per-workspace phase progress is durable.

workflow_runs gains revision default 0, processing_version default 0, paused_at/pause_reason nullable, step_anchor_at nullable, scheduler_hold_reason nullable. New enrollment writes managed version 1. Existing unfinished runs gain LEGACY_SCHEDULE_REVIEW_REQUIRED without reconstructing their cursor or replaying old steps. Add WAITING_EXECUTION to the application status set; no speculative new lease is needed because advancement is DB-only.

actions gains nullable workflow_run_id and sequence_step_id with foreign keys and unique(workflow_run_id,sequence_step_id). New sequence actions set both, with explicit same-workspace/lead/sequence validation. Old payload links remain guarded conservatively at dispatch; do not infer new execution authority from migration backfill. Add indexes for organization/status/due/lease and scheduler candidate queries. Runtime services enforce cross-table tenant identity; individual foreign keys are not sufficient.

## Domain-event ownership and retry

EventsRepository keeps publish({organization_id,lead_id,type,payload}) compatible. Replace unguarded markProcessed/markFailed worker calls with a DomainEventProcessor using workspace-scoped transactions. Never allow a bare event ID to complete work.

Processor: processDue({organization_id,limit=1}), processOne({organization_id,event_id}), list/inspect, review, stopAccepting/drain. Claim, assert ownership, stage cursor, final outcome and review always require workspace scope and exact owner/fence/live lease. The processor accepts injected now/random for behavioral tests.

Default event budget is 5 attempts, 24 hours from first claim, 120-second lease, 5-second exponential retry base capped at 300 seconds with half-to-full jitter. Attempts increment at claim; budget survives retry, restart and owner review. Unknown handler/legacy/invalid payload or permanent validation quarantines; transient storage/model errors retry within budget. Fixed safe error codes replace arbitrary provider/error text in event state and new processing audits. Input/evidence changes during generation are retryable, never permission for stale commit.

LeadCreated commits normalization (only if still NEW), deterministic snapshot, idempotent initial action and corresponding audit/cursors under the workspace/event transaction. A restricted lead receives truthful intelligence and no new contact action. Consult durable contact restrictions across canonical duplicates, independently of lead lifecycle; pending mandatory policy defers planning with a bounded retry. Recheck this policy after generation before committing a contact recommendation. Replays cannot duplicate initial action/audits.

LeadReplyReceived stages are snapshot, synthesis, recommendation and plan. Snapshot is DB-local. Other stages prepare current typed input under the gate, perform generation outside all DB transactions, then commit artifact/supersession/audit/cursor under the same event fence only if current inputs still match. Reuse current ready artifacts without another model call. The existing service validation/finalization remains authoritative: a fixed prepared-output adapter may supply the already-generated structured output during the transaction after exact input-hash comparison; no network-capable agent is invoked in that transaction. Reject stale generated output before persistence. Crash after generation may repeat a bounded model call; this is not an exactly-once cost claim.

Retries re-evaluate current canonical lead/reply evidence and reuse current ready stages. A cursor is evidence of that stage/input, not permission to skip changed input. Restricted leads refresh snapshot first, then record explicit skipped contact-recommendation stages. Missing optional wiring and transient failures remain visible instead of being silently marked processed. Plans do not automatically create outbound actions after a reply.

## Workflow advancement and dispatch

WorkflowsService.runDue({organization_id,due_at,limit}) only selects bounded eligible runs and commits one explicit transition/materialization per run under the shared workspace gate. Reload run, parent campaign/sequence, lead, current step and linked action before advancing. The caller-supplied run is not authority. No provider execution happens inside workflow advancement.

A WAIT consumes its persisted eligibility anchor plus delay, preserving timing after an overdue tick/restart. A SEND step materializes one review-gated action and WAITING_APPROVAL state atomically; approval never advances the sequence by itself. WAITING_EXECUTION holds accepted, deferred, retrying or uncertain work. Advance a SEND step only after the exact current execution has delivered and its action is COMPLETED. The next step's delay anchors to the persisted completion time. Permanent failed/rejected/closed outcomes block or stop visibly. Unknown/unlinked historical outcomes remain held.

Human-task steps wait for real domain completion. Existing test-only completion stays test-only; queued/accepted tasks are not silently treated as done. New SEND sequence steps always require exact review regardless of a requested requires_approval=false.

Candidate queries exclude unchanged approval waits, paused/held/inactive parent runs and future due work. Missing/malformed links are selected for a visible blocked outcome instead of recurring forever. Workflow pause/resume and stop use expected_revision and session actor with audit. Pause preserves existing approval/wait timing; resume does not rewrite completed/blocked history or clear legacy holds. STOP cancels eligible queued actions, preserving in-flight/terminal facts.

Immediately before dispatch, validate explicit or legacy workflow linkage, current run/step/lead/workspace, parent status and stop/pause policy under the existing workspace/action gate. Paused work defers without attempts; stopped/invalid work cannot dispatch. A provider request already authorized before pause/reply may finish; later work stops. All canonical inbound replies, including questions and unknown interpretations needing human review, stop the existing sequence and its queued actions while preserving the separate human-response task. New sequence/step inputs reject stop_on_reply=false because continuing after a reply is unsupported in this pilot policy; historical false flags remain conservative. Contact eligibility and lead lifecycle are not rewritten by this stop. Canonical replies and contact restrictions retain their existing transaction ordering.

Expose owner APIs for run controls and selected existing campaign/sequence/enrollment operations in a minimal Workflows page. Scheduling/pause/resume must be possible without developer endpoints; the general visual campaign builder remains deferred.

Human follow-up due processing only transitions persisted PLANNED tasks whose due time has arrived to DUE with one local audit, under the workspace gate. It does not send external notifications or mark a task complete. A malformed historical due time moves the still-PLANNED task to the existing BLOCKED state with a safe scheduling-review audit; future, cancelled and completed tasks remain unchanged. Activity shows persisted PLANNED as Scheduled, DUE as Due and BLOCKED as Needs review, including malformed/missing schedule text. Completion accepts only PLANNED/DUE; cancellation accepts PLANNED/DUE/BLOCKED. Workspace transactions, one local audit and explicit terminal conflict/idempotency rules prevent manual completion from hiding scheduling failures or rewriting cancelled/completed history. This does not complete a linked workflow human-task action.

## Fair normal server tick

A SchedulerService reserves at most 4 workspace visits per tick with an injected 10-second soft admission budget and a 120-second visit lease. Reserve one visit at a time; never advance past unprocessed tenants merely to fill a batch. No new visit starts after shutdown or admission deadline. Individual admitted work has its own timeout/lease; the soft budget is not a hard completion promise.

Candidate workspaces come from typed indexed eligible receipt, managed domain-event, due workflow, due action, expired dispatch and due follow-up queries. Select the next organization after the persisted cursor and wrap once, excluding live visit leases. A noisy tenant cannot hide another by filling an earlier global LIMIT. Action-only candidates awaiting mandatory receipt policy are excluded; their receipt/event/workflow recovery can still run.

Six phases rotate through RECEIPTS, EVENTS, WORKFLOWS, FOLLOW_UPS, DISPATCH, EXPIRY with per-visit caps 2,1,2,5,2,2. Before each phase persist its successor under the visit fence; a slow/crashed phase therefore cannot permanently starve later phases on the next visit. Check live visit ownership before admitting each phase. The underlying receipt/event/action/workflow guards remain authoritative. Release only the same visit owner/fence; stale release cannot clear a newer visit.

The normal server uses this scheduler through Worker.runOnce; scoped test/HTTP worker runs stay scoped but follow the same bounded phases. Internal terminal-body retention remains bounded and independent. Logs report safe IDs/counts/duration/error categories; elapsed/p95/fairness performance claims require measured load/real PostgreSQL evidence.

## Owner event visibility and review

Extend Event recovery with a separate Lead processing view. List/detail show lead, operation/stage, status, attempts, next retry/deadline, safe reasons and stage/review history; do not expose raw payload or stored exception text.

GET /api/domain-events and GET /api/domain-events/:id are owner-scoped. POST /api/domain-events/:id/review accepts expected_fence, decision RETRY/CLOSE and evidence_note; actor/workspace come from session. Managed quarantined/waiting events may RETRY only with remaining original budget, supported handler and valid immutable input. Legacy events may be inspected/closed, not promoted to managed execution. Completed/dismissed work cannot reopen. Review increments fence and records one append-only decision; exact duplicates are idempotent. Closing a domain event does not dismiss the independent webhook's mandatory policy.

## Ownership and acceptance

- Root: contract, DomainEventProcessor/typed stage handlers, worker/API/server/shutdown wiring, follow-up due processing, primary docs and integrated tests.
- Migration owner: immutable 0007/registry/schema tests, scoped event repository primitives and their tests.
- Workflow owner: workflow service/repository/contract, typed action linkage and dispatch workflow guard, Workflows page and focused tests.
- Scheduler owner: fair scheduling service/tests plus separate Lead processing UI/API client contract and focused evidence. Root owns App/sidebar/API shared wiring.

Required automated checks: managed/legacy migration preservation, concurrent and stale event claims, model outside transactions, stale input/lease refusal, artifact/audit/cursor rollback, restart and bounded retries, duplicate initial actions, opted-out snapshot without recommendations, unknown-handler visibility, future/overdue waits, approval/accepted/uncertain step non-advancement, paused/stopped queued dispatch, exact owner revision/fence and tenant denial, due-task idempotency, noisy-tenant and phase fairness/restart, shutdown, isolated HTTP workflow regression, React typecheck/build and all existing tests.

Human QA: normal server schedule/wait/pause/resume, clear approval/delivery distinction, failed lead-processing recovery, immutable evidence decisions, retained opt-out, keyboard/mobile/focus and restart without developer controls. Real PostgreSQL multi-process/least-privilege/restore, live provider and customer walkthrough remain open; this slice cannot close L1 by local tests alone.
