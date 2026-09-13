# L4-01 provider-verification backend evidence

Recorded 2026-09-13 under the [accepted provider-verification contract](../L4-01_PROVIDER_VERIFICATION.md). This records local synthetic implementation evidence. No real provider credential, mailbox, domain, send, remote configuration change or hosted deployment was used.

## Implemented authority

Verification runs bind the managed connection revision, exact private configuration fingerprint, deployment-controlled delivery/failure recipients and public origin. Creating a run or reading status makes no provider call. Original request keys preserve lost-response recovery; configuration corruption can leave the original accepted run readable as stale without granting readiness.

Explicit provider checks persist admission before at most five fixed-host GET requests. One active check per workspace uses a120-second lease; each run has at most100 ordered checks. Check number defines latest authority even when timestamps are identical. The latest failed/unknown check supersedes an earlier pass. Current passes expire after24hours, using the existing durable workspace technical high-water so expiry observed during rejected dispatch cannot be undone by physical clock rollback. Late/interrupted checks cannot overwrite newer numbered authority. Provider credentials, bodies and raw errors do not enter public check summaries.

A run creates one fixed DELIVERY and one fixed FAILURE action, each requiring the normal exact review and approval. The same action may receive a fresh approval for identical envelope content after business context changes. Edited/copy actions, other recipients, changed configuration and unresolved prior probes cannot acquire the controlled exception. All ordinary contact, due-time, operational quota, lease, idempotency and uncertainty checks remain in force. Generic dispatch requires a current provider check plus all four recorded delivery/failure/reply/stop milestones.

The original signed-receipt insertion hook binds the exact configuration, signing key, route and normalized payload used by ingress. Internal/unsigned/deduplicated/conflicting receipts cannot gain fresh verification evidence. Receipt/proof insertion rolls back together. Verification counts only processed normal effects: exact execution/revision/content/recipient callback facts, canonical inbound messages, and the real persisted opt-out restriction. At most20 proofs per run and five per kind prevent repeated delivery events from consuming the slots for later stop/reply evidence. Additional proof attribution never blocks required webhook policy processing.

The async capability read helper uses the same current database evidence. Synchronous setup assessment stays conservative. Root owns current connection/composer/API readiness projection wiring, raw signed HTTP integration, migration0022, configuration and UI. Existing immutable setup history remains historical.

## Automated checks

Final focused command:

~~~text
node scripts/run-tests.js test/l401-email-verification.test.js test/l401-email-verification-adapter.test.js test/l401-channel-capability.test.js test/prepared-action-review.test.js test/sendgrid-webhook-security.test.js
~~~

Result: **57 passed, 0 failed, 0 skipped**. The set includes24 new service/adapter cases and33 existing capability, prepared-review and signed-ingress regressions. Counts overlap any later full-suite run.

New behavioral coverage includes strict owner/tenant/input scope; provider-free creation; request replay; missing deployment mailbox authorization; check single-flight and interruption; same-clock newer failure; stale configuration during network work; exact expiry and rejected-dispatch clock rollback; fixed probe edit/copy rejection; full synthetic delivery/failure/reply/stop and ordinary dispatch; fresh identical review after a real profile revision; old uncertain probe preservation across changed configuration; wrong recipient/key/route; internal receipt and dedupe refusal; atomic receipt/proof rollback and retry; proof-kind capacity; corrupted-state original request recovery; and actual async readiness projection.

Adapter tests cover the finite GET route set, exact scope/domain/URL/key/event/Parse policy checks, missing read permission distinct from missing send scope, bounded result sets, malformed configuration, sanitized failures and actual transport response-size/redirect settings with an injected fetch. The test does not wait for a real15-second network timeout; the adapter reuses the already bounded provider transport. Local proof tests inject the trusted receipt metadata/hook; the included existing signed-ingress regressions verify raw signatures, and root owns the new integrated signed HTTP verification journey.

The safe test launcher removed inherited database/provider configuration and used disposable SQLite. No installation, live network/provider/model request, deployment or external message occurred. No temporary server or fixture files were created. Owned diff whitespace checks passed.

## Current provider documentation checked

The current official [scope endpoint](https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access) reports permissions for the actual credential. The [authenticated-domain endpoint](https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/list-all-authenticated-domains) supports bounded filtering/pagination and a recorded validity flag. These are permission/configuration checks, not delivery proof.

The [event webhook list](https://www.twilio.com/docs/sendgrid/api-reference/webhooks/get-all-event-webhooks) reports destinations, selected events and a public key for enabled signature verification. The [Parse security guide](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks) documents the attached security_policy ID and raw-body verification. The [security-policy read endpoint](https://www.twilio.com/docs/sendgrid/api-reference/settings-inbound-parse/retrieve-a-specific-parse-security-policy) returns the policy signature public key. Missing or incompatible fields remain unverified; the implementation does not infer remote success from a stored local key.

## Remaining acceptance and limitations

Real acceptance requires the deployment operator to independently authorize two distinct controlled recipients, including a sink that actually rejects delivery; configure the SendGrid global account, authenticated From domain, parsed Reply-To mailbox/MX, exact HTTPS routes, read/send scopes and separate signing policies; approve the exact probes; and demonstrate signed delivery, rejection, reply and stop. A signed From alone is not mailbox-control proof. There is no client recipient nomination, verification checkbox or bypass flag.

The delivery mailbox's opt-out and any failure-address restriction remain effective. A changed configuration needing fresh probe evidence may need newly authorized clean sinks; this flow does not clear restrictions or resubscribe them. Successful remote checks are point-in-time evidence with a24-hour validity window, not continuous provider monitoring. External provider failures and changed remote settings can occur afterward. The global API endpoint is supported; EU-region accounts remain outside this contract. Configured settings and adapter tests do not certify sender reputation or customer usefulness.

Root integrated API/browser validation, PostgreSQL migration/concurrency and restored-state proof, public TLS delivery, operator recovery after an uncertain actual send and human inspection of the exact instructions remain separate acceptance evidence. Historical outcome/restriction records remain true after expiry and cannot verify a different connection revision.

## Owned files

channels/emailVerificationContract.js, emailVerificationRepository.js, emailVerificationService.js and sendgridVerificationAdapter.js; narrow channelCapability.js and outbound-automation/preparedActionService.js changes; test/l401-email-verification.test.js and l401-email-verification-adapter.test.js; this evidence. Shared API/configuration/registry, inbox insertion callback, normal inbound analysis exclusion and current setup/composer projections are integrated by root.
