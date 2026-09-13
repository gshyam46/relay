# L1-05 Bounded Dispatch and Recovery Contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: contract recorded before dependent implementation, now implemented locally. [Integrated evidence](verification/L1-05.md) records checks; PostgreSQL/provider/browser/human acceptance remains separate.

## Decision and scope

Adopt the existing ADR-005 direction on the L1-03/L1-04 workspace transaction gate. Retain the modular monolith, standard SQL adapters and immutable reviewed envelope. Add bounded execution, explicit uncertainty/recovery and exact callback attempt matching. No provider call or model call runs inside a transaction.

The existing STARTED/EXECUTING authorization already precedes I/O. There is no separately reclaimable pre-send claim: once authorized, a crash is potentially a send. Expired ownership is held for reconciliation, never automatically reassigned or resent. This is intentionally conservative and does not claim exactly-once delivery or recall of an in-flight request.

Due-time checking is required to implement backoff, so this slice also closes the narrow L1-06 action scheduled_at gate. Exact callback matching/fenced effects are required for safe retry history, so it advances that part of L1-07. Full sequence scheduling, tenant fairness, event retry queues and general durable inbox repair remain separate work.

## Immutable migration 0005

Name: 0005_bounded_dispatch_recovery. Existing migrations remain unchanged.

actions adds:
- next_attempt_at, first_dispatch_at, retry_deadline_at: nullable UTC ISO text.
- max_attempts: integer, default 3, CHECK 1..100; runtime freezes on first authorization.
- execution_fence: integer default 0, nonnegative; increment for each new authorization.
- active_execution_id: nullable reference to action_executions.
- execution_hold_reason: nullable bounded application reason code.

action_executions adds:
- action_revision_id (nullable FK), envelope_hash, provider_intent_key, provider_key_expires_at.
- lease_owner, fence_token (nullable positive integer), lease_expires_at, dispatch_authorized_at.
- outcome_class: DISPATCHING, ACCEPTED, RETRYABLE_FAILURE, PERMANENT_FAILURE, UNCERTAIN, LEGACY_UNKNOWN, DELIVERED, DELIVERY_FAILED, CLOSED_UNRESOLVED.
- outcome_at: nullable UTC ISO text. Existing status stays STARTED/COMPLETED/FAILED for compatibility.

dispatch_resolutions is append-only: id, organization_id, action_id, action_execution_id (unique), fence_token (nullable for legacy), decision (ACCEPTED or CLOSE_WITHOUT_RETRY), evidence_note, provider_reference (nullable), reviewer_user_id, created_at. It records operator evidence, not a fabricated provider webhook or delivery.

Unique (action_id,attempt) and (action_id,fence_token) for non-null fences; indexes for due candidates, expiring DISPATCHING attempts and provider references. Preflight invalid/duplicate historical attempt numbers refuses the migration with a generic remediation code. Never renumber/delete old records to satisfy a constraint.

Existing attempt bindings are unknown: no invented revision, lease, key, acceptance or permission. Preserve all old fields/statuses/history; mark outcomes LEGACY_UNKNOWN. Current EXECUTING/RETRYING or otherwise executable actions with prior ambiguous attempts gain LEGACY_OUTCOME_REVIEW_REQUIRED. Unattempted eligible work can initialize policy on its first authorization. Runtime must honor holds independently of coarse status, including after a review.

## Authorization and bounded retry

ActionExecutor uses injected now() (epoch milliseconds) and random() for deterministic tests; production defaults Date.now and Math.random. All persisted instants are validated canonical UTC ISO values.

Under workspace then action lock:
1. Reload authoritative action/lead/settings, enforce supported type, current contact restrictions and exact reviewed revision.
2. Enforce draining/hold/non-executable state, scheduled_at and next_attempt_at. Invalid times fail closed. Future work is deferred without an attempt or provider call.
3. Freeze first_dispatch_at and retry_deadline_at on first authorization; default elapsed budget is one hour. Freeze the smaller of the configured action limit and the validated runtime limit (default three total attempts per action) across edits/reviews/restarts. Edits cannot replenish the budget.
4. Refuse exhausted count/deadline/provider-key window. Terminal reason is durable and visible.
5. Increment execution_fence, create attempt DISPATCHING/STARTED with owner/fence/revision/hash/key/60-second lease, set active_execution_id and EXECUTING, audit. Commit before I/O.
6. Adapter consumes captured envelope/configuration and server-created execution_id/provider_intent_key. Provider credentials remain memory-only.

Known nonacceptance (429 or explicit synthetic rejection) may retry. Persist half-to-full jitter around exponential base 30 seconds, capped at 5 minutes; use the longer of this wait and a valid Retry-After hint. Parse bounded seconds or HTTP date; a hint beyond the deadline exhausts the action instead of shortening the provider's wait. Do not retry unsupported/unconfigured/permanent failures. Unknown transport, server 5xx and timeout stay UNCERTAIN.

The stable provider intent key remains action+revision across known-safe retries. Resend requests must retain identical body for that key; do not add changing attempt metadata to its body. Persist its first-use key expiry with a conservative 23-hour bound, never extend on retry. Other adapters do not imply provider idempotency merely because the application stores a key.

