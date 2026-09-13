# L4-03/L4-04/L4-05 customer workflow contract

Recorded 2026-09-13 before source implementation. Root approved this bounded continuation under [COMPLETION_PLAN](COMPLETION_PLAN.md). This is the single-owner local workflow contract, not transport threading, provider verification, team collaboration or launch acceptance.

## Ownership and scope

The backend owner implements src/modules/customer-workflow/*, focused tests and verification evidence. Root owns migration0021_customer_workflow, registry, API/factory, shared UI and integration. Existing inbound processing and provider adapters are unchanged.

Use existing leads, canonical inbound events/channel messages, FollowUpsRepository transitions, normal due scheduler, exact composer/approval/executor and workflow enrollment. Conversation attention, human reminders and business outcomes are independent facts. Drafting, approving, sending, delivering, reading or completing a reminder cannot fabricate a human response or business result.

## Conversation state

conversation_revisions is append-only, scoped by workspace/enquiry and increasing integer revision. A row captures status OPEN|RESOLVED|ESCALATED, assigned_owner_id, read_inbound_token, resolved_inbound_token, forced_unread, observed_inbound_token, inbound_count, last_inbound_message_id, expected revision, original request identity/hash, reason and authenticated actor/time. Unique workspace request keys support exact original-result replay; revisions are unique per enquiry. Message, lead and user references are scoped foreign keys.

GET uses canonical same-enquiry inbound messages only. Its observation token binds the count plus latest recorded canonical message/event identity and timestamps; count changes detect late or backdated arrivals even when the displayed latest message does not change. No inbound processor mutation is needed. This relies on the currently immutable canonical inbound association; future retention/deletion must preserve or explicitly update observation semantics rather than reuse a stale cursor.

Effective unread is explicit forced_unread or a changed inbound token since the last READ. Empty history is read unless explicitly marked otherwise. READ records the current inbound token and clears forced unread; UNREAD explicitly sets it; KEEP preserves the previous read mark. Saving status/assignment does not silently mark messages unread.

A stored RESOLVED state becomes effectively OPEN when canonical inbound observation changes. ESCALATED remains escalated. Stored decisions remain in history. Contact restrictions, pending mandatory policy and archive are separate attention labels: opt-out is never shown as ordinary Needs reply. None of these annotations changes contact permission.

Assignment initially supports assign-to-self or unassigned. The server validates the current database owner. This does not claim multi-operator routing, shared credentials or handoff support.

Methods: getConversation, saveConversation, listConversations. GET /api/leads/:id/conversation returns {conversation:{revision,status,effective_status,read_state,assigned_owner_id,last_inbound_message_id,inbound_count,attention,review_token},history:{changes,has_more,next_before_revision}}. Save requires request_key, expected_revision, review_token, status, read_state:KEEP|READ|UNREAD, assigned_owner_id and reason. Read/list never creates a conversation revision. Default history/page limit20, maximum50.

## Human follow-ups

New owner reminders use existing follow_up_tasks with channel HUMAN_TASK and no action link. A selected canonical inbound reference may be retained for context. A due reminder is internal work, not a queued send or permission to contact. Existing normal scheduler turns future PLANNED tasks into DUE; invalid historical dates remain visibly blocked.

follow_up_commands records CREATE|RESCHEDULE|COMPLETE|CANCEL, scoped task/lead, expected task token, original request/hash, exact before/after snapshots, reason and actor/time. Snapshot JSON is limited to16KiB each. Original request replay occurs before comparing present task state, so later due transitions/completion do not destroy recovery.

Creating a reminder requires a current lead review token and an explicit-offset due instant, stored canonical UTC. Past/current due time creates a due reminder; a future due time remains planned. Current archive prevents new reminders. Manual internal work may still document a restricted enquiry without changing its contact policy.

Current task state tokens bind persisted task fields, including due time/status. Scheduler or owner changes make an old command stale. Reschedule permits PLANNED/DUE/BLOCKED and repairs the due instant without reopening terminal history. Automatic no-response timers retain their original confirmed-completion-plus48-hours basis and cannot be rescheduled through this command; they may be completed or cancelled explicitly. Complete/cancel reuse existing guarded transitions. No follow-up command marks a conversation resolved or records a send.

Methods: listFollowUps, createFollowUp, changeFollowUp. Lists return {follow_ups,review_token,has_more,next_after_id,limit}; public tasks include state_token, origin MANUAL_REMINDER|AUTOMATIC_NO_RESPONSE|INBOUND_REVIEW|LEGACY and can_reschedule. CREATE accepts request_key, review_token, due_at, reason, reply_to_message_id. Changes accept request_key, expected_task_token, operation, due_at (RESCHEDULE only; null otherwise) and reason.

## Owner-reported outcomes

business_outcomes stores immutable scoped identities and four unique slots per enquiry: QUALIFIED_CONVERSATION, MEETING_BOOKED, QUOTE_REQUESTED and RESULT. The first three have fixed kinds; RESULT is WON or LOST. This deliberately records one milestone per enquiry: repeated meetings/notes do not create additional conversion facts, and a result correction cannot leave simultaneous current WON and LOST facts. A distinct opportunity remains a separate enquiry.

business_outcome_revisions captures full immutable snapshots: status RECORDED|WITHDRAWN, kind, occurred_at, summary, optional source reference/canonical message, optional attributed action and mandatory attribution note when attributed, optional exact amount, expected revision, request identity/hash, correction reason and actor/time. Slot/kind consistency is enforced under the workspace gate. Scoped lead/message/action/user foreign keys prevent cross-enquiry and cross-tenant links.

Every outcome is explicitly owner-reported. The occurred time means when the reported milestone happened (for MEETING_BOOKED, booking time rather than the future meeting time), with explicit offset normalized to UTC. Future occurrence is refused. Source references are operator-provided, not independently verified evidence. Attribution is a separate explicit owner assertion requiring a note; no causal relationship is inferred from an action.

Only WON may carry an optional amount. Input is {currency,value:decimalstring}; storage/public normalized value is {currency,scale,minor_units:string}, using the existing fixed supported currency scales and at most24 minor-unit digits. This is reported deal value, not received cash or recognized revenue. Other kinds require amount:null. No currency conversion, floating-point arithmetic or activity-as-revenue aggregation is introduced.

Creating an already existing slot requires correcting/restoring its existing stream. Correction and withdrawal append revisions and preserve all prior values. Exact request replay returns the original saved revision even after later correction/withdrawal. Current lead review token and expected outcome revision are required; new streams use expected_revision0.

Methods: listOutcomes, getOutcome, saveOutcome, exportOutcomes. Save accepts outcome_id:null|id, expected_revision, review_token, request_key, status, values:{kind,occurred_at,summary,source_reference,evidence_message_id,attributed_action_id,attribution_note,amount}, reason. Text bounds: summary/reason/attribution note2000, source reference500; amount JSON1024bytes. Lists/history default20/max50.

Export selects1..1000 explicit outcome IDs in the current workspace, preserving current revision/status and exact monetary/source/attribution fields. It uses the shared formula-safe CSV serializer, exact JSON cells and an8MiB aggregate input/output budget; mixed-currency values are not added. Export is audited. It returns {csv_text,filename,row_count,generated_at} for the root HTTP attachment boundary.

## Recovery and common authority

All commands use current database owner/workspace authorization, the workspace transaction gate and an explicit reason. Mutations return {change:<original public revision/command>,replayed}; byRequestKey({kind:CONVERSATION|FOLLOW_UP|OUTCOME,request_key}) returns {change:null|original}. Replay lookup precedes current state checks; changed intent under an accepted request key conflicts. GET has no state-changing side effects. No module makes provider/model calls.

Database numeric revision/count columns require integer checks; scope-specific unique indices support composite foreign keys. No historical conversation, task or outcome judgments are backfilled. Related writes and audit either all commit or all roll back.

## Verification and remaining acceptance

Required local checks cover new/late inbound effective reopening, READ/KEEP/UNREAD semantics, source/tenant/owner checks, stale and racing commands, original recovery after restart, follow-up clock/scheduler changes and terminal preservation, four-slot dedup/result correction, exact money, unsupported/future inputs, audit rollback, bounded list/history and formula-safe selected export. Preserve existing follow-up and approval tests.

Root integrates React first reply, readable history, due work and outcome journey. Exact transport thread association, real provider verification/delivery/reply, team assignment, external notifications, PostgreSQL concurrency/restore and customer workflow usefulness remain external or later contracts. Local implementation does not certify customer acceptance.


## Scoped conversation message paging

GET /api/leads/:id/conversation/messages uses listConversationMessages with limit20/max50 and after_id. Cursor lookup is scoped to the enquiry/workspace and resolves to the persisted (created_at,id) tuple; pages are newest first. This is an enquiry message history, not a claim of SMTP threading or sender authenticity.

The result is {messages,has_more,next_after_id,limit,byte_limit:4194304}. Public rows retain exact body/subject, direction/channel/status, scoped action/inbound reference, occurred/created times and publicReplyInterpretation. Raw payload, provider references/credentials and unsanitized provider summaries are omitted. Metadata-first content inspection is capped at256KiB/message; aggregate serialized response at4MiB, with explicit continuation when the budget stops a page. Auxiliary payload JSON is materialized only within256KiB; oversize/malformed metadata produces metadata_unavailable and the existing conservative interpretation projection, without hiding valid original content.

Root's actual mutation routes are POST /api/leads/:id/conversation, POST /api/follow-ups/:id/change and POST /api/leads/:id/outcomes. Recovery uses GET /api/customer-workflow/requests/:kind/:key; directory uses GET /api/customer-workflow/conversations. These retain the frozen service command fields and are consistent with the recorded owner-only API boundary.
