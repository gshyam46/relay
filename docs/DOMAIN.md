# Domain Model

Product: **AI Lead Intelligence & Outbound Automation**
Review date: 2026-09-12

## Contract status

This is the shared business vocabulary for the launch plan. **Existing** means a concept or contract is present in source; it does not certify every invariant. **Target** means proposed L1-L5 work, not an available API, database column, or implemented status.

Schema and API changes must be additive and versioned where necessary. Existing records need explicit migration mappings; do not rename enums in place because this document names a clearer target. [DECISIONS.md](DECISIONS.md) records rationale; [TASKS.md](TASKS.md) records implementation and QA status.

## Ownership rules

1. Every tenant-owned object and command has a workspace boundary. Public APIs derive it from authenticated membership; provider ingestion derives it from unambiguous server routing and authenticated request metadata.
2. Cross-object references must belong to the same workspace, including evidence, contacts, actions, approvals, workflow steps, attempts, messages, and outcomes. IDs are identifiers, not authorization.
3. Durable transitions record actor/system source, prior/next state, reason, occurred/received timestamps, correlation, and relevant versions.
4. Optimistic revisions or database claims prevent conflicting concurrent transitions. Repeating one command intent is idempotent; a deliberate new business action gets a new intent.
5. AI recommends or drafts. Application policy and explicit human commands authorize consequential mutations.

## Implemented Batch A contract amendments

- Batch A required organization_id and scoped callback actions, with generic conflicts under the original global event key. L1-07 now persists the trusted receipt before domain processing and uses new receipt-linked projection keys; the historical global keys remain unchanged.
- Worker.runOnce optionally accepts organization_id; only internal callers may intentionally omit it. HTTP controls always pass the authenticated workspace and exist only under explicit local test configuration.
- The current supported command role is OWNER. Server checks it for writes, settings access and approval lookup (which can create a pending record). A mismatched user/session workspace is unauthenticated.
- Approval requests still accept legacy reviewer_name syntax for compatibility, but its value cannot set identity. The stored display name is the signed-in user and audit metadata includes reviewer_user_id. No schema migration was needed for that historical actor correction; the subsequent L1-08 revision contract below supersedes approval by action ID.
- GET /api/auth/me adds capabilities.test_controls. The React UI treats absent/false as disabled. Public health advertises test_harness only for the validated disposable E2E configuration.

- Synthesis/recommendation/planner versions are l1.09-extractive-synthesis-v2, l1.09-bounded-recommendation-v2 and l1.09-bounded-plan-v2. Default/configured paths validate exact evidence scope; planner requires trusted lead and snapshot. Summary claims are quoted RECORDED_VALUE, with generation provenance in existing JSON. Broader semantic truth and business fit remain target behavior.
- Provider dispatch and conversation persistence share customer subject/body resolution. Internal rationale/reason is not a send fallback. Existing queued actions are unaffected by derived-pipeline version changes.

These corrections have [local regression evidence](verification/L1-02.md) and [AI evidence](verification/L1-09.md); they establish only the earlier batch scope; the subsequent L1-04/L1-08 amendments below add restrictions and exact review. L1-03 transaction adoption is recorded separately next.

## L1-03 persistence and review amendments

- Approval request/current/approve/reject run in one scoped unit of work using tenant-owned action locking. Payload edits, decision, action status and audit commit together or roll back together; conflicting approve/reject calls cannot both succeed.
- Only AWAITING_APPROVAL actions can gain a new pending review or receive a pending-to-decided transition. Existing decisions remain readable/idempotent while retaining later action state. Quarantined, completed and in-flight work needs explicit recovery; approval is not a restart command.
- L1-03 originally retained review request shapes; L1-08 now requires an expected revision token. Readiness adds initialized/compatible migration fields and returns schema_incompatible for unknown/noncontiguous history.
- Migration 0002 adds only its frozen supported extension fields/indexes. Missing marked-schema role defaults UNASSIGNED; unproven send metadata defaults REQUIRED/SANDBOX and eligible legacy actions become BLOCKED. Existing correctly shaped values and completed/in-flight history remain unchanged. Unsafe pre-runner schemas are refused before the baseline can invent authorization. See [migration evidence](verification/L1-03-migrations.md) for exact fields and recovery limits.
- Domain services have not all adopted transactions; L2-02 now adopts atomic import row/enquiry/event/outcome publication. L1-07 now adopts scoped staged transactions for callback/inbound processing. The next amendment records contact-policy and dispatch adoption. The [persistence contract](L1-03_PERSISTENCE.md) governs new adoption.

## L1-04/L1-08 implemented domain amendments

- contact_restrictions stores tenant-owned LEAD/EMAIL/PHONE identities, ALL/channel scope, source event, reason and actor/time provenance. There is no clearing/re-consent command. Missing restriction never means proven consent.
- A general opt-out records the lead and current canonical contacts; directly matching duplicate leads are held across all SEND channels. No second-hop identity propagation occurs. Provider EMAIL restrictions use the actual authenticated recipient; missing action references cannot discard valid restrictions.
- Queued SEND actions, applicable follow-ups and active workflows stop in the restriction transaction. Existing in-flight/completed history remains. Ordinary replies/delivery cannot reset contact eligibility.
- action_revisions stores immutable exact envelope/content hash plus private context/settings fingerprints. action_revision_decisions stores immutable authenticated reviewer decisions; action_approvals remains the current projection. Legacy decisions are historical evidence, without dispatch authority.
- GET action approval returns prepared_revision with its id, revision, envelope and content_hash. Preview edits use expected_revision_id and edited_payload containing subject/body. Approval and rejection require the displayed expected_revision_id. Bulk decisions accept revisions objects, not blind action_ids. Revocation requires a current approved revision in APPROVED/RETRYING and creates new pending review; invalid current sender/recipient can leave it held without a preview until repaired. It cannot recall EXECUTING work.
- SEND dispatch persists STARTED/EXECUTING before I/O and uses that exact recipient/sender/text. An uncertain provider result remains held for later reconciliation. That earlier slice added no lease, due-time or recovery outcome; L1-05 now supplies them in the next amendment.
- The normal manual placeholder SEND endpoint is disabled until the shared composer in L4-02. Internal human tasks remain distinct from external messaging.

The [implementation contract](L1-04_L1-08_DISPATCH.md) and [verification](verification/L1-04-L1-08.md) distinguish these existing fields/commands from the richer target model below.

## L1-05 implemented execution and callback amendments

The [accepted recovery contract](L1-05_EXECUTION_RECOVERY.md) is implemented locally; [verification](verification/L1-05.md) records proof and pending PostgreSQL/provider/human gates. Migration 0005_bounded_dispatch_recovery is additive and leaves earlier status/history records intact.

