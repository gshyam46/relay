# L2-01 business context backend verification

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-12**.
Scope: [recorded contract](../L2-01_BUSINESS_CONTEXT.md), [integrated evidence](L2-01.md). This is local automated evidence, not customer or PostgreSQL acceptance.

## Implemented

- Versioned complete business profiles and one active typed enquiry context per lead, with immutable prior revision history and manual source provenance.
- Explicit UNKNOWN/KNOWN/CONFLICTED facts; customer-stated, operator-observed and inferred values remain distinct. Unknown dates/source observation times are not invented from capture time.
- Strict object keys, roles, bounded text/snapshots, real calendar dates, explicit-offset instants, distinct conflict alternatives and supported currency scales.
- Exact decimal-string input and canonical integer minor-unit strings, including values above JavaScript's safe-integer range. No floating-point money or driver NUMERIC conversion.
- Current database owner and same-workspace lead checks under the existing workspace transaction; expected revisions, normalized no-op behavior, atomic revision/audit, bounded history cursors and fail-closed corrupt stored data.
- Additive 0009 with scoped composite actor/lead foreign keys, positive bounded revisions, actual snapshot byte limits, no legacy backfill and no edits to prior migrations.
- Read-only transaction-compatible loadLeadBusinessContext wrappers/revision tokens for intelligence and prepared-review integration. Context writes do not change contact status, attempt/retry state or historical envelopes, and do not automatically run analysis.

## Files and contracts

Implementation: [contract validation](../../src/modules/business-context/businessContextContract.js), [repository/helper](../../src/modules/business-context/businessContextRepository.js), [service](../../src/modules/business-context/businessContextService.js), [migration](../../src/database/migrations/0009_business_context.js).

Behavior: [backend tests](../../test/business-context.test.js), [upgrade/constraint tests](../../test/business-context-migrations.test.js). Architecture/domain descriptions were updated alongside source. Root integration owns API wiring, migration registration, intelligence/evidence, prepared-review integration and the overall verification report.

Public service methods and API shapes are recorded in the contract. An actor is the session-derived id/role; a currently existing same-workspace OWNER row is required. The user model does not yet have an independent active/revoked flag. History defaults to 20 records, caps at 50 and uses an exclusive before_revision cursor. Exact source references remain unverified operator-entered text and cannot authorize contact.

## Automated results

Command: node scripts/run-tests.js test/business-context.test.js test/business-context-migrations.test.js

Result: **18 total, 15 passed, 3 PostgreSQL tests skipped, 0 failed** after final source-observation normalization, repository gate and exact-key checks. The safe launcher strips inherited database/provider configuration and uses disposable in-memory SQLite.

Covered behavior: absent/no-op backward compatibility; competing saves with one accepted revision; stale retry/no duplicate audit; role/actor/tenant denials; immutable prior versions and pagination; audit-failure rollback; contact-state preservation; typed provenance/conflicts/unknowns; leap/impossible dates and invalid offsets; source observations with explicit positive/negative offsets normalized to canonical UTC before persistence and history reads, while unknown times remain null; Unicode snapshot bytes; exact 0/2/3-decimal currencies and large monetary range round trips; malformed money; corrupt stored snapshots; populated 0008 upgrade preserving prior rows; interrupted migration and failed ledger write rollback; composite ownership and schema constraints.

The three guarded PostgreSQL tests exercise populated upgrade, scoped constraints/bytes and independent-connection revision contention with exact-money cross-connection reads. They were **not executed**: no explicit dedicated disposable PostgreSQL target was supplied. SQLite tests do not establish PostgreSQL locking, deployment roles or restoration behavior.

## Remaining human and external QA

- An operator configures a real business, reviews offerings/criteria and recognizes actual enquiry facts, source wording and unknown/conflicting information.
- Verify corrections and history in the shipped UI, including draft preservation after stale revision, exact money, keyboard/mobile and understandable re-analysis/review requirements. Browser automation evidence belongs to the integrated/UI report; it does not replace customer review.
- Run guarded PostgreSQL tests against a dedicated disposable target; rehearse previous-version upgrade, restricted runtime/migration roles and restore before live data.
- Validate import-row mapping, repeated-enquiry identity and duplicates in L2-02/L2-03; automatic refresh and evaluated business fit/priority remain later work.

No live provider, customer database or external recipient was used for this backend verification. L2-01 remains subject to its human/external acceptance gates.
