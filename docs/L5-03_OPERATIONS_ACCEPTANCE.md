# L5-03 local operational acceptance

Recorded 2026-09-13 before source implementation. Root approved this bounded metrics/workload slice under the completion plan. This is a synthetic engineering workload, not measured production capacity or a customer SLA.

## Ownership and status

Backend owns src/modules/operations/operationalMetrics.js, scripts/helpers/operationalWorkload.js, scripts/verify-operations.js, focused tests and evidence. Root owns owner-only HTTP/status UI, package/config integration and migration registry. No additional metrics schema, external alert delivery system, queue engine or provider is introduced.

OperationalMetricsService(db,{dispatchControlsService,now}) get({organization_id,actor}) rechecks the current database owner under the workspace transaction. It returns version1, as_of, scope WORKSPACE, bounded counts, oldest_age_seconds, the existing public sending/AI budget summaries, fixed alerts and alert_delivery IN_APP_ONLY. It exposes no lead identities, raw messages, provider payloads or credentials. Use existing transaction-scoped budget inspection; do not reproduce admission policy or call a provider.

Counts: leads, events_pending, events_retrying, events_held, analysis_unfinished, webhooks_pending, webhooks_review, mandatory_policy_pending, uncertain_sends, overdue_follow_ups, workflow_waiting, workflow_blocked. Lags in seconds: analysis, mandatory_policy and follow_up; missing source time is explicit unknown. Timestamp age uses the reporting wall clock and does not grant dispatch/currentness authority. Aggregate projection is bounded; large-tenant aggregate query cost still needs PostgreSQL measurement.

## Local alerts and runbooks

Pure evaluateOperationalAlerts returns only fixed code/severity/title/runbook entries. Conditions: pending mandatory policy older than60seconds, any unresolved sends, receipt review, held/retrying events, unfinished analysis older than60seconds, due follow-ups older than24hours, blocked workflows, and daily provider/AI usage at90percent of the configured ceiling. Invalid required age is explicit operational-state review. Alerts neither suppress valid mandatory processing nor authorize retry; no Slack/email/pager delivery is claimed.

Runbook references are local anchors. For uncertain sends: pause new dispatch, inspect exact attempt/receipt history and reconcile provider evidence; never blind retry. For policy/receipt backlog: retain the hold and use existing event recovery. For analysis: inspect job state/currentness/version and remaining budget before exact retry. For quotas: inspect UTC reset, actual admissions and unknown usage; increasing a ceiling requires an explicit owner decision. For overdue human work: inspect owner tasks; timers do not send or complete them.

## Reproducible100-enquiry workload

The CLI owns a new temporary SQLite database and sanitized child environment. It accepts no database/target/provider override. It uses only local deterministic or explicitly injected fixture adapters, never live provider/model credentials or inherited application environment. Cleanup validates the exact owned temporary parent/prefix before removal.

Versioned scenario: exactly100 enquiry rows across two workspaces90/10; reviewed CSV mapping and25-row transactional commit chunks; durable PLAN analysis jobs; the normal worker scheduler and its bounded phases, without direct stage pumps;100 current intelligence reads;10 human-task workflow enrollments and explicit due reminders. The small workspace must receive early scheduler service while the noisy workspace still has pending work. Read-only status does not enqueue more analysis.

Record real elapsed monotonic import/chunk, scheduler tick and current-read p50/p95/max timings; total duration/ticks; backlog progression/completions; artifact/job counts; provider/AI usage; workflow and due-task results. Main100-row profile uses deterministic intelligence, so zero AI attempts is reported explicitly and does not prove model throughput or cost. Separate tiny existing-gateway fixture may prove admission pause/budget behavior with synthetic observation only.

Version1 local thresholds: workload duration<=120000ms, current-read p95<=1000ms, scheduler-tick p95<=5000ms, at most400ticks, all100 analyses completed/current, no remaining eligible analysis events, and zero external network/provider SEND attempts. These are provisional engineering regression thresholds on the executing machine, not hosting recommendations. Every report records scope/thresholds and failed checks; failure yields nonzero CLI status, never silent threshold widening. Human-task action executions are legitimate internal work and are counted separately.

Alert injection uses persisted synthetic stalled/error rows or explicit pure metrics fixtures with known expected alert/runbook codes, without changing real runtime truth. Kill-switch verification uses actual owner controls and ordinary exact-approved sandbox action admission, proving held work creates no SEND attempt. Global deployment hold stays enforced. Workspace-only holds may be checked through a separate explicit local controls boundary; no external adapter is invoked.

## Runbooks

### uncertain-send

Pause new dispatch through sending controls. Inspect execution ID/fence, last known provider acceptance, callback and receipt history. Reconcile only exact evidence. An expired lease or restored backup is not evidence of failure. Leave uncertainty visible until resolved.

### policy-backlog

Keep sending held. Inspect mandatory policy receipt state, signature/correlation and failure reason. Use bounded original-receipt recovery; do not clear restrictions, re-date old facts or fabricate completion to reduce the count.

### event-recovery

Inspect held/retrying event or analysis job and its actual version/context failure. Resolve source/configuration problems first. Retry the original eligible command within its existing attempt/deadline budget. Do not clone failed external work.

### analysis-backlog

Check job progress, oldest queued age, scheduler health and AI budget. Distinguish deterministic work from admitted model I/O and preserve unknown usage. Pausing sending must not prevent intelligence/policy processing.

### quota-review

Inspect configured UTC-day limits, remaining logical slots and unknown provider outcomes. Reconcile known usage; estimates are not invoices. The current owner may change limits with reason/revision. A local workload score cannot establish a funded production budget.

### human-work

Review due/blocked follow-ups and waiting workflows. Contact policy still governs any subsequent send. Explicitly complete/cancel internal work only when the human action occurred; it does not establish a customer outcome.

## External acceptance

Actual PostgreSQL load/connection contention/fairness, hosting latency, queue budgets, real model/provider usage reconciliation, alert delivery/on-call response and customer workload targets remain external acceptance. The selected deployment must run its own measured scenario and incident drill. A restored old backup also requires independent current erasure/suppression reconciliation before activation; offline checksum success cannot establish later lifecycle truth.
