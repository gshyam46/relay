import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { safeTestEnvironment, assertNoLiveProviders } from "../scripts/helpers/testSafety.js";

async function eventually(work, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const result = await work(); if (result) return result; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw last || new Error("Owned normal server did not reach the expected persisted state.");
}
async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
test("normal server restart recovers an asynchronous analysis job and scheduler completes it without test controls", { timeout: 45000 }, async t => {
  const temporaryRoot = path.resolve(os.tmpdir()), directory = await mkdtemp(path.join(temporaryRoot, "l303-analysis-runtime-"));
  const verifyOwnedDirectory = () => {
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith("l303-analysis-runtime-"));
  };
  verifyOwnedDirectory();
  const file = path.join(directory, "runtime.db"), port = await availablePort(), base = "http://127.0.0.1:" + port;
  assert.equal(path.dirname(path.resolve(file)), path.resolve(directory));
  const initialized = await createDatabase(file); await initialized.close();
  const environment = { ...safeTestEnvironment(), DATABASE_FILE: file, PORT: String(port),
    ENABLE_TEST_CONTROLS: "false", OUTBOUND_DISPATCH_ENABLED: "false", WORKER_INTERVAL_MS: "40", LOG_LEVEL: "debug", LOG_FORMAT: "json" };
  assertNoLiveProviders(environment);
  assert.equal(environment.DATABASE_URL, undefined);
  let child = null, logs = "", cookie = "";
  async function stop() {
    const owned = child;
    if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { owned.kill("SIGKILL"); reject(new Error("Owned runtime did not stop within its test deadline.")); }, 8000);
      owned.once("exit", () => { clearTimeout(timeout); resolve(); });
      owned.kill("SIGTERM");
    });
  }
  t.after(async () => {
    await stop();
    verifyOwnedDirectory();
    await rm(directory, { recursive: true, force: true });
  });
  async function start(workerEnabled) {
    child = spawn(process.execPath, ["src/server.js"], { env: { ...environment, WORKER_ENABLED: String(workerEnabled) },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let spawnError = null;
    child.once("error", error => { spawnError = error; });
    const collect = chunk => { logs += chunk.toString(); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    await eventually(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Owned normal runtime exited: " + logs);
      return (await fetch(base + "/api/health/ready", { signal: AbortSignal.timeout(2000) })).ok;
    });
  }
  async function request(route, body, expectedStatus = 200) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const value = await response.json();
    assert.equal(response.status, expectedStatus, route + ": " + JSON.stringify(value));
    return value;
  }

  await start(false);
  const registered = await request("/api/auth/register", { organization_name: "Synthetic normal analysis runtime", name: "Synthetic owner",
    email: "runtime-owner@example.test", password: "correct-horse-battery-staple" }, 201);
  const org = registered.organization.id;
  assert.equal((await request("/api/auth/me")).capabilities.test_controls, false);
  const { lead } = await request("/api/leads", { organization_id: org, name: "Synthetic queued enquiry", company: "Synthetic company", email: "runtime-lead@example.test" }, 201);
  const command = { organization_id: org, request_key: "normal-server-restart", lead_ids: [lead.id], mode: "ANALYSIS_ONLY", target_stage: "PLAN" };
  const accepted = await request("/api/intelligence/jobs", command, 202);
  assert.equal(accepted.job.status, "QUEUED");
  assert.equal(accepted.job.items[0].attempts, 0);
  for (let i = 0; i < 3; i++) {
    const current = (await request("/api/intelligence/jobs/" + accepted.job.id)).job;
    assert.equal(current.status, "QUEUED"); assert.equal(current.items[0].attempts, 0);
  }
  assert.equal((await request("/api/intelligence/jobs")).total, 1);

  await stop();
  await start(true);
  assert.equal((await request("/api/auth/me")).capabilities.test_controls, false);
  const recovered = await request("/api/intelligence/jobs?request_key=" + encodeURIComponent(command.request_key));
  assert.equal(recovered.jobs.length, 1); assert.equal(recovered.jobs[0].id, accepted.job.id);
  const completed = await eventually(async () => {
    const job = (await request("/api/intelligence/jobs/" + accepted.job.id)).job;
    return job.status === "COMPLETED" ? job : null;
  });
  assert.equal(completed.counts.completed, 1);
  assert.equal(completed.items[0].attempts, 1);
  for (const key of ["snapshot_id", "synthesis_id", "recommendation_id", "plan_id"]) assert.ok(completed.items[0].artifacts[key]);
  assert.equal(completed.items[0].artifacts.action_id, null);
  for (let i = 0; i < 3; i++) assert.equal((await request("/api/intelligence/jobs/" + accepted.job.id)).job.id, accepted.job.id);
  assert.equal((await request("/api/intelligence/jobs")).total, 1, "GET recovery never creates additional work");
  const usage = await request("/api/ai/usage"); assert.equal(usage.summary.admitted_attempts, 0);
  await stop();

  const recorded = await openDatabaseClient(file, { readOnly: true, requireExisting: true });
  try {
    assert.equal(Number((await recorded.get("SELECT count(*) AS n FROM analysis_jobs")).n), 1);
    assert.equal(Number((await recorded.get("SELECT count(*) AS n FROM ai_provider_attempts")).n), 0);
    const executions = await recorded.all("SELECT a.type,a.idempotency_key FROM action_executions x JOIN actions a ON a.id=x.action_id WHERE a.organization_id=?", [org]);
    assert.equal(executions.filter(item => item.type.startsWith("SEND_")).length, 0);
    assert.ok(executions.every(item => item.type === "CREATE_HUMAN_TASK" && item.idempotency_key === "lead:" + lead.id + ":initial-next-best-action"));
    assert.equal(Number((await recorded.get("SELECT count(*) AS n FROM actions WHERE organization_id=? AND next_best_action_plan_id=?", [org, completed.items[0].artifacts.plan_id])).n), 0);
    t.diagnostic("Normal capture produced " + executions.length + " initial human-task execution(s); the analysis-only job produced no action or external send.");
    const event = await recorded.get("SELECT status,attempts FROM domain_events WHERE id=?", [completed.items[0].event_id]);
    assert.equal(event.status, "PROCESSED"); assert.equal(event.attempts, 1);
  } finally { await recorded.close(); }
  assert.ok(logs.includes("ai.provider_missing"), "normal runtime confirms deterministic configuration");
  assert.ok(logs.includes("worker.tick_completed"), "normal scheduler, rather than a service pump, performed work");
  assert.equal(logs.includes("worker.tick_failed"), false, logs);
  assert.equal(logs.includes("process.uncaught_exception"), false, logs);
});
