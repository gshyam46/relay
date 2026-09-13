# L1-10 authentication and HTTP boundary verification

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Scope: locally implemented authentication admission, request readers/trust policy, atomic registration and additive operational schema. Contract: [L1-10 operations](../L1-10_OPERATIONS.md). Integrated release evidence is maintained separately by the integrating owner.

## Implemented behavior

Authentication admission obtains at most two nonqueued local slots, then atomically checks durable global, normalized-account and socket-peer fixed windows before password work. A singleton database row serializes the short admission transaction; work and scrypt run after it commits. HMAC-SHA256 identity keys contain no raw email or IP. The global key is independent of secret rotation. Backward clocks retain existing future windows; success and rejection never replenish them. Cleanup examines at most 100 expired non-global candidates, deletes only valid expired state and caps total buckets at 10000. Corrupt relevant state, storage failure and capacity exhaustion fail closed without password work.

The fixed login budgets are 200/minute globally, 30/5 minutes per socket peer and 10/15 minutes per account. Registration budgets are 20/hour globally, 10/hour per peer and 3/hour per account. Admission errors use fixed 429/503 categories and Retry-After. Forwarded headers do not select identity: clients behind a reverse proxy or NAT share the peer budget until a verified edge policy exists.

Passwords are limited to 1024 UTF-8 bytes before scrypt. Unknown users perform one dummy verification and receive the same credential rejection; this removes the obvious skipped-hash distinction without claiming constant-time authentication. Registration hashes before a short transaction that commits organization, owner, session and mandatory audit together. Concurrent duplicate registration and injected session/audit failures leave no orphan workspace. Malformed or noncanonical expiry values and malformed/duplicate session cookies cannot authenticate.

Request readers count streamed bytes and enforce an absolute body deadline, including clients that keep trickling bytes. JSON requires application/json, supported identity encoding, valid UTF-8 and a top-level object. Failure drops buffered chunks, pauses ingress and removes reader timers/listeners; a late-error guard remains only until close. The integrated HTTP owner closes unread rejected requests after the response finishes, without an unbounded drain. A peer that keeps writing during closure can observe a TCP reset instead of an error body; server rejection and bounded teardown are authoritative.

Origin checks use only configured public origin. Cross-site fetch metadata and mismatched/null Origin are rejected for mutations, including explicitly marked existing GET routes that create approval reviews or webhook routing tokens. Supported signed webhook POST exemptions are chosen by exact API routing. Authenticated non-browser clients without Origin retain their API path. Ordinary GET/HEAD handling, cheap liveness bypass, process-wide request caps, response teardown and server header/request deadlines are covered by the integrating owner's HTTP tests.

Migration 0008_operational_controls adds auth_admission_state, auth_rate_buckets and typed workspace_dispatch_controls. It seeds only the singleton and two zero-use global buckets. Existing workspace/user/session/contact/audit data are unchanged; no customer data migration was run. Missing workspace controls retain service defaults, and storage constraints bound revision, pause state, daily/unresolved limits, reason and ownership references. The migration registry appends 0008 without modifying earlier migrations.

## Automated evidence

Executed through the repository's isolated test runner:

~~~text
node scripts/run-tests.js test/auth-admission.test.js test/auth-boundaries.test.js test/http-request-policy.test.js test/operational-migrations.test.js test/auth.test.js
44 tests: 41 passed, 3 skipped, 0 failed
node scripts/format-check.js
Format check passed for 258 files.
~~~

The three skips require the explicit disposable PostgreSQL runner: independent-client auth admission serialization and 0008 preservation/constraint checks. They are not production PostgreSQL proof.

Behavioral cases include actual SQLite close/reopen, two independent database connections racing remaining account capacity, global admission across secret rotation, nonqueued slot release after failures, pre-hash rejection, all-counter rollback, bounded cardinality/cleanup and malformed-state preservation. Registration tests inject session/audit persistence failures and race normalized duplicate accounts. Real loopback HTTP/raw TCP cases cover chunked oversize, declared oversize without body transmission, premature client abort and slow active streams; readable-stream cases prove late errors cannot become uncaught exceptions after rejection. Origin tests include state-changing GETs and hostile Host/forwarded identities. Migration tests compare populated historical rows, repeat migration without resetting counters and inject both expansion and ledger failures.

Additional integration verification passed 13/13 cases in test/auth.test.js, test/operational-http.test.js and test/sendgrid-webhook-security.test.js, preserving exact signed bytes and durable provider receipt behavior.

Independent operational review identified a UTC-midnight race: the executor captured one authorization instant while the controls service independently sampled another day for quota usage. The outbound owner now requires the captured canonical authorized_at for transactional quota inspection, matching the execution INSERT. test/dispatch-control-review.test.js reproduces the exhausted prior-day boundary, proves no extra attempt/provider invocation occurs and verifies a separate next-day admission succeeds. Candidate SQL tenant scoping and authoritative workspace-gated inspection were reviewed without further blocking findings.

Final successful-mutation body audit found one omitted reader: the explicitly local test-control POST /api/worker/run route. The integrating owner now consumes its ordinary bounded raw body before invoking the worker. Empty and small ignored non-JSON bodies retain compatibility, while streamed/declared oversize and stalled bodies produce no worker effects. Authenticated workspace scope remains session-derived. Other mutation success routes already consumed bounded bodies; the deprecated edit-and-approve route rejects through bounded unread-error teardown. test/operational-body-review.test.js plus test/operational-http.test.js passed 7/7 cases with no skips or failures. The fixture explicitly enables local test controls; the production route remains unavailable.

All inputs, recipients, secrets and accounts were synthetic. No external provider calls, deployments, package installations or customer database mutations were made.

## Remaining gates

Real PostgreSQL concurrency, verified staging database TLS/roles, deployed public origin, reverse proxy behavior, secure cookies and credential rotation require separate evidence. Browser navigation/cross-origin behavior, accessibility, measured load and operator alerts remain human/external checks. Account recovery, email verification and customer access lifecycle remain later product work. Current side-effecting GET routes use the stated Origin/fetch-metadata boundary pending route redesign. These local checks do not certify launch readiness or close all L1-10 acceptance gates.
