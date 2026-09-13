# Completion browser regression checkpoint

Recorded 2026-09-13 at 02:25 +05:30. These checks ran sequentially against the frozen final build without rebuilding or editing runtime/browser scripts. Earlier landing, setup and intelligence-trust evidence remains historical.

## Build and environment

- JavaScript: index-DPnXXp52.js
- CSS: index-BtH8F8e8.css
- Shared runtime: jsx-runtime-B-hcVAMW.js
- Chromium: 140.0.7339.16
- Installed Playwright module: C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs

After all three runs, client/dist/index.html still referenced the exact requested JavaScript and CSS. SHA-256:

```text
e0e42877a5886ead7370aa2a2cc543323a428bb51d04ab3c4a3d5a72c1ca0701  index-DPnXXp52.js
7245ec6d8b1da3593b72b4a391aa7fc534bf4daa8c8beee09cf09aad996b07e3  index-BtH8F8e8.css
```

Each existing runner selected its own ephemeral loopback port and sanitized child environment through safeTestEnvironment/e2eEnvironment. Each fixture used disposable in-memory SQLite with providers disabled. No customer database, live provider, model request, browser installation, network package pull or deployment was used. All three runners exited successfully and completed their owned fixture cleanup.

## Commands and results

```powershell
node scripts/run-landing-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs
node scripts/run-setup-journey-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs
node scripts/run-intelligence-trust-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs
```

| Suite | Checks passed | Exit | Owned loopback port |
| --- | ---: | ---: | ---: |
| Landing | 21 | 0 | 61542 |
| Setup journey | 15 | 0 | 52460 |
| Intelligence trust | 20 | 0 | 52515 |
| This checkpoint | 56 | All 0 | Three separate fixtures |

Landing verified static/indexable public content and protected-route separation, no initial authenticated/provider calls, explicit synthetic interaction, evidence and uncertainty, exact draft review, opt-out controls, API/chunk failure handling, mobile layout, consent/rate-limit/lost-response handling, actual Sandbox registration and protected deep links. Initial public JavaScript measured 103280 gzip bytes, below the existing 200 KiB regression threshold; the lazy demo and protected pages were excluded. The existing rendered-text contrast checks passed.

Setup verified saved configuration rather than invented completion, descriptive versus typed criteria, currentness links, exact approval invalidation, actual reminder/outcome links, GET-only refresh, missing/corrupt-state handling, separate workspace scope, mobile navigation and keyboard focus.

Intelligence trust verified original source and model/extraction distinctions, visible malformed/empty/unavailable fallback, historical provenance limitations, reply candidate versus authoritative event, conservative uncertain opt-out, absent-body handling, no navigation-triggered generation, and same-SPA session expiry followed by another owner's sign-in without cached inbox leakage.

No assertion was removed or weakened. No browser runtime error or unexpected mutation was reported in these exercised journeys. This checkpoint does not replace root's completion regression or the other agents' provider/data checks.

## Retained synthetic screenshots

The runners retained temporary local screenshot directories for inspection. These files contain synthetic fixture data and are not durable release storage; copy only approved artifacts to the release evidence location before temporary-directory cleanup.

| Suite | Directory | Files |
| --- | --- | --- |
| Landing | C:/Users/ghg/AppData/Local/Temp/relay-landing-ui-69QEpa | landing-demo-evidence.png, landing-desktop.png, landing-hero.png, landing-mobile-demo.png, landing-mobile-stage.png |
| Setup | C:/Users/ghg/AppData/Local/Temp/relay-setup-journey-ui-rJFyfO | public-product-information.png, setup-journey-desktop.png, setup-journey-narrow-workflow.png, setup-journey-narrow.png, setup-mobile-navigation.png |
| Intelligence trust | C:/Users/ghg/AppData/Local/Temp/relay-intelligence-trust-ui-pEt4mN | exact-source-support.png, possible-optout-review.png, reply-candidate-review.png |

## Acceptance boundary

This is automated local evidence on the named frozen assets. It does not certify actual PostgreSQL behavior, hosted provider/model quality, public request delivery, deployed retention, screen-reader/physical-device acceptance, customer usefulness or a public launch decision. Live operator/provider/customer acceptance and the L6 publication decision remain separate gates.
