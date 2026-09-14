# Architecture and Product Decisions

Product: **AI Lead Intelligence & Outbound Automation**
Decision review: 2026-09-11

## Status and governance

This record makes the docs-first launch plan reviewable before implementation.

- **Retained direction:** already consistent with project identity and architecture.
- **Planning baseline:** the recommended scope used to organize work; it does not mean deployment, procurement, or customer validation occurred.
- **Proposed design:** a concrete change requiring the linked implementation contract/migration review and tests before adoption. Do not read it as an implemented guarantee.
- **Implemented locally:** code and local automated evidence exist under an accepted contract; named PostgreSQL/provider/human gates remain open.
- **Implemented/verified:** set only when code, automated evidence, documentation, and required human QA are complete.

Product decisions belong to the founder/product owner; persistence and execution details belong to the implementing backend owner with QA review. Owner names and evidence go in [TASKS.md](TASKS.md). Review a decision when its assumptions change, record the reason, and update linked contracts in the same change. [ARCHITECTURE.md](ARCHITECTURE.md) and [DOMAIN.md](DOMAIN.md) describe the target; task status remains authoritative.

## Batch A implementation record

2026-09-11: the user approved proceeding with the documented first batch. L1-01/L1-02 implement test isolation, tenant-scoped controls and session-derived actors. L1-09 implements a bounded portion of ADR-008: exact source selection and app-owned rendering in both default/configured paths, deterministic recommendations/planning, explicit fallback provenance and neutral copy. Shared sent/stored-copy resolution was required to prevent internal rationale appearing as a delivered message.

This changes no database schema and does not adopt the pending operational transaction/claim design in ADR-002/005. Actor correction was only the Batch A portion of ADR-004; the subsequent L1-08 adoption is recorded below. Live PG/provider, browser and human gates remain pending. [Batch evidence](verification/BATCH_A.md) owns the measured results and limitations; no ADR is promoted wholesale to implemented/verified.

## Decision index

| ID | Decision | Status | First dependency |
|---|---|---|---|
| ADR-001 | PostgreSQL on Supabase, standard driver and API ownership | Planning baseline | L1 deployment/persistence verification |
| ADR-002 | Operational transactions and narrow database-specific claims | Scoped clients, approval, dispatch/recovery and staged receipt/effects transactions implemented locally; external acceptance pending | L1 transaction/claim contract |
| ADR-003 | One customer workflow and one verified channel before expansion | Planning baseline; customer/channel validation pending | Founder discovery starts L0/L1 |
| ADR-004 | Approval binds immutable recipient/sender/content revision | L1-08 slice implemented locally; full composer and external acceptance pending | L1 revision/approval regression contract |
| ADR-005 | Durable intent, atomic leases, bounded retry and uncertain-outcome reconciliation | L1-05 bounded dispatch, fenced recovery and owner resolution implemented locally; external acceptance pending | L1, after ADR-002 |
| ADR-006 | Send-time policy and contact suppression independent of lifecycle | L1-04 restrictions and L1-07 pending-policy workspace gate implemented locally; broader policy/external acceptance open | L1 safety fix; L2 richer data migration |
| ADR-007 | Verified durable webhook inbox with exact correlation | L1-07 durable inbox, bounded replay/cursors, owner review and retention implemented locally; external acceptance pending | L1 receipt/recovery contract; L4 real channel |
| ADR-016 | Versioned lead corrections, separate archive and selected export | Implemented locally; operator/external acceptance open | L2-04 |
| ADR-015 | Reviewed enquiry identity and immutable source associations | Implemented locally; operator/PostgreSQL acceptance pending | L2-03 |
| ADR-014 | Reviewed imports and atomic resumable row outcomes | L2-02 implemented and verified locally; operator/PostgreSQL acceptance remains open | L2-02; L2-03 identity boundary |
| ADR-008 | Versioned business attributes and claim-level evidence grounding | L2-01 context/revision and bounded L1 grounding implemented locally; fit/evaluation/import and external acceptance remain open | L2 data context; L3 evaluations |
| ADR-009 | Immutable forward migrations and PostgreSQL production proof | Runner/runtime strengthening implemented locally; PostgreSQL/restore acceptance pending | L1 |
| ADR-010 | Application-owned customer loop, outcomes, and human work | Planning baseline with proposed contracts | L4 |
| ADR-011 | Operational, privacy and cost controls start before pilot | Bounded L1-10 controls implemented locally under ADR-013; wider operations/privacy/cost acceptance open | L1 continuing through L5 |
| ADR-012 | Persisted fair scheduling and staged domain-event recovery | L1-06 implemented locally; actual PostgreSQL/provider/human acceptance pending | Extends ADR-002/005/006/007 after L1-05/L1-07 |
| ADR-013 | Verified connections, bounded admission and durable sending controls | L1-10 implemented locally; deployed PostgreSQL/provider/operator acceptance pending | Extends ADR-001/002/005/009/011 after L1-06 |

## ADR-001 PostgreSQL on Supabase

**Context:** The application already has SQL repositories and a standard `pg` adapter. Leads, evidence, approvals, actions, attempts, messages, tenants, and outcomes are related and need transactional invariants. No measured requirement justifies an engine migration.

**Decision:** Retain PostgreSQL and plan managed Supabase hosting for staging/production. Keep Node API ownership and current authentication boundary. No browser database credentials, mandatory Supabase SDK/Auth migration, or MongoDB rewrite.

**Rationale/alternatives:** Another managed PostgreSQL host remains portable. MongoDB would require persistence/query redesign without addressing current execution defects. Self-hosting adds operational responsibility the pilot does not need. Flexible attributes fit JSONB while operational fields remain relational.

**Consequences:** Host selection does not fix missing transactions or tenant checks. Configure appropriate connection mode, bounded pools, verified TLS, runtime/migration privileges, and closed public Data API exposure. Supabase connection mode depends on the persistent Node host's IPv4/IPv6 capabilities. Choose region, paid capacity, recovery requirements, and spend limits during deployment planning; no plan purchase is implied.

**Implementation gate:** PostgreSQL integration/concurrency suite passes on an isolated disposable test database; migration/restore rehearsal and exposed-schema/role audit complete. Move host or add replicas only from measured cost/latency/recovery needs. This ADR does not claim a configured live Supabase project.

