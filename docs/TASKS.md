# Task Tracker

Updated: 2026-09-13. Product: **AI Lead Intelligence & Outbound Automation**.

## Current milestone

**L5 - Local candidate integration and supervised-pilot acceptance preparation.** L1-L4 and L5 engineering slices are implemented locally under their contracts. No parent phase is launch-certified while its required PostgreSQL/provider/operator/customer evidence remains missing.

## Current task

Integrated local checks are complete: 1341 automated tests passed with 49 explicit PostgreSQL skips, plus 103 browser checks. See [COMPLETION](verification/COMPLETION.md). Next execute the ordered external gates in [RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md). The user-authorized [completion plan](COMPLETION_PLAN.md) and ADR-023 cover this batch. The current candidate supports one owner and provisional Email; this does not settle the first segment/channel decision.

Local implementation includes current email verification machinery, common first/reply/edit composition and exact review, paged conversations with recorded decisions, due reminders, corrected outcomes/export, guided setup and the interactive landing/request funnel. Account recovery/revocation, runtime schema/role checks, SQLite backup/restore drills, operational status/workload measurement, customer-data export/erasure and pilot-interest triage/purge are integrated.

L4-01A is preserved as the setup subset; the continuation is [provider verification](L4-01_PROVIDER_VERIFICATION.md). Earlier evidence remains historical to its recorded candidate. Current integrated results supersede old "next task" statements without turning synthetic checks into live acceptance.

## Status and authority

- [ ] Not started.
- [~] In progress.
- [x] Complete with implementation, acceptance evidence, required automated checks, documentation, and recorded human QA.
- [!] Blocked: identify the external dependency and its owner.

Do not close a phase while required human/provider QA is pending. A tested subset may be complete without closing its parent task. New contracts described in documents remain proposals until implemented and verified. Do not weaken or delete failing tests.

[ROADMAP](ROADMAP.md) defines L0-L6. [REVIEW](REVIEW.md) records open defects. [DECISIONS](DECISIONS.md) records design status. Earlier M0-M10 implementation and verification claims remain in [history/MILESTONES.md](history/MILESTONES.md); they are not current readiness claims.

## Blockers and pending decisions

| Item | Effect | Owner / next action |
| --- | --- | --- |
| Required release evidence remains incomplete | Blocks real customer traffic, not local demonstrations | Engineering + operations: [release acceptance](RELEASE_ACCEPTANCE.md), actual PG/provider/restore and human checks |
| First segment, buyer problem and channel unvalidated | Blocks final channel/pilot commitment, not generic safety/data work | Founder: [PILOT](PILOT.md) discovery |
| Hosting accounts and real provider path unverified | Blocks live environment and delivery claims | Operations: [DEPLOYMENT](DEPLOYMENT.md) evidence |
| Cost, support, retention and recovery targets provisional | Blocks pilot/public gate sign-off | Founder + operations: agree and fund targets |
| Detailed ADRs marked proposed | Resolve affected contract/migration before dependent implementation | Integrating architect: decision and compatibility review |

The user approved proceeding after the documentation baseline. Batch A now implements runtime and test fixes with documentation updated alongside each slice. Live sends, publication, account spending and irreversible data operations need appropriate explicit scope and release gates.

## Ownership and task interpretation

ENG = integrating engineer/architect; BE = backend/domain; FE = React; AI = intelligence/evaluation; QA = verification; OPS = operations; FOUNDER = customer/commercial/launch owner. These are roles, not claims about assigned staff. Name the actual person/agent and owned files before each batch.

Each row below defines scope, dependencies, automated requirements and human QA. The implementation owner remains accountable when another role assists. Planned test scenarios T01-T22 are defined in [TESTING](TESTING.md). Every row's checks are required unless a scoped exception with rationale is recorded.

## L0 - Documentation baseline

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L0-01 [x] | ENG | Current review/source | Core docs agree; decisions, evidence, first batch and assumptions explicit; history preserved | Passed: formatting, local links, phase/task consistency, scoped diff; [evidence](PLAN_VERIFICATION.md) | Reviewable plan delivered; no live/human product QA claimed; founder choices and proposed designs remain open |

