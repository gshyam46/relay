# Testing and Release Evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Planning baseline: **2026-09-11**. Current phases and task ownership are in
[ROADMAP.md](ROADMAP.md) and [TASKS.md](TASKS.md).

This document separates existing checks from required launch evidence. The L0
documentation update does not implement the planned tests or certify a release.
Lead Intelligence quality, safe execution, customer usability, and operational
recovery each need independent proof.

## Current verification baseline

The preceding integrated candidate passed 1341 automated tests with 49 explicit PostgreSQL skips and 103 actual React browser checks. The subsequent frontend-only [loading and CTA refinement](verification/LANDING_LOADING.md) passed 55 focused browser checks on its own final build; the full backend suite was not rerun for this UI slice. Exact commands, candidate identity and limits are recorded in [COMPLETION](verification/COMPLETION.md). The rows below are historical baselines and tooling context; they are not the latest suite result.

| Evidence | What it establishes | Limits |
| --- | --- | --- |
| L3-01 final safe suite at concurrency 2: 1063 total, 1021 passed, 42 explicit PostgreSQL skips; 91 React browser checks; 57 workflow checks | Syntax/format, complete safe suite, final TypeScript/build and smoke pass; [evidence](verification/L3-01.md) records the prior default-concurrency TLS timeout and exact browser/build chronology | Customer ranking, real PostgreSQL/provider/operator acceptance remain open; no default-concurrency CI pass is claimed for that final invocation |
| Previous conversational review: 215 automated tests passed, four PostgreSQL-specific tests skipped | Existing local regression suite passed in that review | Not a fresh result from this documentation update; skipped PostgreSQL checks do not establish database readiness |
| Previous conversational review: 55/55 HTTP workflow checks and isolated API smoke passed | Existing API workflows can complete with sandbox data and adapters | Does not drive the React UI, prove factual AI output, exercise concurrent sends, or certify real delivery/replies |
| Previous review: direct TypeScript and Vite commands passed | Frontend typechecking and production bundling worked | The npm build encountered a Windows ampersand-path shim problem; record direct fallback separately from an npm build pass |
| Historical project notes report a full suite on a local PostgreSQL server | Earlier PostgreSQL verification was performed | Historical counts are snapshots, not the required count for a future release; see [milestone history](history/MILESTONES.md) |
| Current source inspection of `.github/workflows/ci.yml` | CI defines SQLite syntax/format/tests, a PostgreSQL 16 service job, and React typecheck/build | This is configuration evidence, not evidence that current remote CI passed |
| Current source inspection of `test/ui-layout.test.js` and `test/ui-state.test.js` | Some existing UI checks read retired `public/` files | They do not verify shipped `client/src/` interactions; isolated React browser verifiers now exist, while a dependency-locked portable browser CI job remains open |

Existing suites cover normalization/imports, evidence and intelligence versions,
planning, approvals, channel workflows, sequences, authentication, provider
mapping, and persistence. Preserve useful coverage. Replace obsolete UI coverage
only when equivalent or stronger behavior checks exist; do not delete failing
tests to obtain a green result.

The review reproduced gaps despite the baseline passing: cross-workspace legacy
callback mutation, sends after opt-out, late callbacks restoring lead status,
future actions executing early, concurrent adapter calls for one action, and
unsupported LLM assertions accepted with unrelated evidence references. The
original sources also showed callback crash windows, incomplete provider suppression,
and deployment/test-harness risks. [REVIEW.md](REVIEW.md) now separates the
historical findings from Batch A and L1-03/L1-04/L1-08/L1-05/L1-07/L1-06/L1-10 local corrections. The
verification sections below identify remaining external and recovery gates.

## Three readiness levels

| Level | Required proof | Permitted claim |
| --- | --- | --- |
| Internal sandbox | Isolated synthetic data, sandbox adapters, existing regression checks, known gaps visible | Engineering demonstration; no claim of customer readiness |
| Supervised customer pilot | L1-L5 acceptance passed, selected real channel verified, trained operator, customer consent/source policy, restore drill, funded limits, customer workflow QA | Limited use within a documented cohort, volume, channel, and support window |
| Public launch | L6 pilot evidence, unresolved-risk review, sustainable support/costs, tested account recovery and abuse controls, release sign-off | Availability for the explicitly supported customer/workflow scope |

A passing health endpoint, a successful deployment, or a high test count cannot
advance a readiness level on its own. Safety defects affecting tenant isolation,
contact eligibility, approval integrity, or duplicate sending block customer use.

## Existing commands and their boundaries

Run from the repository root with Node 24+ and installed dependencies:

~~~powershell
npm.cmd run ci
npm.cmd run smoke
npm.cmd run client:build
~~~

- ci runs syntax checks, whitespace checks and the isolated SQLite test launcher.
  npm test now invokes scripts/run-tests.js; its child receives only operating-system
  essentials and explicit test settings. Inherited DB/provider credentials, proxies
  and Node preload options are removed. This is process-environment isolation, not
  an operating-system sandbox; do not preload untrusted code into the outer Node process.
- For a targeted safe run, use node scripts/run-tests.js test/tenant-boundaries.test.js.
  Direct node --test is not the supported environment-isolation entry point.
- smoke sanitizes its environment, creates its own temporary SQLite file/server,
  enables explicit synthetic controls, and removes its owned data after completion.
