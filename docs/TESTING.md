# Testing Strategy

## Principle

The product requires two independent forms of validation:

1. Automated engineering verification.
2. Human product verification.

Both are required.

---

# 1. Unit Tests

Use for deterministic business logic.

Examples:

- normalization
- identity resolution
- scoring
- policy
- state transitions
- idempotency
- retry classification
- segmentation rules

---

# 2. Integration Tests

Validate module boundaries.

Examples:

- API → database
- domain → event
- worker → action
- action → handler
- handler → adapter
- webhook → application state

---

# 3. Contract Tests

Validate stable interfaces.

Important contracts include:

- Lead
- LeadCandidate
- IntelligenceSnapshot
- Agent results
- NextBestAction
- Action
- ActionExecution
- webhook payloads
- provider adapters

Provider implementations must satisfy the internal contract.

---

# 4. End-to-End Tests

Validate complete product workflows.

Primary example:

```text
Import Lead
 ↓
Normalize
 ↓
Generate Intelligence
 ↓
Qualify / Score
 ↓
Recommend Next Best Action
 ↓
Approve
 ↓
Execute
 ↓
Receive Event
 ↓
Update Lead Intelligence
 ↓
Determine Next Action
```

---

# 5. Lead Intelligence Evaluation

Lead Intelligence is a core product capability and must be evaluated independently from outbound execution.

Evaluate:

## Enrichment

- accuracy
- completeness
- source reliability

## Research

- factual accuracy
- evidence quality
- relevance
- stale/contradictory information handling

## Signals

- signal correctness
- relevance
- false positives
- false negatives

## Qualification

- qualification accuracy
- consistency
- handling of missing information

## Scoring

- ranking quality
- consistency
- explainability
- sensitivity to important signals

## Segmentation

- correct membership
- boundary cases
- conflicting attributes

## Personalization

- relevance
- factual grounding
- usefulness
- avoidance of invented claims

## Next Best Action

- action relevance
- policy compliance
- contextual appropriateness
- consistency

A successful outbound execution does not prove that the underlying Lead Intelligence was correct.

---

# 6. AI Agent Testing

Every agent should have:

- representative inputs
- expected schema
- edge cases
- incomplete data
- contradictory data
- failure cases
- policy-sensitive cases

Agent outputs must be machine validated.

Do not test only whether an LLM request succeeded.

---

# 7. Failure Testing

Important external operations must test:

- timeout
- network failure
- malformed response
- provider error
- rate limit
- duplicate webhook
- duplicate action
- worker restart
- partial failure
- callback failure

---

# 8. Idempotency Testing

Prove that repeated requests do not produce duplicate side effects.

Examples:

```text
same action submitted twice
same webhook received twice
same provider event received twice
worker retry after timeout
```

Expected behavior must be deterministic.

---

# 9. Outbound Automation Testing

Test:

- action planning
- policy
- approval
- scheduling
- sequence progression
- wait states
- conditions
- stop conditions
- handler execution
- retries
- provider failures
- inbound responses

---

# 10. Human QA

Human QA validates aspects that automated tests cannot reliably judge.

## Lead Intelligence

A human should assess:

- Does the lead summary make sense?
- Is the displayed readiness clearly a data-readiness measure rather than a lead score?
- Are important signals identified?
- Is research useful?
- Are explanations understandable?
- Is personalization actually relevant?
- Does the recommended next action make sense?

## Outbound Automation

A human should assess:

- Is the proposed action appropriate?
- Is the message useful?
- Is the workflow understandable?
- Are approval controls clear?
- Are follow-ups sensible?
- Does the system stop when it should?
- Are failures understandable?

## UX

Verify:

- navigation
- loading states
- errors
- empty states
- approvals
- lead intelligence presentation
- action execution visibility

---

# 11. Real-World Data Testing

Use deliberately messy datasets containing:

- duplicate leads
- missing names
- missing phones
- invalid emails
- inconsistent capitalization
- different phone formats
- incomplete addresses
- mixed-language text
- empty rows
- malformed rows
- conflicting information
- stale information

The system must degrade gracefully.

---

# 12. Regression Testing

