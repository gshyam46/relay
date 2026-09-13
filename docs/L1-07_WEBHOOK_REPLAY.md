# L1-07 durable webhook receipt and replay contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: implementation contract recorded before dependent code for the user-authorized next task. Adopts ADR-007 on the existing workspace transaction gate; no new broker, provider, database engine or deployment is introduced.

## Outcome and boundary

A verified event is durably received before acknowledgement. Receipt is distinct from processing: database/provider redelivery and the normal worker can resume unfinished local effects without sending another outbound message. Exact reviewed content, terminal execution facts, suppression and tenant boundaries remain authoritative.

This slice covers current SendGrid event/parse ingress, internal execution callbacks and supported internal inbound-message commands. It adds bounded retries, quarantined-event inspection, owner processing decisions, conservative legacy handling and payload retention. It does not certify live delivery, add other providers, finish campaign/event scheduling, implement general thread assignment or automatically repair unknown historical records.

## Immutable migration 0006

Add webhook_receipts with:

- id primary key; organization_id FK; provider, connection_key, provider_event_id, event_kind; normalization_version integer default 1; normalized_input_json nullable only after purge; payload_hash and identity_hash (unique SHA-256 hex).
- verification_kind: SIGNED_PROVIDER or TRUSTED_INTERNAL or LOCAL_TEST. These values are supplied by the server after authentication, never trusted from event content. Current single logical email connection uses channel_email and survives token/key rotation.
- received_at and updated_at canonical UTC text; processing_state RECEIVED/PROCESSING/RETRY_PENDING/PROCESSED/QUARANTINED/DISMISSED.
- mandatory_policy_status PENDING/DONE, default PENDING. Closure cannot discard a pending suppression/stop effect.
- attempts default 0, max_attempts default 5, first_processing_at/retry_deadline_at/next_attempt_at nullable; lease_owner/lease_expires_at nullable; processing_fence default 0; last_error_code/quarantined_reason nullable; processed_at/payload_purged_at nullable.
- Positive/bounded attempt policy, nonnegative counters/fence, supported state checks. Index tenant/update/id and due/state/lease candidates; avoid indexing long UTF-8 event IDs directly.

Identity hash covers canonical [organization_id,provider,connection_key,event_kind,provider_event_id]. Kinds are fixed ingress families EXECUTION_CALLBACK, SENDGRID_EVENT, INBOUND_MESSAGE, not provider delivery types. Input hashes cover normalized immutable content/correlation, not transport signature, delivery time or MIME boundary. A replay must match both full identity tuple and payload hash; changed content never replaces the first receipt.

Add nullable unique webhook_receipt_id FK on callbacks and inbound_events. callbacks gains core_applied/action_applied nullable integer 0/1, effects_status LEGACY_UNKNOWN/PENDING/DONE/SKIPPED default LEGACY_UNKNOWN, effects_completed_at. inbound_events gains effects_status LEGACY_UNKNOWN/PENDING/DONE default LEGACY_UNKNOWN, effects_completed_at.

New callback projection keys use receipt:<receipt_id> to avoid the old global raw-provider-ID uniqueness contract. Preserve source_provider_event_id in payload and expose it as the provider-facing identity in callback detail. Existing global stored keys remain untouched.

Add append-only webhook_receipt_reviews(id,organization_id,receipt_id,expected_fence,decision RETRY/CLOSE,evidence_note,reviewer_user_id,created_at), unique(receipt_id,expected_fence). Evidence 1..2000 and actor 1..256. A repeated exact command returns its recorded decision; changed intent conflicts.

Keep migrations 0001-0005 unchanged. Preserve all old receipt/body/status/audit fields and add LEGACY_UNKNOWN flags with null links; do not infer applied effects from audit history or synthesize old inbox receipts. Encountering an unlinked old domain receipt requires visible LEGACY_REVIEW_REQUIRED quarantine; never blindly replay old follow-ups or events.

## Shared processing interface

Root owns WebhookInboxService({db,contactPolicyService,now,random,handlers,policyHandlers}), plus an assertReceiptOwnership(tx,receipt) helper. The service exposes:

- receiveAndProcess({organization_id,provider,connection_key,event_kind,provider_event_id,verification_kind,input}, {throwOnProcessingError=true}={}): persist immutable input first, process one eligible attempt inline, return {receipt,duplicate,result}. An ineligible held/in-progress duplicate returns receipt state without reprocessing.
- processReceipt({organization_id,receipt_id}): claim if due/eligible; invoke the registered handler as handler(input,{receipt}); persist guarded outcome.
- processDue({organization_id=null,limit=25}): bounded worker processing including expired claims. Null tenant is internal only.
- inspect/list owner views, review with exact expected_fence/decision/evidence and session reviewer, and purgeProcessedPayloads({limit=25}) for terminal bodies older than 30 days.

