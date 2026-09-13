import { verifyDeploymentDatabase } from "../scripts/verify-deployment.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import {
  createDatabase, describeDatabaseFailure, getMigrationStatus, openDatabaseClient, openRuntimeDatabase,
  SqliteDatabaseClient
} from "../src/database/database.js";
import { loadConfig, loadMigrationConfig } from "../src/config.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import {
  safeTestEnvironment, postgresTestContext, connectTestAdmin, schemaFor, schemaDatabaseConfig
} from "../scripts/helpers/testSafety.js";

function localFile(t, name = "runtime.db", registerCleanup = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "relay-runtime-"));
  if (registerCleanup) t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
}

function cli(script, env = {}) {
  const child = spawnSync(process.execPath, [script], {
    env: { ...safeTestEnvironment(), ...env },
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true
  });
  assert.equal(child.error, undefined, child.error?.message);
  return { status: child.status, output: child.stdout + child.stderr };
}

test("runtime and status opening refuse missing SQLite targets without creating directories", async (t) => {
  const missing = path.join(path.dirname(localFile(t)), "missing", "runtime.db");
  await assert.rejects(openRuntimeDatabase(missing), { code: "DATABASE_FILE_REQUIRED" });
  await assert.rejects(openDatabaseClient(missing, { readOnly: true }), { code: "DATABASE_FILE_REQUIRED" });
  assert.equal(existsSync(path.dirname(missing)), false);
  const result = cli("scripts/db-status.js", { DATABASE_FILE: missing });
  assert.equal(result.status, 1);
  assert.match(result.output, /DATABASE_FILE_REQUIRED/);
  assert.equal(existsSync(path.dirname(missing)), false);
});

test("unknown database drivers fail explicitly instead of falling back to SQLite", async (t) => {
  const file = localFile(t);
  for (const target of [{ driver: "mongo", databaseFile: file }, { databaseFile: file }, null]) {
    await assert.rejects(openDatabaseClient(target), { code: "DATABASE_DRIVER_UNSUPPORTED" });
  }
  assert.equal(existsSync(file), false);
});

test("empty existing SQLite stays unchanged after failed runtime and CLI status checks", async (t) => {
  const file = localFile(t);
  writeFileSync(file, "");
  const before = readFileSync(file);
  await assert.rejects(openRuntimeDatabase(file), { code: "DATABASE_NOT_INITIALIZED" });
  const result = cli("scripts/db-status.js", { DATABASE_FILE: file });
  assert.equal(result.status, 1);
  assert.match(result.output, /"initialized": false/);
  assert.deepEqual(readFileSync(file), before);
  const inspect = await openDatabaseClient(file, { readOnly: true });
  try {
    assert.deepEqual(await inspect.all("SELECT name FROM sqlite_master WHERE type='table'"), []);
  } finally {
    await inspect.close();
  }
});

test("runtime rejects pending or newer migration history and never silently migrates it", async (t) => {
  const file = localFile(t);
  let db = await createDatabase(file, { migrations: [MIGRATIONS[0]] });
  await db.close();
  const before = readFileSync(file);
  await assert.rejects(openRuntimeDatabase(file), { code: "DATABASE_MIGRATIONS_PENDING" });
  assert.deepEqual(readFileSync(file), before);
  db = await createDatabase(file);
  await db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ["9999_future_release", "2026-09-11"]);
  await db.close();
  const future = readFileSync(file);
  await assert.rejects(openRuntimeDatabase(file), { code: "MIGRATION_HISTORY_INCOMPATIBLE" });
  const result = cli("scripts/db-status.js", { DATABASE_FILE: file });
  assert.equal(result.status, 1);
  assert.match(result.output, /"compatible": false/);
  assert.deepEqual(readFileSync(file), future);
});

test("current runtime opens with catalog reads only, while inspection uses native SQLite read-only mode", async (t) => {
  const file = localFile(t);
  const bootstrap = await createDatabase(file);
  await bootstrap.close();
  const before = readFileSync(file);
  for (const method of ["exec", "run", "transaction"]) {
    t.mock.method(SqliteDatabaseClient.prototype, method, () => {
      throw new Error("Runtime initialization must not execute a write or transaction.");
    });
  }
  const runtime = await openRuntimeDatabase(file);
  assert.equal((await getMigrationStatus(runtime)).pending.length, 0);
  await runtime.close();
  t.mock.restoreAll();
  assert.deepEqual(readFileSync(file), before);

  const inspector = await openDatabaseClient(file, { readOnly: true, requireExisting: true });
  try {
    await assert.rejects(inspector.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ["9999_forbidden", "now"]), /readonly|read-only/i);
  } finally {
    await inspector.close();
  }
  const result = cli("scripts/db-status.js", { DATABASE_FILE: file });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(readFileSync(file), before);
});

