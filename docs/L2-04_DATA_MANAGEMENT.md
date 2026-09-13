# L2-04 Lead data management

Recorded: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.
Status: implementation contract recorded before source edits under the user's authorized continuation. Implementation and local verification are complete; [evidence](verification/L2-04.md) records remaining operator/external acceptance.

## Task and architecture

L2-04 completes the current data-management slice after L2-01 typed context, L2-02 reviewed imports and L2-03 reviewed identity. Deliver owner contact/name/company correction, archive/restore, bounded directory browsing, useful explicit-selection export and their React workflow. Preserve the modular monolith, PostgreSQL production direction, SQLite verification, existing enquiry identity and human review boundaries. ADR-016 extends the accepted data/source, restriction and transaction decisions; it adds no provider or service.

Lead.data_revision is monotonic for corrections and archive transitions. Lead.archived_at is independent of status and contact restrictions. No historical lead is guessed archived or modified by backfill. At revision 0, previous fingerprints and review authority remain compatible; new default columns must not invalidate every unchanged historical artifact.

## Owner correction and history

The editable snapshot has exactly name, email, phone and company. Name is required (1..200 trimmed characters); email/phone/company may be null, with explicit unknown allowed rather than fabricating a contact. Email uses the existing canonical validator, up to 320 characters; phone uses explicit IN, US or INTERNATIONAL_ONLY interpretation, maximum 80 characters, with no alphabetic stripping. Company is at most 200 characters. Existing oversized historical fields require explicit correction, not silent truncation.

Preview receives expected_revision, values and default_phone_region. It returns current/proposed normalized values, changed fields, current/new contact restrictions, duplicate candidates and affected work counts. An exact review token binds current source revision, proposed values, matching candidates and relevant policy/work state under the workspace gate. A new duplicate is visible and requires explicit owner review; no identity merge occurs. Bound scans and make excess visibly unavailable rather than approving incomplete review.

PUT repeats the reviewed values/region/revision plus token and a 1..2000-character reason. Record one immutable CORRECT change, update original lead contact fields and the canonical name/company key, preserve source/import associations and carry restrictions, then invalidate old authority through the new revision in the same transaction. No-op with current revision returns unchanged; accepted identical command retries return their original change, even if later history exists. A different command at a consumed revision conflicts. Stale preview/revision retains the UI draft and requires fresh review.

Preserve per-field provenance for name/email/phone/company. A changed field cites its immutable correction record/revision and owner; unchanged fields retain earlier correction provenance or their original source. Current intelligence must not describe a corrected CSV field as an untouched imported value. Imported raw cells, row decisions and typed enquiry facts remain unchanged by a contact correction.

Carry every effective old restriction, including HARD_BOUNCE and DELIVERY_REVIEW, to a LEAD anchor at its original channel scope before changing identity. Preserve original restriction/source-event evidence and raw plus normalized old identities. This conservative slice has no evidenced resubscription/verified-address exception; a typo correction cannot silently reopen a restricted enquiry. Do not spread the carried restriction to other enquiries at the new address or infer relationships through names. Legacy OPTED_OUT/SUPPRESSED status stays unchanged.

Correction blocks queued actions, stops existing workflows and cancels automatic no-response tasks. Existing human follow-up tasks remain visible for an operator. New action intent requires current analysis/review. No request claims to recall work authorized before the correction transaction.

## Archive and restore

Owner archive/restore requires the exact data revision, archived boolean and reason. Archive records ARCHIVE, sets archived_at, stops existing open/paused workflows, blocks queued actions and cancels open follow-ups. The UI names this enquiry and shows the consequences; archive is never a side effect of export or a bulk selection.

Restore records RESTORE and clears archived_at, retaining contact restrictions and original lifecycle/status. It does not restart canceled actions/tasks/workflows or restore old approvals/current analysis. Revision increments prevent archive/restore or edit-away/edit-back from resurrecting old authority.

Archived enquiries remain readable with source/history and export, and remain candidates in import/inbound identity matching. Linking a new import source to an archived enquiry is refused; the owner can explicitly restore or retain a separate enquiry. Current directory/work pickers exclude archived records by default; archive status remains distinct from suppression.

Archived enquiries cannot enter new lead editing, enquiry correction, research ingestion, analysis, action creation/approval/dispatch, workflow enrollment/resume/advancement or follow-up creation. Actual inbound messages, opt-outs, delivery facts and execution/receipt recovery continue. An archived reply never creates another lead merely because the old lead is hidden, never restores the lead and creates no new response task. Durable lead events may checkpoint as skipped without generating AI or outbound work.

