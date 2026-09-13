# Product and System Review

Review baseline: 2026-09-11. Product: **AI Lead Intelligence & Outbound Automation**.

## Assessment and evidence boundary

The product direction and modular monolith are appropriate. The current implementation is a substantial internal/sandbox foundation, with provider adapters and PostgreSQL support, but it is not approved for unrestricted customer use.

The essential product gap is business-relevant intelligence followed by a complete operator workflow. Name/contact completeness cannot establish buying need, fit, timing, or business value.

Evidence below separates:

- **Reproduced**: executed against isolated in-memory workspaces or synthetic adapters in the earlier review in this conversation.
- **Source-confirmed**: re-read in this planning pass; a code-path gap or missing capability, not a demonstrated production incident.
- **Unverified externally**: accounts, deployment state, real provider behavior, customer demand, and operational evidence not checked live.

The tables below preserve the original review observations. The subsequent authorized Batch A implements corrections described in [current batch evidence](verification/BATCH_A.md); no production actions occurred. Historical observations are not statements that every defect remains present.

## Correction status after Batch A

- R01: legacy and action callback routes now require authenticated action ownership; regression fixtures preserve foreign state. HTTP worker execution is scoped and all simulation controls are disabled in staging/production. Approval actor spoofing and a callback event-ID collision disclosure were also corrected.
- R10: session identity/stable actor metadata were corrected in Batch A. L1-03 now commits approval/content/status/audit together with action locking and prevents non-reviewable actions from being reactivated. L1-08 now binds immutable recipient/sender/content revisions; PostgreSQL/human acceptance remains pending.
- R26/R27: safe test launchers and run-owned cleanup are implemented. The standalone verifier also checks its isolated target before any write. Real PostgreSQL concurrency/abort demonstration remains pending.
- R06/R17/R22: bounded grounding, neutral copy and fallback provenance are covered by L1-09 evidence; arbitrary semantic truth, business fit, old persisted drafts and L3 evaluation remain outside this slice.
- Other execution, contact restriction, product workflow and operations findings remain open. Human/customer launch gates are not closed by the local automated suite.

## Subsequent L1-04/L1-08 correction status

R02/R09/R33 now have durable restriction writes and dispatch checks; ordinary replies/delivery no longer grant contact eligibility. General restrictions cover direct canonical duplicates; authenticated provider restrictions use their actual recipient. R10/R34 now have immutable reviewed envelopes and captured adapter inputs. R05's unsafe normal manual placeholder SEND is disabled pending the full composer. R04's concurrent dispatch window is closed locally by pre-provider STARTED/EXECUTING ownership.

R12 queued cancellation is covered for contact restrictions; full scheduling and new-message composition remain open. The later L1-05 slice below addresses action due times, bounded recovery and exact attempt correlation. SendGrid raw signature checks and failed-save retries have synthetic regressions; this is not live channel certification. [Integrated evidence](verification/L1-04-L1-08.md) records limits and outstanding PostgreSQL/human checks.

## Subsequent L1-05 correction status

R03 now has central and worker action due checks. R04 has fenced leases, immutable intent and frozen retry budgets/deadlines, with uncertain outcomes held for evidence. R08 now correlates callbacks to an exact execution/revision and preserves newer or terminal outcomes. R07 core receipt/attempt/action/event/audit changes are atomic; the later L1-07 slice below adds automatic repair of unfinished ancillary message/follow-up effects. R25 now stops admission and drains HTTP/worker/executor operations before database close, with a bounded failure exit.

Independent review also found and corrected missing conversation reconstruction after uncertain delivery and resolved recovery cases crowding pending work out of the queue. [Integrated evidence](verification/L1-05.md) records regressions and external limits. The subsequent L1-06 slice above addresses bounded event retry/fairness and workflow scheduling; the full composer/business-hours workflow remains open. These are local corrections, not PostgreSQL/live provider or customer acceptance.

## Subsequent L1-06 correction status

R11 now has immutable managed event input, durable attempts/deadlines, retry timing, fenced claims, per-stage commits and owner recovery. Historical events remain held instead of automatically replaying old effects. R12 now has bounded fair scheduling in the normal server, delivery-gated sequence advancement and owner schedule/pause/resume/stop controls. Pause, stop, inactive parents, invalid linkage and all canonical replies are checked against queued workflow sends. A question/uncertain reply preserves the human response task while stopping the old sequence.

