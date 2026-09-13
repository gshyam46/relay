# L2-05 freshness, conflicts and analysis currentness

Status: implementation contract accepted by the integrating owner on 2026-09-12 under the user's authorized continuation. Local implementation and verification are recorded in [integrated evidence](verification/L2-05.md); human/PostgreSQL/provider acceptance remains open. L2-01, L2-03 and L2-04 local foundations exist; their external acceptance remains open.

## Customer outcome and scope

AI Lead Intelligence & Outbound Automation must distinguish never analysed, current analysis and analysis invalidated by changed or aging evidence. A current analysis can still identify unknown, inferred or conflicting facts. Refresh reassesses saved sources; it never asserts that the customer reconfirmed them. Business fit/scoring, durable analysis jobs and provider discovery retain their later tasks.

## Policy and architecture decision

Adopt version 1 of a deterministic freshness policy: a provisional 90-day TTL for ongoing enquiry interest, location, budget and timeline and for research claims. Exactly at observed_at plus 90 days a fact is stale. Enquiry date and last interaction remain historical facts, not ongoing intent. Identity/contact source values remain current until a versioned correction; this does not verify reachability or contact permission. The default is a conservative engineering policy requiring pilot validation, not an industry claim.

Use explicit, valid offset timestamps and compare absolute UTC instants. Missing observation dates on ongoing facts and research are unusable AGE_UNKNOWN; known non-inferred historical dates retain HISTORICAL with an AGE_UNKNOWN warning. Refresh, import capture and research retrieval times never substitute for observation. Invalid times and observations later than their immutable recording time remain unusable; waiting alone cannot legitimise a future-at-recording assertion. Conflicting alternatives remain unselected and inferred facts never become factual claims simply because they are recent.

Freshness has separate axes: value_state UNKNOWN/KNOWN/CONFLICTED, assertion CUSTOMER_STATED/OPERATOR_OBSERVED/INFERRED/null, freshness CURRENT/STALE/AGE_UNKNOWN/FUTURE_DATED/INVALID_TIME/HISTORICAL/NOT_APPLICABLE, usable and reasons. Retain source references, field, observed_at and expires_at; conflict alternatives retain their assessments. Do not invent a winner across distinct supported values.

ADR-017 permits a narrowly scoped technical write during authoritative currentness reads: advance a per-workspace time high-water under the existing workspace transaction. Effective assessment time is max(server clock, durable high-water); malformed/corrupt state fails closed. This prevents an observed expiry becoming current after clock rollback/restart. Reads generate no model output, snapshot, source or business audit. Model/provider calls remain outside transactions. This refines the prior read-composition comment and is not a new scheduling service.

## Durable authority and compatibility

Migration 0013 adds bounded freshness metadata to intelligence snapshots and the technical workspace clock. Do not alter earlier migrations, historical snapshot rows, observation dates or old audit. Preserve unchanged neutral revision-0 identity-only fingerprints; affected historical artifacts without assessment metadata require explicit refresh. Full profile_revision remains the criteria authority; no duplicate criteria counter.

Fingerprint inputs include policy version, source authority, current revisions, eligible evidence and discrete freshness/conflict states. Exclude evaluated_at and continuously advancing time; unchanged refresh reuses the existing snapshot and dependent artifacts without a new analysis audit. Source expiry changes authority, not merely a visual badge. Prior source reversion cannot revive expired approval. Expose the next actual state transition for read-only UI rechecks.

Use bounded research projection (at most 100 records and 512 KiB, with bounded fields before materialisation) and first-source history lookup (at most 1000 revisions and 8 MiB of enquiry JSON); fail closed rather than silently selecting the first sources. Validate new observation/retrieval timestamps, retain historical malformed evidence as visible unusable data. Unsupported/corrupt metadata cannot grant authority.

## Runtime boundaries

Bind currentness to snapshots, synthesis, recommendations, next actions and prepared outbound reviews. Direct model finalisation and cached reuse must recheck actual parent/input authority under the workspace gate, including reply/research arrivals and expiry during generation. Do not rely only on profile/enquiry/contact revisions. Staged work retains its actual-input checks.

Freshness changes require new current review before unexecuted external actions. Preserve actual already-authorised provider outcomes and original recipients. Late outcomes must not create obsolete automatic no-response work after authority changes; explicit human review remains possible. Ordinary reads/refresh do not start campaigns, clear contact restrictions, rewrite delivery or trigger provider calls.

