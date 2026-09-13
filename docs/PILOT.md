# Pilot and Customer Validation Plan

## Status and decision to make

This plan was proposed on 2026-09-11. No interviews, customer validation, willingness-to-pay results, pilot outcomes, or production certifications are claimed by this document. The first segment and channel remain undecided.

The product is **AI Lead Intelligence & Outbound Automation**. The pilot must answer whether useful intelligence and reliable follow-through improve a specific customer's work enough to justify adoption and payment. More messages, more AI runs, or a polished dashboard are not sufficient proof.

The phased implementation plan is in [ROADMAP.md](ROADMAP.md); task status is in [TASKS.md](TASKS.md). Begin customer discovery and operational planning alongside L1. Customer data and real sending remain gated by the required engineering, account, data, and channel controls. L5 admits the supervised pilot; L6 evaluates its evidence and decides whether to expand or launch.

## Select the first customer and workflow

Proposed starting hypothesis: recover or progress neglected enquiries for one type of business with a clear next step such as a meeting, quote, or consultation. Furniture/interiors is a candidate, not a confirmed target market. Compare it with businesses the founder can reach and observe; access to real users and data matters more than the breadth of a market description.

| Selection criterion | Evidence to collect | Disqualifying or scope-changing finding |
| --- | --- | --- |
| Frequent problem | Recent examples of missed follow-up and time spent deciding priorities | Problem is occasional or has no material consequence |
| Usable data | A representative export with contact origin, enquiry context, dates, and restrictions | Business has no existing enquiries; solving discovery first would be a different initial slice |
| Reachable buyer and operator | Named budget owner, daily operator, and commitment to weekly feedback | Nobody owns replies, results, or the buying decision |
| Observable result | A meeting, quote, or other agreed progression can be recorded within the pilot | Sales cycle is too long to observe any credible intermediate outcome |
| Suitable channel | Actual customer reply patterns and a channel the business can configure and operate | Existing email work would not reach the intended customers |
| Adoption fit | The workflow can live alongside existing tools with manageable duplication | Success requires replacing the customer's entire CRM or inbox first |

Choose one segment, one workflow, one primary channel, and one primary outcome. Record the decision, supporting interview notes, known counterexamples, and scope impact in the task tracker before segment-specific implementation. Email is the engineering candidate; WhatsApp becomes the first channel only when customer evidence supports the extra implementation and operational work.

## Discovery work before feature commitment

Conduct a proposed 5-8 interviews in the candidate segment, including at least three demonstrations of the operator's actual workflow. Seek examples of recent behavior, not only opinions about AI. Obtain suitable permission before retaining identifiable sample data; use redacted examples during early discovery where possible.

Questions to answer:

1. What happened to the last ten enquiries, where were they recorded, and which ones were missed or delayed?
2. How does the operator decide whom to contact today? Which facts change that decision, and which facts are usually missing or stale?
3. What does a qualified next step mean for this business? Ask the operator to label real examples and explain disagreements.
4. Which channel do customers actually answer? Who owns sender accounts, inbound replies, opt-outs, and out-of-office coverage?
5. What mistake would make the business stop using the product: wrong recipient, invented promise, repeated contact, poor ranking, or missed reply?
6. What tools and manual work already solve part of the problem? Which data must return to those tools for adoption to work?
7. Who can approve a purchase, what would the product replace or save, and what buying event creates urgency?
8. What setup effort, recurring fee, usage limit, support arrangement, and data-handling terms would the buyer actually accept?

Required discovery output: a one-page segment decision, one observed journey, a redacted sample-data profile, the minimum business fields, the agreed outcome definition, and explicit reasons to reject the hypothesis. Do not turn every interview request into a roadmap commitment.

## Pilot offer and boundaries

Propose 3-5 businesses in the selected segment for a four-week supervised pilot after the L5 entry gate. Recruit through founder-led conversations or referrals and select businesses with an operator willing to use the product and report outcomes. This is a learning cohort, not evidence of general market demand.

