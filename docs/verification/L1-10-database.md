# L1-10 database and configuration verification

Date: 2026-09-11.
Product: **AI Lead Intelligence & Outbound Automation**.
Scope: local implementation evidence for the database/configuration portion of [L1-10 operations](../L1-10_OPERATIONS.md). This does not certify a deployed PostgreSQL service or close the launch milestone.

## Implemented

- PostgreSQL uses one validated connection policy at configuration and opening boundaries. The selected URL is decomposed into explicit host, port, database, user and password; no URL is forwarded to the driver. Missing credentials, malformed ports, query parameters, fragments and every supplied PG-prefixed environment variable are refused before connection. Passwordless or ambient credential discovery is outside the supported connection mode.
- Staging and production require verified certificate chains and hostname/IP identity, with TLS 1.2 minimum. DATABASE_SSL=disable is limited to explicit development/test. DATABASE_SSL_CA optionally accepts up to 64 KiB and 16 valid PEM CA certificates. Arbitrary TLS objects and URL overrides cannot disable verification. Deployed NODE_TLS_REJECT_UNAUTHORIZED=0 is refused, without modifying process environment or global TLS settings.
- Runtime pool size defaults to 10 (1..100), acquisition to 10 seconds (1..30 seconds), statement timeout to 15 seconds (1..30 seconds), client query timeout to 20 seconds (1..60 seconds), and idle transaction timeout to 15 seconds (1..60 seconds). Query timeout must exceed statement timeout. Pool idle timeout is fixed at 10 seconds; the default lock timeout is 5 seconds, with existing bounded transaction-local migration lock settings preserved.
- Deployed migration jobs still require a separate MIGRATION_DATABASE_URL. Migration pool size defaults to 1, statement timeout to 120 seconds (maximum 300 seconds), and query timeout to 130 seconds (maximum 330 seconds). Migration TLS, CA, acquisition and idle transaction overrides are independently selected, with documented runtime fallbacks; statement/query budgets have independent defaults.
- Unknown NODE_ENV values and malformed explicit booleans/numbers remain validation errors. Runtime configuration requires deployed HTTPS PUBLIC_APP_ORIGIN and AUTH_RATE_LIMIT_SECRET of 32..4096 bytes. Local defaults remain deterministic and cannot be reused as the deployed secret. New bounded HTTP/auth settings and OUTBOUND_DISPATCH_ENABLED are exposed to their owning modules; dispatch defaults off in staging/production.
- Migration/status jobs validate database scope and do not require HTTP origin or auth secrets. Full deployment verification validates and opens the same deployed configuration, refusing plaintext development fixtures. Its exported read-only catalog inspector is separately reusable in the disposable database harness.
- Disposable PostgreSQL schemas and read-only transactions use typed, owned test-schema options instead of arbitrary URL parameters. The safe launcher continues removing inherited database/provider settings. Configuration summaries and CLI failures omit URL credentials, auth secrets, CA material and raw driver error text.
- Existing transaction ownership, statement-failure latching, rollback, ambiguous-commit connection disposal and no-callback-replay behavior remain intact. No migration or baseline schema changed in this slice.

## Automated evidence

Command:

```text
node scripts/run-tests.js test/database-connection-policy.test.js test/runtime-database.test.js test/test-harness-safety.test.js test/transaction-clients.test.js
```

Result: **73 tests: 72 passed, 1 explicitly skipped PostgreSQL integration test, 0 failed.**

The new policy suite proves pre-connection refusal of hostile URL/environment settings, deployed-mode enforcement, strict bounds, separate migration/runtime policy, typed schema ownership, safe diagnostics and facade preservation of CA/timeouts. Driver parameter tests inspect the installed locked pg client without connecting to PostgreSQL. Real loopback TLS tests use only the public synthetic key/certificate in test/fixtures/tls: matching hostname and IP succeed; unknown trust and wrong identity fail. These are TLS transport tests, not PostgreSQL server or hosted-provider verification.

Existing isolated SQLite/runtime/CLI and transaction suites remain green. A PostgreSQL lifecycle double verifies that a caught server statement-timeout error cannot commit partial work and that failed rollback discards its connection. Review of the installed pg timeout code confirms that its client query timeout alone does not cancel an already sent statement; the shorter server-side statement timeout is therefore intentional. No test claims that a real PostgreSQL server enforced those settings in this environment.

All 10 owned JavaScript syntax checks and scoped git diff --check passed. The integrating owner owns full-suite, HTTP/auth/provider controls and application verification evidence.

## Deployment changes and remaining human verification

Set the explicit public HTTPS origin, a new independent auth admission secret, separate runtime/migration credentials and verified PostgreSQL TLS. Remove URL query settings and ambient PG-prefixed variables; percent-encode credential punctuation. Supply the managed service CA bundle only when its trust chain requires it. The updated .env.example and render.yaml show these requirements and keep deployed outbound dispatch disabled until intentionally enabled.

A disposable PostgreSQL target was not configured for this run. Before launch, verify the actual service certificate/hostname and CA rotation, selected database/roles/search path, runtime read/write privileges with DDL denied, separate migration privileges, server statement/lock/idle transaction cancellation, pool acquisition under contention, and read-only deployment inspection. Restore/backup drills, staged deployment/restart, provider behavior and browser QA remain separate required evidence. No application database, hosted account, provider or production credential was accessed.

## Independent ingress and shutdown review

A subsequent read-only review of the integrating owner's logger/error/HTTP/app changes reproduced two resource-lifetime gaps: disconnecting a slow request released its admission slot before database work ended, and unsupported public mutations could serve static content with unread input. Review also found that camelCase sensitive logging keys were not redacted and a non-string URL value could execute a coercion getter. The integrating owner fixed the source boundaries; the independent regression suite remains in test/operational-review.test.js.

Request admission now waits for both handler and response completion. Shutdown stops accepting application work and drains disconnected handlers before closing the database. Public static resources accept GET/HEAD only; unsupported methods receive a safe405 response and close unread input. Logger key normalization covers conventional camelCase/separator variants, and URL logging accepts strings without coercing objects.

Independent verification command:

```text
node scripts/run-tests.js test/operational-review.test.js test/operational-http.test.js test/dispatch-transport-shutdown.test.js
```

Result: **13 passed, 0 failed, 0 skipped.** This includes the four new review regressions, real loopback Origin/body/admission checks, provider outcome doubles, and shutdown deadline behavior. Post-fix source review confirms the corrected ownership order; no additional concrete tenant, signature or Origin bypass was found within this bounded review. This result does not replace staging/browser/load verification.
