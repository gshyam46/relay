# L2-01 business context and enquiry implementation contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-12**.
Status: recorded before implementation under the user-authorized continuation. This adopts the small versioned-context portion of ADR-008; it does not change the modular monolith, contact policy or provider architecture.

## Scope and dependencies

L1 local operational foundation is verified; required external/human acceptance remains open. Current bounded work is L2-01, depending on L1-03 persistence and the ADR-008 context contract. Generic context capture can proceed without pretending the first customer segment/channel has been validated. Implement business setup, one active enquiry snapshot per lead, explicit provenance/unknown/conflict, history, current-intelligence invalidation and exact-review binding. Import mapping, duplicate/enquiry identity resolution, calibrated qualification/scoring, automatic re-analysis and full composer remain L2-02/L2-03/L2-05/L3/L4.

## API and validation

Owner PUT /api/business-profile accepts {expected_revision,reason,profile}; authenticated GET returns current. Owner PUT /api/leads/:id/enquiry-context accepts {expected_revision,reason,enquiry}; authenticated GET checks same-workspace lead. Each also supports GET <path>/history?before_revision=N&limit=N. History limit defaults20, maximum50; cursor is a positive integer exclusive revision. Return {items,next_before_revision}. Current/write wrappers are {revision,schema_version:1,profile|enquiry,reason,created_at,created_by}. Missing state is revision0 with null audit metadata and neutral profile/all-UNKNOWN enquiry defaults. Reject foreign top-level ownership/actor fields; derive actor/workspace from the session. Updates require reason1..2000 and an integer expected_revision>=0. Conflict409 preserves the draft; no last-write-wins. Current/history never expose another workspace.

Profile full snapshot:
- business_name: trimmed text1..200; offerings:1..20 strings1..500.
- service_areas,target_customers,exclusions,required_criteria,preferred_criteria: arrays0..20 of trimmed strings1..500.
- preferred_next_step: null or text1..500; timezone: null or supported IANA timezone; language: null or text1..80.
- Name and at least one offering are required to save; unknown optional values remain null/empty. Criteria are human descriptions, not an executable rules engine or a scored-fit claim.

Enquiry is a full object with exactly six fields: interest,location,budget,timeline,enquiry_date,last_interaction. Each fact is one of:
- {state:"UNKNOWN",value:null,provenance:null}
- {state:"KNOWN",value:<typed>,provenance:<source>}
- {state:"CONFLICTED",alternatives:[{value:<typed>,provenance:<source>},...]} with2..5 distinct canonical values. Preserve alternatives; no silent winning value.

Source is {assertion:"CUSTOMER_STATED"|"OPERATOR_OBSERVED"|"INFERRED",source_type:"MANUAL",source_reference:<text1..500>,observed_at:<explicit-offset ISO instant normalized to UTC|null>}. It is operator-entered, unverified source context, never contact permission. Server records captured time and actor on the immutable revision; enquiry date is never filled from import/capture time. This was the L2-01 manual-source boundary. The additive [L2-02 import contract](L2-02_REVIEWED_IMPORT.md) now defines owned IMPORT_ROW linkage, exact source/value validation and explicit manual correction without losing earlier lineage.

Typed values: interest text1..500; location {locality:text1..200,country_code:two uppercase letters|null}; timeline {description:text1..500,target_date:strict Gregorian YYYY-MM-DD|null}; enquiry_date strict Gregorian YYYY-MM-DD; last_interaction explicit-offset ISO instant normalized to UTC. Impossible dates reject. Fact source observed_at may be unknown; never invent it. Accept explicit-offset observation input, validate its real calendar/clock before conversion and persist canonical UTC, consistently with last_interaction. This input normalization matches the UI example and does not weaken date validation.

Budget input {currency,minimum:<unsigned decimal string>,maximum:<unsigned decimal string>}; equal ends mean exact, otherwise range. Currency has an explicit supported scale (INR/USD/EUR/GBP/AUD/CAD/SGD/AED/SAR=2,JPY=0,KWD/BHD=3). Unsupported currency or excess fractional precision rejects. Never use JS floating-point conversion or NUMERIC driver parsing. Persist/return {currency,scale,minimum_minor:<integer digit string>,maximum_minor:<integer digit string>} with at most24 digits and ordered endpoints; zero differs from UNKNOWN. Accept this canonical persisted shape on subsequent full PUT only if scale matches the supported currency and digit/range bounds hold. The UI converts exact text using string operations. No exchange-rate/currency conversion or price promise.

Reject unknown keys, mixed state/value shapes, invalid types, control characters, duplicate/conflicting shape abuse and snapshots above32KiB. Use deterministic normalization and clear field paths in validation errors. Plain source references are displayed as text, not fetched or rendered as HTML.