- Action adds active_execution_id, increasing execution_fence, execution_hold_reason, next_attempt_at, first_dispatch_at, retry_deadline_at and max_attempts. Defaults freeze three total attempts and a one-hour elapsed budget on first authorization; re-review does not replenish them.
- ActionExecution adds action_revision_id, envelope_hash, provider_intent_key/key expiry, lease owner/fence/expiry, dispatch authorization time, outcome_class and outcome_at. Authorization creates DISPATCHING before I/O with a 60-second lease; provider requests are bounded to 15 seconds.
- Known nonacceptance alone can retry after persisted exponential half-to-full jitter from a 30-second base, capped at five minutes, respecting a longer valid Retry-After. Both scheduled_at and next_attempt_at must be due. Deadline/count/key expiry and invalid instants fail closed.
- Stable intent keys bind action/revision. Resend retry payloads stay identical and use a persisted conservative 23-hour first-use key window. Other adapters do not imply external idempotency. Expired or ambiguous dispatch cannot be reassigned automatically.
- dispatch_resolutions records the authenticated owner, exact execution/fence, evidence note and ACCEPTED or CLOSE_WITHOUT_RETRY decision. Accepted requires a provider reference and means acceptance, not delivery. Neither decision authorizes another send or changes the reviewed revision.
- Recovery reads use GET /api/actions/:id/recovery and GET /api/outbound/recovery. POST /api/actions/:id/recovery/resolve carries expected_execution_id, expected_fence, decision, evidence_note and optional provider_reference; tenant and reviewer identity come from the session.
- Existing attempts become LEGACY_UNKNOWN without invented revision, lease or acceptance. Ambiguous active/retryable historical work gains LEGACY_OUTCOME_REVIEW_REQUIRED independently of coarse status. Invalid or duplicate historical attempt numbers refuse migration; recovery does not invent a missing attempt.
- Callback service requires action_execution_id and checks optional revision_id/provider against it; live SendGrid terminal events require both execution and revision. Core receipt, exact state, conditional active action, audit and completion event are atomic. Active action/message/follow-up writes require the matching execution/fence; historical/closed/conflicting events preserve evidence without reopening work.
- SendGrid event IDs are bounded to 2,048 characters by the application. Long restriction source keys are hashed; existing IDs of at most 100 characters retain their prior source-key format. Valid recipient restrictions commit before terminal correlation failures. HTTP acceptance and webhook message references are distinct.
- An exact terminal callback can recover a missing conversation message from its immutable action revision/hash. No current recipient, sender settings or mutable payload is rerendered. L1-07 now supplies the durable effects cursor described next.
- Shutdown stops new dispatch and drains HTTP, worker and executor activity before database close, bounded to 30 seconds. Timeout preserves durable ownership for recovery.

## L1-07 implemented receipt and replay amendments

The [accepted webhook contract](L1-07_WEBHOOK_REPLAY.md) and [integration evidence](verification/L1-07.md) record the local implementation and its pending external gates. Immutable 0006_durable_webhook_receipts adds receipt/review state and effects cursors without rewriting earlier migrations or historical delivery facts.

- WebhookReceipt owns trusted workspace/provider/connection/event-family/event-ID identity, immutable normalized input/hash, verification kind, received/processed times, processing state, bounded attempts/deadline, owner/fence/lease and safe failure reason. Verification is server supplied. Authentication of a provider request is not proof of sender ownership or marketing consent.
- mandatory_policy_status is independently PENDING or DONE. Any pending receipt in the workspace defers new dispatch under the same gate used to insert receipts and authorize sends. Deferral creates no attempt, consumes no dispatch budget and does not revoke approval or permanently block the action. Actual restrictions still apply. Callback/inbound task effects defer with a retryable cursor until mandatory policy completes.
- Defaults are five processing attempts and 24 hours from first claim, with a 60-second lease and five-second exponential backoff capped at 300 seconds with half-to-full jitter. These are receipt-processing limits, separate from outbound action retries.
- Callback gains a unique nullable webhook_receipt_id, core_applied/action_applied flags and effects_status LEGACY_UNKNOWN/PENDING/DONE/SKIPPED plus completion time. New stored provider keys are receipt:<receipt_id>; detail exposes original source_provider_event_id as provider_event_id and the separate storage key. Core state/event/audit/cursor commit together; message/follow-up/marker commit in a subsequent atomic stage.
- InboundEvent gains a unique nullable webhook_receipt_id and LEGACY_UNKNOWN/PENDING/DONE effects cursor. Canonical identity/classification, required restrictions/stop and new-lead provenance commit before conversation/lifecycle/task/audit/LeadReplyReceived effects. Replay reuses original classification/contact/content and cannot create the lead or publish its event again.
- Changed input under an existing identity never replaces the first receipt. A separate conflict receipt can apply mandatory policy only: no new lead, delivery, message, task or event projection. Valid recipient suppression survives same-workspace conflicting action references; known foreign references fail before effects. Policy completion cannot be fabricated to allow closure.
- WebhookReceiptReview records the owner, exact expected_fence, RETRY/CLOSE decision and bounded evidence. Repeated identical decisions are idempotent; changed intent conflicts. RETRY requires payload and remaining original budget with no live handler, and cannot edit correlation, resend or reset limits. CLOSE requires policy DONE and leaves DISMISSED history; completed/dismissed records cannot reopen.
- After 30 days from processing completion or closure, bounded cleanup can purge normalized bodies of PROCESSED/DISMISSED rows while retaining identity/hash/state/review tombstones. Unresolved payloads remain. This is not the full tenant retention/deletion policy.
- Old callback/inbound rows retain null receipt links and LEGACY_UNKNOWN. A new event colliding with unlinked historical projection requires LEGACY_REVIEW_REQUIRED quarantine. A missing human-task message without immutable copy requires MISSING_IMMUTABLE_TASK_COPY; current mutable task text is never substituted.

LeadReplyReceived worker processing first refreshes the deterministic snapshot, including restricted-contact signals. Opted-out/suppressed leads then skip optional recommendation/planning; eligible leads continue through synthesis/recommendation/planning. The subsequent L1-06 amendments below implement managed domain-event retry and normal due scheduling; conversation threading/assignment/composer/resolution and actual human completion remain L4. PostgreSQL multi-process/least-privilege/restore, real provider redelivery and browser/keyboard/mobile QA remain external acceptance gates.

## L1-06 implemented scheduling and domain-event amendments

See the [recorded contract](L1-06_SCHEDULING.md), [integrated evidence](verification/L1-06.md) and [workflow checks](verification/L1-06-workflows.md). Migration 0007_scheduler_event_recovery preserves existing records and adds explicit managed processing instead of inferring prior effects from coarse status.

| Record | Implemented domain meaning |
|---|---|
| DomainEvent | Managed version 1 carries an immutable payload hash, original attempt/deadline budget, owner/fence/live lease, next retry and safe hold/error reason. Legacy version 0 keeps historical status/content; unfinished legacy work receives LEGACY_EVENT_REVIEW_REQUIRED. |
| DomainEventStage | One event/stage key, exact current input fingerprint, PREPARED/DONE/SKIPPED cursor and optional artifact link/times. Only the active parent event owner/fence may write it. Changed evidence replaces that event cursor, preserving previous intelligence artifacts as history. |
| DomainEventReview | Append-only RETRY/CLOSE against event and expected fence with session actor and bounded evidence. No payload editing, budget reset or legacy promotion. |
| SchedulerState | One persisted round-robin workspace cursor. It records admission, not that an external action succeeded. |
| SchedulerWorkspace | Workspace visit owner, lease, fence and next phase; the phase successor is persisted before executing work. |
| WorkflowRun | Managed version, revision, persisted step anchor/UTC due instant, separate pause fields and scheduler hold. WAITING_EXECUTION is distinct from approval and completion. Legacy unfinished runs receive LEGACY_SCHEDULE_REVIEW_REQUIRED. |
| Action workflow link | Nullable workflow_run_id and sequence_step_id with a unique pair; new sequence actions validate same workspace, lead, sequence and step. Legacy payload references are not execution authority. |

Managed event transitions are PENDING -> PROCESSING -> PROCESSED, RETRY_PENDING or QUARANTINED. Owner closure is DISMISSED; old FAILED remains inspectable history. Default processing uses five attempts and 24 hours from first claim, a 120-second lease, and exponential five-second backoff capped at 300 seconds with half-to-full jitter. Completion, failure, stage and review writes require exact current ownership. Unknown handlers quarantine rather than accepting payload-selected code. Expired local event processing can retry within its original budget; expired outbound sends retain the independent uncertainty rule.

