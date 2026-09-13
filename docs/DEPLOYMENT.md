# Deployment and Operations

Product: **AI Lead Intelligence & Outbound Automation**.
Planning baseline: **2026-09-11**.

The selected database direction is managed **PostgreSQL**, with **Supabase** as
the preferred initial host and **Render** as the existing application hosting
candidate. This preserves the modular monolith and standard `pg` database
boundary. Selecting a host does not certify the application for customer use.

This is the target runbook and implementation backlog for L1-L5, with launch
decisions in L6. No cloud resources, subscriptions, provider messages, or live
configuration were changed by the L0 documentation update.

## Current state and evidence

| Component | Source-inspected state | Readiness limit |
| --- | --- | --- |
| Database | Scoped SQLite/PostgreSQL clients; serialized registry0001 through0017 with additive forward migrations; no-DDL runtime/inspection | Local upgrade/interruption regressions exist; actual PostgreSQL role, restored-release, TLS and recovery proof pending |
| Application | Node 24+ API serves React `client/dist`; environment-driven configuration | Runtime defects in [REVIEW.md](REVIEW.md) block unrestricted customer use |
| Blueprint | `render.yaml` proposes `relay-staging`, branch `mvp`, Singapore, Starter, manual deployment, in-process worker | Repository configuration, not proof that those resources exist or remain configured that way |
| Cloud accounts/services | Earlier notes state provisioning was outstanding | Current account, staging, production, region, backup and billing state were not remotely inspected |
| Email | Revisioned owner setup, explicit unique route aliases, signed ingress and replaceable adapters | Normal SendGrid dispatch is held pending provider verification; other live providers/channels are unsupported for customer use. No real delivery/reply certification |
| Webhook processing | Durable normalized receipts, bounded replay/cursors, pending-policy dispatch gate, owner review and payload cleanup | Real signed redelivery, PostgreSQL concurrency/restore and browser recovery acceptance remain pending |
| Operations | Strict verified-TLS/config policy, bounded HTTP/auth/provider resources, safe logs, durable auth admission, global/workspace send controls, fair scheduling/recovery and shutdown drain | Actual deployment/restore/provider/operator proof, measured load and full monetary/support controls remain pending |

`Relay` identifiers in existing service names, schema prefixes, scripts and the
session cookie are implementation identifiers. The product identity remains
**AI Lead Intelligence & Outbound Automation**.

Historical test counts and deployment rehearsals live in
[history/MILESTONES.md](history/MILESTONES.md). Current acceptance is governed by
[TASKS.md](TASKS.md), [ROADMAP.md](ROADMAP.md) and [TESTING.md](TESTING.md).

## L1-04/L1-08 rollout constraints

Apply immutable migrations 0003_contact_restrictions and 0004_prepared_action_revisions through the separate migration job after backup/restore rehearsal. 0003 preserves known legacy opt-out/suppression and conservatively marks ambiguous historical bounce as DELIVERY_REVIEW; old missing-recipient events cannot reconstruct the original address. 0004 never fabricates reviewed content for legacy approvals. Review blocked/pending legacy work before any sends; do not reset restrictions to restore queue throughput.

Every supported external SEND requires an exact reviewed revision; the normal manual placeholder SEND route remains disabled. L1-05 now adds bounded due-time/retry, lease expiry and owner recovery as described next. Ambiguous transport/5xx remains held as UNCERTAIN, with no automatic resend. L1-06 now supplies the normal due scheduling and managed lead-event recovery described below; L1-07 supplies independent receipt/effects recovery.

For SendGrid, configure channel_email.sendgrid_events_public_key and channel_email.sendgrid_inbound_public_key for the respective event/parse signing settings. The Email settings screen accepts their public keys. The URL token only identifies the workspace. Outside explicit isolated/local test controls, missing verification configuration returns 503 and invalid signatures return 401. Key presence does not prove a working provider connection.

The verifier uses exact timestamp plus raw body bytes and bounded bodies; it does not invent an expiry window that could discard delayed valid retries. Event identity handles supported compatible replay. Verify the selected provider's signing, retry and live replay behavior before L4 release. L1-07 now supplies the recoverable receipt inbox; live provider acceptance remains required.

The workspace gate serializes brief safety decisions; provider calls occur after commit. Cancellation currently scans one workspace's leads. Measure with representative volume and actual PostgreSQL locks before choosing capacity; this is not a demonstrated production scale limit.

See [integrated evidence](verification/L1-04-L1-08.md) for local proof and pending operations/human gates.

## L1-05 rollout and recovery operations

The [accepted execution contract](L1-05_EXECUTION_RECOVERY.md) and [local evidence](verification/L1-05.md) describe current code. PostgreSQL multi-process/restore, actual provider behavior and human/browser acceptance remain pending; this slice does not authorize customer traffic or enable the blueprint worker.

Apply 0005_bounded_dispatch_recovery through the separate migration job. It adds action retry/active-execution/fence fields, attempt revision/hash/provider-key/lease/outcome fields and append-only dispatch_resolutions. Existing attempts retain history as LEGACY_UNKNOWN; ambiguous executable/in-flight/retry work gains an independent legacy review hold. Invalid/duplicate historical attempt numbers refuse migration. Do not renumber/delete attempts, fabricate approvals or clear holds through SQL to resume a queue.

Current implementation defaults (code policy, not new environment variables):

| Control | Current behavior |
| --- | --- |
| Retry budget | Three total attempts and one hour elapsed from first authorization, frozen across reviews/restarts |
| Due gates | scheduled_at and next_attempt_at enforced by dispatch; invalid instants fail closed |
| Backoff | 30-second exponential base, capped at five minutes with half-to-full jitter; respect a longer valid Retry-After |
| Deadline conflict | A retry hint beyond the deadline exhausts the action instead of shortening the provider wait |
| Dispatch lease | 60 seconds; authorization is treated as potentially sent, so expiry never permits blind reclaim/resend |
| Provider request | 15-second transport bound; ambiguous timeout/5xx/transport loss becomes UNCERTAIN |
| Resend key | Stable action/revision key and identical request body; conservative persisted 23-hour first-use expiry |
| Shutdown | Stop new dispatch and drain HTTP/worker/executor before DB close, with a 30-second deadline |

The worker's bounded expiry sweep changes expired DISPATCHING to UNCERTAIN without a provider call. Current owner/fence and active execution guard worker outcome commits. ACCEPTED is not delivery, and known acceptance cannot be selected for another attempt.

An authenticated owner can inspect GET /api/actions/:id/recovery or GET /api/outbound/recovery and use the recovery UI/POST /api/actions/:id/recovery/resolve. A decision must name the current execution/fence and evidence note. ACCEPTED also requires a provider reference; CLOSE_WITHOUT_RETRY keeps work closed. Neither permits resend, resets budgets or grants a new review. Preserve unknown old actions without a correlatable attempt for inspected remediation.

SendGrid terminal callbacks must echo relay_execution_id and relay_revision_id and match the recorded provider/action/workspace. Event IDs have a 2,048-character application bound; long restriction source identities are hashed while older short identities retain their format. The HTTP acceptance reference differs from sg_message_id. Exact callbacks can resolve uncertainty and recover a missing conversation entry from its immutable reviewed revision. Current ownership/fence protects newer messages/follow-ups and closed outcomes.

L1-05 made core callback receipt/state/audit/event effects atomic; its earlier evidence records the then-open ancillary gap. L1-07 now stores a PENDING effects cursor and repairs message/follow-up work from the immutable receipt without repeating core delivery. A valid recipient restriction still commits before same-workspace terminal correlation errors.

