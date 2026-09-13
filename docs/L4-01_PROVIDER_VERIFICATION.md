# L4-01 provider verification contract

Recorded 2026-09-13 before implementation under [COMPLETION_PLAN](COMPLETION_PLAN.md). This implements verification machinery; real provider/account/mailbox acceptance remains unverified until actual evidence exists.

## Authority and ownership

Root owns migration0022, registry, configuration, HTTP wiring, ingress hooks and UI. The channel owner implements emailVerificationContract/Repository/Service, sendgridVerificationAdapter, narrow channelCapability/preparedActionService changes, focused tests and verification evidence. Existing workspace transactions, approval revisions, dispatch controls, retry uncertainty and durable signed webhook processing retain authority. No live API calls or messages are authorized by implementing or testing this contract.

Two deployment-controlled exact recipients are required: EMAIL_VERIFICATION_DELIVERY_MAILBOX and EMAIL_VERIFICATION_FAILURE_MAILBOX. They must be distinct and independently confirmed by the deployment operator as authorized controlled mailboxes/sinks. Owners cannot nominate arbitrary addresses. A signed inbound From does not prove mailbox control. Absence of either keeps probes unavailable. The global SendGrid API is the only supported endpoint in this slice; unsupported regions stay explicitly unavailable.

## Persisted protocol

A run binds managed connection revision, private configuration fingerprint, public origin/runtime recipient fingerprint, exact recipients/Reply-To, nonce, authenticated actor, reason and original request identity. At most100 runs per workspace; unique workspace/configuration/runtime prevents fresh runs from wrapping uncertain probe attempts. Create is DB-only. GET never makes provider calls.

An explicit check first persists RUNNING, then performs at most5 GET requests to fixed api.sendgrid.com with no redirects,15-second and64KiB per-response bounds: credential scopes, exact authenticated sender domain, enabled signed event webhook destination/public key and required events, exact parsed-field Reply-To inbound settings and attached signing policy/key. No provider writes. Finalize against the captured current configuration under the workspace gate. Failed/unknown checks preserve the hold; a transactionally assigned unique check_number1..100 defines the latest check and controls validity, including a newer failure after a prior pass. A120-second lease permits explicit read-only retry after interruption, at most100 checks per run. Never repeat network work on the same accepted key. Successful checks last24hours; durable workspace technical high-water prevents clock rollback from resurrecting expired evidence.

Each run may create one DELIVERY and one FAILURE probe. Each is a dedicated database-owned lead and fixed-message REQUIRED-approval action linked by immutable run/probe records. The deployment failure sink must actually yield a signed processed rejection; ordinary delivery cannot prove failure handling. No intelligence job, sequence or customer-result event is created. Generic inbound analysis must exclude only persisted probe ownership, never a user-supplied source label. The delivery mailbox must reply and then stop using the exact shown nonce. Stop restrictions persist normally.

Only this persisted fixed action, recipient, sender and exact envelope content hash receives a narrow dispatch-verification exception. All contact, current context/review, quotas, due times, operational fences and uncertainty rules still apply. Initial revision is historical; a fresh normal review of identical fixed content on the same action may satisfy updated context. Edited/copied content, another recipient, another action, stale configuration and an unresolved prior probe to that mailbox cannot bypass the hold. No retry clones or replacement actions.

## Signed evidence

recordEmailVerificationReceipt(tx,{receipt,configuration,route_token,input}) is invoked only for a newly inserted original SIGNED_PROVIDER SendGrid receipt inside its durable insertion transaction. The server closure supplies the same captured configuration and route token used for signature verification. No client field can select the callback/configuration. Deduplicated/conflicting/unsigned/internal receipts cannot acquire fresh proof. Store exact config/key/route/payload fingerprints and bounded proof linked to the scoped probe. At most20 matching proofs per run and5 per kind; extra evidence must not prevent mandatory webhook processing.

Capability requires a current successful remote check and processed exact DELIVERY, FAILURE, REPLY and STOP proofs. Proof must match actual execution, actual reviewed revision/hash, recipient and fixed probe envelope; receipt state must be PROCESSED and mandatory policy DONE, including persisted stop restriction. Historical evidence remains true after expiration/config edits but cannot unlock a different configuration. Configuration validation alone and owner checkboxes never unlock normal sends. Receipt replay uses durable proof, not a transient post-response callback.

## Service and API

EmailVerificationService(db,{publicOrigin,controlledRecipients:{delivery,failure},adapter,now}) implements get/create/byRequestKey/check/createProbe. GET/POST /api/channels/email/verification; GET /api/channels/email/verification/requests/:key; POST /api/channels/email/verification/:id/check and /probes. Scope and actor come only from the session. Create requires expected_connection_revision,review_token,request_key,reason. Check requires verification_id,request_key. Probe adds purpose DELIVERY|FAILURE; recipient/body/verified overrides are rejected. Public responses expose bounded summaries and configured holds, never API keys/raw provider responses.

Four tables: email_verification_runs, email_verification_checks, email_verification_probes, email_verification_receipts. Scoped composite FKs, original-key uniqueness, integer revision checks, UTF8 JSON byte limits and explicit bounds are required. External network calls occur outside DB transactions. Original request replay and lookup remain available after lost responses.

## Verification and external acceptance

Use injected provider adapters and synthetic signed receipts locally. Cover provider permission/config mismatches, body/timeout/redirect bounds, competing checks, clock rollback, stale configuration, forged/copied probe content, concurrent/uncertain dispatch, exact signed-receipt capture and mandatory stop/replay, rollback, scope and secret redaction. Real credentials, two authorized sinks, DNS/settings, signed delivery/failure/reply/stop, PostgreSQL concurrency and deployment operation remain explicit acceptance gates.

## Developer UI location - 2026-09-13

Technical channel setup and controlled provider verification moved from customer Settings to /developer-tools?tab=email. It is available only when ENABLE_DEVELOPER_TOOLS=true on an explicit development/test runtime and the current session is a workspace OWNER. Customer Settings now show connection availability only. The existing API verification contracts and independent deployed-provider acceptance procedure remain unchanged. This local screen is not a hosted platform-admin console. See ADR-024 and [current UI evidence](verification/CUSTOMER_SETTINGS.md).
