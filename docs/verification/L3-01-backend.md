# L3-01 backend verification

Date: 2026-09-12. Scope: deterministic criteria persistence and business-fit snapshot capture under [the recorded contract](../L3-01_BUSINESS_FIT.md). This is local automated evidence, not customer ranking validation or hosted PostgreSQL acceptance.

## Implemented

- Nullable structured criteria share the existing owner profile revision, expected-revision check, audit transaction and history. Omitted criteria preserve the current configuration; explicit null disables; canonical aliases, list ordering and exact scaled decimal equivalents do not create redundant revisions.
- Four bounded fixed criteria slots support approved whole-value aliases, explicit country/locality areas, exact same-currency minimum budget and inclusive absolute target-date windows. At least one REQUIRED slot is necessary. Ambiguous overlapping geography, duplicate positive/negative aliases, unknown keys, unsupported amounts and invalid dates reject.
- Deterministic evaluation separates required fit, preference coverage, uncertainty, readiness and contact permission. Only configured fields affect the assessment. Unrecognized text, different currencies and straddling budget ranges abstain; conflicted, inferred or unusable sources require review. Existing descriptive required/exclusion notes remain explicitly unevaluated.
- Snapshots capture the exact rule, typed source fact/provenance and field freshness in the existing transaction. Criteria changes use profile revision authority; evaluator version enters context fingerprints only for active criteria. Historical null assessments remain null and neutral existing snapshots are reused.
- Stored assessment parsing checks its 128 KiB bound, exact shape, canonical criteria, outcome/aggregate consistency and positive source consistency. Positive evidence binds its observation, assertion and source reference to the recorded fact; observation must be canonical and no later than evaluation, and expiry must equal observation plus the existing 90-day policy. This is internal consistency validation, not a cryptographic signature or independent source verification.
- Deterministic attention comparison uses matching, review, low and unassessed bands, preferred matches within matching, then stable lead ID. It does not use readiness, contact completeness or import recency. Root read projections own the current/outdated authority boundary.

## Files

Backend-owned implementation: business-context/fitCriteriaContract.js, businessContextService.js, businessContextRepository.js; lead-intelligence/businessFit.js, intelligenceService.js, intelligenceRepository.js, businessContextEvidence.js. Migration 0014, API/read projections, recommendation constraints, UI and independent evaluation are owned and verified separately by the integrating/review agents.

The existing business-context behavioral fixture now migrates the full current registry; its explicit historical migration checks remain separate. No production schema feature detection or skipped missing-column behavior was added.

## Automated evidence

Run through the project safe wrapper, which removes inherited database/provider configuration:

~~~text
node scripts/run-tests.js test/business-fit-contract.test.js test/business-fit-transactions.test.js
12 tests: 12 passed, 0 failed, 0 skipped
~~~

Coverage: canonical Unicode/whitespace aliases and exact large decimal strings; malformed/ambiguous criteria and byte limits; geography overlap; stored outcome/source/expiry tampering; no-criteria and descriptive-note limitations; shared revision/history/no-op/omission/disable; owner/tenant/concurrent stale saves; audit failure rollback; deterministic snapshot reuse, changed criteria and expiry; historical source preservation; legacy null compatibility and failed-draft retry; corrupt persisted state; file-backed restart.

An initial focused compatibility run also passed 29/29:

~~~text
node scripts/run-tests.js test/business-context.test.js test/lead-intelligence-freshness.test.js
~~~

That compatibility run preceded the final additional parser source/expiry consistency checks. The final integrated regression is recorded by the root owner and must not be inferred from this earlier count. A first-run file-restart test teardown hit Windows EBUSY because deletion preceded closing the reopened database; teardown ordering was corrected and the complete owned 12-test suite passed. The scoped tracked-file whitespace check passed.

## Remaining acceptance

- Independent frozen business-order fixtures and runtime/API/browser checks are separate artifacts; do not count these 12 implementation tests as customer quality evidence.
- Real owners must confirm their required rules, alias coverage and exclusions, examine missed relevant enquiries, and measure the review burden from unrecognized language. No general semantic matching or conversion probability is claimed.
- Hosted PostgreSQL migration/transaction behavior and operator/provider QA retain their existing explicit gates. No real provider messages, deployment, customer-data mutation or production database operation was performed for this backend slice.