Handlers are fixed functions configured in createServices. Input cannot select modules or callbacks. Retain a bounded normalized JSON payload (maximum 256 KiB per receipt), not raw request bytes, MIME attachments, authentication headers, tokens, keys or full unknown provider objects. Read views show state/correlation/reason/retry timing and safe bounded previews; no raw credentials.

Default processing budget: five total attempts and 24 hours from first claim; 60-second lease; retry delay exponential from 5 seconds capped 300 seconds with half-to-full jitter. Permanent malformed/foreign/conflicting/missing correlation becomes QUARANTINED; transient/storage failures RETRY_PENDING, exhaustion QUARANTINED. Persist only fixed safe error codes, never arbitrary exceptions/provider text. A process restart can reclaim expired receipt processing because handlers perform idempotent local DB effects, not external sends.

Claim and completion use workspace transaction, receipt fence/owner and active lease checks. Handlers assert receipt ownership under each participating workspace transaction before state writes. Expired/superseded handlers cannot overwrite the current processing outcome. Normalized first input remains the source for every retry. Processor stop/drain participates in application shutdown; stop new work before closing DB.

## Callback cursor and exact effects

CallbacksService.receiveExecutionCallback delegates to the inbox; applyExecutionCallback(input,{receipt}) is the fixed handler used for internal callbacks or SendGrid event processing. The latter does not create a nested receipt.

Keep receipt projection, exact attempt/action changes, event, audit and core_applied/action_applied/PENDING cursor atomic. Preserve committed delivery facts if later effects fail. A duplicate with PENDING cursor resumes effects; DONE/SKIPPED returns unchanged history.

ChannelWorkflowService exposes a transaction-aware exact message/follow-up helper. Message recovery, no-response follow-up creation or explicit skip, and callback effects marker commit together. Recheck action/execution/fence, current restrictions and qualifying replies/stopped workflows. A reply between delivery and replay must prevent a newly reconstructed no-response task. Due time anchors to the original persisted execution completion timestamp plus 48 hours, never replay wall time. Eligibility checks include both current lead contacts and the immutable recipient originally contacted. A qualifying reply is a resolved canonical inbound_event; pending classification can temporarily leave a no-response task visible, and canonical inbound processing removes obsolete action-linked no-response work for all reply types while retaining or creating the appropriate human review task.

Recover SEND copy only from its bound immutable revision/hash. If historical/internal human-task copy is missing and no immutable snapshot exists, quarantine with a dedicated reason; never reconstruct it from mutable action payload. Stale/closed/terminal callbacks preserve evidence without changing newer work.

## Inbound message processing

Extract InboundMessageService; ChannelWorkflowService delegates while preserving existing public service calls. receiveInboundEvent delegates to the shared inbox; applyInboundMessage(input,{receipt}) is its handler.

Classify outside database transactions, with explicit local opt-out taking precedence and no model call for an already persisted classification. Under the workspace gate, resolve canonical identity, create/read inbound receipt with canonical classification, create a new lead and LeadCreated outbox/audit atomically where needed, and commit required restriction/stop effects. Persist the original sender/contact and message input, not replay substitutions.

Then commit message, applicable lead status, follow-up/stop work, audit, LeadReplyReceived outbox and effects DONE as one scoped transaction. Existing DONE replay cannot create tasks, overwrite lead lifecycle or repeat events. Pending replay uses original classification/content. Ambiguous duplicate contact matches are quarantined rather than choosing an arbitrary record.

Move deterministic snapshot refresh to the LeadReplyReceived worker handler before synthesis/recommendation/planning, including opt-out/suppression signals before skipping contact recommendation stages; the webhook does not run model/research pipelines. General failed domain-event retry remains L1-06, explicitly distinct from durable inbound receipt/effect processing.

## SendGrid normalization and acknowledgement

Verify original bounded request bytes and resolve tenant before receiving any item. Current route size limits stay 1 MiB event batch/5 MiB Parse, with at most 1000 batch entries. Store all accepted normalized items or rejected-item quarantine evidence before 2xx. Receipt storage failure returns 503 so the provider can redeliver the batch; each item has a stable identity.

Whitelist event type, event ID, recipient, action/execution/revision references, provider reference and bounded reason/source timestamp. Preserve conflicting references for validation/quarantine instead of silently choosing one. Tracking is an idempotent receipt effect; restriction writes complete before terminal correlation errors. Mark mandatory_policy_status DONE only after required policy effects commit or positively determining none applies. An event with unresolved mandatory policy cannot be closed by an owner.

