# L1-07 callback replay verification

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Scope: callback projection/cursor, exact channel effects and inbound delegation. Shared inbox, schema, provider normalization and application wiring have separate owners/evidence.

## Implemented

- Internal callbacks first use the shared durable inbox. Successful duplicate responses read persisted projection/action/execution; an ineligible processing duplicate returns its receipt state without calling an unclaimed handler.
- The claimed handler verifies receipt ownership under each workspace transaction. Internal callback mandatory policy is explicitly complete before correlation; SendGrid owns its separate restriction phase.
- Exact callback core, execution/action change, event, audit and PENDING cursor commit together. Effects failures preserve the delivery fact and leave a repairable cursor.
- A transaction-aware channel helper commits message reconstruction/update, follow-up creation or explicit skip, and the callback effects marker together. The handler rechecks receipt ownership before committing the effects marker.
- Replay recovers SEND copy only from the execution's bound immutable revision/hash. Missing internal human-task copy is quarantined as MISSING_IMMUTABLE_TASK_COPY. Historical unlinked callbacks are quarantined as LEGACY_REVIEW_REQUIRED; existing history remains unchanged.
- Conversation recovery preserves the actual recipient/content. Follow-up eligibility checks both current lead contacts and the originally contacted recipient, canonical replies since dispatch, exact active execution/fence and linked stopped workflows.
- A pending mandatory contact-policy receipt defers follow-up effects with retryable POLICY_EFFECT_PENDING and keeps the callback cursor PENDING; confirmed durable restrictions still cause an explicit skip.
- A no-response follow-up keeps the original execution completed_at +48hours. Existing cancelled/completed tasks are returned unchanged. Stale and closed attempts record evidence without changing newer work.
- New callback storage keys use receipt:<receipt_id>. Callback detail exposes original source provider_event_id and a separate storage_provider_event_id. SendGrid source identity is the original sg_event_id; its old prefixed input remains usable for legacy detection.
- ChannelWorkflowService delegates inbound handling to the new InboundMessageService and preserves dynamic reply-classifier injection. Deterministic/AI intelligence work is no longer performed in the channel webhook method.

A qualifying reply is a resolved canonical inbound_event. While a new receipt is awaiting classification/resolution, a no-response task may temporarily remain visible. Canonical reply processing removes obsolete action-linked no-response work, including QUESTION/UNKNOWN, in the inbound agent's transaction. This slice does not infer pending contact identity from unclassified receipt JSON.

## Automated checks

Command:

~~~text
node scripts/run-tests.js test/callback-replay.test.js test/exact-callback-recovery.test.js test/dispatch-policy.test.js test/channel-workflow.test.js
~~~

Result: **48 passed, 0 failed, 0 skipped**.

The dedicated callback replay file contains 18 regressions:
1. Follow-up insertion failure rolls message/effects back while delivery and one completion event remain committed.
2. A reconstructed processor resumes persisted input, preserving reviewed copy and original due time after three hours.
3. Later positive reply blocks obsolete no-response creation.
4. Later question blocks obsolete no-response creation and preserves its separate human review task.
5. Later opt-out blocks obsolete no-response creation.
6. A linked stopped workflow blocks reconstruction.
7. A newer execution makes pending old effects SKIPPED.
8. Closed unresolved execution retains evidence without conversation/follow-up effects.
9. Missing human-task snapshot quarantines without reading mutable task copy.
10. Unlinked legacy callback stays unchanged and quarantines.
11. Same raw provider event ID in separate workspaces creates separate receipt-linked projections.
12. Forged/expired receipt ownership cannot commit effects.
13. Concurrent worker/redelivery replay produces one message, follow-up and completion audit/event.
14. A previously cancelled task is not reopened.
15. A restriction on the originally contacted address survives later lead-address edits.
16. Later negative reply blocks obsolete no-response creation.
17. Later unknown reply blocks obsolete no-response creation while preserving review work.
18. A pending mandatory policy receipt defers callback effects with POLICY_EFFECT_PENDING; its resolved reply then completes replay without creating an obsolete no-response task.

Existing exact callback tests retain exact execution/revision/provider, wrong-workspace, fence, terminal precedence, SendGrid reference namespaces, callback core rollback, early callback and immutable recovery assertions. Their old no-repair expectation now asserts persisted PENDING then successful bounded replay. Invalid correlation cases use distinct event IDs so immutable receipt conflict does not mask their intended assertion. Tests use fixed safe error codes rather than injected private storage text.

The helper reconstructs the inbox/service against the same persisted disposable database to test loss of processor memory. This is not a claim of real PostgreSQL process-crash certification. Existing channel restart coverage also remains green.

## Files and contracts

- src/modules/outbound-automation/callbacksService.js: receiveExecutionCallback wrapper; applyExecutionCallback(input,{receipt}) fixed handler.
- src/modules/outbound-automation/callbacksRepository.js: getByReceiptId; core/effects cursors; original source identity in detail.
- src/modules/channels/channelWorkflowService.js: recordExecutionCallbackInTransaction and scheduleNoResponseFollowUpInTransaction; inbound service delegation.
- test/callback-replay.test.js; test/exact-callback-recovery.test.js; test/helpers/callbackFixture.js.
- docs/L1-07_WEBHOOK_REPLAY.md: classification timing clarification.

This component does not implement an outbound retry or invoke providers. Retry budgets, scheduling, fenced receipt claims, retention, owner decisions and worker lifecycle are owned by WebhookInboxService.

## Limits and human QA

- No live provider account, external workflow, customer database or public endpoint was used.
- Real PostgreSQL concurrent processes, least-privilege deployment/restore, signed provider redelivery and failover remain separate acceptance gates.
- Browser QA must inspect a failed callback receipt, verify delivery remains visible, retry after repair, and confirm one conversation entry and original task due time. Verify clear unavailable-copy/legacy review handling and owner/tenant boundaries.
- Verify delivery then later reply/opt-out under a real provider callback ordering, including a response whose classification is still pending.
- The root integration owner must run the full suite and update current task status. These focused results do not certify launch readiness or complete L1.
