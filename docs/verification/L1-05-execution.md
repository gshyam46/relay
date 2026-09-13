# L1-05 execution and recovery verification

Date: 2026-09-11.
Product: **AI Lead Intelligence & Outbound Automation**.
Status: local implementation and focused automated evidence; root owns integrated acceptance.
Contract: [bounded dispatch and recovery](../L1-05_EXECUTION_RECOVERY.md).

## Implemented files and interfaces

- [ActionExecutor](../../src/modules/handlers/actionExecutor.js) owns due checks, frozen retry policy, fenced attempt authorization, provider outcome persistence and operation drain.
- [dispatchPolicy](../../src/modules/outbound-automation/dispatchPolicy.js) provides canonical UTC validation, bounded policy defaults, deterministic clock/jitter hooks, stable intent keys and retry detail.
- [DispatchRecoveryService](../../src/modules/outbound-automation/dispatchRecoveryService.js) provides inspectAction, listForOrganization, expireLeases and resolve.
- [Focused regressions](../../test/dispatch-recovery.test.js) cover behavior with disposable SQLite, controlled provider doubles and explicit reviewed fixtures.

The constructor accepts now() returning epoch milliseconds, random(), a validated internal dispatchPolicy and a generated leaseOwner. stopAccepting() rejects new dispatch calls with DISPATCH_DRAINING/503; already queued authorization rechecks the flag under the workspace gate. drain() waits for tracked provider/outcome/ancillary operations.

An actual new attempt returns dispatched: true, including an uncertain or stale result. Deferred, held and already executing responses never report a new dispatch. Adapter invocation receives the immutable approvedDispatch plus the server-created execution_id and persisted provider_intent_key.

Recovery inspection returns flat action/retry/hold fields, the identifiable current execution, full attempt/resolution history, recovery_required, can_resolve and allowed_decisions. Lists return items; expiry also returns expired count. The active queue includes unresolved uncertainty/legacy holds, pending retries and DISPATCHING work; closed and operator-resolved acceptance stay in action detail/history and cannot crowd out new work. Inspection never mutates or calls a provider.

## Bounds and safety behavior

The first authorization freezes the smaller of the action's configured max_attempts and the validated runtime policy limit (default three). It freezes a one-hour elapsed deadline and retains both across edits, reviews and restarts. These are internal policy controls; this slice adds no public endpoint allowing a tenant to increase limits.

All entry points honor canonical scheduled_at and next_attempt_at inside the workspace/action transaction. Invalid due times fail closed. Known rejections use persisted exponential backoff from 30 seconds, capped at five minutes, with half-to-full jitter. A valid longer Retry-After wait wins. Count, deadline or key-window exhaustion becomes a durable hold.

The same action/revision uses one provider key. Resend key expiry is fixed on first use, at most 23 hours; retries never extend it. Other adapters acquire no implied provider idempotency guarantee from the stored application key.

Attempt ownership, fence, revision/hash, lease and DISPATCHING outcome commit before provider I/O. Outcome persistence checks exact active execution, owner/fence, DISPATCHING state and an unexpired lease. Late/superseded results cannot release uncertainty or update a newer attempt. An exact early terminal callback still allows the captured message for that same execution to be recorded with its persisted delivered/failed state.

Expired authorization becomes UNCERTAIN and never automatically reacquires ownership. Confirmed acceptance is not expired because delivery remains pending. Existing ambiguous history is held; multiple legacy attempts with no active identity do not cause recovery to guess the latest. Completed/terminal historical actions and completed historical attempts cannot be reopened through recovery.

Operator resolution requires exact execution/fence, authenticated actor and bounded evidence. ACCEPTED also requires a provider reference and explicitly records operator-reported acceptance, not delivery. CLOSE_WITHOUT_RETRY blocks future dispatch while preserving unknown historical delivery. Neither decision resets a budget or authorizes another send. Exact repeats return the recorded decision; conflicts fail. Decision, outcome, action and audit commit atomically.

## Focused verification

Executed:

```text
node scripts/run-tests.js test/dispatch-recovery.test.js
26 tests passed; 0 failed; 0 skipped.
```

Cases cover:

- API and worker future-time refusal; invalid calendar values.
- Durable jittered backoff, Retry-After priority, elapsed/count/key exhaustion and stable key expiry.
- Limits/deadline across new review revisions, stricter per-action policy and database restart.
- Expiry before result persistence, concurrent expiry sweeps, stale fence and a late result after operator acceptance.
- Accepted-versus-delivered semantics and no resend after missing callbacks.
- Stop-accepting/drain behavior.
- Exact early callback recording the reviewed delivered message.
- Required actor/evidence/reference, foreign workspace, stale fence, duplicate/conflicting resolution and live-lease refusal.
- Resolution rollback after audit failure; persistent holds after coarse status/review changes.
- Ambiguous legacy identity and unchanged terminal historical action/attempt records.
- Resolved acceptance/closure excluded from a one-item active queue while complete history remains inspectable.

Focused tests do not exercise real external delivery. Provider doubles and an injected clock provide controlled outcomes; they do not prove live provider acceptance, clock synchronization or PostgreSQL multi-process ordering.

## Remaining acceptance

Root integrates API/React recovery, worker/server shutdown, transport Retry-After handling and broad compatibility fixtures; separate agents own migration/repository and exact callback behavior. Their evidence must be combined before task acceptance.

Required human/external checks remain: recovery UI clarity and keyboard/mobile operation, real PostgreSQL competing processes, process termination/deployment timing, and the selected provider's live idempotency/callback behavior. Confirm a user can distinguish retry due, failed, uncertain, operator-reported accepted and delivered without interpreting internal errors.

General durable inbox/ancillary repair, full sequence scheduling/fairness, negative-evidence resend release and production provider certification remain outside this bounded slice. Recovery never offers a blind retry of an uncertain send.