Use an agreed, permission-reviewed dataset; a practical initial target is approximately 100 enquiries per business when available. Smaller datasets remain useful for workflow learning, but must be reported as exploratory for value/ranking results. Expand only after the initial records and outbound controls are reviewed.

The offer covers one workflow, one channel, one agreed outcome, defined usage limits, and a named support contact. State what setup is assisted, which daily tasks the operator owns, and what is excluded. Do not promise a revenue increase, autonomous selling, or 24-hour support without the evidence and staffing to deliver it.

Capture a primary operator and backup at each business. If multi-user access is offered, distinct accounts and reviewed permissions are required; shared credentials are not the workaround. A single-operator pilot may explicitly defer collaboration features, but must still have an operational backup and a response to account lockout or operator absence.

## Entry gate: before live customer use

All requirements are open until their linked tasks contain evidence. Passing a unit suite alone does not admit a pilot.

- L1 execution, tenant-isolation, suppression, approval, scheduling, and AI trust defects are closed with regression evidence; unsupported-output fallback is demonstrated.
- L2 business context and import mapping/review work for a representative file, including missing/stale dates, repeated imports, ambiguous country formats, duplicates, and shared contacts.
- L3 qualification and priority evaluations show useful results against the simple baseline, with unsupported claims and uncertainty visible to a reviewer.
- L4 proves the complete chosen-channel path in staging: sender setup, reviewed send, authenticated delivery/failure events, actual reply routing, human response, stop/cancel, follow-up, and outcome recording.
- L5 verifies production-shaped PostgreSQL behavior, migrations, restoration, recoverability, access/account controls, retention/export/deletion handling, logs/alerts, cost/usage limits, and incident ownership. Agree the required data-handling terms for the chosen customers and region without assuming provider defaults satisfy them.
- Human QA completes the real React customer journey, narrow-screen and keyboard checks, restart/recovery, and wrong-workspace access checks. Test controls and sample activity cannot affect production customer records.
- The founder and engineering owner review the remaining risks, support capacity, usage ceiling, channel health, and explicit pilot stop conditions. Record the decision and evidence links in TASKS; do not self-certify from this plan.

For a controlled staging demonstration, use business-owned test recipients. Contacting real leads requires customer authorization and eligibility review; the current request to plan and document development is not authorization to contact anyone.

## Execution and human handoff

| Period | Work | Evidence and decision |
| --- | --- | --- |
| Discovery alongside L1-L2 | Observe existing workflow, choose segment/channel, label example leads, establish baseline effort and outcomes | Narrow scope or reject the hypothesis before building a broad workflow |
| Before pilot entry | Complete L1-L5 gates; dry-run the operator journey with representative data | Traceable acceptance record, agreed contact policy, named owners and support terms |
| Pilot week 1 | Assisted setup, reviewed import, first priority review and limited approved sends | Measure setup friction, unsupported assumptions, and correction effort; observe the operator directly |
| Pilot weeks 2-3 | Daily queue use with human review; record replies, follow-up, dispositions and support interventions | Check repeat use, bottlenecks, per-workspace value and cost; stop or adjust when evidence requires |
| Pilot week 4 | Reconcile outcomes, compare baseline, interview operator and buyer, make an actual renewal/pricing offer | Continue, narrow/pivot, stop, or approve a bounded next cohort; public launch remains a separate decision |

The operator's daily loop is: review exceptions and overdue replies, correct relevant context, review priority, approve/edit appropriate work, answer or assign replies, set next due actions, and record business progress. The product must make each step visible without developer assistance.

For the initial pilot, review each proposed message before sending. The reviewer checks recipient, relationship/context, claims, offer, sender, reply route, and time. A human-edit percentage is a learning signal, not automatically failure: material factual corrections matter more than a preferred greeting.

Proposed coverage expectation: acknowledge a customer reply within one business day during the agreed operating window. This is a pilot working target to confirm with each business, not a published service-level promise. Unknown or sensitive replies route to the named operator; opt-out signals stop applicable contact immediately and do not wait for the normal review queue. If nobody is available, pause affected automation and show the reason.

## Measurement contract