Queued/uncertain/authorized execution semantics remain independent. Preserve an existing ambiguous execution before applying an archive block; already-authorized provider results remain truthful. A retryable failure cannot start a new retry while archived. Delayed callbacks after correction or archive/restore may preserve the original message/delivery but must not create fresh no-response work using stale context.

## Persistence and helper boundaries

Add immutable 0012_lead_data_management. leads gains data_revision default 0 and nullable archived_at. lead_data_changes stores a scoped unique (organization_id, lead_id, expected_revision), revision=expected+1, kind, immutable before/after JSON, review token/request hash, reason, actor/time and effects. Scoped foreign keys bind actor and lead. Bound snapshots and revision integers in the database. No earlier migration is edited.

LeadDataService owns get, preview, update, setArchived and directory; LeadExportService owns exportSelected. A read helper loadLeadDataContext loads current revision/archive and field provenance for downstream domains. Shared applyLeadDataSafetyInTransaction commits carried restrictions and stopped-work effects using the caller's workspace transaction. Domain safety/model work never opens a nested parent transaction or holds a database transaction across provider/model I/O.

Correction/archive, manual lead creation, import/identity writes, policy updates and dispatch authorization serialize through the existing workspace gate. Manual API creation now commits lead, LeadCreated and audit as one unit. Model services reject stale passed lead state before capturing a revision; finalization rechecks current persisted revision/archive. Current reads reload authoritative data before labeling an artifact current.

## HTTP contract

Workspace and actor come from the authenticated session. Mutation/preview/export require a current owner rechecked under the gate; unknown command fields reject. History and directory reads remain tenant scoped.

- GET /api/leads/:id/data with optional before_revision/limit: current lead/data/provenance and paged immutable change history.
- POST /api/leads/:id/data/preview: {expected_revision,values,default_phone_region}.
- PUT /api/leads/:id/data: {expected_revision,values,default_phone_region,review_token,reason}.
- POST /api/leads/:id/archive: {expected_revision,archived,reason}.
- GET /api/leads/directory: search/source/status/archive (ACTIVE, ARCHIVED, ALL), validated cursor and limit; default 50, maximum 100. Return {leads,total,has_more,next_cursor,limit}. Stable server pagination; do not silently export only a displayed page.
- POST /api/leads/export: {lead_ids}, explicitly selected 1..1000 unique same-workspace IDs. Return a fixed-name UTF-8 CSV attachment with record-count metadata, no-store and nosniff. Missing/foreign selections or output above 8 MiB reject completely before response.

Existing GET /api/leads keeps its list response for existing consumers, now defaulting to active records and supporting an explicit archive filter. The new directory hook is separate from workflow picker behavior. Successful writes return current data plus the applied change/effects; accepted retries expose the recorded result rather than repeating effects. Exact response field shapes are agreed between module owners before client coding and recorded below.

## Useful and safe export

Export current contact/identity, separate archive/contact status, data revision, contact-policy flags, six enquiry fact states and values, currency/exact budget bounds, dates and source references. Retain conflicted alternatives and exact original strings in canonical contact_json/enquiry_json object columns. Do not coerce monetary strings through floating point.

Use fixed headers, CRLF rows, quoted cells and doubled quotes. For human spreadsheet display, neutralize dangerous/control/full-width formula prefixes with visible text: labeling; protect precision-sensitive/leading-zero numeric strings similarly. Do not use executable formulas to preserve text or promise spreadsheet-specific round trips. Preserve exact underlying values in JSON object columns and database sources. Existing client CSV download surfaces receive the same formula/CR protection.

