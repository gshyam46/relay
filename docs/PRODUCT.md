# AI Lead Intelligence & Outbound Automation

## Purpose and document status

Help a business turn its existing lead and enquiry data into an understandable set of priorities, take appropriate action, and learn from the result.

This is the current product specification as of 2026-09-13. It replaces milestone-specific descriptions of what was once unavailable. Implementation history is preserved in [history/MILESTONES.md](history/MILESTONES.md); active work is in [TASKS.md](TASKS.md), and delivery gates are in [ROADMAP.md](ROADMAP.md). Requirements below describe the intended pilot product unless explicitly marked as implemented. Updating this specification does not close implementation defects or certify launch readiness.

The product has two primary pillars:

1. **AI Lead Intelligence** is the core capability: understand what is known, what is missing, how a lead fits this business, and what should happen next.
2. **Outbound Automation** executes eligible actions based on that intelligence and returns responses and outcomes to it.

Lead Discovery is optional. The product is not an AI SDR, autonomous salesperson, sales operating system, or CRM replacement.

## Customer problem and first-market hypothesis

The initial problem hypothesis is that businesses already have useful enquiries, but incomplete records and inconsistent follow-up make it difficult to decide whom to contact, why, and when. Success means progressing appropriate opportunities with less operator effort, not merely sending more messages or producing more AI summaries.

The first customer segment, buying trigger, and primary channel are **not validated**. Furniture/interiors enquiry recovery is one candidate, alongside other businesses with an observable enquiry-to-quote or enquiry-to-meeting workflow. Select one segment and one workflow before introducing segment-specific functionality. Broader construction, real estate, agency, and local-service examples are future possibilities, not simultaneous launch commitments.

The buyer is provisionally an owner or manager responsible for enquiry outcomes; the daily user may be that person or an assigned operator. The buyer needs evidence of value and predictable cost. The operator needs a trustworthy queue that fits into the way the business already answers customers. [PILOT.md](PILOT.md) defines how these hypotheses will be tested.

Email has existing engineering investment and is the initial technical candidate. That does not establish that email is the right channel for the selected customers. If customer evidence requires WhatsApp, revise the channel delivery slice and its acceptance criteria before committing to a live pilot. Adding every channel is not the fallback.

## Current safety increment

Local L1-04/L1-08 implementation now preserves opt-outs across directly matching contacts, requires review of exact recipient/sender/message revisions, and records dispatch ownership before provider calls. Review edits require a separate new preview; uncertain sends remain held. These changes address concrete trust gaps in the original review.

L1-06 now schedules bounded workspace turns, retries failed lead processing within durable limits and exposes owner sequence controls and processing recovery. The completion batch implements shared manual/reply composition, due reminders, conversation decisions, corrected outcomes and guided setup. Automatic timezone/business-hours policy remains deferred; operators choose explicit scheduled times. One verified live provider and real operator validation are still required. The interactive landing page is implemented under [LANDING_PAGE](LANDING_PAGE.md). See [scheduling verification](verification/L1-06.md); local safety tests do not certify the pilot.

L1-10 now gives the owner a durable sending pause and UTC daily-attempt/unresolved-work limits in Settings, with visible global holds and safe revision conflicts. Deployed sending starts disabled. Request/auth limits, verified database TLS, safe logs and bounded provider responses protect the foundation. [Operational verification](verification/L1-10.md) records local evidence; limits are provisional and do not promise measured capacity or a monetary budget. L2-01 now adds Business profile in Settings and Enquiry on the lead record: owner-entered offering/criteria, sourced facts, exact/range budgets, explicit unknowns and conflicting alternatives, with version history. A correction makes old analysis and plans unavailable as current and requires renewed review of affected messages. Analysis refresh remains explicit; L3-01 now evaluates adopted typed criteria for sourced business fit, independently of readiness/contact eligibility. See [current evidence](verification/L2-01.md).

## Core product loop

```text
Business goals, offerings, qualification criteria, and contact policy
                                 |
Lead Sources -> Lead Data Foundation -> AI Lead Intelligence
                                              |
                                       Next Best Action
                                              |
                                     Policy / Human Review
                                              |
                                      Outbound Automation
                                              |
                             Response / Event / Business Outcome
                                              |
                                  Updated Lead Intelligence
                                              |
                                       Next Best Action
```

The application owns persisted data, intelligence, decisions, approvals, actions, events, and audit history. External providers and n8n remain replaceable execution or integration adapters. They are not the authoritative business state.

