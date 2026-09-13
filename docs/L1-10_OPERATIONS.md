# L1-10 operational controls implementation contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Status: recorded before implementation; bounded local implementation and automated verification are now recorded in [integrated evidence](verification/L1-10.md). External/human acceptance remains open. This implements the bounded L1-10 foundation within the existing modular monolith and database authority. It does not deploy, contact real recipients, migrate customer databases or certify a pilot.

## Current task and evidence

L1-06 local scheduling/recovery is verified; L1 remains open. This slice is L1-10 (dependencies L1-02 authorization and L1-03 persistence, preserving L1-01 test isolation). Inspection found certificate verification disabled in the PostgreSQL adapter; deployed plaintext and URL overrides accepted; unknown NODE_ENV selecting development; unbounded ordinary JSON ingestion; no auth admission/Origin control; raw exceptions/webhook-token paths in routine logs; and no application-wide or durable workspace sending pause/attempt cap.

Existing behavior to preserve: shared workspace/action gate, immutable reviewed envelopes, contact restrictions, bounded execution/event/receipt retries, exact callback outcomes, graceful drain, signed/bounded SendGrid ingress, safe database failure descriptions and isolated test targets. Architecture and product direction do not change. No Redis, microservice, new provider, browser database access or MongoDB migration is introduced.

## PostgreSQL and configuration

Use one pure validated connection-policy builder at configuration and database opening boundaries. Reject malformed PostgreSQL URLs, missing explicit host/database/user under the supported credential mode, invalid ports, fragments and URL query overrides before importing/connecting the driver. Do not let pg inherit unvalidated PG* values or overwrite explicit TLS/timeout settings from URL options.

TLS enabled means certificate and hostname verification, minimum TLS1.2 and the default trust store or a bounded explicitly configured PEM CA (DATABASE_SSL_CA). Never set rejectUnauthorized:false. Deployed runtime configuration also refuses NODE_TLS_REJECT_UNAUTHORIZED=0 so HTTPS providers cannot inherit disabled TLS verification. Explicit plaintext is allowed only in development/test; staging/production refuse it. Migration TLS/CA/connection limits use separately selected MIGRATION_DATABASE_* settings and retain mandatory separate deployed migration credentials.

Strictly reject unknown NODE_ENV, malformed explicit booleans and invalid/out-of-range numeric limits rather than falling back to development/defaults. Port1..65535; connection pool1..100; acquisition1..30000ms; runtime statement/query/idle-transaction defaults15s/20s/15s with maxima30s/60s/60s; migration defaults120s/130s with maxima300s/330s and idle-transaction maximum60s. Query timeout must exceed statement timeout. Environment selectors are DATABASE_STATEMENT_TIMEOUT_MS, DATABASE_QUERY_TIMEOUT_MS and DATABASE_IDLE_TRANSACTION_TIMEOUT_MS, with MIGRATION_ equivalents. Record these exact bounds in env/deployment docs. SQL timeout is not a promise that a provider request or transaction was safely cancelled: preserve rollback/discard behavior and never replay transaction callbacks.

Preserve loadConfig/validateConfig; validateConfig(config,{scope:'database'}) supports database-only CLI jobs without unrelated HTTP requirements. Runtime validation also requires a canonical HTTPS PUBLIC_APP_ORIGIN and AUTH_RATE_LIMIT_SECRET of at least32bytes in deployed environments. Local origin defaults to http://localhost:PORT, with an explicit override for the development frontend. Local auth secret is a fixed clearly non-production value so disposable/local restart tests retain budget keys.

The test harness must replace URL search_path/options with a typed validated run-owned schema/read-only path. Preserve dedicated TEST_DATABASE_URL + TEST_DATABASE_DISPOSABLE checks and cleanup ownership. A plaintext CI database cannot masquerade as a deployed TLS proof. Deployment verification must validate the same configuration it opens. Tests use synthetic loopback TLS certificates and disposable databases only.

## HTTP and authentication admission

Fixed initial HTTP bounds: headers16KiB, header deadline10s, request timeout30s, body read deadline10s, keep-alive5s, at most64 admitted requests per process. Cheap GET liveness probes bypass admission without database access; readiness and application work remain bounded. Admission is retained until both handler work and the response finish/close; a disconnected client cannot free a slot while asynchronous work continues. Shutdown stops new work and waits for disconnected handlers before closing the database. Static routes accept GET/HEAD only and reject other methods with405/connection close; the developer worker endpoint consumes bounded raw input before effects. Protect streamed byte accounting, actual body completion/abort and resource cleanup; Content-Length alone is not authority. Auth bodies16KiB, ordinary JSON1MiB and explicit CSV routes5MiB. Preserve SendGrid event1MiB/Parse5MiB and batch1000 bounds, signatures over original bytes and durable receipt semantics.