Before enabling real dispatch, demonstrate deployment during an active request, drain completion and timeout, lease expiry without another send, exact signed delayed callbacks, and both owner recovery decisions using authorized synthetic/test-provider data.

## L1-07 receipt replay rollout and operations

The [accepted webhook replay contract](L1-07_WEBHOOK_REPLAY.md) and [integration evidence](verification/L1-07.md) describe the implemented local slice. They do not certify a live provider, PostgreSQL deployment or human acceptance.

Apply immutable 0006_durable_webhook_receipts through the separate migration job. It adds webhook_receipts, append-only webhook_receipt_reviews and nullable callback/inbound links with effects cursors. Existing rows retain LEGACY_UNKNOWN and historical content/status; encountering an unlinked old projection quarantines it for review. Do not synthesize old receipts, change old migration checksums, reset processing markers or invent missing human-task copy to unblock work.

Current receipt-processing defaults are separate from outbound retry policy:

| Control | Implemented behavior |
|---|---|
| States | RECEIVED, PROCESSING, RETRY_PENDING, PROCESSED, QUARANTINED, DISMISSED |
| Processing budget | Five total attempts and 24 hours from first claim; owner review cannot reset either |
| Processing claim | 60-second lease with owner/fence checks on local effects and success/failure persistence |
| Backoff | Five-second exponential base, capped at 300 seconds with half-to-full jitter |
| Payload | Up to 256 KiB normalized JSON; no raw MIME, tokens, signatures or full unknown provider objects |
| Retention | Bounded purge 30 days after processing/closure for PROCESSED/DISMISSED bodies; preserve deduplication tombstones/reviews and unresolved payloads |

Verify provider authentication and tenant resolution before receipt. Current SendGrid ingress limits remain 1 MiB per event batch, 5 MiB per Parse request and 1,000 event entries. Store normalized accepted items or rejected-item evidence before 2xx; storage failure returns 503 for provider redelivery. A successful acknowledgement means durable receipt, even when processing is waiting or quarantined. It does not mean the message was delivered or lead/intelligence work finished.

mandatory_policy_status=PENDING holds all new dispatch in that workspace under the shared transaction gate. The hold creates no attempt, consumes no dispatch budget and does not revoke approval or permanently block the action. Existing restrictions still apply. Treat rising pending-policy age as an operational fault: inspect the receipt and its failed policy processing, preserve applicable suppression, and repair the underlying cause. Never set DONE or delete a receipt merely to resume sends. A quarantined receipt can keep the entire workspace held indefinitely while policy remains unresolved. Ordinary RETRY/CLOSE cannot repair invalid/foreign identity or waive restrictions; an inspected operator remediation procedure must be validated before customer use. Do not treat the recovery UI as complete remediation for every quarantine.

Changed-content conflicts retain the original receipt and separate conflict evidence. Only a claimed bounded mandatory-policy handler can run for conflicting input; it may preserve a valid opt-out/complaint but cannot create a lead, delivery transition, message, task or event projection. Same-workspace conflicting action references do not discard unambiguous recipient suppression; known foreign references fail before effects. Policy failure remains visible and holds dispatch until resolved.

The normal worker processes due/expired receipt claims and bounded payload cleanup. Inline ingress can attempt processing once; worker-disabled hosting is not a dependable backlog recovery strategy. Verify WORKER_ENABLED and actual worker heartbeat only in the controlled rollout after acceptance; this documentation does not enable the blueprint worker. Shutdown stops new receipt processing and drains active handlers alongside HTTP/worker/executor work before DB close within the existing 30-second deadline. Expired receipt work is recoverable local processing; expired outbound dispatch remains uncertain and cannot be blindly resent.

Owner receipt recovery uses GET /api/webhook-receipts, GET /api/webhook-receipts/:id and POST /api/webhook-receipts/:id/review. Use the displayed expected_fence, RETRY/CLOSE and an evidence note; tenant/actor come from the session. RETRY queues unchanged input only with payload, remaining budget and no live handler. It cannot edit correlation, resend or reset counters/deadlines. CLOSE requires policy DONE and records DISMISSED; completed/dismissed work cannot reopen. Conflicting input cannot become ordinary domain processing through an owner retry.

During incident validation, check delivery facts separately from callback effects_status. PENDING means message/follow-up repair remains; DONE/SKIPPED is final local processing. Replay must preserve the exact sent revision and original completion-plus-48-hours task due time, and must suppress obsolete tasks after canonical reply/opt-out or linked workflow stop. Missing immutable human-task copy and unknown historical effects require visible quarantine, not current-payload reconstruction.

Inbound processing stages canonical identity/classification, required policy and new-lead provenance before conversation/task/event effects. The LeadReplyReceived worker first refreshes the deterministic snapshot, including opted-out/suppressed signals, then skips optional recommendation/planning for restricted leads; eligible leads continue through the remaining intelligence stages. The subsequent L1-06 rollout below adds bounded managed domain-event/AI-stage retry and normal workflow scheduling; thread assignment, composer/resolution and verified channel usability remain L4.

Before acceptance, demonstrate partial batch persistence/redelivery, crash after callback core and inbound classification, competing/expired claims, pending-policy send deferral, policy-only conflicts, owner stale/foreign/repeated decisions, retention tombstones and shutdown on isolated restored data. Real PostgreSQL multi-process/least-privilege/restore, controlled signed provider redelivery and browser/keyboard/mobile QA remain mandatory. Full tenant retention/deletion remains L5-04.

## L1-06 scheduling and lead-processing rollout

The [accepted scheduling contract](L1-06_SCHEDULING.md), [integrated evidence](verification/L1-06.md) and [workflow checks](verification/L1-06-workflows.md) describe the locally implemented continuation. No cloud resource, worker configuration, subscription or live provider was changed by this implementation. Actual PostgreSQL deployment/restore and human/customer acceptance remain required.

Apply immutable 0007_scheduler_event_recovery in the separate migration job after the earlier migrations and backup/restore rehearsal. It adds domain-event policy/owner/fence fields, domain_event_stages/reviews, scheduler_state/workspaces, workflow revision/managed/pause/anchor/hold fields and nullable typed action run/step links. Existing unfinished domain events retain their historical status/body/error/attempts with LEGACY_EVENT_REVIEW_REQUIRED. Existing unfinished workflow runs retain progress with LEGACY_SCHEDULE_REVIEW_REQUIRED. Inspect these holds before enabling due processing; do not edit old migrations, rewrite cursors, infer delivered work, fabricate typed links or reset budgets through SQL.

Current internal defaults are separate from the outbound and webhook policies above; they are not new environment variables:

| Control | Implemented behavior |
|---|---|
| Domain-event budget | Five attempts and 24 hours from first claim; retry and owner review preserve original limits |
| Domain-event lease | 120 seconds with current owner/fence and live-lease checks on stage and outcome writes |
| Domain-event delay | Five-second exponential base capped at 300 seconds, with half-to-full jitter |
| Model boundary | Typed input preparation inside the gate; generation outside transactions; guarded validation/artifact/audit/cursor commit after exact input/policy recheck |
| Workspace admission | At most four visits per tick and a ten-second soft admission budget; no new visit after shutdown/admission deadline |
| Visit ownership | Persisted owner/fence, 120-second lease, round-robin workspace cursor and rotating next phase |
| Phase caps per visit | RECEIPTS 2, EVENTS 1, WORKFLOWS 2, FOLLOW_UPS 5, DISPATCH 2, EXPIRY 2 |
| Workflow advancement | One database-only transition per selected run, preserving UTC wait/completion anchors; no provider calls |
| Human task due state | Eligible PLANNED -> DUE once with audit; invalid historical due time -> BLOCKED; no external reminder or automatic completion |

