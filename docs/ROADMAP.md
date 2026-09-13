# Launch Roadmap

Updated: 2026-09-13. Product: **AI Lead Intelligence & Outbound Automation**.

## Delivery decision

Keep the modular monolith and PostgreSQL, with Supabase as the managed hosting candidate. Complete one useful customer workflow before expanding channels or discovery. Lead Intelligence remains the core; Outbound Automation executes its decisions.

L0-L6 are the active launch phases. They replace M0-M10 as the work sequence, without erasing earlier implementation. See [historical roadmap](history/ROADMAP_M0_M10.md), [historical milestones](history/MILESTONES.md), [review evidence](REVIEW.md), and [current tasks](TASKS.md).

The docs-first baseline has progressed through local L1-L4 implementation and L5 operational tooling. [Completion evidence](verification/COMPLETION.md) and [TASKS](TASKS.md) distinguish the current candidate from proposed contracts and remaining acceptance. Local completion does not authorize production exposure or certify customer readiness.

The interactive marketing page is an explicit implementation deliverable; see [LANDING_PAGE](LANDING_PAGE.md). L4-07 now implements the prototype and public/auth routing; L5-07 implements saved pilot interest and operator handling. Verified publication details and L6-04 still gate release. These acquisition tasks do not replace or delay the operational pilot safety gates.

## Phase overview

| Phase | Customer/engineering outcome | Entry dependencies | Exit gate |
| --- | --- | --- | --- |
| L0 - Reconciled plan | One current product, architecture, evidence register, and delivery plan | Repository review | Documents agree, decisions and assumptions are explicit, next tasks are executable |
| L1 - Trust and execution | Tenant boundaries, contact restrictions, approved content, and dispatch behavior hold under failures | L0 | Reproduced blockers have behavioral regressions; PostgreSQL concurrency and failure gates pass |
| L2 - Business context and usable data | A business can import, correct, and interpret relevant enquiry data | L1 safety foundation; customer discovery can start earlier | Realistic messy data is reviewed, reconciled, and usable with provenance and contact restrictions preserved |
| L3 - Useful Lead Intelligence | Recommendations explain business relevance and uncertainty | L2 business/evidence contracts; L1 AI safety | Evaluated priorities and grounded recommendations beat an agreed simple baseline on representative examples |
| L4 - Complete customer workflow | Review, send, receive, reply, follow up, and record an outcome through one channel | L1 send safety; L2 context; L3 recommendation contract; channel decision | One verified provider and the React UI complete the full operator journey |
| L5 - Supervised pilot readiness | Customer data and controlled sends are operationally supportable | L1-L4 exit gates | Restore, incident response, access, quotas, performance, and live-channel human QA demonstrated |
| L6 - Pilot evidence and launch decision | Customers repeatedly obtain a useful outcome | L5; agreed pilot protocol | Product value, operational safety, unit economics, and support capacity justify release scope |

Dependencies are gates, not a command to work serially on everything. Customer discovery, provider/account feasibility, observability design, and operational preparation start alongside L1. Integration waits for the relevant contracts and safety gates.

No calendar estimates are committed before the first implementation batch is sized. Each batch must have a demonstrable result; estimates are updated from actual progress.

## L0 - Reconcile before implementation

Deliver:

- Current-state evidence separated from target product behavior.
- Database, execution, policy, AI grounding, and channel decisions with alternatives and tradeoffs.
- A task tracker with owners, dependencies, automated checks, and human QA.
- Pilot hypotheses, decision owners, and launch gates.
- Documentation ownership and update rules.

Exit: Markdown links and consistency checks pass; no runtime fixes are claimed; first implementation batch and unresolved external decisions are visible.

## L1 - Establish trust and execution correctness

Scope:

