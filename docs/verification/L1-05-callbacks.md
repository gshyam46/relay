# L1-05 Exact Callback and Provider Correlation Evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Status: implemented with local synthetic tests. Real PostgreSQL, provider and human acceptance remain open.

## Scope and contracts

This implements the callback dependency of the [bounded execution recovery contract](../L1-05_EXECUTION_RECOVERY.md). It does not complete the general L1-07 webhook inbox.

CallbacksService.receiveExecutionCallback now requires action_execution_id. revision_id and provider are optional for trusted internal/test callers; live SendGrid terminal events require both relay_execution_id and relay_revision_id and enforce the recorded SendGrid provider. There is no latest-attempt fallback inside the service. The integrating API owns the explicitly local, single-unambiguous-attempt fixture compatibility path.

The callback service uses the workspace policy transaction, scoped action/attempt reads, and the current active_execution_id/execution_fence. Receipt, exact attempt outcome, conditional active action update, audit and ActionCompleted domain event commit together. Failure before commit rolls all of them back; a provider retry can then process the event. Duplicate receipts compare workspace, action, execution, status, provider reference, revision and provider identity.

Only DISPATCHING, ACCEPTED and UNCERTAIN outcomes can receive a new terminal transition. A callback can resolve its exact uncertain attempt after the worker lease expires, without authorizing another provider invocation. Historical or superseded attempts retain callback evidence without mutating the current action, either message or follow-up. CLOSED_UNRESOLVED remains closed. A new conflicting terminal event cannot overwrite confirmed delivery or another frozen terminal outcome.

The service accepts an optional now() epoch-millisecond clock for deterministic completion timestamps. The production default is Date.now. Provider callback evidence is distinct from a worker outcome: provider authentication and exact identity authorize the former; lease owner/fence validation remains the executor's responsibility.

## Message and provider behavior

Channel message callbacks receive the exact execution, then recheck ownership under the workspace gate. They locate the message through its execution idempotency key, never latestOutboundForAction. Follow-up creation rechecks the same execution/fence, confirmed delivery and current contact restrictions inside its own transaction. This also handles a newer attempt appearing between core commit and ancillary processing. If the callback resolves an uncertain send before any conversation was stored, the same transaction now creates the missing exact message from the attempt's immutable action_revision_id. It checks workspace/action/type/channel and both persisted envelope hashes, preserving the reviewed recipient/sender/copy even if current lead or action payload changed. The execution idempotency key prevents a duplicate message; no provider resend is involved.

The router accepts server-created execution_id and provider_intent_key alongside approvedDispatch. Real provider dispatch requires both. SendGrid sends relay_execution_id together with the action and immutable revision custom arguments. Resend receives the stable provider key while its request body remains unchanged across retries; changing attempt metadata is not added to its payload.

SendGrid HTTP X-Message-ID and webhook sg_message_id are separate identities. The callback row preserves the webhook reference; it does not overwrite or compare it as if it were the HTTP acceptance reference.

SendGrid event IDs now have an application bound of 2,048 characters. Existing IDs of at most 100 characters retain their prior policy source key; longer IDs use a SHA-256 source key to respect the contact-policy storage contract. Valid recipient restrictions commit before missing, conflicting or wrong terminal execution/revision correlation is reported. Known foreign action references still fail before effects. Missing/obsolete action references can still restrict the authenticated workspace's actual recipient without attempting action mutation.

## Files