## Public read contract and UI

Intelligence detail composes the entire read at one captured assessment instant under the workspace gate, so expiry cannot split the badge and dependent artifacts. Add currentness to intelligence detail and summary rows:
- state: NEVER_ANALYSED, CURRENT, OUTDATED or ARCHIVED;
- assessed_at, analysed_at, next_check_at, can_refresh;
- reasons: bounded objects with code, scope and fields;
- evaluated_revisions and current_revisions.

Expose freshness assessment separately, including policy_version, evaluated_at, next_transition_at, facts, research, review_reasons and authority_fingerprint. Each issue explains missing time, age, assertion or conflict and links to existing context/history where possible. Persist this assessment with generated snapshots.

A bounded previous/current recommendation comparison shows stored recommendation descriptors and changed input categories/revisions; do not claim that changed facts caused a particular model decision. Currentness does not certify fit or contact eligibility.

Refresh responses retain the existing bulk shape and COMPLETED/FAILED statuses, adding per-lead reused flags, currentness and safe failure codes. Existing plan-to-pending-action materialisation remains compatible; no provider is dispatched. Explicit selection accepts at most 1000 valid IDs, deduplicates them and processes at most 50 per request. HTTP 200 with failed rows is not total success. Preserve failed/unprocessed bulk selection. Detail/list recheck via GET at server next_check_at, focus and periodic visibility; no automatic POST or client-invented authority.

## Ownership and verification

Backend owns freshness contract/repository/service, migration file 0013, IntelligenceService/Repository, businessContextEvidence, researchProviderContract/Repository and focused domain tests. Runtime reviewer owns synthesis/grounding/context guard/current composition, recommendation/next-action/prepared/workflow/callback integrations and focused runtime tests. UI owns currentness types/components, intelligence/lead detail pages/hooks, focused browser script and UI evidence. Root owns API, migration registry, shared docs/config/scripts and integrated checks. Resolve exact exports before dependent edits.

Automated acceptance: exact expiry/clock rollback and restart, null/future/malformed observations, historical dates, conflicts/inferred exclusion, changed criteria/contact/research/reply, no-op refresh, legacy compatibility and bounds; expiry/input races across model finalisation/prepared dispatch/late callbacks; tenant isolation and HTTP partial failures; actual browser refresh/currentness explanations and no automatic model execution. Run safe test wrappers, full CI, browser/workflow regression, build and docs/link checks after integration.

Human/provider acceptance: operator understands correction versus refresh and recommendation changes; validate the provisional TTL against actual sales cycle and source semantics; confirm accessibility across devices and real PostgreSQL concurrency/restore/deployment clock behavior. These remain open until evidenced. No deployment or live sends are authorised by local tests.

### Transaction failure clarification

A failed approval/finalisation may be the first operation to observe expiry. Rolling back its entire transaction would also discard the time observation and allow clock rollback to revive authority. The integration owner therefore records this refinement before source changes: the shared workspace gate acquires the organization lock, isolates domain work in a savepoint, and on failure rolls back all domain writes while retaining only a validated monotonic time observation. Commit that technical time before rethrowing the original failure. No partial approval, audit, source or artifact is committed by this mechanism. Storage/commit failure remains an operational failure, not success. This uses the existing database transaction rather than a second connection, which would deadlock or create an unlocked race.

### Historical date clarification

A known non-inferred enquiry date or last interaction is a recorded historical value even when the operator did not record a separate observation timestamp. Preserve HISTORICAL with the nonblocking AGE_UNKNOWN warning and usable historical extraction; never substitute its capture time for an observation or interpret the date as current intent. Mutable facts and research with no observation remain unusable AGE_UNKNOWN. Other invalid/future/inferred/conflicted states still block extraction. First-source recording-time lookup is bounded to 1000 enquiry revisions and 8 MiB aggregate enquiry JSON per lead, checked in SQL before exact-source predicates; excessive history fails closed instead of choosing a later source.

### Future historical values

A historical event's value is also checked against its immutable first recording time. An offset-bearing last-interaction instant later than recording is FUTURE_DATED and unusable. A date-only enquiry value has no source timezone; reject it as future only when it is later than every possible local recording date (recording instant plus 14 hours, compared as a UTC calendar date). This preserves plausible local dates without inventing a timezone. Keep the original value visible. Waiting or copying the source into a later revision cannot make these assertions usable; an explicit sourced correction is required.
