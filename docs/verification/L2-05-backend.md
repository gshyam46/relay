# L2-05 backend verification

Recorded: 2026-09-12. Product: **AI Lead Intelligence & Outbound Automation**.

This records the assigned backend slice under [the accepted freshness contract](../L2-05_FRESHNESS.md) and ADR-017. Evidence uses disposable SQLite, including a file-backed restart. PostgreSQL, operator and customer acceptance remain separate.

## Implemented

- Deterministic policy version 1 assesses ongoing interest, location, budget, timeline and research against their observation timestamp. Exactly 90 days after observation, the source becomes stale. This is a provisional engineering policy requiring pilot validation, not business-fit scoring.
- Value state, assertion, temporal state and usability remain separate. Unknown, inferred, conflicted, stale, invalid and future-at-recording sources remain visible and cannot become selected factual claims by refreshing. Distinct usable research/enquiry values produce a conflict without choosing a winner.
- Known historical enquiry dates and last interactions do not expire merely because they are old. Missing observation metadata remains null and exposes a nonblocking AGE_UNKNOWN warning; it never becomes evidence of ongoing intent. Future historical event instants are unusable. Date-only events allow every plausible local recording date through UTC+14 before classifying a value as future.
- Original recording time comes from the first exact matching assertion/provenance in same-workspace enquiry history, including conflicting alternatives. Copying a source into a later full snapshot cannot make an originally future assertion valid. Source history is neither rewritten nor re-dated.
- Authoritative reads and refresh use a durable per-workspace maximum observed time under the existing workspace gate. Clock rollback and restart cannot make a previously expired source current. Root's shared savepoint gate retains only the validated clock observation after ordinary domain rejection and rolls back domain effects. Actual database/commit failure remains an operational failure; the scoped database clients retain their whole-transaction failure protections.
- Snapshot fingerprints bind policy, current profile/enquiry/contact revisions, research/reply source authority and discrete assessment states. Evaluated time is excluded, so an unchanged refresh reuses the existing snapshot and audit. Expiry or changed evidence creates a new version only when explicitly refreshed.
- Full profile_revision remains criteria authority. Identical normalized profile saves remain no-ops. Neutral identity-only revision-0 history keeps its original fingerprint and creates no technical clock; affected legacy artifacts require refresh without a mass backfill or historical rewrite.
- Intelligence reads distinguish NEVER_ANALYSED, CURRENT, OUTDATED and ARCHIVED, with evaluated/current revisions, bounded changed-input reasons, assessment/analysis times and the next actual transition. Current analysis may still explain uncertain data; it does not certify relevance or contact eligibility.
- Snapshot details expose their persisted freshness assessment. The parser checks supported shape/version, bounded UTF-8 size, separate axes, neutral-state invariants and the stored authority digest. Corrupt metadata or technical time fails closed.
- Research timestamp inputs require real explicit-offset instants and normalize to UTC. Explicit numeric/object/invalid dates reject rather than becoming unknown. Historical malformed timestamps remain visible as unusable evidence. Research source history remains independent of analysis history.

## Bounds and persistence

Migration 0013_intelligence_freshness adds nullable intelligence_snapshots.freshness_json limited to 262144 UTF-8 bytes and a workspace_freshness_clocks primary key scoped to the organization. Existing snapshots keep null metadata and their original fingerprints. No older migration is changed.

Before research materialization, SQL checks at most 100 records and 524288 aggregate bytes of the projected source fields; text fields also have explicit limits. Projection includes scoped ingestion state, so partial or failed ingestion children cannot become usable facts. Excess produces FRESHNESS_INPUT_LIMIT / 409 rather than silently selecting the first records.

New ingestion preflights at most 100 incoming records and 512 KiB raw JSON before writes. Combined retained records plus normalized new input must remain below 100 and a conservative 512 KiB serialized bound including 1024 bytes per incoming item for future stored identifiers/ownership. This prevents new accepted input from creating an unsupported evidence set. Existing completed idempotent ingestion remains reusable.

First-source lookup checks at most 1000 same-lead enquiry revisions and 8388608 aggregate JSON bytes in SQL before exact JSON predicates. This metadata preflight runs once per evaluator, not once per fact. More history returns an explicit operational-review error; no later source is substituted. These are admission bounds, not measured production latency or capacity claims.

