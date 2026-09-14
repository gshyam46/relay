# AI Lead Intelligence & Outbound Automation - React Client

The shipped frontend lives here. The Node server serves client/dist. The root public/ frontend is retired, though some legacy tests still inspect it.

Read the [root README](../README.md), [product](../docs/PRODUCT.md), and [tasks](../docs/TASKS.md).

## Development

From this directory:

~~~powershell
npm.cmd ci --include=dev
npm.cmd run dev
~~~

Vite runs on port 5173 and proxies /api to port 3000. Start the backend separately with a deliberate local/sandbox environment; inherited DATABASE_URL overrides SQLite. Run npm.cmd run db:migrate deliberately from the root before first startup/schema updates; normal npm start no longer migrates.

For browser hot reload, set PUBLIC_APP_ORIGIN=http://localhost:5173 in the backend's local environment and restart the backend. The trusted origin must match the browser address; localhost and 127.0.0.1 are different origins. When returning to the built app on port 3000, set the origin back to http://localhost:3000 (or remove the local override to use that default) and restart. Do not weaken Origin validation to support development.

Build from the root using npm.cmd run client:build. If the Windows shim mishandles the ampersand in this folder path, run from this directory:

~~~powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
~~~

## Customer workflow

Routes include Dashboard, Leads, Intelligence, Outbound, Conversations, Event recovery for owners, Activity, Settings and a tabbed lead record. Their existence does not establish workflow completeness. Imports now has a mapped review/correction/selected-commit journey. Common composition, inbox replies/ownership, broader data work and outcomes remain planned work.

Keep customer language clear. Simulations are not real outreach or business outcomes. Conversations and Outbound show simulation controls/instructions only when /api/auth/me reports capabilities.test_controls=true for the owner. Missing capabilities default off; login/register refresh the authenticated capability. The server enforces the boundary independently. All mutations are subject to server-side authorization/policy. Coordinate API contracts with the integration owner.

Browser behavior, keyboard access, supported mobile layouts, failures and the lead-to-outcome journey are part of [testing](../docs/TESTING.md). TypeScript compilation alone is not human QA.

## Exact outbound review

Lead detail and Outbound share ApprovalReviewDialog. Decisions send the revision actually displayed. Edited subject/body must be saved as a new preview before approval; batch review proceeds one visible item at a time. Pending approved retries can be revoked; in-flight requests cannot be recalled. Email settings accepts separate SendGrid event/parse verification public keys, with configuration distinct from a verified connection. See [integrated evidence](../docs/verification/L1-04-L1-08.md) for tests and remaining browser/provider QA.

## Send details and recovery

Outbound and lead detail share DispatchRecoveryDialog. It shows attempts used/remaining, retry timing and exact provider outcome. Owner recovery records evidence for verified acceptance or closure without retry, using the displayed execution and fence. Acceptance never claims delivery. Future and held actions are not offered an immediate row execution control; the server independently enforces due times. The outbound queue separates sending/accepted work from actions needing attention.

[L1-05 evidence](../docs/verification/L1-05.md) records TypeScript/build and API checks. Keyboard, mobile, focus restoration and clear recovery wording require browser/human QA; compilation does not satisfy them.

## Received-event recovery

The owner-only Event recovery page lists received delivery events and replies separately from outbound attempts. Owners can inspect bounded original content, processing timing, policy status and review history, then record an exact-version retry or close decision with evidence. Retry repairs local records from the original event; it cannot send a message or reset processing limits. Required contact policy must finish before closure, and unfinished policy pauses workspace sending.

[L1-07 evidence](../docs/verification/L1-07.md) records API tests and React compilation. Browser/human QA must verify pagination, focus restoration, keyboard/mobile behavior, stale-decision refresh, errors, and understandable holds. Invalid/foreign policy evidence can require operator remediation; the UI does not offer an override.

## Workflows and lead processing

Owners can use Workflows to create a basic campaign/sequence, enroll a lead at a saved UTC start, inspect the current run/action, review its exact message and pause/resume/stop at the displayed revision. The form shows browser timezone and saved UTC time; local inputs convert to UTC. Runs waiting for approval, actual execution, a scheduled step or human completion remain distinct. All replies stop existing sequences while preserving appropriate human-response tasks. Quiet hours and a full visual sequence builder are not implemented.

Event recovery includes a separate Lead processing view with safe stage/error details and exact-fence evidence decisions. It does not display raw event payload or reset retry budgets. Activity shows PLANNED as Scheduled, DUE as Due and BLOCKED as Needs review, handles missing/invalid dates and restricts management controls to owners. Invalid tasks can be cancelled but cannot be marked complete; completed/cancelled history cannot be overwritten. Completing a follow-up record does not complete a workflow human-task action.

[L1-06 evidence](../docs/verification/L1-06.md) records API/restart tests and React compilation. Human QA must verify keyboard/mobile/focus, timezone understanding, fresh-state conflict recovery, clear delivery wording and schedule/pause/resume using the normal worker.

## Sending controls

