# L4-01 provider verification browser evidence

Recorded 2026-09-13 against the implemented [provider verification contract](../L4-01_PROVIDER_VERIFICATION.md). This records actual Chromium interaction with the built React client, disposable SQLite and synthetic adapters. It does not certify a deployed channel.

## Result

**12 checks passed; 0 browser script errors; 0 model calls; 0 transport invocations; 0 action executions.** One explicit injected configuration check produced five synthetic results. Two fixed probe actions were prepared, and the exact delivery revision was explicitly approved without dispatch.

Command from the repository root:

~~~powershell
node scripts/run-email-verification-ui.js --playwright-module C:/Users/ghg/anaconda3/Lib/site-packages/playwright/driver/package/index.mjs
~~~

Chromium **140.0.7339.16**. Frozen entry assets: **index-DPnXXp52.js** and **index-BtH8F8e8.css**. Relevant loaded chunks: **settings-ByA8Bltx.js**, **settings-ChM8ZjHl.js**, **approval-review-dialog-Ck2cgVTy.js**. The verifier compares index.html before and after the run to detect a concurrent build.

## Behavior checked

1. Opening and refreshing verification reads current evidence without creating records, checking a provider or sending.
2. The two deployment-controlled destinations are visible and cannot be edited in the verification form; the API key is absent from rendered text.
3. An accepted create response is intentionally lost. The form retains and locks the exact original request, with one persisted run and no probe or configuration check.
4. Retrying sends the identical original command and recovers that run. Request lookup also returns the original run without network work.
5. Probes remain disabled before a successful check. Only the explicit check calls the injected adapter; five PASS results still leave normal live sending held and journey evidence unrecorded.
6. Preparing delivery and rejection creates exactly two fixed REQUIRED-approval actions, with no decisions, executions or messages sent.
7. The actual approval dialog displays the persisted recipient, sender, Reply-To, subject and full fixed body.
8. The exact review has no horizontal overflow at 390 CSS pixels; its final mobile screenshot was visually inspected.
9. Explicit approval records the displayed revision and does not dispatch.
10. Exact nonce-bound reply and stop instructions are visible, including persistent stop-policy wording. Instructions do not substitute for recorded journey evidence.
11. A real reviewed domain-service sender change makes the previous run historical, exposes the need for a new current run and preserves both original probes.
12. The build stays unchanged, no unexpected browser writes occur, and model/transport/execution counts remain zero.

## Fixture boundaries and troubleshooting

The root-owned launcher strips inherited database/provider configuration, chooses an owned loopback port, requires an isolated in-memory harness handshake and starts the existing installed browser. Requests outside that loopback origin are aborted. The worker and analysis pump are disabled; any outbound adapter invocation throws and is counted.

The normal application remains on loopback HTTP. The owned fixture injects an EmailVerificationService with a fixed synthetic HTTPS origin, two fixed synthetic destinations and an in-process PASS adapter. This is an explicit test seam for the verification state machine, not evidence of TLS, DNS, SendGrid permissions or mailbox authorization. The fixture seeds and changes connection settings through the real reviewed EmailConnectionService with the registered synthetic owner because the isolated HTTP harness correctly refuses selecting a live provider. Production origin, capability and provider-selection guards were not changed.

Initial harness runs stopped at the expected isolated HTTP provider-selection refusal and at a raw-label selector that included React's initial textarea content. The final fixture preserves the refusal, uses reviewed domain setup, and selects the message by its exact accessible textbox name. No product assertion was removed and no runtime/UI defect was found in this bounded verification.

## Artifacts and cleanup

Final synthetic screenshots are retained outside the source tree at:

~~~text
C:\Users\ghg\AppData\Local\Temp\relay-email-verification-ui-Lf4if5\email-probe-exact-review.png
C:\Users\ghg\AppData\Local\Temp\relay-email-verification-ui-Lf4if5\email-probe-review-mobile.png
C:\Users\ghg\AppData\Local\Temp\relay-email-verification-ui-Lf4if5\email-verification-evidence.png
~~~

These machine-local artifacts may expire. Failed-run artifact directories were removed after checking their exact resolved temporary paths. The fixture closed the browser, HTTP server and disposable database. No owned background session remains.

## Remaining human/provider QA

A deployment operator must independently establish authorization for both destinations and complete actual current-configuration provider checks, reviewed sends, signed delivery/rejection/reply/stop receipt processing, real HTTPS/DNS setup and operational/PostgreSQL acceptance. No live provider call, signed provider event, actual delivery or full live-send unlock was attempted in this browser run. The separate [signed HTTP regressions](../../test/completion-provider-http.test.js) and automated provider tests retain their own scopes; synthetic evidence is not customer or hosted-provider proof.