- client:build runs TypeScript and Vite. On a Windows path containing an ampersand,
  an npm shim failure can be diagnosed with these direct commands from client/.
  Compilation is not browser or human QA.

~~~powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
~~~

### PostgreSQL verification

Use a dedicated disposable database, with TEST_DATABASE_URL supplied through a
protected environment/secret file and TEST_DATABASE_DISPOSABLE=1 explicitly set:

~~~powershell
npm.cmd run test:pg
~~~

The runner has no DATABASE_URL fallback and refuses the configured application
host/port/database even with different credentials. That check cannot recognize
every hostname alias or prove a target contains no customer data: a human must
verify the dedicated disposable target. TEST_DATABASE_SSL accepts enable or
disable independently of runtime DATABASE_SSL. Query/fragment overrides in the
test URL are refused.

Each run generates a unique schema namespace; file fixtures retain their schema
only across restarts within that run. Cleanup validates and removes only that
run's schemas after normal child close. Interrupted runs deliberately leave their
namespace because descendants may still be terminating; later runs never sweep
those orphans. Inspect only the printed run namespace after its processes stop.

The runner selects PostgreSQL for startClient fixtures and activates the four
adapter tests. Tests directly constructing SQLite remain SQLite tests. Use direct
or session-preserving connections for schema-scoped tests; transaction pooling
does not guarantee session search_path behavior.

Real PostgreSQL concurrency/abort tests remain pending in this batch. Docker is
installed locally but its daemon was unavailable; no application DB was used as
a substitute. PostgreSQL CI now declares disposable opt-in. Fresh-schema tests
still do not establish upgrade, operational locking, TLS or restore safety.

### HTTP workflow verification

In a clean local shell:

~~~powershell
npm.cmd run dev:e2e
~~~

In another shell:

~~~powershell
npm.cmd run verify:workflows
~~~

The E2E server defaults to port 3100 (E2E_PORT can override it), uses only fresh
SQLite :memory:, and refuses inherited DATABASE_URL, provider configuration,
production/staging mode or file overrides. It explicitly enables test controls,
keeps the automatic worker disabled and loses its synthetic data on exit.

VERIFY_BASE_URL may select a loopback HTTP origin using 127.0.0.1 or [::1].
Before any registration/write, the verifier requires the exact isolated-E2E
health capability; ordinary development/staging/production servers and redirects
are refused. It drives only its own workspace worker and synthetic callback
fixtures, including terminal-state and secret-masking checks. The isolated harness
refuses nonsandbox channel providers. Do not use this tool on customer environments.

General simulation endpoints require ENABLE_TEST_CONTROLS=true in development/test.
They remain disabled in staging/production even if that variable is supplied.
GET /api/auth/me exposes capabilities.test_controls for the React UI; authorization
and tenant scope are enforced server-side. The real selected-provider test gate
remains separate from these synthetic fixtures.

Local dev:reset and dev:seed:qa are development utilities after stopping the server
and verifying its resolved target. They are not migration, retention or recovery tools.

## Batch A regression evidence

See [L1-01](verification/L1-01.md), [L1-02](verification/L1-02.md),
[L1-09](verification/L1-09.md) and [integrated batch evidence](verification/BATCH_A.md).
The new tests exercise hostile environments, ownership/cleanup, production route
denial, foreign-state preservation, reviewer identity, mixed enrollment IDs,
grounding adversarial inputs and provider/conversation copy agreement.
Human/browser, real PostgreSQL and live-provider checks remain separately pending.

## L2-01 verification and limits

[Integrated evidence](verification/L2-01.md) records the current combined suite, scoped backend/review/API tests, isolated workflow/smoke and actual local React browser checks. Focused evidence separates [typed context and migration](verification/L2-01-backend.md), [review and generation races](verification/L2-01-review.md) and [browser/UI](verification/L2-01-ui.md). Local browser automation is distinct from real customer/operator acceptance.

Required behaviors covered include owner/session/tenant boundaries, strict full snapshots, explicit unknown/conflict/inference, source/date validation, exact money beyond Number.MAX_SAFE_INTEGER, currency precision, zero versus unknown, stale/noop updates, history pagination, composite FKs and audit rollback. Populated0008 upgrades preserve history without inventing business facts. Guarded PostgreSQL cases stay skipped without an explicit disposable target.

Context edits invalidate current fingerprint reads and old-plan materialization; generation racing a context save cannot supersede the newer result. Preview/decision/dispatch bind persisted revisions, preserve no-context compatibility and hold stale approvals before an attempt. New enquiry evidence uses exact manual-source links with stated/observed labels; inferred/conflicting or over-limit combined values require review and never become asserted buying facts.

Human QA must verify the actual business offering/criteria, source authenticity, useful correction-to-reanalysis-to-review, and comprehension of unknown/zero/conflict/inference, in addition to keyboard/mobile/accessibility. Real PostgreSQL concurrency/upgrade/restore, selected provider and pilot value remain open. L2-01 stays [~]. L2-02 reviewed mapping and resumable import is tracked in the next section.

## L1-10 verification and limits