When a bug is found:

1. reproduce it
2. create a regression test
3. fix it
4. run relevant tests
5. perform human QA if user-visible

Never repeatedly fix the same bug only through manual intervention.

---

# 13. Milestone Acceptance

Every milestone must define:

### Automated

- unit tests
- integration tests
- contract tests where relevant
- end-to-end tests where relevant
- failure tests where relevant

### Human

- realistic workflow
- UX
- intelligence quality where applicable
- edge cases
- failure/recovery behavior

---

# 14. Definition of Test Complete

A task is test-complete when:

- relevant automated tests exist
- tests pass
- failure behavior is covered where applicable
- contracts are validated
- human QA requirements are documented
- required human QA has passed
- no known regression exists

---

# Current M0 Test Command

Run the current automated suite with:

```powershell
npm.cmd test
```

The suite currently covers the M0 walking skeleton:

- API health and validation behavior.
- Duplicate organization validation.
- Lead creation through the API.
- LeadCreated event processing by the worker.
- Initial Lead Intelligence snapshot generation.
- Next-best-action planning.
- Handler execution through the mock n8n adapter.
- Callback completion.
- Retryable execution failure.
- Non-retryable execution failure.
- Idempotent action planning.
- Duplicate callback handling.
- Tenant isolation for lead list and lead detail.
- Persisted state after application restart.
- Invalid lead input.
- Invalid action input.
- Unit tests for lead and action validation contracts.
- UI state derivation for no organization selected, loading, empty, success, and loading failure.
- Product navigation labels.
- Product-facing lead display labels.
- Overview metrics derived from real lead/action state.

M1 Lead Data Foundation coverage adds:

- CSV flexible headers.
- Quoted CSV fields.
- Empty CSV rows.
- Extra CSV columns preserved as raw data.
- Malformed CSV issue reporting.
- Email trim/lowercase normalization.
- India phone normalization.
- US phone normalization.
- International-only phone validation.
- Invalid phone validation.
- Source normalization.
- Preview creates no leads.
- Raw import values preserved.
- Normalized import values produced.
- Invalid import rows rejected from commit.
- Imported rows accepted without a person name when company + contact exists.
- Existing email duplicate candidates.
- Existing phone duplicate candidates.
- Duplicate candidates within the same CSV.
- Possible name + company duplicate candidates.
- Duplicate candidates are not merged or skipped automatically.
- Valid selected rows become leads.
- Lead provenance is recorded.
- Repeated commit is idempotent.
- Partial commit failure can retry safely.
- Import state survives application restart.
- Organization-scoped import list/detail/commit behavior.
- Imported leads, rows, and issues remain organization scoped.
- Lead search.
- Lead source and status filtering.
- UI state derivation for import history, preview errors, duplicate preview, commit success/failure, and empty search results.

M1.1 UX refinement coverage adds:

- Workspace-facing language for tenant selection states.
- Upload, review, and complete import presentation states.
- Human-readable import state labels.
- Ready to import, needs attention, duplicate warning, selected, and imported counts.
- Invalid preview rows are not selectable.
- Duplicate-warning rows remain selectable.
- Normalized value disclosure state for original vs stored values.
- Human-readable validation issue labels.
- Empty search result presentation.

M2.0 AI Lead Intelligence Foundation coverage adds:

- Deterministic intelligence snapshot creation.
- Explicit separation of lead status, intelligence status, data readiness, recommendation, and outbound state.
- A lead with enough data can be ready for intelligence while still not analyzed.
- Intelligence failure is persisted as a failed state and can be retried safely.
- Snapshot versioning and history preservation.
- Evidence creation and association with lead/snapshot.
- Claim creation with confidence and evidence references.
- Signal creation from current Lead Data Foundation data.
- Company data is represented as customer-provided, not externally identified or verified.
- Qualification foundation creation.
- Conservative next-step recommendation creation without outbound execution coupling.
- Email presence alone does not create a fake contact recommendation.
- Data readiness for leads with email, phone, company, complete contact information, missing contact information, and duplicate warnings.
- CSV import provenance becoming intelligence evidence.
- Human-readable CSV provenance display mapping file and row information.
- Duplicate warnings from import provenance are visible on lead detail.
- Repeated intelligence runs are idempotent for the same lead data version.
- Retry after failed intelligence generation does not create uncontrolled duplicate children.
- New lead data versions create new snapshots.
- Organization A cannot read or trigger organization B intelligence.
- Intelligence API validation for missing/wrong organization.
- UI state derivation for no selected lead, loading, not analyzed, error, available intelligence, needs data, evidence display, recommendation display, readiness labels, duplicate warning display, empty outbound activity, and quoted CSV values.
- Customer Activity and Outbound views do not display M0 mock executions as real outbound activity.