test("bootstrap closes its client and rolls back failed migrations before propagating failure", async (t) => {
  const file = localFile(t);
  let closed = 0;
  const close = SqliteDatabaseClient.prototype.close;
  t.mock.method(SqliteDatabaseClient.prototype, "close", function () {
    closed += 1;
    return close.call(this);
  });
  await assert.rejects(createDatabase(file, {
    migrations: [{
      id: "0001_failure_fixture",
      async up(tx) {
        await tx.exec("CREATE TABLE should_rollback (id TEXT)");
        throw new Error("fixture failure");
      }
    }]
  }), /fixture failure/);
  assert.equal(closed, 1);
  t.mock.restoreAll();
  const inspector = await openDatabaseClient(file, { readOnly: true });
  try {
    assert.deepEqual(await inspector.all("SELECT name FROM sqlite_master WHERE type='table'"), []);
  } finally {
    await inspector.close();
  }
});

test("deployed migrations require an explicit job URL, while runtime ignores migration credentials", () => {
  for (const NODE_ENV of ["staging", "stage", "production", "prod"]) {
    assert.throws(() => loadMigrationConfig({ NODE_ENV, DATABASE_URL: "postgresql://app:app-only@localhost/application" }), { code: "MIGRATION_DATABASE_REQUIRED" });
  }
  const env = {
    NODE_ENV: "staging",
    DATABASE_URL: "postgresql://app:app-only@localhost/application",
    MIGRATION_DATABASE_URL: "postgresql://migrator:job-only@localhost/application",
    MIGRATION_DATABASE_SSL: "disable"
  };
  assert.equal(loadConfig(env).database.databaseUrl, env.DATABASE_URL);
  assert.equal(loadMigrationConfig(env).database.databaseUrl, env.MIGRATION_DATABASE_URL);
  assert.equal(loadMigrationConfig(env).database.maxConnections, 1);
  assert.equal(loadMigrationConfig(env).database.ssl, false);
  assert.equal(loadConfig(env).database.ssl, true);
  assert.equal(loadMigrationConfig({ DATABASE_FILE: "local.db" }).database.databaseFile, "local.db");
  assert.equal(loadMigrationConfig({ DATABASE_URL: env.DATABASE_URL }).database.databaseUrl, env.DATABASE_URL);
  for (const url of ["mongo://localhost/app", "postgresql://localhost/", "not a url"]) {
    assert.throws(() => loadMigrationConfig({ MIGRATION_DATABASE_URL: url }), { code: "MIGRATION_DATABASE_INVALID" });
  }
});

test("migration CLI initializes local data explicitly and refuses missing deployed job credentials", async (t) => {
  const file = localFile(t);
  const migrate = cli("scripts/db-migrate.js", { DATABASE_FILE: file });
  assert.equal(migrate.status, 0, migrate.output);
  const runtime = await openRuntimeDatabase(file);
  await runtime.close();
  const missingJob = cli("scripts/db-migrate.js", {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:sentinel-never-print@127.0.0.1:1/application"
  });
  assert.equal(missingJob.status, 1);
  assert.match(missingJob.output, /MIGRATION_DATABASE_REQUIRED/);
  assert.doesNotMatch(missingJob.output, /sentinel-never-print/);
});

test("status, migrate and deployment CLI errors do not print raw URL credentials or driver messages", () => {
  const sentinel = "sentinel-never-print";
  const invalidUrl = "postgresql://operator:" + sentinel + "@[invalid]/db";
  for (const script of ["scripts/db-status.js", "scripts/db-migrate.js", "scripts/verify-deployment.js"]) {
    const result = cli(script, { DATABASE_URL: invalidUrl });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.output, new RegExp(sentinel));
    assert.doesNotMatch(result.output, /postgresql:\/\/operator|Invalid URL|ERR_INVALID_URL|at new /);
    assert.match(result.output, /DATABASE_OPERATION_FAILED|MIGRATION_DATABASE_INVALID|invalid_configuration|DEPLOYMENT_VERIFICATION_FAILED/);
  }
  const safe = describeDatabaseFailure({ code: "sentinel-never-print", message: invalidUrl, stack: invalidUrl });
  assert.equal(safe.code, "DATABASE_OPERATION_FAILED");
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(sentinel));
});

test("deployment verification refuses SQLite without creating or migrating a file", (t) => {
  const file = localFile(t);
  const result = cli("scripts/verify-deployment.js", { DATABASE_FILE: file });
  assert.equal(result.status, 1);
  assert.match(result.output, /must select PostgreSQL/);
  assert.equal(existsSync(file), false);
});