LeadCreated atomically persists eligible normalization, deterministic snapshot, idempotent initial action, audits and cursors. LeadReplyReceived commits the snapshot first and then prepares, generates and finalizes synthesis/recommendation/plan stages. Generation runs outside database transactions; artifact/cursor/audit commits recheck current typed input and event ownership. Unchanged ready artifacts can be reused. Model output generated before a crash may be generated again within the bound; this is not an exactly-once cost guarantee.

Durable contact restrictions across canonical duplicate contacts override lifecycle labels during planning. Restricted leads retain current truthful intelligence and skip contact recommendations. Pending mandatory webhook policy defers planning for a bounded retry, and policy is checked again after generation. Reply planning does not automatically turn its recommendation into an outbound action.

A due workflow transition reloads current ownership and related state under the workspace gate. SEND materialization, pending review, typed links and cursor/audit commit together without provider I/O. Exact approval only enables dispatch: current action COMPLETED plus its exact DELIVERED execution/fence/revision is required before the step advances. WAIT and post-completion delays use persisted instants, preserving overdue/restart behavior. Human-task creation or acceptance cannot substitute for explicit completion. Missing or invalid links/status/times block visibly.

Owner PAUSE/RESUME/STOP carries expected_revision, session actor and a 1..2000-character reason. Pause preserves approval and timing; resume cannot clear legacy holds or reopen terminal history. STOP blocks queued linked actions and leaves started/terminal facts unchanged. The executor repeats current run/step/parent/workspace/lead checks before creating an attempt. Every canonical reply, including QUESTION/UNKNOWN, stops current sequence work while preserving a separate human-response task. New sequence/step stop_on_reply=false is rejected; this does not mutate contact permission or equate a question with an opt-out.

Normal scheduling rotates bounded receipt/event/workflow/follow-up/dispatch/expiry phases with caps 2/1/2/5/2/2 over at most four workspace visits and a ten-second soft admission budget. Visit ownership lasts at most 120 seconds. The persisted cursor/fence provides fair admission across restarts; underlying job and policy guards retain authority. Eligible PLANNED follow-up tasks become DUE with one audit, and malformed historical due instants become BLOCKED. A timer neither sends a reminder nor completes a human task. Owner follow-up complete/cancel commands require eligible current state and commit an audit atomically; blocked/terminal history cannot be relabeled as successful completion. These commands do not infer completion of a linked workflow human-task step.

The Workflows page exposes creation, enrollment, exact review and revision-checked controls; Event recovery adds a separate Lead processing view with safe stage/retry/review detail. Business timezone/quiet-hours, full composer/thread/assignment/human completion, actual PostgreSQL concurrency/restore, live provider and customer acceptance remain L2/L4/L5 gates.

## L1-10 implemented operational records and commands

See the [operations contract](L1-10_OPERATIONS.md), [integrated evidence](verification/L1-10.md) and ADR-013. Migration 0008_operational_controls appends explicit operational records; it neither edits earlier migration history nor fabricates new authority for old actions.

| Record/control | Implemented meaning |
|---|---|
| WorkspaceDispatchControls | One workspace row: revision, paused flag, daily_attempt_limit, unresolved_limit, owner reason and updated_at/updated_by. Missing row means revision 0, unpaused, 100 attempts per UTC day and two unresolved slots. Invalid present state holds sending. |
| AuthAdmissionState | Singleton serializes short durable admission checks before password work. It is not a user/session or tenant authority record. |
| AuthRateBucket | Operation LOGIN/REGISTER, GLOBAL/PEER/ACCOUNT kind, fixed/HMAC identity key, window start/reset and attempts. Composite identity is unique; raw email/IP is not stored in this record. |
| Global dispatch enablement | Validated process configuration, false by default in staging/production. Workspace owners cannot override it; changing it requires coordinated instance restart. |

Owner GET/PUT /api/dispatch-controls derives workspace and actor from the session. PUT requires expected_revision, boolean paused, daily_attempt_limit 1..1000, unresolved_limit 1..10 and a reason of 1..2000 characters. The current owner is checked again under the workspace gate; the controls revision and DispatchControlsUpdated audit commit together. Stale revisions return conflict. Generic settings writes cannot alter the typed controls table.

Daily usage counts every persisted SEND authorization, including sandbox and retry attempts. Legacy attempts without an authorization timestamp use their stored start time conservatively. The authorization's captured instant supplies both its quota bucket and execution/lease/deadline timestamps. Starting a new UTC day or changing controls cannot reset an action's original attempt/deadline/review/provider-key history. Usage is derived from durable attempts, without a separate reset job or mutable counter ledger.

Unresolved capacity counts DISPATCHING even with an expired lease, and UNCERTAIN until an exact accepted/delivered/failed outcome or owner evidence resolution. Missing/non-completed ambiguous legacy execution evidence may consume one conservative slot per held action; completed-only history is excluded. Unresolvable legacy identity may require inspected operator remediation. Slots describe unresolved external outcomes, not active network sockets. ACCEPTED releases a slot without proving delivery or customer success.

Operational holds are derived responses, not new action lifecycle states: GLOBAL_DISPATCH_PAUSED, WORKSPACE_DISPATCH_PAUSED, DISPATCH_CONTROLS_INVALID, DAILY_DISPATCH_LIMIT or UNRESOLVED_DISPATCH_LIMIT. They return deferred status without a new attempt, network call or changed approval. Human tasks, receipts, intelligence and recovery continue. Existing restrictions, pending-policy gates, current review, schedule, workflow stops and retry budgets remain independent requirements; a pause cannot recall previously authorized I/O.

Auth admission uses at most two nonqueued local password-work slots, then durable global/account/socket-peer windows. Login limits are 200/minute global, 30/5 minutes per peer and 10/15 minutes per account; registration is 20/hour global, 10/hour per peer and 3/hour per account. Exhaustion returns 429, busy/unavailable admission returns 503, with bounded Retry-After. Global identity survives secret rotation; success/restart/rejection do not reset windows. Proxy/NAT peers share the observed socket budget. Password verification/hashing runs outside the admission transaction; registration then commits workspace/owner/session/audit atomically. Dummy verification for unknown users does not promise timing-proof authentication.

HTTP/provider resource limits, validated TLS and safe diagnostics protect these boundaries but do not establish contact permission or business outcomes. Provider HTTP acceptance remains known when a bounded success body cannot be parsed; references become null and fixed response_issue is retained in the result/audit. Browser origin checks also protect existing state-changing GET review/token routes pending future route redesign. Full account recovery, secret-at-rest protection/rotation operations, monetary/model budgets and live customer acceptance remain later gates.

## L2-01 implemented business and enquiry context

The [accepted context contract](L2-01_BUSINESS_CONTEXT.md), [integrated evidence](verification/L2-01.md) and [backend evidence](verification/L2-01-backend.md) define the implemented minimum. Migration 0009 adds append-only business_profile_revisions and lead_enquiry_revisions; earlier rows, contact restrictions, action attempts and terminal history remain unchanged. Missing records are revision 0 with neutral defaults, never fabricated customer facts.

| Record | Implemented meaning |
| --- | --- |
| Business profile revision | Workspace, positive revision, schema version 1, complete validated name/offerings/service areas/target and exclusion descriptions/required and preferred criteria/optional next-step/timezone/language, reason, server capture time and owner |
| Lead enquiry revision | Workspace and lead, positive revision, schema version 1, six complete typed facts, reason, server capture time and owner; highest revision is the one active context |
| Fact state | UNKNOWN has null value/provenance; KNOWN carries one typed value/source; CONFLICTED preserves 2 to 5 distinct alternatives without silently selecting a winner |
| Fact provenance | CUSTOMER_STATED, OPERATOR_OBSERVED or INFERRED assertion; MANUAL source; bounded unverified source reference; explicit-offset observation input normalized to canonical UTC, or explicit unknown |
| Exact budget | Currency with supported scale, minimum_minor and maximum_minor as integer strings up to 24 digits; equal endpoints mean an exact amount, unequal endpoints a range; zero remains different from UNKNOWN |

