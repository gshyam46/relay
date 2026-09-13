# L2-02 reviewed CSV import contract

Product: **AI Lead Intelligence & Outbound Automation**. Recorded 2026-09-12 before implementation.
Status: accepted implementation boundary under the user's continuation, implemented and verified locally; operator and external acceptance remain open.

## Scope and ownership

Current milestone L2; current task L2-02, depending on implemented L1-03 transactions and L2-01 context. This implements reviewable mapping, typed source linkage, row corrections and resumable import. A minimal React import journey is necessary to exercise this task; broader identity resolution, archive/export and data work remain L2-03/L2-04. L1 external gates remain open.

Root owns API wiring, migration registry, application routes and global docs. Backend owns importsService/importsRepository, import persistence contract, migration 0010 and transaction/migration tests. Data/review owner owns parser/mapping/normalization, import provenance validation in business-context modules, grounding source labeling and focused tests. UI owner owns import components/hooks/types/page, Leads entry, enquiry provenance editing and isolated browser verification. No new provider, datastore or package dependency is required.

## Bounded file and mapping input

Accept UTF-8 CSV text at most 2 MiB, 1000 data rows, 64 columns, 4096 characters per cell, 200-character filename. Preserve physical row numbers, original headers and ordered cells, including duplicate/blank/reserved header names. Header names are untrusted labels; mapping uses zero-based column indexes. Unterminated/malformed quoting is a file error, not permission to commit partially interpreted rows. Extra/short rows are visible row errors in reviewed mode. Legacy parser output retains original-header keys where unambiguous for compatibility.

POST /api/imports/csv/inspect accepts {filename,csv_text} and returns {headers:[{index,label,samples}],suggested_mapping, row_count, limits}. It does not create leads or batches. Suggestions must be visibly reviewed.

POST /api/imports/csv/preview accepts {filename,csv_text,default_phone_region,mapping,options}. Authenticated session supplies organization and owner actor. Mapping is a sparse object from these target keys to distinct integer column indexes:
name,email,phone,company,source,interest,location,country_code,budget_amount,budget_minimum,budget_maximum,currency,timeline,target_date,enquiry_date,last_interaction,observed_at.
An unmapped target is absent, never inferred from an unrelated column. At least one identity/contact target is mapped. budget_amount is mutually exclusive with minimum/maximum; minimum/maximum must be paired.

Options is exactly {date_format:"ISO"|"DMY"|"MDY",default_currency:<supported currency|null>,assertion:"OPERATOR_OBSERVED"|"CUSTOMER_STATED"|"INFERRED"}. No default country/currency/date interpretation is silently guessed by the UI. Phone regions remain IN, US, INTERNATIONAL_ONLY. Supported formatting characters may be removed; letters/extensions/multiple numbers reject. This validates formatting, not phone ownership or deliverability.
Dates use four-digit years and real Gregorian calendars: ISO YYYY-MM-DD; DMY DD/MM/YYYY; MDY MM/DD/YYYY. Instant fields require explicit ISO offsets and normalize to UTC. Date/source time is never copied from upload/capture time.
Money uses dot-decimal strings and the existing L2-01 currency scales; no grouping/symbol/exponent or floating-point conversion. A nonblank row currency takes precedence over the explicitly selected default; the preview shows the resulting currency. Missing endpoints/currency and excessive precision are row errors. Blank facts stay UNKNOWN; zero is KNOWN.
Initial assertion is the reviewed option, visibly defaulting to OPERATOR_OBSERVED (recorded in this file), not a claim of independent verification or consent.

## Preview, correction and progress API

Existing import envelope remains {import_id,state,summary,import,rows,issues,duplicate_candidates}. Add top-level review_revision, contract_version, frozen_selection and progress. Each row exposes raw_cells, mapped_values, normalized_values (including enquiry), can_commit, commit_state and hold_reason alongside existing fields. Summary preserves existing counters; progress is {selected_rows,committed_rows,held_rows,remaining_rows}. Import metadata retains headers, mapping and options.

PUT /api/imports/:id/rows/:rowId accepts {expected_revision,values,reason}, where values is the complete flat mapped-values object using the mapped target keys with string|null values. Raw cells never change. Only an unfrozen READY_TO_COMMIT batch can be corrected. Correction revalidates row/duplicate candidates, increments review_revision, appends reason/actor/before/after history and clears frontend selection. Stale revision returns 409. History is returned with batch detail, bounded by the file/revision limits; at most 100 corrections per batch. Each before/after correction snapshot is bounded to 2 MiB, covering the documented mapped-cell limits and duplicate hints for a full 1000-row file. A verified 1000-row file sharing email, phone and name/company exceeds the earlier 256 KiB history bound; preserving its correction history requires this explicit bound. Mapping changes require a new preview, not rewriting frozen history.

POST /api/imports/:id/commit accepts {expected_revision,selected_row_ids}; at most 1000 distinct IDs, at least one. First call requires current revision and all selected rows valid/eligible, then atomically freezes sorted selection plus review revision. Later calls require exactly that revision and selection. Each call processes at most 25 unfinished selected rows. Response is the current import envelope, status 200, with COMMITTING while remaining_rows > 0. No background job or lease is required: database-only row transactions serialize through the workspace gate. Lost responses are recovered by reading this batch and explicitly resuming its frozen selection.

GET /api/imports and GET /api/imports/:id remain authenticated and tenant scoped. The list returns the most recent 100 imports with explicit limit/has_more metadata; older saved detail links remain valid. List progress is derived from persisted rows so a process death before batch-summary refresh cannot hide committed work. Full list pagination remains L2-04. History reload recovers preview, corrections, selection and progress. UI does not automatically commit after upload or automatically retry after an uncertain response.

