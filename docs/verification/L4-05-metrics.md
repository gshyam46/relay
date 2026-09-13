# L4-05 current outcome metrics

Recorded 2026-09-13 before the aggregate implementation. Root approved a bounded correction to the dashboard's legacy Converted/rate presentation. This helper does not mutate lead lifecycle, import history or outcome records.

The trusted internal API is loadOutcomeMetrics(db,{organization_id}) from src/modules/customer-workflow/outcomeMetrics.js. HTTP retains its authenticated workspace check. The helper runs under the workspace gate (or verifies an existing matching gate) and counts only latest business_outcome_revisions joined to current business_outcomes and same-workspace leads with archived_at IS NULL.

Response: {scope:'ACTIVE_ENQUIRIES',recorded_outcomes,withdrawn_outcomes,enquiries_with_recorded_outcome,by_kind:{QUALIFIED_CONVERSATION:{outcomes,enquiries},MEETING_BOOKED:{outcomes,enquiries},QUOTE_REQUESTED:{outcomes,enquiries},WON:{outcomes,enquiries},LOST:{outcomes,enquiries}}}. All keys are present and counts are nonnegative safe integers. At most six aggregate rows are materialized. Missing heads, inconsistent slot/kind state or invalid counters fail closed. No amount, summary, email, source text or history payload is loaded.

One enquiry can have several milestone streams, so milestone counts overlap; summing them does not produce a distinct customer count. WON/LOST use the one current RESULT stream. Correction replaces its current classification; withdrawal removes it from recorded counts; archival removes all its streams from this active-enquiry summary. Historical revisions remain unchanged. Legacy status CONVERTED, sends, delivery and positive classification do not create a reported win. No monetary total, conversion rate or causal/revenue claim is introduced.

Root owns API/UI integration: additive business_outcomes on /api/dashboard/metrics; Reported wins uses by_kind.WON.enquiries and the caption Active enquiries with a recorded won outcome. Legacy converted_count may remain a compatibility field, without a conversion/rate UI claim.

Local focused behavioral verification is recorded below; actual customer outcome attribution and value acceptance remain external.

## Focused verification

`node scripts/run-tests.js --test-concurrency=1 test/l405-outcome-metrics.test.js` passed **5/5**, with zero failures or skips. Fixtures exercise actual owner outcome commands, overlapping milestones, WON-to-LOST correction, withdrawal/restoration, preserved exact large-value history, archive scope, foreign workspace isolation and legacy CONVERTED independence. Missing heads, inconsistent slot/kind state and unsafe counters fail closed. A query assertion verifies the aggregate never materializes amount/source/summary columns; no domain audit/state is added by the read.

The separate existing `scripts/verify-workflows.js` HTTP regression passed **59/59** immediately before this additive helper, on an owned ephemeral loopback E2E fixture with sanitized environment, in-memory SQLite and providers disabled. That earlier run does not certify the new dashboard integration; root owns its later API/UI tests. The fixture was stopped and created no persistent database.

No PostgreSQL execution, live provider call, monetary aggregate, causal attribution or customer-value acceptance is claimed. The counts report the latest owner-recorded active-enquiry facts only.