L2-02 implementation follows the [recorded contract](L2-02_REVIEWED_IMPORT.md) and [integrated verification](verification/L2-02.md). The minimal Imports UI makes mapping, correction, selected commit and recovery reviewable; it does not close broader L2-04 data work. Owner/tenant boundaries, exact sources, row transactions, restart/concurrency and actual browser behavior require automated evidence; representative operator files and real PostgreSQL remain human/external gates. L2-03 now provides explicit same-enquiry linking or separate enquiry creation, immutable source/decision history and shared-contact reply safeguards. Its [evidence](verification/L2-03.md) retains operator/PostgreSQL gates. L2-04 now provides locally verified contact correction, archive/restore and selected export; L2-05 now adds freshness/conflict currentness under its contract; L3-01 criteria/ranking, L3-02 interpretation/evaluation and L3-03 durable analysis/usage are implemented locally under their recorded contracts; L3-04 audited feedback/protected evaluation is implemented locally.

## L1 - Trust and execution

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L1-01 [~] | QA | L0-01 | E2E refuses inherited external DB/live providers; PG tests require explicit disposable target; cleanup owns only its run resources | Hostile env; concurrent test runs; cleanup/abort boundaries | Show target without credentials and unsafe-target refusal |
| L1-02 [~] | BE | L1-01 | Every tenant mutation checks authenticated ownership; production cannot invoke mock inbound/callback/global worker controls; admin operations authorized | Cross-tenant/actor spoofing; all mutation paths; production route matrix | Two-workspace adversarial walkthrough and normal-flow check |
| L1-03 [~] | ENG | L1-01; persistence ADR | Repositories share one transaction; immutable additive migrations upgrade previous schemas; runtime/readiness need no migration privilege | Multi-record rollback; old-schema upgrade; concurrent migrations; least-privilege startup | Preserve historical records through upgrade and compatible rollback |
| L1-04 [~] | BE | L1-02, L1-03 | Contact restrictions survive replies/delivery and duplicate imports; opt-out/unsubscribe/complaint stop queued work; dispatch rechecks eligibility | Suppression before/after approval/claim; duplicates; late callback; provider unsubscribe | Opt out once and demonstrate restriction across applicable contact records |
| L1-05 [~] | BE | L1-03, L1-04, L1-08; execution ADR | Durable intent precedes provider call; atomic attempt claim; bounded retries/deadline; uncertain acceptance reconciled; shutdown safe | Multi-process PostgreSQL/API-worker race; crash windows; timeout; stale lease; key expiry | Distinguish uncertain, failed, accepted, delivered; recover without blind resend |
| L1-06 [~] | BE | L1-05 | Due times honored; sequence/follow-up runners operate; failed events retry within bounds; tenant fairness | Fake clock, restart, wait steps, backoff, due lag and noisy-neighbor checks | Schedule/pause/resume without developer controls |
| L1-07 [~] | BE | L1-03, L1-04, L1-05 | Durable webhook receipt distinct from processing; duplicates resume unfinished effects; exact attempt correlation; no stale state regression | Crash after receipt; duplicate/out-of-order/wrong-attempt events | Replay callback and inspect one correct result |
| L1-08 [~] | BE | L1-03, L1-04 | Approval binds actor, recipient, sender/channel, content and policy revision; edits invalidate approval; unsafe manual sends disabled until shared composer | Approve/reject race; recipient/content change; all send-path policy parity | Revoke/edit approved action and show unreviewed content cannot send |
| L1-09 [~] | AI | L1-01 | Misleading evidence attribution rejected; fallback labeled; implied enquiry/representation/operating promises need support; uncertain safety cases escalate | Invented budget with name-only evidence; injection; opt-out; unsupported relationship claims | Review facts/inferences/unknowns and fallback provenance |
| L1-10 [~] | OPS | L1-02, L1-03 | DB TLS identity verified; unsafe production DB config refused; request/auth/provider bounds, secret protection, quota and kill-switch foundation | TLS/config errors; oversized input; auth throttling; leakage; timeout | Rotate credentials, inspect safe logs, stop new dispatch |

