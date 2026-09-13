# L4-03/L4-04/L4-05 backend verification

Recorded 2026-09-13 against [the customer workflow contract](../L4-03_CUSTOMER_WORKFLOW.md). This is local implementation evidence, not provider, PostgreSQL or customer acceptance.

## Implemented

- Append-only conversation decisions preserve independent READ/KEEP/UNREAD, owner assignment and recorded status. Canonical inbound count/identity changes reopen effective attention without rewriting prior resolution, including backdated arrivals.
- Manual HUMAN_TASK reminders support explicit due time, rescheduling, completion/cancellation and exact original-command recovery. Existing guarded follow-up transitions and normal due processing remain authoritative; automatic no-response timers cannot be rescheduled here.
- Four outcome slots per enquiry retain immutable corrections/withdrawals. RESULT has one current WON or LOST judgment; optional WON amount uses exact currency/minor-unit strings. Outcomes are owner-reported and deal value is not revenue.
- Selected outcome export uses the shared formula-safe serializer, exact JSON fields and metadata-first aggregate bounds. Foreign selections fail atomically.
- Scoped message pages preserve original subject/body and expose the existing bounded public reply interpretation. Private provider payloads are excluded. Corrupt/oversized auxiliary metadata stays visibly unavailable while valid content remains readable.

Owned source: customerWorkflowContract.js, customerWorkflowRepository.js and customerWorkflowService.js under src/modules/customer-workflow/. Root owns migration0021, registry, HTTP/UI integration and shared documentation. Migration0021 was inspected against the recorded table/foreign-key contract; no backend-owned migration edit was needed.

## Automated checks

Final command:

```text
node scripts/run-tests.js --test-concurrency=1 test/l403-customer-workflow.test.js test/follow-up-transitions.test.js
```

Result: **27 passed, 0 failed, 0 skipped** (20 new customer workflow tests plus 7 preserved follow-up transition tests). These are overlapping with earlier focused runs, not additional independent totals.

Coverage includes current owner/tenant scope; exact source/action association; new and backdated inbound; stale tokens and competing revisions; READ/KEEP/UNREAD; archive/restriction separation; scheduler-induced stale task tokens; terminal task guards; automatic timer protection; exact money above JavaScript integer precision; future/invalid monetary input; outcome slot correction/withdrawal; and atomic rollback of domain/request/audit writes.

A 650-record synthetic Unicode outcome selection exceeds the 8MiB metadata input budget and is rejected before any full revision materialization or export audit. A smaller explicit selection succeeds. Export also checks the actual escaped CSV output budget. This is boundary evidence, not a throughput benchmark.

An owned temporary SQLite database was closed and reopened. Its original reminder command and normalized due time remained recoverable; the existing due service made the reminder DUE and exact replay did not create new tasks or external actions. Cleanup verifies the resolved temporary parent and prefix. This is a database restart plus due-service check, not a claim of an additional normal-server scheduler acceptance run.

Message paging covers tied timestamps with stable ID continuation, exact content, foreign-enquiry cursor rejection and no private payload leakage. Malformed and oversized auxiliary metadata preserve visible original content with conservative review status. Content preflight is 256KiB/message, metadata 256KiB, public page 4MiB, default20/max50; continuation is explicit.

## Remaining acceptance

Root owns browser/HTTP integration evidence and overall regression results. Human QA must assess inbox attention, reopening, reminder timing and owner-reported outcome usefulness. Current assignment supports self/unassigned only. Local canonical references do not establish SMTP threading or sender authenticity. No provider probes, real sends, hosted model calls, customer database operations or revenue inference were performed. PostgreSQL concurrency/restore and live provider/customer acceptance remain separate gates.