Normal Worker.runOnce invokes this scheduler. Each phase retains its own authorization, contact policy and durable claim rules. Persisted workspace/phase cursors prevent a noisy tenant or interrupted phase from repeatedly occupying the front of a global batch; this is not a demonstrated latency SLA. Verify WORKER_ENABLED and actual heartbeat in the controlled rollout, since disabled interval processing will leave due workflows, receipts, tasks and domain events waiting. Scoped local test controls remain unavailable in staging/production and do not replace the normal timer.

LeadCreated commits normalization, snapshot, eligible idempotent initial action and audits/cursors atomically. LeadReplyReceived first commits its deterministic snapshot, then repairs/reuses synthesis/recommendation/plan stages from current evidence. No network-capable model runs inside a database transaction. Input changes or lost ownership prevent stale generated output from committing; a crash after generation can repeat a bounded call. Durable restrictions across canonical duplicate contacts prevent contact planning, including after generation. Pending mandatory receipt policy defers planning for a bounded retry; it cannot be waived through event closure. Restricted leads still receive truthful intelligence. Reply plans never automatically create new outbound actions.

Use the owner Event recovery page's Lead processing view, or scoped GET /api/domain-events and GET /api/domain-events/:id, to inspect stage/status, attempts, next retry/deadline and safe reasons. POST /api/domain-events/:id/review requires expected_fence, RETRY/CLOSE and a bounded evidence_note; actor/workspace come from the authenticated session. RETRY needs managed immutable input, a supported handler and remaining original budget. CLOSE dismisses that event only; neither decision resets budget, clears contact policy, edits input, promotes legacy work or reopens completed history. Unsupported/invalid/legacy events require investigation, and hidden optional wiring failures remain visible rather than becoming processed silently.

Use the owner Workflows page to create a campaign and fixed sequence, select leads and save a start time. The page shows browser timezone and exact UTC instant; the API accepts only offset-qualified schedules. Every SEND step requires exact review regardless of a requested approval flag. Runs wait for the exact current delivered execution and COMPLETED action before advancing; provider acceptance/uncertainty and human-task creation do not satisfy completion. PAUSE/RESUME/STOP require current revision and reason. Pause retains original timing and approval; stop cancels queued linked actions but cannot recall an already authorized provider request. Every canonical reply, including QUESTION/UNKNOWN, stops existing sequences and preserves its human response task. New sequence/step stop_on_reply=false is rejected; legacy false flags remain conservative. Legacy held runs cannot be resumed automatically.

Before customer traffic, demonstrate future and overdue schedules, pause/resume without replacing review, stop during a dispatch, reply before queued authorization, restarted waits, failed lead-processing retry and exhausted/legacy owner review through the normal server. Verify keyboard/mobile/focus and clear approved/accepted/delivered labels. Measure noisy-tenant progress, DB lock/pool behavior, event backlog age, stage failures and deployment overlap on actual PostgreSQL. Shutdown stops new visits/event claims and drains admitted scheduler/event work with the existing 30-second overall deadline; leases remain durable if the host terminates first.

Owner follow-up complete/cancel commands enforce explicit current-state transitions with an atomic audit. Blocked/terminal task history cannot be rewritten as successful work; these controls do not complete a linked workflow human-task step.

Business timezone/quiet-hours rules, the complete message composer/thread/assignment/human-task completion journey, external due reminders, richer tenant/cost quotas and live provider/customer evidence remain L2/L4/L5 gates. The local slice does not close them or certify public launch.

## L1-10 operational rollout

The [operations contract](L1-10_OPERATIONS.md), [integrated evidence](verification/L1-10.md), [database checks](verification/L1-10-database.md), [auth/HTTP checks](verification/L1-10-auth-http.md) and [dispatch checks](verification/L1-10-dispatch-controls.md) describe the bounded local implementation. No cloud account, customer database, real provider or production secret was accessed. Local loopback TLS and SQLite races do not certify a hosted PostgreSQL deployment.

Apply immutable 0008_operational_controls through the separate migration job. It adds auth admission singleton/buckets and typed workspace_dispatch_controls, seeds only the auth singleton/global keys and preserves existing domain history. Missing workspace controls present revision 0, 100 attempts per UTC day and two unresolved slots. Inventory existing ambiguous execution/policy holds before traffic; do not clear them to manufacture capacity.

Set OUTBOUND_DISPATCH_ENABLED=false during setup, migration/restore and operator rehearsal. It defaults false in staging/production, applies to all SEND entry points and requires coordinated process restart to change globally. A workspace owner can use Settings -> Sending controls or GET/PUT /api/dispatch-controls to pause or set bounded limits with expected_revision and a reason. PUT derives actor/workspace from the session, rejects stale revisions and commits audit atomically. Workspace resume cannot override the global pause; already authorized requests may finish.

| Control | Implemented bound or behavior |
|---|---|
| Workspace daily sends | Default 100 SEND authorizations per UTC day; owner range 1..1000; retries and sandbox count |
| Unresolved outcomes | Default two slots; owner range 1..10; DISPATCHING and UNCERTAIN retain slots after expiry until exact outcome/evidence resolution |
| Authorization accounting | Same captured instant for UTC bucket, execution start/authorization, lease and initial retry deadline; no second quota clock at midnight |
| Budget preservation | Pause/resume, raised limits, restarts and day rollover cannot reset action attempt/deadline/review/provider-key history |
| Request admission | At most 64 admitted HTTP requests per process; capacity is retained until handler and response finish even after disconnect; cheap liveness remains available |
| Header/request time | Headers 16 KiB / 10 seconds; request timeout 30 seconds; body read deadline 10 seconds; keep-alive 5 seconds |
| Body sizes | Auth JSON 16 KiB; ordinary JSON and SendGrid event 1 MiB; explicit CSV/Parse 5 MiB; SendGrid event batch at most 1000 |
| Password work | At most two local nonqueued slots; password maximum 1024 UTF-8 bytes; hashing outside database transactions |
| Login admission | 200/minute global; 30/5 minutes per observed socket peer; 10/15 minutes per normalized account |
| Registration admission | 20/hour global; 10/hour per peer; 3/hour per normalized account |
| Admission storage | Durable fixed windows, HMAC account/peer identities, at most 100 expired cleanup candidates per admission and 10000 total buckets; no live eviction/reset |
| Provider response | Original 15-second deadline and 64 KiB streamed JSON cap; unread/error/header-only bodies cancelled |

Global auth identity survives secret rotation; account/peer keys change, so rotate the independent admission secret deliberately. Busy admission returns 503 and exhausted windows 429 with Retry-After. Forwarded IP headers are not trusted for identity: users behind a proxy or NAT share its socket-peer budget until a tested edge policy exists. The process hash/request caps complement durable admission; they are not a distributed network defense.

Known HTTP2xx provider acceptance stays accepted if JSON is absent, malformed, oversized or stalled. A null bounded reference and fixed response issue support diagnosis; never reset such work for an automatic resend. Accepted outcomes release an unresolved slot without proving delivery. Historical completed-only attempts do not consume unresolved capacity; ambiguous missing/non-completed legacy evidence may still require operator remediation.