The local L1-05 slice adds three-attempt/one-hour bounds, persisted due times, 60-second fenced leases, exact callback state, owner recovery and graceful drain. L1-07 adds a separate five-attempt/24-hour webhook processing budget, leased replay, atomic message/task completion, conflict policy handling, 30-day terminal receipt-body purge and owner review. L1-06 adds a separate five-attempt/24-hour domain-event budget with staged commits and 120-second fences, bounded workspace/phase scheduling, exact delivered-step advancement, owner workflow controls and due-task visibility. Its local normal-server restart, clock/concurrency/fairness and recovery regressions are in [integrated evidence](verification/L1-06.md). L1-06/L1-07 stay [~] until PostgreSQL/provider/human acceptance and unresolved policy remediation are proven. The completion batch now implements due reminders and shared first/reply composition. Automatic timezone/business-hours policy remains deferred; operators choose explicit scheduled timestamps.

L1-10 adds additive migration0008, strict deployment configuration, bounded request/auth/provider work, private operational logs and transactional owner sending controls. The same authorization timestamp selects the quota day and stamps the execution; client disconnects cannot release capacity while handler work continues. [Operational evidence](verification/L1-10.md) records actual tests and the remaining acceptance checklist.

L1 exits only when all ten tasks and relevant PostgreSQL/human gates pass. Closing Batch A does not allow real customer sends.

## L2 - Business context and usable data

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L2-01 [~] | BE | L1-03; context ADR; discovery | Versioned offering/criteria profile and typed enquiry facts; provenance, dates, currency/units and unknowns explicit | Schema/role validation; revisions; monetary precision | Customer configures actual business and recognizes imported context |
| L2-02 [~] | BE | L1-03, L2-01 | Mapped/reviewable CSV; country selection; row errors; resumable transactional import with progress | Messy/local-phone CSV; partial crash; concurrent commit; caps | Correct and retry representative file; inspect import history |
| L2-03 [~] | BE | L1-04, L2-01 | Distinguish contact identity and enquiry; reviewed duplicates preserve restrictions/source; shared/conflicting contacts reviewed | Re-import, merge/link retry, two enquiries one email, shared address | Resolve duplicates without losing context or suppression |
| L2-04 [~] | BE + FE + QA | L2-01, L2-02, L2-03 | UI mapping/preview/corrections, provenance, archive and useful export | React import/edit/export; tenant access; CSV formula-safe export | First-time operator completes data work without DB/developer access |
| L2-05 [~] | AI | L2-01, L2-03 | Implemented locally: freshness/conflicts and criteria revisions invalidate analysis; [evidence](verification/L2-05.md) | Expiry/rollback, changed inputs/model races, historical/source bounds, idempotent refresh, HTTP/browser | Validate provisional age policy and explain changed recommendations; PostgreSQL/operator acceptance open |

## L3 - Grounded opportunity intelligence

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L3-01 [~] | AI | L2-01, L2-05 | Implemented locally: typed criteria, sourced fit/review outcomes and paged priority distinct from readiness/contact eligibility; [evidence](verification/L3-01.md) | Exact/source boundaries; frozen synthetic ranking vs readiness/recency; runtime/HTTP/browser | Customer labels ranking/unknown coverage and review burden; PostgreSQL/operator acceptance open |
| L3-02 [~] | AI | L1-09, L3-01 | Implemented locally: exact attribution, reply policy/review, bounded provider, visible methods and frozen synthetic evaluation; [evidence](verification/L3-02.md) | Synthetic source/reply/composer challenges; policy/replay/provider/API/browser regressions | Held-out customer/native-language labels and real-model factuality/relevance/cost remain open |
| L3-03 [~] | BE | L1-05, L1-10, L3-01 | Implemented locally: persisted jobs/progress/recovery, fenced cancellation, complete version binding and scoped AI admission/usage/optional estimates; [evidence](verification/L3-03.md) | Restart/cancel; source/version races; quotas; partial failures; API/browser; exact/unknown costs | Operator comprehension and PostgreSQL/provider reconciliation remain open |
| L3-04 [~] | AI | L3-02, L3-03 | Implemented locally: audited saved-result reviews, explicitly frozen reply datasets, protected local replay and pinned synthetic CI gate; [evidence](verification/L3-04.md). Business outcomes remain L4-05 | Exact history/retries; tenant/owner; byte bounds; source/label versions; split/consumption; aggregate projection; API/React; regression floors | Customer usefulness, independent/native-language labels, hosted-model and PostgreSQL acceptance open |

