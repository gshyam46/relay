# L2-04 runtime safety and independent review evidence

Date: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.
Scope: local implementation and disposable automated verification of the accepted [L2-04 contract](../L2-04_DATA_MANAGEMENT.md). This is not customer, live-provider or PostgreSQL operational acceptance.

## Implemented behavior

- The shared safety transaction retains every old directly applicable restriction on the enquiry at its original channel, including hard bounces. Original contact restrictions remain intact; the deterministic carried source event identifies the immutable original restriction. No new-address or neighboring enquiry restriction is inferred.
- Correction stops queued actions and open workflows and cancels automatic no-response tasks. Human follow-up tasks survive correction. Archive cancels all open follow-ups and stops all open workflows, including paused runs. Restore cannot restart them.
- Safety preflights total open actions, workflows and follow-ups at 10,000 before effects. Excess fails atomically with LEAD_DATA_WORK_LIMIT. Restriction carry is bounded at 10,000. Existing ambiguous/authorized executions retain their state and evidence; current schema rejects NULL outcomes, and the safety predicate also treats unknown/null legacy outcomes conservatively.
- Current intelligence reads reload authoritative lead data. Revision zero leaves existing snapshot/review fingerprints compatible. Nonzero revision prevents edit-back or archive/restore from resurrecting an old current snapshot, model artifact, plan or approval. Corrected fields cite their immutable change as MANUAL evidence and are visibly titled Owner-corrected; unchanged fields retain original provenance.
- Model capture rejects a stale previously loaded lead before generation; finalization and cached output reuse verify persisted revision and archive state inside the workspace transaction. Deterministic snapshot creation and manual research ingestion stay inside short transactions without model or provider I/O.
- New action creation, review decisions, dispatch, workflow enrollment/control/advancement and scheduled follow-ups reject archived enquiries. Historical approval reads do not generate a new preview for archived enquiries, including a preserved legacy ambiguous attempt. Queue selectors exclude archived work. Recovery queues and inbound matching retain archived records.
- Already-authorized provider outcomes and exact callback message/delivery records remain truthful. Confirmed rejection after correction/archive cannot schedule another attempt. Old completion cannot create a no-response task after correction or archive/restore; newly reviewed current intent can still create its own follow-up.
- Archived ordinary replies and opt-outs remain associated with the existing enquiry and commit their message/policy/event history without new response tasks, lifecycle resurrection or AI work. Durable lead events checkpoint as skipped.
- A normal late SendGrid restriction can additionally anchor to a corrected enquiry only with exact persisted action/execution/revision, authorization, provider, envelope hash, immutable content fingerprint and original recipient proof. The current email must have a recorded CORRECT origin and differ from the original recipient. Old inactive attempts remain evidence. Missing/conflicting references, wrong recipient/hash and revision-zero inputs retain the existing actual-contact-only behavior. Changed-input receipt conflict policy is unchanged. Recipient plus enquiry policy effects commit atomically, with mandatory policy remaining pending on failure.

## Files and contracts

The new shared module is src/modules/data-foundation/leadDataSafety.js. Its applyLeadDataSafetyInTransaction(tx, {organization_id,lead_id,before,after,change_id,kind,actor,reason,timestamp}) requires the existing workspace transaction and the authoritative pre-update lead. It returns carried_restriction_ids, blocked_actions, cancelled_follow_ups and stopped_workflows. Backend management calls it before updating the lead and appending history.

Runtime integration modifies intelligenceService/businessContextGuard, preparedActionService, ActionsService/OutboundAutomationService/ActionExecutor, workflow service and queue selectors, scheduler/follow-up due processing, channel/inbound/lead-event handling, research ingestion and typed-enquiry updates. The exact late-provider proof is isolated in sendgridEvents.js. No API, migration registry, provider settings, package script or deployment was changed by this ownership slice.

New tests are in test/lead-data-runtime-safety.test.js (28 behavioral cases). The existing revision-zero compatibility assertion in test/l2-context-review.test.js explicitly excludes the two new default columns when reconstructing the pre-migration fingerprint; it continues verifying the exact historical hash rather than silently resetting authority.

## Automated verification

Final focused command:

~~~text
node scripts/run-tests.js test/lead-data-runtime-safety.test.js test/l2-context-review.test.js test/prepared-action-review.test.js test/research-evidence.test.js test/channel-workflow.test.js test/workflow-scheduling.test.js test/domain-event-processing.test.js test/dispatch-recovery.test.js test/inbound-contact-policy.test.js test/inbound-replay.test.js test/callback-replay.test.js test/scheduler-fairness.test.js
~~~

Result: **198 tests; 197 passed, 0 failed, 1 explicitly skipped**. The skip requires a separately authorized disposable PostgreSQL target. The safe launcher removed inherited database/provider configuration. Tests use disposable SQLite, synthetic recipients and in-process provider behavior; no live provider was called.

After the final archived-approval-history read adjustment and explicit corrected-title assertion, node scripts/run-tests.js test/lead-data-runtime-safety.test.js test/prepared-action-review.test.js test/human-approval.test.js passed **51/51**, with no skips or failures.

Coverage includes old-caller and concurrent model mutations for all three model stages; archived model finalization; revision-zero review compatibility; edit-back/restore freshness; manual versus imported field provenance; restriction carry without neighbor propagation; pending/ambiguous dispatch evidence; transactional rollback; bounded archive refusal; scheduler exclusion and direct processing checks; truthful old versus usable new callback intent; archived contact-only replies and opt-outs; exact late SendGrid proof, wrong/missing/conflicting references, wrong recipient/hash, receipt replay and policy-write rollback. Existing restart, transport, policy, workflow, event and callback suites also passed in this run.

## Remaining acceptance and deliberate limits

Root owns full repository CI and integrated HTTP/UI verification. Human acceptance must verify understandable correction/archive consequences, preserved restrictions after typo correction, stale-review guidance, source labels, archived history and deliberate new work after restore. Real independent-process PostgreSQL locking/upgrade/restore and authenticated late provider events remain unverified here.

An uncorrelated reply to an old corrected address has no reliable thread-to-enquiry association in this slice. The application does not infer one from a former address or name. That requires the later inbox/thread-assignment workflow. Likewise, this slice has no verified-address exception or evidenced resubscription command that clears retained restrictions. Operational remediation of policy holds and over-cap work remains required rather than silently bypassing them.