Settings includes owner-only Sending controls, backed by GET/PUT /api/dispatch-controls. It shows workspace pause, deployment-wide holds, UTC daily attempt usage/reset and unresolved dispatch capacity. Every saved change requires the displayed revision and a reason. Polling refreshes usage while retaining an edited draft; stale saves require Load latest values before retry. Resume cannot override the deployment setting or reset an action's retry budget. Already authorized requests may finish.

[Operational evidence](../docs/verification/L1-10.md) records the API regressions and successful TypeScript/build. Human QA must verify two-session conflicts, permission loss, loading/errors, keyboard/mobile behavior and whether the operator understands attempts versus delivery. These are provisional sending limits, not a billing or monetary budget.

## Business profile and enquiry context

Settings opens Business profile for offering, service area, customer criteria, language/timezone and preferred next step. Lead detail includes Enquiry with six typed facts, explicit unknowns, manual sources, stated/observed/inferred labels, conflicting alternatives and exact decimal budget input. Server storage keeps minor-unit strings, so large values are not rounded through JavaScript numbers. Current and prior revisions are reviewable; writes require an owner, displayed revision and reason.

Drafts survive background refresh and stale saves; Load latest requires an explicit replacement decision. Correcting context does not run analysis or send a message. Refresh analysis and review affected copy again; a new preview preserves prior copy rather than claiming automatic regeneration. Business criteria are captured for later qualification, not used to claim calibrated fit today. [Integrated evidence](../docs/verification/L2-01.md) records local API/browser checks and remaining real-operator acceptance.

## Reviewed CSV imports

Use Imports (or Import from Leads) to inspect a UTF-8 CSV, review indexed source mappings and explicitly choose phone region, date format and currency behavior. Inspection/preview creates no leads. Review normalized contact/enquiry fields, original cells and errors, correct mapped values with a reason, then select eligible rows. Duplicate candidates stay unselected for later identity review.

Commit processes at most 25 rows per call with saved progress. Refresh or an interrupted response retains the same batch and frozen selection; Resume processes unfinished rows. Finished means the selected rows were processed: created and newly held duplicate counts are separate. Imported facts show their source; use the explicit manual-correction control before changing an imported fact. Earlier source history remains. The history list shows the most recent 100 imports and signals more; saved older detail links still work. Full history pagination is later work.

The [contract](../docs/L2-02_REVIEWED_IMPORT.md) records limits and exact fields; [verification](../docs/verification/L2-02.md) records automated and remaining operator/PostgreSQL acceptance. This does not implement duplicate merge, contact editing or export.

## Planned interactive landing page

The requested modern landing page is specified in [LANDING_PAGE](../docs/LANDING_PAGE.md). L4-07 adds the prototype, synthetic interactive example and public/auth/protected route separation; L5-07 finishes the real funnel, static content and release quality; L6-04 gates publication. Current routing still shows AuthPage to signed-out visitors. Public /, /login, /register and protected /app routes are proposals, not implemented routes. Keep marketing fixtures/styles separate from operator pages and preserve deep-link/session behavior.

## Reviewed enquiry identity

Imports now offers explicit duplicate review and separate resolution history. An owner compares the source with current candidate facts/restrictions, chooses same-enquiry source linking or separate repeated/shared/distinct enquiry creation, supplies a reason and confirms. Stale comparisons retain the draft but require a refresh and renewed confirmation; interrupted requests reload saved decisions before an exact retry. Original import progress and later identity outcomes remain distinct.

The lead Enquiry view includes original and attached source history with exact row links. CSV source labels are readable; underlying fact references remain exact. Linking does not replace current facts. Display limits, source history truncation and policy holds are explained. See the [contract](../docs/L2-03_IDENTITY_RESOLUTION.md) and [browser evidence](../docs/verification/L2-03-ui.md). L2-04 now provides contact correction/archive/export as described below. Operator/mobile/accessibility acceptance remains open.

## Contact correction, archive and selected export

L2-04 adds a data-management workflow under its [recorded contract](../docs/L2-04_DATA_MANAGEMENT.md). Review current and proposed contact details, duplicate candidates, retained restrictions and stopped-work consequences before saving with a reason. Field provenance and immutable change history distinguish a correction from the original import source.

Archive/restore names one enquiry and is separate from the export selection. Archive preserves history but cancels open work; restore retains contact restrictions and starts no work automatically. The directory defaults to current records and exposes archived/all views. Export requires an explicit selection, retains selected records across pages/filters and shows hidden selections. CSV uses visible text labels for spreadsheet-sensitive display values and exact contact/enquiry JSON columns.

[Integrated evidence](../docs/verification/L2-04.md) records implementation and browser status. Representative operator files, keyboard/mobile/screen-reader use, spreadsheet open/save/reopen and live database/provider acceptance remain required.

## Analysis currentness and source quality

L2-05 shows never analysed, current, outdated and archived separately from execution/readiness. Lead detail explains dated, undated, inferred, conflicting and historical sources and compares stored recommendations with changed input categories. Refresh does not re-confirm source facts. Timed/focus GET checks use server assessment timing; no automatic analysis POST is issued. Bulk, per-lead and dashboard refresh outcomes distinguish reuse, success, partial failure and request failure; failed/unprocessed selection is preserved. Metadata-only evidence renders as a review note. See the [contract](../docs/L2-05_FRESHNESS.md) and [integrated evidence](../docs/verification/L2-05.md); customer/mobile/accessibility acceptance remains open.