M2.0 deliberately does not test real research, scraping, enrichment APIs, LLM calls, discovery, or outbound provider execution because those capabilities are not implemented in this milestone.

M2.1 Research / Evidence Adapter coverage adds:

- Normalized research evidence contract validation.
- Approved local/manual adapter normalization.
- Unsupported claim fields rejected.
- Invalid source URLs rejected.
- Research evidence ingestion persistence.
- Research evidence item staging.
- Ingestion idempotency.
- Failed ingestion can retry safely.
- Research evidence state survives application restart.
- Organization A cannot read or submit organization B research evidence.
- Research evidence ingestion does not directly mutate intelligence snapshots, claims, signals, recommendations, actions, or outbound execution state.

M2.1 deliberately does not test real web research, scraping, enrichment APIs, LLM calls, discovery, provider credentials, or outbound provider execution because those capabilities are not implemented in this milestone.

M2.2 Structured Synthesis + Qualification coverage adds:

- Structured synthesis output contract validation.
- Evidence-grounding requirements for findings, qualification, and recommendations.
- A small M2.2 synthesis evaluation fixture.
- Local synthesis agent evaluation against ready, research-backed, and incomplete foundation cases.
- Synthesis requires a current ready Lead Intelligence snapshot.
- Synthesis consumes staged approved research evidence without mutating outbound state.
- Repeated synthesis runs are idempotent for the same snapshot and staged evidence.
- Failed synthesis runs can retry safely.
- New staged research evidence creates a new synthesis version and supersedes the prior ready run.
- Organization A cannot read or trigger organization B synthesis.
- Synthesis state survives application restart.

M2.2 deliberately does not test real LLM calls, provider credentials, web research, scraping, search APIs, enrichment APIs, discovery, segmentation, personalization, real next-best-action planning, or outbound provider execution because those capabilities are not implemented in this milestone.

M2.3 Recommendation Intelligence coverage adds:

- Recommendation output contract validation.
- Evidence-grounding requirements for attention priority, segment, personalization context, and recommended next step.
- Recommendation requires a current ready synthesis.
- Ready leads can produce attention priority, segment, personalization context, and a recommended next step.
- Incomplete leads recommend gathering more data and stay low attention.
- Duplicate-warning leads recommend duplicate review instead of outbound preparation.
- Recommendation generation does not create outbound actions.
- Repeated recommendation runs are idempotent for the same synthesis.
- Failed recommendation runs can retry safely.
- New synthesis creates a new recommendation version and supersedes the prior ready run.
- Organization A cannot read or trigger organization B recommendations.
- Recommendation state survives application restart.
- UI state exposes recommendation priority, segment, recommended next step, and personalization labels.

M2.3 deliberately does not test the M3 action planner, policy engine, approval workflow, outbound execution, real provider calls, discovery, or autonomous sending because those capabilities are not implemented in this milestone.

M3 Next Best Action Planning coverage adds:

- Next-best-action output contract validation.
- Planning requires current ready M2.3 recommendation intelligence.
- Ready recommendation intelligence creates a policy-checked plan.
- Incomplete recommendation intelligence creates a gather-more-data plan.
- Duplicate-warning recommendation intelligence creates a duplicate-review plan.
- Opted-out leads produce blocked plans.
- Plans persist policy decision, approval requirement, evidence references, and non-executable execution contract.
- Planning does not create executable outbound actions.
- Repeated planning is idempotent for the same recommendation input.
- Failed planning can retry safely.
- New recommendation intelligence creates a new plan version and preserves history.
- Organization A cannot read or plan organization B next-best-action records.
- Plan state survives application restart.
- UI state exposes not-ready, planned, policy, approval, evidence, and non-executable planning labels.

