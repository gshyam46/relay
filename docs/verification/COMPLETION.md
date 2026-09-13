# Integrated local completion evidence

Recorded 2026-09-13 for **AI Lead Intelligence & Outbound Automation** under [the completion plan](../COMPLETION_PLAN.md) and ADR-023. This is the current local candidate record. Historical milestone and earlier focused counts are not current launch certification.

## Candidate and result

- Source base: c8b6a0ca3e18ea595805bfe942ab08c35881bca0 with the accumulated local implementation changes; this work was not committed, pushed, deployed or published.
- Runtime: Windows, Node.js 24.20.0; disposable SQLite for automated tests; Chromium 140.0.7339.16 for actual React behavior.
- Final production entry: **index-DPnXXp52.js**, stylesheet **index-BtH8F8e8.css**. Browser verifiers assert requested built assets and unchanged index; see [candidate regression hashes](COMPLETION-regressions.md).
- Ordered schema registry: **24 migrations,82 tables**. Structural manifest fingerprint: 47fd584ffa1f3fa9dc28a4bddfcd4f870416f4aaa80c052a6a8971efafa6bb9b.
- Local engineering candidate passes the checks recorded below. Actual PostgreSQL, provider, deployment/restore, target-operator and customer acceptance remain open under [RELEASE_ACCEPTANCE](../RELEASE_ACCEPTANCE.md).

## Completed implementation

| Area | Result and source ownership | Contract / focused evidence |
| --- | --- | --- |
| Customer communication | Shared first/reply/edit composer, exact immutable review and request recovery; normal Sandbox execution; real reminder dates; enquiry conversation decisions, corrected outcomes and selected export | [Customer workflow](../L4-03_CUSTOMER_WORKFLOW.md), [composer](L4-02-composer.md), [workflow](L4-03-customer-workflow.md) |
| Outcome reporting | Dashboard Reported wins reads current recorded WON outcomes for active enquiries; correction, withdrawal and archive alter the projection; no conversion-rate or revenue inference | [Metrics evidence](L4-05-metrics.md) |
| Email | Versioned setup, bounded read-only checks, two fixed reviewed probes, signed delivery/failure/reply/stop proof and current-config capability; stale signed admission rejected after reset/erasure | [Provider contract](../L4-01_PROVIDER_VERIFICATION.md), [backend evidence](L4-01-provider.md) |
| Product entry and onboarding | Interactive public landing, synthetic example, saved pilot interest, explicit auth/recovery routes, guided setup and public information; responsive keyboard drawer and dialogs | [Landing](../LANDING_PAGE.md), [setup](../L4-06_SETUP_JOURNEY.md) |
| Contact-optional capture | Name-only enquiry can receive sourced context and local intelligence; missing contact holds outbound; audited contact correction requires current analysis/review. Unknown manual-create response holds resubmission for directory inspection | test/completion-contactless-http.test.js, [browser evidence](L5-04-ui.md) |
| Account access | Password change, auth epochs, masked session references/revocation and one-use offline recovery; cross-owner private query caches cleared | [Security contract](../L5-02_ACCOUNT_SECURITY.md), [evidence](L5-02-account-security.md) |
| Runtime and operations | Full structural schema checks, deployed PG role contract, bounded shared readiness work, explicit SQLite backup/restore tools, operational counts/runbooks and local workload measurement | [Schema/recovery](L5-01-backend.md), [operations](L5-03-backend.md) |
| Customer-data lifecycle | Scoped portable export; exact-state/password-reviewed erasure with durable replay/history; active/uncertain work holds; minimal suppression/account retention; channel reset and dispatch pause | [Data contract](../L5-04_DATA_LIFECYCLE.md), [backend](L5-04-workspace-data.md), [UI](L5-04-ui.md) |
| Pilot-interest handling | Explicit database-target list/review/close and reviewed expired-only purge; immutable operation identity and no notification/admission claim | [Operator runbook](../L5-07_PILOT_INTEREST_OPERATIONS.md), test/l507-pilot-interest-operations.test.js |

