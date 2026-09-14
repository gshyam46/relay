# AI Lead Intelligence & Outbound Automation

A modular SaaS application that turns customer-owned lead data into explainable Lead Intelligence and executes policy-controlled outbound work.

Lead Intelligence is core. Outbound Automation is the execution layer. Lead Discovery is optional. Existing UI/deployment artifacts use the working brand Relay; this does not change the product identity.

## Current status

**The single-owner local product candidate now includes the complete enquiry-to-outcome workflow, interactive public landing page and operational controls. It is ready for controlled acceptance work; production and customer launch are not certified.**

Implemented: reviewed CSV import and correction, source-backed intelligence and priority, durable analysis jobs, exact message composition/edit/approval, distinct first and reply messages, conversation ownership/resolution, scheduled reminders, audited outcomes and export. Email setup and current-configuration verification cover controlled delivery, failure, reply and stop evidence. Account security provides password changes, offline recovery and session revocation.

The public page includes an interactive synthetic example and persisted pilot-interest requests. Settings includes guided setup, sending and AI limits, operational alerts, customer-data export and reviewed erasure. Schema/role checks, backup/restore tools and an isolated workload verifier support release preparation.

The [completion evidence](docs/verification/COMPLETION.md) records exact local checks and limits. Follow the [release acceptance runbook](docs/RELEASE_ACCEPTANCE.md) for actual PostgreSQL, provider, restore, operator and customer validation. Email and a single owner remain provisional pilot scope; additional live channels, team collaboration and production publication are not enabled by this work.

| Document | Purpose |
| --- | --- |
| [Completion evidence](docs/verification/COMPLETION.md) | Integrated local candidate verification and outstanding acceptance |
| [Release acceptance](docs/RELEASE_ACCEPTANCE.md) | Ordered operator checks, stop rules and pilot/public decision record |
| [Workspace data](docs/L5-04_DATA_LIFECYCLE.md) | Portable customer-data export, exact reviewed erasure and retained restrictions |
| [Pilot request operations](docs/L5-07_PILOT_INTEREST_OPERATIONS.md) | Review, close and exact expired-record purge commands |
| [Product](docs/PRODUCT.md) | Customer problem, current capability and intended product |
| [Review](docs/REVIEW.md) | Evidence-backed gaps and launch blockers |
| [Roadmap](docs/ROADMAP.md) | L0-L6 phases and release gates |
| [Tasks](docs/TASKS.md) | Current work, ownership, dependencies and acceptance |
| [Architecture](docs/ARCHITECTURE.md) | Current implementation and target boundaries |
| [Domain](docs/DOMAIN.md) | Existing and proposed contracts/state rules |
| [Decisions](docs/DECISIONS.md) | Architectural choices, alternatives and status |
| [Landing page](docs/LANDING_PAGE.md) | Interactive public-page specification, visual direction, funnel and delivery phases |
| [Persistence evidence](docs/verification/L1-03.md) | Transaction, migration and startup changes with verification limits |
| [Identity contract](docs/L2-03_IDENTITY_RESOLUTION.md) | Reviewed duplicate/shared/repeated enquiry choices and preserved source history |
| [Data-management contract](docs/L2-04_DATA_MANAGEMENT.md) | Reviewed contact correction, archive/restore, directory and selected export |
| [Analysis jobs and usage](docs/L3-03_ANALYSIS_JOBS.md) | Saved progress, cancellation/retry, model admission and optional cost estimates |
| [Channel setup](docs/L4-01_CHANNEL_SETUP.md) | Revisioned email configuration, safe route rotation, reviewed Reply-To and explicit live verification holds |
| [Feedback and evaluation](docs/L3-04_FEEDBACK_EVALUATION.md) | Saved-result reviews, frozen reply datasets, protected local replay and CI baseline checks |
| [Intelligence quality](docs/L3-02_INTELLIGENCE_QUALITY.md) | Reply attribution, bounded AI provider and reproducible synthetic evaluation |
| [Freshness contract](docs/L2-05_FRESHNESS.md) | Evidence age/conflicts, currentness explanations and guarded refresh |
| [Reviewed dispatch evidence](docs/verification/L1-04-L1-08.md) | Contact policy, exact preview/approval, provider boundary and remaining gates |
| [Execution recovery evidence](docs/verification/L1-05.md) | Retry limits, due times, exact callback outcomes, recovery UI and remaining gates |
| [Event recovery evidence](docs/verification/L1-07.md) | Durable receipts, bounded replay, contact-policy holds, owner recovery and remaining gates |
| [Scheduling evidence](docs/verification/L1-06.md) | Normal scheduler, delivery-gated workflows, bounded lead processing and remaining gates |
| [Operational evidence](docs/verification/L1-10.md) | Verified TLS/configuration, request/auth bounds, sending controls, safe logs and remaining gates |
| [Business context evidence](docs/verification/L2-01.md) | Owner setup, typed enquiry facts, precise money, history, stale analysis/review and browser checks |
| [Reviewed import evidence](docs/verification/L2-02.md) | Column mapping, correction, selected rows, resumable transactions, source linkage and browser checks |
| [Pilot](docs/PILOT.md) | Customer validation, metrics, economics and launch |
| [Testing](docs/TESTING.md) | Automated requirements and human QA |
| [Deployment](docs/DEPLOYMENT.md) | Hosting, safe verification and operations |
| [Plan verification](docs/PLAN_VERIFICATION.md) | Scope and checks for this docs-only update |