M3 deliberately does not test outbound execution, approval queues, real provider calls, n8n calls, message sending, sequencing, discovery, or autonomous sending because those capabilities belong to later milestones.

M4 Outbound Automation Foundation coverage adds:

- Next-best-action plans can idempotently create one outbound action.
- Approval-required plans create `AWAITING_APPROVAL` actions and do not execute before M5 approval workflow exists.
- Non-approval actions can execute through the sandbox handler boundary.
- Execution attempts are persisted.
- Repeated execution calls for in-progress actions do not create duplicate attempts.
- Retryable execution failure moves the action to `RETRYING` and can execute successfully on retry.
- Non-retryable execution failure blocks the action.
- Scoped callbacks complete actions and executions.
- Duplicate callbacks do not duplicate side effects.
- Outbound action, execution, and callback state survive restart.
- Organization A cannot prepare, execute, callback, or read organization B outbound activity.
- UI state exposes action type, approval state, execution state, callback count, and error state.

M4 deliberately does not test real outbound providers, production n8n workflows, approval queues, approve/reject/edit workflow, campaigns, sequences, follow-up automation, real message generation, discovery, or autonomous sending because those capabilities belong to later milestones.

M5 Human-in-the-Loop coverage adds:

- Approval-required actions create one pending approval request.
- Approval queue reads are organization scoped.
- Approval detail reads are organization scoped.
- Approving an action moves it to `APPROVED`.
- Repeated approval is idempotent.
- Approved actions can proceed through the existing sandbox execution foundation.
- Edit-and-approve stores reviewer edits without losing action metadata.
- Rejecting an action moves it to `BLOCKED`.
- Rejected actions cannot be approved later in M5.
- Invalid approval input is rejected with a validation error.
- Approval state survives application restart.

M5 deliberately does not test real outbound providers, authentication, user assignment, real message editing, production n8n workflows, campaigns, sequences, bulk sending, or follow-up automation because those capabilities belong to later milestones.

M6/M7 Channel Workflow Foundation coverage adds:

- Outbound sandbox execution records one persisted channel message.
- Completed sandbox email/WhatsApp activity schedules one planned no-response follow-up.
- Duplicate execution callbacks do not create duplicate channel messages or follow-ups.
- Mock inbound events create persisted inbound events and inbound channel messages.
- Duplicate inbound provider event ids are idempotent.
- Question and unknown inbound events create due human-review follow-ups.
- Positive, negative, and opt-out inbound events stop open follow-ups.
- Opt-out inbound events update lead state to `OPTED_OUT`.
- Lead timeline reads combine channel messages and follow-ups.
- Follow-up queue reads are organization scoped.
- Organization A cannot read, write, or complete organization B channel/follow-up records.
- Channel messages, inbound events, and follow-ups survive application restart.
- UI state exposes follow-up queue and lead timeline labels without provider-specific implementation wording.

M6/M7 foundation deliberately does not test campaign sequencing, scheduler loops, conditional branching, real WhatsApp/email/SMS/voice/CRM providers, production n8n workflows, autonomous bots, bulk outbound, AI reply classification, or automatic Lead Intelligence regeneration from inbound events because those capabilities are not implemented yet.

M6 Sequence and Follow-Up Foundation coverage adds:

- Campaigns can be created and listed by organization.
- Sequences can be created with ordered steps.
- Multi-lead enrollment is idempotent by organization, sequence, and lead.
- Due workflow runner processes active and waiting runs.
- Wait steps delay later work until due.
- Approval-required sequence steps create normal approval-gated actions.
- Approved sequence actions continue through the existing sandbox execution boundary.
- Sequence step action creation is idempotent by workflow run and step.
- Inbound positive replies stop open workflow runs.
- Tenant isolation prevents cross-organization sequence enrollment and run visibility.
- Campaign, sequence, step, and workflow run state survives restart.