The six fields are interest, location, budget, timeline, enquiry_date and last_interaction. Interest is bounded text; location records locality and optional country code; timeline records a description and optional target date. Enquiry/target dates use real Gregorian calendar dates. Last interaction requires an explicit-offset instant normalized to UTC. Observation time is never inferred from capture/import time. Inferences and conflicting alternatives are retained for human review, not promoted to customer statements.

Budget input accepts unsigned decimal strings and converts without floating-point loss; a subsequent full save may send the canonical minor-unit representation only with the matching currency scale. Supported scales are INR/USD/EUR/GBP/AUD/CAD/SGD/AED/SAR 2, JPY 0 and KWD/BHD 3. Other currencies and excess precision reject. No conversion, exchange rate, price promise or monetary outcome is implied.

Owner PUT /api/business-profile and /api/leads/:id/enquiry-context require full snapshots, expected_revision and a reason. The API derives actor/workspace from the session; the service rechecks the currently existing same-workspace OWNER row under the workspace gate. The current user model has no separate revocation/active flag; complete access lifecycle remains later work. Append and audit commit together. A stale revision returns 409 even if a request repeats old content; identical normalized content at the current revision returns the saved record without another revision/audit. GET current/history are tenant scoped; history uses an exclusive before_revision cursor and at most 50 records per response.

Business and enquiry revisions invalidate current intelligence fingerprints and applicable exact SEND reviews without rewriting every lead or historical result. The UI shows stored context and that analysis needs refresh. Known non-inferred values become quoted evidence with exact field/revision/source; UNKNOWN, CONFLICTED and INFERRED cannot become asserted need, budget or permission. Criteria are descriptive context only; evaluated business fit/priority, automatic refresh, duplicate/enquiry resolution and account lifecycle retain later acceptance gates. L2-02 now adds exact owned import-row linkage as described below.

## Workspace, user, and business profile

**Existing:** Organization is the tenant; users, sessions and organization settings exist. L2-01 adds the versioned business profile above. L4-01A adds reviewed email setup and structural capability below; independently verified provider operation remains unavailable. Broader channel operating policy, membership lifecycle and approved-claim management remain separate or incomplete.

**Target:**

| Concept | Minimum meaning |
|---|---|
| Workspace membership | Actor, workspace, role, active/revoked state; all decisions use real actor identity rather than a free-text reviewer name alone |
| BusinessProfile | Versioned business name, offering, service region, timezone/country defaults, communication preferences, and owner-approved claims |
| QualificationCriteria | Versioned fit and exclusion criteria, relevant lead attributes, priority rules, and missing-information policy |
| ChannelConnection | Tenant-owned provider account/sender identity, capability and verified readiness, secret reference/version, limits, paused/failed state |
| Workspace operating policy | Approval defaults, sending windows, frequency/cost limits, workspace pause, and escalation ownership |

Do not build a generic business rules language for the first pilot. A small validated profile and criteria contract for one customer workflow is sufficient.

## Lead Data Foundation

### Lead, contact, person, company

**Existing:** Leads store identity/contact fields, source, status, and provenance. Person and Company remain conceptual entities; do not assume independent mature aggregates or relationships already exist.

**Target:** A Lead represents an enquiry/opportunity relationship the customer wants to understand and progress. Contact identity can be shared across duplicate lead records without erasing distinct enquiries. Start with stable normalized contact references; add separate Person/Company aggregates only when required.

A contact address is not proof of consent, interest, budget, business fit, or an existing relationship. Lead lifecycle, communication eligibility, intelligence state, and opportunity outcome are independent.

### Validated business attributes

**Existing:** The reviewed CSV adapter maps selected contact and enquiry columns by index with explicit phone/date/currency interpretation. Raw cells and headers remain distinct from normalized values. Initial typed enquiry facts retain exact IMPORT_ROW sources; manual correction retains prior source history. Compatibility imports without mapping remain contact-only. Unmapped raw columns do not automatically become qualification inputs.

**Target:** Attribute definitions have a stable key, label, type, validation, unit/currency where applicable, and schema version. Initial examples are product/service interest, enquiry date, location, budget range/currency, desired timeline, last interaction, source notes, and owner. Use only fields relevant to the selected workflow.

Each value preserves origin, source row/reference, observed/effective time, correction history, and whether it is customer-provided, externally observed, or inferred. Unknown differs from empty, zero, false, and contradicted. Normalize country-dependent phone/date values using an explicit selected context; do not silently guess.

Core operational fields stay typed/indexed. Flexible validated attributes may use JSONB; raw source payloads remain distinct and subject to retention.

### Imports and corrections

**Existing:** IngestionAdapter, ImportBatch, ImportRow, ImportIssue, duplicate candidates, and provenance exist. CSV is the first adapter. Current batch states include `UPLOADED`, `PREVIEWED`, `READY_TO_COMMIT`, `COMMITTING`, `COMMITTED`, and `FAILED`.

**Implemented L2-02 workflow:** Inspect -> map columns/country/date/currency context -> preview values/issues -> correct and select eligible rows -> commit bounded chunks -> inspect results and resume unfinished rows. L2-03 adds a separate reviewed identity resolution for duplicate candidates while preserving these original outcomes; archive/export and complete data-work acceptance remain L2-04.

- Preview is a customer-visible decision point; it does not itself authorize automatic commit.
- Commit identity binds workspace, import batch, and selected row. At most one resulting lead is created for that row, including interrupted/concurrent retries.
- Partial failure reports committed/skipped/failed rows and resumes unfinished work without replaying committed effects.
- Edits increment lead data revision and invalidate dependent intelligence or pending approvals where relevant.
- Preserve import provenance; do not copy every raw row into each derived record.

### DuplicateCandidate and identity resolution

**Existing:** Strong normalized-email/phone matches and possible name+company matches create warnings. L2-03 lets an owner attach an exact-contact source to the same enquiry or create a separate repeated/shared/distinct enquiry. Original source and import outcomes remain visible; no automatic or destructive merge is implemented.

**Target:** Review may link duplicates, keep separate enquiries, or merge selected facts with conflict visibility and an audit record. Source records/messages/history remain traceable; merges cannot silently discard contact restrictions.

Suppression applies to the normalized contact within the workspace and specified channel/scope, including duplicates and re-imports. Similar names alone do not authorize merging. Cross-tenant identity sharing is outside scope.

## Contact permission and lifecycle

**Existing limitation:** `leads.status` still mixes lifecycle and contact vocabulary. L1-04 prevents ordinary replies/delivery from clearing OPTED_OUT/SUPPRESSED, and independent contact_restrictions is authoritative. Richer lifecycle/outcome modeling remains the target.

**Target dimensions:**

| Dimension | Proposed vocabulary / interpretation | Authorized writer |
|---|---|---|
| Lead lifecycle | New, open, archived; optional qualified/closed mapping defined with pilot workflow | Explicit domain command or validated outcome transition |
| Contact permission | Unknown, allowed under recorded policy basis, opted out, suppressed | Contact policy service; explicit opt-out/complaint/block/resubscribe event |
| Opportunity outcome | Unknown, qualified conversation, meeting, quote, won/lost or workflow-specific equivalent | Human recorded or verified integrated business event |
| Intelligence state | Not run, running, ready, needs data/review, failed, stale | Intelligence orchestration |
| Message delivery | Queued, dispatching, accepted, delivered, failed, uncertain | Dispatch and verified provider event reducer |
| Conversation work | Open, assigned, awaiting customer, resolved/reopened | Human command or defined incoming-event rule |