Independent review reproduced and fixed lease expiry while waiting to persist a failure, inherited object keys being treated as handlers, duplicate-contact restrictions being overlooked during planning, and reply stops being incomplete after preparation failure. Invalid follow-up schedules now become visible review work; manual terminal transitions cannot erase that state without the permitted cancellation decision. [Integrated evidence](verification/L1-06.md) records local regressions and a normal-server restart demonstration. Real PostgreSQL/process/restore, provider/browser acceptance, quiet hours, full task/composer UX and operational acceptance remain open. The subsequent L1-10 correction section records local operational controls.

## Subsequent L1-07 correction status

R07 now has a durable inbox distinct from callback/inbound projections. Leased, bounded processing recovers original content and incomplete effects after rollback or restart, with one canonical message/task/event result. R08 preserves exact attempt identity during replay, including delivery preceding a later reply. Unmatched and conflicting input is retained for owner review. Receipt acknowledgement requires persistence; processing failures retry locally.

Independent review corrected acknowledged-but-unapplied contact policy, changed-content opt-outs, stale processor failures, duplicate Parse identity fields, and opt-out intelligence refresh. Pending policy now pauses workspace dispatch without consuming attempts; conflicts run policy-only handling. No review decision waives unfinished restrictions, edits original input or issues a provider send. Permanently invalid/foreign policy evidence still needs operator remediation. [Integrated evidence](verification/L1-07.md) records these bounds; the subsequent L1-06 corrections above address bounded domain-event retry and normal scheduling. PostgreSQL/provider and human acceptance remain open.

## Subsequent L1-03 correction status

R28 now has inspection-only status/readiness/deployment verification, startup refusal without a compatible existing schema, and separate migration credentials/command. R29 has an unchanged baseline plus a numbered forward repair, locked history checks and local populated/interrupted/concurrent migration regressions. Unsafe unknown legacy authorization is refused or quarantined. See [L1-03 evidence](verification/L1-03.md); actual PostgreSQL/restricted-role and restored-release rehearsals are pending. R30 import atomicity is not implemented by adopting units of work in approvals.

The landing-page gap is now explicit in [LANDING_PAGE](LANDING_PAGE.md) and L4-07/L5-07. This planning addition does not claim public routing, a marketing UI or a working commercial funnel exists yet.

## Subsequent L1-10 correction status

R24 now uses a shared strict database connection policy: verified TLS and hostname, bounded timeouts, refused deployed plaintext and refused URL/ambient driver overrides. Configuration rejects unknown environments and malformed values. Runtime requires an explicit deployed origin and independent auth-admission secret. HTTP bodies, auth hashing/admission and provider response reading now have enforced bounds, and routine logs omit private payloads, exception text and webhook routing tokens.

Owner Sending controls now persist workspace pause, daily SEND authorization limits and unresolved dispatch capacity. Deployed sending defaults off. All sending entry points share transactional admission; pause/resume and UTC rollover never reset an action's original retry budget. Known provider acceptance survives a malformed, oversized or stalled response body without authorizing a resend.

Independent review reproduced and fixed a UTC-midnight quota mismatch, premature HTTP admission release after disconnect, shutdown closing the database beneath disconnected handler work, unsupported static mutations leaving unread input, a missing bounded reader on the local test-only worker route, and logger camelCase/coercion gaps. [Integrated evidence](verification/L1-10.md) records passing local regressions. These changes extend R25 graceful-drain correctness; they do not establish measured production capacity.

PostgreSQL/role/restore, deployed proxy and credential rotation, browser/operator/provider acceptance, monetary budgets/alerts, account recovery and the useful customer workflow remain open. The next product investment is L2-01 business context and typed enquiry evidence, followed by import usability and intelligence quality. The modern landing page remains planned in L4-07/L5-07; it is not a completed marketing surface.

## Subsequent L2-01 correction status

The missing business/enquiry-data foundation now has a bounded local implementation: owner Business profile, six typed enquiry facts, manual source/assertion/time metadata, exact/range monetary strings, explicit unknown and conflicting alternatives, and append-only revision history. These records remain independent of contact permission.