M6 foundation deliberately does not test a full visual sequence builder, production scheduler service, branch editor, real providers, real n8n workflows, bulk outbound sending, autonomous bots, or AI reply classification because those capabilities are not implemented yet.

## M2.0 Human QA Checklist

1. Create/select workspace.
2. Open Leads.
3. Verify lead status and intelligence status are distinct.
4. Select a lead that has never been analyzed.
5. Confirm it says "Not analyzed yet."
6. Confirm data readiness is separate.
7. Run intelligence.
8. Confirm intelligence becomes available.
9. Verify only customer-provided information is shown.
10. Verify evidence is human-readable.
11. Verify no fake verification claims.
12. Verify duplicate warning consistency.
13. Verify incomplete lead says "Needs more data."
14. Verify email-only lead does not receive fake qualification.
15. Verify no fake outbound activity appears.
16. Verify long lead list scrolls naturally.
17. Verify detail panel fits viewport.
18. Verify mobile layout.
19. Verify quoted CSV company/email display correctly.
20. Refresh.
21. Restart server.
22. Verify persistence.
23. Run duplicate intelligence request.
24. Verify idempotency.

## M2.2 Human QA Checklist

1. Select a lead with generated Lead Intelligence.
2. Run synthesis through the M2.2 API.
3. Verify the summary is understandable and evidence-grounded.
4. Verify findings reference current Lead Intelligence evidence.
5. Add approved local/manual research evidence.
6. Run synthesis again.
7. Verify the new synthesis includes staged evidence.
8. Verify previous synthesis is preserved in history.
9. Repeat the same synthesis request.
10. Verify no duplicate current synthesis run is created.
11. Try wrong-workspace access.
12. Verify it is rejected.
13. Confirm the UI/API does not imply real LLM research or outbound execution.

## M2.3 Human QA Checklist

1. Select a lead with generated Lead Intelligence and synthesis.
2. Run recommendation.
3. Verify attention priority is understandable.
4. Verify segment is understandable.
5. Verify recommended next step is not presented as an executed action.
6. Verify personalization context only uses evidence-backed facts.
7. Verify duplicate-warning leads recommend duplicate review.
8. Verify incomplete leads recommend gathering more data.
9. Repeat recommendation.
10. Verify no duplicate current recommendation run is created.
11. Add approved evidence, rerun synthesis, and rerun recommendation.
12. Verify recommendation history is preserved.
13. Try wrong-workspace access.
14. Verify it is rejected.

## M3 Human QA Checklist

1. Select a lead with generated Lead Intelligence, synthesis, and recommendation intelligence.
2. Open Outbound.
3. Plan next best action.
4. Verify the recommended action is understandable.
5. Verify the rationale explains why the action is recommended.
6. Verify policy decision is visible.
7. Verify approval requirement is visible.
8. Verify evidence reference count is visible.
9. Confirm the UI says planning does not execute outbound work.
10. Repeat planning for the same lead.
11. Verify no duplicate current plan is created.
12. Test a duplicate-warning lead and verify duplicate review is recommended.
13. Test an incomplete lead and verify gathering more data is recommended.
14. Refresh the browser and verify the plan remains visible.
15. Restart the server and verify the plan persists.
16. Try wrong-workspace access through API and verify it is rejected.

## M3.1 Product UX QA Checklist

1. Create or select a clean workspace.
2. Confirm Overview summarizes leads, attention, intelligence, recommendations, and recent activity without listing every lead.
3. Open Leads and verify Import leads remains visible with 10, 50, and 500+ leads.
4. Search by name, company, email, and phone.
5. Filter by source, status, intelligence state, and attention.
6. Select a lead and verify the detail panel explains source, data quality, Lead Intelligence, recommendation, and activity without raw IDs.
7. Refresh Lead Intelligence and verify data completeness is not presented as lead quality.
8. Prepare insights and recommendation without implying external research, web scraping, or LLM use.
9. Open Outbound and confirm it says nothing has been sent.
10. Open Activity and verify it shows customer-facing workspace activity only.
11. Open Developer / Test Controls and verify worker/callback/sandbox controls are isolated from the normal product flow.
12. Restart the server and confirm persisted workspace state remains available.

