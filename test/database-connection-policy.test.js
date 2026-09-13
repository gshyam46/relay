import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer, connect as connectTls } from "node:tls";
import pg from "pg";
import { buildPostgresOptions, parsePostgresUrl, validateCa } from "../src/database/connectionPolicy.js";
import { loadConfig, loadMigrationConfig, validateConfig, describeConfig } from "../src/config.js";
import { openDatabaseClient, PostgresDatabaseClient, describeDatabaseFailure } from "../src/database/database.js";
import { safeTestEnvironment, schemaDatabaseConfig, newTestRunId, schemaFor } from "../scripts/helpers/testSafety.js";

const URL = "postgresql://selected-user:selected-password@localhost:5432/selected-database";
const deployed = { NODE_ENV: "production", DATABASE_URL: URL, PUBLIC_APP_ORIGIN: "https://app.example.test",
  AUTH_RATE_LIMIT_SECRET: "synthetic-auth-secret-at-least-32-bytes" };
const certificate = readFileSync(new globalThis.URL("./fixtures/tls/localhost-cert.pem", import.meta.url), "utf8");
const key = readFileSync(new globalThis.URL("./fixtures/tls/localhost-key.pem", import.meta.url), "utf8");
const policy = (extra = {}) => buildPostgresOptions({ databaseUrl: URL, environment: "production", ...extra });

function child(code, env = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...safeTestEnvironment(), ...env }, encoding: "utf8", timeout: 10000, windowsHide: true
  });
  assert.equal(result.error, undefined);
  return { status: result.status, output: result.stdout + result.stderr };
}

test("deployed PostgreSQL uses verified TLS and explicit bounded connection options", () => {
  const config = loadConfig(deployed);
  assert.deepEqual(validateConfig(config), []);
  const options = buildPostgresOptions(config.database);
  assert.equal(options.host, "localhost");
  assert.equal(options.port, 5432);
  assert.equal(options.user, "selected-user");
  assert.equal(options.password, "selected-password");
  assert.equal(options.database, "selected-database");
  assert.equal(options.connectionString, undefined);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.minVersion, "TLSv1.2");
  assert.equal(options.ssl.servername, "localhost");
  assert.equal(options.max, 10);
  assert.equal(options.connectionTimeoutMillis, 10000);
  assert.equal(options.statement_timeout, 15000);
  assert.equal(options.query_timeout, 20000);
  assert.equal(options.idle_in_transaction_session_timeout, 15000);
  assert.equal(options.lock_timeout, 5000);
  assert.equal(options.sslnegotiation, "postgres");
  assert.equal(new pg.Client(options).connectionParameters.ssl.rejectUnauthorized, true);
});

test("malformed URLs and all query/fragment overrides refuse before opening a driver", async (t) => {
  let calls = 0;
  t.mock.method(PostgresDatabaseClient, "connect", async () => { calls++; throw new Error("unexpected connection"); });
  const targets = ["not-a-url", "mysql://user:pass@localhost/db", "postgresql://localhost/db", "postgresql://user@localhost/db",
    "postgresql://user:pass@localhost/", "postgresql://user:pass@localhost:0/db", "postgresql://user:pass@localhost:65536/db",
    "postgresql://user:pass@localhost/%00", URL + "?", URL + "#"];
  for (const field of ["sslmode=disable", "sslmode=no-verify", "ssl=true", "sslcert=secret.pem", "sslkey=private.pem",
    "sslrootcert=other.pem", "host=evil.invalid", "user=other", "password=other", "options=-c%20statement_timeout=0",
    "query_timeout=0", "sslnegotiation=direct", "application_name=unexpected"]) targets.push(URL + "?" + field);
  targets.push(URL + "#secret-fragment");
  for (const databaseUrl of targets) {
    assert.throws(() => parsePostgresUrl(databaseUrl), { code: "DATABASE_URL_INVALID" });
    await assert.rejects(openDatabaseClient({ driver: "postgres", databaseUrl }), { code: "DATABASE_URL_INVALID" });
  }
  assert.equal(calls, 0);
});