Parse normalization uses the stable bounded Message-ID when unambiguous, normalized sender/recipient and canonical body/subject. A fallback content hash excludes MIME boundaries and transient headers; missing/conflicting trustworthy identity is retained quarantined rather than inventing a random ID or silently merging two identical messages. Preserve applicable authenticated opt-out effects even when identity/correlation needs review. Provider request authentication is not proof that the sender owns the mailbox or consented to marketing.

Return receipt_id/state plus per-item outcome. 2xx means durable receipt, including pending/quarantined processing, not successful delivery or completed lead work. Failed processing remains visible and worker-recoverable; arbitrary error text is not returned. Missing/invalid authentication or an unparseable outer body remains a request error without domain writes.

## Review corrections required for safe receipt acknowledgement

Independent failure tests showed that a durable-but-unapplied opt-out could otherwise be acknowledged while another API/worker request sent. Receipt INSERT and dispatch authorization already share a workspace gate. While any workspace receipt has mandatory_policy_status PENDING, dispatch now defers without creating an attempt, changing approval or permanently blocking the action. Actual restrictions retain priority. This conservative workspace hold is released only after required policy is durably DONE; a later contact-indexed hold is an optimization, not permission to bypass pending policy.

Changed-content conflicts preserve the original receipt and create a separate quarantined conflict receipt. The conflict receipt starts with policy PENDING and uses a claimed, bounded policy-only handler: valid opt-outs/complaints may restrict their actual contacts, but no lead creation, delivery transition, message, task or event projection runs. Mark policy DONE in that same transaction before allowing closure. Transient policy failure remains pending and worker-retryable. Never fabricate DONE merely because content conflicts.

Where flat/nested action references conflict, valid recipient suppression may still commit after all supplied known references have been checked to belong to this workspace. Any known foreign reference still fails before effects. This narrows the earlier reject-before-effects rule only for same-workspace conflicts and prevents authenticated opt-out evidence being discarded.

Failure-result persistence requires the same unexpired processing lease as success; an expired handler leaves its claim recoverable instead of permanently quarantining it.

## Owner recovery and retention

GET /api/webhook-receipts and GET /api/webhook-receipts/:id expose scoped, paginated state/history and bounded normalized preview. POST /api/webhook-receipts/:id/review accepts expected_fence, decision and evidence_note. Actor and tenant come from the session.

RETRY is allowed only for QUARANTINED/RETRY_PENDING rows with payload, remaining attempt/deadline budget and no live lease. It reprocesses the exact stored input, does not edit correlation, reset limits or send a message. Changed-content conflicts cannot use ordinary RETRY; their mandatory policy has a separate bounded processing path. CLOSE records an explicit DISMISSED state only when mandatory policy is DONE and no live handler owns it. Both commands increment the fence and audit atomically; completed/dismissed rows cannot be reopened.

Permanently invalid or foreign mandatory-policy evidence can leave the whole workspace held. An inspected, auditable remediation procedure is required before customer readiness; neither RETRY nor CLOSE can rewrite identity, renew budgets or waive unfinished policy.

The UI explains processing/review separately from outbound delivery. Show loading/error/empty states, attempts/time/reason, pagination and exact-fence evidence decisions; do not display database internals as recovery advice. No customer must use developer controls to find stuck receipts.

After 30 days, a bounded worker pass may purge normalized bodies of PROCESSED/DISMISSED rows only. Retain immutable identity/hash/state/review tombstones for deduplication. Never automatically purge unresolved payloads. Full tenant deletion/retention policy remains L5-04.

## Ownership, verification and acceptance

- Root: contract, shared inbox service/ownership and tests, API/React/worker/shutdown integration, primary docs and full checks.
- Migration agent: immutable 0006/registry, migration/legacy/constraint tests and focused evidence.
- Callback agent: callbacks service/repository, transaction-aware channel effects/delegation, replay/follow-up regressions and focused evidence.
- Inbound/provider agent: new inbound service/repository, SendGrid normalization/processing, inbound/ingress replay tests and focused evidence.

Required local tests: receipt-before-effects restart/crash; duplicate and changed payload; concurrent processing/stale lease/fence; rollback; partial callback message/follow-up failure repaired once; later reply/opt-out prevents obsolete task; original due/copy; inbound crash after receipt/classification/lead creation; one canonical event/message/task; batch partial persistence and tracking dedup; malformed/foreign/missing references quarantined; signed/unsigned boundaries; owner/foreign/stale/repeated decisions; retry exhaustion; safe payload purge; shutdown; existing suites and React build.

Real PostgreSQL multi-process/least-privilege/restore, real provider redelivery and human browser/keyboard/mobile recovery QA remain external acceptance gates. Local checks do not close L1 or authorize a customer launch.

References checked: [SendGrid event retries](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook), [Parse retries](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/inbound-email), [Parse retry clarification](https://help.twilio.com/articles/47700775024027).