Sources checked 2026-09-11: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [data security](https://supabase.com/docs/guides/database/secure-data), [JSON support](https://supabase.com/docs/guides/database/json), [node-postgres TLS](https://node-postgres.com/features/ssl).

## ADR-002 Operational transactions and database-specific claims

L1-03 implementation now follows the [agreed scoped persistence contract](L1-03_PERSISTENCE.md), recorded before dependent composition changes. The user authorized continuing this slice. Status advances only for scoped evidence; the accepted [L1-05 contract](L1-05_EXECUTION_RECOVERY.md) now extends this boundary to bounded dispatch/recovery and atomic callback core effects.

**Status:** Scoped clients, approval unit of work and migration/runtime separation implemented under the recorded L1-03 contract. Local regressions are in [verification](verification/L1-03.md); real PostgreSQL/human acceptance remains pending. Dispatch, lease expiry, owner resolution and core callback transitions now use the same workspace gate under L1-05. See [L1-05 local evidence](verification/L1-05.md). L1-07 extends the same gate to receipt claims and staged callback/inbound effects under the [replay contract](L1-07_WEBHOOK_REPLAY.md); [integration evidence](verification/L1-07.md) retains the external acceptance gates.

**Conflict at review:** Earlier architecture and `src/database/database.js` said `transaction(fn)` is for migrations only and repositories share identical SQLite-compatible SQL. Multi-record approval, action claims, callback effects, and durable event publication require operational atomicity. PostgreSQL queue locking cannot be meaningfully proved by SQLite semantics.

**Smallest viable change:** Retain the async client and repository/service boundaries. Permit application units of work and narrow claim/locking methods implemented per engine. Pass the same transaction-bound client through all participating repositories. Shared CRUD SQL can remain shared.

**Alternatives:** A process mutex fails across requests/processes; pre-check then write races; strict identical SQL constrains correctness; introducing a broker does not make database transitions atomic. An ORM or microservice rewrite is unnecessary.

**Consequences:** PostgreSQL-specific locking remains below the domain layer; SQLite stays useful for fast tests but is not production-concurrency proof. Network/LLM calls remain outside transactions. Existing repositories bound to the outer pool must not accidentally bypass the unit of work.

**Implementation gate:** Before coding dependent behavior, document exact repository signatures and transaction ownership in the task. Test rollback across repositories, concurrent approval/claim/event processing, stale claims, deadlock/retry handling, and SQLite fallback behavior. Update the code contract comments alongside implementation.

Reference checked 2026-09-11: [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html). `SKIP LOCKED` is a candidate for competing queue consumers; it is not a general consistency substitute.

## ADR-003 One customer workflow and one verified channel

**Context:** Many channels and foundation modules exist; the customer still lacks a complete import-to-outcome journey. Initial market and willingness to pay remain hypotheses.

**Decision:** Complete one valuable customer-owned lead/enquiry workflow for one initial segment, on one channel actually used by those customers. Email is a provisional engineering starting point because adapters exist; it is not a validated channel-market decision. If discovery shows the chosen customers rely on WhatsApp, reassess the primary channel before L4 rather than deliver an unusable email pilot.

**Scope:** Business setup -> reviewed import -> useful prioritization -> reviewed message -> real delivery/reply -> human response/follow-up -> recorded outcome. Optional discovery, extra channels, full campaign branching, and generic CRM replication wait.

**Alternatives:** More channels create more unsupported operational surfaces; discovery cannot repair poor use of existing customer data; autonomous sending increases trust risk before value is proven.

**Implementation gate:** Record selected segment, recurring job, usable data, contact permissions, channel access, pilot partner, success metric, and willingness-to-pay evidence. Use a customer walkthrough to validate this choice. Keep unsupported channels hidden or clearly unavailable in normal production flows.

The user explicitly included a modern interactive landing page in implementation scope. [LANDING_PAGE](LANDING_PAGE.md) records the L4-07 prototype and L5-07 production funnel, with L6-04 publication. Its synthetic story explains the supported workflow; audience/channel selection, actual commercial destination and public proof remain release inputs. Proposed public/auth/app routes need an owned frontend contract review before implementation.

## ADR-004 Approval binds an immutable action revision

**Status:** L1-08 immutable revisions, exact preview/edit/decision/revoke, captured adapter dispatch and legacy review hold implemented locally under the [shared contract](L1-04_L1-08_DISPATCH.md). The completion batch implements the shared manual/reply composer and actual browser journey; real provider, PostgreSQL and human acceptance remain open.

**Context at original review:** Approval attached to an action ID and reviewer payload edits. The router resolved mutable contact/settings after review, while the manual factory used placeholder content and a fixed key. L1-08 now binds the exact captured envelope; a full new-message factory remains L4-02.

**Decision:** Persist an immutable prepared revision containing recipient/contact, sender connection, channel/type, subject/body, supported attachments, context versions, and fingerprint. Approval binds the revision and authenticated actor. Send-relevant edits require re-review; concurrent edits and decisions use expected revisions.

**Alternatives:** Approve-by-action-ID alone allows changed recipient/content; treating a button click as unrestricted approval creates inconsistent entry points. Locking the lead record until delivery is unnecessary.

**Consequences:** New manual sends receive new intent keys; request retries reuse the original key and payload hash. Reject mismatched reuse. A provider credential rotation for the same verified account may be operational; changing sender/account identity requires explicit invalidation/review rules. Do not change the approved envelope silently.

**Implementation gate:** Prove reviewed subject/body/recipient/sender equals dispatch; test contact edit, provider account change, stale revision, conflicting approve/reject, repeated request, new second message, and manual/sequence/human-reply parity. Validate how current approved actions migrate; unknown approval provenance requires review.

## ADR-005 Durable dispatch and uncertain outcomes

**Status:** Accepted L1-05 contract implemented locally, including immutable migration 0005_bounded_dispatch_recovery. See the [recovery contract](L1-05_EXECUTION_RECOVERY.md) and [verification](verification/L1-05.md). Real PostgreSQL multi-process, provider, deployment/restore and human recovery gates remain pending.

**Context at original review:** The executor called the adapter before recording an attempt, allowing competing sends. L1-04/L1-08 committed ownership before I/O. L1-05 now adds persisted bounds, fenced lease outcomes and explicit resolution of uncertainty without claiming the full inbox/operator workflow is complete.

**Decision:** Use the action/attempt records as the initial durable outbox under the workspace/action gate. Commit revision/hash/provider intent key, active execution and increasing fence before I/O. A 60-second lease owns the DISPATCHING attempt; provider requests are bounded to 15 seconds. Worker results require the same current execution/owner/fence and a live lease. No transaction remains open during the provider request.

**Retry policy:** Default to three total attempts per action and one hour elapsed from first authorization, persisted across edits/reviews/restarts. Enforce scheduled_at and next_attempt_at. Known nonacceptance can retry with persisted exponential backoff from a 30-second base, capped at five minutes, half-to-full jitter and a longer valid Retry-After. Expired budgets, invalid times and permanent failures stop work. Resend keeps identical body bytes and the same action/revision key, with a conservative persisted 23-hour first-use window that is never extended. Other providers do not gain an external idempotency guarantee from storing an application key.

**Guarantee boundary:** One current dispatch authorization owns an action; expired ownership or ambiguous acceptance cannot authorize a replacement send. There is no separately reclaimable pre-send state in this implementation. Database fencing prevents stale state writes; it cannot recall an HTTP request already in flight or promise exactly-once external delivery. Real PostgreSQL concurrency proof remains required.

**Recovery:** Expired DISPATCHING, timeout, transport loss and ambiguous server responses remain UNCERTAIN. Exact authenticated callbacks may establish terminal evidence for that attempt; they cannot overwrite newer ownership or a closed outcome. An authenticated owner may record evidenced ACCEPTED, requiring a provider reference, or CLOSE_WITHOUT_RETRY for the exact current execution/fence. Acceptance is not delivery. Both decisions preserve history and never release a resend or replenish review/retry budgets. Legacy unknown attempts remain held; invalid historical attempt numbers refuse migration rather than being renumbered.

**Shutdown:** Stop new dispatch and periodic work, drain HTTP/worker/executor activity, then close the database. The server uses a 30-second deadline; timeout leaves durable ownership for expiry/reconciliation and does not return in-flight work to RETRYING.

**Alternatives:** Holding a database transaction during HTTP increases lock exposure without solving lost responses. New provider keys per retry permit duplicate intent; blind reclaim after lease expiry cannot prove the old process stopped. A broker or single worker alone does not solve these failures.

**Acceptance gate:** Local deterministic due/backoff/budget, crash/lease/fence, exact callback and owner-resolution checks are recorded separately from real PostgreSQL races, provider retry behavior, deployment drain and human recovery demonstration. L1-07 adoption of ancillary callback repair is recorded in ADR-007; it does not authorize external resend.

Provider contracts checked 2026-09-11: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [SendGrid events](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event) and [distinct SendGrid message identities](https://www.twilio.com/docs/sendgrid/glossary/message-id).

## ADR-006 Send-time policy and independent contact permission

**Status:** L1-04 durable restrictions, workspace serialization and queued cancellation, plus L1-07 pending-policy dispatch deferral, are implemented locally. Full contact/enquiry model, evidenced re-consent, broader operating policy and external acceptance remain open.

**Context at original review:** Suppression was absent at final dispatch and ordinary replies/delivery could overwrite OPTED_OUT. L1-04 now persists independent restrictions and cancels applicable queued work; full operating policy remains the target.

**Decision:** Contact permission/restrictions, lead lifecycle, intelligence state, message delivery, and business outcome have separate ownership. Check suppression and other eligibility at dispatch authorization for every entry point. Preserve restrictions across duplicate contacts, imports, merges, replies, and delivery. Only an explicit evidenced resubscription command can clear them.

**Consequences:** Contact address presence is not permission. Define channel/all-channel scope and frequency restrictions per tenant. Explicit unsubscribe/complaint must update policy state independently of LLM classification. New ordinary inbound contact does not authorize future marketing by itself.

**Race boundary:** Receipt INSERT, suppression changes and dispatch authorization use the same workspace gate. Any receipt with mandatory policy PENDING defers dispatch without creating an attempt or permanent block; actual restrictions take priority. Suppression before authorization blocks; a request already authorized/in flight may complete and must be reported honestly while later work stops. See ADR-007 for the reviewed policy-only conflict boundary.

**Implementation gate:** Opt-out before/after approval, queued sequence cancellation, simultaneous suppression/dispatch, ordinary reply after opt-out, delayed delivery, re-import duplicate, and no automatic resubscription. Unknown historical permission is not backfilled as allowed.

## ADR-007 Verified durable webhook inbox

**Status:** Accepted L1-07 contract implemented locally, including immutable 0006_durable_webhook_receipts, bounded processing, callback/inbound cursors, owner review and normalized-body retention. See the [replay contract](L1-07_WEBHOOK_REPLAY.md) and [integration evidence](verification/L1-07.md). Real PostgreSQL multi-process/least-privilege/restore, signed provider redelivery and browser/keyboard/mobile acceptance remain pending.

**Context and adoption:** The original review found that receipt insertion alone could strand partial effects and latest-attempt matching could change newer work. L1-04 made recipient restrictions durable; [L1-05](L1-05_EXECUTION_RECOVERY.md) and its [historical evidence](verification/L1-05.md) added exact execution/fence correlation and atomic core state/audit/event changes. L1-07 now preserves that core while making interrupted conversation/follow-up and inbound effects recoverable.

**Decision:** Keep the inbox in the application database. Deduplicate an immutable normalized input using trusted workspace/provider/connection/event-family/event-ID identity plus payload hash. Current supported handlers cover SendGrid events/Parse and internal callbacks/inbound messages. Authentication and tenant resolution precede receipt storage. A provider 2xx means durable receipt, including pending/quarantined processing; failed storage requires redelivery. It does not mean delivery or completed intelligence work.

Receipt states are RECEIVED/PROCESSING/RETRY_PENDING/PROCESSED/QUARANTINED/DISMISSED, independently of mandatory_policy_status=PENDING/DONE. Defaults are five total processing attempts and 24 hours from first claim, a 60-second lease, and exponential five-second backoff capped at 300 seconds with half-to-full jitter. Claims and success/failure writes require matching owner/fence and an active lease. Fixed handlers replay idempotent local transactions; they never send another message.

**Policy correction accepted during review:** Receipt INSERT and dispatch authorization share a workspace gate. Any required policy still PENDING defers workspace sends without an attempt, budget consumption, approval reset or permanent action block. Durable restrictions remain authoritative. Callback/inbound task effects retry while policy is unresolved. A conservative workspace hold avoids a received-but-unapplied opt-out gap; a narrower contact index may be considered later if measured contention warrants it.

Changed-content conflicts preserve the original receipt and separate conflict evidence. Conflict handling is limited to mandatory policy: applicable restrictions may commit, while lead creation, callback delivery, messages, tasks and domain-event projections are excluded. Policy cannot be marked DONE simply because the input conflicts. For conflicting same-workspace action references, preserve an unambiguous recipient restriction after checking all supplied known references; known foreign references still fail before effects.

**Atomicity and intelligence boundary:** A callback's core projection/state/audit/event and PENDING cursor commit together. Its exact immutable message, original completion-based follow-up and effects marker then commit together or roll back. Current execution/fence, current/original contact restrictions, canonical replies and stopped workflows are rechecked. Stale/closed attempts retain evidence. Inbound processing first freezes canonical identity/classification, required policy and any new lead provenance; the conversation/lifecycle/task/LeadReplyReceived effects and DONE marker are a separate atomic stage. Explicit local opt-out precedes optional classification. The worker refreshes the snapshot first, including opted-out/suppressed signals, before skipping optional recommendation/planning for restricted leads or continuing the remaining stages for eligible leads; the webhook does not run those pipelines.

**Owner and retention rules:** RETRY/CLOSE requires exact expected_fence, session owner and evidence. RETRY processes unchanged input within its existing budget and cannot resend, retarget or reset counters/deadlines. Conflicting input cannot be promoted into ordinary domain processing. CLOSE requires policy DONE and no live handler; it records DISMISSED without undoing delivery or restrictions. Completed/dismissed rows cannot reopen. Bounded cleanup 30 days after processing completion or closure removes normalized bodies only for PROCESSED/DISMISSED, preserving identity/hash/state/review tombstones and all unresolved payloads.

**Unresolved-policy limit:** A quarantined policy-PENDING receipt continues to hold workspace dispatch. RETRY/CLOSE cannot repair invalid/foreign identity, waive restrictions or fabricate policy completion. Inspected operator remediation and its operational acceptance remain required before customers; this slice does not provide complete self-service recovery for every quarantine.

**Legacy policy:** Migration adds null links and LEGACY_UNKNOWN markers without inferring old effects from audits or inventing old inbox receipts. Unlinked historical projections require LEGACY_REVIEW_REQUIRED quarantine. Missing immutable internal human-task copy requires dedicated quarantine; mutable current text is never substituted.

**Alternatives:** A unique receipt alone cannot make later effects recoverable. A process mutex cannot fence other instances. A broker does not make domain writes atomic. Retrying an entire webhook with mutable current input risks duplicate tasks, changed copy and lost policy. Contact-only pending indexes add migration/identity complexity; the shared workspace hold is the smallest safe initial boundary.

**Remaining acceptance and scope:** Local crash/rollback, changed-payload, lease/fence, duplicate, policy, owner and retention checks remain distinct from real PostgreSQL/provider/human proof. L1-06 now adds normal due scheduling and managed domain-event/AI-stage retry under ADR-012 below. General thread assignment, human composer/resolution and verified customer outcomes remain L4; tenant-wide retention/deletion remains L5-04.

Reference retained from the original review, checked 2026-09-11: [SendGrid inbound webhook security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

## ADR-008 Business context and evidence-grounded intelligence

**L2-01 adoption, 2026-09-12:** The [contract recorded before implementation](L2-01_BUSINESS_CONTEXT.md) adopts a small owner-authored profile and one active enquiry context per lead. Additive0009 stores append-only revision snapshots; manual per-fact provenance distinguishes stated, observed and inferred input, unknowns and conflicts. Exact money stays validated integer-minor-unit strings in JSON/TEXT; no driver floating-point coercion. Latest revision is current, so no extra head table or organization-wide invalidation job is needed. Context versions enter current snapshot and exact-review fingerprints, model finalization rechecks them in a short transaction and old plans cannot materialize new actions. Old no-context fingerprints remain valid until a meaningful save. [Local evidence](verification/L2-01.md) records implementation and external/operator limits. Business criteria are descriptive; import identity, richer freshness and fit/priority evaluations remain later scope.

**Original review context:** Core mapped lead fields largely expressed contactability; model references did not prove support and templates could imply unsupported relationships. The bounded L1 grounding corrections and L2-01 context adoption above address parts of this finding; customer-fit/usefulness evaluation remains open.

**Decision:** Add a small versioned business profile/criteria contract and validated relevant lead attributes. Separate data readiness, qualification, confidence, and priority. Require selected assertion-level evidence, unknown/inference labels, contradictions/freshness, and safe abstention. Message claims and commitments follow the same evidence rules.

**Alternatives:** A larger model cannot recover missing customer context. A numeric completeness score renamed as opportunity quality is misleading. Unrestricted custom fields without semantics do not improve qualification.

**Consequences:** Attribute/country/date mapping and user corrections precede richer AI. Input fingerprints include business criteria and evidence versions. Treat source notes/replies/research as untrusted content, bound tools and spend, and show fallback state. Do not persist hidden chain-of-thought.

**Implementation gate:** A labelled pilot-relevant evaluation set includes incomplete/contradictory data, fabricated budget, unsupported prior enquiry/affiliation/promises, prompt injection, stale evidence, abstention, and useful next-step ranking. Schema, factuality, customer usefulness, and cost have separate acceptance checks.

## ADR-009 Forward migrations and PostgreSQL proof

**Context at review:** Only 0001_baseline_schema was registered, runtime boot applied migrations, and old notes acknowledged PostgreSQL verification gaps. L1-03 preserved that baseline and added 0002_runtime_column_reconciliation, serialized history and inspection-only startup; L1-04/L1-08 added 0003/0004. L1-05 added immutable 0005_bounded_dispatch_recovery with conservative legacy holds, execution/fence constraints and append-only owner resolutions. L1-07 adds immutable 0006_durable_webhook_receipts, receipt/review constraints and nullable legacy-safe callback/inbound cursors; it does not infer historical processing completion. L1-06 adds 0007_scheduler_event_recovery with managed event/stage/review records, persisted scheduler visits, workflow revisions/anchors and typed action links; legacy unfinished events/runs retain independent review holds. L1-10 appends 0008_operational_controls for auth admission and typed workspace controls, preserving previous migrations and domain history. Empty-schema success cannot certify an actual previous deployment.

**Decision:** Preserve the rule against editing/reordering applied migrations. Inventory existing schema versions; add explicit forward repairs, new migrations, and backfills. Separate/co-ordinate deployment migration execution and ensure the runtime has appropriate privileges. PostgreSQL is the authoritative integration/concurrency environment; SQLite remains a fast development aid.

**Alternatives:** Recreating databases loses data; pretending empty-schema tests prove upgrades hides migration defects; identical SQL is not identical concurrency.

**Implementation gate:** Fresh install, populated upgrade, interrupted migration, schema compatibility, competing startup/deploy behavior, rollback/recovery instructions, and restored backup tested. Plan exact money/currency types before outcome or usage billing data relies on globally coerced JavaScript numbers. No production readiness if PostgreSQL-required tests are skipped.

## ADR-010 Application-owned customer loop and outcomes

**Decision:** Complete reply composer, assignment/resolution, dependable due work, and lightweight outcome recording through the existing application. Use the same policy/revision/action path for manual replies. Preserve intelligence as the core decision domain; conversations and workflows feed it structured facts.

**Alternatives:** Showing a conversation history without response controls leaves daily work elsewhere. Calling provider delivery a conversion misreports value. Building a full CRM replaces rather than complements the customer's existing system.

**Consequences:** Define one workflow-specific useful outcome, its source, and attribution limits. Export/integrate where needed. A task completion is an explicit human action, not proof that a reply was sent. Operational state and business progress are distinct.

**Implementation gate:** A nontechnical pilot user completes import -> prioritization -> reviewed communication -> reply -> follow-up -> recorded outcome through the shipped React UI without developer/test controls. Unknown or failed steps present an actionable recovery path.

## ADR-011 Operations, privacy, and costs before pilot

**Decision:** Begin hardening in L1 and develop it alongside the customer loop. Initial production envelope is bounded tenants/leads/batches/sends/model spend with a named operator and pause controls. Complete backup/restore, secrets/TLS, retention/deletion/export, auth recovery/roles appropriate to pilot, audit, monitoring, and support incident procedures before L5 exit.

**Rationale:** A managed database cannot protect tenant-boundary errors, unrestricted bulk calls, leaked settings credentials, uncertain sends, or unsupported customers. A successful demo is insufficient operating evidence.

**Consequences:** Choose recovery/availability and response targets appropriate to the supervised pilot, record them as targets rather than achieved SLAs, and measure. Retention of suppression records must be reconciled with deletion/export needs for the chosen market; do not invent jurisdictional guarantees. Founder discovery includes delivery cost, AI cost, support time, channel feasibility, willingness to pay, and customer acquisition.

**Implementation gate:** Named operating owner, tested pause/recovery/restore, denied unauthorized access, bounded load/usage, secret rotation, data handling procedures, and customer onboarding/support rehearsal. L6 compares pilot outcomes and economics against agreed thresholds before public launch.


## ADR-012 Persisted scheduling and staged domain-event recovery

**Status:** Accepted docs-first [L1-06 contract](L1-06_SCHEDULING.md) implemented locally. [Integrated evidence](verification/L1-06.md) and [workflow evidence](verification/L1-06-workflows.md) record automated proof; actual PostgreSQL multi-process/least-privilege/restore, provider behavior, human/browser walkthrough and customer acceptance remain open. This supplements ADR-002/005/006/007 within the existing modular monolith and database source of truth.

**Problem:** The former explicit workflow runner was not part of normal timer work, restarted delays from a late tick, and could advance after approval or provider acceptance without delivery. Failed/interrupted lead-processing events had no dependable bounded replay. Process-local overlap checks and a globally limited queue could let one noisy workspace hide another. Durable webhook receipt was not proof that subsequent intelligence processing finished.

**Decision:** Keep three separate lifecycles: outbound dispatch, received webhook processing and domain-event processing. Add immutable migration 0007 with managed event/stage/review state, workflow revisions/anchors and typed action links, plus persisted round-robin workspace/phase cursors. Preserve unfinished legacy event/run history with explicit review holds, never fabricated completion or automatic replay.

**Event boundaries:** Five attempts and 24 hours from first claim, a 120-second owner/fence lease, five-second exponential retry capped at 300 seconds with half-to-full jitter. Prepare typed stage input inside the workspace transaction, generate outside every transaction, then finalize current validated output/artifact/audit/cursor only after exact input and parent ownership checks. Ready unchanged artifacts are reusable; changed evidence invalidates their cursor. A crash after generation can repeat a bounded model call, so model cost is not exactly once. Owner RETRY/CLOSE uses current fence, session actor and evidence without editing payloads, resetting limits or promoting legacy events. Unknown handlers quarantine; supported notifications use explicit no-op handlers.

**Intelligence and contact policy:** Snapshot refresh remains first. Durable contact restrictions across canonical duplicates are authoritative independently of coarse lead lifecycle. Restricted leads skip contact recommendation/planning; unresolved mandatory policy retries within budget. Recheck policy after generation. Reply plans do not automatically create outbound actions. No handler selected by a payload or AI output acquires application authority.

**Workflow boundaries:** One DB-only transition per selected run, no provider execution inside workflow advancement. WAIT uses persisted eligibility; SEND advances only on exact current DELIVERED execution plus COMPLETED action, with delay anchored to that persisted completion time. Task acceptance is not a human completion. Unique typed run/step action linkage, same-workspace identity and current parent/run/step state are checked before dispatch. New SEND always requires exact review. Pause preserves review and timing; revision-checked stop cancels queued work while preserving in-flight/terminal facts. Every canonical reply, including QUESTION/UNKNOWN, stops existing sequences for human review; new stop_on_reply=false is rejected and historical false flags remain conservative. This tightens human handoff without changing contact permission.

**Admission and user controls:** At most four persisted workspace visits per tick, a ten-second soft admission budget and 120-second visit lease. Rotate phases RECEIPTS/EVENTS/WORKFLOWS/FOLLOW_UPS/DISPATCH/EXPIRY with caps 2/1/2/5/2/2 and persist each successor before work. Each domain keeps its own exact claim/policy guards. Unchanged approval/acceptance waits and paused actions do not monopolize bounded queries. The owner Workflows page provides ordinary scheduling/review/pause/resume/stop; Lead processing gives safe stage/retry/review visibility. Due tasks become DUE with an audit, malformed historical dates become BLOCKED, and timers never complete tasks or send reminders. Owner follow-up complete/cancel commands apply explicit state checks with atomic audit and do not infer linked workflow human-task completion.

**Alternatives and limits:** A cron call alone cannot repair unsafe advancement or partial effects. Holding database locks through model/provider calls increases contention and does not prove an external result. Resetting retry budgets or reconstructing legacy authority risks repeated costs/actions. A broker, workflow platform or new microservice would not replace transaction, idempotency and policy requirements. This uses the existing database and adapters; actual load/p95 claims require measured PostgreSQL evidence. Full business timezone/quiet-hours, composer/thread/assignment/human completion, external notifications and customer outcome validation retain their L2/L4/L5 gates.

## ADR-013 Verified connections, bounded admission and durable sending controls

**Status:** Accepted docs-first [L1-10 contract](L1-10_OPERATIONS.md) implemented locally. [Integrated evidence](verification/L1-10.md), [database evidence](verification/L1-10-database.md), [auth/HTTP evidence](verification/L1-10-auth-http.md) and [dispatch evidence](verification/L1-10-dispatch-controls.md) separate automated proof from outstanding deployment, PostgreSQL, provider and human gates. This supplements ADR-001/002/005/009/011 without changing the modular monolith or product identity.

**Problem:** Earlier source accepted unverified TLS/plaintext deployment and hostile connection/configuration overrides, unbounded ordinary request/provider bodies, expensive auth attempts without durable admission, raw exception/dynamic-path logs, and no effective SEND pause or workspace attempt cap. A disabled interval worker could not stop manual dispatch.

**Decision:** Validate connection policy before driver creation and pass explicit fields, verified certificate/hostname trust and bounded timeout/pool controls. Refuse deployed plaintext, unknown environment modes, arbitrary URL options and ambient PG overrides. Runtime/migration credentials and timeout policies remain distinct. Keep the Node API as the sole application authority; no browser Supabase access, auth-provider migration, Redis or generic policy service is required.

**Admission:** Bound actual headers, request bodies, absolute deadlines and nonqueued process requests. Browser mutations use an explicit configured public origin; signed webhook exemptions remain exact routes, and state-changing review/token GETs receive equivalent checks pending redesign. Before password work, reserve at most two local hash slots and atomically admit fixed global/account/socket-peer windows in database rows. Typed HMAC keys protect account/peer values; the fixed global key survives secret rotation. Bound cleanup/cardinality and fail closed on corrupt/storage state. Hash outside locks, then commit registration organization/user/session/audit atomically. This does not certify network DDoS protection, constant-time login or customer account recovery.

**Sending:** Use typed workspace_dispatch_controls in immutable migration 0008, with current revision, owner reason and bounded daily/unresolved limits. The typed table refines the initial JSON-settings proposal before implementation: SQL eligibility remains explicit and portable without requiring PostgreSQL 16 JSON validation/casts or a duplicated projection. Missing row defaults to 100 attempts per UTC day and two unresolved slots; deployed global sending defaults off. Owner exact-revision updates and SEND authorization share the existing workspace transaction. One captured authorization time supplies quota inspection and execution/lease/deadline stamps, closing the independently reproduced midnight race.

Daily usage includes every SEND authorization, sandbox and retry; unresolved DISPATCHING/UNCERTAIN keeps a slot until exact outcome/evidence resolution. Ambiguous legacy work remains conservative while completed-only history does not become unrecoverable capacity. Holds consume no attempts and preserve review/history. Pauses and new days cannot reset original action budgets. Candidate admission excludes held SEND without starving other scheduler phases. These are provisional attempt/outcome limits, not money or physical-concurrency guarantees.

**Transport and evidence:** Keep provider requests outside transactions, under the same 15-second deadline with 64 KiB success-body streaming and cancellation. Known HTTP acceptance remains accepted when its body is unusable; safe bounded references and fixed response issues preserve useful diagnosis without retrying an uncertain external effect. Logs redact bounded nested fields, safe error categories and dynamic paths/tokens; arbitrary message/stack/body output is excluded.

**Alternatives:** Disabling only workers leaves manual calls active. A browser-only pause or process counter cannot govern multiple instances or restarts. Separate quota reservation and dispatch transactions can overspend the last slot. Reading a second clock for quota can charge a different day than the persisted execution. Full-body JSON parsing and client timeouts alone do not bound resource use or prove cancellation. Turning off TLS verification hides an identity failure. Adding a separate datastore would not remove these transactional invariants.

**Acceptance still required:** Actual PostgreSQL locking/timeouts/TLS/roles and restored upgrade; deployed public origin, reverse proxy/cookies, credential/CA rotation and safe logs; two-session pause/stale controls and evidence recovery; browser accessibility; selected real provider and customer loop; measured load, model/provider spend, alerts and support/restore drills. Secret-at-rest controls, complete access lifecycle, AI/monetary quotas, public landing and full composer/outcomes retain their L2/L3/L4/L5 gates. Local implementation does not close L1 or authorize a pilot.

## ADR-014 Reviewed imports and atomic resumable row outcomes

**Status:** Accepted implementation boundary, 2026-09-12, under the user's authorized continuation and [recorded contract](L2-02_REVIEWED_IMPORT.md). This adopts existing database/transaction/context decisions; external acceptance remains open.

**Problem:** CSV import currently skips user review, loses duplicate header cells, accepts malformed phone input, and writes lead/row/event separately. Interrupted work can duplicate leads, lose processing or remain COMMITTING forever.

**Decision:** Preserve positional raw cells, explicitly review mapping/date/currency/phone interpretation, retain corrections, freeze selection, and commit at most 25 complete row outcomes per request under short workspace transactions. Persist a unique scoped outcome ledger and create lead, enquiry, event, marker and audit atomically. The next request can resume COMMITTING safely because no external work occurs inside these units. A visible HELD duplicate outcome preserves source for L2-03 without creating or merging a lead.

**Provenance:** IMPORT_ROW cites an owned reviewed row and exact fact. Manual edits cannot reuse that citation for a changed value. No import grants contact permission or clears restrictions.

**Compatibility:** New explicit mappings use contract 2; compatibility contact-only requests use contract 1 with the same bounded transactional safety. Historical unfinished contract 0 batches require reviewed re-import; historical completed rows remain readable. No inferred historical event replay or destructive backfill.

**Alternatives:** A full-file transaction blocks a workspace for too long and offers no partial progress. Independent lead/event writes are not crash safe. A background queue/lease adds machinery without benefit for bounded database-only rows. Automatic duplicate merging is unsafe before enquiry/contact identity work. A separate staging datastore would break the application database's ownership.

**Acceptance:** Parser/money/date/provenance and authorization tests; atomic rollback, concurrent/resumed commits and immutable selection; browser mapping/review/correction/history; real PostgreSQL and operator acceptance remain required. Implementation evidence is recorded before closing the task.

**Verified matching refinement:** Independent review reproduced a Unicode name/company miss in database lower/trim. The L2-02 contract now records a bounded SHA-256 candidate key derived by the application, an indexed column and a frozen-algorithm forward backfill of that key only. This preserves original data and avoids database collation differences; it does not establish person identity or permission.

## ADR-015 Reviewed enquiry identity and immutable source associations

**Status:** Accepted implementation boundary, 2026-09-12, under the user's authorized continuation and [recorded contract](L2-03_IDENTITY_RESOLUTION.md). [Integrated evidence](verification/L2-03.md) records local results and remaining acceptance.

**Problem:** Duplicate import rows and late holds cannot be resolved by an operator. A shared email or phone is not a unique person or enquiry, and merging could overwrite different needs or hide contact restrictions.

**Decision:** Keep per-lead enquiries. An owner explicitly attaches an exact-contact source to the same enquiry or creates a separate enquiry with a reason. Append immutable row decisions, preserve original import outcomes, and create new lead/context/event/decision atomically. Fresh review tokens bind the current source and candidate state; identical commands are replayable. Sources are scoped and exact, never inferred from workspace ownership alone.

**Tradeoffs:** This avoids destructive merge and Person/Company/alias graphs while making repeated/shared enquiries usable. Linked facts remain source evidence until explicitly corrected into current context. Different contact pairs cannot link. Full contact correction and ambiguous provider-thread assignment remain subsequent data/inbox work.

**Reply boundary:** Shared-contact ambiguity cannot choose a lead arbitrarily. Existing directly matched sequence/no-response work stops under receipt policy before review quarantine. Replay must preserve later intentional work, and delayed callbacks must respect recorded reply ambiguity. Restrictions and in-flight delivery facts remain independent.

## ADR-016 Versioned lead corrections, separate archive and selected export

**Status:** Implemented and verified locally, 2026-09-12, under the user's authorized continuation and [recorded contract](L2-04_DATA_MANAGEMENT.md). [Evidence](verification/L2-04.md) records remaining operator/external acceptance.

**Problem:** Existing lead contact data cannot be corrected with provenance, and archive/export are incomplete. A field edit can detach a direct address restriction, misattribute corrected data to CSV, or revive old approval when values are restored.

**Decision:** Add monotonic lead data revisions and immutable change history. Preview and atomically commit explicit corrections with per-field source and carried LEAD restrictions. Archive is separate from contact/lifecycle status and stops new/queued work; restore never restarts it. Bind current intelligence/review to revision, preserving unchanged revision-0 compatibility and already-authorized delivery facts. Export explicit selections with typed facts, exact strings, bounded consistent reads and spreadsheet-safe display transformations.

**Tradeoffs:** Carrying all prior effective restrictions is conservative, including address hard bounces. Verified address replacement/resubscription needs a separate evidenced policy; ordinary editing does not grant it. No automatic merge, blanket historical data rewrite or new provider is introduced. Export is useful operational data, not a tenant backup. Real PostgreSQL, spreadsheets and operator acceptance remain open.

ADR-016 integration clarification (2026-09-12): normal late provider restriction events gain a LEAD-only EMAIL anchor for a corrected enquiry only with exact persisted send/execution/revision/recipient proof, as specified in the [L2-04 contract](L2-04_DATA_MANAGEMENT.md). The original actual-recipient restriction remains authoritative. This closes the post-correction timing gap without propagating restrictions to the new address or neighbors; wrong/unknown correlation and changed-input conflict policy retain their prior contact-scoped behavior. General historical-address/thread assignment remains later inbox work. The integration owner reviewed and accepted this bounded extension under the user's implementation authorization before source changes.

## ADR-017 Deterministic evidence freshness and durable currentness time

**Status:** Implemented and verified locally, 2026-09-12; [integrated evidence](verification/L2-05.md) retains external acceptance. Under the user's authorised continuation, the integrating owner reviewed the read-composition conflict and accepted this smallest extension before source changes. [L2-05 contract](L2-05_FRESHNESS.md) defines provisional policy, compatibility, ownership and acceptance.

**Problem:** Changed inputs invalidate analysis, but elapsed age does not. Missing observation dates can be quoted as current and currentness reads conflate outdated with never analysed. Direct model finalisation can race new research/reply input.

**Decision:** Persist bounded assessment metadata and discrete evidence authority; use existing profile/enquiry/data revisions and a provisional 90-day ongoing-fact/research policy. Unknown, inferred, conflicting and aged values stay visible without gaining factual authority. Explicit refresh does not re-date sources. Recheck actual input authority at finalisation and outbound gates.

**Read refinement:** A per-workspace durable time high-water is the only technical state currentness reads may advance, under the existing short transaction. It prevents clock rollback resurrecting expired analysis or approval. No source, model output, business artifact or audit is created by reading. This is an explicit exception to prior read-only composition wording; retaining purely read-only clock evaluation would provide weaker no-resurrection semantics.

**Tradeoffs:** A fixed TTL is provisional and must be tested with pilot customers. No criteria DSL, background analysis job, automatic source resolution, vector store or provider dependency is introduced. Historical neutral fingerprints remain compatible; affected legacy sources need explicit reassessment. PostgreSQL and customer acceptance remain separate from local evidence.

ADR-017 transaction clarification: failed authority checks preserve only the durable time observation while rolling back domain work through a workspace savepoint, as specified in the [contract](L2-05_FRESHNESS.md). The integration owner accepted this correction before implementing the shared gate; committing arbitrary caught-error work is not permitted.

## ADR-018 Explicit business criteria and independent attention ranking

**Status:** Implemented and verified locally, 2026-09-12; [evidence](verification/L3-01.md) retains customer/external gates. The [contract](L3-01_BUSINESS_FIT.md) was recorded before source changes under the user's authorized continuation. Existing decisions are preserved: modular monolith, one profile revision authority, bounded AI, deterministic policy and database-owned state.

**Problem:** Current priority measures data readiness and review needs. Descriptive profile notes are not executable rules, so complete recent records can appear more valuable without evidence of business fit.

**Decision:** Add nullable typed criteria to the existing profile revision and a deterministic, evidence-citing fit assessment to snapshots. Distinguish supported match, definite failure, unknown and manual review. Use exact owner-approved aliases, same-currency amounts and absolute date windows. Preserve unassessed prose visibly. Rank current results by explicit fit band and preference matches, with stable ID ties. Existing freshness/profile authority invalidates outdated results and reviews; criteria never authorize contact.

**Tradeoffs:** This useful finite-rule foundation abstains on unsupported language instead of guessing. It does not replace bounded AI interpretation or certify customer usefulness. General semantic criteria, predictive scoring, custom scripts and new queues are outside this slice. Hosted PostgreSQL and customer evaluation remain launch gates.

## ADR-019 Reply source interpretation and auditable quality evaluation

**Status:** Implemented and verified locally, 2026-09-12; [evidence](verification/L3-02.md) retains customer/hosted-model and external gates. The [contract](L3-02_INTELLIGENCE_QUALITY.md) was recorded before edits under the user's continued authorization. This refines the existing bounded AI/policy boundary without replacing its architecture.

**Problem:** Whole-message keywords misread negation and quoted text, miss direct contact-stop requests and discard accepted model support. Operators cannot distinguish generation methods. Synthetic tests are not customer or real-model quality evidence, and the actual model adapter lacks bounded response/deadline handling.

**Decision:** Preserve original authored evidence spans, version the reply policy, keep uncertain semantic candidates under human review, persist bounded interpretation metadata and expose it consistently. Explicit supported authored opt-outs remain deterministic; model-only possible restrictions remain conservative and visibly uncertain. Use bounded adapter transport and independently frozen synthetic challenge reports with separate unmeasured customer/model gates.

**Tradeoffs:** A finite policy lexicon and synthetic injected-model checks cannot certify general multilingual understanding. Historical classifications/restrictions remain immutable and are not reinterpreted on replay. Unknown wording can retain a bounded semantic suggestion without becoming confirmed operational intent. Resubscription, full operator inbox/composer and model-cost jobs remain subsequent work.

## ADR-020 Durable analysis intent and bounded model accounting

**Status:** Implemented locally, 2026-09-12, under continued authorization; [L3-03 contract](L3-03_ANALYSIS_JOBS.md) recorded before source edits. [Integrated verification](verification/L3-03.md) records local evidence and remaining PostgreSQL/provider/operator gates.

**Problem:** Manual bulk analysis depends on an open HTTP request, loses progress after reload and discards provider usage. Model changes are absent from synthesis reuse identity.

**Decision:** Group one existing managed event per selected lead, reuse event stages/fences/retry budgets, expose asynchronous jobs and retain tracked compatibility adapters. Fence cancelled work before any artifact/draft commit. Require durable scoped model admission, preserve late usage independently from artifact acceptance, and distinguish reported tokens, optional exact-rate estimates and unknown charges.

**Tradeoffs:** Existing event processing attempts and remote-request uncertainty remain distinct from provider billing. Local rules and configured models retain different accounting. Optional pricing does not create a hard currency budget or an invoice guarantee. Legacy synchronous clients should migrate to the job API for request-duration independence. No broker or second lease engine is introduced.

## ADR-021 Audited assessment feedback and protected local evaluation

**Status:** Implemented locally, 2026-09-12, under continued authorization; [L3-04 contract](L3-04_FEEDBACK_EVALUATION.md) recorded before runtime changes and [integrated evidence](verification/L3-04.md) retains external/human acceptance gates.

**Problem:** Source corrections do not explain which saved interpretation or recommendation was disputed. The synthetic evaluator has no operational feedback source, protected split/version history or explicit candidate-versus-baseline regression floor.

**Decision:** Append owner reviews to exact saved artifact snapshots, separate nomination from ordinary feedback, freeze explicit reply-label selections and replay bounded current local rules with aggregate-only protected holdout consumption. Add a pinned synthetic engineering regression gate to CI. Preserve source facts, canonical replies, contact restrictions and reviewed actions unchanged by feedback.

**Tradeoffs:** Owner labels are judgments, not independently adjudicated gold. A protected replay reservation is not proof that its original records were never seen. Other assessment reviews initially support engineering curation; business outcomes remain L4-05. No automatic training, raw dataset export, hosted model benchmark or runtime model promotion is introduced. Customer/native-language usefulness and PostgreSQL/provider release gates remain open.

## ADR-022 Versioned channel setup and truthful live capability

**Status:** Accepted local implementation contract,2026-09-12, under continued authorization; [L4-01A contract](L4-01_CHANNEL_SETUP.md) recorded before runtime changes.

**Conflict:** Key presence currently becomes ready, GET provisions routing, generic tokens can collide, and reviewed email drops the return mailbox. Adapter availability is broader than verified customer workflows.

**Decision:** Keep current credential storage, add revisioned owner setup and globally unique server routes, freeze configured Reply-To and guard new normal-app authorization with explicit finite capabilities. SendGrid is the engineering candidate; live dispatch remains held pending a separate provider-evidence contract. Preserve authenticated late aliases and existing execution/receipt history.

**Tradeoffs:** Structural setup does not establish provider/sender/domain/reply correctness. The explicit isolated legacy adapter test profile preserves existing transport/idempotency regressions without certifying production. No remote probe/test send, autonomous release flag, new provider, thread inference or duplicate secret store is introduced. Customer channel, provider/PostgreSQL and operator acceptance remain open.

## ADR-023 - Complete customer workflow with shared authority and a public boundary

Status: implemented locally under the accepted2026-09-13 contract and the user's explicit request to finish remaining work. [Integrated evidence](verification/COMPLETION.md) records checks and external gates. [Completion plan](COMPLETION_PLAN.md) records ownership, order and exact current contracts before edits. The existing exact action review/executor remains the sole send authority; manual/new/reply composition uses a scoped command ledger and existing immutable revisions. No duplicate approval system or provider bypass is introduced.

Public routing narrows the earlier proposed blanket /app migration: / becomes marketing, /app serves the dashboard, and existing protected deep links stay valid. This reduces bookmark/migration risk while separating public loading from authenticated modules. Explicit /login and /register preserve the current session API; registration is Sandbox setup. Public pilot interest is persisted separately and triaged operationally, without fake notification or onboarding claims. Account recovery uses password-confirmed offline codes for the single-owner pilot; email recovery and team collaboration require their own evidence/contracts. Live channel verification and external customer/production acceptance remain open.

## ADR-024 - Customer settings and developer tools

Status: accepted for implementation under the user request of 2026-09-13.

Customer settings show AI availability, usage/limits and channel availability without API credentials, provider catalogues, webhook setup or transport probes. Preserve the existing engineering panels in a separate /developer-tools screen with no customer navigation link. The server advertises availability only for an explicitly enabled non-production runtime and an authenticated OWNER; this is UI availability, not a new platform-admin role or a replacement for existing API authorization. ENABLE_DEVELOPER_TOOLS defaults false and cannot activate the screen in staging/production. Existing domain APIs, exact review, credential masking and dispatch holds remain enforced.

WhatsApp/SMS/voice have partial adapters but are not released live workflows; Telegram has no dispatch handler. Customer settings must state Live messaging unavailable (calling for voice), without connect controls or a delivery date. Email status must distinguish Sandbox, pending setup and current channel verification; verification never overrides workspace sending controls. Developer tests move to the developer route while retaining their original behavior coverage. Add customer-screen and opt-in boundary regression coverage before closing the slice.

## ADR-025 - Independent frontend hosting and outage interest capture

Status: accepted for implementation under the user request of 2026-09-14. Vercel serves the existing React/Vite build plus a bounded same-origin API gateway. The modular application, sessions, business logic and worker stay on the existing backend; no application SQLite database or worker is moved into a serverless function. Missing/unreachable backend responses produce a bounded coming-soon/unavailable flow rather than endless loading or false authentication success.

A Vercel intake path reuses PilotInterestService with a separately provisioned PostgreSQL acquisition schema and restricted credential. It operates independently of the app process; the database must still be available. Existing demo requests and explicit availability-update opt-ins use this durable store. Account creation/sign-in remain real backend operations. Passwords, session tokens and failed credential submissions never enter interest records, logs, browser storage or an automatic replay queue. Existing successful account data remain in the application database.

Interest capture requires explicit consent, exact request-key recovery, distributed admission limits and a persisted success before any confirmation. Source-specific consent versions distinguish demo, signup, signin and onboarding interest. No automatic notification is claimed; the operator reviews and contacts opted-in records. The intake store follows the existing 90-day retention policy and manual review/purge process. Deployment, the actual isolated intake database, Vercel routing/cookies and operator ownership need separate live evidence.
