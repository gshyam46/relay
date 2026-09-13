# Candidate acceptance and launch handoff

Recorded 2026-09-13. Product: **AI Lead Intelligence & Outbound Automation**.

This runbook turns the locally implemented candidate into a reviewable supervised-pilot decision. The current decision is **HOLD for real customer traffic and public publication** until the evidence below exists. This is not a claim of a deployed or failed production environment. [TASKS](TASKS.md) owns status; [completion verification](verification/COMPLETION.md) records executed local checks.

## Candidate scope

One current workspace owner; existing customer-owned enquiries; reviewed source/context/intelligence; Email as the provisional live channel; exact human message review; enquiry-level conversations and human reminders; owner-recorded outcomes and selected export. Lead Discovery and additional live channels remain deferred. Public / is an interactive synthetic product example with a separately persisted pilot-interest form.

No automated commercial billing, teammate invitations/handoff, promised business-hours scheduler, provider MIME threading/attachment ingestion, CRM replacement or inferred revenue is included. A reply links to an enquiry in the application; exact provider thread correlation remains an acceptance limitation. Scheduled timestamps and reminder visibility are implemented; delivery of off-app reminder/operational notifications is not.

## Ordered acceptance

Each row requires a named person, date, candidate identity, environment, result and private evidence location. Do not place credentials or real customer contact data in repository evidence.

| Order | Owner | Concrete work | Pass evidence / stop condition |
| --- | --- | --- | --- |
| 1 | Founder + customer | Choose one segment, repeatable enquiry problem, primary channel, single-owner scope and allowed data; record the baseline and measurable outcome in [PILOT](PILOT.md) | Named authorized participant and written scope; stop if the selected channel or multi-user workflow differs materially |
| 2 | Engineering + operations | Tag the reviewed source candidate; run safe full tests/evaluation, client build and relevant browser suites; configure separate staging/runtime/migration roles | Candidate-specific green evidence, documented skips and no unsupported readiness claim |
| 3 | Operations | Provision an isolated PostgreSQL target with verified TLS; execute the disposable PostgreSQL suite, populated upgrade and concurrent API/worker checks; verify actual runtime privileges | No SQLite result substitutes for PG execution. Startup/readiness must reject missing schema and unsafe deployed roles without repair |
| 4 | Operations | Rehearse restore to a new isolated target using [operations contract](L5-01_OPERATIONS.md); compare independent current erasure/suppression authority before activation | Record recovery point/time, preserved attempts/restrictions/history and no accidental send. Keep global dispatch and workers off during offline recovery |
| 5 | Channel owner + engineering | Supply owned sender/domain, monitored Reply-To, signing policies, authorized delivery/rejection mailboxes and current [provider verification](L4-01_PROVIDER_VERIFICATION.md) | Exact received draft, delivery, failure, signed inbound reply and stop; wrong signature/alias and config-change holds; no acceptance from credential presence alone |
| 6 | Operator + QA | Walk through actual React setup, realistic 100-enquiry import/correction/duplicate, explained priority, missing fact, edited approval, send/reply, due reminder and corrected outcome/export | Operator works without SQL/developer controls; complete keyboard/mobile and screen-reader review; record ambiguity/failure/recovery limits |
| 7 | Operations | Exercise [operational alerts/workload](L5-03_OPERATIONS_ACCEPTANCE.md), sending/AI pauses, unknown-outcome recovery, credential rotation and access recovery | Deployed workload/latency measured separately from local deterministic timing; named responder and reachable incident path; unknown cost remains unknown |
| 8 | Responsible data owner | Approve processing purpose, customer information, retention/suppression exceptions and export/erasure procedure under [data lifecycle](L5-04_DATA_LIFECYCLE.md) | Account retention and external/backup copies are explained; support handles held erasures; independent restore reconciliation is operable |
| 9 | Founder + technical owner | Complete the supervised-pilot decision below with limits, support coverage, incident stop rules and evidence | L5-06 remains open until signed; no open mandatory safety/operational gate is waived by a test count |
| 10 | Founder + pilot customer | Run the agreed cohort/window; compare repeated use, outcome progression, time and support/cost with the baseline | Dated real customer observations and denominators; synthetic data and message counts do not establish usefulness |
| 11 | Founder + operations | Reconcile serving/support cost and willingness to pay; choose manual pilot commercial terms or narrower scope | Exact provider/infrastructure/support costs and unknown coverage; billing automation can stay deferred |
| 12 | Founder + QA + operations | Publish accurate operator/privacy/support/terms details; verify deployed CTA queue handling and expiry purge, canonical URLs, mobile/performance and public claims | [Pilot request operations](L5-07_PILOT_INTEREST_OPERATIONS.md) has an actual owner/schedule; L6-04 decision permits only the evidenced public scope |

## Operational constraints to resolve explicitly

- Public pilot admission currently uses the socket peer for abuse limits. A reverse proxy may group visitors under one peer. Validate the selected proxy configuration and legitimate multi-visitor intake before publication; do not trust arbitrary forwarded headers.
- Account recovery is one-use offline codes with fresh login. Establish private storage, backup ownership and a response procedure before relying on a single operator.
- Workspace erasure deletes the reviewed persisted customer-data inventory, resets channel configuration and pauses dispatch. The account remains. Active/unresolved external work is a hold. An owner can deliberately create new records afterward; a pre-erasure request that has not persisted a new creation is not an erased record.
- Suppression continuity is retained. Backup archives, exported files, provider-held copies and physical storage pages are separate operational responsibilities. A verified older backup does not prove it includes later erasures or restrictions.
- The built Operations view alerts in the application. External paging, log retention/monitoring destinations and who responds outside active use require deployment acceptance.
- Contact-free enquiries can be captured for intelligence; supplied contacts remain validated. Missing contact must hold outbound until an audited correction and fresh review.
- Quiet hours, multi-user collaboration and further channels require a scoped decision if the pilot needs them; do not advertise them as implemented.

## Supervised-pilot decision record (L5-06)

Copy this section to a dated private release record. Blank fields mean **NOT ACCEPTED**.

- Decision: HOLD / GO for the explicitly bounded supervised pilot.
- Date, candidate commit/build, deployment and database version:
- Founder, technical owner, operations responder and actual customer:
- Segment/problem, primary channel, owner scope and permission-reviewed data:
- Cohort/window and baseline:
- Approved workload, sending/AI limits, monetary budget and unknown-cost handling:
- Support hours/contact, backup operator, recovery objectives and incident response:
- Evidence for each required acceptance row:
- Known limitations presented to the customer:
- Stop triggers and who can pause sending/AI or end the pilot:
- Next review date and decision owners:

## Public-launch decision record (L6-04)

Record GO / EXTEND PILOT / NARROW / CHANGE HYPOTHESIS with dated evidence. Include activated users and observation window; repeat usage; import-to-first-use time; source/factuality/relevance review burden; response/follow-up/outcome definitions and denominators; unresolved incidents; actual total serving/support costs; willingness-to-pay evidence; supported capacity/channel; publication/retention/support owner; remaining required fixes.

Set thresholds before examining pilot outcomes. [PILOT](PILOT.md) contains the experiment framework. Do not invent a price, conversion lift, testimonial, delivery guarantee or customer evidence to fill this record.

Manual lead capture does not promise durable request-key recovery. If its response is lost, the supported form holds resubmission and asks the owner to inspect the directory before deciding on a new creation. Composer, reviewed workflow and erasure commands use their separate durable identities.