Root integrated shared API/factory/config/logger, migrations/manifest registry, package launchers, router/auth/cache boundaries, composer/customer-workflow/security/provider/operations UI and shared documentation. Parallel owners delivered their explicitly assigned modules, fixtures, browser flows and review. No n8n/database/provider authority was substituted for application domain state.

## Final automated checks

```powershell
node scripts/run-tests.js --test-concurrency=2
node scripts/evaluate-intelligence.js --check
node scripts/smoke-api.js
node scripts/lint.js
node scripts/format-check.js
node client/node_modules/typescript/bin/tsc -b client
# From client:
node node_modules/vite/bin/vite.js build
```

The final safe full suite completed in 93.98 seconds: **1390 tests,1341 passed,49 explicitly skipped PostgreSQL checks,0 failures,0 cancelled**. Focused module totals overlap this run.

The first integration run found one obsolete migration assertion: it compared an entire user row with the pre-security schema and rejected the intentionally additive auth_revision=0 column. The corrected assertion checks all original values plus that exact safe initial epoch; it does not delete or weaken preservation coverage. The final full rerun passed. Contact-free admission replaced the obsolete M0 contact requirement while preserving malformed supplied-contact/source rejection and adding53 API invalid-input cases.

Synthetic intelligence safety and pinned regression evaluation passed, with zero gate failures. The fixed reply corpus has46 examples and20 abstentions; customer/hosted-model/native-language performance remains unmeasured. Isolated API smoke passed. Syntax/format and documentation verification counts are recorded at final closure below.

The existing isolated HTTP workflow verifier passed **59/59** on an owned memory fixture. That run preceded the additive dashboard outcome projection; the final full suite and13-step browser journey include the projection and its correction/withdrawal behavior.

## Actual React browser candidate

All final runs use the exact production entry above, an owned ephemeral loopback memory fixture and installed Chromium. No browser or dependency was installed. A final source-whitespace cleanup rebuilt byte-identical named candidate assets after these checks; no browser behavior changed.

| Safe launcher (supply --playwright-module ABSOLUTE_INSTALLED_INDEX_MJS) | Result | Evidence |
| --- | --- | --- |
| scripts/run-completion-ui.js |13/13 | First/edit/reply/exact approval/Sandbox send, lost draft response recovery, original inbound interpretation, conversation reopen, real reminder completion, exact INR 100000.10, withdrawal/export, dashboard update, recovery/security and mobile |
| scripts/run-workspace-data-ui.js |22/22 | Data/operations owner flow, exact reviewed erasure, ambiguous retry/history/cache guards, contact-free capture/context/analysis/recipient hold, audited correction and lost create response inspection; [detail](L5-04-ui.md) |
| scripts/run-landing-ui.js |21/21 | Public/auth routing, deterministic example, real pilot POST/errors/retry, static/no-JS fallback and narrow/reduced-motion behavior |
| scripts/run-setup-journey-ui.js |15/15 | Real observed setup states, GET-only refresh/errors, public information and keyboard/mobile navigation |
| scripts/run-intelligence-trust-ui.js |20/20 | All19 original reply interpretation checks plus expired-owner/different-owner login in the same SPA with the new inbox response deliberately held |
| scripts/run-email-verification-ui.js |12/12 | Actual provider-proof interface/service, same-key response recovery, two fixed probes and exact approval with synthetic HTTPS configuration/no-network adapter; [evidence](L4-01-provider-ui.md) |

**103 distinct final-candidate browser checks passed** across the six suites. The three regression runs are recorded in [COMPLETION-regressions](COMPLETION-regressions.md). Initial public JavaScript measured **103280 gzip bytes** against the existing200 KiB budget; this is local bundle accounting, not a throttled-device Core Web Vitals result.

Root customer-workflow artifacts: C:\Users\ghg\AppData\Local\Temp\relay-completion-ui-6lGqto. Final data/capture mobile artifacts: C:\Users\ghg\AppData\Local\Temp\relay-workspace-data-ui-mBS2s0. The actual390x844 capture dialog and erasure confirmation were visually inspected; root also inspected the capture image. Screenshots contain synthetic records only and remain local evidence.