test("plaintext and arbitrary TLS overrides fail closed when deployed", () => {
  for (const environment of ["staging", "production"]) {
    assert.throws(() => policy({ environment, ssl: false }), { code: "DATABASE_TLS_REQUIRED" });
    assert.ok(validateConfig(loadConfig({ ...deployed, NODE_ENV: environment, DATABASE_SSL: "disable" })).some((message) => /verified PostgreSQL TLS/.test(message)));
  }
  for (const ssl of [{ rejectUnauthorized: false }, "false", 0, null]) assert.throws(() => policy({ ssl }), { code: "DATABASE_CONFIGURATION_INVALID" });
  assert.equal(policy({ environment: "development", ssl: false }).ssl, false);
  assert.equal(policy({ environment: "test", ssl: false }).ssl, false);
  assert.throws(() => policy({ environment: "test", ssl: false, sslCa: certificate }), { code: "DATABASE_CONFIGURATION_INVALID" });
});

test("unknown environments, malformed explicit values and unbounded numbers never become valid defaults", () => {
  for (const extra of [{ NODE_ENV: "prodution" }, { NODE_ENV: "" }, { PORT: "70000" }, { PORT: "1e3" }, { PORT: "" },
    { DATABASE_MAX_CONNECTIONS: "101" }, { DATABASE_MAX_CONNECTIONS: "9007199254740992" }, { DATABASE_CONNECTION_TIMEOUT_MS: "2147483648" },
    { DATABASE_STATEMENT_TIMEOUT_MS: "0" }, { DATABASE_QUERY_TIMEOUT_MS: "15000" }, { DATABASE_QUERY_TIMEOUT_MS: "60001" },
    { DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "60001" }, { DATABASE_SSL: "no-verify" }, { WORKER_ENABLED: "sometimes" },
    { TRUST_PROXY: "invalid" }, { OUTBOUND_DISPATCH_ENABLED: "perhaps" }, { FORCE_SECURE_COOKIES: "false" }, { WORKER_INTERVAL_MS: "-1" }]) {
    assert.ok(validateConfig(loadConfig({ ...deployed, ...extra })).length > 0, JSON.stringify(Object.keys(extra)));
  }
  const typo = loadConfig({ NODE_ENV: "prodution", ENABLE_TEST_CONTROLS: "true", OUTBOUND_DISPATCH_ENABLED: "invalid" });
  assert.equal(typo.security.testControlsEnabled, false);
  assert.equal(typo.outbound.enabled, false);
  for (const extra of [{ maxConnections: 101 }, { maxConnections: 0 }, { connectionTimeoutMillis: 30001 },
    { statementTimeoutMillis: 30001 }, { queryTimeoutMillis: 60001 }, { queryTimeoutMillis: 15000 },
    { idleInTransactionSessionTimeoutMillis: 60001 }, { purpose: "constructor" }, { environment: "prodution" }]) {
    assert.throws(() => policy(extra), { code: "DATABASE_CONFIGURATION_INVALID" });
  }
});

test("runtime origin/auth requirements are separate from database job validation", () => {
  const databaseOnly = loadConfig({ NODE_ENV: "production", DATABASE_URL: URL });
  assert.deepEqual(validateConfig(databaseOnly, { scope: "database" }), []);
  assert.ok(validateConfig(databaseOnly).some((message) => /PUBLIC_APP_ORIGIN/.test(message)));
  assert.ok(validateConfig(databaseOnly).some((message) => /AUTH_RATE_LIMIT_SECRET/.test(message)));
  for (const origin of ["http://app.example.test", "https://user:secret@app.example.test", "https://app.example.test/path", "https://app.example.test/?q=1", "https://app.example.test/?", "https://app.example.test/#", "null"]) {
    assert.ok(validateConfig(loadConfig({ ...deployed, PUBLIC_APP_ORIGIN: origin })).some((message) => /PUBLIC_APP_ORIGIN/.test(message)));
  }
  assert.ok(validateConfig(loadConfig({ ...deployed, AUTH_RATE_LIMIT_SECRET: "short" })).some((message) => /AUTH_RATE_LIMIT_SECRET/.test(message)));
  const local = loadConfig({});
  assert.deepEqual(validateConfig(local), []);
  assert.equal(local.security.publicAppOrigin, "http://localhost:3000");
  assert.equal(local.outbound.enabled, true);
  assert.equal(loadConfig(deployed).outbound.enabled, false);
  assert.equal(loadConfig({ ...deployed, OUTBOUND_DISPATCH_ENABLED: "true" }).outbound.enabled, true);
  assert.equal(local.auth.maxConcurrentHashes, 2);
  assert.deepEqual(local.http, { headerBytes: 16384, headerTimeout: 10000, requestTimeout: 30000, bodyTimeout: 10000, keepAlive: 5000, maxInFlight: 64 });
});