## Duplicate and permission boundary

Reviewed imports hold duplicate/shared-contact candidates for L2-03; the operator may select other valid rows. There is no merge, update-existing or create-separate override in this slice. Recheck canonical email/phone and name/company matches inside each row transaction. Exclude leads already created by this same frozen import from the external recheck because file duplicates were reviewed as a set. A new external match after preview yields a durable HELD outcome with visible duplicate-review reason; no lead/event/enquiry is created for that row. The finished batch reports committed and held counts separately; held source rows remain inspectable for later resolution. COMMITTED means processing of the frozen selection finished, not that every row became a lead.

Contact restrictions are unchanged; import never grants permission, clears suppression or rewrites an existing lead. Legacy compatibility imports retain visible duplicate warnings and separate-row semantics but share transactional safety. The new UI always uses the reviewed contract.

## Durable persistence and retry

Additive migration 0010 preserves old tables/history and adds reviewed metadata/revision/frozen selection, raw-cell/commit state storage, correction history and a scoped unique import-row outcome ledger. New preview batch/rows/issues/review/audit commit atomically after bounded parsing. Idempotency includes workspace, file content/name, mapping/options and phone region. Identical reviewed requests reuse the existing batch, including its corrected/current state, rather than creating leads again.

Each selected row transaction reloads current state and atomically commits lead, initial typed enquiry revision when meaningful, LeadCreated event, row marker, unique row-outcome ledger and audit. HELD outcomes commit only their explanation/ledger/row state. Failure at any write rolls back the complete row. Progress comes from persisted outcomes, not a client counter. Final state/summary/audit commit atomically and replay does not repeat the completion audit. Diagnostic failures use bounded fixed codes/messages rather than raw exception text.

Historical contract_version 0 unfinished batches cannot be safely inferred from old flags: return an explicit review-required conflict and retain all history. Historical completed batches remain readable. New calls without mapping retain an explicitly documented compatibility contract (version 1) and old response/selected-row inputs, while using bounded validation, atomic preview/row processing and durable selection. New reviewed calls use version 2 and require expected_revision; legacy consumers are not silently upgraded to new typed semantics. There is no unsafe historical backfill or automatic re-publication of old events.

## Typed import provenance

Extend L2-01 source with IMPORT_ROW:
{assertion,source_type:"IMPORT_ROW",source_reference,observed_at,import_id,import_row_id,field}.
field is one of the six enquiry fields. The server constructs this link from the exact owned reviewed row; batch headers/mapping and row correction history explain originating columns and edits. Source truth remains unverified. Initial enquiry append uses a transaction-bound repository under the import workspace gate, not a nested BusinessContextService transaction.

An unchanged imported fact may survive a later full-snapshot manual edit. BusinessContextService must validate every supplied IMPORT_ROW fact against that owned committed row, its resulting lead, exact field/value and provenance. A changed fact must use MANUAL provenance; the UI explicitly converts edited imported facts to manual correction and retains earlier source lineage in history. Forged/cross-tenant/stale-value import citations reject. Grounded evidence labels the actual import source instead of hard-coding MANUAL.

## Acceptance and evidence

Automated: malformed/duplicate headers, quoted/multilingual cells, parser caps, mapping/options validation, dates/offsets, precise currencies/unknowns, phone ambiguity; owner/tenant/forged provenance; preview/correction rollback and stale revision; selected validity and frozen-intent conflict; failure at each row write; concurrent requests, file-backed restart/COMMITTING resume, lost response/final audit; new duplicates and retained suppression; forward migration preservation/rollback and guarded PostgreSQL tests.
Browser: actual React upload/map/preview without lead creation, selection, correction, held duplicate, chunk progress, refresh/resume/history and imported enquiry source/manual correction. TypeScript/build, isolated smoke/workflow checks and repository regression suite.
Human/external: representative customer file and operator interpretation/correction/retry; accessibility/mobile; actual disposable PostgreSQL concurrency/upgrade/restore. These remain gates until separately demonstrated.

Update Markdown implementation status and evidence alongside source. Do not close L2-02 solely because tests pass.

## Verified matching refinement

Independent review reproduced a Unicode name/company miss because SQLite lower/trim differs from JavaScript normalization. As a bounded adoption detail of ADR-014, migration 0010 also adds leads.normalized_name_company_key and a workspace index. The key is a SHA-256 hex digest of the existing application buildNameCompanyKey result (trimmed, lowercased name and company), or null when either is absent. It is a candidate lookup value, not person identity, permission or a unique-contact constraint. The digest keeps index entries bounded for older long names.

Migration backfills only this derived lookup value, in bounded ID-ordered pages using a frozen copy of the normalization/hash algorithm; original name, company, source, restrictions and event history stay unchanged. LeadsRepository computes the same value on creation. Future name/company correction must update this derived key in the same transaction. No database-specific case conversion is used for duplicate candidate matching. This is the sole derived-value backfill in this slice; ambiguous historical import effects are still never inferred. PostgreSQL/upgrade and rollback tests must cover it.

## Subsequent identity resolution

[L2-03](L2-03_IDENTITY_RESOLUTION.md) now adds a separate immutable owner decision for reviewed duplicate rows, including late HELD outcomes. It preserves the selection and outcomes defined above; resolution counts/history are additional fields. A resolved row cannot be corrected or committed again. Only leads proven to come from ordinary committed rows in the same frozen selection are excluded from its late duplicate check; separately resolved enquiries remain candidates. [L2-03 evidence](verification/L2-03.md) records that subsequent implementation.