Persisted context revisions now make old snapshots/recommendations/plans unavailable as current. Direct model completion rechecks revisions under the workspace gate; an old result cannot supersede a newer-context run. Old plan IDs cannot create actions from stale intelligence, and changed business/enquiry context requires renewed exact message review before dispatch. No bulk history rewrite or automatic model job is introduced.

[Integrated evidence](verification/L2-01.md) records local API/race/migration/browser checks and their limits. Captured criteria do not yet produce business-fit scoring or prove recommendation value. CSV mapping/resumable commit, repeated-enquiry/shared-contact resolution, contact correction, full composer/inbox/outcomes and target-customer acceptance remain open. The next implementation contract is L2-02 reviewed import.

## Verified baseline from the preceding review

| Check | Observed result | Limits |
| --- | --- | --- |
| Existing local CI-equivalent suite | 219 tests: 215 pass, 4 PostgreSQL-only skipped | Not a fresh PostgreSQL run; passing contracts do not prove missing invariants |
| Existing HTTP workflow verifier | 55/55 against an isolated in-memory server with sandbox providers | No real provider send or browser interaction |
| API smoke | Passed using isolated temporary database | Happy path plus existing smoke assertions |
| Frontend | TypeScript and Vite build passed when invoked directly | Windows npm shim failed on ampersand-containing path; browser human QA not performed in this review |
| Source tree | No source/contract changes during review | Local dependency installation/build artifacts were used for verification |

Earlier recorded PostgreSQL and browser results are preserved in [milestone history](history/MILESTONES.md). They are historical evidence, not current live-environment certification.

## Execution and trust findings

| ID | Severity / evidence | Observation and customer consequence | Primary source | Planned resolution |
| --- | --- | --- | --- | --- |
| R01 | Critical / reproduced | An authenticated user knowing another workspace's action ID can mark it completed through the legacy mock callback route | src/api/app.js, POST /api/callbacks/mock | L1-02 |
| R02 | Critical / reproduced | A queued action still executes after opt-out; a later delivery callback resets the lead to ACTIVE | actionExecutor.js; callbacksService.js | L1-04, L1-07 |
| R03 | High / reproduced | A future scheduled_at action is selected and dispatched immediately | actionsRepository.js, nextExecutable | L1-06 |
| R04 | Critical / synthetic concurrency repro | Two simultaneous executions of one action invoke the adapter twice; intent/ownership is not persisted before network work | actionExecutor.js, execute | L1-05 |
| R05 | High / reproduced and source-confirmed | Manual Message queues placeholder copy without review; repeating the same channel returns the same action instead of a distinct communication | actionsService.js, createManualAction; client lead-detail.tsx | L1-08, L4-02 |
| R06 | High / synthetic model repro | Invented budget assertion passes schema validation and is assigned a name-only evidence reference | llmSynthesisAgent.js; synthesisContract.js | L1-09, L3-02 |
| R07 | High / source-confirmed | Callback receipt precedes side effects, but duplicate receipt exits early; a crash can permanently skip unfinished processing | callbacksService.js | L1-07 |
| R08 | High / source-confirmed | Callback selects latest attempt by action ID instead of unambiguously correlating provider message/attempt; late events can affect newer work | callbacksService.js; executionsRepository.js | L1-05, L1-07 |
| R09 | Critical / source-confirmed | SendGrid unsubscribe events are tracking-only; complaint events fail an action without adding durable contact suppression | src/api/app.js, applySendgridEvent | L1-04, L4-01 |
| R10 | High / source-confirmed | Approval changes payload, approval row, action state, and audit in separate writes; reviewer identity is supplied text and approval is not tied to immutable send content | approvalsService.js | L1-03, L1-08 |
| R11 | High / source-confirmed | Events marked FAILED are not selected again by nextPending; retry intent in comments is not an implemented recovery mechanism | eventsRepository.js; worker.js | L1-05, L1-06 |
| R12 | High / source-confirmed | Normal server tick does not call the workflow due runner; stopping a run is not sufficient to cancel already-created standalone actions | src/server.js; workflowsService.js | L1-04, L1-06 |

Reproductions did not send to real recipients. Critical findings block customer traffic even when the baseline automated suite is green.