Earlier M0-M10 records remain in [history](docs/history/MILESTONES.md). The existing docs/status.html is a historical visualization until separately reconciled; the Markdown tracker is authoritative.

## Local development

Requires Node.js 24 or newer. Use synthetic data and sandbox providers until the relevant release gates pass.

From the repository root:

~~~powershell
npm.cmd ci
npm.cmd --prefix client ci --include=dev
npm.cmd run client:build
npm.cmd run db:migrate
npm.cmd start
~~~

Run db:migrate deliberately against the intended local database before first startup or after a schema update. Normal startup refuses absent, pending or incompatible migration history and applies no schema changes. The validated disposable E2E harness bootstraps only its own memory database.

The server serves the built React app at http://localhost:3000. Without DATABASE_URL, the default local database is data/app.db. npm start reads .env when present: inspect the intended environment before starting because DATABASE_URL takes precedence over the SQLite file.

The Windows npm shim can fail on an ampersand-containing project path. To check/build the frontend directly, run from client:

~~~powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
~~~

Hot reload instructions: [client README](client/README.md).

## Verification commands and scope

| Command | Behavior / caution |
| --- | --- |
| npm.cmd run ci | Syntax/format checks plus isolated SQLite tests; inherited database/provider settings are removed from test children |
| npm.cmd run smoke | Temporary SQLite API smoke with sanitized environment and sandbox controls |
| npm.cmd run client:build | React TypeScript check and production build |
| npm.cmd run verify:analysis-ui -- --playwright-module <absolute-index.mjs-path> | Actual React analysis/usage checks on an owned loopback memory fixture with an injected provider; requires an installed Playwright/browser |
| npm.cmd run verify:workflows | Requires a loopback isolated-E2E capability before creating synthetic data; refuses ordinary application servers |
| npm.cmd run verify:completion-ui -- --playwright-module <absolute-index.mjs-path> | Built composer, inbox, reminders, outcomes and recovery journey on isolated fixtures |
| npm.cmd run verify:landing-ui -- --playwright-module <absolute-index.mjs-path> | Public routes, synthetic example, request form and reduced-motion/mobile checks |
| npm.cmd run verify:workspace-data-ui -- --playwright-module <absolute-index.mjs-path> | Reviewed erasure, portable export, uncertain-request recovery and operations view |
| npm.cmd run verify:operations | Isolated 100-enquiry, two-tenant scheduler workload and alert/pause checks |
| npm.cmd run db:backup -- --source <absolute-file> --destination <new-directory> | Explicit-target local SQLite backup tool; see operational contract for arguments |
| npm.cmd run pilot:interest -- list --database-file <absolute-file> | Explicit-target operator queue and retention commands |
| npm.cmd run test:pg | Requires TEST_DATABASE_URL and TEST_DATABASE_DISPOSABLE=1; only its random run namespace is cleaned |
| npm.cmd run dev:e2e | Fresh in-memory SQLite; refuses inherited DB/provider configuration; automatic worker disabled |
| npm.cmd run db:status | Read-only migration inspection; missing SQLite files are not created; pending/incompatible schema exits nonzero |
| npm.cmd run db:migrate | Serialized schema changes; staging/production require dedicated MIGRATION_DATABASE_URL in a separate job |
| npm.cmd run verify:deploy | Read-only PostgreSQL prerequisite/schema/config verification; never applies migrations |

Do not run test/workflow verification against production or customer data. See [Testing](docs/TESTING.md) for safe targets and current tooling limits. Resetting/seeding an existing DB is not routine verification.

## Database and hosting direction

Keep PostgreSQL as the production engine; Supabase is the managed host candidate and Render is the existing application blueprint. The standard pg adapter preserves portability. MongoDB migration is not planned.

SQLite supports fast local testing. PostgreSQL integration tests are required for production concurrency. Scoped transactions and separate migration/runtime commands are implemented in [L1-03](docs/verification/L1-03.md); a short workspace transaction now commits dispatch ownership before provider I/O. Bounded leases/retries/deadlines and evidence-based recovery are implemented locally; real PostgreSQL/process/recovery acceptance in [Decisions](docs/DECISIONS.md) remains open.