## Files and ownership

New owned modules under src/modules/lead-intelligence: freshnessContract.js, freshnessRepository.js and freshnessService.js. Changes also affect intelligenceService.js, intelligenceRepository.js, businessContextEvidence.js, researchProviderContract.js, researchEvidenceRepository.js and the necessary pre-persistence guards in researchEvidenceService.js. Migration: src/database/migrations/0013_intelligence_freshness.js.

Owned tests: test/lead-intelligence-freshness.test.js and test/lead-intelligence-freshness-migrations.test.js. Root explicitly authorized the narrow test/research-evidence.test.js expectation update: a new research source invalidates current analysis while the exact prior snapshot stays in history. Its source-persistence assertions remain intact.

Root owns the shared workspace gate, API composition/comparison, registry and integrated documentation. The runtime reviewer owns synthesis/grounding, actual-input generation guards, prepared authority, workflows and late-callback protections. UI owns currentness presentation and browser verification. Those checks are recorded separately by the integrating owner.

## Automated evidence

Command:

    node scripts/run-tests.js test/lead-intelligence-freshness.test.js test/lead-intelligence-freshness-migrations.test.js test/research-evidence.test.js

Result: **30 tests, 27 passed, 3 explicit PostgreSQL skips, zero failures.** This comprises 17 new freshness behavior checks, 6 new migration checks (3 passed, 3 skipped) and 7 preserved research checks. The safe launcher removed inherited database/provider configuration. An earlier targeted foundation smoke also passed its existing 13 checks after integration; it is not added to this final focused count.

Behavior established:

- Exact expiry-minus-one-millisecond and expiry boundaries; old dates, unknown dates, invalid dates and future-at-recording observations.
- Currentness changes from current to outdated without creating analysis during GET. Clock rollback remains stale. Explicit refresh creates one new snapshot, and repeats reuse it without another analysis audit.
- Historical facts, unknown/inferred values and conflicting alternatives retain their separate semantics and correct extraction behavior. Missing historical observation time is visible without suppressing truthful recorded dates.
- Copied unchanged future assertions remain unusable. Future historical instants and impossible future dates remain unusable after waiting; plausible next-day local dates remain historical.
- Criteria changes invalidate prior analysis; identical criteria saves preserve revision and reused analysis.
- New research invalidates old analysis; distinct current enquiry/research values conflict without a winner. Invalid historical evidence remains visible and unusable.
- A domain command that observes expiry then throws leaves its lead mutation rolled back, retains only technical time and leaves another workspace untouched.
- Corrupt assessment/digest/clock refuses current authority without creating replacement evidence.
- Research byte/count preflight rejects before full source reads. The supported 100-record boundary succeeds; record 101 is refused. New oversized or excessive ingestion leaves no new ingestion/evidence rows, and an additional source cannot push an accepted 100-record set over the limit.
- Source history refuses 1001 revisions and separately refuses more than 8 MiB while below the revision count cap.
- Neutral revision-0 snapshot compatibility remains intact after removing assessment metadata to reproduce historical rows; reads and repeated refresh create neither a clock nor another snapshot.
- A file-backed process restart with a backward clock cannot revive the expired snapshot. Refresh creates one replacement and repeated refresh preserves that result.
- Populated migration preserves original snapshot fields/fingerprints and contact source/status; no clock is fabricated. UTF-8 byte, foreign-key and uniqueness constraints enforce the additive schema. Interrupted DDL and failed migration-marker insertion roll back together.
- PostgreSQL upgrade, bounds and independent-connection rejected-command/high-water tests are defined but explicitly skipped without an authorized disposable target.

## Remaining acceptance

Root integrates full HTTP, runtime safety, browser/workflow and regression results. Actual PostgreSQL JSON lookup/concurrency, populated upgrade/restore and deployment clock behavior remain external acceptance. Operators must validate that expiry, historical dates, correction versus refresh and changed-input explanations make sense for their workflow. The 90-day policy needs customer/sales-cycle evidence; business relevance/scoring remains L3. No provider call, deployment, customer-data migration or live send occurred in these checks.
