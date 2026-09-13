# L2-04 backend verification

Recorded: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.

This artifact covers the assigned backend slice under [the recorded data-management contract](../L2-04_DATA_MANAGEMENT.md) and ADR-016. Evidence uses disposable SQLite, including a file-backed restart. It is not PostgreSQL concurrency, provider, spreadsheet-application or customer acceptance.

## Implemented

- Owner correction of name, email, phone and company uses exact normalized values, optimistic data revisions, a fresh review token and a reason. Database owner and tenant checks run inside the workspace transaction. A no-op requires the current revision and creates no history.
- One immutable lead_data_changes receipt records before/after identity and archive snapshots, per-field correction origins, actor, reason, review/request hashes and safety effects. Identical retries return the original applied snapshot and history cutoff after later changes; conflicting intent at a consumed revision is refused.
- Correction preserves source/import associations, original imported cells, typed enquiry facts and unchanged field origins. It carries effective old restrictions at their original channel scope, blocks eligible queued actions, stops workflows and cancels automatic no-response tasks. Existing human tasks survive. Pending mandatory contact-policy processing refuses correction before identity can change.
- Preview explicitly names unique restriction reason/channel pairs, including legacy OPTED_OUT -> OPT_OUT/ALL and SUPPRESSED -> SUPPRESSED/ALL warnings. Both current and proposed policy show carried restrictions. Incomplete policy scans are explicit, with null restriction count and a disabled review token.
- Archive and restore change data_revision/archived_at independently of contact status or source. Archive stops work; restore restarts nothing. Historical values are preserved without re-normalizing or truncating them. New import identity comparisons bind data revision/archive and show archived matches while refusing linking.
- The directory defaults to active enquiries and provides tenant/filter-bound opaque keyset cursors, explicit totals and page limits. Existing lead pickers default to active records. Oversized display fields are bounded to 4096 characters with explicit truncated_fields; persisted values remain unchanged.
- Explicit selected export includes exact contact/provenance JSON, typed known/unknown/conflicted enquiry facts, exact string-based monetary conversion, revisions, archive and policy flags. Shared CSV serialization quotes all cells and visibly labels formula/numeric coercion risks. The service never calls a provider.
- Additive migration 0012 creates revision/archive authority and the scoped immutable change ledger without inventing history or changing historical status/source. Before/after snapshots are limited to 512 KiB each; effects to 1 MiB; revision, kind/token combinations, hashes, uniqueness and actor/lead foreign keys are constrained.

## Bounded work and export behavior

Duplicate comparison displays at most 50 matches and binds every supported match in deterministic pages. More than 5000 matches disables correction. Relevant restriction rows plus pending mandatory receipt IDs are limited to 10000 before materialization. Correction and archive count all open actions, workflows and follow-up tasks for the same 10000-record safety limit; preview effect counts still describe only work actually changed. This prevents preserved human work from creating a save-only refusal.

History reads at most the requested limit plus one metadata pointers (default 20, maximum 50), then materializes changes sequentially within an 8 MiB public-history budget. has_more and next_before_revision identify omitted records. Public effects expose at most 100 carried restriction IDs with exact count/truncation metadata; immutable effects retain all supported IDs.

Export validates every explicitly selected ID before materialization (1..1000 distinct same-workspace IDs). Under the same workspace gate, SQL reads UTF-8 byte lengths for the selected identity/source values and each latest data/enquiry snapshot. The combined selected raw identity/source plus enquiry JSON bytes must not exceed 8388608; each current correction snapshot must be at most 524288 bytes and each enquiry snapshot at most 32768 bytes. These snapshot limits match their existing database constraints. This metadata pass precedes loading full exported values. The context helper selects only the identity, normalized contact, revision and archive fields it uses; unrelated source_metadata_json is never loaded by export.

The complete escaped CSV is independently limited to 8388608 UTF-8 bytes, since quotes, JSON and repeated display values can expand the input. Either bound returns LEAD_EXPORT_LIMIT / HTTP 413 before response or export audit, with no partial records. This is a conservative selected-record operational bound, not a measured memory/throughput guarantee or a portable backup format.

## Files and integration

