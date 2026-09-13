# L3-01 Business fit and attention priority

Status: implementation contract recorded 2026-09-12 before source edits, under the user's continued implementation authorization. Local implementation and [integrated verification](verification/L3-01.md) are complete; L3-01 remains [~] for customer and external acceptance. Dependencies: L2-01 versioned context and L2-05 freshness/currentness. Their external PostgreSQL/provider/operator gates remain open.

## Product outcome

An owner explicitly configures business criteria. An analysis evaluates the saved enquiry against those criteria and records the exact supporting facts, unknowns and source issues. The queue orders current assessments by configured business rules. Readiness, fit, preference coverage, response obligations and contact eligibility remain separate. No business-fit result grants contact permission or sends a message.

This finite rule foundation is not general semantic language understanding or a predicted conversion probability. Owner-approved whole-value aliases provide explicit interpretation; unrecognized paraphrases, negation and multilingual variants abstain. Existing bounded AI research/extraction remains in place. L3-02 and customer-reviewed held-out evaluation must establish broader usefulness.

## Versioned criteria

The existing business profile revision wrapper adds nullable `fit_criteria`. The profile schema remains version 1 and existing descriptive arrays remain unchanged. Optional `fit_criteria` on the existing owner PUT shares its expected revision, reason, transaction and history. Omission preserves saved criteria; explicit null disables them; a semantic no-op does not create a revision. Any profile/criteria edit uses the existing monotonic profile revision and invalidates dependent analysis and prepared reviews. No automatic analysis runs on save.

Non-null criteria have exactly `version:1` and four nullable slots. At least one configured slot must be REQUIRED. Requirements are REQUIRED or PREFERRED.

| Slot | Exact configuration | Evaluation |
|---|---|---|
| interest | requirement, accepted_aliases, excluded_aliases | Trim, NFC, case and whitespace normalization followed by whole-value equality only. Explicit excluded match fails; unrecognized text is unknown. |
| location | requirement, areas, excluded_areas; each area has country_code, locality, aliases | Actual recorded country plus whole-value approved locality/aliases. No phone/currency inference, geocoding or substring matching. |
| budget | requirement, currency, minimum decimal string | Existing currency scale and exact minor-unit BigInt comparison. Minimum at/above threshold matches, maximum below fails, crossing range or different currency is unknown. Zero is known zero. No FX conversion. |
| timeline | requirement, earliest_date and latest_date, each nullable ISO date | At least one absolute bound; inclusive comparison of explicit target_date. Description-only timing is unknown. No relative-now urgency. |

Maximum 20 aliases/areas per bounded list; ambiguous duplicate/overlapping accepted and excluded rules are rejected. Unknown keys, malformed dates/currencies/amounts and unsupported expressions fail validation. Descriptive profile text is never parsed into executable rules.

## Saved assessment and references

A deterministic assessment is captured in the existing snapshot transaction alongside freshness. Nullable legacy rows remain readable without a backfill. A newly evaluated result has:

- version, criteria_revision (the existing profile revision), evaluated_at and status;
- criterion_results with criterion_id (the field), requirement, the exact configured rule, outcome, reason_codes, evidence, missing_fields;
- evidence as {fact: exact enquiry slot including provenance/alternatives, freshness: field assessment};
- unassessed_profile_criteria and limitations;
- attention_priority with band, reason, preferred_matches, preferred_total, ranking_incomplete and criterion_refs.

Outcomes are MATCH, NOT_MATCH, UNKNOWN or NEEDS_REVIEW. Only usable, current, non-inferred, unconflicted facts can establish a positive result. Unknown is never silently negative. A definite required failure or explicit exclusion yields DOES_NOT_MATCH/LOW. An unresolved required criterion yields NEEDS_REVIEW/REVIEW. Fully supported required criteria yield MATCHES_CRITERIA/MATCHING; unknown preferences keep ranking_incomplete true. No configuration yields NOT_CONFIGURED/UNASSESSED.

Descriptive required/exclusion notes remain unevaluated and require manual review; they cannot silently coexist with an unqualified matching verdict. Descriptive preferred notes make preference coverage incomplete. Unrelated source uncertainty does not erase matches on configured fields.

Stored assessment parsing is bounded and fails closed on invalid state. Criteria references are distinct from source evidence IDs; missing-field explanations cannot borrow name/email evidence to support an absent budget.

## Authority and compatibility

Migration 0014 adds nullable fit_criteria_json (32 KiB) to business_profile_revisions and business_fit_json (128 KiB) to intelligence_snapshots. There is no new database service, job runner, provider or AI loop.

