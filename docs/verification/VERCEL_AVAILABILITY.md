# Vercel frontend and unavailable-account interest - 2026-09-14

Product: **AI Lead Intelligence & Outbound Automation**. Implementation and live setup are separate; [VERCEL](../VERCEL.md) is the deployment/operator runbook, and ADR-025 records the architectural boundary.

## Implemented behavior and contracts

Root vercel.json deploys client/dist with a Node gateway and explicit API/SPA route order. The backend and its worker remain independently hosted. An absent backend yields BACKEND_NOT_CONFIGURED and coming-soon UI; failed/unresponsive/HTML transport yields unavailable UI. JSON client reads/mutations have a 15-second deadline; gateway upstream work has a 12-second deadline. Normal validation/authentication rejections remain errors. Account payloads are shape-checked before session adoption.

Auth session checks, failed signup/signin submissions, dashboard entry and setup refresh expose AvailabilityNotice. Failed credential submissions clear the password input, retain only contact prefill in component memory and explain an unknown account outcome. A separate explicit consent sends contact information through the public-interest contract. No background password replay or automatic interest registration occurs.

The public payload supports optional AVAILABILITY_SIGNUP, AVAILABILITY_SIGNIN and AVAILABILITY_ONBOARDING purposes; these select fixed source text and purpose-specific consent versions. Existing pilot/demo requests retain their original contract. Vercel intake directly reuses PilotInterestService against an application-owned relay_interest PostgreSQL schema with a separate credential. It preserves distributed rate limits, exact request-key replay, separate contact records and manual review/purge. There are no new application-table migrations; the auxiliary acquisition schema has an explicit one-time setup script.

Core files: api/gateway.js, deployment/interest-store.js, deployment/interest-schema.sql, vercel.json, .vercelignore, scripts/interest-store.js; client availability/auth/API/setup/dashboard/privacy components; PilotInterestService; gateway and availability browser tests. Root/client README, product/domain/architecture/roadmap/tasks/testing/landing and environment documents are updated.

## Local verification

Final client assets: index-Ca62WBCM.js and index-C-qfhs_c.css. TypeScript and Vite build passed. Public JavaScript including the automatic walkthrough measured 112,920 gzip bytes, below the existing 200 KiB budget.

Safe backend command: node scripts/run-tests.js test/vercel-gateway.test.js test/completion-http.test.js test/l507-pilot-interest-operations.test.js test/auth-boundaries.test.js. **36 tests passed**, zero failures/skips. Coverage includes durable replay through two gateway instances, rate limits, password/token rejection, missing consent, storage failure, credential-redacted errors, pinned origin/upstream, secure-cookie forwarding, upstream HTML/redirect/oversize/network failure and deadline abort. Existing account transaction and pilot review/purge checks remain passing.

Browser launchers use --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs with installed Chromium 140.0.7339.16 and owned loopback/memory fixtures. No live provider, model or notification was invoked.

- scripts/run-availability-ui.js: **11 checks passed** on the real built client and gateway, with two independent in-memory databases. Covered standalone landing; absent backend; explicit consent; lost accepted response and same-key recovery; independent store outage/recovery; failed signup with cleared password and contact prefill; actual signup/cookies after recovery; onboarding outage with retained observations; genuine invalid-login rejection; HTML/timeout fallback; mobile/reduced motion; no credentials in interest or browser storage.
- The original landing, setup and customer-workflow regression suites were retained and passed 27, 17 and 13 checks respectively on the final assets. Together with availability, **68 browser checks passed**. Final regression artifacts under the local Temp folder: relay-landing-ui-Wp6EtA, relay-setup-journey-ui-2CoWIk and relay-completion-ui-82ynqL.

Availability artifacts: C:/Users/ghg/AppData/Local/Temp/relay-availability-ui-mMTP3I. The 390px unavailable screenshot was visually inspected. The first browser attempt failed because a new verifier used a nonexistent walkthrough CSS selector; it was corrected to the actual mounted walkthrough, without weakening the behavior assertion. No product defect was hidden by that correction.

## Limits and human QA

No Vercel deployment/login/project link, database secret or live acquisition schema was available in the environment. The schema's actual PostgreSQL/RLS/least-privilege behavior and Vercel's routing/header/cookie behavior require the runbook's isolated live checks. The tests prove shared intake behavior with separate SQLite fixture databases and the gateway locally, not a deployed PostgreSQL result. Notifications remain an operator process; no email delivery is claimed.

Human QA: follow the runbook with the intended Vercel project and restricted database connection; verify API-before-SPA routing, cookie/origin behavior, unavailable backend versus unavailable intake, durable accepted-response recovery, source/consent/expiry, read/mark/purge ownership, keyboard/screen-reader/phone rendering and actual provider-independent operator follow-up. Public privacy/support contacts remain an external setup requirement. Earlier full-suite and other browser evidence belong to their recorded candidates.

Final checks: format passed for 560 files; whitespace/conflict checks passed. Existing local preview was restarted on port 3003 with its original SQLite file and live dispatch/developer/test controls disabled; final HTML asset identity and health HTTP 200 verified. This is the ordinary local Node deployment, not a live Vercel deployment.