## L4 - One channel and full operator workflow

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L4-01 [~] | BE | L1 exit; primary channel decision | Setup and current-config checks/probes/signed proof machinery implemented locally; actual authorized provider delivery/failure/reply/stop acceptance pending; unsupported live capabilities disabled | Signed raw webhooks; replay/correlation; provider faults; unconfigured rejection | Real authorized test recipient send/receive and connection verification |
| L4-02 [~] | FE | L1-08, L2-01, L3-01; L4-01 contract | Shared composer across manual/recommended/bulk/reply/sequence; exact preview, edit/revoke/review and schedule; new-message identity differs from retry | React draft-edit-approve-send; revisions; duplicate click vs second message | Draft/send a first message and genuine second reply without placeholders |
| L4-03 [~] | FE | L4-01, L4-02; L5-02 access contract | Inbox reply/thread/owner/unread/resolution/escalation; opt-out not ordinary Needs reply; team assignment/handoff if agreed pilot has multiple operators | Threading; contact ambiguity; duplicate reply; unauthorized writes; handoff/role tests when multi-user | Owner resolves a reply; verify absence/recovery procedure; two-operator handoff without double response when multi-user |
| L4-04 [~] | FE | L1-06, L4-02 | Real due-time follow-up creation, notification, basic sequence enrollment, stop/pause/cancel | Clock/restart; delayed events; response cancels queued work | Customer schedules and completes follow-up in UI |
| L4-05 [~] | BE | L2-01, L4-03 | Lightweight outcome facts with owner/time/source/correction audit; existing-tool export/handoff; no activity-as-revenue inference | Outcome rules; currency precision; attribution/dedup; export scopes | Record outcome and reconcile dashboard to records |
| L4-06 [~] | FE | L2-04, L3-03, L4-02 through L4-05 | Guided setup/empty/error states, readable saved-assessment details, next step and product identity consistent | Complete React journey; keyboard/mobile; no normal-user dev controls | 100-enquiry demonstration without developer assistance |
| L4-07 [~] | FE | L2-01, L3-01; selected story and L4 workflow contracts | Modern interactive public-page prototype; synthetic evidence-to-reviewed-action example; explicit public/auth/app routes; usable mobile/reduced-motion flow | Browser behavior and no domain/provider writes; legacy deep links; TypeScript/build; initial bundle check | Target user understands value, synthetic example and review responsibility |

Email is the engineering candidate, not a validated market choice. Replace the channel-specific bundle if discovery establishes WhatsApp as essential. Do not add both by default.

L4-07 and L5-07 are public-acquisition deliverables, separate from the operational pilot exit. The [landing specification](LANDING_PAGE.md) is included by explicit user request; frontend implementation and focused browser checks are recorded in verification/L4-07-ui.md; integrated local candidate checks and publication acceptance are separated in [completion evidence](verification/COMPLETION.md). Public publication requires L5-07 and L6-04.

