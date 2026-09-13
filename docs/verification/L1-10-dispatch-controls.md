# L1-10 sending controls and provider response bounds

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Scope: local implementation evidence for the outbound portion of [L1-10](../L1-10_OPERATIONS.md). This supplements prior L1-04/L1-05/L1-06/L1-08 evidence; it does not replace their outstanding PostgreSQL, provider or human acceptance gates.

## Implemented

DispatchControlsService uses the typed workspace_dispatch_controls table from migration0008. Missing state presents revision0, unpaused, 100 SEND attempts per UTC day and 2 unresolved slots. Owners can change limits within1..1000 /1..10, with exact revision, an explicit reason, current owner identity and one atomic audit. Malformed saved controls fail closed. Global enablement must be an explicit boolean injected from validated configuration; neither the service nor executor silently enables omitted configuration.

The executor checks controls inside the existing workspace transaction immediately before persisting an execution. The same captured authorization instant defines the UTC quota day, execution start/authorization, lease and first-attempt retry deadline; the quota inspector must not read a second clock at midnight. This preserves contact restrictions, pending contact-policy checks, exact immutable review, workflow stop/pause, schedule, retry/deadline and provider-key checks. An operational hold returns deferred=true and operations_hold, with no new execution, provider invocation, approval change or persisted operational hold that would survive a later resume. Only SEND types consume quota or slots. Human tasks remain eligible.

Every persisted SEND authorization counts, including sandbox and retry attempts. Legacy executions without dispatch_authorized_at use their persisted started_at as conservative daily usage. UTC rollover changes workspace admission only; it never resets any action's attempt budget, deadline or provider key. DISPATCHING and UNCERTAIN execution rows consume unresolved slots irrespective of lease expiry. Known acceptance, exact delivery callbacks and evidence resolutions release capacity without erasing history. Ambiguous legacy held/unmatched executing actions count once when outcome evidence is missing or non-completed LEGACY_UNKNOWN history exists; completed-only historical execution records do not acquire an unreleasable slot. Ambiguous legacy identity or missing evidence may require operator remediation beyond the ordinary recovery controls.

The shared candidatePredicate is an optimization for ActionsRepository and the root-owned scheduler/worker integration. It applies only to the action branch and excludes paused, invalid or capacity-held SEND candidates while leaving other phases and human tasks eligible. Executor authorization remains authoritative if a candidate races a settings update. Queries use typed policy fields and existing SQL features, with no added PostgreSQL16 requirement.

Settings now includes Sending controls: visible global/workspace hold, UTC attempt usage/reset, unresolved/legacy counts, owner limits and reason, safe loading/error/permission states, and a retained expected-revision draft. Polling refreshes usage without silently replacing an edited revision. A stale revision requires the explicit Load latest values action. Resume cannot override the global setting. Already authorized requests may finish; these limits do not constitute a monetary cap or a bound on all physical sockets/model costs.

Provider transport uses the original15s deadline for headers and successful JSON reading. Response bodies are streamed with a64KiB cap. Error/non-JSON/header-only bodies are cancelled without parsing; unfinished readers are cancelled and deadline/listener resources released. HTTP2xx stays accepted when JSON is oversized, malformed, absent or stalled. Adapters return a null provider reference and a fixed response_issue when parsing/reference recovery fails. References must be nonempty strings of at most512 characters without CR/LF/NUL, and are checked again when persisted. Only whitelisted issue codes enter execution responses and ActionStarted audit metadata. No unbounded response.json fallback remains in the four adapters.

## Automated evidence

Command from repository root:

~~~text
node scripts/run-tests.js test/dispatch-controls.test.js test/provider-response-bounds.test.js test/dispatch-recovery.test.js test/dispatch-policy.test.js test/email-channel.test.js test/prepared-action-review.test.js test/dispatch-transport-shutdown.test.js
~~~

Result: **97 tests passed, 0 failed, 0 skipped** on disposable local SQLite and synthetic provider streams. Includes19 sending-control tests,9 new response-bound tests and69 existing dispatch/recovery/review/provider/shutdown tests.

Covered behavior includes all four SEND types paused without lost approval or attempts; explicit global hold with human work preserved; missing/malformed controls; bounded owner revision checks and audit rollback; competing callers and two independent database connections unable to spend the last daily attempt twice; persisted pause across connections; unresolved capacity before network completion and after expiry; evidence close/exact callback slot release; acceptance preserving pending-delivery history; UTC rollover; no replenished action budgets; historical completed work; fixed response diagnostics; streamed oversize/stall cancellation; safe429/5xx handling; and the existing exact-review/recipient/provider contracts.

Independent review added test/dispatch-control-review.test.js for a reproduced UTC-midnight race. Before the correction, quota inspection could read the next day while the execution stored the prior day's authorization timestamp. Passing the executor's required canonical authorized_at into inspectInTransaction closes that mismatch without resetting any action budget.

Post-correction command:

~~~text
node scripts/run-tests.js test/dispatch-control-review.test.js test/dispatch-controls.test.js test/provider-response-bounds.test.js test/dispatch-recovery.test.js
~~~

Result: **55 passed, 0 failed, 0 skipped**, including the exhausted-prior-day hold followed by a legitimate independent midnight admission. The earlier 97-test run remains the pre-review integrated focused baseline; the root-owned full suite verifies the final combined tree.

Client commands from client directory:

~~~text
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
~~~

Both passed. Build retains the existing main-chunk size warning (approximately910kB before gzip); this is not a performance certification. Root records integrated API/scheduler/full-suite evidence separately.

## Files and interfaces

- src/modules/outbound-automation/dispatchControlsService.js: inspect({organization_id}), update({organization_id,expected_revision,paused,daily_attempt_limit,unresolved_limit,reason,actor}), inspectInTransaction(tx,{organization_id,action_type,authorized_at}), candidatePredicate({actionAlias,kind,at}).
- ActionsRepository.nextExecutable(limit,organizationId,at,operationsPredicate=null): optional internal {sql,params}; no public SQL input.
- ActionExecutor: required injected dispatchControlsService, transactional no-attempt hold and fixed accepted-response diagnostics.
- ProviderRequest and email/SMS/WhatsApp/voice adapters: original-deadline bounded response contract; synthetic direct-adapter fixtures updated to real Response objects.
- client/src/components/dispatch-controls.tsx and Settings page: owner controls backed by root-wired GET/PUT /api/dispatch-controls.
- test/dispatch-controls.test.js and test/provider-response-bounds.test.js: focused new regressions.

## Human and external checks remaining

Use two real browser sessions to verify owner pause/resume, changed-revision conflict, keyboard/mobile behavior and permission loss. Confirm sending remains off when deployed global enablement is absent; changing that configuration requires coordinated instance restart. Exercise a held uncertain outcome and evidence-based resolution in the selected provider's sandbox before any customer send. Verify the UTC-day explanation and provisional ceilings with the pilot operator. Real PostgreSQL contention, deployed database TLS/roles, live-provider behavior, load, monetary budgets/alerts and credential rotation are not proven by these SQLite/stream tests. Full L1 acceptance remains open.