- Make test tooling unambiguously disposable before expanding tests.
- Close cross-tenant mutation and production test-control routes.
- Introduce transaction-scoped repository composition and safe migration adoption.
- Apply contact eligibility at dispatch, across duplicate contact identities and all send paths.
- Bind approval to the exact content, recipient, channel, and relevant policy revision.
- Persist dispatch intent, atomically claim due work, and correlate provider attempts.
- Recover interrupted callback processing; handle duplicate and out-of-order events.
- Use bounded retries, deadlines, uncertain-outcome reconciliation, and queue fairness.
- Prevent unsupported generated assertions from acquiring misleading evidence citations.
- Establish minimum operational controls: verified database TLS, request/auth limits, redacted logs, and test-environment isolation.

Human demonstration: a rejected, opted-out, future-scheduled, edited-after-approval, or duplicate-in-flight action cannot be sent through another entry point. Ambiguous provider outcomes become reviewable work rather than blind resend.

L1 is not a live-customer launch. It is the foundation required to build and validate L2-L4 safely.

L1-04/L1-08 locally implement contact restrictions, exact review and signed SendGrid ingress. L1-05 adds fenced leases, frozen retry budgets/deadlines, action due-time checks, exact callback/core transactions, evidence-based operator recovery and graceful shutdown. L1-07 adds durable receipts, bounded callback/inbound effect replay, pending-policy dispatch holds and owner Event recovery. L1-06 adds normal fair scheduling, bounded staged lead processing, delivery-gated workflow advancement and owner schedule/pause/resume/stop controls. [L1-06 evidence](verification/L1-06.md) records local scheduling checks, including normal-server restart without developer controls. L1-10 now implements verified database TLS/configuration, bounded HTTP/auth/provider work, safe logs and durable owner pause/attempt controls; see [operational evidence](verification/L1-10.md). Business calendars/full task workflow, unresolved policy remediation and external PostgreSQL/provider/human acceptance remain open; the L1 milestone stays in progress. L2-01 now implements the bounded business-context slice below without declaring the L1 or pilot acceptance gate complete.

## L2 - Make customer data useful

Deliver:

- A versioned business profile: offering, service geography, supported language, qualification criteria, contact policies, operating hours, and responsible operator.
- Typed enquiry attributes with source, capture time, confidence, and an explicit unknown value.
- CSV mapping and preview, selectable rows, phone-region choice, actionable row errors, partial-failure recovery, and import history.
- Correct/edit/archive/export workflows and reviewed duplicate decisions.
- Normalized contact identity and suppression inheritance across imports and duplicate records.
- Safe handling of repeated enquiries, shared addresses, stale information, and conflicting evidence.

L2-01 locally implements one active versioned enquiry snapshot per lead, owner business setup, per-fact manual provenance, unknown/conflicting/inferred distinctions, exact monetary strings and immutable history. Snapshot/review bindings reject old context; direct generation finalization and action materialization check current authority under the workspace gate. [Evidence](verification/L2-01.md) separates local checks from operator/PostgreSQL acceptance. Criteria capture does not yet establish business-fit scoring.

L2-02 now implements reviewed CSV mapping, explicit date/currency/phone interpretation, row correction, selected bounded transactional commits, restart/resume progress and import-linked facts under the [recorded contract](L2-02_REVIEWED_IMPORT.md). [Verification](verification/L2-02.md) tracks local results and open human/PostgreSQL gates. Initial duplicate rows are ineligible; newly appearing matches remain visibly held. L2-03 now adds reviewed source-only linking or separate repeated/shared enquiry creation under its [contract](L2-03_IDENTITY_RESOLUTION.md), with [local evidence](verification/L2-03.md). Shared-contact ambiguity stops existing directly matched automation and remains unassigned for review. L2-04 is implemented and verified locally under its [data-management contract](L2-04_DATA_MANAGEMENT.md), covering contact correction, archive/restore, paged directory and explicit selected export; [evidence](verification/L2-04.md) separates local completion from operator/external gates. Identity decisions never merge opportunities or grant consent.

Exit: an operator imports and corrects a representative messy dataset without database edits or developer intervention. Imported budgets, interests, enquiry dates, and timelines actually influence stored evidence.

## L3 - Deliver opportunity intelligence

Deliver:

- Separate data readiness, business qualification/fit, attention priority, and contact eligibility.
- Explain each recommendation using relevant evidence, freshness, and criteria versions.
- Treat missing evidence as uncertainty; support abstention and human review.
- Include reply context without allowing lead text or provider content to override policy.
- Persist model/provider/prompt/schema versions, fallback use, latency, usage, and cost attribution.
- Invalidate recommendations when business criteria, evidence, contact restrictions, or relevant context changes.
- A representative evaluation set with human labels and a simple recency/rule baseline.

Exit: human reviewers can explain why top-priority leads are relevant to this business. No conversion-probability claims without calibration evidence. Factual support, opt-out handling, and misleading implied relationships are release gates, not only schema tests.

## L4 - Finish one channel and the daily workflow

Deliver:

- Guided channel setup with actual capability/connection verification and explicit sandbox/live separation.
- One provider's outbound, delivery, inbound, authentication, and failure behavior verified end to end.
- A common message composer and policy path for recommended, manual, bulk, reply, and sequence actions.
- Recipient and content preview, edit/review, revocation, explicit scheduling, and clear approval-versus-dispatch behavior.
- A conversation reply composer, thread correlation, assignment, unread/resolved states, escalation, and response deadlines.
- Working scheduled follow-ups, due notifications, stop/pause/resume, and reviewable failure recovery.
- Lightweight outcomes such as qualified conversation, meeting booked, quote requested, won/lost, or export to the existing customer system.
- Parallel L4-07: a modern interactive landing prototype showing synthetic source evidence, intelligence, review and response; mobile/reduced-motion support and explicit public/protected routes.

L4-01A now implements versioned owner email setup, explicit routing commands, exact Reply-To capture and truthful live capability holds under the [contract](L4-01_CHANNEL_SETUP.md). [Local evidence](verification/L4-01.md) does not close L4-01: remote provider evidence, precise reply correlation and the operator workflow remain open. Global sending switches cannot unlock unverified SendGrid dispatch.

Email is an engineering candidate because adapters exist; the first channel remains a customer/pilot decision. If WhatsApp is essential, replace the channel-specific task bundle after checking its provider requirements; do not add both by default.

Exit: a customer can complete import -> priority -> reviewed outreach -> real reply -> follow-up -> recorded outcome in the shipped React UI. A provider HTTP acceptance is not presented as delivery, and delivery is not presented as a sale.

## L5 - Prove operational readiness

Operational work begins earlier; this phase proves it together.

Deliver:

- Separate staging/production, migration and runtime roles, verified TLS, monitored backups and a restore rehearsal.
- Auth recovery, team permissions needed by the pilot, credential rotation, audited administrative actions.
- Per-workspace message and AI budgets, spend alerts, usage attribution, and a kill switch.
- Monitoring for queue delay, failed/uncertain sends, callback backlog, provider health, and support incidents.
- Agreed availability/recovery targets and a load test shaped around tenant count, events, retained history, and actual queries.
- Data inventory, permitted processing, retention/export/deletion behavior including derived data and backups.
- Onboarding instructions, support owner, incident/runbook drills, and a rollback plan that cannot resend historical actions.
- Accessibility and supported-device human QA of the primary workflow.
- Separate public-acquisition L5-07: static/indexable landing content, real qualified signup/pilot/contact path, verified copy, accessibility and performance evidence. A privately staged landing candidate is not a public launch.

Exit: all supervised-pilot checks in [TESTING](TESTING.md), [DEPLOYMENT](DEPLOYMENT.md), and [PILOT](PILOT.md) have named evidence and owners. External credentials/accounts and human QA are not marked complete by mocks.

## L6 - Establish customer value and decide release scope

Deliver:

- A supervised pilot under the protocol in [PILOT](PILOT.md).
- Measure adoption, time saved, priority usefulness, qualified conversations/outcomes, total serving cost, and support time.
- Compare to the customer's existing process using an agreed baseline and comparable cohorts.
- Record product changes from observed workflow failures; re-run affected gates.
- Decide pricing/limits, sustainable support expectations, onboarding model, and permitted public claims.
- Include L5-07 acceptance in L6-04 before publishing the landing page and its supported onboarding/commercial promise.