## Data, intelligence, and customer workflow findings

| ID | Evidence | Gap and required product behavior | Phase |
| --- | --- | --- | --- |
| R13 | Source-confirmed | CSV maps name/email/phone/company only. Preserve and normalize actual enquiry interest, budget, geography, timing, source dates, language, and contact-permission provenance | L2 |
| R14 | Source-confirmed | React calls preview and immediately commits valid rows; no meaningful review/mapping/correction. Phone region is fixed to INTERNATIONAL_ONLY | L2 |
| R15 | Source-confirmed | Duplicate candidates are flagged without a resolution workflow. Re-imported contacts can retain separate restrictions and unrelated enquiries can be confused | L1/L2 |
| R16 | Source-confirmed | Saved industry/timezone do not provide an offering, fit criteria, operational promises, or a business qualification model to the intelligence pipeline | L2/L3 |
| R17 | Source-confirmed | Generic composition assumes 'your enquiry' and sometimes 'on behalf of' from source/company fields, and promises contact/booking behavior not proven by policy | L1-09/L4 |
| R18 | Source-confirmed | Conversations displays messages without a reply composer; every latest inbound can become Needs reply, including opt-outs. Assignment/resolution/handoff must be explicit | L4 |
| R19 | Source-confirmed | Schedule follow-up creates a generic human action, takes no due date, and does not create a normal scheduled follow-up task | L4 |
| R20 | Source-confirmed | Converted is displayed as a metric, but the ordinary customer journey has no complete outcome-recording and attribution workflow | L4/L6 |
| R21 | Source-confirmed | Several UI tests inspect the retired public frontend. Passing them does not protect the shipped React import, composer, or inbox | L1/L4/L5 |
| R22 | Source-confirmed | LLM configuration is process-wide; fallback provenance, model/prompt versioning, timeout, budgets, and evaluation need explicit contracts | L1/L3 |
| R23 | Unverified externally | First buyer, urgent job, preferred channel, willingness to pay, baseline response rate, and serving cost are not established by repository activity | L1 discovery/L6 |

An imported record is not evidence of an enquiry, consent, buying intent, or a previous conversation. A delivery is not a conversion. An evidence ID is not proof that generated text is supported.

## Operational and tooling findings added during re-review

| ID | Evidence | Observation | Required treatment |
| --- | --- | --- | --- |
| R24 | Source-confirmed | PostgreSQL TLS sets rejectUnauthorized:false; production configuration also permits disabling TLS | L1-10: verify server identity and fail unsafe production configuration |
| R25 | Source-confirmed | Shutdown clears the timer but does not await an active worker before closing the database | L1-05: drain or recover owned attempts safely |
| R26 | Source-confirmed | dev:e2e sets DATABASE_FILE but leaves inherited DATABASE_URL and provider configuration in place; database URL wins | L1-01: explicit disposable target and providers; fail ambiguous environment |
| R27 | Source-confirmed | test:pg falls back to DATABASE_URL; cleanup removes every matching test-schema prefix, including another concurrent run's schemas | L1-01: explicit disposable TEST_DATABASE_URL and run-owned cleanup |
| R28 | Source-confirmed | verify:deploy applies migrations. db:status/readiness can CREATE the migration table. Normal server boot migrates automatically | L1-03/L5: distinguish inspection and mutation; separate runtime/migration roles and serialize migrations |
| R29 | Source-confirmed risk | Only baseline migration is registered. Editing an already-recorded baseline cannot upgrade a deployed database | L1-03: immutable new migrations and previous-schema upgrade fixtures; do not claim an observed deployed schema failure |
| R30 | Source-confirmed | Import creates lead, row linkage, and event in separate writes; crash can duplicate a row or lose its event; COMMITTING can remain stuck | L1-03/L2-02: transactional row commit and resumable job ownership |
| R31 | Source-confirmed | pg NUMERIC/BIGINT values are globally coerced to Number | L2/L4: explicit money/currency representation; avoid silently losing future monetary precision |
| R32 | Documented, remote unverified | Backup restore, retention, rate limits, cost controls, security audit, and real-channel QA are incomplete or unsupported by current evidence | L1 preparation/L5 gate |
| R33 | Source-confirmed | An ordinary later inbound reply also resets lead status to ACTIVE and can erase an earlier opt-out | L1-04: permission cannot be changed by ordinary reply classification |
| R34 | Source-confirmed | Router resolves current recipient and sender configuration after approval; unknown action types fall through to success | L1-08/L4-01: immutable approved envelope and fail-closed capabilities |