## Persistence and service boundary

Add immutable0009_business_context with two append-only revision tables: business_profile_revisions keyed(organization_id,revision), and lead_enquiry_revisions keyed(organization_id,lead_id,revision). Store schema_version1, validated JSON TEXT, reason,created_at,created_by. Highest revision is current; there is no mutable head, legacy backfill or copied profile on every lead. Positive revision bounded by2147483647. Add scoped unique indexes/composite foreign keys for actor and lead ownership where required; preserve all prior migrations/history.

BusinessContextService(db) uses ContactPolicyService.withWorkspacePolicyTransaction for owner verification, same-workspace lead checks, expected-revision comparison, append and audit. No provider/model calls or mass workspace refresh inside it. Repeated stale PUT cannot create a duplicate revision; identical normalized content at the current expected revision returns the current row without another audit. Conflicts never clear suppression or mutate attempts/terminal history.

Public service methods: getProfile({organization_id}), updateProfile({organization_id,expected_revision,reason,profile,actor}), profileHistory({organization_id,before_revision,limit}); getEnquiry/updateEnquiry/enquiryHistory with lead_id added. Actor is {id,role} and must match an existing same-workspace OWNER user (the current schema has no disabled-user flag) in database. Repository/read helper loadLeadBusinessContext(db,{organization_id,lead_id}) returns {profile:<current wrapper>,enquiry:<current wrapper>,revisions:{profile_revision,enquiry_revision}}; missing returns zero/defaults. Read helpers have no side effects and support transactionBound clients.

## Intelligence and review

Current persisted profile/enquiry revisions enter snapshot input fingerprints, so synthesis/recommendation/plan current checks cascade. No-context zero/zero preserves existing fingerprints and reviewed content until the first meaningful save. Generated evidence quotes KNOWN non-inferred enquiry values with exact field source and revision, labels operator-entered origin and preserves source time; UNKNOWN/CONFLICTED/INFERRED cannot become asserted buying need, permission or budget. Current context and unknown/conflict/inference warnings are visible. Combined formatted values beyond the existing500-character grounding bound remain stored/displayed and add an EXTRACTION_LIMIT review warning; they are not silently asserted. Business criteria are stored/displayed; fit/priority scoring and claim-usefulness evaluation remain L3.

Pipeline generation must not publish current artifacts from context that changed while work ran. Staged worker commits already rebuild inputs under the workspace gate; direct model completion must recheck context under a short finalization transaction. No network/model call inside a transaction. Current summary/attention and action-from-plan routes must not treat stale persisted READY/PLANNED history as current. Profile updates do not synchronously rewrite every lead or historical artifact.

PreparedActionService reads revisions from its transaction-scoped DB for preview/decision/dispatch, never trusts caller-supplied context. Nonzero revisions extend the private review fingerprint. A save makes old approved SEND review stale; a new exact preview/review is required, while already-authorized provider work may finish. This does not reset retry deadlines/budgets, waive restrictions or rewrite historical envelopes.

## UI and ownership

Settings Business profile and lead-detail Enquiry views support current state, forms, sources, exact money, history, save reason, owner permissions, loading/errors and explicit Load latest after stale revision. Preserve unsaved draft on background refresh; do not mislabel unknown as zero or inferred as stated. Context save explains that analysis requires refresh and reviewed sends may need review.

Root owns this contract, migration registry, API/service wiring, snapshot/evidence/read-surface integration, primary docs and integrated verification.
context_backend owns src/modules/business-context/*, migration0009 implementation, backend/migration tests and focused evidence.
context_review owns preparedActionService and synthesis/recommendation/plan short finalization guards plus focused review/race tests (coordinate root on shared assumptions).
context_ui owns new client context types/hooks/components and minimal Settings/lead-detail integration; owns scripts/verify-business-context-ui.js for isolated local browser verification, without package-script changes.

## Acceptance

Automated: strict typed fields/unknown/conflict/provenance/date and exact-money round trip; owner/tenant/actor boundaries; revision contention/history/pagination/noop; audit failure rollback; populated0008 upgrade and immutable history; no-op/absent backward compatibility; evidence/freshness and model-save races; edited context invalidates exact SEND before any attempt without changing restrictions; API create/edit/read/history flow; actual React save/conflict/unknown/money/history behavior when local browser is available. Run safe isolated full CI/smoke/workflow checks and frontend typecheck/build.

Human/external: operator configures a real offering and recognizes recorded enquiry context/sources; verify wording, keyboard/mobile, conflicts and correction-to-reanalysis-to-review; PostgreSQL multi-process/upgrade/restore and selected customer/channel acceptance remain open. Do not mark L2-01 or L1/customer gates complete without their required evidence.