## Failure and race proof

The integrated tests include raw ECDSA-signed Event and multipart Inbound requests, changed-body signature rejection, exact duplicate handling and the four processed provider-proof milestones using synthetic adapter results. Two deterministic real HTTP races hold receipt insertion after signature validation: a sender edit or a completed workspace erasure makes release return409 with no stale receipt/customer payload resurrection; the erased alias subsequently returns404.

Erasure tests preserve foreign tenants, account recovery and minimal suppression, detach tested action/revision/workflow cycles, preserve accepted replay after new data, reject password/plan/access changes and block active/unknown/closed-unresolved transport. Callback policy/probe tests execute no model work. The separate contact-free flow completes sourced local analysis, refuses recipientless preparation, requires audited correction and exact approval, then performs one Sandbox-only execution.

Browser integration fixed a real modal initial-focus defect and a historical fixed-width mobile sidebar, retained original interpretation coverage after inbox paging, and proved no previous-owner names appear during delayed next-owner loading. Unknown manual capture has an explicit inspection hold; it does not claim durable request-key recovery.

## Measured workload and evidence limits

[The saved local workload report](L5-03-workload.json) passed for 100 enquiries across2 tenants,100 complete/current PLAN analyses,180 normal scheduler ticks and110 legitimate internal HUMAN_TASK executions. Measured scenario20.32 seconds; read p95 7.24 ms, tick p95 171.79 ms, import/chunk p95 149.11 ms. No SEND, AI or external network attempts occurred. Separate persisted pause/admission and injected-alert checks pass.

These deterministic SQLite numbers do not establish production, real-model, provider-network or HTTP capacity. Actual PostgreSQL is not verified in this batch: local PostgreSQL tools/standard installation were absent; Docker CLI existed but its local engine pipe was unavailable. No runtime was started, image pulled or application database reused to obtain a passing result. Configured remote CI is not a claimed current CI run.

## Outstanding acceptance and handoff

Required external work is concrete in [RELEASE_ACCEPTANCE](../RELEASE_ACCEPTANCE.md): selected customer/channel/owner scope; actual isolated PG concurrency, roles, upgrade and restore; independent current suppression/erasure reconciliation; authorized provider sender/signing/mailbox journey; operator accessibility/incident walkthrough; real monitoring/retention/support/CTA operation; customer outcome and cost/pricing evidence; dated supervised-pilot and public-launch decisions.

Automatic quiet hours, multi-user collaboration, off-app notification delivery, exact MIME thread/attachment ingestion and further channels remain explicit scoped deferrals. Whole-account deletion and automatic physical/provider/backup-copy removal are not claimed by customer-data erasure. Manual capture does not have durable request-key recovery. No code test fills these scope/evidence gaps.

[Tasks](../TASKS.md) intentionally retains [~] for implementation whose required human/external gate is open. L6 customer results, pricing and launch decisions cannot be closed by local engineering. The next step is the ordered acceptance runbook, starting with the named pilot scope and isolated staging target, rather than adding unrelated product surface.

## Final closure checks

Syntax lint passed for 413 JavaScript files. Format verification passed for 549 files. Local Markdown link validation checked 128 documents and 1030 relative file links with zero missing targets; this checks file existence, not remote URLs or every fragment. Git diff whitespace verification passed; the only informational notice was the existing AGENTS.md CRLF normalization warning. Final isolated API smoke passed. Rebuilt entry/CSS SHA-256 exactly matches COMPLETION-regressions.md after the whitespace-only cleanup.

All owned test/browser/server processes were closed and root temporary test logs were removed after recording results. Synthetic screenshot/download evidence remains in the explicitly named local artifact directories. No existing application database was reset or used for test cleanup.

## Subsequent frontend refinement

The loading/CTA iteration supersedes the frontend asset identity above. [LANDING_LOADING](LANDING_LOADING.md) records its final build and 55 focused browser checks. The full backend-suite and 103-browser-check results above remain evidence for their recorded earlier candidate, not a rerun on the newer assets.
