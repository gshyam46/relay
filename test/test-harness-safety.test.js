import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { isLlmConfigured } from "../src/modules/ai/llmProvider.js";
import { cleanupRunSchemas, e2eEnvironment, isOwnedSchema, newTestRunId, postgresTestContext, postgresTestTarget, safeTestEnvironment, schemaDatabaseConfig, schemaFor, schemaPrefix, verifyE2eHandshake, workflowVerificationTarget } from "../scripts/helpers/testSafety.js";
import { runTestProcess } from "../scripts/helpers/runTestProcess.js";

const TEST_URL = "postgresql://test-user:secret-do-not-print@127.0.0.1:5432/relay_test";
const pgEnv = { TEST_DATABASE_URL: TEST_URL, TEST_DATABASE_DISPOSABLE: "1", TEST_DATABASE_SSL: "disable" };

test("harness: normal test child removes inherited databases, providers, proxies and Node preloads", async () => {
  const hostile = {
    ...process.env,
    NODE_ENV: "production", DATABASE_URL: TEST_URL, DATABASE_FILE: "data/customer.db",
    TEST_DATABASE_URL: TEST_URL, TEST_DATABASE_DISPOSABLE: "1", RELAY_TEST_PG: "1",
    GROQ_API_KEY: "secret-provider", LLM_PROVIDER: "ollama", HTTPS_PROXY: "http://proxy.invalid",
    NODE_OPTIONS: "--import=hostile-preload.mjs", UNKNOWN_FUTURE_PROVIDER_KEY: "secret"
  };
  const safe = safeTestEnvironment(hostile);
  assert.equal(safe.NODE_ENV, "test");
  assert.equal(safe.DATABASE_FILE, ":memory:");
  assert.equal(safe.WORKER_ENABLED, "false");
  assert.equal(safe.ENABLE_TEST_CONTROLS, "true");
  for (const key of ["DATABASE_URL", "TEST_DATABASE_URL", "RELAY_TEST_PG", "GROQ_API_KEY", "LLM_PROVIDER", "HTTPS_PROXY", "NODE_OPTIONS", "UNKNOWN_FUTURE_PROVIDER_KEY"]) {
    assert.equal(safe[key], undefined, key);
  }
  const config = loadConfig(safe);
  assert.equal(config.database.driver, "sqlite");
  assert.equal(config.isProductionLike, false);
  assert.equal(config.worker.enabled, false);

  // Exercise the actual wrapper in a child. This file contains no app work or
  // network calls, and verifies what the test process really receives.
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-harness-proof-"));
  try {
    const fixture = path.join(dir, "env-proof.mjs");
    await writeFile(fixture, 'import assert from "node:assert/strict"; assert.equal(process.env.DATABASE_URL, undefined); assert.equal(process.env.LLM_PROVIDER, undefined); assert.equal(process.env.GROQ_API_KEY, undefined); assert.equal(process.env.TEST_DATABASE_URL, undefined); assert.equal(process.env.NODE_ENV, "test");');
    // NODE_OPTIONS is already consumed by Node before a script starts, so do
    // not execute an arbitrary preload in the wrapper process itself.
    delete hostile.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ["scripts/run-tests.js", fixture], { env: hostile, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-provider|secret-do-not-print/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("harness: E2E effective target is fresh SQLite with disabled external AI and automatic worker", () => {
  const env = e2eEnvironment({ E2E_PORT: "3211", WORKER_ENABLED: "true", DATABASE_FILE: ":memory:" });
  const config = loadConfig(env);
  assert.equal(config.port, 3211);
  assert.equal(config.database.databaseFile, ":memory:");
  assert.equal(config.worker.enabled, false);
  assert.equal(env.LLM_PROVIDER, undefined);
  // This suite's own wrapper already removed providers; no model is invoked.
  assert.equal(isLlmConfigured(), false);
});

test("harness: E2E refuses unsafe inherited targets and provider configuration without revealing values", () => {
  for (const hostile of [
    { DATABASE_URL: TEST_URL }, { NODE_ENV: "production" }, { NODE_ENV: "stage" },
    { E2E_DATABASE_FILE: "data/customer.db" }, { DATABASE_FILE: "data/app.db" },
    { GROQ_API_KEY: "secret-provider" }, { LLM_PROVIDER: "ollama" }, { SENDGRID_API_KEY: "secret-mail" },
    { E2E_PORT: "65536" }, { E2E_PORT: "not-a-port" }
  ]) {
    assert.throws(() => e2eEnvironment(hostile), (error) => {
      assert.doesNotMatch(error.message, /secret-|customer.db|app.db/);
      return true;
    });
  }
  const result = spawnSync(process.execPath, ["scripts/dev-e2e.js"], {
    env: { ...safeTestEnvironment(), DATABASE_URL: TEST_URL }, encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refused/);
  assert.doesNotMatch(result.stderr + result.stdout, /secret-do-not-print/);
});

test("harness: PostgreSQL requires separate explicit disposable target, not DATABASE_URL fallback", () => {
  assert.throws(() => postgresTestTarget({ DATABASE_URL: TEST_URL }), /TEST_DATABASE_URL is required/);
  assert.throws(() => postgresTestTarget({ TEST_DATABASE_URL: TEST_URL }), /TEST_DATABASE_DISPOSABLE=1/);
  assert.throws(() => postgresTestTarget({ ...pgEnv, DATABASE_URL: TEST_URL.replace("test-user:secret-do-not-print", "application:different-password") }), /application database/);
  assert.throws(() => postgresTestTarget({ ...pgEnv, TEST_DATABASE_URL: "not-a-url-secret" }), /redacted/);
  assert.throws(() => postgresTestTarget({ ...pgEnv, TEST_DATABASE_URL: "https://example.invalid/db" }), /PostgreSQL host/);
  assert.throws(() => postgresTestTarget({ ...pgEnv, TEST_DATABASE_URL: TEST_URL + "?options=-c%20search_path=public" }), /overrides are refused/);
  assert.throws(() => postgresTestTarget({ ...pgEnv, TEST_DATABASE_SSL: "invalid" }), /enable or disable/);
  const target = postgresTestTarget(pgEnv);
  assert.equal(target.ssl, false);
  assert.match(target.description, /relay_test/);
  assert.doesNotMatch(target.description, /test-user|secret-do-not-print/);
  assert.equal(postgresTestTarget({ ...pgEnv, TEST_DATABASE_SSL: undefined, DATABASE_SSL: "disable" }).ssl, true);
});

test("harness: unsafe PG runner exits before connection and keeps credentials out of output", () => {
  for (const extras of [{ DATABASE_URL: TEST_URL }, { TEST_DATABASE_URL: TEST_URL }]) {
    const result = spawnSync(process.execPath, ["scripts/run-postgres-tests.js"], {
      env: { ...safeTestEnvironment(), ...extras }, encoding: "utf8", timeout: 10000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TEST_DATABASE_URL|TEST_DATABASE_DISPOSABLE/);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-do-not-print|test-user|ECONN/);
  }
});

test("harness: adapter tests cannot activate from application or test URL alone", () => {
  assert.equal(postgresTestContext({ DATABASE_URL: TEST_URL }), null);
  assert.equal(postgresTestContext(pgEnv), null);
  assert.throws(() => postgresTestContext({ ...pgEnv, RELAY_TEST_PG: "1" }), /runner-owned namespace/);
  const context = postgresTestContext({ ...pgEnv, RELAY_TEST_PG: "1", RELAY_TEST_RUN_ID: newTestRunId() });
  assert.ok(context.runId);
});

test("harness: concurrent runs never share restart schemas; same-run restarts preserve their schema", () => {
  const first = newTestRunId();
  const second = newTestRunId();
  const file = "same-fixture-path.db";
  const a = schemaFor(first, "file", file);
  const b = schemaFor(second, "file", file);
  assert.notEqual(a, b);
  assert.equal(a, schemaFor(first, "file", file));
  assert.notEqual(schemaFor(first, "mem"), schemaFor(first, "mem"));
  assert.ok(a.length <= 63);
  assert.equal(isOwnedSchema(a, first), true);
  assert.equal(isOwnedSchema(a, second), false);
  assert.throws(() => schemaPrefix('public; DROP SCHEMA public;'), /runner-owned/);
  assert.throws(() => schemaDatabaseConfig({ ...postgresTestTarget(pgEnv), runId: first }, b), /outside this test run/);
});

test("harness: cleanup removes only valid schemas owned by that run, even beside active or orphaned runs", async () => {
  const first = { ...postgresTestTarget(pgEnv), runId: newTestRunId() };
  const second = { ...postgresTestTarget(pgEnv), runId: newTestRunId() };
  const owned = [schemaFor(first.runId, "mem"), schemaFor(first.runId, "file", "fixture")];
  const foreign = ["public", schemaFor(second.runId, "file", "fixture"), "relay_mem_legacy_orphan", schemaPrefix(first.runId) + 'adapter_bad"; DROP SCHEMA public;--'];
  const dropped = [];
  let closed = 0;
  const count = await cleanupRunSchemas(first, async () => ({
    async all(sql, params) {
      assert.doesNotMatch(sql, /LIKE|relay_mem/);
      assert.deepEqual(params, [schemaPrefix(first.runId).length, schemaPrefix(first.runId)]);
      return [...owned, ...foreign].map((schema_name) => ({ schema_name }));
    },
    async exec(sql) { dropped.push(sql); },
    async close() { closed += 1; }
  }));
  assert.equal(count, owned.length);
  assert.deepEqual(dropped, owned.map((schema) => 'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'));
  assert.equal(closed, 1);
});

function fakeProcess() {
  const signals = new EventEmitter();
  const child = new EventEmitter();
  const kills = [];
  child.kill = (signal) => kills.push(signal);
  const messages = [];
  const log = { error: (text) => messages.push(text), warn: (text) => messages.push(text) };
  return { signals, child, kills, messages, log, spawnChild: () => child };
}

test("harness: cleanup waits for normal child close, preserves test failure, and removes signal listeners", async () => {
  const fake = fakeProcess();
  let cleaned = 0;
  const result = runTestProcess({ ...fake, args: ["--test"], env: {}, cleanup: async () => { cleaned += 1; } });
  fake.child.emit("exit", 1, null);
  await Promise.resolve();
  assert.equal(cleaned, 0);
  fake.child.emit("close", 1, null);
  assert.equal(await result, 1);
  assert.equal(cleaned, 1);
  assert.equal(fake.signals.listenerCount("SIGINT"), 0);
});

test("harness: interruption does not race schema deletion with terminating descendants", async () => {
  const fake = fakeProcess();
  let cleaned = false;
  const result = runTestProcess({ ...fake, args: ["--test"], env: {}, cleanup: async () => { cleaned = true; } });
  fake.signals.emit("SIGINT");
  fake.signals.emit("SIGTERM");
  assert.deepEqual(fake.kills, ["SIGINT"]);
  fake.child.emit("close", null, "SIGINT");
  assert.equal(await result, 130);
  assert.equal(cleaned, false);
  assert.match(fake.messages.join(" "), /cleanup skipped/);
});

test("harness: spawn and cleanup failures fail the run without leaking connection errors", async () => {
  const failure = fakeProcess();
  let cleaned = false;
  const started = runTestProcess({ ...failure, args: [], env: {}, cleanup: async () => { cleaned = true; } });
  failure.child.emit("error", new Error(TEST_URL));
  failure.child.emit("close", -2, null);
  assert.equal(await started, 1);
  assert.equal(cleaned, false);
  assert.doesNotMatch(failure.messages.join(" "), /secret-do-not-print/);

  const cleanupFailure = fakeProcess();
  const finished = runTestProcess({ ...cleanupFailure, args: [], env: {}, cleanup: async () => { throw new Error(TEST_URL); } });
  cleanupFailure.child.emit("close", 0, null);
  assert.equal(await finished, 1);
  assert.doesNotMatch(cleanupFailure.messages.join(" "), /secret-do-not-print/);
});

test("harness: workflow verifier refuses remote, credentialed, redirected and non-harness targets", async () => {
  for (const url of ["https://customer.example.test", "http://localhost:3100", "http://127.0.0.1:3100/customer", "http://user:secret@127.0.0.1:3100", "http://127.0.0.1:3100?proxy=remote"]) {
    assert.throws(() => workflowVerificationTarget(url), /loopback HTTP origin/);
  }
  assert.equal(workflowVerificationTarget("http://[::1]:3100"), "http://[::1]:3100");
  let calls = 0;
  await assert.rejects(() => verifyE2eHandshake("http://127.0.0.1:3100", async (url, options) => {
    calls += 1;
    assert.equal(url, "http://127.0.0.1:3100/api/health");
    assert.equal(options.redirect, "error");
    assert.equal(options.method, undefined);
    return { ok: true, async json() { return { status: "ok" }; } };
  }), /without the isolated E2E capability/);
  assert.equal(calls, 1);
  await assert.rejects(() => verifyE2eHandshake("http://127.0.0.1:3100", async () => { throw new Error("redirect"); }), /No workflow writes/);
});

test("harness: workflow capability requires exact disposable database and disabled provider claims", async () => {
  const correct = { kind: "isolated-e2e", database: "sqlite-memory", providers: "disabled" };
  assert.equal(await verifyE2eHandshake("http://127.0.0.1:3100", async () => ({ ok: true, json: async () => ({ test_harness: correct }) })), "http://127.0.0.1:3100");
  for (const incorrect of [{ ...correct, database: "postgres" }, { ...correct, providers: "enabled" }, { ...correct, kind: "development" }]) {
    await assert.rejects(() => verifyE2eHandshake("http://127.0.0.1:3100", async () => ({ ok: true, json: async () => ({ test_harness: incorrect }) })), /without the isolated E2E capability/);
  }
});

test("harness: actual workflow verifier performs no mutation on an ordinary local server", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", product: "AI Lead Intelligence & Outbound Automation" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/verify-workflows.js"], {
        env: { ...safeTestEnvironment(), VERIFY_BASE_URL: "http://127.0.0.1:" + server.address().port },
        stdio: ["ignore", "pipe", "pipe"], timeout: 10000
      });
      let text = "";
      child.stdout.on("data", (chunk) => { text += chunk; });
      child.stderr.on("data", (chunk) => { text += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, text }));
    });
    assert.equal(output.code, 1, output.text);
    assert.match(output.text, /no workflow writes were attempted/);
    assert.deepEqual(requests, [{ method: "GET", path: "/api/health" }]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