These are proposed semantic dimensions, not final replacement enum names. L1 first prevents invalid status rewrites; L2 migrates the richer model with conservative backfill. Existing `ACTIVE` does not prove permission or interest. Existing `OPTED_OUT`/`SUPPRESSED` must retain the strongest contact restriction.

A ContactRestriction records normalized recipient/contact identity, channel or all-channel scope, reason, source, effective time, and audit actor/event. Ordinary replies, delivery, re-import, AI analysis, and lead merge cannot clear it. An explicit authorized resubscription flow with evidence is required. Complaint/unsubscribe/hard-bounce handling must update the relevant permission or deliverability dimension, not just create an audit entry.

## Lead Intelligence

### Evidence and claims

**Existing:** Evidence, structured Claim field/value, Signal, confidence, staged research evidence, and versioned snapshots exist. Approved local/manual research ingestion is an adapter boundary; external discovery is not a prerequisite.

**Target evidence:** Workspace/lead/contact ownership, source type/reference, observed/retrieved time, allowed excerpt/content reference, provenance, and freshness/contradiction metadata.

**Target claim:** Assertion field/value, claim kind (observation/inference), selected evidence references, confidence basis, and validation state. Every citation must point to an allowed input record and support that assertion. Referencing every input is not proof.

Generated summaries may combine supported claims, identify unknowns, or label inference. They may not invent budget, intent, prior enquiry, affiliation, customer offering, or promises. Corrections preserve prior evidence/history rather than silently overwriting provenance.

### Readiness, qualification, and priority

| Concept | Answers | Must not imply |
|---|---|---|
| Data readiness | Is enough usable data available for this assessment? | High conversion likelihood |
| Evidence confidence | How well supported and current is this assertion? | Customer interest |
| Qualification | Does evidence match this business's explicit criteria? | Guaranteed suitability |
| Attention priority | Why should the user review or act now? | A calibrated probability unless separately evaluated |
| Segment | Which useful customer-defined grouping applies? | A discovered market fact without evidence |

Current readiness and foundation qualification should retain honest labels until business criteria enter the pipeline. A useful recommendation can be to ask a question, correct data, wait, resolve a duplicate, or do nothing.

### Snapshot, synthesis, recommendation, and plan

**Existing:** IntelligenceSnapshot, SynthesisRun, RecommendationRun, and NextBestActionPlan retain versions/fingerprints/history. Snapshot/synthesis/recommendation states include `DRAFT`, `READY`, `FAILED`, `SUPERSEDED`; planning adds `PLANNED` and `BLOCKED`.

**Implemented L2-01 input addition:** Current business-profile and enquiry revisions bind snapshots and downstream current checks; zero/zero preserves existing fingerprints. Context saved during generation cannot publish a current artifact from old input. Saved context does not automatically schedule analysis.

**Target inputs:** Lead data revision + business profile/criteria version + eligible evidence/interaction versions + pipeline/model/prompt/schema versions. Changes in these inputs mark downstream outputs stale and create a new version when processed. Repeated unchanged requests reuse the existing result.

Synthesis produces claims, rationale, unknowns and contradictions. Recommendation produces priority, segment, personalization, proposed next step and evidence. A plan adds policy and approval requirement. None of these is a send authorization.

Persist usage/cost, fallback state, quality flags, and concise reasons. Model output shape validation is distinct from factuality and usefulness evaluation. Untrusted source text cannot instruct agents to mutate application state.

## Outbound Automation

### PreparedActionRevision and ActionApproval

**Existing:** Actions link to plans and carry payloads/idempotency keys. Immutable prepared revisions and decisions now bind the exact reviewed envelope, including canonical configured Reply-To for email. Full private sender settings and connection revision are rechecked at dispatch. Approval projection states remain `PENDING`, `APPROVED`, `REJECTED`; edits create a replacement preview without rewriting original intent. The old manual factory still has a fixed per-lead/channel key, so its placeholder SEND route is disabled outside test controls until L4-02.

**Target prepared revision:** Immutable action type, normalized recipient/contact, sender connection, channel, subject/body or structured human task, attachments if supported, intent key, content hash, and context/policy versions. Prepared content is exactly what review and send display.

Approval binds workspace + action + revision + recipient/content fingerprint + authenticated reviewer + decision time. Send-relevant edits invalidate earlier approval or create a replacement revision requiring review. Concurrency uses an expected revision; stale approval returns a conflict.

Approval does not override opt-out, unsupported channels, unavailable or failed connection verification, workspace pause, expiry, or current policy. L4-01A permits structurally complete SendGrid review but holds every new normal-runtime live dispatch pending provider verification. A manual reply and a sequence step use this same contract. A future low-risk approval exemption must be explicit policy; current manual placeholder bypass is not such a policy.

### Action and dispatch attempt

**Existing action states:** PLANNED, AWAITING_APPROVAL, APPROVED, EXECUTING, COMPLETED, RETRYING, FAILED, BLOCKED. Attempt status remains STARTED, COMPLETED or FAILED for compatibility. L1-05 outcome_class supplies the operational distinction:

| Outcome | Meaning and transition boundary |
|---|---|
| DISPATCHING | Intent and current ownership committed before external I/O; lease expiry does not permit resend |
| ACCEPTED | Provider response or evidenced owner resolution confirms acceptance; delivery remains unconfirmed |
| RETRYABLE_FAILURE | Known nonacceptance; another attempt needs due time, unchanged review/policy and remaining budget |
| PERMANENT_FAILURE | Known nonretryable provider failure; no automatic resend |
| UNCERTAIN | Timeout, ambiguous response or expired dispatch; hold until exact callback or owner resolution |
| DELIVERED | Exact terminal success evidence; later conflicting failure cannot overwrite it |
| DELIVERY_FAILED | Exact terminal delivery failure; preserved against contradictory terminal rewriting |
| CLOSED_UNRESOLVED | Owner closed uncertain work without permitting retry; later evidence cannot reopen it |
| LEGACY_UNKNOWN | Historical attempt has no proven binding/outcome; preserve history and require inspected remediation |

Due eligible work creates one authorized attempt with current active_execution_id/fence. A worker result may commit only for that owner/fence with an unexpired DISPATCHING lease. There is no reclaimable pre-send lease state. Exact authenticated callbacks can resolve an expired uncertain attempt, but cannot mutate a newer active attempt, its message or its follow-up.

The durable action/attempt records provide the initial dispatch outbox without a broker. L1-06 supplies bounded managed scheduling, and L1-10 supplies workspace/global pause plus daily attempt and unresolved-outcome limits. Monetary/model-spend limits, broader scheduling rules and independently verified channel readiness remain target work. Human-task execution is distinct from actual human completion; its explicit product command remains L4.

### PolicyDecision

Existing plan decisions are `ALLOW`, `REQUIRE_HUMAN_APPROVAL`, and `BLOCK`. Target dispatch policy also produces a clear defer-until or needs-review reason where useful.

Evaluate recipient permission, sender readiness, supported channel, matching approval revision, workflow state, schedule/timezone, contact frequency, tenant/provider limits, and available spend. Record the decision version and reason. Policy before planning is useful; current policy at dispatch is mandatory.

### Campaign, sequence, workflow, follow-up

**Existing:** Campaign and Sequence states are `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`. WorkflowRun states are `ACTIVE`, `WAITING`, `WAITING_APPROVAL`, `WAITING_EXECUTION`, `COMPLETED`, `STOPPED`, `BLOCKED`. FollowUpTask states are `PLANNED`, `DUE`, `COMPLETED`, `CANCELLED`, `BLOCKED`.