The evaluator version enters the snapshot fingerprint only after criteria adoption. Existing revision/freshness guards bind criteria changes through synthesis, recommendations, plans, approvals and dispatch. Neutral legacy fingerprints remain unchanged. Only CURRENT read views expose authoritative top-level business_fit/attention_priority; outdated/archived results remain historical snapshot data. Reads do not create assessments.

The old recommendation priority number remains legacy processing attention, not business fit. When explicit criteria require review or do not match, preparation of outreach is constrained to an existing human-review recommendation. Data gathering, duplicate review, response obligations and already-authorized delivery truth retain their existing meanings.

## Queue and interface

Settings provides a typed owner editor with revision history, stale-draft protection and explicit disabling. Detail separates configured fit, attention priority and readiness, shows each criterion and exact source state, and links source corrections. Saving/viewing never performs contact work.

The summary uses deterministic server ordering: MATCHING, REVIEW, LOW, UNASSESSED; confirmed preferred matches descending within MATCHING, then stable lead ID. No readiness, contact completeness or import recency contributes. Ranking applies to the explicitly returned scope; response metadata states scope/count/truncation. Unknown and source-review queues remain accessible. Contact policy stays authoritative in its own review/dispatch path.

## Verification and acceptance

Automated behavior: exact money/date/text boundaries; unknown/conflict/stale/inferred facts; tenant/owner/stale revision/history/no-op; criteria change/currentness and downstream review invalidation; replay/rollback/corrupt state; bounded API input and deterministic ranking; no-criteria compatibility. PostgreSQL migration/transaction checks require the existing explicit disposable database gate.

Freeze independent synthetic fixtures before evaluator implementation. Compare labeled pairwise priority against existing readiness and recorded enquiry/interaction recency baselines. Report counts, coverage/abstention and limitations; synthetic rule tests are not customer validation or model-quality certification.

Browser: typed setup/history/stale saves, current fit and reason visibility, older matching versus newer wrong-fit enquiry, unknown/source-review correction, explicit refresh and criteria invalidation, partial/lost-request behavior, and no provider execution during setup/read/analysis. Run existing relevant regressions and project CI.

Human QA: owners confirm exact criteria and aliases, inspect ranking and missed low-ranked positives on representative consented enquiries, measure unknown-language review burden, exercise accessibility/mobile, and validate hosted PostgreSQL/provider workflows. L3-01 remains [~] if these gates are outstanding.

## Parallel ownership

Root integrates API/read projections, migration registry, shared documentation and final verification. Backend owns criteria normalization/persistence, deterministic evaluator and snapshot capture. UI owns typed setup/detail/queue and browser verifier. Independent review owns frozen evaluation fixtures and the bounded recommendation review constraint. Contracts precede parallel source work.

Implementation refinements agreed before dependent edits: area locality:null means the whole recorded country with aliases:[]; overlapping country/locality rules are rejected. Budget minimum is normalized to the currency decimal scale for semantic no-op saves. The queue reads at most 100 active leads per page by stable ID in one workspace transaction and one captured time, then ranks that page. after_lead_id, next_after_lead_id, has_more and workspace_active_count make the returned scope explicit. Totals and eligible IDs apply to the returned page. Paging preserves selection; this is not a global top-K guarantee for workspaces larger than a page. An indexed global ranking queue and measured large-workspace performance remain subsequent scaling work.

Summary fit is a compact projection: version, criteria_revision, status, unassessed_profile_criteria, attention_priority and criterion ID/requirement/outcome/reason_codes/missing_fields. Exact rule/source evidence and limitations are returned on detail/history, not repeated in queue rows.

Review authority refinement before integration: prepared context and late-delivery follow-up guards add the evaluator version to their existing business-context revision binding only when structured criteria are active. This closes the algorithm-upgrade gap without a global prepared-policy bump or changing neutral legacy fingerprints. Delivery remains a recorded fact; subsequent automatic work still requires current authority.

Independent review refinement: row count alone did not bound historical lead text or queue source payloads. Before loading full lead rows, the summary checks SQL byte metadata for at most 101 candidates: identity/display fields at most2KiB each (ID at most200 characters), each lead at most1MiB and the returned page at most8MiB. Oversize fails with INTELLIGENCE_SUMMARY_LIMIT409 and no partial rank. Queue freshness is compact policy/time/revision/review metadata; exact fact and research freshness remains on detail. This does not replace measured workspace lock/load acceptance.