Define cohort, eligibility, timezone, and outcome before the first pilot send. Persist workspace, lead, action/run where applicable, event time, source, operator, and correction reason needed to reproduce the measures. Distinguish provider events, operator-entered outcomes, and AI interpretation. Preserve corrections rather than silently rewriting the past.

Track every business that starts, including onboarding failures and withdrawals. Report the count and denominator beside percentages, and show each workspace as well as the cohort. Deduplicate lead-level measures; multiple messages or repeated edits do not create extra successful leads. Mark missing outcomes as unknown and record observation cutoff and time remaining for late entrants.

All thresholds below are **proposed starting targets**, not observed results or universal benchmarks. Confirm them at the pilot design checkpoint and record changes with reasons before seeing the final results.

| Measure | Definition and time window | Proposed target or interpretation |
| --- | --- | --- |
| First useful result | Time from the operator starting setup to their first accepted, evidence-supported priority decision; record elapsed time and hands-on minutes separately for every starting workspace | Target at most 60 hands-on minutes; report assisted and unassisted setup separately and identify external waiting time |
| Workflow activation | Workspaces completing import, priority review, approved eligible send, and scheduled human/follow-up task within seven days / all workspaces that started setup | Target at least 80%; list the actual businesses/counts and each non-completion reason |
| Repeat operation | Activated workspaces that perform the daily review/respond/disposition workflow on at least three different days in each of weeks 2 and 3 without developer intervention / activated workspaces with both weeks observed | Target at least 80%; support calls and SQL fixes are interventions, not hidden successes |
| Priority usefulness | Operator-marked appropriate-for-attention leads among the top ten recommended leads / ten, measured before outreach for each workspace with ten eligible leads | Initial target at least 70% and compare with a simple last-enquiry-date/last-contact baseline; report overlap and reasons, not just the score |
| Evidence correctness | Unsupported material factual assertions / all material factual assertions in a stratified reviewed output sample; include top, middle, low priority, incomplete, and stale records | Zero critical unsupported assertions accepted for use; minimum proposed sample 30 outputs per workspace, or all when fewer; each failure feeds an evaluation case |
| Draft correction burden | Drafts requiring a material factual, recipient, offer, or context correction / all reviewed drafts, weekly; also record edit minutes | Target under 20% by week 3; style-only edits are separate; no known incorrect draft is sent to meet a target |
| Incorrect external action | Unapproved, suppressed, duplicate, premature, misaddressed, or materially unsupported messages / all provider-accepted outbound messages; monitor continuously | Zero; also record blocked attempts and near misses; any observed incident triggers the pause procedure below |
| Reply handling | Incoming reply threads receiving a human response or explicit disposition within one agreed business day / all incoming reply threads due for handling, weekly | Target at least 95%; exclude automated delivery notices by definition, and show overdue/unknown cases |
| Qualified progression | Unique eligible contacted leads reaching the pre-agreed meeting/quote/other outcome within 14 days of first contact / unique eligible contacted leads with a complete 14-day window | Compare with the recorded baseline; no fabricated universal conversion threshold; late entrants remain pending and the denominator is explicit |
| Operator effort | Observed operator minutes per ten reviewed leads and per resolved reply, on comparable tasks before the pilot and in week 3 | Target at least 25% reduction without increased incorrect actions or missed replies; include correction and support time |
| Continuation | Businesses accepting an actual priced continuation / businesses receiving the same documented offer after completing the agreed observation period | Proposed learning target: a majority accept; record paid agreement/payment separately from verbal interest, plus reasons for refusal |

Review low-priority leads as well as top-ranked leads to detect opportunities the ranking misses. A correct recommendation to gather missing data is useful even when it produces no immediate outbound message. Do not optimize away incomplete imports or difficult customers to improve activation percentages.

If the customer agrees and volume is adequate, compare randomly assigned eligible leads using the product workflow against the business's usual process. Keep eligibility, channel, offer, staffing, and observation window comparable. With small or non-random cohorts, report descriptive differences and interview evidence; do not claim that the product caused an increase in revenue. A lead can reach a milestone once for funnel reporting even if it receives several messages or changes owner.