[Integrated evidence](verification/L1-10.md) records the final combined suite, isolated smoke and 57/57 HTTP workflow checks, plus direct TypeScript/Vite build. Focused evidence separates [database/configuration](verification/L1-10-database.md), [auth/HTTP/migration](verification/L1-10-auth-http.md) and [sending/provider controls](verification/L1-10-dispatch-controls.md).

Behavioral coverage includes real loopback trusted/untrusted/wrong-host TLS, hostile configuration and ambient driver settings, transaction timeout/discard behavior, additive migration preservation, durable auth contention/restart/clock boundaries and atomic registration. Real streamed HTTP checks cover malformed/oversized/stalled input, Origin checks, forwarded-header spoofing, reader cleanup, liveness under load and safe errors/logs. The local worker route preserves empty/small-body compatibility while rejecting oversized/stalled input before effects. Disconnected handlers retain admission and keep their database alive through graceful shutdown; static mutation requests close unread input.

Sending checks cover owner/session/revision scope, pause/global holds across SEND paths, concurrent daily/unresolved capacity, exact acceptance/recovery release, old ambiguous execution evidence and retained action budgets. A regression proves quota selection and execution persistence use the same authorization instant across UTC midnight. Synthetic provider streams prove byte/deadline bounds without turning known HTTP acceptance into a resend.

Real PostgreSQL skips remain explicit. Loopback TLS is transport-policy evidence, not a deployed database/role/restore proof. Required external/human acceptance includes staging origin/proxy/cookies, credential rotation, two-session Sending controls conflicts, keyboard/mobile/error behavior, provider outcomes, measured load/cost/alerts and a recovery drill. Full account recovery and customer workflow gates remain open. L1-10 stays [~]; the next local slice records L2-01 business-context contracts.

## L1-06 verification and limits

[Integrated evidence](verification/L1-06.md) records **623 tests, 601 passed, 22 PostgreSQL skips, zero failures**, isolated smoke, 57/57 HTTP workflow checks and direct TypeScript/Vite build. Event tests cover current-input staging, model generation outside transactions, artifact/audit/cursor rollback, expired ownership at claim/commit/failure, retained budgets, canonical duplicate restrictions and pending-policy retries. Scheduler tests cover bounded tenant/phase rotation, competing visit ownership, fairness after restart and shutdown admission.

Workflow tests distinguish approval/acceptance/uncertainty from actual delivery, preserve timing across overdue waits, block invalid linkage and queued sends after pause/stop/reply, and check exact revision/tenant scope. A child-process test uses an owned temporary SQLite file, normal server worker and disabled developer controls to pause, restart and resume into review. Follow-up tests preserve due/invalid/terminal state and one audit per allowed manual transition.

The workflow verifier now allows at most 16 bounded scoped visits for reply intelligence to become current; it preserves all 57 outcome assertions. Migration fixtures check historical versions before explicitly upgrading for current runtime SQL. No PostgreSQL skip or old assertion is removed to obtain a green result. React compilation does not verify browser interaction. Required PostgreSQL multi-process/least-privilege/upgrade/restore, measured due-lag/load, live provider, schedule/recovery browser QA and customer workflow acceptance remain open. See the integrated artifact for the exact human walkthrough; the L1-10 section above records the subsequent operational implementation.

## L1-07 verification and limits

[Integrated evidence](verification/L1-07.md) records **547 tests, 531 passed, 16 PostgreSQL skips, zero failures**; isolated smoke and 57/57 HTTP workflow checks pass. Current React TypeScript/Vite builds pass with the existing large-chunk warning.

Behavior tests cover persisted receipt-before-effects, actual SQLite restart, leased concurrent replay and stale failures, immutable input conflicts, core-versus-effects rollback, exact conversation reconstruction and original task timing, later replies/restrictions, inbound classification/provenance reuse, partial batch storage, policy-pending dispatch holds, owner access/fence/idempotency, safe retention and shutdown. Reply intelligence tests establish an existing snapshot before opt-out and prove the persisted reply event updates it without new contact recommendation stages.

HTTP acknowledgement now means durable receipt. Failed restriction processing after that commit returns a pending receipt; the worker retries while workspace sends wait. Injected receipt-storage failure still returns HTTP 503. Keep both contracts in regression coverage.

Required browser/human QA covers the owner Event recovery queue, pagination, bounded previews, retry/close wording, stale decisions and refresh, keyboard/focus/mobile, policy holds and actual repair without another send. Permanently invalid/foreign pending-policy evidence requires an inspected remediation procedure before customer use. Real PostgreSQL/process/upgrade/restore and signed provider redelivery remain separate gates. The later L1-06 slice above adds bounded failed domain-event retry and scheduling/fairness; receipt replay alone did not complete that work.

## L1-05 verification and limits

[Integrated evidence](verification/L1-05.md) records the local bounded-dispatch/recovery slice: 479 tests, 466 passed, 13 PostgreSQL skips, zero failures; isolated smoke and 57/57 HTTP workflow checks pass. React direct TypeScript/Vite build passes with an existing large-chunk warning.

New behavior tests cover frozen attempt/deadline/key limits, due checks across HTTP/worker/bulk, explicit backoff clock advance, expired/stale ownership, operator recovery and queue visibility, exact callback/core rollback, reviewed-message reconstruction after uncertainty, no synthetic completion for unknown outcomes, transport Retry-After/privacy and graceful shutdown/timeout. Prior migration fixtures use their actual historical SQL shape.