Connection mode must fit the persistent Node process and network. The older blanket recommendation of transaction pooling for every web service is superseded by the deployment runbook and [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Interactive landing page

Implemented at /: a responsive interactive example with synthetic lead evidence, explained intelligence, editing/review and response states. It includes reduced-motion behavior, useful initial HTML, explicit sign-in/register routes and a saved pilot-interest request flow. The [specification](docs/LANDING_PAGE.md) and [browser evidence](docs/verification/L4-07-ui.md) describe the actual surface. Public publication still requires operational contact/privacy details and L6-04 acceptance.

## Configuration and contributions

.env.example documents current names. Secrets belong in an untracked environment file or hosting secret facility, never documentation or command arguments. Channel selection is workspace-scoped; LLM configuration currently comes from process environment. Workspace sending and AI admission quotas are implemented locally; full production operational acceptance remains open.

Follow [AGENTS](AGENTS.md), current tasks and ADR status. Implement bounded slices with updated documentation and verification evidence in the same reviewable change. Batch A covers test isolation, tenant/test-control boundaries and bounded AI grounding. L1-03 adds approval units of work and safe migration/runtime boundaries. L1-04/L1-08 add durable restrictions and immutable reviewed dispatch. L1-05 adds bounded execution recovery; L1-07 adds durable webhook and conversation-effect replay; L1-06 adds fair scheduling, bounded lead processing, sequence controls and delivery-gated advancement. L1-10 adds verified database TLS, strict configuration, bounded HTTP/auth/provider work, safe logging and durable sending controls. L2-01 adds versioned business setup and typed enquiry context, exact money/provenance, history and current-analysis/review binding. L2-02 adds reviewed CSV mapping/correction, selected transactional chunks, durable progress, duplicate holds and import-linked enquiry sources under its recorded contract. L2-03 adds reviewed identity/source decisions and shared-contact safeguards. L2-04 adds reviewed contact correction, archive/restore, paged directory and selected export under its [contract](docs/L2-04_DATA_MANAGEMENT.md) and [local evidence](docs/verification/L2-04.md). L2-05 adds deterministic evidence aging, conflict/source explanations, current analysis and guarded model/review finalisation under its [contract](docs/L2-05_FRESHNESS.md) and [verification](docs/verification/L2-05.md). L3-01 now adds configured business fit and paged priority. L3-02 adds interpretation/evaluation and L3-03 adds durable jobs, recovery and bounded AI usage. L3-04 adds exact saved-result reviews, frozen reply datasets and a pinned CI regression gate. L4-01A adds revisioned email setup, explicit signed-route provisioning/rotation and exact Reply-To review. The completion batch adds provider-proof machinery, the common composer/inbox/reminder/outcome workflow and operational tooling. Required PostgreSQL/provider/operator acceptance remains pending.

Simulation controls default off. ENABLE_TEST_CONTROLS=true permits local development/test controls; staging and production always disable them. The UI reads the authenticated server capability. Normal follow-up completion and reviewed reply composition are implemented independently from simulation controls.

L3-01 now adds explicit business-fit criteria, saved evidence-based assessments and priority within a bounded Intelligence page. See the [criteria/ranking contract](docs/L3-01_BUSINESS_FIT.md) and [verification](docs/verification/L3-01.md). Readiness and contact permission remain separate; customer-labeled usefulness and launch acceptance are still open.

The [L3-04 feedback/evaluation contract](docs/L3-04_FEEDBACK_EVALUATION.md) and [verification](docs/verification/L3-04.md) cover owner review history, explicitly nominated examples, protected local replay and CI baseline comparisons. These checks do not establish customer or hosted-model quality. Use npm run verify:feedback-ui with an installed Playwright module for the isolated browser workflow.

## Email setup and current live capability

Owners use Settings > Email to save Sandbox or provisional SendGrid configuration, then explicitly provision webhook URLs. Opening settings creates no route. Save an explanation with each change; stale forms require a fresh review. API secrets remain masked and setup history records safe before/after snapshots. A routing URL rotation preserves earlier signed aliases for late delivery and opt-out events.

Configuration completeness is not verified delivery. SendGrid dispatch requires current configuration-bound provider checks and processed signed delivery/failure/reply/stop evidence. The [verification contract](docs/L4-01_PROVIDER_VERIFICATION.md) describes the implemented flow; this repository's automated runs use synthetic adapters and have not established a live provider. Unsupported live channels/providers remain held. Sandbox is available. Global/workspace sending switches cannot override this channel hold. Exact draft review includes the configured Reply-To address. See the [contract](docs/L4-01_CHANNEL_SETUP.md) and [local verification](docs/verification/L4-01.md) for implemented bounds and open gates.

Run the focused actual React check with node scripts/run-channel-setup-ui.js --playwright-module ABSOLUTE_INSTALLED_INDEX_MJS after building the client. The launcher owns a disposable loopback fixture and uses an already installed browser; it does not install software or contact providers.

## Vercel frontend preview

The repository includes Vercel configuration for the React frontend, a bounded same-origin API gateway and an independent PostgreSQL interest intake. Missing backend access shows a coming-soon/unavailable page with explicit update opt-in. Passwords are never stored in interest records. See [Vercel setup](docs/VERCEL.md) for the required project, runtime secrets, one-time acquisition schema and verification boundaries.

## Product theme

The complete React product uses the [ivory and ultramarine design system](docs/DESIGN_SYSTEM.md), bundled Manrope/Newsreader fonts and a shared SVG Relay monogram. Browser and visual evidence is recorded in [theme verification](docs/verification/PREMIUM_THEME.md). Product identity and all account, intelligence and review contracts remain unchanged.
