# L1-07 receipt migration verification

Product: **AI Lead Intelligence & Outbound Automation**. Date: 2026-09-11.

Status: additive migration implemented and verified locally. The [L1-07 contract](../L1-07_WEBHOOK_REPLAY.md) owns dependent runtime behavior. These results do not close L1-07 or establish real PostgreSQL/provider acceptance.

## Schema and legacy policy

[0006_durable_webhook_receipts](../../src/database/migrations/0006_durable_webhook_receipts.js) is appended to the explicit [registry](../../src/database/migrations/index.js). Migrations 0001-0005 are unchanged by this slice.

- webhook_receipts stores the authenticated server-supplied ingress family/provenance, original event identity and normalized input, identity/input hashes, processing state, mandatory-policy cursor, retry budget/deadline, lease/fence, quarantine reasons and terminal/purge timestamps.
- Identity uniqueness uses a fixed 64-character lowercase SHA-256 digest rather than a long UTF-8 provider event ID. The original tuple stays available for application collision/conflict validation. The database checks digest format/uniqueness; the inbox service must compute the canonical tuple/input and reject changed replay.
- Receipt states are RECEIVED, PROCESSING, RETRY_PENDING, PROCESSED, QUARANTINED and DISMISSED. Mandatory policy remains PENDING until the processor proves DONE. Attempts/fence are nonnegative integers, normalization version is positive, and max_attempts defaults to 5 with a 1..100 bound.
- Normalized input cannot become NULL unless a purge timestamp exists and state is PROCESSED/DISMISSED. The inbox service additionally enforces the 256KiB input bound, 30-day retention age, bounded cleanup and safe read previews. No unresolved body may be automatically discarded.
- callbacks gains a nullable unique receipt FK, nullable core_applied/action_applied flags, effects_status and effects_completed_at. inbound_events gains its nullable unique receipt FK and effects cursor/completion timestamp.
- webhook_receipt_reviews records RETRY/CLOSE evidence and actor with unique(receipt_id,expected_fence), nonnegative expected fence, evidence 1..2000 and actor 1..256. Application transactions enforce tenant ownership, exact active fence, remaining budget, mandatory-policy completion and append-only decisions; individual foreign keys do not establish every cross-table tenant invariant.

All existing callback/inbound rows receive LEGACY_UNKNOWN effects status, null receipt links/completion timestamps and null callback applied flags. Old keys, body bytes, event types, statuses, execution references, lead restrictions and audit records remain unchanged. The migration creates **zero historical inbox receipts or owner decisions**, performs no JSON parsing of old payloads, and makes no inference from audit history. Malformed old data therefore cannot become newly executable webhook work merely by upgrading.

An unlinked historical projection needs the visible LEGACY_REVIEW_REQUIRED runtime path and inspected remediation. A successful old core callback is not evidence that its ancillary message/follow-up effects completed. No old record is marked DONE, requeued or granted new processing authority by this migration.

Indexes support tenant/update/id inspection, state/due selection, state/lease recovery, terminal retention and scoped review history. The previous global callback provider_event_id unique key is preserved; new runtime projections use receipt-derived internal keys as specified in the contract.

## Automated evidence

Command:

~~~text
node scripts/run-tests.js test/webhook-migrations.test.js test/migration-safety.test.js test/execution-migrations.test.js
~~~

Result: **38 tests; 28 passed, 10 explicit PostgreSQL skips, zero failures**. The new webhook migration suite contributes 6 local passes and 3 PostgreSQL skips. All executed databases were isolated in-memory or owned temporary SQLite files under the sanitized test launcher. No application database or provider was accessed.

[test/webhook-migrations.test.js](../../test/webhook-migrations.test.js) proves:

1. A populated 0005 schema containing completed, partial and malformed historical callbacks/inbound bodies preserves every original field, including existing delivery and opt-out facts, without inventing receipts or replay markers.
2. Counter, state, provenance, digest, projection-link and exact-fence review constraints reject invalid values or conflicting links/decisions. Unknown history remains nullable and explicitly classified.
3. A 2048-character Unicode provider ID remains intact while identity uniqueness uses only its digest. Independent tenant/provider/connection/ingress namespaces remain representable. Runtime normalization/hash conflict handling is tested by the inbox service owner separately.
4. Every unresolved receipt state rejects payload purge; terminal tombstones can retain identity/hash while removing normalized input. The retention age/selection algorithm belongs to runtime tests.
5. Failure after expansion and marker-insertion failure each roll back the actual 0006 DDL/default changes. A later successful migration can resume from unchanged history.
6. Competing file-backed migrators apply 0006 once. Reopen/re-running does not manufacture historical receipts or enqueue unknown records.

Prior migration and execution migration suites remain passing, including earlier populated upgrades, invalid attempt-number refusal, process-exit rollback, lock contention/timeout, unknown/gapped migration history and durable execution hold preservation.

## Remaining acceptance

Three new PostgreSQL fixtures are explicitly gated by the existing disposable harness: populated upgrade, constraints and long UTF-8 identity. They were not executed. The last local tooling check found no available disposable PostgreSQL connection/opt-in or local engine, and no customer database was used as a substitute.

Future dedicated command:

~~~text
node scripts/run-postgres-tests.js test/webhook-migrations.test.js test/migration-safety.test.js test/execution-migrations.test.js
~~~

It requires an independently verified disposable target and explicit harness opt-in. Root integration additionally owns receipt-before-effects, handler fencing, core/ancillary replay, inbound classification/creation rollback, mandatory-policy closure refusal, owner decisions, quarantine visibility, retention age, shutdown and React behavior. Real PostgreSQL multi-process/least-privilege/restore, real SendGrid redelivery and human browser recovery remain separate required gates.