## L5 - Operations and supervised-pilot gate

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L5-01 [~] | OPS | L1-03, L1-05, L1-10 | Separate env/roles; monitored backups and restoration; safe migration/rollback/worker deployment; evidence recorded | Health; leastprivilege; old-data upgrade; restore integrity | Restore/rollback drill that cannot resend historical messages |
| L5-02 [~] | BE | L1-02, L1-03 | Account recovery, session revocation and enforced access permissions for every pilot; distinct accounts, invites and owner/operator/reviewer roles when multi-user | Recovery expiry/replay; access/session changes; invite and role matrix tests when multi-user | Recover account and revoke access; add/remove teammate when multi-user |
| L5-03 [~] | OPS | L1-06, L1-10, L3-03 | Agreed workload meets latency/backlog target; alerts and budgets cover provider/AI/infrastructure; tenant fairness | Load, connection limits, alert injection, cost reconciliation | Respond to alert using runbook and kill switch |
| L5-04 [~] | OPS | L2-03, L2-04, L4-05 | Data inventory, permitted processing, retention/export/deletion including derived data/attachments and suppression exceptions | Tenant export/delete; cleanup and restore/retention cases | Responsible owner reviews customer-facing data/recovery commitments |
| L5-05 [~] | QA | L4 operational exit (L4-01 through L4-06); L5-01 through L5-04 | React/PostgreSQL/provider/support journey passes functional/failure/accessibility gates | Required CI/eval/browser suites; provider contracts | Recorded live-channel, keyboard/mobile and incident walkthroughs |
| L5-06 [ ] | FOUNDER | L5-05 | Dated pilot go/no-go names scope, owner, budgets, support and remaining limitations | All gates have evidence | Founder/technical owner accept bounded pilot; no public-launch claim |
| L5-07 [~] | FE + QA + FOUNDER/OPS | L4-07, L4-06, L5-02, L5-04 | Production landing candidate with indexable static content, real qualified CTA, verified claims and privacy/support destinations | Browser/CTA failure and duplicate cases; accessibility; mobile performance; metadata/static-host checks | Visual, keyboard/screen-reader, phone and real request-delivery QA; approve supported claims |

Record single-operator or multi-user scope in the pilot agreement before L4/L5 acceptance; a single-operator pilot defers collaboration only, with an operational backup, recovery and enforced access controls still required. Do not share credentials. L5-02 access design starts during L1/L2 for approval/inbox contracts. Operations, customer discovery, budgets and provider feasibility start alongside L1; L5 proves completion instead of postponing all hardening.

## L6 - Pilot evidence and public-launch decision

| ID / status | Owner | Depends on | Acceptance | Automated checks | Human QA |
| --- | --- | --- | --- | --- | --- |
| L6-01 [ ] | FOUNDER | L5-06 | Agreed cohort/window, baseline, outcome definitions, interviews, incidents and stop rules | Metric denominators/cohorts and activity/outcome reconciliation | Observe onboarding and weekly usage; document customer results |
| L6-02 [ ] | FOUNDER | L6-01 evidence | Pricing/limits reflect total serving/support cost and willingness to pay; cancellation/support obligations operable | Usage/cost/quota reconciliation | Review paid-pilot evidence, renewal terms and sustainable support |
| L6-03 [ ] | ENG | Observed pilot problems | Fix validated workflow gaps with docs/evaluation updated and safety preserved | Affected regressions and phase gates | Pilot customer confirms problem resolved |
| L6-04 [ ] | FOUNDER | L6-01, L6-02, L5-07; required L6-03 fixes | Dated decision defines proven segment/channel, supported workload, value evidence, support and limits | Required release gates green on candidate | Launch narrow scope, extend, narrow or change hypothesis explicitly |

## First implementation batches and parallel ownership

### Batch A - Safe verification and closed access

1. Complete L1-01 first.
2. BE/QA implement L1-02 in API authorization/test-control paths.
3. AI independently implements the bounded L1-09 safety slice after L1-01.
4. ENG resolves L1-03 transaction/migration design and previous-schema fixtures. OPS prepares L1-10 configuration controls.

Demo: unsafe test target refused; cross-tenant callback denied; production mock controls inaccessible; invented model assertion cannot acquire misleading evidence.