This is a bounded engineering/product review, not a completed penetration test, legal assessment, or capacity benchmark.

## Business and founder decisions to make

- Select an accessible customer cohort and one expensive, frequent problem. Validate one workflow before offering every vertical.
- Identify the buyer, daily operator, approval owner, and support owner; they may be different people.
- Establish whether the channel and data needed for the workflow are accessible and permitted.
- Agree what counts as value before the pilot: time saved, qualified conversations, meetings/quotes, and sustained weekly usage with explicit denominators.
- Track AI/provider spend, storage, manual review, onboarding and support time; a busy dashboard is not proof of sustainable economics.
- Decide paid-pilot terms and usage ceilings before real spending. Automated billing can wait; cost accountability cannot.
- Keep customer restrictions, outcome facts, and intelligence auditable when people leave, contacts duplicate, data changes, or an account is deleted.

See [PILOT](PILOT.md) for discovery and measurement; [ROADMAP](ROADMAP.md) and [TASKS](TASKS.md) for delivery.

## Release interpretation

- Internal sandbox: useful for engineering demonstrations with synthetic data and no external side effects.
- Supervised customer pilot: only after L1-L5 gates, with a defined cohort, operating owner, supported channel, cost limits, and incident handling.
- Public launch: a dated L6 decision based on pilot evidence, support capacity, and continuing technical gates.

No checkbox or successful unit test changes the release classification by itself.

## L2-02 reviewed import correction, 2026-09-12

The current continuation addresses the inspected import gaps: React automatically committed valid rows, duplicate CSV headers overwrote cells, malformed phone text could become a valid number, and lead/row/event writes had independent crash windows. The [recorded contract](L2-02_REVIEWED_IMPORT.md) now governs explicit mapping/review/correction, positional source preservation, bounded selected-row transactions, durable resume and import-linked enquiry facts. [Integrated evidence](verification/L2-02.md) distinguishes local verification from operator and PostgreSQL acceptance.

Duplicate contacts are deliberately visible holds until L2-03; this slice does not implement merging, repeated-enquiry identity, source authenticity, consent, business-fit ranking or a complete customer loop. The remaining product/launch findings retain their existing owners and gates.

## L2-03 reviewed identity correction, 2026-09-12

Implementation follows the [recorded contract](L2-03_IDENTITY_RESOLUTION.md) and ADR-015. Initial duplicate rows and late holds gain an explicit source-only link or separate enquiry decision, preserving original source, context, restrictions and import outcomes. Independent review identified a related gap: ordinary ambiguous replies previously left matching sequences active. This slice adds an atomic receipt-scoped stop and delayed callback guard, retaining unassigned recovery rather than guessing a lead.

[Integrated verification](verification/L2-03.md) records results as they become available. This is a bounded identity/source workflow, not destructive merge, general contact correction, provider-thread assignment or customer validation. Complete data work, fit scoring, full composer/inbox/outcomes, actual PostgreSQL/provider proof and pilot value remain open.

## L2-04 data-management continuation, 2026-09-12

The [recorded contract](L2-04_DATA_MANAGEMENT.md) and ADR-016 address contact correction, immutable provenance, archive/restore and selected useful export. Inspection also found that simply changing visible values would permit edit-back to reuse old analysis or approvals, and that hiding archived records could accidentally create another lead for a real inbound reply. Revision-bound runtime guards, retained identity matching and transactional stopped-work effects are included in this slice.

CSV quoting alone does not address spreadsheet formulas or long-number coercion. Display cells use a visible text label when needed and exact underlying facts remain in JSON object columns. The customer must see export selection and archive consequences. [Integrated verification](verification/L2-04.md) remains the evidence register for this work; broader business-fit quality, freshness policies, complete inbox/composition/outcomes and target-operator value remain open.

## L2-05 freshness/currentness continuation, 2026-09-12

