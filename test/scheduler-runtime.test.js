import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/database/database.js";
import { safeTestEnvironment } from "../scripts/helpers/testSafety.js";

async function eventually(work, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await work(); if (value) return value; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw last || new Error("The isolated runtime did not reach the expected state.");
}
async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("normal server ticks honor persisted pause across restart and advance a due sequence without test controls", { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "l106-runtime-"));
  const file = path.join(directory, "runtime.db"), port = await availablePort(), base = "http://127.0.0.1:" + port;
  const initial = await createDatabase(file); await initial.close();
  let child = null, logs = "", cookie = "";
  const env = { ...safeTestEnvironment(), DATABASE_FILE: file, PORT: String(port),
    ENABLE_TEST_CONTROLS: "false", WORKER_ENABLED: "true", WORKER_INTERVAL_MS: "20", LOG_LEVEL: "info", LOG_FORMAT: "json" };
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const current = child;
    await new Promise((resolve) => { current.once("exit", resolve); current.kill("SIGTERM"); });
  }
  t.after(async () => {
    await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("l106-runtime-"));
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    logs = "";
    child = spawn(process.execPath, ["src/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
    child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
    await eventually(async () => {
      if (child.exitCode !== null) throw new Error("Owned test server exited: " + logs);
      const response = await fetch(base + "/api/health/ready");
      return response.ok;
    });
  }
  async function request(route, body) {
    const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const result = await response.json();
    assert.ok(response.ok, route + ": " + JSON.stringify(result));
    return result;
  }

  await start();
  await request("/api/auth/register", { organization_name: "Runtime scheduling", name: "Runtime owner",
    email: "runtime-owner@example.test", password: "correct-horse-battery-staple" });
  const me = await request("/api/auth/me");
  assert.equal(me.capabilities.test_controls, false);
  const { lead } = await request("/api/leads", { name: "Runtime lead", email: "runtime-lead@example.test", company: "Runtime" });
  const { campaign } = await request("/api/campaigns", { name: "Runtime campaign" });
  const { sequence } = await request("/api/sequences", { campaign_id: campaign.id, name: "Runtime follow-up",
    steps: [{ type: "WAIT", title: "Wait briefly", delay_hours: 0.00003 }, { type: "SEND_EMAIL", title: "Reviewed follow-up", body: "Please review this message." }] });
  const enrolled = await request("/api/sequences/" + sequence.id + "/enroll", { lead_ids: [lead.id], scheduled_at: new Date(Date.now() + 300).toISOString() });
  const run = enrolled.workflow_runs[0];
  const paused = await request("/api/workflow-runs/" + run.id + "/control", { expected_revision: run.revision, command: "PAUSE", reason: "Owner paused before scheduled time." });
  await new Promise((resolve) => setTimeout(resolve, 500));
  let current = (await request("/api/workflow-runs")).workflow_runs.find((item) => item.id === run.id);
  assert.ok(current.paused_at);
  assert.equal(current.last_action_id, null);
  await stop();
  await start();
  current = (await request("/api/workflow-runs")).workflow_runs.find((item) => item.id === run.id);
  assert.equal(current.paused_at, paused.workflow_run.paused_at);
  await request("/api/workflow-runs/" + run.id + "/control", { expected_revision: current.revision, command: "RESUME", reason: "Owner resumed the persisted schedule." });
  current = await eventually(async () => {
    const row = (await request("/api/workflow-runs")).workflow_runs.find((item) => item.id === run.id);
    return row.status === "WAITING_APPROVAL" ? row : null;
  });
  assert.ok(current.last_action_id);
  const action = await request("/api/actions/" + current.last_action_id + "/approval");
  assert.equal(action.action.status, "AWAITING_APPROVAL");
  assert.equal((await fetch(base + "/api/worker/run", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" })).status, 404);
  assert.equal(logs.includes("worker.tick_failed"), false, logs);
});
