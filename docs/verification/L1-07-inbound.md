# L1-07 inbound and SendGrid replay verification

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Scope: local implementation of the [accepted durable webhook contract](../L1-07_WEBHOOK_REPLAY.md). This is focused evidence, not production certification.

## Implemented behavior

InboundMessageService receives through the shared durable inbox. Classification runs outside database transactions; explicit local opt-out overrides optional classification, and a persisted interpretation is reused. A first workspace transaction freezes canonical lead/contact/classification, the linked PENDING inbound record, required restriction/stop effects and new-lead outbox/audit provenance. A second transaction writes the conversation message, lead status, follow-up changes, inbound audit, LeadReplyReceived outbox and DONE marker together. Snapshot/model pipelines run through the worker, not the webhook handler.

When another receipt has unresolved contact policy, a question or unknown response keeps its effects PENDING with a transient POLICY_EFFECT_PENDING error; it retries after policy processing instead of losing the human task. Every question or unknown response cancels its existing action-linked no-response task while preserving unrelated operator tasks and creating an eligible human response task. A completed inbound cursor does not repeat lifecycle changes or cancellation even when the enclosing inbox completion previously failed. Existing unlinked receipts remain LEGACY_UNKNOWN and require review. Their valid policy-only effects can complete independently, so an owner can close reviewed history without replaying unknown messages, tasks or events.

SendGrid normalization retains bounded approved fields and exact correlation references. Equivalent flat/nested references normalize to the same input; conflicting references remain visible for quarantine. Tracking audit and inbox completion commit together. Provider suppressions precede delivery correlation or ancillary errors. A recognized nonrestrictive event records that no mandatory contact effect applies before checking action correlation; a missing action can then be reviewed and closed without unnecessarily holding the workspace. Valid recipient policy can still apply for missing event identity and conflicting same-workspace action references; any known foreign action reference refuses all effects. Root-owned policy-only conflict dispatch preserves the original domain projection while applying a valid contact stop from changed input under a distinct conflict-receipt source key.

Parse uses an unambiguous Message-ID plus canonical sender/recipient/body evidence. Missing or conflicting Message-ID uses a deterministic evidence hash and enters review; this does not create a new lead or silently merge unidentified mail. Multipart boundaries do not participate in identity. Duplicate identity form fields and conflicting envelope/header sender prevent arbitrary sender selection. Attachments and raw headers are not retained. Text retention is bounded to 32,768 code units; an oversized body is quarantined with its full-content hash and preserves explicitly detected opt-out intent even beyond the retained preview. Missing/ambiguous sender on a possible stop remains mandatory-policy PENDING.

## Files and interfaces

- src/modules/channels/inboundMessageService.js: receiveInboundEvent(input), applyInboundMessage(input,{receipt}), and applyConflictPolicyInTransaction(tx,organizationId,input,{receipt}).
- src/modules/channels/inboundEventsRepository.js: nullable inbox link and explicit PENDING/DONE processing cursor; no inferred legacy completion.
- src/modules/channels/sendgridEvents.js: normalizeSendgridEventReceipt(event), normalizeSendgridInbound(fields,{organization_id}), applySendgridEvent(services,organizationId,event,{receipt}), and applySendgridConflictPolicyInTransaction(services,tx,organizationId,event,{receipt}).
- test/inbound-replay.test.js, test/inbound-contact-policy.test.js, test/email-webhooks.test.js, test/sendgrid-webhook-security.test.js: focused new regressions and updated compatibility fixtures.

The root integrates API authentication, shared inbox processing, worker and conflict handlers; the callback owner supplies exact callback/message processing and ChannelWorkflowService delegation. Migration0006 is owned and verified separately. All processing uses the shared workspace and receipt ownership checks; no external send occurs during replay.

## Local verification

Command:

~~~text
node scripts/run-tests.js test/inbound-replay.test.js test/inbound-contact-policy.test.js test/email-webhooks.test.js test/sendgrid-webhook-security.test.js test/webhook-recovery-http.test.js
~~~

Result: **57 tests passed, zero failed or skipped** (19 inbound replay, 21 contact-policy/compatibility, 7 email webhook, 5 signature/security and 5 HTTP recovery). Tests use disposable SQLite and synthetic/intercepted provider data. Important failure injections are database abort triggers, so transaction-scoped repositories cannot bypass the test.

Coverage includes final outbox rollback, message rollback after restriction, first-stage provenance rollback, restart with canonical classification reuse, one concurrent lead/message/event, completed-effects replay after inbox-completion failure, legacy quarantine, canonical sender after lead edit, actual failed callback then repaired delivery then question, missing/conflicting/oversized Parse identity, changed canonical recipient, malformed provider identity with durable suppression, tracking deduplication, exact delivery metadata, foreign-reference refusal, legacy policy-only closure missing nonrestrictive delivery-reference closure, and delayed human-task creation after unrelated policy completes. The security regression proves that a failed restriction write after durable receipt returns HTTP200, keeps policy PENDING and dispatch deferred with no execution attempt, then completes through the normal worker with unchanged input/hash and no duplicate restrictions. Separate HTTP coverage retains HTTP503 for receipt-storage failure.

Syntax checks passed for the three owned runtime modules. The repository format check passed for 222 files after the evidence file was added; integrating checks record any later workspace count. Historical L1-04/L1-05 verification remains historical evidence and is not overwritten.

## Remaining acceptance gates

Real PostgreSQL multi-process ordering and restricted-role checks, a populated upgrade/recovery rehearsal, real signed SendGrid redelivery, and human browser/keyboard/mobile inspection remain required. No live provider or customer database was used. The 32,768-code-unit Parse preview limit and unsupported attachments/raw-MIME delivery are explicit product limits to validate with the pilot workflow.

An event in processing review must not be described as delivered or fully handled. Owner closure cannot bypass unresolved mandatory policy. General failed domain-event replay and complete scheduling/fairness remain L1-06; this slice durably publishes the reply event but does not certify every downstream intelligence retry.

Official provider acknowledgment references: [Event Webhook retry behavior](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook) and [Inbound Parse retry behavior](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/inbound-email). Successful HTTP acknowledgment means durable receipt; local processing can remain pending or quarantined.
