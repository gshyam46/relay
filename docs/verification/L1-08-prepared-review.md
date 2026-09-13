# L1-08 exact prepared review and provider dispatch verification

Date: 2026-09-11.
Product: **AI Lead Intelligence & Outbound Automation**.
Status: local implementation and automated evidence. Root owns integrated acceptance; live provider, PostgreSQL and browser QA remain separate gates.
Contract: [L1-04/L1-08 reviewed dispatch](../L1-04_L1-08_DISPATCH.md).

## Implemented behavior

- Migration 0004 adds immutable action revisions and append-only review decisions. Existing approvals do not acquire invented reviewed content.
- Prepared revisions include the normalized recipient, explicit sender/provider, subject/body, schedule and policy version. The stored private binding fingerprints cover action/lead context and the complete sender configuration, including credential rotation. Raw credentials stay out of revision persistence, API responses and provider error results.
- Authenticated decisions require the exact current revision ID. An edit first creates a new preview and token; a decision cannot smuggle in unseen edited text. Earlier decisions and reviewed content remain available as history.
- Approval, rejection, preview, revocation and sender-setting updates use the workspace transaction gate. Their action/revision/projection/audit changes commit together. Known-safe RETRYING actions retain unchanged approval and can revoke it; EXECUTING actions cannot be recalled.
- Revocation normally creates a new pending revision. When current sender, recipient or content fails expected validation, it instead clears current revision authority and leaves a pending hold. After configuration repair, a fresh preview and explicit decision are required. Storage/internal failures still roll back the entire operation.
- The router and email/SMS/WhatsApp/voice adapters require the captured approved dispatch context. The actual provider payload uses the captured recipient, sender, text and credentials without rereading mutable repositories.
- Provider transport loss and 5xx responses produce an uncertain, non-retryable result. HTTP 429 is an explicit known rejection eligible for the executor's bounded retry policy. Success reports provider acceptance, not verified delivery.
- Outbound and lead detail now open one shared review dialog. It displays exact server-prepared content and sender/recipient, identifies sandbox simulation, requires Update preview after edits, exposes revocation, and refreshes stale previews. A selected batch is reviewed explicitly one item at a time. Row text is labelled original draft context.

## Verification

Executed with the inherited-configuration-safe runner against disposable SQLite and local fetch stubs only:

```text
node scripts/run-tests.js test/prepared-action-review.test.js test/human-approval.test.js test/approval-unit-of-work.test.js
39 tests passed; 0 failures; 0 skips.
```

Coverage includes missing/stale tokens, cross-tenant refusal, exact edits, conflicting simultaneous decisions, duplicate requests, transactional failure recovery, immutable legacy history, recipient/configuration changes, valid unchanged retries, revoked retries making no further provider call, invalid-config revocation, terminal-state preservation, restart persistence and no raw credentials on the public review response.

Real adapter request construction is exercised using local fetch stubs for Resend, SendGrid, Twilio SMS, Meta WhatsApp and Twilio voice. Assertions compare the actual serialized destination/from/body (including escaped markup and multiline text) with the reviewed envelope after mutable settings change. Separate checks cover uncertain transport/server results and atomic settings rollback.

Client validation from client/:

```text
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
```

Both pass. Vite retains the approximately 851 kB main bundle warning; this is not performance acceptance. Browser tools were unavailable, so successful compilation is not presented as an interactive walkthrough.

## Human and integration QA still required

1. In a disposable workspace, review each channel and confirm sender, recipient, content, simulation label and schedule. Edit content, update preview, read it again, approve, then inspect the exact stored conversation/dispatch snapshot.
2. Test keyboard focus, Escape/Close, focus return, scrolling, mobile widths, error messages and sequential batch decisions in the real browser. Confirm a stale open dialog cannot approve an old revision after another session edits the lead or settings.
3. Revoke an approved item and a confirmed retryable item; confirm both remain held until a new review. Remove sender credentials and confirm revocation still succeeds. Confirm EXECUTING items offer no recall promise.
4. Use the explicit isolated PostgreSQL harness to verify migration 0004 and real two-connection workspace/action ordering. This agent ran no live PostgreSQL or customer database operations.
5. With separately approved provider setup, compare a real received message/call with its approved snapshot and verify receipt/signature/reply/opt-out handling end to end. Local request stubs establish serialization correctness, not live delivery, provider policy eligibility or sender readiness.

## Boundaries

This slice is not the full L4 composer, a production provider certification, a consent/cadence policy engine or L1-05 crash reconciliation. Unsupported dispatch handlers fail closed; unsafe normal manual placeholder sends remain disabled by the integrated API. Existing prepared-envelope policy version must change when a future renderer/provider transformation changes reviewed content semantics.
