# L4-01A channel capability verification

Recorded: 2026-09-12. Scope: channel capability registration, exact prepared-message authority and dispatch holds under [the recorded contract](../L4-01_CHANNEL_SETUP.md). This is local synthetic verification, not provider verification or live-send acceptance.

## Implemented

Unregistered and normal application runtimes are strict. Sandbox and human tasks remain usable. Unsupported live providers return CHANNEL_LIVE_UNSUPPORTED; incomplete SendGrid setup returns CHANNEL_SETUP_REQUIRED. Structurally complete SendGrid setup permits exact review and approval, but every new live dispatch remains held with CHANNEL_VERIFICATION_REQUIRED. Neither a saved key nor an owner-authored verification field grants provider verification.

The immutable capability profile belongs to the originating database instance and is shared by scoped transaction clients. Re-registering the same profile is idempotent; conflicting registration is rejected. Legacy adapter contract tests require explicit env=test plus testControlsEnabled=true and exclude isolatedE2eHarness. Development, staging, production, unregistered databases and test mode without controls remain strict.

Prepared email captures validated, canonical Reply-To alongside From, recipient and exact copy. The existing full private configuration fingerprint binds return address, credentials, signing keys, route token and the reserved monotonic connection revision. Dispatch re-reads the authoritative configuration inside the workspace transaction instead of trusting an early caller snapshot. Existing historical policy and neutral fingerprints are unchanged.

Capability refusal occurs before an execution reservation or adapter invocation. It returns a finite typed channel hold while retaining the current action, exact revision and approval decision. Already-authorized transport uses its captured envelope/configuration. Exact late callbacks and duplicate receipt handling continue to preserve actual outcomes even after configuration becomes unsupported.

## Automated evidence

Command:

```text
node scripts/run-tests.js test/l401-channel-capability.test.js test/prepared-action-review.test.js test/email-channel.test.js test/exact-callback-recovery.test.js
```

Final result: **55 passed, 0 failed, 0 skipped**: 11 new channel-capability cases, 17 prepared-review regressions, 13 email transport/settings regressions and 14 exact-callback recovery regressions. The safe launcher used disposable SQLite and removed inherited provider/database configuration. Transport was injected locally; no live provider calls or sends occurred.

Browser verification after the initial 53 passing checks exposed an explicit Sandbox Reply-To omission. Email sender normalization now captures configured return addresses for Sandbox as well as SendGrid. A selective binding check replaces older envelopes that omitted a configured address; missing-value Sandbox envelopes and the global prepared policy version remain unchanged. Two added regressions cover the exact Sandbox envelope and the historical omitted-field case.

The new cases prove strict and immutable runtime selection; transaction-root propagation; truthful capability distinctions; malformed/incomplete setup refusal without reviews; concurrent complete-SendGrid dispatch holds with zero attempts and unchanged approvals; historical approved unsupported/incomplete setup holds; stale caller configuration rejection; monotonic connection-revision edit-back rejection; credential/key/route/From changes invalidating review; captured Reply-To in the actual SendGrid adapter request; and truthful late callback/idempotency preservation.

Existing provider request, reviewed content, recipient, retry-key, retryable rejection, uncertain outcome, credential masking and exact callback assertions passed unchanged. No legacy test/helper was modified to obtain this result. The connection-revision test seeds reserved revision values directly to isolate prepared authority; root/backend tests own the actual owner-write transaction, revision increment and rollback.

## Files and contracts

Owned source: src/modules/channels/channelCapability.js; src/modules/outbound-automation/preparedActionService.js; narrow src/modules/handlers/actionExecutor.js integration. Owned tests: test/l401-channel-capability.test.js. This document records focused evidence.

Exports: configureChannelRuntime(db, config), channelRuntimeFor(db), assessChannelCapability({action_type, configuration, runtime}), requireChannelCapability(db, {action_type, configuration, phase}) and isChannelCapabilityError(error). REVIEW and DISPATCH phases consume fixed CHANNEL_LIVE_UNSUPPORTED, CHANNEL_SETUP_REQUIRED and CHANNEL_VERIFICATION_REQUIRED codes. Root owns application registration and API projection; backend supplies pure structural email validation.

## Remaining acceptance

L4-01 remains open. Real sender/domain/credential verification, Parse security-policy attachment, authorized delivery/failure/reply/stop, correct enquiry correlation, signing-key rotation, PostgreSQL concurrency/restore and human/operator/mobile review remain separate work. A fixed Reply-To mailbox does not establish thread ownership or consent. No route, credential, mailbox or provider account was remotely checked by these tests.

Root owns shared API/config/migration and complete suite evidence; backend owns setup/routing service evidence; UI owns actual browser evidence. This focused result does not claim those checks.