One integration owner controls src/api/app.js, migration registry, shared contracts, package scripts and global configuration per batch. Other agents request changes to shared files rather than overlapping edits.

### Batch B - State and durable execution

The bounded local L1-03, L1-04/L1-08, L1-05/L1-07, L1-06 and L1-10 slices are integrated. Preserve their contracts and open external gates. L2-01 now implements owner business setup, typed enquiry snapshots, history and context-bound analysis/review under its recorded contract. L2-02 now proceeds under the [recorded reviewed-import contract](L2-02_REVIEWED_IMPORT.md), with separate backend, mapping/provenance and UI ownership. Mapping, correction and frozen selection precede bounded transactional commits; L2-03 now adds reviewed immutable source association and separate enquiry creation; L2-04 now provides locally verified contact correction, archive/restore, directory and selected export. L2-05 now implements freshness/conflict currentness; L3-01 configured business-fit evaluation is verified locally; L3-02 interpretation/evaluation is implemented locally; L3-03 durable analysis jobs and usage/estimates are implemented locally; L3-04 audited feedback/protected evaluation is implemented locally; L1/L2 human and external gates remain open.

Do not hold a DB transaction across a provider call. One worker replica and provider idempotency keys are not substitutes for atomic claims and uncertain-outcome recovery.

### Later batches

Select bounded tasks from the dependency tables, assign owned files, and define the demonstration first. Resolve contract dependencies before parallel implementation. Customer discovery and provider feasibility remain independent preparation streams.

## Update documentation with every implementation slice

1. Mark task in progress with actual owner, files, ADR and acceptance checks.
2. Update DOMAIN/ARCHITECTURE for affected contracts before other modules consume them.
3. Add the behavioral regression demonstrating the failure/new capability.
4. Implement; run required tests, including PostgreSQL concurrency where applicable.
5. Update PRODUCT for customer behavior, TESTING for coverage and DEPLOYMENT for operational changes.
6. Record commands/results/environment, human QA, limitations and next task under docs/verification/.
7. Close only verified scope. Keep unmet human/external checks pending.

Historical docs-only evidence: [PLAN_VERIFICATION](PLAN_VERIFICATION.md). Current implementation evidence: [COMPLETION](verification/COMPLETION.md). Never include credentials/customer contact data in records.

Every handoff reports Completed, Files Changed, Contracts Changed, Tests, Known Issues, Human QA and Next Step. Historical append-only notes do not replace current specifications.

L3-01 local implementation and verification: [contract](L3-01_BUSINESS_FIT.md), [evidence](verification/L3-01.md). Task remains [~] for customer usefulness and external acceptance.

L3-02 local implementation follows the [recorded quality contract](L3-02_INTELLIGENCE_QUALITY.md). Independent corpus expectations precede runtime fixes; customer/native-language and real-model acceptance remain open.

L3-02 local verification is recorded in its integrated evidence: final safe suite 1060 passed/42 PostgreSQL skips/0 failures; 66 distinct browser checks with build timing separated; synthetic evaluation passes with 20/46 abstentions and unmeasured customer/model quality. The task remains [~] for external acceptance. Later L3-03/L3-04 and L4/L5 implementation is recorded in the current milestone above.

L3-04 local verification:1188 safe-suite cases (1142pass/46PostgreSQL skips/0fail),17 new-flow browser checks on the final build,19 interpretation regressions on the preceding build, passing pinned synthetic gates and isolated smoke. Focused counts overlap the full suite. [Integrated evidence](verification/L3-04.md) records review fixes, source/build timing and open customer/provider/PostgreSQL gates. This is historical L3-04 evidence; current L4/L5 implementation and the built interactive landing page are recorded in [completion evidence](verification/COMPLETION.md).

## L4-06 / L4-07 presentation refinement - 2026-09-13

Implemented the user-requested automatic walkthrough, Try it out / Get started CTAs, final Book a demo / Reach out links to the existing request form, and shared public/in-app loading feedback. Dependencies are the existing public/auth route boundaries, AppShell and persisted interest intake; there are no API/schema changes. Acceptance: walkthrough requires no activation click; both contact CTAs reach the real form; delayed routes/data visibly load with navigation retained; background refresh preserves the current table; reduced motion and error recovery remain usable.