## Implemented baseline and remaining gaps

These are code capabilities, not assertions that they have all passed a production acceptance gate. Runtime defects identified in the review remain open in [TASKS.md](TASKS.md).

| Area | Implemented baseline | Required before the pilot |
| --- | --- | --- |
| Workspace | Registration, session authentication, organization settings, tenant-scoped services, React application | Complete isolation across every mutation path, production removal of test controls, account recovery, explicit user and reviewer responsibilities |
| Data foundation | Reviewed CSV mapping/correction, resumable row transactions and explicit same-enquiry/separate-enquiry identity decisions; preserved source history and typed context | Operator acceptance, real PostgreSQL proof, existing-contact correction and archive/export |
| Intelligence | Versioned evidence/snapshots, synthesis, recommendation and planning services; configured LLM path with deterministic fallback | Business-context qualification, claim-level grounding, freshness and contradiction handling, meaningful evaluations and observable fallback |
| Outbound | Exact reviewed content, durable contact checks, fenced dispatch, action due times, bounded retries, callback effect replay, owner sequence controls and delivery-gated scheduling | Full manual/reply composer, operating hours, actual PostgreSQL/provider concurrency and operator validation |
| Channel and response | Email adapter paths, durable SendGrid/inbound receipt processing, classification, message/task replay and owner Event recovery | Verify one channel end to end in staging; live verification of signed event handling, reply routing, reply composer, ownership, measured scheduler performance and live stop-condition validation |
| Outcomes and operations | Dashboard/activity views, SQL persistence, PostgreSQL adapter and migrations, structured logging | Operator-recorded outcomes, useful value reporting, measured cost limits, restore proof, support and incident process |

Key implementation anchors: [CSV mapping](../src/modules/data-foundation/csvAdapter.js), [LLM synthesis](../src/modules/ai/llmSynthesisAgent.js), [message composition](../src/modules/outbound-automation/messageComposer.js), [action execution](../src/modules/handlers/actionExecutor.js), and the shipped [React client](../client/src/). The retired `public/` frontend is not the current customer experience.

## L1-03 persistence progress

Approval changes now commit together and competing review decisions serialize. A new decision requires an action awaiting approval; completed, in-flight or blocked actions cannot be reactivated through missing review metadata. Startup and status checks inspect an existing schema; upgrades run separately. This persistence slice provides the transaction foundation; later L1-04/L1-08 and L1-05 slices implement immutable approved content, contact restrictions and fenced dispatch. [L1-03 evidence](verification/L1-03.md) records local checks and pending PostgreSQL/human acceptance.

## L1-05 execution and recovery progress

An approved action waits until due, retains a bounded retry budget across edits/restarts and records its exact attempt before contacting a provider. Unknown outcomes wait for evidence. The operator can inspect attempts, timing and provider reference, then record verified acceptance or close without another attempt. Acceptance remains distinct from delivery. Exact callbacks preserve current execution identity and committed delivery facts. [L1-05 verification](verification/L1-05.md) records that slice's evidence. The later L1-07 slice below adds ancillary replay; L1-06 below adds bounded workflow scheduling; PostgreSQL/provider/browser acceptance remains open.

## L1-07 received-event recovery progress

Current webhook sources now store durable receipts before acknowledgement. Interrupted callback/inbound processing resumes from persisted input and completion markers, repairing original messages and appropriate tasks once. Owner Event recovery exposes pending and unmatched events with bounded retries and recorded decisions. Required contact policy runs before closure; while it is unfinished, workspace sending waits without losing approval or consuming dispatch attempts. Intelligence snapshots refresh from persisted reply events, including opt-outs.

[Integrated verification](verification/L1-07.md) records local evidence. Invalid or foreign policy evidence can still require operator remediation; retry cannot rewrite received input or waive restrictions. The L1-06 slice below adds bounded domain-event retry; production database/provider checks and human recovery QA remain open.

## L1-06 scheduling and lead processing progress

The normal server gives active workspaces and processing phases bounded turns. Owners can create a basic campaign/sequence, choose a start time, enroll a lead, review the exact send, and pause/resume/stop the run in Workflows. A send step waits for its exact delivery/completion; approval, provider acceptance and uncertainty do not start the next step. Every canonical reply stops its existing sequence, including a question or unclear reply that still needs a human response.

