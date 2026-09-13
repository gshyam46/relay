# L2-03 backend verification

Recorded: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.

This artifact covers the assigned backend slice under [the recorded identity contract](../L2-03_IDENTITY_RESOLUTION.md). It is local disposable-database evidence, not PostgreSQL, provider or customer acceptance.

## Implemented

- One append-only import identity resolution per workspace/source row, with current database owner checks, an exact review token and immutable decision hash. Identical retries return the original outcome even after later changes; a changed decision conflicts.
- LINK_EXISTING attaches the exact reviewed source to an existing enquiry without changing its contacts, facts, context revision, events or actions. Both normalized contacts and the target's complete canonical raw/normalized contact sets must agree; conflicting legacy contacts cannot gain link authority.
- CREATE_SEPARATE persists a separate lead, meaningful typed initial enquiry, LeadCreated event, resolution/source association and audits in one workspace transaction. Failure at any write rolls the whole unit back.
- Original selected rows, committed/held markers, L2-02 outcome ledger, raw cells and correction history remain unchanged. Resolved rows cannot be corrected or ordinarily committed. Corrections of other rows preserve resolved source values and original duplicate issues.
- Import detail and recent history expose separate identity resolution counts. Public resolution summaries omit the potentially large stored review snapshot. Exact source facts remain in the immutable normalized_values snapshot and source viewer.
- Existing candidates use indexed matching and deterministic pages. Display limits are 50 existing leads and 20 in-file rows; totals are explicit. More than 5000 existing matches disables resolution with IDENTITY_CANDIDATE_LIMIT and a null token. Reviews hash the full supported matching set, including hidden candidates, their context revisions and complete applicable policy records.
- Policy scanning admits at most 10000 distinct pending receipt IDs plus relevant restriction rows. Scope caching counts shared restrictions once. Counts are checked before loading records that would exceed the cap; an excess returns IDENTITY_POLICY_LIMIT and a null token. Public policy IDs are limited to 100 with count/truncation metadata, while supported review tokens bind complete records.
- Source history fetches at most 101 metadata pointers, then materializes at most 100 sources one at a time within an 8 MiB serialized-source budget. has_more reports either limit; byte_limit is 8388608. Original raw source remains accessible through import history.
- Additive migration 0011 scopes row, batch, target/resulting lead, event and actor references; enforces decision/classification combinations, row/event and created-lead uniqueness; bounds immutable snapshots to 512 KiB. It does not backfill or rewrite previous import authority.

## Files and integration

Backend modules: importIdentityContract.js, importIdentityRepository.js, importIdentityService.js, importsService.js and importsRepository.js under src/modules/data-foundation; migration src/database/migrations/0011_import_identity_resolution.js.

Tests: test/import-identity-transactions.test.js and test/import-identity-migrations.test.js. The older test/reviewed-import-migrations.test.js PostgreSQL runtime-only case now applies current migrations before using current application services; its frozen 0010 upgrade/constraint assertions remain scoped to the previous migration.

Root owns HTTP wiring, migration registry, logger and integrated documentation. The review owner implements and verifies exact resolved-source provenance and ambiguous-reply protections. The UI owner supplies identity comparison, source viewing and browser verification.

## Automated evidence

Command: node scripts/run-tests.js test/import-identity-transactions.test.js test/import-identity-migrations.test.js test/reviewed-import-transactions.test.js test/reviewed-import-migrations.test.js

Result: **54 tests, 48 passed, 6 explicit PostgreSQL skips, zero failures.** The new identity suites contribute 25 tests: 22 passed and 3 PostgreSQL skips. Inherited database/provider configuration was removed by the safe launcher.

Behavior covered:

- Lead, context, event, resolution and audit write failures leave no partial enquiry/source association.
- Identical concurrent decisions, conflicting intent, stale reviews, correction races, source immutability and ordinary-commit refusal.
- File-backed lost-response/restart replay retains exactly one resulting lead/event/decision.
- Full-set freshness when a candidate outside the first 50 changes restriction state.
- A 1000-row duplicate file supports an explicit first creation followed by linking another row; 5001 existing matches are visibly unavailable.
- Inconsistent legacy raw/normalized contacts block linking and their additional restrictions invalidate a saved comparison.
- Repeated shared restrictions are counted once across candidate pages; changes outside the first 100 displayed restrictions invalidate review; 10001 relevant policy records disable resolution.
- Compact public resolution metadata retains exact durable monetary provenance. Dense raw sources across 18 imports trigger the byte budget while preserving complete returned source cells.
- Populated upgrade preserves historical held outcomes; scoped constraints reject foreign ownership and invalid combinations; interrupted DDL and failed migration-marker insertion roll back together.
- Independent review found that blanket same-batch exclusion could overlook a resolution-created lead when fallback naming creates a new name/company match. Late checking now excludes only proven ordinary COMMITTED outcomes of the frozen batch; the exact regression leaves the later row HELD without another lead/event.
- Existing reviewed-import preview, correction, chunk/restart, outcome consistency, Unicode matching and maximum duplicate-history tests remain green.

## Remaining acceptance

Root integrates HTTP, provenance/security, ambiguous-reply and browser evidence and runs full regression checks. The three new PostgreSQL cases are present but were not executed without an explicitly authorized disposable target. Real PostgreSQL independent connections, populated upgrade/restore, customer duplicate/shared-contact files and operator/mobile/accessibility acceptance remain open. No provider operation, deployment or customer database write occurred.