**Implemented L1-06:** Sequence definitions remain fixed after creation. A managed enrollment persists its intent, UTC eligibility anchor, revision, current step, last typed action, stop reason and separate pause/hold state. Repeating one enrollment preserves its run and original schedule. SEND steps always create review-gated ordinary actions. Deliberate later re-enrollment, broader business timezone/quiet-hours and sequence editing/version UX remain target work with a newly reviewed intent and lifecycle/frequency checks.

Replies and opt-outs stop existing queued actions where required, not just future step creation. Pause/resume/cancel semantics must cover claimed/in-flight work honestly. Implemented no-response tasks use the original exact execution completion plus 48 hours, and canonical replies cancel obsolete action-linked tasks. L1-06 now advances due workflows from the normal scheduler with original wait/completion anchors and marks due follow-ups DUE or invalid historical schedules BLOCKED. Delivery remains distinct from business success. Human task assignment, external reminders and the complete operator completion journey remain target work.

## Messages, inbox, conversations, and outcomes

### ChannelMessage and provider event inbox

**Existing:** Normalized inbound/outbound messages and event records exist. Current channel vocabulary is email, WhatsApp, SMS, voice, human task, CRM; vocabulary does not imply every channel is production-ready.

**Target message:** Workspace, lead/contact, conversation/thread, direction, exact content, sender/recipient, channel connection, action revision/attempt, external references, occurred/received timestamps, and separate acceptance/delivery facts.

**Implemented inbox:** WebhookReceipt stores the trusted connection/identity, immutable normalized input/hash, source correlation, received time and processing policy. Receipt means the event was durably received, not that delivery or lead work completed.

| Processing state | Meaning |
|---|---|
| RECEIVED | Input committed and awaiting a claim |
| PROCESSING | A current owner/fence holds a bounded lease |
| RETRY_PENDING | The same stored input waits for its persisted retry time |
| PROCESSED | Required policy and supported local effects completed |
| QUARANTINED | Permanent ambiguity/conflict or exhausted budget needs inspection |
| DISMISSED | Owner closed processing with evidence after mandatory policy was DONE |

Every state remains separate from mandatory_policy_status. A quarantined receipt with unresolved required policy still defers workspace dispatch and cannot be closed. Ordinary RETRY/CLOSE cannot repair invalid/foreign identity or waive contact restrictions; the held workspace needs inspected operator remediation, which remains a pre-customer operational acceptance gate. Expired processing ownership can be reclaimed for local effects; success/failure writes require a live matching claim. This does not authorize retrying an external send.

**Exact callback effects:** Core matching uses the execution and active fence, with SendGrid revision/provider checks. Core callback projection, exact execution/action change and audit/event commit with PENDING cursor. Duplicate/worker replay resumes message/follow-up work once. A failed effects transaction rolls back its message, task and completion marker together while preserving the delivery fact. DONE/SKIPPED never repeat history.

Messages recover only the immutable attempt-bound revision/hash. Current and originally contacted recipients remain subject to restrictions. All canonical replies since dispatch and linked stopped workflows prevent a reconstructed no-response task; due time remains original execution.completed_at plus 48 hours. Pending mandatory policy defers repair instead of permanently skipping it. Existing cancelled/completed tasks are never reopened. Out-of-order events cannot clear suppression, regress confirmed delivery or mutate a newer/closed attempt.

Owner routes are GET /api/webhook-receipts, GET /api/webhook-receipts/:id and POST /api/webhook-receipts/:id/review. Review requires expected_fence, decision and evidence_note; actor and tenant come from the session. List/detail expose scoped processing state and bounded previews, not raw credentials. See the [full receipt contract](L1-07_WEBHOOK_REPLAY.md) for identity bounds, retention and review rules.

### Reply and conversation work

Existing reply categories are positive, negative, question, opt-out, unknown. Target classifiers retain original message, supported category, confidence, abstention reason, and model version. Explicit opt-out processing is independent of model availability.

Target conversation work has an assigned owner, open/resolved state, last activity, and pending human work. Inbound messages may reopen it under a defined rule. Human reply composing/editing/sending, assignment, and resolution are persisted commands; marking a task complete cannot fabricate a reply.

### BusinessOutcome

**Target:** A lightweight outcome records lead/conversation, kind, occurred time, actor/source, linked action/workflow where justified, optional amount/currency, and supporting note/reference. Initial workflow may use qualified conversation, meeting, quote, won/lost.

Keep recorded outcome and attributed contribution distinct. A delivered email, positive classifier result, or model-generated score cannot alone be reported as revenue or conversion. Export or integrate outcomes with the customer's existing system; this product is not a CRM replacement.

## Optional Lead Discovery

A future discovery adapter returns normalized LeadCandidate records with identity/contact data, provenance, source references, and confidence. Candidates enter normal import/evidence/permission handling. A provider cannot bypass review or make discovered contact data eligible to send automatically.

## Required migration and contract checks

- Inventory current schema/data and preserve historical provenance/status before backfill.
- Block cross-tenant references and mutation paths; test negative authorization at API and service boundaries.
- Preserve suppression across duplicate linkage, imports, callbacks, replies, and lifecycle edits.
- Test stale approval, contact edit after approval, concurrent approve/reject/send, and provider configuration changes.
- Test concurrent consumers, future schedules, crashes before/after provider invocation, ambiguous timeout, bounded retry, and stale claim tokens on PostgreSQL.
- Test duplicate inbox receipt after partial failure, late attempt callbacks, delivery/bounce/complaint/unsubscribe ordering, and unmatched replies.
- Test changed business criteria/evidence invalidates derived recommendations and applicable prepared actions.
- Evaluate unsupported assertions, prompt injection, sensitive-data leakage, abstention, fallback labels, and model budgets.
- Exercise the actual React customer workflow through recorded outcomes; old `public/` checks do not prove shipped UI behavior.

## L2-02 reviewed import records

The [implementation contract](L2-02_REVIEWED_IMPORT.md) and [integrated evidence](verification/L2-02.md) define contract versions 0 (historical), 1 (new contact-only compatibility) and 2 (reviewed typed mapping). Original ordered cells/headers remain immutable. Row corrections retain before/after mapped and normalized values, reason, actor and batch review revision; up to 100 corrections are supported before freezing.

A frozen selection is a sorted set of owned eligible row IDs plus the reviewed revision. The scoped import_row_outcomes ledger permits one COMMITTED or HELD outcome per source row. COMMITTED owns the exact lead/event links; HELD owns a duplicate-review reason and no lead/event. Lead, initial enquiry, event, row marker and audit commit in one short transaction. Batch COMMITTED means the frozen selection has no unfinished rows; it may include visible HELD outcomes. Remaining unselected rows are not silently committed later.

IMPORT_ROW provenance adds import_id, import_row_id and enquiry field to the source. It is bound to the exact reviewed row and resulting lead, retains source time or null, and labels the chosen stated/observed/inferred assertion without independently verifying it. A manual full-snapshot update may retain an unchanged imported fact; a changed value needs MANUAL correction provenance. Imported evidence uses the existing CSV evidence type with its real import-row link. Historical unfinished batches are review-required, not automatically repaired from ambiguous old flags.

The L2-02 Unicode matching refinement stores normalized_name_company_key as a bounded application-generated SHA-256 lookup value with a workspace index. It is a duplicate-candidate hint, not unique person identity. Migration 0010 backfills only this derived key using a frozen algorithm and bounded pages; all future name/company correction must maintain the key in the same transaction.

## L2-03 reviewed enquiry identity records

[Contract](L2-03_IDENTITY_RESOLUTION.md); [verification](verification/L2-03.md). Implemented locally; local verification and external acceptance are recorded separately.

