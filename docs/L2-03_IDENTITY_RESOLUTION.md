# L2-03 Reviewed contact and enquiry identity

Recorded: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.
Status: contract recorded before source changes under the user's authorized continuation; now implemented and verified locally. [Integrated evidence](verification/L2-03.md) records tests and remaining operator/PostgreSQL acceptance.

## Task and architectural boundary

Current milestone L2; task L2-03 depends on L1-04 contact restrictions, L2-01 versioned enquiries and L2-02 reviewed import transactions. Lead remains one enquiry with its own facts, intelligence, actions and history. A normalized contact may appear on several enquiries; it is not a Person aggregate or proof of consent. ADR-015 adopts this bounded extension of ADR-006/008/014. No database-engine or service-boundary change is required.

An owner may attach a duplicate row as another source of an existing enquiry or create a separate enquiry. There is no destructive merge, automatic fact replacement, consent transfer, alias graph, or model-selected identity decision. Contact/name correction on an existing lead remains separate data work.

## Decisions and eligibility

- LINK_EXISTING, classification SAME_ENQUIRY: target is a current same-workspace candidate with exactly the same canonical email and phone pair, including missing values, and at least one contact. Different known addresses or a missing versus present address require separate review. Attach source only; target facts, context revision, contact, lifecycle, actions, messages and approvals are unchanged.
- CREATE_SEPARATE, classification REPEATED_ENQUIRY, SHARED_CONTACT or DISTINCT_ENQUIRY: target_lead_id must be null. Create one lead/enquiry from this exact reviewed row. Classification records the owner's explanation, not a verified person relationship. Shared contact restrictions remain applicable.
- Both require a 1..2000-character reason and the exact current review token. No choice or candidate is preselected.
- Only valid contract-2 rows with duplicate evidence may resolve. Eligible states are unselected PENDING rows in READY_TO_COMMIT or COMMITTED batches, and selected HELD rows in COMMITTED batches. Resume COMMITTING/FAILED work first. Historical/compatibility and already committed source rows do not acquire new inferred authority.
- Every row has at most one final identity resolution. An identical original command returns it; a changed command conflicts. Resolved rows cannot enter ordinary commit or be corrected. Other unselected rows remain reviewable under existing revision rules. Late ordinary commit excludes only leads proved to come from ordinary COMMITTED outcomes of its frozen batch; resolution-created enquiries remain candidate matches.
- Original raw cells, corrections, selected IDs, row markers and L2-02 outcomes remain historical facts. Resolving a late hold does not rewrite the original HELD outcome or expand the frozen import selection.

Within-file groups can explicitly create the first separate enquiry, then refresh and attach remaining rows to it. This prevents a group in which every row waits on another unresolved row.

## HTTP and service contract

All paths are authenticated and tenant-scoped; mutation and identity review require a current owner, checked again under the workspace gate. Workspace and actor come from the session. Unknown command fields reject.

- GET /api/imports/:id/rows/:rowid/identity-review
- POST /api/imports/:id/rows/:rowid/identity-resolution
- GET /api/leads/:id/import-sources

ImportIdentityService(db) exposes review(input), resolve(input) and listSources(input). Review input is organization_id, import_id, import_row_id and actor. Resolution adds review_token, decision, classification, target_lead_id and reason. POST returns {resolution, import}, where import is the current L2-02 detail envelope.

Review returns {review_token, can_resolve, unavailable_reason, row, existing_candidates, existing_total, existing_truncated, row_candidates, row_total, row_truncated, resolution}. Existing candidate entries are {lead, match_types, enquiry_revision, enquiry, contact_policy, can_link, link_block_reason}. Row candidates are {id, row_number, normalized_values, match_types, resolution}. At most 50 existing leads and 20 source rows are displayed with explicit total/truncation labels. The first matching record is never represented as unique identity. Separate creation remains possible with a truncated display because no candidate is merged or modified.

The token binds the batch/row revision and state, exact row values, existing resolution state, and the full current matching candidate identities/contact/status/enquiry revisions and applicable restriction state. Candidate discovery uses indexed contacts/name-company keys and bounded pages, not a whole-workspace lead load. Above 5000 existing matches, review is unavailable with an explicit limit reason instead of silently ignoring remaining candidates. Policy review also caps relevant restriction/pending receipt records at 10000; overflow returns an unavailable review with no usable token, rather than approving against truncated policy evidence. A target, source or restriction change requires fresh review. A persisted identical resolution remains replayable despite later changes.