test("migration selection preserves separate credentials, CA and bounded longer timeouts", () => {
  const env = { ...deployed, MIGRATION_DATABASE_URL: URL.replace("selected-user:selected-password", "migrator:job-secret"),
    MIGRATION_DATABASE_SSL_CA: certificate };
  const runtime = loadConfig(env), migration = loadMigrationConfig(env);
  assert.equal(runtime.database.databaseUrl, URL);
  assert.equal(runtime.database.sslCa, null);
  assert.equal(migration.database.databaseUrl, env.MIGRATION_DATABASE_URL);
  assert.equal(migration.database.sslCa, certificate);
  assert.equal(migration.database.maxConnections, 1);
  assert.deepEqual(validateConfig(migration, { scope: "database" }), []);
  const options = buildPostgresOptions(migration.database);
  assert.equal(options.statement_timeout, 120000);
  assert.equal(options.query_timeout, 130000);
  assert.equal(options.ssl.ca, validateCa(certificate));
  assert.throws(() => loadMigrationConfig(deployed), { code: "MIGRATION_DATABASE_REQUIRED" });
  assert.ok(validateConfig(loadMigrationConfig({ ...env, MIGRATION_DATABASE_SSL: "disable" }), { scope: "database" }).length);
  assert.ok(validateConfig(loadMigrationConfig({ ...env, MIGRATION_DATABASE_QUERY_TIMEOUT_MS: "330001" }), { scope: "database" }).length);
});

test("CA and configuration summaries never expose credentials or invalid certificate material", () => {
  for (const ca of ["secret-invalid-ca-material", key, certificate + "extra-secret", "x".repeat(65537), "", 3]) {
    assert.throws(() => validateCa(ca), (error) => error.code === "DATABASE_CA_INVALID" && !error.message.includes("secret-invalid-ca-material"));
  }
  const config = loadConfig({ ...deployed, DATABASE_SSL_CA: certificate });
  const text = JSON.stringify(describeConfig(config));
  for (const secret of ["selected-password", "selected-user", deployed.AUTH_RATE_LIMIT_SECRET, "BEGIN CERTIFICATE", "PRIVATE KEY"]) assert.equal(text.includes(secret), false);
  assert.equal(describeConfig(config).database.custom_ca_present, true);
  assert.equal(describeConfig(config).database.verified_tls, true);
  const failure = describeDatabaseFailure({ code: "DATABASE_CA_INVALID", message: certificate, cause: key });
  assert.equal(failure.code, "DATABASE_CA_INVALID");
  assert.equal(JSON.stringify(failure).includes("BEGIN"), false);
});

test("typed disposable schema options preserve ownership and cannot become arbitrary connection parameters", () => {
  const runId = newTestRunId(), schema = schemaFor(runId, "adapter");
  const config = schemaDatabaseConfig({ connectionString: URL, ssl: false, runId }, schema);
  assert.equal(new globalThis.URL(config.databaseUrl).search, "");
  const options = buildPostgresOptions({ ...config, readOnlyTransaction: true });
  assert.match(options.options, new RegExp("search_path=" + schema));
  assert.match(options.options, /default_transaction_read_only=on/);
  for (const extra of [{ testSchema: "public" }, { testRunId: newTestRunId() }, { environment: "production" }, { readOnlyTransaction: "true" }]) {
    assert.throws(() => buildPostgresOptions({ ...config, ...extra }));
  }
  const selected = policy({ options: "-c statement_timeout=0", host: "other.invalid", sslrootcert: "secret.pem", query_timeout: 0 });
  assert.equal(selected.host, "localhost");
  assert.equal(selected.query_timeout, 20000);
  assert.equal(selected.ssl.ca, undefined);
});