[Focused evidence](verification/LANDING_LOADING.md): 27 landing/loading, 13 customer-workflow and 15 setup/navigation browser checks passed on the final UI build, with TypeScript/build and formatting checks. Manual screen-reader, 200% zoom, actual-phone and user visual acceptance remain identified QA. This refinement does not close the external L5/L6 acceptance gates.

## Customer settings refinement - 2026-09-13

Customer settings show AI availability, usage/limits and channel availability without API credentials, provider catalogues, webhook setup or transport probes. Preserve the existing engineering panels in a separate /developer-tools screen with no customer navigation link. The server advertises availability only for an explicitly enabled non-production runtime and an authenticated OWNER; this is UI availability, not a new platform-admin role or a replacement for existing API authorization. ENABLE_DEVELOPER_TOOLS defaults false and cannot activate the screen in staging/production. Existing domain APIs, exact review, credential masking and dispatch holds remain enforced.

WhatsApp/SMS/voice have partial adapters but are not released live workflows; Telegram has no dispatch handler. Customer settings must state Live messaging unavailable (calling for voice), without connect controls or a delivery date. Email status must distinguish Sandbox, pending setup and current channel verification; verification never overrides workspace sending controls. Developer tests move to the developer route while retaining their original behavior coverage. Add customer-screen and opt-in boundary regression coverage before closing the slice.

Customer settings refinement implementation exists; [evidence](verification/CUSTOMER_SETTINGS.md) records the current tests and manual QA. No new live channel was enabled, and the presentation change does not close channel/customer/provider acceptance.

## Vercel frontend and availability fallback - 2026-09-14

In progress under the user request. Dependencies: current public/auth boundaries, persistent pilot intake and an explicitly configured Vercel project/intake database. Acceptance: standalone landing/deep links; bounded unavailable auth/onboarding states; real account errors kept separate; explicit consented interest survives backend outage; no passwords captured; same-key replay without duplicate writes; no false saved state during database failure; documented setup/operator review. Automated gateway, intake and browser checks plus actual Vercel/PG/cookie/provider-independent human QA are required. The hosted account/database configuration is not currently connected locally.

Vercel/outage slice: implementation and local focused tests are complete; [verification](verification/VERCEL_AVAILABILITY.md) and [deployment runbook](VERCEL.md) are recorded. Actual publication and durable hosted capture remain pending the intended Vercel project/account and explicitly provisioned PostgreSQL intake credentials, plus the documented live acceptance checks. This status does not close L5/L6.

## Ivory and ultramarine presentation refinement - 2026-09-14

In progress under the explicit user request. Dependencies are the shared React theme, existing public/auth boundaries and component-level interaction contracts. [Design system](DESIGN_SYSTEM.md) records palette, typography, brand asset ownership and acceptance. Automated browser regressions and visual checks are required before local completion; no API/schema changes or launch-gate closure.

Local theme implementation is complete. [Verification](verification/PREMIUM_THEME.md) records the 68 existing browser scenarios, affected landing rerun, typography/contrast/assets and desktop/phone inspection. Human design acceptance and real-device/hosted checks remain identified; this does not close L5/L6.

## Readability and walkthrough affordance refinement - 2026-09-15

In progress after user visual review. Preserve the approved theme while increasing small copy and making the walkthrough controls visually discoverable without new instruction text. Acceptance: readable labels/captions, visible control/focus/selection states, preserved mobile fit, reduced motion and existing interaction semantics. Existing browser journeys and focused visual inspection are the verification requirements. No API/schema changes.

Readability/affordance refinement is locally complete. [Theme evidence](verification/PREMIUM_THEME.md) records computed small-text sizes, hover behavior, final desktop/phone inspection and passing existing browser suites. No new instructional copy, API/schema or business behavior was introduced.