JSON routes require an appropriate JSON media type, supported identity encoding and top-level object; reject oversized, malformed, incomplete or stalled input with safe errors before domain writes. A rejected request must not leave readers/timers/listeners or an unbounded background drain. Never read provider/webhook bodies through a weaker path.

Check browser mutations/login/register against the configured canonical PUBLIC_APP_ORIGIN. Include the existing state-changing GET approval/webhook-token reads; they do not gain a safe-method exemption. Replacing those legacy read/write contracts remains later work. Reject mismatched/null Origin and cross-site fetch metadata; never derive the trusted origin from Host or forwarded headers. Non-browser requests without Origin retain their authenticated API path. Keep cookies HttpOnly/SameSite and require Secure in staging/production. This is a browser-origin defense, not a replacement for authentication, a verified reverse-proxy perimeter or account recovery.

Rate identities use the actual socket peer only; TRUST_PROXY does not authorize forwarded IP headers for throttling. Proxy/NAT clients share this coarse peer budget until a tested edge policy exists.

AuthAdmissionService.run({operation:LOGIN|REGISTER,peerAddress,email},work) obtains a nonqueued process-local slot (max2), atomically admits durable budgets, then calls work outside every admission transaction and releases in finally. Busy returns503 AUTH_BUSY with Retry-After1; exhausted returns429 AUTH_RATE_LIMITED with remaining exhausted-window retry time; storage/capacity failure returns503 AUTH_ADMISSION_UNAVAILABLE. Success does not reset budgets; rejected attempts do not extend windows.

| Operation | Global per database | Socket peer | Normalized account |
| --- | --- | --- | --- |
| LOGIN | 200/minute | 30/5minutes | 10/15minutes |
| REGISTER | 20/hour | 10/hour | 3/hour |

Add immutable0008_operational_controls with auth admission schema: singleton auth_admission_state(id='default',updated_at) and auth_rate_buckets(operation,bucket_kind,identity_hash,window_started_at,reset_at,attempts), constrained operation/kind, nonnegative attempts, composite primary key and reset index. GLOBAL uses fixed64-zero identity independent of the secret; PEER/ACCOUNT use typed HMAC-SHA256, never raw email/IP. The singleton serializes short admissions (FOR UPDATE on PostgreSQL). Inspect/update all three budgets atomically, reset only expired windows, retain future windows across backward clocks, remove at most100 expired non-global rows per admission and cap total rows at10000. Do not evict live buckets to accept new identities. Secret rotation changes account/peer identities but does not reset global admission. The same0008 migration adds the typed workspace sending controls described below; the auth owner owns that single migration file and registry.

Bound auth field/password inputs before hashing. Unknown-user login performs a dummy password verification to remove the obvious skipped-KDF distinction; do not claim timing-proof authentication. Hash before the short registration transaction; organization/user/session/audit commit together, and duplicate races cannot leave orphan organizations. Invalid session-expiry timestamps fail closed. Full account recovery/email verification, distributed network protection and customer access lifecycle remain later gates.

## Sending pause and attempt controls

All SEND paths already converge on ActionExecutor. Check operations under its existing workspace gate immediately before authorizing an attempt, preserving higher-priority contact/workflow/review rules. Holds must not consume attempts, invalidate reviewed content or mutate terminal history. Human task actions and receipt/intelligence/recovery processing remain available.

Global OUTBOUND_DISPATCH_ENABLED defaults true only in development/test and false in staging/production unless explicitly enabled. It applies to HTTP/manual/bulk/worker SEND authorization. A workspace owner cannot override it. Changing process configuration requires controlled restart across instances; this is not an instantaneous recall of an already-authorized request.

Store one typed workspace_dispatch_controls row in the additive0008 migration: organization_id primary/foreign key, revision>=1, paused0/1, daily_attempt_limit1..1000, unresolved_limit1..10, reason1..2000, updated_at and updated_by (user foreign key). Missing row presents schema_version1, revision0, unpaused, daily_attempt_limit100 and unresolved_limit2. Malformed present state fails closed. This refines the initial settings-JSON proposal before implementation: scheduler predicates can use typed constrained fields without a new PostgreSQL16 minimum or a second synchronization projection. No earlier architectural decision or migration is changed. Owners may set daily attempt limit1..1000 and unresolved slots1..10; these are provisional pilot ceilings, not measured capacity or monetary cost limits.

Daily usage counts every persisted SEND authorization, including retry and sandbox attempts, by UTC day. Unresolved slots count DISPATCHING even after lease expiry and UNCERTAIN until exact callback/evidence resolution. ACCEPTED or terminal facts release slots without rewriting history. Admission and execution persistence share the executor's captured authorized_at for UTC-day selection; no second clock read can cross midnight and check a different quota day. Admission and creation of the execution share the same workspace transaction; separate API/worker callers cannot spend the last slot twice. No separate quota ledger or reset job is needed.