The UI exposes Send details, original attempt history, retry timing and owner evidence decisions. Required browser/human QA must verify focus, keyboard/mobile, stale decisions, error refresh and the acceptance-versus-delivery distinction. Real PostgreSQL/process/provider checks remain pending; 13 skipped tests are not evidence of a pass.

This section records the earlier L1-05 evidence. The later L1-07 slice documented above adds durable receipt/processing and ancillary repair across failures. The later L1-06 slice above adds the bounded scheduler/domain-event retry/fairness implementation. The subsequent L1-10 section above records local operational controls; external acceptance remains open.

## L1-04/L1-08 verification and limits

[Integrated evidence](verification/L1-04-L1-08.md) records policy, exact review, dispatch and provider ingress checks. Tests exercise stale/missing revision tokens, changed recipient/settings, review conflicts/rollback, revoked retry, direct duplicate opt-out, historical backfill, separate SQLite connections, one provider invocation across competing dispatch calls, uncertainty held without resend, signed-byte tamper and failed unsubscribe persistence/retry.

Positive workflow fixtures explicitly obtain the preview and approve its token. Execute helpers never auto-approve. Provider transport tests use synthetic intercepted calls and captured envelope/configuration; these are not evidence of a real delivery.

React typecheck/build is required for the new review dialog/settings controls. A browser and human walkthrough must still prove every displayed field, stale-review error, edit-preview-approve/revoke interaction, keyboard/mobile behavior and received copy. PostgreSQL ordering and production-shaped upgrade/performance remain separate gates.

## L1-03 verification and limits

[Persistence evidence](verification/L1-03.md) records scoped transaction, approval, migration and runtime tests. Coverage includes real multi-repository approval rollback, concurrent decisions, non-reviewable-state guards, nested/escaped/expired transactions, SQLite file-lock contention, statement/commit/rollback failure, populated upgrades, interrupted and competing migrations, unknown history and no-DDL startup/status/readiness. The PostgreSQL suite uses the dedicated disposable harness; pool doubles and SQLite do not certify PostgreSQL isolation or restricted roles.

Keep L1-03 acceptance open until PostgreSQL integration, least-privilege deployment and a populated upgrade/compatible recovery rehearsal have recorded evidence. No customer database is a fallback test target.

## Landing-page verification: planned L4-07/L5-07

The [landing specification](LANDING_PAGE.md) defines a synthetic example and proposed public/auth/protected route split. Tests must cover visible example state, keyboard/reset/opt-out behavior, absence of domain/provider writes, real CTA success/failure/duplicate handling, protected deep-link compatibility and landing operation when API/analytics fail. Add automated accessibility and build/bundle checks, useful initial HTML/metadata and host route checks. Human QA covers screen reader, reduced motion, mobile/slow loading, target-user comprehension and actual request receipt. These checks do not exist simply because the specification lists them; public publication additionally requires L6-04.

## Required launch test matrix

Every row below is a planned requirement unless a linked task contains dated
passing evidence. QA owns the release matrix; the named engineering role owns
implementation and regression fixtures. Operations starts in L1 and is proven
as a whole in L5.

