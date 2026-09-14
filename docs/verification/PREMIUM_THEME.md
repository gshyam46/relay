# Ivory and ultramarine theme verification

Product: **AI Lead Intelligence & Outbound Automation**. User-authorized L4-06/L4-07 presentation refinement started 14 September 2026; local verification completed on 15 September 2026. [Design contract](../DESIGN_SYSTEM.md).

## Implemented scope

Shared ivory/ultramarine tokens, Manrope interface typography, Newsreader editorial typography, bundled OFL font assets, shared SVG Relay monogram, SVG/PNG favicon and touch icon. Landing composition and interactive-stage styles; app navigation/header, authentication/availability/recovery/loading states; page charts/badges, dashboard setup rows and privacy presentation. Domain, account, contact-consent and review authority are unchanged. Static public fallback colors and first HTML paint follow the same palette.

Font assets total 303,708 bytes (three variable WOFF2 files); the browser loads faces as used. Manrope and Newsreader licenses and provenance ship under client/public/fonts. Interface numbers use tabular spacing where compared. Red/amber/green retain semantic status meaning; chart categories use blue/neutral colors with text labels.

## Preliminary visual review

Owned in-memory screenshot fixture created a synthetic account and three enquiries without provider/model calls. Desktop account screen and phone registration were visually inspected; first app capture led to a lighter setup-row presentation. At 1440px and 390px, landing/account/recovery/privacy/dashboard/leads/settings/unavailable captures reported no horizontal page overflow. Bundled font files, SVG favicon, PNG favicon and touch icon returned HTTP 200 with correct content types; browser errors were empty. These preliminary results precede final landing CSS and do not certify the final build. Visual inspection also identified an over-centered tall availability form; self-start sizing now preserves the top branding while the page grows. Mobile form text uses 16px, and the auth product identity remains visible at phone width.

Preliminary local artifacts: C:/Users/ghg/AppData/Local/Temp/relay-premium-visual-ZYWKAt. Final build and existing behavior regression results will be recorded below.

Core palette calculation: ink/ivory 13.75:1; muted/ivory 4.86:1; subtle/surface 4.61:1; blue/ivory 6.08:1; surface/blue 6.68:1; selected text/wash 8.04:1. Success, warning and error text on their washes measured 5.93:1, 5.45:1 and 5.74:1. These token checks are not a full accessibility certification.

## Final build and regression evidence

TypeScript passed: node client/node_modules/typescript/bin/tsc -b client. Vite production build passed. Final assets: index-DBAD50We.js, index-4l3Z8QRR.css, LandingPage-CnFg-ML7.css. Initial public JavaScript including the automatic walkthrough is 113,548 gzip bytes, within the existing 200 KiB budget.

Existing safe browser launchers used the installed Playwright module at C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs and Chromium 140.0.7339.16. No tests were removed or weakened and no new behavioral test suite was needed for the presentation change.

| Command prefix | Result | Local Temp artifact folder |
| --- | --- | --- |
| node scripts/run-landing-ui.js | 27 passed, including rendered-text contrast, consent/retry, loading, actual registration and deep links | relay-landing-ui-8fEtlj |
| node scripts/run-availability-ui.js | 11 passed, including outage/storage failure, password clearing and session recovery | relay-availability-ui-vAwLDW |
| node scripts/run-setup-journey-ui.js | 17 passed, including actual saved setup, customer settings and mobile keyboard navigation | relay-setup-journey-ui-VCdEHW |
| node scripts/run-completion-ui.js | 13 passed, including review, replies, reminders, outcomes and account recovery | relay-completion-ui-go0Rbh |

Append --playwright-module and the absolute module path above to each command. These are 68 distinct existing browser scenarios. All four passed on integrated candidate index-T4slO5Wg.js; after adjusting only the landing hero font sizes to prevent an orphaned word, the affected 27 landing scenarios passed again on the final build. Counts overlap and are not additive across repeated runs. Backend/provider/database acceptance was not rerun or newly claimed for this visual slice.