Failed lead processing has durable retry limits, stage evidence and owner recovery under Event recovery. Generation runs outside database transactions; changed evidence or expired ownership cannot commit stale results. Contact restrictions across duplicate identities remain authoritative. Activity distinguishes scheduled, due and scheduling-review tasks; invalid schedules do not silently become complete. [Integrated verification](verification/L1-06.md) records current evidence and open PostgreSQL/browser/provider gates. Full campaign composition, business calendars and real completion of a workflow human-task action remain later work.

## Batch A safety progress

The first implementation batch closes the reproduced legacy callback ownership gap, disables production simulation controls, binds reviewer identity to the session and makes tests explicitly disposable. Default/configured intelligence now validates exact source attribution and renders quoted records; recommendations and plans use deterministic safety rules. Drafts avoid unsupported enquiry, representation and operating promises, and stored outbound copy matches resolved provider copy.

Batch A improves the foundation without validating business fit or completing inbox replies. Later review migrations quarantine ambiguous queued history; exact approval and recovery still require their external acceptance gates. See [Batch A evidence](verification/BATCH_A.md) for local results and pending human/external QA.

## Public product experience

A modern interactive landing page is part of the delivery scope. It should make the problem and the value of Lead Intelligence clear before asking a visitor to sign in. The central example shows a synthetic enquiry becoming evidence-backed intelligence, a reviewed action and an updated decision after a response. The interface must work on mobile, by keyboard and with reduced motion.

[LANDING_PAGE](LANDING_PAGE.md) specifies the story, visual direction, proposed routes, motion, honest example labels, performance budgets and real CTA requirements. The current frontend still opens its authentication screen for signed-out visitors; no landing implementation is claimed. Deliver the prototype in L4-07, production funnel in L5-07 and publish only within L6-04. Supported-channel claims and commercial terms follow verified product/pilot evidence.

## The business context the product must understand

The pilot needs a small, validated business profile that can be reviewed and versioned. Do not build a general-purpose configuration language or an entire product catalogue first.

| Context | Minimum useful information | Behavior it enables |
| --- | --- | --- |
| Business | Name, offerings, service area, target customers, explicit exclusions | Explain whether an enquiry is relevant to what this business can actually deliver |
| Qualification | Required and optional fit criteria, what makes a lead worth attention, preferred next step | Explain priority and expose missing information without inventing intent |
| Communication | Sender identity, chosen channel, language/tone, contact hours and timezone, approved claims and promises | Produce appropriate drafts and schedule them according to business policy |
| Enquiry | Product/service interest, location, enquiry date, stated budget with currency, stated timing, last meaningful interaction | Distinguish a usable contact record from a current opportunity |
| Evidence and eligibility | Source, who supplied the fact, effective date, contact permission/restrictions, suppression history | Show provenance, detect stale context, and decide whether contact is allowed |
| Ownership and outcome | Responsible operator, next due action, human disposition, meeting/quote/progress result | Close the loop and make the system useful in daily work |

Keep missing values unknown. Distinguish an exact value, a range, a customer statement, and an inference. An enquiry date is not an import date; source provenance is not proof that somebody previously enquired or agreed to contact.