| ID / phase | Owner | Behavior and adverse cases | Passing evidence |
| --- | --- | --- | --- |
| T01 / L1 | Backend, security | Two authenticated tenants exercise every read and mutation, including legacy callbacks, worker controls, bulk IDs, approvals, settings, imports, webhook routing, and mixed-tenant child IDs | Foreign state remains unchanged; denied responses reveal no records; developer controls absent/disabled on production-shaped configuration |
| T02 / L1 | Backend | Queue, approve, then opt out before dispatch; duplicate records sharing normalized contact; unsubscribe, complaint, bounce policy; delayed success after suppression; import/reimport | Every entry point rechecks contact eligibility; suppression persists across duplicates and late events; queued follow-ups stop; explicit scoped re-consent is the only allowed reversal |
| T03 / L1 | Backend, integrations | Simultaneous API/API, worker/API and worker/worker execution; multiple processes on real PostgreSQL; lease expiry and stale worker completion | One durable claim owns the attempt before adapter invocation; no duplicate send in controlled races; stale ownership cannot commit; retry key survives restart |
| T04 / L1 | Integrations | Provider accepts then times out; crash before/after provider acceptance; HTTP 429 with retry hints, 5xx, permanent error; exhausted provider idempotency window | Unknown acceptance is reconciled or held for operator review rather than blindly resent; bounded attempts, elapsed-time/spend limits, backoff and jitter; permanent failures do not loop |
| T05 / L1 | Backend, integrations | Duplicate/out-of-order callback; callback for an older attempt; crash after receipt persistence and before business updates; replay after restart | Durable receipt can resume processing; event maps to its original attempt; transaction/replay produces one message/state transition; older events do not overwrite newer state |
| T06 / L1 | Backend | Future action via API and worker; server restart; overdue sequence wait; paused/cancelled sequence; timezone boundary and quiet hours; reply concurrent with queued follow-up | Nothing sends before eligible time; normal scheduler advances due sequences; restart recovers due work within target delay; stop policy applies at dispatch |
| T07 / L1, L4 | Backend, frontend | Change body, subject, recipient, sender, channel, business facts or policy after approval; stale browser approval; repeated click; legitimate second message | Execution uses the exact approved version or requires renewed approval; intentional new messages get new action identity; repeated requests for that version do not duplicate it |
| T08 / L1, L3 | AI, product | Name-only evidence with invented budget; contradictory/stale evidence; cross-tenant evidence; malicious instructions inside lead/import/reply text; unknown model fields | Unsupported assertions are rejected/marked unknown; claims cite supporting passages; untrusted text cannot change policy or trigger tools; tenant/context boundaries hold |
| T09 / L3, L4 | AI, product | Draft claims an enquiry, prior relationship, consent, representative role, booking availability, callback promise, discount or delivery time without evidence | No invented relationship or operating promise; deterministic templates and LLM drafts meet the same grounding checks; editable human review stays available |
| T10 / L2 | Data foundation, frontend | CSV mapping, country and date selection, budget/currency, quoted/mixed-language text, duplicate headers/contacts, malformed rows, ambiguous dates, oversized files, interruption and retry | User reviews before commit; corrections survive; selected valid rows only; actionable row errors and recovery; rerun does not create unintended leads or erase provenance |
| T11 / L2, L3 | Data foundation, AI | Correct lead data or business criteria after analysis/approval; deduplicate records with conflicting facts; preserve opt-out and interaction history | Versioned facts retain origin/time; stale intelligence and approvals are invalidated appropriately; no automatic loss of stronger suppression or audited history |
| T12 / L3, L4 | AI, product | Local languages used by pilot, transliteration, code-switching, negation, sarcasm, ambiguous intent, opt-out spelling variants, out-of-office and quoted replies | Held-out evaluation reports per-class precision/recall and opt-out misses; explicit opt-outs bypass probabilistic sending decisions; uncertain intent escalates visibly |
| T13 / L4 | Integrations, QA | Real selected provider: sender setup, reviewed send, acceptance, delivery, reply routing, operator reply, unsubscribe, complaint, bounce, invalid signature, replay and secret rotation | Dated end-to-end evidence from controlled mailboxes; no real customer recipient needed for pre-pilot verification; verified webhook origin and durable application records |
| T14 / L2-L5 | Frontend, QA | Shipped React onboarding, import review, lead correction, evidence drilldown, edit/approve/send, inbox assignment/reply/resolve, due work, outcome recording, refresh and deep links | Browser tests drive actual forms/buttons on production build; supported desktop/mobile widths; denied permissions and recovery states verified |
| T15 / L2-L5 | Frontend, QA | Keyboard-only navigation, labels, focus after dialogs/errors, contrast, zoom, screen reader announcements, long lists, empty/loading/offline states | Automated accessibility scan plus manual keyboard/screen-reader review; critical journeys usable at 200% zoom and chosen mobile viewport |
| T16 / L1, L5 | Backend, operations | Fresh DB; copy of previous release with migration already marked applied; legacy pre-runner DB; interrupted migration; two deploys; old app on expanded schema | New numbered migrations produce expected columns/indexes/data; bounded serialized migration; data preserved; rollback/roll-forward rehearsed; runtime role does not perform DDL |
| T17 / L1, L5 | Operations, backend | DB outage, exhausted pool, invalid TLS certificate/hostname, expired secret, bad runtime permissions, active worker during SIGTERM | Verified TLS fails closed; readiness reflects dependency failure; worker drains or leaves recoverable claims; restart neither loses accepted work nor duplicates it |
| T18 / L1, L5 | Operations | Restore production-shaped backup into isolated target; include attachments/config dependencies; reconcile provider sends after backup timestamp | Recorded recovery time and data-loss window meet selected RTO/RPO; restored jobs stay paused until reconciliation; counts and critical histories verified |
| T19 / L1, L5 | Backend, operations | Large tenant import/analysis/send burst while small tenants work; database limits, pagination, provider throttling, LLM spending and log growth | Measured p95 latency, queue age and per-tenant fairness within pilot targets; bounded request/input/concurrency/spend; no starvation or cross-tenant leakage |
| T20 / L1, L5 | Backend, security | Registration/login abuse, logout/recovery/session expiry, role changes, settings/secrets access, CSRF/origin handling, audit spoofing, log redaction | Server-enforced permissions; actor from session; recoverable account access; rate limits and alerts; no keys/session tokens/message bodies exposed in routine logs |
| T21 / L5, L6 | Product, operations | Workspace export/deletion, retained suppression, outcome edits, entitlement limits, support incident, failed/offline dependency | Documented retention boundaries; portable usable export; audited outcome correction; enforceable pilot caps; support can pause/resume safely |
| T22 / L6 | Product, QA | Customer completes initial workflow and repeats it with real data; recommendations compared with a simple recency/manual baseline | Pilot report measures time saved, recommendations accepted/corrected, qualified conversations and outcomes without treating message volume as value |

## Intelligence evaluation requirements

Use a versioned, consented or synthetic evaluation set representing the selected
customer workflow. Keep a held-out set separate from examples used while editing
prompts/rules. Record business-context version, model/provider version, prompt
version, dataset version, expected facts, relevant evidence spans, and reviewer
judgment.

Evaluate data readiness separately from business fit and opportunity priority.
Compare prioritization against the customer's current method and a simple
recency baseline before describing AI as an improvement. Include leads for whom
the best action is to gather data, wait, stop, or create a human task.

