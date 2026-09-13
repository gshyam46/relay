# L2-02 reviewed import backend verification

Product: **AI Lead Intelligence & Outbound Automation**. Date: **2026-09-12**.
Scope: [recorded contract](../L2-02_REVIEWED_IMPORT.md); overall evidence belongs to [integrated verification](L2-02.md).
Status: backend implementation and independent Unicode duplicate correction verified locally; integrated and human/external acceptance are tracked separately.

## Implemented

Atomic bounded previews preserve original source cells, mapped fields, normalized enquiry values, issues and actor audit. New reviewed imports use contract version 2; compatibility calls use version 1 with safe transactions. Historical version 0 is never promoted from old partial flags. Mapping/options/phone region/file identity are part of deterministic preview reuse. Duplicate name/company lookup uses an application-derived SHA-256 key from the existing JavaScript trimmed/lowercased canonical string. This fixes the independently reproduced Unicode mismatch in SQLite SQL lower(); the same indexed lookup is used for preview and late duplicate checks.

Corrections preserve raw cells, append old/new values and actor/reason history, revalidate row and both sides of duplicate candidates, increment the review revision and reject stale or frozen requests. The batch allows at most 100 corrections, with each before/after snapshot bounded to 2 MiB. A 1000-row duplicate fixture retains all 2997 original candidate hints and source cells when the first row is corrected. This is explicit boundary validation/refinement; the intermediate 1 MiB implementation was not shown to fail that fixture.

First commit freezes the exact revision and sorted selection. Each request processes at most 25 unfinished rows, with a ten-second soft admission budget. A workspace transaction atomically creates the lead, meaningful initial imported enquiry, LeadCreated event, unique outcome, row projection and audit. Failure of any write rolls the complete row back. A late duplicate instead creates a durable HELD outcome without a lead/event/enquiry. No provider/model work runs in these transactions.

Interrupted COMMITTING/FAILED batches resume the same intent and skip committed outcomes. Finalization and completion audit commit together; lost responses and failed final audit cannot duplicate leads, events or completion audit. Read detail validates row/ledger agreement. Recent history derives counts from persisted row projections even if the process stops before finalizing its batch summary; it returns the newest 100 batches with explicit limit/has_more metadata.

## Files and contracts

Implementation: [service](../../src/modules/data-foundation/importsService.js), [repository](../../src/modules/data-foundation/importsRepository.js), [import contract helpers](../../src/modules/data-foundation/reviewedImportContract.js), [0010 migration](../../src/database/migrations/0010_reviewed_import.js).

Tests: [transaction/recovery behavior](../../test/reviewed-import-transactions.test.js), [migration/constraints](../../test/reviewed-import-migrations.test.js). Parser/mapping and import provenance implementation belong to the data/review owner; API/registry and integrated documentation belong to root; UI verification is separate.

Migration 0010 preserves old columns and rows, adds contract/review/frozen metadata and raw-cell/commit projections, and creates scoped unique outcomes plus bounded correction history. Composite keys enforce the owning batch, row, actor, lead and event for new history. No legacy event is republished and no old source row is inferred to have completed. The only lead backfill is the new derived name/company lookup key: a frozen migration algorithm processes 200 primary-key records per page and never changes the original name/company/contact fields. Fixed-length digests avoid indexing arbitrarily long legacy names. Root owns the matching creation-path helper.

## Automated evidence

Owned tests: node scripts/run-tests.js test/reviewed-import-transactions.test.js test/reviewed-import-migrations.test.js

Final owned result: **29 total, 26 passed, 3 PostgreSQL skips, zero failures** after the independent Unicode fix and the supported correction-history bound check. Before the derived-key refinement, a combined check with existing import flow and the new HTTP integration suite passed **39 total, 36 passed, 3 skips, zero failures**. Final combined results are recorded in the integrated report.

Covered: failure at every preview persistence stage; lead/enquiry/event/outcome/row-marker/audit row rollback; identical/different-intent concurrency; correction/audit rollback; stale revision and ownership; immutable raw cells and source lineage; duplicate recomputation; late duplicate holds; preserved contact restriction; failed final audit/retry; actual owned file database restart and explicit chunk resume; historical read/review holds; durable history counts before finalization; recent-list bounds; corrupt ledger/marker rejection; populated migration preservation, constraint enforcement, interrupted DDL and failed marker rollback; Unicode case/whitespace duplicates at preview and before commit; 203-row legacy key backfill crossing the 200-row page boundary, including a 40,006-character name; original-data and rollback preservation; a full 1000-row duplicate file correction retaining the complete before/after candidate history; database rejection of either history snapshot above 2 MiB.

The three guarded PostgreSQL tests cover populated upgrade, scoped constraints and independent-connection preview/commit contention with exact money. They were not run because no explicit dedicated disposable PostgreSQL target was supplied. SQLite and guarded test definitions are not PostgreSQL operational proof.

## Remaining acceptance

The independently reproduced Unicode duplicate bypass was fixed and has regression coverage. Required external/human checks include representative customer files, operator mapping/correction/source understanding, explicit resume after uncertain response, accessibility/mobile, PostgreSQL concurrent upgrade/restore and least-privilege operation. Identity resolution of held duplicates, broader export/archive and automatic customer outcomes remain later tasks. No live provider, customer database or external recipient was used.