Possible decisions: launch the proven narrow workflow, extend the pilot, change the customer/channel hypothesis, or stop an unhelpful capability. Do not call activity counts or a positive conversation product-market fit.

Exit: a dated launch decision records cohort/window, safety incidents, economics, remaining limitations, accountable owner, and evidence. A narrow pilot's success does not validate every listed vertical or channel.

## Work that can proceed in parallel

| Stream | Can start | Boundary and integration rule |
| --- | --- | --- |
| Customer research and pilot recruitment | L1 | No real sends or sensitive-data import until pilot gates permit them |
| Backend safety and persistence | L1 | One owner for shared action contracts, migrations, and API wiring |
| AI safety/evaluation design | L1 | Synthetic/de-identified examples first; integrates business context in L3 |
| Data foundation and UX design | During L1 | Implement against agreed L2 contracts after required foundations land |
| Provider feasibility and operations preparation | During L1 | Read/configure sandbox feasibility; live account verification is a separate gate |
| React workflow implementation | L2-L4 | Uses published contracts; no independent send-policy implementation in UI |

See [TASKS](TASKS.md) for concrete implementation batches, file ownership, and update requirements.

## Deliberately deferred

- Additional channels before one channel solves the pilot workflow.
- Lead Discovery, mass prospecting databases, and broad enrichment catalogues.
- A full CRM, complex campaign builder, autonomous selling, or generalized multi-agent platform.
- MongoDB migration, microservices, sharding, read replicas, or new queues without measured need.
- Self-service billing automation before pricing and usage economics are understood; a supervised pilot may use manual commercial administration.

Revisit deferrals with observed customer evidence or a measured system limit, and record the decision.

## L2-05 local continuation

[Freshness implementation](L2-05_FRESHNESS.md) now distinguishes current analysis from source quality, versions evidence authority, guards expiry and changed inputs, and explains refreshed recommendations. [Verification](verification/L2-05.md) records local tests separately from the provisional policy's customer acceptance and actual PostgreSQL/provider gates. L3-01 now has local implementation evidence; L2 is not launch-certified merely because its local code exists.

## L3-01 local continuation

[Configured business fit](L3-01_BUSINESS_FIT.md) is integrated across owner setup, saved analysis, criteria explanations and a bounded queue. Independent synthetic ranking fixtures compare explicit business rules against readiness and recency. Customer-reviewed held-out examples, broader semantic coverage, hosted PostgreSQL and the full usable customer loop remain required. The next launch task is L3-02 factuality, relevance and multilingual/adversarial evaluation; this does not close L1/L2 external gates or the remaining L3 work.

L3-02 now provides locally implemented reply-policy/evidence, interpretation visibility, bounded AI transport and reproducible synthetic quality evaluation under its [contract](L3-02_INTELLIGENCE_QUALITY.md). [Evidence](verification/L3-02.md) distinguishes safety checks from unmeasured customer/hosted-model quality. L3-03 now adds durable analysis jobs, recovery and scoped model admission/usage with optional exact-rate estimates under its [contract](L3-03_ANALYSIS_JOBS.md) and [local evidence](verification/L3-03.md). L3-04 now adds exact saved-result feedback, selected frozen reply datasets and a pinned synthetic regression gate under its [contract](L3-04_FEEDBACK_EVALUATION.md) and [local evidence](verification/L3-04.md). L4 channel and daily-workflow implementation follows; all external acceptance gates remain open.

## Active completion continuation - 2026-09-13

The owner authorized completing remaining feasible implementation. L4 composer, inbox/reminders/outcomes, controlled email verification, public landing and guided setup are integrated alongside L5 security, data lifecycle, schema/restore tools and operational metrics. The next stage is recorded candidate acceptance under [RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md). [COMPLETION_PLAN](COMPLETION_PLAN.md) records sequence and ownership; [TASKS](TASKS.md) remains authoritative. Implementation does not automatically close human/provider/PostgreSQL checks or founder decisions. L6 pricing, cohort results and public-launch go/no-go require real evidence and cannot be inferred from local tests.