Proposed evaluation thresholds, to ratify on a representative dataset in L3 before L5 pilot entry:

- Zero unsupported material assertions in the release-blocking grounding suite.
- Zero missed explicit opt-outs in the release-blocking multilingual policy suite.
- Use the priority-usefulness definition and proposed 70% starting target in
  [PILOT.md](PILOT.md), with domain-reviewer labels, sample size, disagreements
  and a recency-baseline comparison. Ratify or revise the target before evaluation.
- Report precision/recall by reply class and language, not a single averaged
  score. Any policy-sensitive miss blocks release pending correction.
- Record cost and latency per analyzed lead and per refreshed conversation.
  Replaying unchanged inputs should avoid unnecessary provider charges.

These are proposed release criteria, not measured production accuracy. A finite
test set cannot guarantee zero future model errors; production correction,
suppression enforcement and uncertain-result escalation remain mandatory.

## React browser and human QA

Add a browser runner such as Playwright during implementation; no
`test:e2e` command exists today. Start with the primary workflow and the
reproduced regressions. Use actual React routes, role-based locators and
assertions about visible behavior plus persisted outcomes. Avoid HTML substring
tests and excessive snapshots of incidental layout.

The human acceptance session for L4/L5 must include:

1. A target customer configures offerings, target criteria, region, language and
   channel with clear help and meaningful errors.
2. They import a realistic 100-enquiry dataset, inspect mapped business fields,
   correct one row and resolve a duplicate without developer intervention.
3. They explain why a lead was prioritized, identify an unknown fact, and correct
   a recommendation. Data completeness is not mistaken for purchase intent.
4. They edit and approve a message, understand sender/recipient and send state,
   and verify the exact received communication.
5. They receive a reply, take ownership, send a reviewed response, complete or
   reschedule a follow-up, and record a meeting/quote/other scoped outcome.
6. They opt out a contact with pending work and duplicate records, then observe
   that scheduled work stops even after a delayed delivery event.
7. They encounter a provider failure, see what happened, and recover without
   creating an accidental duplicate message.
8. They refresh/relogin/restart and retain context; keyboard, mobile and long
   list flows remain usable.

Record participant, environment, build/commit, fixtures, date, result, defects,
and evidence links. An engineer performing a demonstration is not a substitute
for target-customer pilot validation.

## Load, recovery and release evidence

Use the proposed workload/SLO envelope in [DEPLOYMENT.md](DEPLOYMENT.md).
Measure with realistic data volumes, two or more active tenants, a noisy tenant,
cold and warm requests, and a provider stub with controlled latency/failure.
A load test with a zero-latency provider or a single empty workspace is insufficient.

Every release record must include:

- Commit/build, phase/task IDs, environment and database major version.
- Commands and results, including failures, skipped tests, and test artifacts.
- Migration upgrade fixture and applied versions.
- Provider/model mode, synthetic versus live controlled-mailbox evidence.
- Human QA and customer pilot status, separately.
- Monitoring, backup restore and rollback evidence where applicable.
- Known issues, scope/volume restrictions, owner and next action.
- Documentation updated alongside implementation: architecture/domain decisions,
  task acceptance and this matrix, API/schema examples, deployment runbook and
  README where affected.

Documentation-only work requires link/consistency/format verification. Runtime,
integration, browser, live-provider, and restore checks are not to be marked
passed merely because this plan has been written.

## L2-02 reviewed import verification

[Integrated evidence](verification/L2-02.md) records exact local checks and remaining acceptance. Required coverage includes positional duplicate/blank/reserved headers, malformed quoting, caps, phone/date/currency interpretation, exact money, raw-cell preservation, row correction/history and stale review; owner/tenant/source forgery; atomic preview and row rollback; concurrent frozen selection, response loss and restart/resume; late duplicate holds and suppression preservation; additive migration and guarded PostgreSQL checks.

Actual React browser verification drives inspection, mapping, review without automatic lead creation, row selection/correction, progress/history and imported-source manual correction. A production build is checked separately. Synthetic local browser results do not close customer/operator, mobile/screen-reader or real PostgreSQL acceptance. The optional browser script requires an explicit installed Playwright module and a verified disposable loopback E2E target; it is not a new dependency-locked portable CI browser job.

## L2-03 verification and limits

The [identity contract](L2-03_IDENTITY_RESOLUTION.md) defines source association, exact review, unchanged historical outcomes and shared-contact reply stops. [Integrated evidence](verification/L2-03.md) tracks owner/tenant routes, repeated/shared/in-file enquiries, preserved restrictions and current facts, stale/retry/conflicting commands, transactional rollback/restart, exact citation authority, migration constraints and reply/callback races. Actual React browser checks are separate from build/typecheck and human acceptance.

Use node scripts/run-tests.js test/import-identity-http.test.js for the root HTTP journeys, or the documented safe full CI command. PostgreSQL tests remain skipped without an explicit disposable target. Representative customer files, linked-source comprehension, ambiguous reply handling, keyboard/mobile/accessibility and selected-provider threading remain required human/external checks.

## L2-04 correction/archive/export verification

The [contract](L2-04_DATA_MANAGEMENT.md) and [integrated evidence](verification/L2-04.md) cover reviewed contact correction, exact actor/source history, stale and replayed decisions, archive/restore, directory pagination and explicit-selection export. Run node scripts/run-tests.js test/lead-data-http.test.js test/csv-export.test.js for root integration checks; the safe full CI command also includes module regressions.

