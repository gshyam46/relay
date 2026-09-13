# L3-03 final intelligence trust browser regression

Date: 2026-09-12. Actual production React verification for AI Lead Intelligence & Outbound Automation after the L3-03 job/usage integration. This is engineer-run local evidence, not customer, native-language, mobile/accessibility or hosted-provider acceptance.

## Result and exact build

Final scripts/verify-intelligence-trust-ui.js execution passed **19 of 19 checks**, with no browser runtime errors and no POST requests during viewing, navigation, filtering or focus. Chromium version: **140.0.7339.16**, headless, viewport 1440x1080.

The verifier records actual requested production assets and asserts client/dist/index.html remains unchanged during the run:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| client/dist/assets/index-18kjkRNk.js | 1087919 | a6bf5ee7266671a9e7e28751eb7153312a471fde16a22d868f530bfb82d0c1bc |
| client/dist/assets/index-CMa1vg_D.css | 35310 | f24e7f1f2e5f70db5e5977df477fb7e3c0ab339d385851dd43d2700dcd94175d |

A preceding 19-check run passed while another client rebuild occurred near its execution window. Its initial asset label could not be established reliably, so it is not used as final-build evidence. The final run above followed the UI owner's explicit source/build freeze and verified both requested asset names. Repeated runs are not additive coverage.

## Isolated fixture and command

The temporary launcher imports safeTestEnvironment and runTestProcess, obtains an available ephemeral 127.0.0.1 port, and starts:

node scripts/verify-intelligence-trust-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs

The child receives only sanitized OS essentials plus NODE_ENV=test, DATABASE_FILE=:memory:, ENABLE_TEST_CONTROLS=true, WORKER_ENABLED=false, ISOLATED_E2E_HARNESS=1, its own PORT and matching PUBLIC_APP_ORIGIN. It verifies the existing isolated-harness handshake before browser work. Browser requests outside that exact loopback origin are aborted. No install, live provider, external model, outbound-worker activation or production fixture endpoint is involved.

The narrow existing intelligenceTrustFixture now supplies one explicit synthetic adapter through createApp's test-only injection and the real invocation gateway. The actual bounded provider request validator prepares inputs; the fixture's completion method returns synthetic structured values and synthetic telemetry without transport. Factory-created metered agents handle model branches; explicit local and historical fixture branches preserve their original trust cases. The real job/event path persists analysis, and receipt processing persists reply classification.

Before UI assertions, the verifier also checks exactly seven OBSERVED model admissions: four synthesis scenarios and three reply scenarios. Local extraction, local replies, direct stop policy and historical fixture construction create no phantom model attempt. Those seven are synthetic usage records and are not measurements from an actual model.

## Coverage and visual inspection

The 19 checks retain application versus model extraction, exact recorded support expansion, supported model selection, empty/rejected/unavailable model fallback, historical missing provenance, research confidence/source explanation, original local reply/confidence disclosure, unclear-reply human review and the existing lead-review path, an unconfirmed model candidate, provider-failure review fallback, explicit stop without a fabricated reply obligation, LOW-confidence possible opt-out retaining independent stop/review labels, historical reply gaps, shared inbox/timeline interpretation, missing original text, navigation without POST side effects and browser-error absence.

Final synthetic artifacts are retained at:

C:/Users/ghg/AppData/Local/Temp/relay-intelligence-trust-ui-wVdEF6/

- exact-source-support.png
- reply-candidate-review.png
- possible-optout-review.png

The engineer visually inspected all three final screenshots. Source disclaimers and expanded exact support are legible; the candidate remains explicitly unconfirmed; the possible opt-out displays both Stop contact and Human review required alongside the original message and restriction explanation. These observations do not replace customer comprehension or accessibility testing. The standard image-view helper failed its sandbox setup, so the unchanged local PNG bytes were read through the approved filesystem tool and forwarded directly for visual inspection; no image was edited.

## Files and cleanup

Only scripts/verify-intelligence-trust-ui.js and scripts/helpers/intelligenceTrustFixture.js changed for this regression: gateway-aligned synthetic preparation, explicit persisted-admission checks, and stable requested-build evidence. Both pass Node syntax checking. Runtime, UI source and shared safety helpers were unchanged by this owner.

Both owned fixture servers closed normally; follow-up loopback probes confirmed ports 57501 and 58094 refuse connections. Browser/context handles and both in-memory databases were closed by the verifier. The exact owned temporary launcher and logs were removed after path validation; final screenshots remain as evidence. Root records the broader suite, build and other browser checks in [integrated verification](L3-03.md).