## Pricing, cost, and business viability learning

Track costs from the first supervised run, not after adding volume. Measure LLM requests/tokens, channel usage, enrichment/research calls if any, storage growth, infrastructure allocation, refunds/credits, setup time, and ongoing support time per workspace. Use current invoices or measured usage; this plan intentionally does not assume a provider price or a validated customer price.

For each workspace, record:

- Variable cost per analyzed lead, contacted lead, and observed qualified progression; show zero-outcome periods explicitly instead of dividing by zero or hiding them.
- Revenue from a documented paid offer, less directly attributable provider/hosting costs, as contribution before staff costs; include support/onboarding labor separately so founder time is not treated as free.
- Usage and support limits at which the proposed price stops being viable, with a cost ceiling that blocks unexpected growth and gives the customer a clear recovery path.
- The buyer's explanation of value: saved operator time, additional appropriate conversations, more quotes/meetings, or another observed outcome. Avoid pricing purely by token consumption.

Start with a simple proposed workspace subscription and an explicit included usage allowance as a pricing hypothesis. Test the buying decision with a real continuation offer after value is demonstrated. Do not build a full billing engine before understanding packaging; a documented manual pilot agreement can suffice if access, usage limits, payment status, and support responsibilities remain clear. Public self-service launch needs the corresponding account, billing, cancellation, and usage experience.

## Stop conditions and pilot support

Pause affected sending immediately for a cross-tenant exposure, suppressed contact, wrong recipient, duplicate external action, materially invented message claim, unauthorized send, unexpected volume/cost, or loss of reliable delivery/reply processing. The engineering owner uses the operational runbook, reconciles provider/application state, preserves necessary incident evidence, and records customer impact and communication. Do not retry an uncertain send simply to clear a queue.

Repeated low-value rankings, excessive correction time, poor channel response, or failure to use the daily queue are reasons to revisit the product hypothesis. They do not justify adding more automation before understanding the failure.

Maintain a pilot support log containing time, workspace, symptom, affected workflow, severity, owner, workaround, resolution, and follow-up test/documentation change. Founder assistance must be visible in the results. Provide a clear way to pause sending, export customer-owned data, end the pilot, revoke provider credentials, and apply the agreed retention/deletion procedure.

## L6 decision and evidence record

Decide explicitly among:

1. **Continue the same scope:** trust gates remain satisfied, operators repeatedly use the workflow, value is credible, and support/cost are manageable; a larger bounded cohort may be appropriate.
2. **Narrow or change the hypothesis:** customers value a subset, the selected channel is wrong, input data cannot support the intelligence, or another adoption barrier dominates; change the plan and re-test.
3. **Stop the pilot:** the customer problem or willingness to pay is insufficient, or safe operation cannot be sustained.
4. **Approve public launch:** only with engineering/operations gates still satisfied, resolved material product issues, accountable support, coherent commercial/account lifecycle, and an explicitly documented launch decision. Finishing four weeks does not automatically select this option.

The L6 record must include cohort and exclusions, observed results with denominators, interviewed buyer/operator feedback, trust incidents and unresolved issues, channel evidence, unit-cost/support analysis, continuation decisions, and the approved next scope. Link the record from TASKS and update PRODUCT/ROADMAP when evidence changes the direction.

L3-01 engineering evidence uses frozen synthetic rule cases and a four-record priority comparison only. It does not satisfy the customer top-ten usefulness target above. Before applying that metric, select and retain a complete labeled customer cohort with explicit criteria, include missed low-ranked positives and unknown-language review work, and compare the same cohort against recorded recency/readiness. The current queue ranks a returned page of at most 100 active records; a page result must not be reported as a workspace-wide top ten. Contact-free manual capture also remains incomplete.

## L3-02 evidence required before quality claims

