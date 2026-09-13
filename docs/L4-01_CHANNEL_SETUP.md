# L4-01A First-channel setup and capability boundary

Status: implementation contract recorded before runtime edits,2026-09-12, under continued implementation authorization. This is the bounded local setup portion of L4-01. Dependencies: locally implemented L1 dispatch/receipt safety, L2 context and L3 intelligence; their external acceptance remains open.

## Decision and scope

Keep email/SendGrid as the provisional engineering path while the first customer channel is unvalidated. Build strict owner setup, truthful readiness, unique server-owned routing, reviewed return-address capture and normal-application capability guards. Do not introduce provider API calls, test sends, remote verification checkboxes or new channel providers in this slice.

The conflict with existing behavior is concrete: API-key presence currently means ready, a GET provisions routing, owners can write colliding webhook tokens, live-looking adapters lack a complete provider workflow, and reviewed email omits Reply-To. The smallest accepted change preserves adapter interfaces and old execution/receipt history, adds typed setup authority and guards new authorization. This extends ADR-003/004/007/013, retaining the modular monolith and database/source-of-truth rules.

Configuration validity is separate from verified provider operation. Normal application SendGrid drafts may be reviewed when supported setup is complete, but new live dispatch remains held with CHANNEL_VERIFICATION_REQUIRED until the subsequent explicit provider-evidence contract exists. Unsupported non-Sandbox live channels/providers remain held. Sandbox stays usable. There is no setting or owner attestation that can unlock live verification in this slice.

## Owner configuration and persistence

Keep current email configuration and credentials in organization_settings; no duplicate credential store. Add append-only email_connection_revisions and globally unique email_webhook_routes through migration0017. Public history contains field summaries/secret-presence, never API keys, raw secret digests or provider payloads. Existing settings and routes are not automatically certified or deleted.

Email writes accept only provider:sandbox|sendgrid, from_email, reply_to, api_key and the separate SendGrid event/inbound public keys. API mask means KEEP; empty means explicit CLEAR; other string means REPLACE. Require valid bounded mailbox values and supported EC P-256 keys when provided. Empty configuration can be saved as incomplete. No webhook_token, connection_revision, capability, ready or verification flags can be owner-authored.

Every SAVE/PROVISION_ROUTE/ROTATE_ROUTE requires authenticated current owner, expected_revision, current review_token, request_key and reason. The workspace unit of work commits configuration, monotonic reserved connection_revision, public revision and audit together. Expected revision plus token detects direct legacy configuration drift; edit-back cannot revive old approval because the stored connection_revision advances. Same key/intent returns the original accepted change after later saves; changed intent conflicts. Maximum100 changes, history default20/max50, reason1..2000, request key1..200. Reads are bounded and fail closed on oversized/corrupt configuration.

GET derives current masked settings, management/drift state, structural prerequisites, explicit unverified provider status, routing URLs from validated PUBLIC_APP_ORIGIN, and revision history. It neither writes nor contacts a provider. Signed historical receipts do not acquire a fabricated current configuration binding; remote credential/sender/domain, delivery, failure, inbound and suppression checks remain UNVERIFIED. Existing dispatch controls remain a separate authority.

Generic normal-app email settings writes must use the new revisioned endpoint. Other normal-app channel settings may only retain/configure Sandbox. All readonly/server-owned fields reject. The old channel-test endpoint becomes a truthful local capability assessment, never ready from a key. Mask bot_token as well as existing credentials.

## Routing compatibility

Only explicit provision/rotate commands generate unpredictable globally unique routing tokens, checked against both new route history and legacy tokens. Each workspace has at most10 generated aliases. The latest route is advertised; prior aliases remain resolvable and still require valid provider signatures. Rotation changes the advertised URL; it is not signing-key revocation. Do not discard truthful late delivery/opt-out callbacks.

Resolve a token only when all matching new/legacy records identify exactly one workspace. Ambiguous, oversized or unknown tokens reject before receipt storage or policy effects. Preserve legacy unique routes for authenticated callbacks; GET does not adopt them as managed/current setup. An explicit provision creates the managed route. Store the advertised token through the existing private sender-config authority so route changes invalidate reviewed dispatch.

Canonical public URLs come from server configuration, never request Host/Forwarded headers or browser origin. Existing raw-byte signature validation and durable receipt/callback processing remain authoritative. Signed transport does not prove original email-sender identity, consent or correct enquiry correlation.

## Prepared message and runtime guard