Import detail adds each row's identity_resolution and can_resolve_identity, resolutions history, and resolution_summary {linked_rows, created_rows, resolved_held_rows, unresolved_duplicate_rows}. Original commit progress is not renamed as resolution progress. Public resolution objects expose decision/result metadata, not the stored review snapshot; this avoids multiplying large snapshots across row/history/candidate responses. Sources returns {sources, has_more, limit, byte_limit}; each source retains import/row references, filename, row number, normalized and raw source, and resolution metadata when applicable. Fetch most recent 100 with an 8 MiB serialized source budget and explicit truncation; select bounded metadata pointers first and materialize sources individually, preserving complete returned source rows. existing direct import links remain accessible.

## Persistence and failure semantics

Add immutable migration 0011_import_identity_resolution. Append-only import_identity_resolutions owns row-to-lead source association with scoped foreign keys to workspace/batch/row/lead/event/actor, unique workspace/row and event identity, and a unique created lead for CREATE_SEPARATE. Persist id, organization_id, import_id, import_row_id, review_revision, review_token, request_hash, decision, classification, target_lead_id, lead_id, event_id, reason, review_snapshot_json and created_at/created_by. Check decision/classification/target/event combinations and bounded text/snapshot fields in the database. Review snapshots are at most 512 KiB; raw cells remain in the original row and their digests bind the decision. No historical row/backfill or previous migration changes.

Creation, initial typed enquiry (when known), LeadCreated event, source association/resolution and audit commit together under the workspace gate. LINK writes only resolution/source association and audit. Failure at any write leaves no partial result; repeat clicks, concurrent clients and process restart cannot create a second enquiry/event. External providers/models are not called.

The immutable decision snapshot includes the exact source and selected target review, candidate counts and matching-state digest. Normal import sources remain authorized by the existing committed outcome; resolved sources require the exact scoped resolution association. Provenance validation must continue to verify exact field/value/assertion/time. A workspace-owned row alone is never sufficient. Linked source facts are visible separately and do not silently enter current intelligence. Existing manual correction semantics remain explicit.

## Shared-contact replies

An ordinary contact-only reply matching several leads must not choose one arbitrarily. Before completing mandatory receipt policy, stop existing sequences and automatic no-response work for all directly matched contacts, atomically with a receipt-scoped audit marker. Retain the ambiguous receipt for owner Event recovery. Do not create a fabricated canonical message, lead reply event or assigned human task. Opt-outs still apply direct contact restrictions.

Replay must not repeat the stop against newer intentional work. Existing in-flight/terminal sends remain historical facts. Guard delayed callback no-response task creation against already-recorded ambiguity where applicable. Ambiguous-reply preflight is capped at 100 directly matched leads, active workflows, queued workflow actions and automatic no-response tasks per category. Overflow leaves mandatory policy pending and needs operational review. Delayed-callback lookup is capped at 100 relevant stop receipts; overflow also fails closed. Pre-existing DONE receipts without a stop marker re-establish the pending gate before retry. Full provider-thread correlation and owner reassignment of an ambiguous reply remain L4-03; the current receipt cannot have its immutable input rewritten.

## Parallel ownership

- Integrator/root: this contract, ADR/status/specification/evidence docs, shared API wiring, migration registry, safe logger paths, HTTP integration tests and combined verification.
- Backend owner: import identity service/contract/repository, migration 0011, import eligibility/detail/source integration, transaction/migration tests, focused backend evidence.
- Review owner: exact import provenance association validation, bounded ambiguous inbound/callback protection, independent restriction/review/rollback tests, focused review evidence.
- UI owner: identity dialog, import hook/types/page integration, lead source viewer, isolated browser verifier, focused UI evidence.

Resolve shared contracts before dependent edits. Do not change another owner's files without agreement.

## Acceptance and evidence

Automated: owner/tenant/unknown fields; initial and late holds; in-file groups; same contact two enquiries/shared address; link facts/history/restrictions preserved; mismatched-contact link refusal; source forgery; exact replay/changed intent; stale target/source/restriction/candidate reviews; simultaneous commit/correction/resolution; write rollback and durable restart; candidate bounds; populated upgrade/scoped constraints; ambiguous reply stops and retry/late-event safety. Use safe disposable test launchers and explicitly gated PostgreSQL only.

Actual React browser checks must exercise source/candidate comparison, no preselected decision, link versus create, suppression warnings, late hold, stale review recovery and final source/history links. Build/typecheck and full regression checks remain required.

Human QA: representative duplicate/repeated/shared-contact customer files; explain why two enquiries remain separate; verify linked conflicting source is visible without replacing current facts; verify opt-out survives; handle an ambiguous reply in the documented recovery process; keyboard/mobile/accessibility. Real PostgreSQL independent connections, upgrade/restore and actual provider threading remain external gates. L2-03 stays [~] until required acceptance exists.