Final visual artifacts: C:/Users/ghg/AppData/Local/Temp/relay-premium-visual-WGhsNO. Desktop hero, phone hero and corrected unavailable screen were visually inspected on the final build. Earlier account/sidebar/list/settings inspections informed integration. The final 12 viewport captures across public, auth, recovery, privacy, dashboard, leads, settings and unavailable views reported no horizontal page overflow at 1440px or 390px; fonts/icons returned correct HTTP 200 responses and there were no browser runtime errors. The landing verifier additionally checks the 360px walkthrough and reduced motion. The desktop headline now keeps its intended three lines and the phone unavailable page retains top branding.

TypeScript, CSS parsing, static responder syntax, final format check (562 files) and git diff --check passed. Windows command-size/encoding issues during asset/style preparation were corrected before this candidate; the final browser suites had zero failures. Source is ready for user visual review; no publication has been performed.

## Remaining human acceptance

Review the final visual direction with the user. Actual iOS/Android focus behavior, screen-reader use, 200% zoom and live Vercel/custom-domain cache behavior remain separate checks. Local presentation completion does not close provider, database, customer or L5/L6 launch gates. The user authorized pushing the theme and readability updates to mvp on 15 September 2026; hosted deployment acceptance remains separate.

Local preview was refreshed on port 3003 with its original SQLite file. Health HTTP 200 and final index-DBAD50We.js identity were verified; live dispatch, developer UI and test controls remain disabled. This is a local preview, not a hosted deployment.

## Readability and visual interaction follow-up - 2026-09-15

User accepted the visual direction and requested larger small text plus nonverbal interaction cues. Shared text-xs is now13px; old explicit9/10/11px classes compute to12px. Loading copy/navigation use14px and identity12px. Public metadata/captions use at least12px, supporting copy14-16px and key walkthrough controls14px. Existing font faces, headlines and palette are retained. The mobile header keeps the existing identity legible on two lines.

The walkthrough has a fine blue frame, numbered selected-step surfaces, visible record borders, a selected rail and an outlined next-step button. Hovering a record adds a light blue wash and moves its arrow by2px; keyboard focus gives an equivalent outline. Reduced motion removes movement, and disabled controls retain their state. No instruction copy, fabricated activity, automatic step changes or domain writes were added.

Build and TypeScript passed. Existing browser suites passed: landing27, availability11, setup17, completion13 (68 distinct scenarios). After final public-only control-size/header refinements, all27 affected landing scenarios passed again on final index-DxF4KpC7.js, index-CBq9ENYB.css and LandingPage-Bx6ogjHP.css. Public initial JS remains113,540 gzip bytes. Counts overlap earlier runs.

Final landing artifacts: relay-landing-ui-7AbRXG. Other successful suite artifacts: relay-availability-ui-vEDqXh, relay-setup-journey-ui-WTJ2MT, relay-completion-ui-gT5xTM. Owned screenshot/measurement artifacts: relay-premium-visual-qdPtMb (font-size aliases, hover matrix, full public/app phone/desktop audit); relay-premium-visual-AEyuCr (final public screenshots and14px action labels). All folders are under C:/Users/ghg/AppData/Local/Temp. Desktop/phone walkthrough and final phone header were visually inspected; no page overflow, browser errors or provider/model calls. Computed text contrast and reduced-motion/keyboard checks passed in the existing landing suite.

Implementation is locally complete. User visual approval and the previously listed actual-device/deployment checks remain separate.

## Restore the earlier landing experience - 2026-09-15

The latest user review supersedes the simplified editorial landing composition. Restored the layered enquiry/source/fact/unknown/action hero, orbital connectors, bold Manrope headline, contrasting interactive stage, illustrated review panel, feature panels and section rhythm from commit 86331d6. Colours use the existing ivory and ultramarine tokens. Retained the shared BrandMark, self-hosted fonts, larger labels, blue hover/focus/selection cues, current clearer FAQ wording, automatically visible synthetic walkthrough, loading, registration and existing request-form destinations. Only LandingPage.tsx and landing.css changed in runtime source; no API, database, authentication, availability-capture or demo-state contracts changed.

TypeScript passed with node client/node_modules/typescript/bin/tsc -b client. Production build passed with node client/node_modules/vite/bin/vite.js build client. The existing node scripts/run-landing-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs suite passed all 27 scenarios on the final build. This covers rendered-text contrast, keyboard/reduced-motion and 360px navigation, synthetic review/edit/opt-out state, API outage, failed demo loading, CTA destinations, consent/retry, real registration, app loading and protected deep links. No test was added, removed or weakened.