The implemented data model supports one active enquiry context per lead. Repeated enquiries and shared contact details require explicit identity review. An owner can attach an exact-contact source to the same enquiry or create a separate enquiry, preserving both histories and contact restrictions. Linked source facts do not silently overwrite current facts. Expand person/company/opportunity modeling only when the selected workflow requires it. The definitive proposed contracts and migration boundaries belong in [DOMAIN.md](DOMAIN.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## End-to-end customer experience

| Step | Customer action and required result | Failure or uncertainty handling |
| --- | --- | --- |
| Set up | Describe the business, select the workflow, verify the channel, set ownership and contact policy | Explain what is missing and keep real sending unavailable until the required checks pass |
| Import | Map a real file, choose country/date interpretation, inspect issues, explicitly commit selected rows | Preserve raw source, expose unmapped fields, offer corrections and clear duplicate choices; avoid silent data loss |
| Understand | Review a prioritized queue with business-specific reasons, source links, and missing information | Show stale, contradictory, unsupported, or incomplete context; allow correction and review instead of manufactured certainty |
| Decide | Accept or change the next action, including gather data, wait, human task, or no contact | Persist the decision and its reason; recommendations do not create a right to contact |
| Review | Read and edit the exact recipient, sender, subject, body, and scheduled time before approval | Re-review material content/context changes; expose conflicts with an existing pending action |
| Execute | See whether approved work is scheduled, attempting, accepted, delivered, failed, or uncertain | Preserve eligibility, stop rules and history; explain recovery without inviting duplicate sends |
| Respond | Open the original reply, understand its interpretation, assign/answer/resolve it, and choose follow-up | Escalate low-confidence classification, stop applicable queued work, and retain a clear human owner |
| Learn | Record an outcome and inspect what progressed, stalled, or required correction | Distinguish delivery, replies, and business outcomes; do not infer a sale from message activity |

An operator should be able to complete the daily workflow from the product without developer tools or SQL. Use customer language, clear loading/empty/error states, accessible keyboard operation, and a usable narrow-screen layout. Sample data and sandbox events must be visibly separated from live customer activity.

## Intelligence quality and trust

The interface and domain must keep three assessments separate:

1. **Data readiness:** whether the information is usable and sufficiently identified.
2. **Business relevance and priority:** whether it fits this business and deserves attention now, given the evidence.
3. **Contact eligibility:** whether a specific action is currently permitted for this recipient and channel.

Contact completeness does not prove buying intent. A highly relevant opportunity can still be ineligible for contact. A confidence label describes support for an assessment; it is not a calibrated probability of purchase unless separately validated.

Each material assertion needs evidence that supports that assertion. Merely attaching every available evidence ID is insufficient. Include source and observation dates, expose contradictions, and regenerate or mark intelligence stale after relevant data, business-profile, policy, or interaction changes. Preserve prior versions and human corrections. Validate imported text and inbound content as untrusted data, including attempts to instruct the AI to ignore policy or disclose information.

The safe result can be "insufficient evidence," "ask a human," "wait," or "do not contact." A model failure or unavailable provider must produce an observable failure/fallback state, not an unexplained high-confidence decision. Evaluate the usefulness of the intelligence independently from whether an outbound request succeeded.

## Outbound and human-control requirements

- The pilot uses human review for outbound content and meaningful changes. Manual, planned, bulk, sequence, and reply entry points share policy and execution rules.
- Approval applies to the actual reviewed message and context. Edits, recipient changes, stale inputs, or changed restrictions invalidate it as defined in the domain contract.
- Check current tenant ownership, contact eligibility, suppression, approval, scheduling, and workflow stop conditions immediately before an external send.
- One action has one durable execution owner at a time. Unknown provider outcomes require reconciliation before retrying when duplicates cannot be excluded.
- Opt-outs and other suppressions persist through imports, callbacks, retries, and restarts. Delivery must not reactivate a suppressed lead.
- Every inbound reply has an accountable operator or queue. Important tasks need a due time, visible state, and escalation path; classification alone is not a handoff.
- Drafts must not invent an existing relationship, prior enquiry, authority to speak for a company, price, availability, booking, call commitment, or response-routing promise. A CSV contact is not proof of any of these.
- Present acceptance, delivery, reply, and outcome as separate events. A sent message does not mean the customer read it or the business gained value.

## Scope and release boundary

The first usable release proves one selected customer's workflow over customer-owned data and one verified channel. Keep other providers and connectors behind their existing interfaces, but expose only capabilities that have completed their acceptance gates.

Defer lead marketplace/discovery investment, autonomous replies, a visual branching campaign designer, every-channel expansion, full CRM replacement, and speculative microservices or sharding. Add a CRM integration early only if pilot evidence shows that duplicate data entry prevents adoption; a minimal outcome/export path may suffice first.

Use PostgreSQL as the production data direction, with managed hosting described in [ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md). Database choice does not replace execution correctness, tenant isolation, migration tests, restoration, or operational ownership.

## Definition of a usable pilot product

A representative business user can import an agreed real dataset, understand and correct the recommendations, send reviewed communication, handle replies, schedule follow-up, and record outcomes without developer assistance in routine use. No unapproved, suppressed, duplicate, misaddressed, or unsupported communication is acceptable as a known defect.

This requires engineering gates and human workflow verification, followed by supervised customer learning. It does not claim that a small pilot proves commercial scale or causal revenue improvement. [PILOT.md](PILOT.md) defines proposed measures and release decisions; [TESTING.md](TESTING.md) defines verification; [TASKS.md](TASKS.md) owns implementation status.

## Reviewed enquiry identity progress

L2-03 now lets an owner compare duplicate sources, attach a source to an exact-contact existing enquiry, or retain a separate repeated/shared/distinct enquiry. Source history, current facts, contact restrictions and original import outcomes remain distinct. Stale decisions require a fresh comparison; exact retries return the saved result. A shared-contact reply stops matching existing automation and remains unassigned for owner recovery. [Contract](L2-03_IDENTITY_RESOLUTION.md) and [verification](verification/L2-03.md) record scope and evidence. Existing-contact correction, complete inbox assignment/composition, business-fit intelligence, operator acceptance and actual PostgreSQL/provider proof remain open.

## L2-04 customer data workflow

L2-04 locally implements reviewed contact correction, immutable change/source history, a paged Current/Archived/All directory and explicit selected-record export under the [data-management contract](L2-04_DATA_MANAGEMENT.md). Owners review duplicate contacts and affected work before correcting a record. Archive means this enquiry is no longer active; it remains separate from opt-out. Restore preserves contact restrictions and requires fresh analysis/review before new work.

Useful export includes current contacts, all six enquiry fact states, exact money/source information and archive/revision details. It never silently treats an empty selection as all records. [Verification](verification/L2-04.md) distinguishes implemented behavior and automated browser checks from first-time operator acceptance, spreadsheet testing and real PostgreSQL/provider evidence. L2-05 now addresses freshness policy; evaluated business-fit intelligence remains L3.

## L2-05 customer analysis freshness

The [freshness contract](L2-05_FRESHNESS.md) adds distinct never-analysed/current/outdated/archive explanations and source-age issues. Refresh evaluates existing evidence without presenting it as newly confirmed. An operator can see prior recommendations and changed inputs, then correct or confirm the underlying source through the existing enquiry/contact workflows. Unknowns and conflicts remain visible even when analysis is current.

The initial 90-day policy for time-sensitive enquiry facts and research is provisional and requires pilot validation. This does not implement business-fit scoring or certify contact permission. [Evidence](verification/L2-05.md) records the implementation and outstanding customer/database/provider gates.

## L3-01 configured business fit

The [business-fit contract](L3-01_BUSINESS_FIT.md) adds explicit owner rules for interest, location, budget and timeline. Current analysis distinguishes supported matches, known failures and facts requiring review; preference coverage is separate from readiness and contact permission. Existing descriptive requirements/exclusions remain unevaluated until an owner resolves them. The queue ranks each returned page, with explicit paging; it does not claim a global top-K result. General semantic qualification, representative customer value and full end-to-end pilot acceptance remain open.

## L3-02 interpretation quality and trust

The locally implemented [quality contract](L3-02_INTELLIGENCE_QUALITY.md) separates recorded source extraction, model-assisted selection, fallback and an unavailable historical method. Assessment details show exact supported values and source links. Empty model selections require review. Reply details retain original text, the interpretation method and exact supporting excerpts; a model-only candidate remains unconfirmed. Contact-stop and uncertainty labels remain separate, including a possible model opt-out that conservatively stops contact pending review.

Explicit supported stop requests are handled before semantic interpretation. Negation, quoted history and uncertain attribution abstain. The finite English/Hindi/transliterated policy checks are engineering fixtures, not general multilingual understanding or measured customer accuracy. The [evaluation report](verification/L3-02-evaluation.json) separates synthetic safety from unmeasured hosted-model/customer quality. Common composition, inbox ownership/resolution, measurable outcomes and the live customer loop remain L4 work; bounded analysis jobs and usage/cost attribution are implemented in the L3-03 slice below.

## L3-03 analysis progress and operating limits

Owners can submit up to 50 selected enquiries, leave the page and reopen the saved analysis job from Intelligence or lead detail. Each record shows saved stages, completion, reuse or a reviewable failure. Cancel stops unfinished results from publishing; retry retains the original processing limits and completed work. A request with an uncertain response keeps its recovery reference and checks saved state before the owner explicitly retries the same submission.

Settings now separates AI request controls from outbound sending controls. Owners can pause new model calls, set daily and concurrency limits, inspect reported tokens and optionally enter exact provider/model rates for estimates. Unknown cost stays unknown; an admitted request can still incur usage after cancellation. Local analysis and reused results do not pretend to be paid model calls. Finished analysis does not imply fresh sources, customer fit, contact permission or an approved message.

The [contract](L3-03_ANALYSIS_JOBS.md) and [verification](verification/L3-03.md) describe this bounded local implementation. Customer comprehension, real-provider usage reconciliation and PostgreSQL acceptance remain open. L3-04 now adds audited feedback/protected local replay; the full composer/inbox/outcome journey and interactive landing page remain planned L4/L5 work.

## L3-04 learning from reviewed results

Owners can review an exact saved assessment or reply interpretation, explain a mistake, revise or withdraw that judgment and retain its history. Source correction remains a separate explicit step. Reply reviews can be nominated for a versioned evaluation dataset; owners choose the examples and see aggregate differences between recorded classifications and current local rules.

The first evaluation workflow uses local rules and makes no provider calls. It does not train a model, change operational replies, relax a contact restriction or certify a release. Protected replay sets limit repeated use while preserving historical results after labels change. [Contract](L3-04_FEEDBACK_EVALUATION.md) and [verification](verification/L3-04.md) distinguish this implementation from customer usefulness, native-language adjudication and actual hosted-model acceptance. The guided composer/inbox/outcome journey and interactive landing page remain L4/L5 work.

## L4-01A implemented setup boundary

Owners can now save and review versioned email configuration, provision canonical webhook URLs explicitly and rotate the advertised URL while keeping old signed routes available for late events. Saved setup and live provider verification are distinct. Exact draft review captures the configured Reply-To. Existing adapters alone do not establish support for a live customer workflow: normal SendGrid dispatch is held pending subsequent provider verification, and unsupported live channel/provider combinations remain held. Sandbox remains usable.

This is the bounded [L4-01A contract](L4-01_CHANNEL_SETUP.md), with [local evidence](verification/L4-01.md). It does not complete controlled mailbox verification, precise enquiry/thread association, the common composer, conversation reply/assignment or outcomes. Email remains the engineering candidate; customer channel selection and L4-07 interactive landing implementation remain open.

## Current completion implementation - 2026-09-13

The shared email composer now creates distinct first messages and replies, edits an unattempted action through a new review revision and preserves exact request recovery. Conversation decisions, internal reminders and owner-reported outcomes are separate persisted facts. New canonical inbound reopens a resolved enquiry; opt-out remains a contact-policy state. Four outcome slots prevent repeated milestones and simultaneous won/lost results; reported deal value is not received revenue.

Public product exploration lives at /, with a synthetic interactive example and a real separately persisted pilot-interest form. /app opens the protected dashboard; established workspace deep links remain valid. Single-owner security includes offline one-use recovery and session revocation. These locally implemented surfaces are being integrated and verified; real provider/customer and launch acceptance remain open. Contracts: [completion](COMPLETION_PLAN.md), [customer workflow](L4-03_CUSTOMER_WORKFLOW.md), [provider verification](L4-01_PROVIDER_VERIFICATION.md), [account security](L5-02_ACCOUNT_SECURITY.md), [guided setup](L4-06_SETUP_JOURNEY.md).

## Local completion candidate - 2026-09-13

The current single-owner candidate implements source capture through reviewed action and recorded outcome, the interactive public example and pilot request flow, account recovery, operational status and customer-data export/erasure. [Completion evidence](verification/COMPLETION.md) names actual verification; [release acceptance](RELEASE_ACCEPTANCE.md) names remaining live and customer gates. Outcomes are explicit owner facts with correction history, not message-derived revenue. Off-app reminders, automatic business-hours policy, additional live channels and team collaboration remain outside this bounded candidate.

## Landing and workspace loading refinement - 2026-09-13

The landing walkthrough is displayed automatically. Try it out scrolls to it, Get started opens Sandbox registration, and the final Book a demo and Reach out links share the existing request form. Booking is requested, not automatically confirmed. Branded loading screens cover initial page/session loading and workspace navigation; data sections show loading feedback and background refresh retains the current content. See [current verification](verification/LANDING_LOADING.md).

## Customer settings and channel availability - 2026-09-13

Customer settings now present AI assistance and usage limits without provider catalogues, model identifiers, credentials or webhook configuration. Email reports its actual Sandbox or checked-connection status; sending policy and message approval remain separate. WhatsApp, SMS and calling explicitly state that live operation is unavailable; Telegram has no sending/reply implementation. The presence of a transport adapter is not an end-to-end product capability. Technical setup and verification remain in an explicitly enabled local developer screen under ADR-024. [Verification and remaining channel work](verification/CUSTOMER_SETTINGS.md).
