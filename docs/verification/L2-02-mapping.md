# L2-02 CSV mapping and import provenance evidence

Product: **AI Lead Intelligence & Outbound Automation**. Date: **2026-09-12**.
Status: local implementation and automated evidence for the [reviewed import contract](../L2-02_REVIEWED_IMPORT.md); human and external gates remain open.

## Implemented boundary

The CSV parser preserves ordered headers/cells, physical row numbers, quoted multiline text, escaped quotes and Unicode. Duplicate, blank and reserved headers cannot overwrite the ordered source. Unambiguous original-header object keys remain available for legacy clients. Byte, row, column and cell limits are enforced during parsing; malformed quoting cannot create preview authority. Reviewed ragged rows require correction. Inspect returns bounded samples and unambiguous mapping suggestions, without creating a batch or lead.

Reviewed mapping uses explicit column indexes and exact flat-value keys. It validates mapping/options, phone interpretation, strict selected date formats, explicit-offset timestamps, source assertions, partial facts and exact currencies. Unmapped/blank facts remain UNKNOWN. Zero remains KNOWN. Existing L2-01 money normalization preserves up to 24 integer minor-unit digits as strings; no floating-point conversion, grouping removal or implicit currency/date choice occurs. Local phone normalization no longer removes arbitrary letters/extensions/multiple-number separators.

The backend binds each normalized enquiry fact to its owned import batch/row/field before persistence. IMPORT_ROW is a validated context source, not evidence of permission or independent truth. Later owner edits may preserve an unchanged imported fact only after a workspace-transaction check against the committed row, resulting lead and exact saved value/provenance. Changed values, source assertions/times, foreign/uncommitted rows or fabricated links reject. A changed fact can use MANUAL provenance while revision history retains its prior imported source.

Grounded enquiry evidence represents IMPORT_ROW through the existing CSV evidence type, with the actual import-row reference, field and unverified-source metadata. Known facts can enter the existing exact-grounded pipeline; inferred facts remain review context and never become asserted buying need or permission. No evidence enum or no-context fingerprint version was changed.

## Files and contracts

- Parser/legacy adapter: [csvParser](../../src/modules/data-foundation/csvParser.js), [csvAdapter](../../src/modules/data-foundation/csvAdapter.js).
- Normalization/validation: [normalization](../../src/modules/data-foundation/normalization.js), [importValidation](../../src/modules/data-foundation/importValidation.js).
- Pure reviewed API: [reviewedImportMapping](../../src/modules/data-foundation/reviewedImportMapping.js) exports inspectCsv, buildReviewedCsvPreview and normalizeReviewedImportRow; rows expose mappedValues, normalizedValues.enquiry and validation issues/state.
- Context source contract/authority: [businessContextContract](../../src/modules/business-context/businessContextContract.js), [businessContextService](../../src/modules/business-context/businessContextService.js), [importProvenance](../../src/modules/business-context/importProvenance.js).
- Evidence projection: [businessContextEvidence](../../src/modules/lead-intelligence/businessContextEvidence.js).
- Behavioral regressions: [mapping tests](../../test/reviewed-import-mapping.test.js), [provenance tests](../../test/reviewed-import-provenance.test.js).

## Automated verification

~~~powershell
node scripts/run-tests.js test/reviewed-import-mapping.test.js test/reviewed-import-provenance.test.js test/imports-flow.test.js test/csv-parser.test.js test/normalization.test.js test/business-context.test.js test/business-context-http.test.js test/l2-context-grounding.test.js test/l1-ai-grounding.test.js
~~~

Result: **81 tests, 81 passed, zero failures, zero skips** through the sanitized disposable SQLite launcher. The two new files contribute 20 tests. They cover duplicate/reserved/entirely blank headers, quote/physical-line/Unicode preservation, caps, exact mapping and options, short/extra rows, phone ambiguity, strict dates/offsets, partial data, zero/unknown and monetary precision, citation ownership/value tampering, preserved imported alternatives/manual correction history, and full known/inferred imported-fact analysis. Existing import, context and AI grounding behavior remains covered. Import itself creates no outbound action or attempt.

These are local behavioral checks. PostgreSQL process concurrency, restore/upgrade and actual deployment validation are separate evidence. The integrating owner records transaction/migration/API/browser and full-suite results in the integrated L2-02 verification artifact.

## Human QA and remaining limits

Use a representative customer file to verify the column labels, explicit phone/date/currency choices, raw-versus-corrected values, unknown/zero distinction and operator understanding of source assertions. Confirm unchanged imported facts retain traceable links, while edits require a manual correction source. Exercise duplicate holds, correction, chunk progress and reload/resume through the shipped React interface, including keyboard and mobile layouts. The supported phone parser checks formatting rather than subscriber ownership or deliverability; unsupported country/date/currency formats need explicit correction. Customer identity resolution and broader import/export/retention work retain L2-03/L2-04/L5 gates.