test("all supplied PG environment keys refuse connection before driver/network use and are never printed", () => {
  const code = [
    'import assert from "node:assert/strict";',
    'import {loadConfig,validateConfig} from "./src/config.js";',
    'import {PostgresDatabaseClient} from "./src/database/postgresClient.js";',
    'assert.ok(validateConfig(loadConfig(),{scope:"database"}).some(m=>m.includes("PG environment")));',
    'await assert.rejects(PostgresDatabaseClient.connect({connectionString:process.env.DATABASE_URL}),{code:"DATABASE_CONFIGURATION_INVALID"});',
    'console.log("ambient PostgreSQL override refused");'
  ].join("\n");
  for (const name of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGOPTIONS", "PGSSLMODE", "PGSSLNEGOTIATION",
    "PGAPPNAME", "PGCLIENT_ENCODING", "PGCONNECT_TIMEOUT", "PGREPLICATION", "PGBINARY", "PGSERVICE", "PGPASSFILE", "PGFUTUREOPTION"]) {
    const result = child(code, { DATABASE_URL: URL, [name]: "sentinel-ambient-secret" });
    assert.equal(result.status, 0, name + ": " + result.output);
    assert.doesNotMatch(result.output, /sentinel-ambient-secret|selected-password|selected-user/);
  }
});

test("actual pg parameter parsing cannot replace selected fields with ambient identity, TLS or timeout values", () => {
  const code = [
    'import assert from "node:assert/strict"; import pg from "pg";',
    'import {buildPostgresOptions} from "./src/database/connectionPolicy.js";',
    'const o=buildPostgresOptions({databaseUrl:"' + URL + '",environment:"production"});',
    'const p=new pg.Client(o).connectionParameters;',
    'assert.equal(p.host,"localhost"); assert.equal(p.user,"selected-user"); assert.equal(p.password,"selected-password"); assert.equal(p.database,"selected-database");',
    'assert.equal(p.ssl.rejectUnauthorized,true); assert.equal(p.sslnegotiation,"postgres"); assert.equal(p.statement_timeout,15000); assert.equal(p.query_timeout,20000);',
    'assert.equal(p.client_encoding,"UTF8"); assert.equal(p.application_name,"ai-lead-intelligence-runtime"); assert.equal(p.options,o.options);',
    'console.log("explicit driver policy preserved");'
  ].join("\n");
  const result = child(code, { PGHOST: "elsewhere.invalid", PGUSER: "ambient", PGPASSWORD: "sentinel-ambient-secret", PGDATABASE: "other",
    PGSSLMODE: "no-verify", PGSSLNEGOTIATION: "direct", PGOPTIONS: "-c statement_timeout=0", PGAPPNAME: "secret-application", PGCLIENT_ENCODING: "SQL_ASCII", PGCONNECT_TIMEOUT: "0" });
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /sentinel-ambient-secret|selected-password|selected-user/);
});

test("a deployed process cannot bypass TLS by passing a development target directly", () => {
  const code = 'import assert from "node:assert/strict"; import {PostgresDatabaseClient} from "./src/database/postgresClient.js"; await assert.rejects(PostgresDatabaseClient.connect({connectionString:"' + URL + '",environment:"development",ssl:false}),{code:"DATABASE_TLS_REQUIRED"}); console.log("deployed TLS refusal preserved");';
  const result = child(code, { NODE_ENV: "production" });
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /selected-password|selected-user/);
});