Required runtime coverage includes revision-0 upgrade compatibility; edit-back/archive-restore invalidation; stale-input and in-generation races; contact restriction carry at the original channel scope; queued-work cancellation without changing authorized provider facts; late callback suppression of obsolete tasks; archived reply/event handling without new work; and tenant/owner/bounds/rollback/restart cases. New migration and PostgreSQL cases use the explicit disposable gate.

Actual React verification must exercise correction preview/history/stale draft, archive and restore, hidden selected records, paged directory and the downloaded selected CSV. Spreadsheet formula/control/Unicode quoting and exact underlying money/contact strings require automated checks; Excel/LibreOffice open/save/reopen, real PostgreSQL/provider and first-time customer acceptance remain separate human gates. Build/typecheck alone does not satisfy the browser journey.

## L2-05 freshness verification

The [contract](L2-05_FRESHNESS.md) and [integrated evidence](verification/L2-05.md) track exact expiry, durable rollback/restart, source timestamp validity, missing/conflicting/inferred facts, changed criteria/contact/research/reply, unchanged refresh and neutral legacy compatibility. Test source bounds and corrupt metadata before model use, plus time/input races at model finalisation, review, dispatch and late callbacks.

Use node scripts/run-tests.js test/intelligence-currentness-http.test.js for root API cases. Backend/runtime focused tests and full safe CI also verify no duplicate analysis audits and no stale external action. Actual React checks cover currentness, fact issues, previous recommendations, partial failures and timed GET-only rechecks. Operator comprehension, provisional TTL usefulness, mobile/accessibility, real PostgreSQL and deployment clock/restore remain external acceptance.

## L3-01 qualification and ranking verification

Use the [frozen contract](L3-01_BUSINESS_FIT.md) and [integrated evidence](verification/L3-01.md). Exact decimal/date/text and source-freshness boundaries, shared-profile stale writes/history/rollback, corrupt assessment handling, criteria/algorithm authority, bounded scoped paging and downstream review safety require behavioral coverage. Synthetic fixtures compare business ordering against recorded-event recency and existing readiness; report each denominator and abstention, not customer conversion or calibrated model claims. Browser checks must drive actual criteria setup, history, source review and ranking, retain explicit refresh/selection recovery, and verify no provider execution. Customer usefulness, held-out factuality/multilingual cases and actual PostgreSQL remain independent gates.

## L3-02 quality and interpretation verification

Run npm run eval:intelligence for the fixed synthetic report and node scripts/run-tests.js test/l302-provider.test.js test/l302-interpretation-view.test.js test/l302-reply-policy.test.js test/l302-reply-runtime.test.js test/l302-evaluation.test.js for focused behavior. Both launchers sanitize inherited database/provider configuration. The evaluator uses frozen bundled fixtures and injected adapters; it is not a live model benchmark. [Integrated evidence](verification/L3-02.md) records final commands, counts and human gates; [evaluation detail](verification/L3-02-evaluation.md) explains denominators and grader semantics.

Required coverage includes direct/negated/quoted/mixed/multiline replies, finite Hindi and transliterated stops, semantic/body limits, exact source attribution, disagreement/candidate review, immutable replay and restriction effects, malformed provider envelopes, stream deadlines and safe failures. Browser evidence must use actual persisted fixtures and exercise model/local/fallback/history displays, original text, source links and independent stop/review labels. Human/native-language/customer labels and hosted-model quality, latency and cost remain NOT_MEASURED until separately authorized evidence exists.

## L3-03 analysis jobs and AI usage verification

Use node scripts/run-tests.js test/l303-migrations.test.js test/l303-http.test.js test/l303-analysis-jobs.test.js test/l303-analysis-http-race.test.js test/l303-analysis-runtime.test.js for migration/job/API/normal-server behavior; the AI owner's focused commands and results are in [usage evidence](verification/L3-03-usage.md). Run the full sanitized suite after integration. PostgreSQL cases explicitly skip without a disposable configured target; SQLite transactions do not certify PostgreSQL multi-process behavior.

Required cases include atomic selection/idempotency, workspace boundaries, real database close/reopen, stale lease/cancel during generation and pre-draft commits, partial retry/reuse, original budgets, changed source/complete generation manifest, metadata caps and audit rollback. Final compatibility responses must match the job's exact artifacts even if a newer analysis becomes current before response composition.

Usage checks exercise committed permits before I/O, concurrent slot/day limits, rollback/midnight, stale origins, crash/late observation, immutable pricing revisions and exact rounding, reported zero versus unknown counts, malformed output after telemetry, and failure to persist accounting. Workspace admission/quota denial must not produce a READY fallback; direct opt-outs must not depend on model availability.

Run npm.cmd run verify:analysis-ui -- --playwright-module <absolute-installed-Playwright-index.mjs-path> after building the client. The tracked launcher sanitizes configuration and chooses an owned ephemeral loopback port; it installs no package/browser. The actual React verifier is scripts/verify-analysis-jobs-ui.js with its isolated synthetic provider fixture. It may pump only AnalysisRequested events, never the broad outbound worker. Check lost POST response/reload/GET recovery, explicit same-key resubmission, progress/partial recovery/cancel, unchanged reuse, stale command drafts, owner limits/history and unknown/estimated usage. Retain business-context/fit/currentness/data/trust browser regressions. [Integrated evidence](verification/L3-03.md) records the final commands and limits; customer/operator, real provider and PostgreSQL acceptance remain separate.