- [callbacksService.js](../../src/modules/outbound-automation/callbacksService.js): exact correlation, atomic core transitions, immutable terminal outcomes, injectable clock and ancillary failure audit.
- [callbacksRepository.js](../../src/modules/outbound-automation/callbacksRepository.js): conflict-safe insertion and canonical duplicate identity checks.
- [channelWorkflowService.js](../../src/modules/channels/channelWorkflowService.js): exact message selection and follow-up ownership checks.
- [sendgridEvents.js](../../src/modules/channels/sendgridEvents.js): terminal execution/revision validation and long event identity handling.
- [channelRouter.js](../../src/modules/handlers/channelRouter.js) and [emailAdapter.js](../../src/modules/handlers/emailAdapter.js): captured execution metadata and stable provider intent key.
- [exact-callback-recovery.test.js](../../test/exact-callback-recovery.test.js): fourteen focused regressions.
- [inbound-contact-policy.test.js](../../test/inbound-contact-policy.test.js), [email-webhooks.test.js](../../test/email-webhooks.test.js), [channel-workflow.test.js](../../test/channel-workflow.test.js): preserved positive/negative behavior with explicit execution setup; SendGrid HTTP fixtures use captured SendGrid configuration and a synthetic external fetch response.

Migration 0005 and execution repository methods belong to the migration agent; bounded claims/recovery belong to the execution agent; API/worker integration and shared documentation belong to the integrating owner.

## Verification

~~~powershell
node scripts/run-tests.js test/exact-callback-recovery.test.js test/inbound-contact-policy.test.js test/dispatch-policy.test.js test/channel-workflow.test.js test/email-webhooks.test.js
~~~

The final five-suite run after missing-message recovery passed **57 tests, zero failed or skipped**: 14 exact callback tests, 20 inbound policy tests, eight dispatch policy tests, eight channel workflow tests and seven email webhook tests. The earlier 48-test result predates that recovery fix. Syntax/formatting and broad integrated results are recorded in [L1-05 verification](L1-05.md); the primary-document reconciliation follows this runtime result.

The focused tests prove:

- Explicit same-workspace execution identity; revision/provider mismatch rejection.
- Exact expired uncertainty resolution without another attempt.
- Historical/new-revision isolation for action, attempt, message and follow-up.
- Same-execution fence mismatch and closed unresolved outcome preservation.
- Delivery nonregression and changed duplicate correlation rejection.
- Atomic rollback after an injected audit failure, followed by successful retry.
- Restriction survival despite missing/conflicting/wrong terminal correlation.
- Long provider IDs, legacy short source identities and duplicate handling.
- Distinct HTTP/webhook message references.
- Ownership recheck when a newer attempt appears after core callback commit.
- Later delivery of an uncertain attempt with no conversation creates exactly one DELIVERED message from the original immutable revision despite subsequent lead/payload changes; replay creates neither another message nor another attempt.
- Competing duplicate callbacks produce one receipt, completion event and follow-up.
- Ancillary failure leaves core delivery committed and a safe failure audit, with no duplicate core transition.

Initial rollback-test setup used the wrong audit table name; it was corrected to audit_logs before the passing run. No failing assertions were removed or weakened. Tests use disposable SQLite and synthetic provider responses; no real sends, customer database writes or deployment occurred.

## Remaining limits and human QA

A channel-message/follow-up failure after core commit still needs L1-07 repair. It emits ExecutionCallbackAncillaryFailed where the audit store is available and propagates the failure; a duplicate callback does not yet replay these ancillary effects. Callback rows do not yet have the full inbox processing cursor, retry schedule, quarantine queue or retention controls. General inbound intelligence/event replay also remains separate.

Unknown live terminal references fail closed after applicable restriction effects. Historical callback evidence can be inspected in the callback/audit records; this slice does not add a complete operator inbox for unmatched events. Resend, Twilio SMS/Voice and Meta WhatsApp webhook ingress are not implemented here.

Human/provider QA must verify that SendGrid echoes the execution and revision custom arguments, send a signed delayed event for an original attempt, inspect the matching action/message history, and confirm that an expired/closed/newer attempt cannot be reopened or resent. Show restrictions surviving incomplete event metadata and demonstrate the visible ancillary-repair limitation. Real PostgreSQL races and shutdown/recovery proof remain integrated acceptance requirements.

Provider contracts checked: [SendGrid events](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event), [SendGrid message identities](https://www.twilio.com/docs/sendgrid/glossary/message-id), [Resend idempotency and identical payload requirement](https://resend.com/docs/dashboard/emails/idempotency-keys).