async function tlsFixture(t) {
  const sockets = new Set();
  const server = createServer({ key, cert: certificate, minVersion: "TLSv1.2" }, (socket) => socket.end());
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("tlsClientError", () => {});
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  return server.address().port;
}
function handshake(port, ssl) {
  return new Promise((resolve, reject) => {
    const socket = connectTls({ host: "127.0.0.1", port, ...ssl });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Synthetic TLS handshake timed out")); }, 2000);
    socket.once("secureConnect", () => { clearTimeout(timer); const authorized = socket.authorized; socket.end(); resolve(authorized); });
    socket.once("error", (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
  });
}

test("real loopback TLS accepts the explicit CA and matching hostname and IP", async (t) => {
  const port = await tlsFixture(t);
  assert.equal(await handshake(port, policy({ sslCa: certificate }).ssl), true);
  const ip = policy({ databaseUrl: URL.replace("localhost", "127.0.0.1"), sslCa: certificate });
  assert.equal(ip.ssl.servername, undefined);
  assert.equal(await handshake(port, ip.ssl), true);
});

test("real loopback TLS refuses an untrusted certificate and a trusted certificate for another hostname", async (t) => {
  const port = await tlsFixture(t);
  await assert.rejects(handshake(port, policy().ssl), (error) => /SELF_SIGNED|VERIFY|CERT/.test(error.code));
  const wrong = policy({ databaseUrl: URL.replace("localhost", "wrong.example.test"), sslCa: certificate });
  await assert.rejects(handshake(port, wrong.ssl), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
});

test("database facade preserves explicit CA, deployment mode and timeout policy", async (t) => {
  const config = loadConfig({ ...deployed, DATABASE_SSL_CA: certificate, DATABASE_MAX_CONNECTIONS: "3",
    DATABASE_STATEMENT_TIMEOUT_MS: "12000", DATABASE_QUERY_TIMEOUT_MS: "16000", DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "9000" }).database;
  let captured;
  const fake = { kind: "postgres", async close() {} };
  t.mock.method(PostgresDatabaseClient, "connect", async (input) => { captured = input; return fake; });
  assert.equal(await openDatabaseClient(config), fake);
  assert.equal(captured.sslCa, certificate);
  assert.equal(captured.environment, "production");
  assert.equal(captured.statementTimeoutMillis, 12000);
  assert.equal(captured.queryTimeoutMillis, 16000);
  assert.equal(captured.idleInTransactionSessionTimeoutMillis, 9000);
  assert.equal(buildPostgresOptions(captured).max, 3);
});

test("statement timeout aborts the transaction without callback replay and discards a connection if rollback also fails", async () => {
  for (const rollbackFails of [false, true]) {
    const commands = [], releases = [];
    const timeout = Object.assign(new Error("Synthetic statement deadline"), { code: "57014" });
    const pool = {
      on() {}, async end() {},
      async connect() { return {
        async query(sql) {
          commands.push(sql);
          if (sql === "UPDATE synthetic SET value=1") throw timeout;
          if (sql === "ROLLBACK" && rollbackFails) throw new Error("Synthetic rollback connection loss");
          return { rows: [], rowCount: 0 };
        },
        release(error) { releases.push(error); }
      }; }
    };
    const db = new PostgresDatabaseClient(pool);
    let calls = 0;
    try {
      await assert.rejects(db.transaction(async (tx) => {
        calls++;
        try { await tx.run("UPDATE synthetic SET value=1"); } catch { /* Catching timeout cannot commit partial work. */ }
      }), (error) => error === timeout);
      assert.equal(calls, 1);
      assert.deepEqual(commands, ["BEGIN", "UPDATE synthetic SET value=1", "ROLLBACK"]);
      assert.equal(releases.length, 1);
      assert.equal(Boolean(releases[0]), rollbackFails);
    } finally { await db.close(); }
  }
});

test("deployed global TLS-verification disablement is refused with a fixed safe diagnostic", () => {
  const config = loadConfig({ ...deployed, NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.ok(validateConfig(config).includes("NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden in staging and production."));
  assert.ok(validateConfig(config, { scope: "database" }).some((message) => message.includes("NODE_TLS_REJECT_UNAUTHORIZED")));
  const result = child('import assert from "node:assert/strict"; import {PostgresDatabaseClient} from "./src/database/postgresClient.js"; await assert.rejects(PostgresDatabaseClient.connect({connectionString:"' + URL + '"}),{code:"DATABASE_TLS_REQUIRED"}); console.log("global insecure TLS refused");',
    { NODE_ENV: "production", NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /selected-user|selected-password/);
});