Capture configured reply_to in the immutable reviewed sender envelope. It must be a validated mailbox, is shown in exact review, and reaches the provider adapter unchanged. Altering reply address, credentials, keys, routing or connection revision invalidates the old config/content binding. A fixed monitored return mailbox does not establish enquiry/thread correlation: ambiguous shared contacts remain held under existing behavior; precise return routes/thread assignment remain L4-01 follow-up/L4-03 work.

Add finite capability assessment and runtime registration keyed to the originating database so transactional service instances share the same policy. Normal runtime defaults strict, including unregistered databases. Legacy adapter contract tests may explicitly use config.env=test and testControlsEnabled=true, excluding the isolated E2E harness. Development controls, NODE_ENV alone and production/staging cannot enable this compatibility profile. Keep low-level adapter and retry/idempotency assertions intact; this test scope is not product verification or live readiness.

Guard new prepared review/approval and dispatch; rejected dispatch produces a typed hold before any new attempt/provider call. Do not block truthful late callbacks, pending receipt policy, recovery, analysis or human tasks because channel configuration changed. Do not bump historical review policy merely to invalidate all stored outputs; normal config/revision changes provide exact invalidation.

## Public contracts

Owner GET /api/settings/channels/email/connection is read-only. PUT saves the full editable values with expected_revision/review_token/request_key/reason. POST /api/settings/channels/email/connection/provision and /rotate are explicit route commands with the same review fields. GET /history pages immutable changes; GET /requests/:request_key recovers {change:null|original_summary}. Mutations return {change:original_summary,replayed}.

Connection service methods: get, save, provisionRoute, rotateRoute, history, byRequestKey and internal resolveWebhookToken. Every owner method takes organization_id and actor. Backend owner publishes exact bounded GET/summary shapes to UI/root before dependent implementation; these shapes must preserve the authority and limits above. No live-send/probe endpoint is added.

## Parallel ownership

- Root: shared API/factory/config wiring, migration0017 and registry, secret masking, compatibility route policy, package/scripts, shared Markdown and integrated HTTP/migration verification.
- Backend: new emailConnectionContract/Repository/Service modules, bounded unique routing resolver, focused service tests and feedback to root on schema compatibility. Existing SettingsRepository reverse lookup may be narrowed to refuse ambiguous ownership; no other shared wiring edits.
- Review: new channelCapability module, preparedActionService, narrow actionExecutor capability holds, exact-return-address/normal-runtime/legacy-adapter regressions and evidence. No shared API/config/registry edits.
- UI: channel-readiness types/hooks, channel-setup component, narrow Settings/approval return-address display, isolated browser verifier/fixture and evidence. Root owns package launcher wiring.

## Automated and human acceptance

Test read-only loading, strict keys/secret KEEP/REPLACE/CLEAR, malformed values, safe history, stale revision/drift/edit-back, exact lost-response replay, atomic audit rollback, tenant/owner boundaries, global token uniqueness/ambiguity and old authenticated aliases. Verify populated migration/rollback and explicit PostgreSQL skips. Normal-runtime capability tests must prove unsupported/unverified live work creates zero attempts and preserves existing state; adapter transport/idempotency tests remain meaningful.

Browser verification covers setup, incomplete/unverified/sandbox distinctions, canonical URLs, explicit provisioning/rotation, secret handling, stale/lost-response recovery, disabled unsupported choices and zero unsolicited domain/provider writes. Full safe tests, TypeScript/build, affected React regressions, smoke, existing synthetic evaluation and updated local references remain required.

L4-01 stays [~]. Customer channel decision, controlled mailbox/domain/key/security-policy setup, real authorized send/delivery/failure/reply/stop, exact enquiry correlation, signing-key rotation, PostgreSQL concurrency/restore and operator/mobile acceptance remain open. Parsed inbound mode is required; raw MIME and attachments are unsupported. A stored key or successful local check is not that evidence.

## Provider references checked

Current official documentation describes separate Parse security-policy attachment and raw-payload ECDSA verification: [Inbound Parse security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks). Event signing setup is separate: [Event Webhook security](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features). These are provider documentation checks, not live account verification.

Routing integration clarification: first explicit provision preserves one uniquely owned valid legacy token as a LEGACY alias and creates the new GENERATED route atomically. The bound is10 generated aliases plus at most1 legacy alias. Ambiguous legacy ownership refuses the command without overwriting settings: removing one owner could otherwise make the old shared token appear to belong to another workspace. Such history needs inspected operational remediation. Alias kind is persisted; both aliases may reference the same provisioning revision.

Implementation compatibility clarification: Sandbox email also captures an explicitly configured Reply-To. Existing email envelopes that omitted that configured address are selectively invalidated at review reuse and dispatch binding; neutral absent-address envelopes retain their prior authority. There is no global prepared-policy version bump.