Inspection found no elapsed-age policy, undated facts entering factual extraction, stale analysis appearing never-run, and direct model finalisation checking revisions without full parent/source authority. The [contract](L2-05_FRESHNESS.md) and ADR-017 add discrete freshness/source binding, preserved historical values, explicit currentness and bounded recommendation comparison. Review also caught expiry observations lost on rejected transactions, differing assessment times inside one composed response, and a React crash on metadata-only source-review evidence. Each has a focused regression or browser reproduction.

[Integrated verification](verification/L2-05.md), [backend evidence](verification/L2-05-backend.md) and [runtime evidence](verification/L2-05-runtime.md) record actual local checks. The default90-day policy remains provisional; live PostgreSQL, operator interpretation, provider recovery, business-fit usefulness and the complete customer loop remain launch gates.

## L3-01 fit/ranking continuation, 2026-09-12

Source review confirmed the old priority score uses data completeness and source review; it does not measure business fit. [The contract](L3-01_BUSINESS_FIT.md) records explicit typed criteria and independent priority, and preserves descriptive requirements as unassessed. Independent fixtures were frozen before the evaluator, including negative/unknown cases. Integration review found the prepared-context evaluator-version gap and closed it only after criteria adoption, preserving neutral reviews and delivery facts.

The queue previously materialized every lead. The new returned-page scope is bounded 100 with explicit navigation and metadata; this is not global ranking at scale. Root HTTP inspection also confirmed POST /api/leads still requires an email or phone. The evaluator itself can handle missing contact, but contact-free manual lead capture is an unfinished product journey and must be resolved in data/onboarding work before claiming that end-to-end capability. Exact-alias review burden, customer-labeled ranking, full inbox/replies/outcomes, portable browser CI and live PostgreSQL/provider acceptance remain open. [Integrated evidence](verification/L3-01.md) distinguishes local implementation from these gates.

## L3-02 factuality and reply continuation, 2026-09-12

Read-only probes reproduced false contact restrictions from negated stop requests and quoted footers, missed direct stops, negative/uncertain wording becoming positive and normal multiline replies rejected by a single-fact guard. Accepted model evidence was discarded; React hid uncertain opt-outs behind review copy. [The contract](L3-02_INTELLIGENCE_QUALITY.md) and ADR-019 record the correction before implementation.

The independent synthetic corpus was frozen before classifier edits. It exposed three further errors in uncertain/mixed sentiment and transliterated contact wording; runtime fixes retained the frozen expectations. The [evaluation evidence](verification/L3-02-evaluation.md) records separate semantic coverage, abstention, explicit-stop misses and false stops, plus source/claim and composer challenges. Grader clarification distinguishes visibly conflicting source records from unsupported summary claims and permits pre-provider abstention on malicious-output challenges; actual calls remain reported.

[Integrated verification](verification/L3-02.md) covers bounded provider responses, explicit empty-selection fallback, immutable replay and persisted UI attribution. This advances R06/R17/R22 quality evidence locally; it does not establish real-model/customer quality, general multilingual understanding, live provider/PostgreSQL certification or a complete inbox/outcome workflow. L3-03's subsequent local implementation is recorded below.

## L3-03 durable analysis and usage continuation, 2026-09-12

The earlier bulk path executed analysis inside one HTTP request, lost request-level progress after reload and discarded provider usage. Synthesis reuse omitted configured generation identity. The [contract](L3-03_ANALYSIS_JOBS.md) and ADR-020 were recorded before runtime changes.

Local implementation now persists grouped intent and existing event-based stages, provides asynchronous progress and bounded recovery, fences cancellation, versions reuse and commits scoped provider admission before I/O. Optional owner rates and reported-token coverage distinguish estimates from unknown cost. Independent integration review restored exact artifact identity in the compatibility response so a concurrently newer analysis cannot be paired with an older job's draft.

[Integrated verification](verification/L3-03.md) and its scoped evidence retain original attempt/deadline limits, source/currentness and no-duplicate side-effect assertions. This is local engineering evidence, not measured real-model quality, provider billing reconciliation, PostgreSQL launch certification or an end-to-end customer product. L3-04 audited correction/evaluation feedback is next; the customer workflow, landing implementation and human/provider/operations gates remain open.