L3-01 adds a Fit criteria Settings editor sharing the business-profile revision/history, separate Business fit and Attention priority detail, and a paged Intelligence queue. Ranking applies to the returned 100 records. Profile edits invalidate current analysis; save/read never runs analysis or contact automatically. Unknown/source-review outcomes link to exact enquiry fields. The old score is labeled legacy processing attention. See [contract](../docs/L3-01_BUSINESS_FIT.md) and [verification](../docs/verification/L3-01.md) for browser evidence and remaining operator/accessibility gates.

## L3-02 interpretation details

Lead assessment details show the persisted extraction method, fallback reason, exact supported claims and source evidence. Conversations and lead history show original reply text separately from interpretation, category separately from contact stop/review, and unconfirmed model candidates. Historical method/source data remains explicitly unavailable when absent. No composer, assignment or resolution workflow is added here. The [quality contract](../docs/L3-02_INTELLIGENCE_QUALITY.md) and [browser evidence](../docs/verification/L3-02-ui.md) define local scope and remaining human QA.

## Saved assessment reviews and evaluation

L3-04 adds lazy feedback panels beside exact saved assessment and inbound-reply records, including historical snapshots. Reviews retain reason, revision history, withdrawal/restoration and request-key recovery. Intelligence exposes explicitly nominated reply selection, frozen dataset versions, protected replay and aggregate history. New source analysis does not silently move an open review to a different artifact.

Build first, then run npm run verify:feedback-ui -- --playwright-module ABSOLUTE_INSTALLED_INDEX_MJS from the workspace root. The tracked verifier owns its isolated server and browser and uses no provider calls. [Integrated evidence](../docs/verification/L3-04.md) separates local browser verification from operator/customer acceptance.

## Revisioned email setup

Settings > Email now uses the versioned [channel setup API](../docs/L4-01_CHANNEL_SETUP.md). It saves full owner-reviewed configuration with masked-secret KEEP/explicit CLEAR, a current revision/token, reason and recoverable request key. Webhook URLs require an explicit provision command; rotation keeps old signed aliases. Setup/history/refresh are read-only. Missing fields and provider verification are displayed separately, and saved configuration never claims a working live connection.

Normal live SendGrid dispatch remains held pending subsequent provider verification; Sandbox is available. Other live channel choices remain visibly unsupported. Exact outbound review displays the saved Reply-To address. The [local evidence](../docs/verification/L4-01.md) records actual browser verification separately from build and human/provider acceptance.

## Current complete local journey

The public landing at / loads independently of session/API availability, with a synthetic interactive example and real saved pilot-interest form. /login, /register and /recover are explicit; /app is the protected dashboard and existing deep links remain. Session changes remove private query caches before a different owner sees the workspace.

Lead capture permits missing contacts for context/intelligence; outbound still requires a usable recipient and exact review. A lost manual-capture response holds resubmission and asks the owner to inspect the directory. It does not claim durable capture request recovery. The shared composer handles first/reply/edit messages and original request recovery. Conversations are paged with original reply interpretation; reminders take real due times; outcomes retain exact money and correction/withdrawal history. Reported wins comes from current recorded outcomes, without a conversion-rate claim.

Settings includes provider-verification evidence, account security/recovery, operational alerts and customer-data export/erasure. The responsive mobile drawer and dialogs support explicit keyboard focus and narrow layouts. See [current integrated evidence](../docs/verification/COMPLETION.md) for exact build/browser results and the [acceptance runbook](../docs/RELEASE_ACCEPTANCE.md) for external and customer requirements.

## Loading and public contact flow

Shared loading-screen components cover public/session loading, lazy workspace routes and initial data reads. AppShell preserves navigation and shows slim progress during query refreshes. The public walkthrough mounts automatically; Try it out scrolls to it and Get started opens registration. Book a demo and Reach out use the existing request form. See [focused verification](../docs/verification/LANDING_LOADING.md) for the 55-check browser result and remaining human QA.

## Customer settings and local developer tools

/settings shows customer AI assistance, limits and channel availability. API/provider configuration and verification live at /developer-tools with no customer navigation link. The backend must explicitly set ENABLE_DEVELOPER_TOOLS=true in development/test, and the signed-in session must be an OWNER. It defaults off and is unavailable in staging/production. This is UI availability, not a new authorization role: existing APIs retain their server-side ownership and policy checks. Use the documented deployment/operator API procedure for deployed configuration. Developer browser launchers explicitly opt in on their owned in-memory fixtures.

## Unavailable signup and onboarding

Account/session JSON requests have a 15-second deadline and reject invalid success payloads. Backend absence shows coming soon; failed transport shows currently unavailable; genuine account errors remain errors. AvailabilityNotice collects only explicitly consented contact information through the public intake endpoint. Its same-key retry never replays passwords or creates an account. On Vercel, intake is independent of the backend process. See [deployment](../docs/VERCEL.md).