Owned new modules under src/modules/data-foundation: leadDataContract.js, leadDataContext.js, leadDataRepository.js, leadDataService.js and leadExportService.js. Changes also affect leadsRepository.js and importIdentityContract.js/importIdentityRepository.js/importIdentityService.js. Migration: src/database/migrations/0012_lead_data_management.js.

Owned suites: test/lead-data-transactions.test.js, test/lead-data-export-directory.test.js and test/lead-data-migrations.test.js. The PostgreSQL runtime-only concurrency case in test/import-identity-migrations.test.js now applies current migrations before calling current services; its frozen 0011 migration assertions remain unchanged.

Root owns shared HTTP/manual-create atomicity, the migration registry, CSV helpers and integrated documentation. The safety reviewer owns applyLeadDataSafetyInTransaction and downstream intelligence, action, workflow, inbound and callback guards. UI owns directory, management, history, archive/export screens and browser verification. Their evidence is recorded separately by the integrating owner.

## Automated evidence

Command:

    node scripts/run-tests.js test/lead-data-transactions.test.js test/lead-data-export-directory.test.js test/lead-data-migrations.test.js

Result: **32 tests, 29 passed, 3 explicit PostgreSQL skips, zero failures.** Inherited database/provider configuration was removed by the safe launcher. Suites contribute 18 transaction checks, 8 export/directory checks and 6 migration checks (3 passed, 3 skipped).

Meaningful behavior covered:

- Injected restriction, action, lead, change-ledger and audit write failures roll back the entire correction, including source/safety state; the same command succeeds after the failure is removed.
- Concurrent exact retry and competing intent consume exactly one expected revision. Lost response followed by file-backed restart replays one receipt. Later archive history cannot change the original replay result.
- Imported raw rows and enquiry snapshots remain identical after correction/archive. Different corrected fields retain their own original correction receipts; unchanged fields retain source origins.
- Pending old-address policy prevents correction until the resulting restriction is available to carry; earlier review tokens then become stale.
- Archive/restore of 40000-character historical names and inconsistent uppercase raw email preserves raw identity, normalized lookup, status and source. Archived duplicate candidates remain visible but cannot be linked.
- Changes outside the first 50 displayed duplicate candidates invalidate review; 5001 matches return a disabled comparison.
- 10000 restriction carries fit the immutable effects bound while public IDs remain limited to 100. 10001 policy records and 10001 queued actions refuse incomplete work. Reason/channel summaries deduplicate identical bounces and include legacy all-channel warnings.
- 10001 preserved human follow-ups disable preview consistently with save-time safety. At 10000, correction succeeds and all human tasks remain planned; effect counts correctly show zero cancellations.
- Exact budgets above JavaScript safe-integer precision, conflict alternatives, unknown fields, selected archive state and canonical contact JSON survive export. Fullwidth formula prefixes, quotes, separators and multiline cells use safe display while retaining exact JSON.
- A full 1000-record selection exports completely; empty, repeated, foreign and excessive selections reject. A 5 MiB legacy name exercises final serialized-output overflow without a partial audit.
- SQL read spies prove that 9 MiB unrelated source metadata is never selected. A 3-million-character UTF-8 value exceeding 8 MiB and a two-record 10 MiB aggregate are refused by byte-count preflight before any lead-value or enquiry materialization, with no export audit.
- Keyset pages remain stable across a newer insert and reject another tenant/filter's cursor. Default active and explicit archive scopes match. Large directory fields are marked, not silently rewritten.
- Twelve actual transitions over 190000-character historical identity exercise the 8 MiB history response limit; the returned cursor retrieves the omitted changes.
- Populated migration preserves old identity/status/source and initializes revision 0/unarchived without history. Scoped foreign keys, byte bounds, revision identity, hashes and kind/token constraints reject invalid records. DDL plus failed migration-marker writes roll back together.

## Remaining acceptance

The integrating owner runs final HTTP, security/runtime, browser and full regression checks after all owners freeze source. The three PostgreSQL tests are present but require an explicit disposable target; SQLite does not establish independent PostgreSQL connection behavior. Populated production-like upgrade/restore, customer contact-correction/archive workflows, operator/mobile/accessibility acceptance and Excel/LibreOffice open-save-reopen checks remain external acceptance. No provider operation, deployment or customer database write occurred.