Provider completion writes compare active_execution_id, owner/fence and DISPATCHING lease. Expired or superseded results cannot overwrite a newer state or release uncertainty. Record a safe stale-result audit and leave reconciliation to the exact callback/operator path. Known acceptance is ACCEPTED, not delivered; it cannot be selected for another attempt.

## Recovery and operator contract

DispatchRecoveryService({db, contactPolicyService, now}) provides:
- inspectAction({organization_id,action_id}): read-only current action/retry/execution/recovery detail.
- listForOrganization({organization_id,limit=50}): bounded read-only active queue for unresolved uncertainty/legacy holds, pending safe retries and DISPATCHING work. Closed or operator-resolved acceptance history is excluded so completed decisions cannot hide new work; full history remains in inspectAction. Terminal failure/budget holds remain visible in the normal outbound failed/detail views.
- expireLeases({organization_id=null,limit=25}): workspace-scoped sweeps of expired DISPATCHING to UNCERTAIN, no provider call. Null scope is internal worker only.
- resolve({organization_id,action_id,expected_execution_id,expected_fence,decision,evidence_note,provider_reference,reviewer_user_id}): owner command, exact current attempt/fence, one atomic decision/audit.

ACCEPTED requires a bounded provider reference and evidence note; it records operator-confirmed acceptance, never delivery. CLOSE_WITHOUT_RETRY leaves the action blocked and preserves uncertainty/history. Neither permits resend, resets budgets or creates a new approved revision. Stale/conflicting resolutions fail; identical duplicate intent returns its recorded result. Storage failures roll back the whole resolution. In-flight nonexpired DISPATCHING cannot be resolved as stopped.

Unknown historical actions without a correlatable attempt remain held for inspected remediation; do not synthesize an execution. Releasing a NOT_SENT claim for automatic resend is intentionally unsupported: an expired process can still have an external request in flight.

HTTP: GET /api/actions/:id/recovery, GET /api/outbound/recovery, POST /api/actions/:id/recovery/resolve. Tenant and reviewer come from the authenticated owner session. The React interface displays attempt outcome, retry due/deadline/remaining budget and recovery decisions with a required evidence note. No normal-user developer controls.

## Exact callback boundary

Live SendGrid terminal events require matching relay_execution_id and relay_revision_id, plus tenant/action ownership. No provider-reference-only fallback is implemented. Never compare SendGrid HTTP X-Message-ID directly with webhook sg_message_id; they are distinct identifiers. Resend/Twilio/WhatsApp ingress is not added by this slice.

Callbacks bind to a single execution, not latestForAction. Attempt state and active action mutation use the workspace gate and current fence. A historical callback may record its own attempt evidence but cannot update the active/newer action, message or follow-up. CLOSED_UNRESOLVED remains blocked even if later evidence arrives; preserve evidence for review. Conflicting failure cannot overwrite confirmed delivery. Exact message effects use execution identity.

Unsigned local fixture routes remain test-only. Legacy synthetic action-only fixtures may resolve only one unambiguous existing attempt; live routing cannot use that compatibility path. Valid authenticated restriction effects remain independent of terminal correlation failures. Raise the bounded SendGrid event-ID limit to match current provider guidance (IDs can exceed 100 characters), hashing long source keys for fixed application contracts.

This narrows callback correlation/state writes without claiming the complete L1-07 durable inbox is implemented. Ancillary message/follow-up failures are audited; automatic replay/repair and unmatched-event recovery remain work for the next slice.

## Shutdown and tests

Stop accepting dispatch before drain; clear periodic ticks and await the active worker and executor operations before closing the database. A bounded shutdown timeout exits with durable ownership left intact for expiry/reconciliation. It must not reset in-flight work to RETRYING. A new server's worker runs bounded expiry sweeps, never blind resend.

Ownership:
- Root: integrating contract, API/recovery UI, worker/server shutdown, Retry-After transport, primary docs and broad fixtures.
- Execution agent: ActionExecutor, new dispatch policy/recovery service, focused retry/lease/fence/operator tests.
- Migration agent: immutable 0005/registry, repository additions and migration/restart fixtures.
- Callback agent: callback repositories/service and exact message effects, SendGrid normalization, router/email metadata, focused tests.

Automated acceptance: future API/worker due gate; persisted exponential/hinted backoff; count/deadline/key expiry across restart/review; concurrent authorization; crash/expired owner/late result; accepted versus delivered; legacy holds; exact/stale/foreign callbacks; callback-before-HTTP return; atomic owner resolution and stale/replayed/foreign command; shutdown drain/timeout; all prior workflows; TypeScript/build and docs.

Real PostgreSQL multi-process concurrency, restricted deployment/restore, live provider key/retry/callback behavior and human/browser recovery walkthrough remain explicit external gates. No customer DB, cloud provisioning or real send is part of this local work.

References checked: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After), [PostgreSQL row locking](https://www.postgresql.org/docs/current/sql-select.html), [SendGrid event reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event), [SendGrid message IDs](https://www.twilio.com/docs/sendgrid/glossary/message-id).
