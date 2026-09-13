# L4-01A email connection backend verification

Status: local synthetic implementation evidence,2026-09-12. This is the setup portion of L4-01, not verified provider operation or pilot acceptance.

## Implemented boundary

EmailConnectionService owns explicit owner SAVE, PROVISION_ROUTE and ROTATE_ROUTE commands with expected revision, current configuration review token, request key and required reason. Configuration remains in organization_settings; append-only email_connection_revisions records public before/after summaries and audit commits atomically. API credentials and private configuration fingerprints are absent from public change/history responses.

GET is read-only. It reports masked settings, structural prerequisites, LEGACY/MANAGED/DRIFTED state, canonical routing URLs, bounded history and explicitly UNVERIFIED provider checks. A key with valid shape cannot produce provider verification or live-send permission. The top-level live_send_available remains false; Sandbox capability is separate. Root/reviewer own the normal runtime dispatch guards and API composition.

Files owned: src/modules/channels/emailConnectionContract.js, emailConnectionRepository.js, emailConnectionService.js; narrow ambiguity refusal in src/modules/settings/settingsRepository.js; test/l401-email-connection.test.js. Root owns migration0017/API/config/secret masking; reviewer owns channelCapability and prepared/dispatch integration.

## Authority and bounds

- Full owner values allow exactly provider:sandbox|sendgrid, from_email, reply_to, api_key and separate SendGrid event/inbound public keys. Secret mask means KEEP; empty means CLEAR; an explicit replacement changes the secret. Mailboxes are normalized explicitly. Supplied keys must parse as supported EC P-256 public keys; this only checks local structure.
- Private settings reads preflight at most 32 keys, 65536 aggregate UTF-8 bytes and 200 characters per key before materialization. Every SAVE, PROVISION_ROUTE and ROTATE_ROUTE also preflights the exact resulting configuration against those same bounds before revision, alias, settings or audit writes. Untouched legacy values retain their actual stored JSON byte counts, including whitespace and escapes; changed fields use their exact forthcoming JSON serialization. Invalid JSON and inconsistent reserved connection_revision require operational inspection. Unknown legacy private settings remain stored and influence the private configuration fingerprint; strict public projections omit them.
- Public change snapshots are at most16KiB each; reasons2000 characters, request keys200; maximum100 changes. History defaults20/max50. Exact request replay returns the original accepted change even after subsequent secret changes and at the history limit.
- Up to10 generated webhook aliases plus one uniquely owned legacy alias are retained. First provisioning preserves that legacy alias before replacing the advertised token. Generated aliases are unpredictable and globally unique; prior aliases remain resolvable and require the existing signature validation.
- A collision across any generated/legacy ownership refuses tenant resolution. Ambiguous legacy provisioning rolls back without removing an owner. Reserved advertised-route drift cannot be silently repaired by SAVE; it fails closed like reserved revision drift. This closes a root-review finding where automatic repair could have reassigned an old shared token.
- Route URLs use the constructor's canonical configured public origin. No request Host/Forwarded value, browser origin or provider network call supplies readiness.
- Email configuration validation is pure and does not import the event processor. Local canonical hashing preserves the existing valid-value serialization algorithm while removing that runtime dependency.

## Automated evidence

Final owned command:

~~~powershell
node scripts/run-tests.js --test-concurrency=1 test/l401-email-connection.test.js
~~~

Result: **14 passed, 0 failed, 0 skipped** on disposable SQLite with inherited database/provider configuration removed. Synthetic P-256 public keys were generated locally. No provider API, probe, test send or hosted model call was made.

Coverage:

- Empty and legacy reads produce no settings, aliases or verification proof.
- Complete-looking SendGrid configuration remains explicitly unverified; public history does not disclose credentials.
- Exact credential KEEP/REPLACE/CLEAR and original-request lookup/replay after later writes.
- Reserved fields, unsupported providers, malformed mailboxes, unsafe credentials and wrong-curve public keys reject.
- Owner/tenant checks and changed database role.
- Concurrent expected revisions, stale masked-secret configuration tokens and explicit legacy drift adoption.
- Injected audit failure rolls back configuration, revision and both first-provision aliases.
- Ten generated aliases remain resolvable; an eleventh is refused.
- Duplicate legacy/generated ownership refusal and no ambiguous provisioning side effects.
- Reserved token/revision drift does not silently remove or reassign routing ownership.
- Transaction-reader spy proves byte preflight before full configuration materialization; corrupt JSON refuses review.
- 100-change cap, exact prior replay, paged retained history and strict integer parsing.
- Proposed aggregate byte and key-count refusals preserve current GET readability, raw legacy JSON, revision, routing, audit and absent request recovery. A smaller corrected request can reuse the rejected key successfully.

Independent review reproduced an accepted SAVE that made subsequent GETs exceed the inspection budget. Two new behavioral regressions reproduced the omission before the fix (12 passed, 2 failed) and passed after proposed-state preflight was added. One regression deliberately preserves 65000 bytes of JSON whitespace around a small legacy value, so counting parsed values alone would still fail it.

Root owns migration, signed-webhook alias integration, HTTP/full-suite and browser evidence. Reviewer owns actual review/dispatch capability and unchanged adapter behavior evidence. Do not sum overlapping focused runs.

## Remaining acceptance

Real credential permissions, sender/domain ownership, Parse hostname/security-policy attachment, signing-key rotation and controlled send/delivery/failure/inbound/stop behavior remain unverified. A configured fixed Reply-To mailbox does not establish exact enquiry/thread correlation or original sender identity. Customer channel choice, monitored mailbox ownership, operator/mobile acceptance and actual PostgreSQL concurrency/restore remain separate gates. L4-01 remains partial.