ImportIdentityResolution is an immutable scoped association from one reviewed row to a resulting lead/enquiry. LINK_EXISTING/SAME_ENQUIRY attaches source to an exact canonical email-and-phone match, including missing values, without overwriting that enquiry. CREATE_SEPARATE records REPEATED_ENQUIRY, SHARED_CONTACT or DISTINCT_ENQUIRY, with owner reason and one newly created lead/event. These labels are owner decisions, not verified person identity or permission.

The resolution retains original review token, request hash, source snapshot/digest, chosen target review, actor/time and result. One row cannot gain a second resolution. Existing import outcome/frozen selection remain unchanged, and resolution progress is reported separately. The exact ledger association authorizes resolved IMPORT_ROW provenance; workspace ownership alone does not. Attached facts stay visible as source evidence until an explicit context correction.

AmbiguousInboundWorkStopped is a deterministic receipt-scoped audit marker committed with directly matched workflow/no-response stops. It is distinct from a canonical lead reply and does not create an assigned message. Replay cannot stop newer intentional work, while late callback no-response creation checks the recorded ambiguity. Pending-policy status remains a dispatch hold until mandatory effects succeed; caps and recovery limits are explicit in the contract.

## L2-04 contact revision and archive contract

The [data-management contract](L2-04_DATA_MANAGEMENT.md) defines one monotonically increasing Lead.data_revision independent of enquiry/business context revisions. Lead.archived_at is separate from lifecycle/contact status. Each meaningful CORRECT, ARCHIVE or RESTORE transition appends one scoped LeadDataChange containing before/after snapshots, field provenance, reason, authenticated actor, exact expected/new revisions and stopped-work/restriction effects. Exact accepted retries return that original result; changed intent at a consumed revision conflicts.

Correcting current name/email/phone/company does not rewrite import cells, identity decisions or enquiry facts. Changed fields cite their correction record, while unchanged fields retain prior provenance. Former contact restrictions remain and effective restrictions are also attached to this lead at their existing scope. Contact correction does not imply consent.

Archive retains source/history/export and real inbound/provider events while preventing new analysis, editing and execution work. Restore changes only archive state/revision; it grants neither renewed approval nor a right to contact. Revision changes keep edit-back and archive/restore from making old analysis or reviews current again. The documented distinction between automatic follow-up cancellation on correction and all open follow-up cancellation on archive is visible in the owner workflow.

## L2-05 freshness and current analysis

The [freshness contract](L2-05_FRESHNESS.md) separates value state, assertion and age. Ongoing enquiry facts and research use policy version 1's provisional 90-day observation-based TTL. Enquiry date/last interaction are historical; recorded contact identity is revision-bound. Capture/retrieval/refresh never substitute for a missing observation. Future-at-recording sources stay unusable until an explicit correction. Conflicting alternatives remain unselected.

An IntelligenceSnapshot may persist freshness_json (maximum 262144 UTF-8 bytes) containing policy/revisions, evaluated time, next transition, source/authority fingerprints, fact/research assessments and review reasons. Legacy rows remain null. A technical workspace clock is monotonic across reads and restarts; invalid state fails closed. Only discrete authority participates in snapshot identity.

Intelligence detail and summary expose currentness state NEVER_ANALYSED/CURRENT/OUTDATED/ARCHIVED with assessment/analysis/next-check times, refresh availability, revision comparison and typed reasons. Current describes the analysis inputs; it does not mean all facts are usable or contact is allowed. Detail also returns bounded previous/current stored recommendation descriptors and changed input categories, without asserting model causation. Refresh outcomes report per-lead reuse/success/failure truthfully.

## L3-01 explicit fit and priority

A BusinessProfileRevision may additionally hold fit_criteria under its existing revision authority. Snapshot business_fit records evaluator version, criteria revision, evaluation time, exact rule results and {fact,freshness} evidence. MATCH/NOT_MATCH/UNKNOWN/NEEDS_REVIEW describe an individual configured criterion; MATCHES_CRITERIA/DOES_NOT_MATCH/NEEDS_REVIEW/NOT_CONFIGURED describe the aggregate. Unknown is not a negative outcome.

Attention bands MATCHING/REVIEW/LOW/UNASSESSED and confirmed preference counts order only current returned records. Descriptive required/exclusion notes require manual review, and unassessed preferences mark ranking incomplete. Legacy processing attention and readiness remain separate; neither fit nor any ranking grants contact eligibility. Criteria references name typed fields and remain distinct from snapshot source evidence IDs. Exact contracts and normalization are in [L3-01](L3-01_BUSINESS_FIT.md).

## L3-02 persisted interpretation contract

New classifications carry event_type/confidence, application-owned reason/next step, generation {mode,reason,reply_policy_version,prompt_version,provider?,model?}, evidence {start,end,quote}|null, review_required and candidate|null. See the [bounded contract](L3-02_INTELLIGENCE_QUALITY.md) for exact allowed modes, limits and conservative contact policy. Evidence offsets refer to original UTF-16 message text, never a reconstructed summary. Configured identifiers are bounded and exclude URLs/credential-shaped text; absent history remains unknown.

A model-only HIGH positive/negative/question candidate retains authoritative UNKNOWN/LOW and its existing human-review follow-up. Locally ambiguous or conflicting output abstains. An allowed possible-model OPT_OUT is explicitly review-required but keeps durable contact restrictions. Nothing in interpretation clears restrictions, grants consent, sends a message or completes a human task. Canonical replay keeps the originally persisted interpretation rather than applying today's classifier to historical input.

Messages and lead timeline add interpretation; timeline adds nullable original_text. Invalid metadata or evidence becomes unavailable/review without changing persisted category. Summary generation NO_SUPPORTED_SELECTION is a deterministic fallback requiring review. There are no new tables or states in this slice.

## L3-03 analysis intent, recovery and usage

The [analysis contract](L3-03_ANALYSIS_JOBS.md) adds AnalysisJob (request identity, frozen selection/mode/target/generation, actor, revision and bounded command history) and AnalysisJobItem (scoped lead/event association and ordinal). One job accepts 1..50 distinct active owned leads; at most 100 unfinished items per workspace. QUEUED/RUNNING/RETRY_PENDING/COMPLETED/PARTIAL/FAILED/CANCELLED are composed from authoritative event state. Completion records historical work; CURRENT remains a separate source/algorithm assessment. PREPARE_DRAFTS may create reviewable actions but grants no approval or send authority.

Exact request replay returns the original job. Cancel and retry require the authenticated owner, expected_revision and reason. Cancel fences unfinished events, retains completed results and spent usage, and cannot reopen. Retry preserves original attempts/deadline, revalidates sources and versions and affects eligible held items only. Commands are bounded by 100 recorded decisions and 64 KiB of history; progress pages default to 10 jobs and cap at 20, with at most 50 items and 16 stage descriptors per item. Generic event recovery excludes analysis jobs and rejects direct retry/close commands for them.

AiProviderAttempt binds workspace, optional lead, SYNTHESIS or REPLY_CLASSIFICATION, exact origin/fence, fingerprints, versions and provider/model. ADMITTED means a committed permit, not proof of a network call or charge. OBSERVED records bounded telemetry; UNCONFIRMED retains expired/crash uncertainty. Same invocation identity cannot obtain a second permit. A fresh processing fence can admit a bounded new attempt, so recovery does not promise exactly-once remote cost. Late observation can settle the original permit without publishing cancelled or superseded output.

WorkspaceAiControls defaults to revision0, unpaused, 100 admissions per UTC day and two logical in-flight requests; allowed ranges are 1..10000 and 1..100. Owner revisions/reasons commit with audit. Pricing has at most 20 unique provider/model pairs with exact decimal USD-per-million input/output rates (0..1000000, up to six decimal places). Provider-reported tokens may yield a captured-rate micro-USD estimate, rounded upward to the next micro-dollar. Missing/invalid counts or missing rates yields UNKNOWN/null. Report known subtotal and unknown coverage separately; estimates are neither invoices nor hard monetary caps. Usage reads expose the effective current UTC day and bounded cursor pages; historical attempts remain persisted.