## M4 Engineering QA Checklist

1. Select a lead with generated Lead Intelligence, synthesis, recommendation, and next-best-action plan.
2. Open Outbound.
3. Use Developer / Test Controls or the scoped API to prepare an outbound action.
4. If the action is waiting for approval, verify it cannot be executed yet.
5. Test a gather-more-data plan and prepare its action.
6. Run sandbox execution through the scoped API.
7. Verify persisted execution state through API/database checks.
8. Trigger a scoped callback through the API or Developer / Test Controls.
9. Verify the action and execution become completed.
10. Repeat the callback.
11. Verify no duplicate callback side effect appears.
12. Test retryable execution failure.
13. Verify retry succeeds on the next execution.
14. Test non-retryable execution failure.
15. Verify the action becomes blocked with an understandable error.
16. Refresh browser and verify normal customer Activity does not present sandbox execution as real customer outreach.
17. Restart server and verify outbound state persists.

## M5 Human Approval QA Checklist

1. Select a lead with generated Lead Intelligence, synthesis, recommendation, and next-best-action plan.
2. Open Outbound.
3. Prepare the recommended step for human review.
4. Verify the pending approval state is clear.
5. Approve the recommended step.
6. Verify the action becomes approved.
7. Prepare another approval-required action.
8. Add a reviewer edit and approve it.
9. Verify reviewer edits remain visible after refresh.
10. Prepare another approval-required action.
11. Reject it.
12. Verify the rejected action is blocked.
13. Restart the server and verify approval state persists.
14. Try wrong-workspace approval access through the API and verify it is rejected.

## M6/M7 Channel Workflow Foundation QA Checklist

1. Select a lead with contact data.
2. Prepare and approve a recommended outbound step.
3. Use Developer / Test Controls to run sandbox execution.
4. Open the lead detail and confirm communication activity appears.
5. Simulate callback.
6. Confirm the outbound activity shows completed.
7. Confirm a follow-up is planned.
8. Simulate an inbound question.
9. Confirm a due follow-up appears.
10. Simulate a positive reply.
11. Confirm open follow-ups are stopped.
12. Simulate an opt-out on another lead.
13. Confirm lead status becomes opted out.
14. Refresh the browser and verify timeline/follow-up state remains visible.
15. Restart the server and verify persisted timeline/follow-up state remains visible.
16. Confirm normal UI uses customer-facing words and Developer / Test Controls contain the mock simulation tools.

## M6 Sequence Foundation QA Checklist

1. Select a workspace and lead.
2. Open Outbound.
3. Create a follow-up sequence.
4. Enroll the selected lead.
5. Confirm the lead shows an active follow-up workflow.
6. Open Developer / Test Controls.
7. Run due workflows.
8. Confirm an approval-required sequence step appears for review.
9. Approve the step.
10. Run due workflows again.
11. Confirm communication activity appears.
12. Simulate a callback.
13. Confirm a follow-up is planned.
14. Simulate a positive reply.
15. Confirm the workflow is stopped.
16. Refresh browser and verify workflow/timeline state remains visible.
17. Restart server and verify workflow/timeline state persists.

The current CI-equivalent command is:

```powershell
npm.cmd run ci
```

That command runs lint, format check, and the automated test suite.

Local API smoke checks must not use the normal development database. Use:

```powershell
npm.cmd run smoke
```

The smoke script creates a temporary SQLite database, verifies health, CSV preview, import commit, not-run intelligence state, and explicit intelligence generation, then removes the temporary database.

If manual smoke testing pollutes `data/app.db`, use the safe local reset command after stopping the server:

```powershell
npm.cmd run dev:reset
```

The reset command backs up the existing local database under `data/backups/` before creating a clean development database. It is a development-only mechanism and is not exposed in the product UI.

For M2.0 visual human QA, seed deliberate QA data after resetting:

```powershell
npm.cmd run dev:seed:qa
```

The seed creates an explicit `M2 QA Workspace` with not-run, generated, needs-more-data, duplicate-warning, quoted CSV, and long-list examples. It refuses to run against a non-empty database by default.