DispatchControlsService.inspect/update/inspectInTransaction returns safe controls, global enablement, UTC usage, remaining capacity, hold reason and next eligible time. Owner GET/PUT /api/dispatch-controls derives workspace/actor from session; PUT carries expected_revision, paused, daily_attempt_limit, unresolved_limit and reason, records one audit and rejects stale updates. Generic settings mutation cannot edit this dedicated table. Settings UI explains pause, daily attempts, unresolved work and current global hold; permission/stale/error states remain visible.

Scheduler/action-only candidate admission excludes known operational holds without preventing receipts, lead processing, callbacks, expiry or owner recovery. A malformed controls row must not break another workspace's scheduler. Domain dispatch remains authoritative even if a candidate races a control update. Existing review/retry/deadline budgets never replenish when a control is resumed or a new UTC day begins.

## Provider transport bounds

Keep the existing15s request deadline and fixed provider hosts/no redirects. Read at most64KiB of successful JSON under the original deadline, with byte accounting and cancellation. Error/non-JSON bodies are cancelled without parsing. Header-only SendGrid acceptance needs no body parsing. HTTP2xx remains known acceptance if a success body is malformed/oversized/stalled: retain a null reference and fixed response issue, never claim safe retry or delivery because reference parsing failed.

Provider references must be bounded nonempty strings (max512, no CR/LF); routine logs never include raw bodies or credentials. Synthetic adapter doubles must represent real bounded Response/ReadableStream behavior instead of an unbounded json() fallback.

## Logs, errors and resource safety

Routine JSON/text logs and child bindings redact sensitive keys recursively with depth/size bounds. Error objects expose a safe category/code, never message/stack/cause/body; HTTP failure logs use fixed status/code/request correlation and no raw exception text. Drop unknown-status exception details from public responses. Redact webhook routing tokens and dynamic path data from HTTP completion logs; parsing a malformed request URL must not throw again in finally. Preserve safe IDs/counts/duration/error categories and known database startup/pool sanitization.

Unexpected/aborted/already-ended responses cannot trigger double writes. Sensitive key matching includes camelCase and separated names; URL sanitization accepts strings without coercing objects. Log serialization must handle cycles/getters/bigints safely without changing reserved event/time/level through supplied fields. Redaction is part of the boundary, not permission to log secrets under arbitrary names.

## Ownership

- Root: this contract, shared app/server/http error/logger integration, independent review, integrated tests and primary docs/evidence.
- Database owner (migration_runner): config.js, connection policy, PG/facade option forwarding, database CLI validation, typed disposable schema helper, database/TLS regression tests and focused evidence.
- Auth/HTTP owner (landing_plan): new0008/registry, admission/body/request-policy helpers, auth service/repository/password boundaries and behavioral tests. Root owns src/api/app.js and src/shared/http.js wiring; request helper lives separately.
- Outbound owner (transaction_clients): controls service, ActionExecutor integration, candidate predicate, provider helper/adapters, Settings UI and focused tests. Root integrates routes/services/shared scheduler wiring.

Coordinate shared edits explicitly. Add no dependency solely for these controls. Update architecture/domain/decisions/testing/deployment/product/task/README records with actual behavior and evidence.

## Acceptance and demonstration

Required automated: hostile config and URL/PG* overrides refused before connection; trusted/untrusted/hostname-mismatched TLS; timeout option propagation and transaction failures; real streamed/chunked/slow/oversized input with cleanup; same/foreign/null Origin; durable concurrent/restarted/expired/backward-clock auth budgets, spoofed forwarded headers and no-hash when blocked; registration/audit rollback and malformed session expiry; every dispatch entry point paused/limited with no attempts; exact concurrent last-slot/day-boundary/recovery behavior; immutable approval across pause/resume; bounded provider streams preserving known acceptance; secret/error/path redaction; schema preservation; existing full suite, isolated HTTP workflow/smoke and React typecheck/build.

Human/external: staging verified database TLS and least-privilege roles; configured public origin/proxy/cookies; credential rotation; two-session pause/resume and stale controls; limit exhaustion and evidence recovery; browser keyboard/mobile/accessibility; measured load, cost and alerts; selected live provider; restore and operator drill. Local tests cannot close these gates. L1-10 remains in progress until required evidence exists.

Next after the bounded local L1 foundation: retain outstanding L1 acceptance and progress the L2 business-context/data contract that makes intelligence useful to the selected customer workflow. Founder segment/channel validation and L4/L5 landing-page scope remain explicit.
