# Customer settings and developer configuration - 2026-09-13

Product: **AI Lead Intelligence & Outbound Automation**.

## Implemented

Customer Settings replace the AI provider catalogue, model identifiers and environment-variable instructions with AI assistance status. Customers retain daily/concurrent limits and pause controls; hidden estimation rates are preserved by the existing versioned save contract. Invocation metadata, provider/model estimation editors, credential setup, webhook routing and controlled transport checks belong to /developer-tools, separate from the customer shell/navigation. Approval shows delivery mode rather than provider branding.

Email availability uses the existing read-only strict capability assessment. It distinguishes Sandbox, unready live setup and currently verified channel capability; verification does not override workspace pause, eligibility or exact-message review. WhatsApp, SMS and calling show live operation unavailable. Telegram states that sending/replies are not implemented. There are no misleading customer connect controls or automatic mode changes.

## Why integrations appeared broken

src/modules/handlers/whatsappAdapter.js implements a basic outbound text request. SMS and voice likewise have partial transport adapters. src/modules/channels/channelCapability.js intentionally refuses ordinary live non-email channels; only the supported SendGrid email path can progress through full verification. src/modules/handlers/channelRouter.js has no Telegram execution handler. These facts establish implementation gaps, not evidence of a current vendor outage. No real account/API connection was tested in this slice. Local preview remains configured without live providers and with outbound dispatch disabled.

WhatsApp next requires a deliberately selected first-customer scope, business connection/onboarding, required messaging-policy/template handling, authenticated inbound/status integration, opt-out/identity correlation, exact reviewed sends, uncertain-result recovery and real controlled end-to-end account acceptance. The existing primitive adapter does not establish these capabilities. SMS, voice and Telegram need their own complete supported contracts and acceptance before being advertised as available.

## Contracts and files

ADR-024 records the user-authorized presentation separation. ENABLE_DEVELOPER_TOOLS defaults false; only development/test plus explicit true plus a current OWNER advertises capabilities.developer_tools from /api/auth/me. Staging/production never advertise it. This is a UI availability switch, not a new platform-admin privilege or authorization barrier around existing APIs. Existing endpoint ownership, masking, approval and send policies are unchanged; no schema/event changes.

Implementation: client/src/pages/settings.tsx, pages/developer-tools.tsx, components/customer-channel.tsx, components/analysis-controls.tsx, components/approval-review-dialog.tsx, components/setup-journey.tsx, components/operations-status.tsx, hooks/use-auth.ts, App.tsx, src/config.js and src/api/app.js. Environment, architecture, decisions, product, client README, task and verification documentation are updated alongside the implementation.

## Verification

Final entry assets: index-BZl9rrnC.js / index-CcWrso1s.css. TypeScript and Vite build passed. Safe targeted backend command: node scripts/run-tests.js test/developer-tools.test.js test/tenant-boundaries.test.js test/production-foundation.test.js test/l401-email-connection.test.js test/l401-channel-capability.test.js test/l303-ai-usage.test.js ? 77 passed, zero failures/skips. The seven new boundary checks cover default-off, explicit local opt-in, deployed disabling, unauthenticated/member refusal and independence from test controls.

Browser commands use scripts/run-setup-journey-ui.js, scripts/run-channel-setup-ui.js, scripts/run-email-verification-ui.js and scripts/run-analysis-ui.js with --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs. They own disposable loopback/in-memory fixtures, disable real providers and preserve prior behavior coverage after moving technical tests to the developer route. The setup suite adds customer absence/availability/read-only checks and direct developer-URL refusal. No backend full-suite, real PostgreSQL/provider or deployed release acceptance is claimed here.

## Manual QA and next step

Refresh http://localhost:3003 and open Settings. AI assistance should contain useful status and usage controls without a provider catalogue or API-key instructions. Email should describe the actual Sandbox connection. WhatsApp, SMS, Telegram and Calling should clearly state their current limitations and offer no live connection setup. Check narrow screen layout, keyboard navigation and screen-reader status announcements. Direct /developer-tools must be unavailable in this preview.

For local engineering only, explicitly enable the documented flag, restart the local server and sign in as its workspace owner; /developer-tools?tab=email retains the original setup and exact verification workflow. Do not interpret the developer flag as live-send authorization. Decide whether WhatsApp should be the first supported customer channel before committing that larger integration slice; current L5/L6 external gates remain open.

Final browser result: **67 checks passed** (17 customer/setup, 20 technical channel setup, 12 technical email verification, 18 analysis/usage). Chromium 140.0.7339.16. Final synthetic artifact directories under the local Temp folder: relay-setup-journey-ui-uwTDbs, relay-channel-setup-ui-Xz5ZGD, relay-email-verification-ui-FF7CNv and relay-analysis-jobs-ui-gfRA6E. Customer AI screenshot visually inspected. Format check passed for 552 files and git diff --check passed (existing AGENTS.md line-ending warning only). The preview was restarted on port 3003 using its existing SQLite file, with developer tools/test controls/live dispatch disabled; final built HTML and health HTTP 200 verified.