Before enabling customer sends, use two sessions to demonstrate pause, stale-control rejection, midnight accounting, exact callback/evidence slot release and unchanged approval/retry deadlines. Verify normal receipt/intelligence/recovery work progresses while sending is held. Confirm the real public origin/proxy and Secure/HttpOnly/SameSite cookies, auth denial before hashing, request-body teardown, unsupported static-mutation 405s, secret/path/error redaction and credential/CA rotation. Include camelCase sensitive log fields and objects with accessors/custom string conversion in the diagnostics rehearsal. Browser keyboard/mobile/accessibility, actual PostgreSQL concurrency/roles/timeouts/restore and selected provider acceptance remain external gates. These provisional ceilings are not measured throughput or monetary/AI-spend limits.

## Target topology

```text
Browser
  -> HTTPS Node API + React assets
       -> Application domains
            -> Supabase PostgreSQL: authoritative business state
            -> Durable database jobs/events
                 -> Worker/scheduler in the same application codebase
                      -> Replaceable channel/AI/provider adapters
Provider webhooks
  -> Verification + durable inbox
       -> Application state + intelligence refresh

Optional file/object storage
  -> Attachments/import artifacts; database stores scoped metadata/references
```

Start with bounded capacity and one worker process after execution claims are
correct. An in-process worker can remain for the pilot if deployment overlap and
shutdown are tested. A separate worker process from the same codebase is a
deployment choice when load warrants it; it does not require microservices or
n8n-owned business state.