## L3-04 audited feedback and evaluation continuation, 2026-09-12

Owners previously lacked a saved-result review history and an explicit path from corrected judgments to reproducible evaluation. The [contract](L3-04_FEEDBACK_EVALUATION.md) and ADR-021 were recorded before runtime edits. The implementation adds exact typed targets, revisioned reasons/labels, request recovery, explicitly selected frozen datasets, permanent split reservations, bounded local replay and a pinned synthetic regression gate in CI.

[Integrated verification](verification/L3-04.md) records implementation checks and limitations. Operational corrections do not mutate canonical classifications or contact restrictions. Evaluation metrics are aggregate, source/version-bound and historical after relabeling. Owner nomination is not independent adjudication; protected replay is not proof of previously unseen data. Customer usefulness, actual hosted-model comparison, PostgreSQL concurrency/restore and the complete composer/inbox/outcome/landing experience remain open.

Remaining L3-04 presentation polish: advanced saved-assessment details include bounded structured fit text. Track human-readable detail presentation with L4-06 operator/mobile polish; preserve exact saved-target identity and the verified feedback/evaluation behavior.

## Subsequent L4-01A correction status

The previous settings flow inferred readiness from credential presence and generated webhook tokens during GET. L4-01A replaces this with versioned owner configuration, explicit provision/rotate commands, masked history/recoverable request identity, and distinct configuration/verification status. Normal live dispatch remains held pending provider verification; unsupported live choices cannot be enabled through generic settings. Exact email review now captures Reply-To.

Routes have globally unique generated ownership and immutable aliases. Signed late opt-out/delivery callbacks can use earlier routes; duplicate legacy ownership is rejected before persistence or effects. Managed reserved-token drift is refused, without changing token ownership. Independent review reproduced and corrected unbounded capability inspection and next-state saves that could make configuration unreadable. Bot credentials are also masked in legacy settings output. Browser verification also corrected missing Sandbox Reply-To capture and final review corrected delayed old request lookups overwriting a newer pending setup change; exact historical envelopes and the crossed-lookup ordering have regressions.

[Integrated evidence](verification/L4-01.md) and the [recorded contract](L4-01_CHANNEL_SETUP.md) distinguish local implementation from remaining provider, threading, operator and PostgreSQL acceptance. Full L4-01 and customer readiness remain open; no provider call or live send was made.

## Completion continuation evidence - 2026-09-13

The former missing first/reply composer, unresolved inbox ownership, placeholder reminders and absent corrected business outcomes now have local implementation and focused HTTP/backend tests. The public landing prototype has21 passing browser checks on its recorded checkpoint; later integrations require a fresh candidate run. Single-owner recovery/security has48 passing combined checks with1 explicit PostgreSQL skip. See [completion plan](COMPLETION_PLAN.md), [customer workflow evidence](verification/L4-03-customer-workflow.md), [landing evidence](verification/L4-07-ui.md) and [security evidence](verification/L5-02-account-security.md). Controlled-provider evidence machinery and operational hardening remain in progress. Real customer usefulness and release certification are not established by these results.

## Integrated candidate corrections - 2026-09-13

The current status of R05/R18/R19/R20 is locally corrected: explicit common first/reply/edit composition, paged enquiry conversations with decisions, due reminders and audited outcome facts/export replace the former missing/placeholder flows. The public landing and saved interest funnel now exist. Account recovery, role/schema verification, backup/restore tools, operational alerts/workload and scoped data lifecycle have local evidence in [COMPLETION](verification/COMPLETION.md).

Integration review also corrected private query-cache reuse across owner changes, narrow-screen navigation, provider-proof read projections, and raw signed ingress waiting behind a configuration change or customer-data erasure. Contact-free manual enquiry capture removes the obsolete M0 contact requirement; supplied contacts and outbound eligibility remain validated. Historical findings above describe the original trigger, not unresolved implementation status where this section supplies a correction.

Open acceptance is recorded in [RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md): actual PostgreSQL concurrency/roles/restore, authorized provider path and exact threading limitations, representative customer/model quality, support/retention/proxy/publication ownership, pilot results and unit economics. Automatic business-hours policy, off-app notification delivery and multi-user access are deferred scope choices, not silently implemented capabilities.
