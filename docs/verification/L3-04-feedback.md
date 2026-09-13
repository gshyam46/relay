# L3-04 feedback backend verification

Status: local synthetic implementation evidence, 2026-09-12. This does not establish customer labels, independent adjudication, native-language quality, provider behavior, PostgreSQL deployment or pilot acceptance.

## Implemented boundary

The owner reviews an exact saved SNAPSHOT, SYNTHESIS, RECOMMENDATION, PLAN or inbound REPLY. The first successful write captures the source once; subsequent RECORD/WITHDRAW commands append immutable review revisions. Lazy reads create no target. Expected revision, exact content token, scoped actor checks and request-key replay protect open drafts and lost responses. Exact retry returns the original accepted revision after later corrections or withdrawal.

Source/profile changes, archive and harmless artifact supersession do not move a historical review to a newer output. Changed saved output content or subordinate snapshot evidence changes its review token. Feedback does not mutate the canonical inbound category, contact restrictions, original evidence, analysis, domain events, tasks, approval or execution state. A broad correctness judgment is independent of the explicit expected reply category; only that category supplies a classification label for evaluation.

Files: src/modules/intelligence-feedback/intelligenceFeedbackContract.js, intelligenceFeedbackRepository.js, feedbackTargetRepository.js, intelligenceFeedbackService.js; test/l304-feedback.test.js. Root owns additive migration0016, API integration and shared specifications. The evaluation owner owns dataset and metric behavior.

## Bounds and privacy

- Snapshot capture preflights complete relevant subordinate rows: at most1000 and1MiB total captured JSON. Scalar and child byte counts are read before source materialization; final JSON size is checked again for escaping overhead. Oversized, incomplete or invalid saved targets are unavailable for new review.
- Each feedback stream permits100 revisions. History defaults20/max50 summaries; no repeated capture or private replay body. Labels are bounded to4KiB, reason2000 characters, request key200.
- Reply replay uses intact canonical text/transcript only, at most32768 UTF-16 units, and the recorded category/method. A summary does not substitute for missing original text. Private loadEvaluationFeedback requires the matching workspace transaction and verifies the captured digest and scoped target identity.
- The private metadataOnly projection exposes source byte size and current label-head metadata without materializing the captured source. A specific historical revision and current latest nomination/status remain distinct.
- Candidate selection returns only latest active nominated reply review summaries, a lead-name projection of at most200 characters and target identifiers; page default20/max50. It exposes no source body, dataset membership or holdout scores.
- SYNTHETIC/PERMISSION_REVIEWED is an explicit owner attestation, not verified consent or independent truth. Other artifact feedback remains operational-only in this slice.

## Automated evidence

Final owned command:

~~~powershell
node scripts/run-tests.js --test-concurrency=1 test/l304-feedback.test.js
~~~

Result: **13 passed,0 failed,0 skipped** on disposable SQLite with inherited database/provider configuration removed. No real model, provider or network request was used.

Behavioral coverage:

- Read-only preview; atomic first target/revision/audit with injected audit rollback.
- Revision correction, withdrawal/restoration, exact original-request replay, conflicting request rejection and history pagination.
- Workspace/actor/lead/typed-artifact ownership; current owner role checked from the database.
- Concurrent expected-revision commands and changed saved-output review rejection.
- Historical supersession, current identity changes and archive without target reassignment.
- All four completed intelligence stages reviewed through their actual service outputs.
- Actual canonical opt-out remains unchanged after an intentionally different evaluation label, together with restrictions, tasks and event count.
- Intact private original reply and category; summary-only input cannot be nominated.
- Scalar byte preflight verified on the actual transaction reader, malformed JSON and1001 subordinate claims rejected before writing.
- Private helper gate, metadata projection and exact historical/latest-head separation.
-100-revision freeze while original replay and history remain available.
- Subordinate snapshot claim mutation changes the review token.
- Stored private-input mutation fails digest validation.

An initial10-case run had one test fixture call the planner's nonexistent runForLead method. It was corrected to the existing planForLead interface; no runtime behavior or acceptance assertion was weakened. Later13-case run is the final owned result. Root owns migration/HTTP/full-suite and browser evidence; do not sum overlapping focused runs.

## Remaining human acceptance

Owners need to confirm that the exact historical result is clear, operational correction versus feedback is understood, broad correctness and expected category are not confused, and required reasons/nomination attestations fit the daily workflow. Customer usefulness, lawful dataset selection, independent labels and real held-out cohort construction remain separate gates. Actual business outcomes remain L4-05.