## L3-04 feedback and evaluation verification

Run the safe harness: node scripts/run-tests.js --test-concurrency=2 test/l304-feedback.test.js test/l304-migrations.test.js test/l304-http.test.js test/l304-evaluation-runtime.test.js test/l304-evaluation-gate.test.js. Never invoke the raw Node test runner with inherited database/provider settings. Migration checks cover populated history, scoped typed references, UTF8 bounds and transactional rollback. Feedback checks cover read-only review, token/revision races, exact retries after later edits, withdrawal/restoration, original-input integrity and zero operational side effects. Evaluation checks cover exact selection/version identity, eligibility/byte preflight, permanent split assignment, one-use HOLDOUT, atomic consumption/audit, historical label currentness and aggregate-only API projections.

npm run eval:intelligence -- --check now recomputes current behavior against pinned baseline-v1.json as well as all prior synthetic safety gates. Both npm run ci and GitHub SQLite CI run it. An arbitrary supplied report cannot satisfy the gate. Customer/hosted-model and language-generalization claims remain out of scope. The actual React workflow verifier is npm run verify:feedback-ui -- --playwright-module ABSOLUTE_INSTALLED_INDEX_MJS; it uses an owned memory fixture, existing installed browser and no provider calls. [Integrated evidence](verification/L3-04.md) records executed checks and remaining human/PostgreSQL gates.

## L4-01A email setup and capability verification

Run node scripts/run-tests.js --test-concurrency=2 test/l401-channel-migrations.test.js test/l401-email-connection.test.js test/l401-channel-http.test.js test/l401-channel-capability.test.js, then the full sanitized suite after integration. Migration coverage includes historical-setting preservation, unique alias ownership, scoped actor/revision constraints, byte bounds and rollback. Real PostgreSQL cases retain the explicit disposable-target gate.

Behavioral checks cover read-only setup/legacy GETs, full strict saves, masked secret KEEP/CLEAR, stale revision/config tokens, atomic history/audit, original request recovery, canonical URL provisioning, legacy ambiguity and reserved drift, signed late aliases, and configuration budgets before reads and writes. Preparation and dispatch checks cover exact Reply-To, complete-but-unverified SendGrid with zero new attempts, unsupported live channels and immutable normal/test runtime profiles. Compatibility webhook fixtures explicitly provision routes; old assertions remain intact.

Run npm.cmd run verify:channel-setup-ui -- --playwright-module ABSOLUTE_INSTALLED_INDEX_MJS after building the client. The owned loopback browser fixture uses Sandbox mutations, readonly synthetic SendGrid setup and no provider sends. Verify lost-response recovery, stale forms, route rotation/history, keyboard/narrow layout and the exact saved Reply-To. Any intercepted presentation check must be reported separately from real API checks. See [integrated evidence](verification/L4-01.md) for executed counts, artifacts and limitations. Human channel selection, provider/security-policy/mailbox setup, exact enquiry threading and PostgreSQL/restore remain open.

## Completion batch verification - 2026-09-13

Run the safe suite wrapper for all new tests. test/completion-http.test.js currently exercises public-interest admission/idempotency, composer creation/edit/recovery, offline account recovery/session revocation, conversation decisions, reminders and corrected outcomes through HTTP. scripts/run-completion-ui.js exercises the actual built composer/inbox/workflow/security journey on an owned in-memory fixture; scripts/run-landing-ui.js exercises public routes, synthetic demo and pilot form. Both require the explicit installed Playwright module path and prohibit live providers. Focused backend and landing evidence lives under verification/L4-02-composer.md, verification/L4-03-customer-workflow.md, verification/L4-07-ui.md and verification/L5-02-account-security.md. The final integrated suite and actual-browser candidate checks are recorded in [COMPLETION](verification/COMPLETION.md). Focused counts overlap the full suite and are not additive. Actual PostgreSQL/provider/customer gates remain separate.

Additional tracked safe browser launchers are verify:setup-journey-ui, verify:intelligence-trust-ui, verify:workspace-data-ui and verify:email-verification-ui, each requiring the explicit installed Playwright module path. The provider-screen fixture injects a synthetic HTTPS verification runtime and no-network configuration adapter while serving the actual React/API locally; this tests interface/service behavior, not provider HTTPS or mailbox acceptance. Run node scripts/verify-operations.js for the isolated measured workload.

## Customer settings refinement - 2026-09-13

[Customer settings evidence](verification/CUSTOMER_SETTINGS.md) records the subsequent default-off developer-screen boundary, customer availability UI and preserved technical workflow tests. Seven new boundary regressions are included in 77 passing targeted backend tests. Technical browser launchers now explicitly enable the separate local developer UI; ordinary customer launchers do not. Earlier full-suite/browser evidence remains tied to its recorded build.

Final customer-settings candidate: 67 browser checks passed (17 setup/customer, 20 channel setup, 12 email verification, 18 analysis); TypeScript/build and formatting passed. See the focused evidence for asset identity and local artifact directories.