test("normal server refuses uninitialized and future schemas before listening", async (t) => {
  const file = localFile(t);
  const cases = [{ file, code: "DATABASE_FILE_REQUIRED" }];
  writeFileSync(file, "");
  const empty = cli("src/server.js", { DATABASE_FILE: file, LOG_LEVEL: "info" });
  assert.equal(empty.status, 1);
  assert.match(empty.output, /DATABASE_NOT_INITIALIZED/);
  assert.doesNotMatch(empty.output, /boot.listening/);
  const db = await createDatabase(file);
  await db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ["9999_future_release", "now"]);
  await db.close();
  cases[0].file = path.join(path.dirname(file), "missing.db");
  cases.push({ file, code: "MIGRATION_HISTORY_INCOMPATIBLE" });
  for (const entry of cases) {
    const result = cli("src/server.js", { DATABASE_FILE: entry.file, LOG_LEVEL: "info" });
    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(entry.code));
    assert.doesNotMatch(result.output, /boot.listening/);
  }
  assert.equal(existsSync(cases[0].file), false);
});

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function runningServer(t, env) {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    env: { ...safeTestEnvironment(), ...env, PORT: String(port), LOG_LEVEL: "info" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not become ready: " + output)), 10000);
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.includes("boot.listening")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!output.includes("boot.listening")) reject(new Error("Server exited " + code + ": " + output));
    });
  });
  return "http://127.0.0.1:" + port;
}

test("only the validated disposable memory harness bootstraps during server startup", async (t) => {
  const refused = cli("src/server.js", { DATABASE_FILE: ":memory:", ISOLATED_E2E_HARNESS: "false" });
  assert.equal(refused.status, 1);
  assert.match(refused.output, /DATABASE_FILE_REQUIRED/);
  const base = await runningServer(t, { DATABASE_FILE: ":memory:", ISOLATED_E2E_HARNESS: "1" });
  const ready = await fetch(base + "/api/health/ready").then((response) => response.json());
  assert.equal(ready.status, "ready");
  const health = await fetch(base + "/api/health").then((response) => response.json());
  assert.equal(health.test_harness.kind, "isolated-e2e");
});

test("existing runtime readiness is read-only and reports incompatible history", async (t) => {
  const file = localFile(t, "runtime.db", false);
  const db = await createDatabase(file);
  await db.close();
  let base;
  try {
    base = await runningServer(t, { DATABASE_FILE: file });
  } finally {
    // Stop the owned server before deleting its file on Windows.
    t.after(() => rmSync(path.dirname(file), { recursive: true, force: true }));
  }
  let response = await fetch(base + "/api/health/ready");
  assert.equal(response.status, 200);
  const edit = await openDatabaseClient(file);
  await edit.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", ["9999_newer_release", "now"]);
  await edit.close();
  const before = readFileSync(file);
  response = await fetch(base + "/api/health/ready");
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "schema_incompatible");
  assert.equal(body.migrations.compatible, false);
  assert.deepEqual(readFileSync(file), before);
});

const pgContext = postgresTestContext();
test("PostgreSQL runtime and deployment inspection pass with transactions forced read-only", { skip: !pgContext }, async (t) => {
  const schema = schemaFor(pgContext.runId, "adapter");
  const admin = await connectTestAdmin(pgContext);
  t.after(async () => {
    await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await admin.close();
  });
  await admin.exec('CREATE SCHEMA "' + schema + '"');
  const config = schemaDatabaseConfig(pgContext, schema);
  const bootstrap = await createDatabase(config);
  await bootstrap.close();
  const readonly = { ...config, readOnlyTransaction: true };
  const runtime = await openRuntimeDatabase(readonly);
  assert.equal((await runtime.get("SHOW transaction_read_only")).transaction_read_only, "on");
  const status = await verifyDeploymentDatabase(runtime);
  assert.equal(status.compatible, true);
  assert.deepEqual(status.pending, []);
  await runtime.close();
  // A plaintext disposable test proves read-only catalog behavior, not deployed TLS.
  // The deployed CLI must refuse plaintext even when schema tests use it locally.
  if (!config.ssl) {
    const result = cli("scripts/verify-deployment.js", {
      NODE_ENV: "staging", DATABASE_URL: readonly.databaseUrl, DATABASE_SSL: "disable",
      PUBLIC_APP_ORIGIN: "https://app.example.test", AUTH_RATE_LIMIT_SECRET: "synthetic-test-only-auth-secret-at-least-32-bytes",
      MIGRATION_DATABASE_URL: "invalid-deliberately-unused"
    });
    assert.equal(result.status, 1);
    assert.match(result.output, /verified PostgreSQL TLS/);
  }
});