Migration0015 preserves existing events, artifacts, receipts and audits, and creates no retrospective attempts or controls. The server derives actor and workspace from the current session; metadata/reference IDs confer no authorization. New public APIs are POST/GET /api/intelligence/jobs, GET detail and POST cancel/retry, plus owner GET/PUT /api/ai/controls and GET /api/ai/usage. Legacy stage/bulk endpoints return job_id and use the same work authority.

## L3-04 feedback and evaluation records

IntelligenceFeedbackTarget identifies one SNAPSHOT (whole fit assessment), SYNTHESIS, RECOMMENDATION, PLAN or original inbound REPLY. It captures exact immutable output, parent/version references and digest on first accepted review. IntelligenceFeedbackRevision records authenticated owner, reason, labels, expected revision and request identity; RECORD, WITHDRAW and restoration append history. Limits are100 revisions,1MiB target,4KiB labels and20/default50/max history entries. Historical/superseded/archived targets remain identifiable.

Correctness and usefulness are owner judgments about the saved result. For replies, expected_category is an independently entered classification judgment; it alone supplies the expected class in evaluation. Contradictory overall correctness and category labels are not silently rewritten. OPERATIONAL_ONLY is the default; SYNTHETIC and PERMISSION_REVIEWED explicitly nominate examples, without asserting independent adjudication or external data-transfer approval.

IntelligenceEvaluationDataset freezes a named version and1..100 selected feedback revisions. Members bind source/label case hashes; permanent LEAD and REPLY_TEXT groups enforce DEV/HOLDOUT assignment and one HOLDOUT evaluation. IntelligenceEvaluation stores server source identity and aggregate recorded-baseline/current-local-rule metrics. Relabeling or withdrawal makes previous evidence historical and never releases group reservations. Business outcomes and revenue/progression remain L4-05.

Owner APIs are GET feedback target/history/candidates/requests and POST feedback; GET/POST evaluation datasets, GET dataset/request/evaluation history and POST dataset evaluate. Request bodies cannot supply actor, prediction, model, metrics or private replay text. Dataset/evaluation responses omit member identities, labels and original text. The [contract](L3-04_FEEDBACK_EVALUATION.md) owns exact shapes and limits.

## L4-01A email setup, routing and capability records

The [channel setup contract](L4-01_CHANNEL_SETUP.md), [ADR-022](DECISIONS.md#adr-022-versioned-channel-setup-and-truthful-live-capability) and [integrated evidence](verification/L4-01.md) define the implemented bounded slice. It does not yet implement the full target ChannelConnection lifecycle above.

EmailConnectionRevision is append-only owner-reviewed SAVE, PROVISION_ROUTE or ROTATE_ROUTE history. It stores workspace, increasing revision, expected revision, original request identity/hash, private configuration fingerprint, masked before/after summaries, reason and actor/time. Current email settings and credentials remain in organization_settings. The reserved connection_revision advances with every accepted change, preventing edit-back from restoring an earlier approval. History is capped at 100 changes; pages default to 20 and allow at most 50. Identical accepted request replay returns the original change; a different intent under that key conflicts.

EmailWebhookRoute stores globally unique token, same-workspace creating revision/actor and GENERATED or LEGACY kind. Explicit first provisioning may preserve one uniquely owned legacy token while creating a generated alias. At most ten generated aliases and one legacy alias are retained; the latest generated alias is advertised through canonical server URLs. Unknown or ambiguous ownership cannot select a tenant. Rotation preserves earlier signed callback routes and is not signing-key revocation. A normal save cannot repair reserved route/revision corruption by overwriting that history.

Setup reads expose masked settings, MANAGED/LEGACY/DRIFTED state, structural completeness, routing and current verification status. Historical setup snapshots preserve their original UNVERIFIED observation. SendGrid fields may be saved empty as incomplete setup. Editable values are provider sandbox/sendgrid, from_email, reply_to, api_key and separate EC P-256 event/inbound public keys. Credential mask means KEEP, empty means CLEAR and another valid string means REPLACE. Owners cannot author routing tokens, reserved revisions, readiness or verification flags. Settings inspection and proposed writes enforce the 32-key/64KiB budget before full read or mutation, preserving exact stored bytes for untouched legacy values; corrupt state requires operational inspection.

Capability separates configuration from provider evidence. Sandbox needs no live verification. Unsupported live choices return CHANNEL_LIVE_UNSUPPORTED; incomplete SendGrid returns CHANNEL_SETUP_REQUIRED. Complete SendGrid can be reviewed; CHANNEL_VERIFICATION_REQUIRED holds new normal-runtime execution attempts until the current provider verification contract is satisfied. Capability holds retain the exact current approval and do not rewrite truthful historical outcomes. Fixed Reply-To is immutable reviewed sender content, not an enquiry/thread identifier or permission to contact.

Owner APIs are GET/PUT /api/settings/channels/email/connection; POST /provision and /rotate beneath that path; GET /history and /requests/:request_key. Commands require expected_revision, review_token, request_key and reason; SAVE additionally requires all editable values. GET connection, webhook paths and local capability checks perform no provisioning or provider calls. The server supplies actor and workspace. Real sender/domain, delivery/failure, inbound, suppression and operator acceptance remain unverified by local tests. The common composer and enquiry conversation decisions are now implemented; exact provider MIME thread correlation remains unsupported.

## Current customer workflow additions - 2026-09-13

The [customer workflow contract](L4-03_CUSTOMER_WORKFLOW.md) defines append-only conversation decisions, explicit read marks, effective reopen on new canonical inbound, current-owner assignment, internal reminder commands and four unique outcome streams per enquiry. Outcomes preserve corrections/withdrawals and exact money; attribution is an explicit owner assertion. No draft, delivery, reminder completion or AI interpretation creates a human response or business result.

The [provider verification contract](L4-01_PROVIDER_VERIFICATION.md) defines runs, numbered bounded configuration checks, two immutable controlled probes and exact signed receipt evidence. Configuration edits, newer failed checks and expiry invalidate current send capability without rewriting historical evidence. Probe leads are identified through persisted ownership, not user-controlled source labels, and cannot enter automatic customer analysis. [Account security](L5-02_ACCOUNT_SECURITY.md) defines authentication epochs, session references and one-use offline recovery independently of provider messaging.

## Contact-optional enquiry capture correction - 2026-09-13

A manually captured enquiry needs a bounded name; email and phone may be absent. Name/company use 200-character limits, email 320 and phone 80, matching the audited correction contract. Supplied contacts remain validated; missing contact stays null and cannot authorize an outbound envelope. Intelligence, business context and human review can precede contact discovery. Adding a contact uses the existing audited correction and fresh exact approval. This completes an existing Lead Intelligence requirement and removes the obsolete M0 outbound-only admission rule; it adds no new schema or authority.

## Dashboard business outcome projection

GET /api/dashboard/metrics now includes business_outcomes with scope ACTIVE_ENQUIRIES, current recorded/withdrawn stream counts, distinct enquiries with a recorded outcome, and fixed per-kind outcome/enquiry counts. It reads current outcome revision heads under the workspace gate. The React Reported wins card uses distinct active enquiries with current RECORDED WON facts; correction/withdrawal/archive changes the projection. Kinds can overlap by enquiry. No conversion rate, causal effect or mixed-currency revenue is inferred. The legacy leads.converted_count field remains compatibility metadata and is not the displayed business outcome.