Final asset identity: index-BdyoBXnw.js, index-CBq9ENYB.css, LandingPage-BFPNwySx.js, LandingPage-Y_wC-vbC.css and LandingDemo-BMCnEZhI.js. Loaded public JavaScript is 113,786 gzip bytes, below the existing 200 KiB gate. Browser: Chromium 140.0.7339.16. Final suite artifacts: C:/Users/ghg/AppData/Local/Temp/relay-landing-ui-fsstmh.

Visual diagnostics covered widths 1440, 1280, 1024, 768, 390 and 360 without horizontal page overflow or browser errors. The original hero screenshot was compared with the restored desktop hero; the walkthrough, review panel and phone hero were inspected. Initial screenshots identified the enlarged hero action card overlapping its bottom caption. Reserved extra stage height for desktop and phone, retained the tablet composition, then rebuilt and reran the full affected landing suite. Final screenshots and geometry in C:/Users/ghg/AppData/Local/Temp/relay-lively-visual-qGDoyv confirm clear caption spacing (at least 24px at the measured phone widths). Hover still gives the blue wash, border and 2px diagonal record-arrow cue; reduced motion remains supported.

Local implementation and browser verification are complete. User visual acceptance, actual-device/screen-reader checks and hosted deployment remain separate. Historical broader app/backend/provider/database results above were not rerun or newly claimed for this landing-only restoration.

## Landing motion enhancement - 2026-09-15

Added native motion to the existing restored composition: staggered hero/section entrances, finite floating-card settling and SVG orbit tracing, a small fine-pointer depth response, navigation/CTA/card feedback, menu and FAQ entrances, and walkthrough step/result transitions. The hook uses IntersectionObserver, requestAnimationFrame and Web Animations without a new dependency. Motion is presentation-only: no automatic demo progression, API/schema changes or provider actions. Content remains visible by default when observation/animation APIs are absent or reject an animation. Focus cancels a reveal containing the focused control; preference changes cancel active motion and clear pointer offsets. Hero decorative work stops offscreen/when the document is hidden; its longest entrance finishes in 4.25 seconds.

Runtime files: client/src/marketing/LandingPage.tsx, use-landing-motion.ts and landing-motion.css. Browser coverage adds scripts/helpers/landingMotionChecks.js, invoked by the existing verifier without deleting or relaxing prior assertions. Four new scenarios cover real pointer/scroll movement and finite settling, initial mobile reduced motion, live preference changes, and unavailable/rejected animation APIs with working keyboard CTAs and native FAQ. Fallback cases are synthetic browser-API failures, not provider failures.

TypeScript and production build passed. The existing safe landing launcher passed all 31 scenarios (27 retained plus four added) on final index-DPztKlUN.js, index-DgAUhRoD.css, LandingPage-CreUCZp7.js, LandingPage-DDEWb2Wf.css and LandingDemo-CoxaPM0K.js. Command: node scripts/run-landing-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs. Chromium 140.0.7339.16; public JavaScript 115,115 gzip bytes, below 200 KiB. Final artifacts: C:/Users/ghg/AppData/Local/Temp/relay-landing-ui-cRfcgk. Motion screenshots and reduced-motion phone view were inspected.

The first candidate failed the existing contrast audit during a step-number background/text colour crossfade. Removed colour interpolation from those number badges while retaining their transform transition; rebuilt and reran all scenarios successfully. The transient contrast failure was corrected in product CSS, not bypassed in the verifier. Final format check covers 563 files, with separate whitespace checks for the new client files and git diff --check passing.

Responsive diagnostics at 1440, 1280, 1024, 768, 390 and 360px preserved the existing hero/card geometry without horizontal overflow or runtime errors (C:/Users/ghg/AppData/Local/Temp/relay-motion-visual-UyjKmM; captured before the final badge-colour-only correction). Final suite confirms mobile fit and pointer movement without overflow. Local implementation is complete; user motion comfort/visual acceptance and actual-device/screen-reader/hosted checks remain separate. The broader app/backend/provider/database suite was not newly rerun or claimed for this presentation slice.

User reviewed the local motion enhancement, accepted the direction and authorized pushing as gshyam46 on 15 September 2026. Actual-device, screen-reader and hosted acceptance remain separate.
