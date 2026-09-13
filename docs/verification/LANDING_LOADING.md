# Landing CTAs and shared loading - 2026-09-13

Product: **AI Lead Intelligence & Outbound Automation**.

## Completed behavior

The walkthrough mounts automatically. Try it out scrolls to it; Get started opens Sandbox registration. Book a demo and Reach out in the final section/footer both open the existing request form. Send request retains the real persisted intake and exact-retry behavior; a booking time is confirmed separately.

Shared branded loading screens cover pending public/session code and initial dashboard/enquiry reads. A nested AppShell Suspense boundary keeps navigation visible while a workspace page chunk loads. Directory, conversation, intelligence and import reads use compact status indicators. Background query refresh shows a slim indeterminate progress bar while preserving existing content. Motion honors the system preference; there is no artificial delay or fabricated percentage. Existing error recovery remains.

## Files and contracts

Changes are in client/src/components/loading-screen.tsx and its CSS, App.tsx, components/layout/app-shell.tsx, components/lead-directory.tsx, pages/dashboard.tsx, pages/lead-detail.tsx, pages/conversations.tsx, pages/intelligence.tsx, pages/imports.tsx, marketing/LandingPage.tsx, marketing/PilotRequestForm.tsx, marketing/landing.css and client/index.html. scripts/verify-landing-ui.js extends the existing behavioral verifier. The affected product, architecture, landing, task, testing and client documentation is updated.

No backend API, event, database schema, provider or domain contract changed.

## Final local candidate and verification

Final entry assets: index-2l34rQ3I.js and index-CcWrso1s.css. Landing chunks: LandingPage-2eYC13Xq.js and LandingDemo-Bljno7w_.js. Browser: Chromium 140.0.7339.16. Initial public JavaScript: **110,045 gzip bytes**, including the automatically mounted walkthrough, within the 200 KiB budget; protected pages are excluded.

- TypeScript: node client/node_modules/typescript/bin/tsc -b client passed.
- Vite: node node_modules/vite/bin/vite.js build from client passed.
- scripts/run-landing-ui.js: **27/27 passed**.
- scripts/run-completion-ui.js: **13/13 passed**.
- scripts/run-setup-journey-ui.js: **15/15 passed**.

All browser commands used --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs and owned loopback/in-memory fixtures with providers disabled. No live model/provider calls or browser runtime errors occurred. The full backend suite was not rerun for this frontend-only slice; previous full-suite evidence remains tied to its earlier build.

Landing coverage holds actual page/demo/dashboard/directory requests to prove visible loading and release to usable content; preserves navigation and existing table data; checks both form destinations, reduced motion, mobile layout, public API outage, lazy-chunk failure, exact request retry and authentication/deep links. Visual review caught a narrow public loading screen; width/flex sizing was corrected and the final verifier asserts that the screen fills a 1200px viewport. The corrected screenshot was visually inspected.

Synthetic screenshot directories under C:/Users/ghg/AppData/Local/Temp: relay-landing-ui-ngdqaj, relay-completion-ui-U8P7us and relay-setup-journey-ui-rIyobJ. Artifacts remain local.

## Simple manual workflow

1. Open http://localhost:3003. Confirm the interactive walkthrough is already visible in its section; Try it out scrolls to it.
2. Select a sample enquiry, inspect its evidence, review a draft, simulate a response and reset the walkthrough. It must remain labeled synthetic and send nothing.
3. At the bottom, try Book a demo and Reach out. Both must reach the same request form. Submit sample contact information only if you want a saved local request; success must not claim a confirmed booking.
4. Choose Get started, create a test Sandbox workspace or sign in, and follow the setup guide to save a business profile and one sample enquiry.
5. Open the enquiry, run its analysis, inspect the reason/evidence and missing information, then prepare a message. Review the exact recipient and content before approving. Keep execution in Sandbox.
6. Record a follow-up reminder, complete it and record an outcome. Confirm the enquiry and dashboard reflect the saved change after refresh.
7. To see loaders reliably, open browser developer tools, disable cache and select Slow 3G, then reload and move between workspace pages. Check that loading clears, navigation stays usable and a directory Refresh retains existing rows. Restore normal network settings afterwards.
8. Repeat navigation and the request form at phone width. Enable reduced motion and confirm controls remain usable.

## Human QA and limits

Manual screen-reader announcements, 200% zoom, real-phone checks and user visual acceptance remain. Fast cached loads may complete before a loader is noticeable; no delay is added merely to show it. This local UI slice does not certify customer, live provider, PostgreSQL or L6 publication acceptance. The next step is the manual workflow above, then the remaining release acceptance work tracked separately.

Format check passed for 550 files; git diff --check passed (existing AGENTS.md line-ending warning only). Local preview moved to port 3003 because another application also bound port 3002. The existing preview SQLite file was retained; current built HTML and health HTTP 200 were verified.