The bundled [synthetic evaluation](verification/L3-02-evaluation.json) measures engineering policy behavior and adversarial contracts. It is not customer-held-out data and its injected ideal model proposals are not actual model accuracy. Collect consented/de-identified representative replies and source facts, independently label semantic intent and explicit-stop expectation, adjudicate disagreement with native-language reviewers, and keep a truly held-out subset protected from implementation tuning. Report abstention and review effort alongside false stops and missed stops; a safe UNKNOWN is still a semantic miss when the intended class is known.

Observe whether operators can distinguish source confidence from factual truth, method from correctness, and an unconfirmed candidate from customer intent. Verify possible-model opt-out review without lifting restrictions. Measure real configured-provider quality, latency and cost with bounded approved test data. These gates, live PostgreSQL/provider operation and the complete reply-to-outcome workflow remain open.

## L3-03 job and usage acceptance

Before live customer use, the operator must submit a representative selected batch, leave/reopen progress, explain partial failures and cancel/retry within the recorded limits. They must distinguish finished work from current source intelligence and a prepared draft from approval. Demonstrate lost-response recovery without duplicate submissions and retain the reason/history for recovery decisions.

Validate provisional AI daily/concurrency limits against the agreed workload on disposable PostgreSQL and the selected real provider. Reconcile reported tokens and entered rates with actual charges, including missing usage, invalid output, cancellation and timeout. Document that logical slot expiry does not prove remote cancellation and that recovery can incur another invocation. [L3-03 local evidence](verification/L3-03.md) is synthetic; it supplies no customer accuracy, actual billing, throughput or launch acceptance claim.

## L3-04 review usefulness and protected evaluation acceptance

Have the actual operator review a saved result, correct the source separately when needed, record a reasoned judgment, restore a withdrawn review and recover a lost response without duplicating it. Validate that the operator understands overall correctness versus expected reply category, explicit nomination, version freezing and historical metrics after relabeling. Compare review effort and decisions with the existing customer process.

Select permission-reviewed representative examples, record provenance/exclusions and obtain independent/native-language adjudication. Permanent enquiry/text split reservations and one-use HOLDOUT replay reduce reuse but do not establish an untouched or independent dataset. Define sample sizes, class/language denominators and acceptance thresholds before the real candidate evaluation. Local recorded-category versus current-rule metrics measure neither hosted-model quality nor customer generalization. [L3-04 evidence](verification/L3-04.md) supplies engineering verification only; real customer/provider/PostgreSQL and release sign-off remain open.

## L4-01A evidence boundary

The local [email setup slice](L4-01_CHANNEL_SETUP.md) provides reviewable configuration and truthful capability holds. It does not validate the customer's channel choice or establish a live send/reply loop. Normal live SendGrid dispatch remains held until the implemented current-configuration verification flow has authorized controlled-mailbox evidence. There is no owner attestation that waives this hold.

Before pilot admission, confirm that the selected business can own the sender and monitored reply mailbox, attach the correct provider signing policy, recognize delivery versus acceptance, and handle ambiguous/repeated enquiries. Record real opt-out/failure/reply behavior, operator comprehension, and exact thread attribution separately from the [local automated checks](verification/L4-01.md). The composer/inbox/follow-up/outcome journey and landing funnel are implemented locally and retain real operator/customer and L4-L6 acceptance gates.

## Local candidate preparation - 2026-09-13

Email and a single current owner remain provisional engineering scope. The candidate now has a synthetic public walkthrough, separately saved pilot-interest requests, reviewed first/reply composition, conversation decisions, internal reminders, owner-reported outcome corrections and offline recovery. Provider-verification tooling requires operator-authorized delivery and rejection sinks plus actual signed delivery/failure/reply/stop. No live messages, pilot interviews, pricing evidence or public-launch decision have been recorded by this implementation batch. Existing signed evidence and customer acceptance gates remain mandatory.

## Candidate handoff and decision templates

[RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md) now supplies an ordered staging/provider/operator/data/support checklist and blank L5-06/L6-04 decision records. Every actual pilot records the baseline, observation window, permission-reviewed data, supported channel/owner scope, outcome denominators, support and total serving costs. Implementation and a synthetic 100-enquiry workload do not answer whether customers repeatedly obtain the intended outcome. No launch decision or pricing result is inferred from local completion.
