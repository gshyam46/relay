# L1-06 workflow scheduling verification

Date: 2026-09-11. Product: **AI Lead Intelligence & Outbound Automation**.
Scope: local implementation under the recorded [scheduling contract](../L1-06_SCHEDULING.md). [Integrated L1-06 evidence](L1-06.md) owns the complete slice and final aggregate results. This record does not certify PostgreSQL, provider or human acceptance.

## Implemented behavior

Workflow advancement is database-only under the workspace transaction gate. Each selected run is reloaded with its campaign, sequence, lead, step and linked action. Campaign/sequence creation and multi-lead enrollment commit with their audits; a mixed invalid selection leaves no partial enrollment. Creating a sequence action, its typed links, pending review, run cursor and audit is atomic. The workflow service never calls an execution adapter.

New runs carry processing_version=1, a revision, UTC eligibility/step anchors and separate pause/hold fields. Enrollment is idempotent per sequence and lead; submitting it again preserves its original schedule. Explicit schedules require a valid calendar instant and offset. WAIT uses the persisted eligibility anchor, so an overdue tick or restart does not restart the delay. SEND delay after completion uses the exact persisted completion instant.

Every new SEND is REQUIRED/AWAITING_APPROVAL even if requires_approval=false was requested. Its pending review becomes an exact immutable preview through the existing approval API. Approval changes WAITING_APPROVAL to WAITING_EXECUTION, without sending or advancing the step. Accepted, deferred, retrying and uncertain work stays at that step. Advancement requires COMPLETED plus the exact current execution's DELIVERED outcome, matching fence and current SEND revision. Coarse completion or missing/foreign links block visibly. Human-task creation/acceptance is not human completion; the full operator completion journey remains L4.

Owner controls require expected_revision, PAUSE/RESUME/STOP, a session actor and 1..2000-character reason. Pause retains the existing review and timing; resume cannot clear legacy holds or reopen terminal runs. STOP blocks eligible queued linked actions and preserves in-flight/terminal facts. The executor rechecks typed or historical workflow linkage and current parent/run/step policy before claiming an attempt. Paused work defers with no attempt. Historical JSON-only workflow links do not gain sending authority. Every canonical reply, including QUESTION/UNKNOWN, stops current runs and queued actions while preserving separate human response tasks; new sequence/step stop_on_reply=false is rejected.

Shared SQL predicates exclude unchanged approval/acceptance waits and valid paused actions from bounded scheduling/dispatch queues. Invalid statuses, due instants and exact-execution links remain visible diagnostic candidates. The fair scheduler consumes these same predicates.

## Files and interfaces

- src/modules/workflows/workflowContract.js: supported linear steps, bounded input, offset/UTC normalization and WAITING_EXECUTION.
- src/modules/workflows/workflowsRepository.js: revision-checked transitions, current typed-link validation, queue predicates and scoped queued cancellation.
- src/modules/workflows/workflowsService.js: atomic creation/enrollment, runDue({organization_id,due_at,limit}) -> {processed_runs}, and controlRun({organization_id,run_id,expected_revision,command,reason,actor}) -> {workflow_run}.
- src/modules/outbound-automation/actionsRepository.js: workflow_run_id/sequence_step_id creation with same-workspace/lead/sequence checks and paused candidate exclusion.
- src/modules/handlers/actionExecutor.js: workflow policy checked before an attempt is created; existing approval, contact, due, budget, lease and outcome boundaries retained.
- client/src/pages/workflows.tsx: owner campaign/sequence creation, selected lead enrollment, local-time input with exact saved UTC preview, run visibility, exact message review and pause/resume/stop controls. No developer runner or synthetic completion button is required for scheduling.
- Migration 0007, shared API/worker/App wiring, fair scheduler and canonical inbound stop integration have separate owners and are covered by integrated evidence.

## Automated evidence

Ran the sanitized test child:

    node scripts/run-tests.js test/workflow-scheduling.test.js test/workflows.test.js test/callback-replay.test.js test/dispatch-policy.test.js test/inbound-replay.test.js

Result: **73 passed, 0 failed, 0 skipped** on disposable SQLite. The 19 new workflow tests cover controlled clocks, future/overdue waits, approval/accepted/uncertain non-advancement, exact delivered anchors, human-task waiting, pause/resume without new approval, queued stop and in-flight stop races, revision/tenant denial, simultaneous materialization, injected audit failure rollback, bounded-queue starvation, foreign/legacy/malformed links, fixed reply-stop validation and normal owner HTTP controls. Seven existing workflow tests retain enrollment, scoped API and file-restart coverage while correcting earlier acceptance-as-completion assumptions. The adjacent callback, dispatch and inbound regressions remain passing, including question/unknown stops and replayed human response tasks.

React checks passed using direct Node entry points from client (Windows command wrappers misparse the ampersand in the workspace path):

    node node_modules/typescript/bin/tsc -b
    node node_modules/vite/bin/vite.js build

The production build reports the existing bundle-size warning for the main chunk exceeding 500 KiB; it is not a type/build failure. No live database/provider calls or browser automation were performed.

## Required human and external checks

Use the normal server to create a campaign/sequence, select leads, save a future schedule, inspect its timezone/UTC instant and wait for the normal scheduler. Review a prepared message; distinguish approval, provider acceptance and confirmed delivery. Pause an approved queued run and verify no attempt appears; resume without changing its approved copy; stop and verify later work stays stopped. Repeat across restart and an incoming question/unknown reply, retaining its human response task. Verify stale-control feedback, keyboard/focus, narrow-screen layout and real owner/viewer boundaries.

Real PostgreSQL multi-process locking, previous-release restore, restricted runtime roles, live selected-provider delivery/reply and customer walkthrough remain mandatory gates. Business timezone/quiet-hours configuration, general visual sequence design, full composer/thread/assignment/human completion and external reminders remain L2/L4/L5 scope. Legacy scheduling holds need inspected remediation; no control silently promotes them.