This is a selected-record operational export, not a full tenant backup/deletion or portable restore format. The UI states selected count, hidden selected records, scope and transformations. Zero selected never means all records. Do not silently truncate selected records or facts. Human Excel/LibreOffice/open-save-reopen checks remain acceptance work. Quoting behavior follows [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html); formula risk and spreadsheet variability are described by [OWASP](https://owasp.org/www-community/attacks/CSV_Injection).

## Parallel ownership

- Root: contract/ADR/specifications/evidence, shared API and manual creation atomicity, migration registry/logging, API active dashboard/attention scope, shared server/client CSV serialization, root HTTP/CSV tests.
- Backend: lead data contracts/repository/service/context helper, migration 0012, directory/export service, LeadsRepository fields/filters, import identity revision/archive matching, data transaction/schema/export tests, backend evidence.
- Review: correction/archive safety helper and restriction carry, intelligence/current-read/model/prepared review revision binding, archive guards across actions/workflows/scheduler/inbound/callback/research/context, independent race/provenance/behavior tests, review evidence.
- UI: management panel/history, archive dialogs, directory/export selection/download helper and detail integration, types/hooks, isolated browser verifier, UI evidence. Root owns the shared client CSV serializer.

Coordinate exact helpers/fields first; no overlapping edits. Changes to common API/registry and package scripts remain with root.

## Acceptance and human QA

Automated: owner/tenant/unknown-field boundaries; validation/normalization; exact correction history and unchanged sources; stale/retry/conflicting decisions; all write-stage rollback; independent restart; revision-0 upgrade compatibility; edit-back/archive-restore freshness; model/dispatch/archive races; current-field provenance; restriction carry without neighbor propagation; truthful inbound/callback recovery and skipped archived work; new work blocked after archive; directory/selection scoping; formula/quote/CR/Unicode/precision/caps; original source resolution/history preserved.

Actual React browser: first operator imports/corrects/reviews source, edits contact, observes fresh history/stale approval, archives/restores, finds archived records and downloads exactly selected useful records. Test stale response/reload/retry and export failures. Run safe disposable full regression and applicable integration suites; PostgreSQL only through the explicit disposable target gate.

Human acceptance: representative files and real offering/source truth; comprehend correction versus new enquiry, old restrictions retained after correction, archive versus opt-out, and restore without automatic restart. Verify desktop/phone/keyboard/screen-reader, Excel/LibreOffice values/formulas after save/reopen, real PostgreSQL independent-process/upgrade/restore and actual provider late events. L2-04 stays [~] until required external/operator acceptance exists. L2-05 broader freshness/conflict policies and L3 business-fit intelligence remain subsequent work.

## Integrated response shapes

GET data returns {current,history:{changes,has_more,next_before_revision}}. Current contains data_revision, archived_at, values (the four editable fields), normalized_values (those fields plus normalized_email/normalized_phone), and field_provenance. A corrected field cites {source_type:LEAD_DATA_CHANGE,change_id,revision,created_by,created_at}; null retains original-source authority.

Preview returns {current,proposed:{values,normalized_values},changed_fields,review_token,can_save,unavailable_reason,duplicate_candidates,duplicate_total,duplicates_truncated,current_policy,proposed_policy,effects}. Save/archive add change, changed, replayed and effects to the returned current/history result. Exact retry returns the original applied revision; clients refresh the authoritative GET separately rather than presenting an old accepted result as current.

Effects contain carried_restriction_ids, blocked_actions, cancelled_follow_ups and stopped_workflows. Public restriction IDs are limited to 100 with carried_restriction_count and carried_restrictions_truncated; stored effects allow up to 1 MiB. Before/after snapshots allow 512 KiB each. History defaults to 20 changes, at most 50. Directory cursors bind normalized filters and a created_at/id keyset; they are not offsets.

LeadExportService.exportSelected returns {csv_text,filename,row_count,generated_at} internally. HTTP returns the CSV attachment leads-export.csv and X-Export-Record-Count. Numeric display strings use visible text labeling even when short, keeping interpretation consistent across exported phone, leading-zero, exponent and precision-sensitive values.

## Exact late provider restriction after correction

Review identified a timing gap beyond already-pending receipt policy: an authenticated unsubscribe/complaint/permanent failure can arrive after a contact correction has already committed. The original actual-recipient restriction remains mandatory. Additionally, a normal provider event may anchor the same restriction to the corrected enquiry's LEAD identity at EMAIL scope only when persisted evidence proves its exact original send.

Required proof is a mutually consistent workspace/action/execution/prepared-revision reference, recorded dispatch authorization, sendgrid execution provider, matching execution envelope hash and prepared content hash, verified immutable envelope fingerprint, and exact envelope workspace/action/type/channel/provider/actual-recipient equality. The association comes from the saved execution, never an arbitrary lead supplied by the event. Old proven attempts remain valid evidence even when newer work or contact revisions exist. No restriction is written onto the new address or neighboring records.

Missing/conflicting references or recipient mismatch do not produce a LEAD restriction; the established actual-contact restriction/quarantine behavior remains. Changed-input receipt conflict handling remains contact scoped. This extends the correction rule's conservative retention to a demonstrably related late event; it does not introduce general historical-address matching or provider-thread assignment. An uncorrelated reply to an old corrected address still needs the later inbox/thread-assignment workflow. Exact proof, wrong recipient/reference, repeated receipt and post-correction/archive cases require behavioral tests.

Review display clarification: current_policy/proposed_policy include a bounded unique reasons array of {reason,channel} pairs, including applicable legacy contact status. The UI uses human labels so owners can distinguish an email delivery restriction from an all-channel opt-out before carrying restrictions. Source filtering uses supported choices; owners need not type API enum names. Correction is unavailable while mandatory receipt policy is pending, preventing an old-address restriction from being detached before it is processed. Total relevant open work is capped at 10,000 for both correction and archive; history materialization is capped at 8 MiB with a continuation cursor.