Dispatch now commits STARTED/EXECUTING ownership under the workspace gate before
provider I/O, covering concurrent API/worker authorization in local regressions.
L1-05 adds locally tested bounded recovery and exact reconciliation. Actual PostgreSQL deployment overlap, provider behavior and human recovery acceptance remain required. A single replica does not replace those gates.
Render documents overlapping old/new instances in its
[deployment lifecycle](https://render.com/docs/deploys).

## Environment and access boundaries

Before provisioning a customer environment:

- Establish separate local/test, staging, and production databases/projects.
  Customer pilot data belongs in a production-controlled environment with an
  explicit restricted cohort; staging uses synthetic or appropriately sanitized
  data.
- Choose application/database regions together based on customer geography,
  residency requirements, network reachability and measured latency. The
  current blueprint's Singapore setting is a candidate, not a residency decision.
- Keep the Node API as the business boundary. Do not enable browser access to
  business tables merely because Supabase supplies a Data API. Review schema
  exposure and grants; browser clients must never receive database credentials or
  privileged Supabase service credentials.
- Separate migration administration from the application's least-privilege
  runtime role. Scope provider credentials by environment and, where feasible,
  tenant/subaccount. Restrict cloud administration and enable strong account
  authentication.
- Store secrets in the host's secret configuration or a protected, gitignored
  local environment file. Never put credentials in Git, chat, example commands,
  URLs in screenshots, or routine logs. Rotate and test revocation.
- Enforce owner/operator permissions, session lifecycle and server-derived audit
  actors in the application. Managed hosting does not supply these domain rules.
- Provision selected paid capabilities only after recording a budget owner and
  current provider entitlement. No price or free-tier availability assumption in
  this plan is a purchase decision.

## PostgreSQL connections and TLS

The application already uses a persistent `pg.Pool`. It does not require a
transaction pooler simply because it is a web service.

| Process | Initial choice |
| --- | --- |
| Persistent Node API/worker with reachable IPv6 or configured direct IPv4 | Direct PostgreSQL connection |
| Persistent Node on an IPv4-only network without direct IPv4 | Supabase shared session pooler |
| Migrations, native backup/restore, database upgrade verification | Direct connection from a compatible administrative runner |
| Future serverless execution | Consider transaction pooling after compatibility tests |

Supabase recommends connection mode by runtime/network, and transaction pooling
does not preserve arbitrary session state. Copy exact endpoint/user details from
the project Connect dialog; do not derive them from a region name.
[Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Set `DATABASE_MAX_CONNECTIONS` deliberately. Budget all API instances, workers,
rollout overlap, migration tooling and administrative reserve against the selected
database connection limit. Measure pool waiting and query duration before raising
the limit. Test timeouts and reconnect behavior.

**Implemented L1-10 connection policy:** PostgreSQL certificate chain and hostname/IP verification are mandatory whenever TLS is enabled, with TLS 1.2 minimum and the system trust store or explicit DATABASE_SSL_CA. Staging/production refuse plaintext and NODE_TLS_REJECT_UNAUTHORIZED=0. Local plaintext requires explicit development/test configuration. The URL must contain explicit host/database/user/password; percent-encode credential punctuation. Query parameters, fragments, arbitrary TLS overrides and all supplied PG-prefixed environment variables are refused before connection, so remove ambient driver configuration from the host.

DATABASE_SSL_CA accepts a PEM CA bundle of at most 64 KiB and 16 valid CA certificates. Provide the actual multiline value through protected host configuration when the service trust chain requires it. Do not disable verification or add SSL/search-path URL parameters as a workaround. Runtime and migration CA/TLS choices are separately selected as documented below. Existing owned test schemas use typed test-only options instead of URL search-path overrides.

Runtime pools default to 10 connections with a 10-second acquisition timeout. The default server statement timeout is 15 seconds, client query timeout 20 seconds and idle transaction timeout 15 seconds. The client timeout must exceed the server statement timeout: client query timeout alone does not cancel an already sent statement. Pool idle eviction is fixed at 10 seconds and lock timeout at 5 seconds, apart from existing bounded transaction-local migration overrides. Transactions retain rollback/discard/no-callback-replay behavior on failures.

Local synthetic TLS tests prove trust and identity rejection at the transport boundary; they do not prove the actual PostgreSQL server, service pooler, chosen roles or server timeout enforcement. Before launch, verify the real host/CA, wrong-host/untrusted refusal, credential and certificate rotation, connection contention and statement/idle/lock cancellation. Also enforce SSL on the managed service. The existing [Supabase SSL enforcement reference](https://supabase.com/docs/guides/platform/ssl-enforcement) remains deployment guidance; no remote setting was changed.

## Configuration inventory

Existing variables are defined in `src/config.js` and `.env.example`:

| Existing variable | Operational use |
| --- | --- |
| `NODE_ENV` | Exact development/test/staging/production only; unknown modes fail; deployed modes require PostgreSQL, verified TLS, explicit HTTPS origin and independent auth secret |
| `DATABASE_URL` | Runtime database target; takes precedence over `DATABASE_FILE` |
| `MIGRATION_DATABASE_URL` | Required by db:migrate in staging/production; supply only to a separate migration job, never the web runtime |
| `MIGRATION_DATABASE_SSL`, `MIGRATION_DATABASE_SSL_CA` | Separate migration verified-TLS/CA choices; unset fields inherit selected runtime TLS/CA values |
| `MIGRATION_DATABASE_MAX_CONNECTIONS`, `MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS` | Migration pool defaults 1 (range 1..100); acquisition inherits runtime (range 1..30000 ms) |
| `MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS`, `MIGRATION_DATABASE_QUERY_TIMEOUT_MS` | Independent defaults 120000 / 130000 ms; maxima 300000 / 330000 ms; positive integers and query strictly greater than statement |
| `MIGRATION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS` | Inherits runtime when unset; range 1..60000 ms |
| `DATABASE_MAX_CONNECTIONS` | Per-process pool default 10; integer range 1..100 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Acquisition default 10000 ms; integer range 1..30000 |
| `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT_MS` | Defaults 15000 / 20000 ms; ranges 1..30000 / 1..60000; query strictly greater than statement |
| `DATABASE_IDLE_TRANSACTION_TIMEOUT_MS` | Default 15000 ms; integer range 1..60000 |
| `DATABASE_SSL`, `DATABASE_SSL_CA` | Verified TLS enabled by default; explicit disable refused when deployed; optional bounded PEM CA bundle |
| `PUBLIC_APP_ORIGIN` | Explicit canonical HTTPS origin deployed; local default http://localhost:PORT, with override for the development frontend |
| `AUTH_RATE_LIMIT_SECRET` | Independent 32..4096-byte deployed secret for auth budget HMAC; fixed local-only key is refused in deployed configuration |
| `OUTBOUND_DISPATCH_ENABLED` | Global SEND authorization, true only by local/test default and false when deployed unless explicitly enabled |
| `LOG_LEVEL`, `LOG_FORMAT` | Structured JSON logs for deployed environments |
| `TRUST_PROXY`, `FORCE_SECURE_COOKIES` | Proxy-aware secure session configuration |
| `WORKER_ENABLED`, `WORKER_INTERVAL_MS` | Current in-process worker control and tick interval |
| `LLM_PROVIDER`, `LLM_MODEL`, provider-specific secret | Optional model configuration; local deterministic behavior remains available |
| `TEST_DATABASE_URL`, `TEST_DATABASE_DISPOSABLE=1` | Explicit dedicated disposable test target and acknowledgment; no runtime DB fallback |
| `ENABLE_TEST_CONTROLS` | Off by default; local test/development opt-in only, ignored in staging/production |
| `ISOLATED_E2E_HARNESS` | Set by the E2E launcher only; health capability requires test mode, memory SQLite and no provider environment |

Verified database trust, global/tenant pause and daily attempt/unresolved limits are implemented above. Monetary/model-spend budgets, alert destinations and measured provider readiness remain planned. HTTP/auth/provider fixed ceilings are code defaults, not undocumented environment knobs. Explicit booleans/numbers outside supported values fail configuration validation; PORT is limited to 1..65535.

Batch A disables synthetic HTTP controls and mock-completion simulation in staging/production. A tenant owner cannot trigger global worker execution through HTTP. Human-task execution is not evidence a person completed the task; the real completion flow remains L4. See [Batch A](verification/BATCH_A.md) for current proof and pending QA.

`WORKER_ENABLED=false` only stops the interval. It does not disable manual
execution APIs or constitute the required outbound emergency stop.

## Migration and release procedure

### Present command behavior

| Command | Current effect |
| --- | --- |
| `npm.cmd run db:status` | SELECT/catalog inspection only; SQLite opens read-only and never creates a missing file; pending/incompatible history exits nonzero |
| `npm.cmd run db:migrate` | Explicit serialized mutation; deployed environments require dedicated MIGRATION_DATABASE_URL; local fallback uses the reviewed local target |
| `npm.cmd run verify:deploy` | SELECT-only PostgreSQL schema/prerequisite/config inspection; never migrates; errors avoid raw credentials/connection text |
| `npm.cmd run test:pg` | Requires explicit disposable opt-in; creates/drops only the current random run's schemas; interruption leaves its namespace for review |
| `npm.cmd run verify:workflows` | Mutates only a loopback server advertising the validated isolated-E2E capability; other targets/redirects are refused before writes |

Normal API startup calls openRuntimeDatabase and refuses absent, pending or incompatible migration history before listening. It does not create files/tables or apply migrations. Only the explicitly validated disposable E2E harness bootstraps memory storage. Readiness uses the same read-only history semantics. PostgreSQL restricted-role acceptance remains required; inspection-only code does not provision or prove a restricted cloud role.

The migration runner serializes history/application under a PostgreSQL transaction advisory lock scoped to database/schema, or SQLite BEGIN IMMEDIATE. Each migration and its marker commit together; competing runners reread history after acquiring the lock. Unknown IDs, gaps and unsafe pre-runner authorization shapes refuse rather than silently modifying history.

Do not modify a migration already applied to a real environment. Add an explicit
numbered upgrade. The registry now contains immutable 0001_baseline_schema, 0002_runtime_column_reconciliation, 0003_contact_restrictions, 0004_prepared_action_revisions, 0005_bounded_dispatch_recovery, 0006_durable_webhook_receipts, 0007_scheduler_event_recovery, 0008_operational_controls, 0009_business_context, 0010_reviewed_import, 0011_import_identity_resolution, 0012_lead_data_management, 0013_intelligence_freshness, 0014_business_fit, 0015_analysis_jobs_ai_usage, 0016_intelligence_feedback_evaluation and 0017_email_connection_setup. Later L2-L4 rollout sections describe these additive records and acceptance requirements. 0008 adds auth admission and typed workspace controls while preserving prior domain records and migration history. 0002 retains its frozen supported repair list and conservative authorization defaults; 0003/0004 retain restriction/review history; 0005 holds ambiguous historical executions rather than inventing retry authority; 0006 keeps callback/inbound history unlinked and LEGACY_UNKNOWN instead of inferring applied effects; 0007 keeps unfinished legacy event/run history under review holds without promoting it to managed retry or advancement. Unsafe pre-runner shapes or invalid historical attempts require inspected remediation, not automatic baseline adoption or renumbering.

Review [migration evidence](verification/L1-03-migrations.md) and inventory an isolated restored copy of the actual prior release before applying it. Record any owner assignment and legacy action remediation explicitly; ordinary approval cannot reactivate blocked/completed/in-flight actions. A synthetic upgrade fixture is not proof of a specific deployed schema.

### Target release sequence

1. Record the immutable commit, migration IDs, rollout owner, environment,
   acceptance evidence and rollback/roll-forward plan.
2. Run required unit/integration/contract, PostgreSQL, React build and browser
   checks on that commit. Keep test credentials away from customer data.
3. Prove the upgrade against a restored previous-release fixture containing
   representative leads, approvals, actions, messages and schema history.
4. Confirm backup freshness and the last successful restore drill. Pause outbound
   through the future application control if the change affects execution safety.
5. Run a separate controlled job with NODE_ENV and MIGRATION_DATABASE_URL supplied through its secret facility, then npm run db:migrate over the chosen administrative connection. Do not place that DDL secret on the web service. Use additive changes compatible with old/new applications where possible; backfills must be bounded and observable. This version rejects unknown migration IDs, so rolling back to an older strict runtime may require a compatible app patch/roll-forward instead of automatically accepting the expanded schema. Rehearse the chosen recovery.
6. Deploy the API/worker using runtime-only credentials. Verify readiness and
   worker heartbeat without dispatching unreviewed work.
7. Run scoped smoke/browser checks, inspect error rates and queue age, and
   explicitly resume approved work after the observation window.
8. Record deployment result and update task, testing, architecture/API and
   runbook documents in the same change.

Before the web rollout, the separate migration job must complete successfully. The repository does not provision this job or its database roles. Current web blueprint sequence:

```text
npm ci
npm --prefix client ci --include=dev
npm --prefix client run build
npm run verify:deploy
npm start
/api/health/ready
```

The client development dependencies are needed to build production assets.
The blueprint's pre-deploy command is read-only verify:deploy, using runtime credentials. It fails if the migration job has not prepared a compatible schema. Keep auto-deploy off for the initial controlled rollout and gate later automation on required release checks.
[Render deploy commands](https://render.com/docs/deploys).

The blueprint documents verified database trust, explicit deployed origin/auth admission secret and separate migration ownership. It keeps the interval worker and global OUTBOUND_DISPATCH_ENABLED disabled for controlled rollout. WORKER_ENABLED=false alone is not a global send kill switch. Branch, service name, region, roles and actual cloud settings must still be verified; this change does not push a branch, provision a migration job or create a service.

### Public landing deployment: planned L4/L5

[LANDING_PAGE](LANDING_PAGE.md) adds public static/indexable content, lazy example/application bundles and explicit public/auth/protected routes. These are not implemented yet. L5-07 must verify initial HTML, route fallback, API exclusion, private-route indexing/cache behavior, canonical/share metadata for the actual domain, staging noindex and real CTA receipt/error handling. L6-04 authorizes public publication only after claims, support and onboarding match the released scope.

### Post-deployment checks

Use the actual deployed URL, not an assumed service hostname:

```powershell
$verificationBase = 'https://YOUR_VERIFIED_STAGING_HOST'
Invoke-RestMethod -Uri "$verificationBase/api/health/live"
Invoke-RestMethod -Uri "$verificationBase/api/health/ready"
```

Readiness must reflect database connectivity/schema compatibility. Verify login,
logout, session expiry/recovery, `Secure`/`HttpOnly` cookie attributes,
cross-workspace reads and mutations, owner-only settings, and absence of
production developer controls. Inspect correlated structured logs without
secrets. Follow [TESTING.md](TESTING.md) for the browser workflow.

The isolated workflow verifier refuses ordinary pilot/production targets. A future production smoke must use approved synthetic fixtures, scoped execution and provider sandbox mode by construction.

## Verified single-channel gate

Email is the first implemented channel candidate. Product discovery must confirm
that it reaches the pilot's actual customers; if another channel is essential,
revise the scoped channel milestone instead of shipping an unusable email loop.

Finish one provider before offering a second provider/channel in normal
onboarding. Verify:

- Sender identity/domain setup, reply address, monitored inbox ownership, and
  tenant routing; a draft must not promise an enquiry history or callback that
  the business did not supply.
- Exact approved subject/body/recipient/sender delivered to controlled test
  mailboxes; distinguish accepted, delivered, failed and unknown states.
- Delivery, bounce, unsubscribe/complaint and reply callbacks with authenticity,
  replay checks, correct attempt correlation and durable retryable processing.
- Operator reply, assignment, resolution, scheduled follow-up, stop behavior,
  intelligence refresh and recorded customer outcome.
- Provider rate limits, allowed-use requirements, sending limits and response to
  deliverability incidents, with an owner and runbook.

The present SendGrid URL token is not a complete origin/replay verification
implementation. Follow the selected provider's supported mechanism separately
for event and inbound webhooks; SendGrid documents
[event webhook security](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)
and [inbound parse security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

Provider verification uses owned/authorized controlled mailboxes and an approved
test-send procedure. Configured credentials and stubbed tests do not establish a
working production send/reply loop.

## Backups, restore and external-action reconciliation

A funded recovery method and a successful restore drill are required before
customer data. Select backup cadence, retention, recovery window, region and
operator access to meet the agreed RPO/RTO; include costs in the pilot budget.

Supabase's paid backup and optional point-in-time recovery capabilities differ
from periodic free-tier exports. Database backups exclude Storage objects and
custom-role passwords, so attachment recovery and role credential recovery need
their own procedures. Verify the selected entitlement and current recovery
behavior in the [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

Restore drill:

1. Restore to an isolated target with outbound dispatch and provider credentials
   disabled. Preserve the original database for investigation.
2. Restore/rebind required roles, configuration and object storage as applicable.
3. Check tenant counts, representative facts, approvals, suppression, messages,
   audit history, migration state and pending jobs.
4. Reconcile provider actions accepted after the restore point. Database restore
   does not reverse sent messages, and restored pending actions could otherwise
   send them again. Hold ambiguous actions for operator review.
5. Replay eligible durable webhook receipts without outgoing sends; inspect mandatory-policy holds and preserve identity/hash/review tombstones. Reconcile suppression learned after the backup, including policy-only conflicts. Purged terminal bodies are not replayable input; record any unrecoverable data window.
6. Measure actual restore duration and recoverable timestamp; only resume after
   validation and operational sign-off.

Repeat after material schema/storage changes and at the agreed operating
cadence. "Backup enabled" is not a restore result.

## Proposed pilot operating envelope

These numbers are planning targets, not measured capacity or customer SLAs.
Ratify them against the chosen customer and cost budget before L5 sign-off.

| Measure | Proposed initial target | How to establish it |
| --- | --- | --- |
| Pilot scope | 3-5 supervised businesses; initially about 100 real enquiries each | Product owner approves cohort and useful dataset; explicit caps enforced |
| Capacity rehearsal | 10 workspaces, 10,000 total leads, 10 concurrent active users, one tenant importing/analyzing in bulk | Staging load fixture with realistic evidence/message history and provider latency |
| API availability | 99.5% over a rolling 30 days after launch | Synthetic and real request monitoring; report monitoring coverage and exclusions |
| Interactive API latency | p95 under 1 second for ordinary paginated reads/writes in the rehearsal envelope | Exclude external research/generation duration; show async progress for longer jobs |
| Due-action lag | p95 under 60 seconds when dependencies are healthy and the action is eligible | Due time to durable execution claim; report delays from quiet hours, approval or throttling separately |
| Restore data-loss window (RPO) | At most 1 hour for pilot | Fund compatible backup/PITR method and demonstrate actual recoverable timestamp; daily-only backups do not meet this |
| Recovery duration (RTO) | At most 4 hours for pilot | Timed isolated restore including configuration and provider reconciliation |
| Budget controls | Explicit tenant/global daily and monthly ceilings; alert at 70% and 90%, stop new chargeable work at limit | Product/operations owner sets amounts after provider selection; reservations include queued/retried work |
| Support | Named primary and backup operator with published pilot support hours | Incident rehearsal and escalation acknowledgement |

If the funded recovery method cannot meet the proposed RPO/RTO, record a revised
customer-understood objective before onboarding. Do not promise targets that have
not been configured and rehearsed.

## Monitoring and incident response

Start instrumentation and safety controls in L1; L5 verifies the complete
operating system:

- Correlate request, tenant, lead, intelligence run, action, attempt, provider
  reference and callback receipt. Redact credentials and minimize contact/body
  content in routine logs.
- Monitor readiness, database pool wait/usage, query latency, migration status,
  worker heartbeat, oldest due action, retry count, unknown sends, dead-letter
  items and webhook processing lag. Track oldest mandatory-policy PENDING receipt, quarantined/exhausted processing and callback/inbound PENDING cursors; a pending-policy receipt can hold its entire workspace.
- Track suppression violations and duplicate-send indicators as urgent incidents.
  Track complaint/bounce trends and provider blocks; pause affected tenants or
  channels while investigating.
- Track model/provider cost by tenant/job and successful business workflow.
  Include failed/retried attempts, storage, egress, backups, logging and support
  time in cost-to-serve.
- Enforce per-tenant queues/limits so a large import or analysis run cannot starve
  inbox replies, due follow-ups or other tenants.
- Name the incident owner and backup. Provide runbooks for DB outage, stuck queue,
  duplicate/unknown send, provider outage, compromised credential and bad AI
  output. Record customer impact and decisions.

L1-10 implements global/tenant SEND pauses with local regressions. Use the owner sending controls for a durable workspace pause; apply OUTBOUND_DISPATCH_ENABLED=false across every instance through controlled restart for application-wide containment. Disabling the interval worker alone leaves manual authorization available. Already authorized requests may finish, so use service/provider containment under the incident procedure when necessary and reconcile all uncertain outcomes.

The implemented shutdown handler stops new dispatch/ticks and HTTP admission, closes HTTP acceptance, and waits for active HTTP, worker, scheduler, domain-event, executor and webhook-handler promises before database close. Tracked HTTP handler work continues to count after a client disconnect and must drain explicitly; a server.close callback alone is insufficient evidence that database work has ended. Its 30-second deadline leaves unresolved durable ownership intact for expiry/reconciliation; it never resets work to RETRYING. Verify the real host's termination behavior and deployment overlap with an active provider request before operational acceptance.

## Pilot and public-launch sign-off

**Internal sandbox** can proceed with isolated data and visible limitations.
**Supervised pilot** requires all L1-L5 blockers closed and the restricted cohort,
channel, limits and support commitment recorded. **Public launch** follows L6
evidence and a deliberate product/engineering/operations decision.

Required evidence includes upgraded-database and concurrency tests, React human
QA, real controlled-mailbox provider verification, restore/reconciliation drill,
monitoring/alert tests, account recovery, consent/suppression, data export/deletion
and retention policy, abuse/cost limits, and a customer workflow demonstration.

Keep a release record with immutable commit, selected infrastructure/region,
database version and migration IDs, actual resource provisioning status, budget
owner, evidence links, unresolved issues, restrictions and rollback decision.
A successful cloud deployment alone does not establish product readiness.

## L2-01 context migration and operations

The additive0009_business_context migration follows0008 and creates append-only profile/enquiry revision tables plus scoped user/lead identity indexes for composite foreign keys. Run the existing separate migration job before application startup; no web-runtime DDL or legacy business-fact backfill is introduced. Verify an isolated populated upgrade and same-workspace actor/lead constraints on the selected PostgreSQL version before deployment. Older context-less records remain neutral revision0.

No new environment key, provider or infrastructure service is required. Context saves use the existing workspace transaction gate and do not queue model work or mass-update leads. Current reads and send review use stored revisions; existing authorized sends may still finish after a save. Operators must refresh intelligence and review affected copy. A restored copy must retain context histories alongside snapshots/reviews and remain paused under the established restore policy.

Manual source references are unverified data displayed as text. Context snapshots may contain customer information; do not put their JSON or source excerpts in logs. Existing body/size/access controls apply. Per-lead current-state reads are not a measured large-workspace performance guarantee; pagination/load and dataset acceptance remain launch work. [L2-01 evidence](verification/L2-01.md) lists local checks and open PostgreSQL/operator gates.

## L2-02 reviewed import rollout boundary

Migration 0010_reviewed_import is additive after 0009 and adds reviewed import metadata, raw cells, corrections and scoped row outcomes. It also backfills only the derived, indexed name/company hash in bounded pages using a frozen application-normalization algorithm; original fields remain unchanged. Measure that migration on a production-shaped copy. Apply through the dedicated migration command/role; normal startup/readiness does not perform DDL. No new environment variable, provider or dependency is required. Rehearse populated previous-release upgrade and restore on a dedicated disposable PostgreSQL target before deployment.

Existing completed imports remain readable. Unfinished historical contract-0 imports are held for a new reviewed preview; do not infer missing lead/event effects from old row flags. Preserve historical source and reconcile ambiguous prior leads before re-importing. New work persists complete row outcomes and resumes its original frozen selection without replaying completed effects. Source/correction records contain customer data and inherit the pending retention/export/deletion requirements.

CSV limits are 2 MiB, 1000 data rows, 64 columns and 4096 characters per cell; commit is at most 25 rows per request with a short processing time bound. These are safety caps, not measured production capacity. Recent import listing is bounded; full history pagination and large-workspace/load evidence remain later work. [Contract](L2-02_REVIEWED_IMPORT.md) and [verification](verification/L2-02.md) record behavior and open gates.

## L2-03 identity rollout boundary

Migration 0011_import_identity_resolution follows 0010 and creates an append-only source/decision ledger with scoped foreign keys and uniqueness. It changes no historical import row, outcome, lead, event or prior migration. Use the dedicated migration role/command and verify populated PostgreSQL upgrade, least privilege and restore before deployment. No new provider, dependency or environment setting is introduced.

Do not reinterpret a COMMITTED import with HELD rows as fully imported. Inspect its separate identity resolution history; the original selection/outcome remains visible. Interrupted identity requests must reload saved resolution and replay the exact intent. Existing sources require no migration backfill. Candidate review displays 50 existing/20 in-file entries and scans at most 5000 existing matches; overflow holds resolution for operational review. Sources show up to 100 recent links within an 8 MiB serialized source budget, with a truncation flag. Public resolution summaries omit the stored review snapshot. Policy review admits at most 10000 distinct pending receipt/relevant restriction records; excess produces no usable review token.

Ambiguous contact-only inbound retains its unassigned receipt. Directly matched automated work stops before mandatory policy is completed; the deterministic marker prevents replay against newer intentional work. Preflight caps of 100 leads/workflows/queued actions/automatic tasks and delayed callback marker bounds fail closed. An old DONE receipt without that marker re-establishes PENDING before retry. Do not clear the policy gate or rewrite immutable receipt input to work around a limit; investigate the source/workload and use the recorded recovery path. Full provider correlation and operator assignment are later inbox work. [Contract](L2-03_IDENTITY_RESOLUTION.md) and [verification](verification/L2-03.md) distinguish local evidence from rollout approval.

## L2-04 correction/archive rollout boundary

Migration 0012_lead_data_management follows 0011 and adds default-zero data revisions, independent archive state and a scoped correction/archive ledger. Use the dedicated migration path before the web/worker rollout. Existing rows remain revision 0 and unarchived; no historical status or artifact is guessed. Preserve this ledger alongside import/context histories, prepared revisions and executions during backup/restore. Test a populated PostgreSQL upgrade and restricted roles before deployment.

No provider, package or environment setting is added. Correction/archive use brief workspace transactions, never model/provider I/O inside the gate. Historical provider acceptance and uncertainty remain facts after an archive; restoration must not restart old work. The [contract](L2-04_DATA_MANAGEMENT.md) records conservative carried restrictions, bounded history/directory/CSV reads and late-event behavior. Export is an operational selected-record download, not a database backup or L5-04 portability/deletion implementation. [Evidence](verification/L2-04.md) records local and external checks separately.

## L2-05 freshness adoption

Apply additive migration 0013_intelligence_freshness through the existing verified migration process. No new provider, package, environment setting or datastore is required. Null historical snapshot metadata stays historical; affected analysis requires explicit refresh. Neutral identity-only fingerprints remain compatible.

Currentness uses the writer and advances a technical per-workspace high-water in short transactions. Monitor workspace lock contention and validate the actual host clock before rollout. A clock incorrectly advanced far into the future will conservatively age evidence; investigate that operational incident rather than resetting the watermark to restore old approval. Restoring a database restores its clock and authority history too; an old backup is not proof that previously expired external approval is current. Deployment restore/clock drills and PostgreSQL concurrency remain required evidence.

Policy 1's 90-day ongoing-fact/research TTL is provisional. Validate it against the pilot's source semantics and sales cycle before launch. [Contract](L2-05_FRESHNESS.md) and [verification](verification/L2-05.md) separate this local implementation from launch approval.

## L3-01 migration and acceptance

Migration 0014_business_fit adds nullable bounded criteria/assessment columns; apply through the existing ordered runner before new code serves traffic. Existing profiles/snapshots retain null rather than fabricated fit. Rollback/UTF8 bounds are tested on disposable SQLite; run the explicit disposable PostgreSQL checks and hosted migration/review workflow before staging acceptance. No new environment secret or provider configuration is introduced. See [contract](L3-01_BUSINESS_FIT.md) and [evidence](verification/L3-01.md).

## L3-02 AI adapter boundary

The existing configured AI adapter now caps a request at 256KiB, output JSON at 64KiB and deadline at 15 seconds, rejects redirects and requires one completed text response. Provider failure or unsupported output becomes a fixed safe review fallback. There is no automatic AI retry, new secret, database migration or new hosted dependency. Custom OpenAI-compatible deployments must support the recorded text/json completion envelope; verify that adapter with synthetic authorized provider QA before claiming compatibility. Real model latency/usage/cost and persisted analysis-job recovery remain L3-03 acceptance; no hosted provider was contacted for the local synthetic evaluation.

## L3-03 analysis jobs and model accounting rollout

Apply additive 0015_analysis_jobs_ai_usage only through the separate migration command after the previous registry entries and an owned backup/restore rehearsal. It adds analysis_jobs, analysis_job_items, workspace_ai_controls, workspace_ai_control_revisions and ai_provider_attempts with scoped foreign keys and bounded metadata. Historical events/receipts/artifacts are unchanged; no prior AI usage is reconstructed. Strict old runtimes reject the new registry, so rehearse a compatible roll-forward/recovery path.

AnalysisRequested uses the normal EVENTS worker phase. The asynchronous UI needs that worker enabled; an accepted job remains queued while processing is stopped. There is no additional broker or job worker. Keep deployment credentials and provider configuration process-owned. Configured provider/model/prompt/schema/adapter and deterministic version changes hold earlier jobs; operators inspect and cancel old work before explicitly creating current jobs. Do not clear fences, attempts, deadlines or version bindings in SQL.

Settings -> AI limits controls workspace pause, daily admissions and logical in-flight limits independently from sending controls. Defaults100/day and2slots are provisional, not a load certification. Every admitted attempt consumes its original UTC day, even on timeout, cancellation or malformed response. An expired slot can become available without proof that remote work stopped. Same-fence replay is denied; a later authorized processing attempt may incur another charge.

Owner rates are optional exact USD-per-million-token estimates, never live pricing. Inspect unknown coverage and reconcile actual provider usage separately; prompt/provider body content is absent from the ledger. The UI exposes the current effective UTC day; historical ledger rows persist for later reporting/retention work. Pause new invocations before provider changes or accounting incidents and use job controls to inspect held work. Direct supported contact stops remain effective while AI is paused.

The local [verification](verification/L3-03.md) does not replace disposable PostgreSQL migration/concurrency, restored-data/least-privilege checks, real-provider cost and cancellation reconciliation, workload/alert tests or operator acceptance. No deployment or live customer send is part of this slice.

## L3-04 migration and evaluation release gates

Migration0016_intelligence_feedback_evaluation is additive after0015. It creates feedback/replay records and scoped artifact indices, with no inferred historic reviews, case nominations or consumed groups. Use the existing migration role and contiguous registry procedure. Validate the populated upgrade, failed-marker rollback, concurrent reviews/dataset versions and atomic holdout consumption on a disposable PostgreSQL restore before rollout; local SQLite evidence is not that proof.

Private feedback targets may retain the original reviewed reply input. Include these records in the existing scoped access, backup and retention review; nomination alone is no external-transfer authority. All replay is bounded local computation and makes no model calls. CI's pinned synthetic baseline gate verifies exercised code behavior; real model configuration changes and deployment approval still need reviewed representative data, provider results and the launch gates in PILOT. [Local evidence](verification/L3-04.md) tracks verification limits.

## L4-01A channel setup rollout

Migration0017_email_connection_setup adds scoped email_connection_revisions and globally unique email_webhook_routes; it preserves existing settings and does not invent verification or backfill ambiguous ownership. Apply through the separate migration job after backup/restore rehearsal. No production migration was performed by this slice.

Set PUBLIC_APP_ORIGIN to the canonical browser/webhook origin before provisioning. GET requests do not generate URLs. Owners save email configuration through the versioned connection endpoint, then explicitly provision/rotate. New routing aliases retain previous signed aliases; this is not signing-key rotation or credential revocation. Duplicate legacy tokens refuse ingress/provisioning until inspected repair, without assigning the token to the first matching workspace. Reserved managed-token or ledger drift fails closed.

Settings inspection and proposed next state are bounded, including preserved private legacy fields. Over-limit or corrupt configurations require operational inspection; exact accepted-request lookup/history remain available independently. Public/history output masks credentials. A Telegram bot token is also treated as secret, even when that legacy provider remains unsupported.

Normal application dispatch holds SendGrid with CHANNEL_VERIFICATION_REQUIRED until current configuration-bound checks and signed delivery/failure/reply/stop proof pass the [verification contract](L4-01_PROVIDER_VERIFICATION.md); incomplete setup and unsupported live providers have separate holds. No environment sending switch, generic settings write or owner checkbox grants channel verification. The explicit synthetic adapter-test profile exists only for test mode with test controls and without the isolated browser harness; it is not a deployment bypass.

Next acceptance must verify the actual sender/domain, credential permissions, delivery/failure events, signed Inbound Parse security policy, monitored Reply-To routing and suppression through controlled mailboxes. The current parser expects parsed fields (send_raw=false); raw MIME/attachments and exact enquiry/thread correlation remain unsupported. See the [recorded contract and official references](L4-01_CHANNEL_SETUP.md) and [local evidence](verification/L4-01.md). Actual PostgreSQL constraints/concurrency/restore, public-origin/proxy configuration and provider key rotation remain unverified.

## Completion batch operational additions - 2026-09-13

Migrations0018-0024 add composer, security, public interest, customer-workflow, provider-verification, completed workspace-erasure and pilot-interest-operation state. The current static structural manifest inventories82 tables across24 migrations. Deploy through the existing separate migration role and migration procedure. Offline recovery codes are shown once; owners must store them privately and verify fresh login after password recovery or full session revocation. Public pilot requests persist separately for operator review; no notification email is sent.

EMAIL_VERIFICATION_DELIVERY_MAILBOX and EMAIL_VERIFICATION_FAILURE_MAILBOX are optional deployment-only exact, distinct controlled destinations. The operator must independently authorize both before a live verification exercise. Missing configuration keeps probes unavailable; no browser field can nominate recipients. The controlled failure sink must produce a real signed rejection. The reply/stop exercise permanently restricts the delivery contact. Configure a different authorized clean sink when a changed setup needs fresh evidence; do not clear the stop to reuse it. See [provider protocol](L4-01_PROVIDER_VERIFICATION.md). No live configuration or deployment was performed in this batch.

## Candidate release sequence and operating ownership

Use [RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md) as the ordered gate and decision record. [L5-01](L5-01_OPERATIONS.md) defines explicit SQLite backup/restore commands and the isolated PostgreSQL rehearsal. [L5-03](L5-03_OPERATIONS_ACCEPTANCE.md) defines operational metrics, in-app alert limits and the measured local workload; it is not a hosted load certification. [L5-04](L5-04_DATA_LIFECYCLE.md) defines customer-data export/erasure and independent current suppression/erasure reconciliation before restored-data activation. [L5-07 operations](L5-07_PILOT_INTEREST_OPERATIONS.md) provides actual queue review/close and expired-record purge commands.

Pilot-interest expiry is a stored timestamp, not a background deletion promise. Assign and demonstrate the deliberate reviewed purge schedule. Live publication also requires verified reverse-proxy admission behavior, operator identity, privacy/support details and reachable response ownership. The socket peer remains the public-intake rate-limit identity; arbitrary forwarded headers cannot supply admission authority.
