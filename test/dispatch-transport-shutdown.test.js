import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfter, providerRequest } from "../src/modules/handlers/providerRequest.js";
import { drainApplication } from "../src/shared/shutdown.js";

const at = Date.parse("2026-09-11T10:00:00.000Z");

test("Retry-After supports seconds and HTTP dates without shortening large valid waits", () => {
  assert.equal(parseRetryAfter("120", at), 120000);
  assert.equal(parseRetryAfter("Fri, 11 Sep 2026 10:02:00 GMT", at), 120000);
  assert.equal(parseRetryAfter("Fri, 11 Sep 2026 09:59:00 GMT", at), 0);
  assert.equal(parseRetryAfter("999999999999999999999", at), 86400000);
  for (const value of [null, "", "-1", "2.5", "tomorrow", "123abc", "2026-09-11", "x".repeat(129)]) {
    assert.equal(parseRetryAfter(value, at), null, String(value));
  }
});

test("transport exposes bounded retry hints without reading sensitive error bodies", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let options;
  globalThis.fetch = async (_url, captured) => {
    options = captured;
    return { ok: false, status: 429, headers: new Headers({ "retry-after": "90" }),
      async text() { throw new Error("sensitive body must not be read"); } };
  };
  const response = await providerRequest("https://synthetic.invalid/send", { method: "POST" }, "Provider");
  assert.equal(response.retryable, true);
  assert.equal(response.uncertain, false);
  assert.equal(response.retry_after_ms, 90000);
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.doesNotMatch(JSON.stringify(response), /sensitive/);
});

test("transport holds timeouts and 5xx while distinguishing permanent rejection", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const status of [408, 500, 503]) {
    globalThis.fetch = async () => ({ ok: false, status });
    const response = await providerRequest("https://synthetic.invalid/send", {}, "Provider");
    assert.equal(response.uncertain, true);
    assert.equal(response.retryable, false);
  }
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  assert.equal((await providerRequest("https://synthetic.invalid/send", {}, "Provider")).retryable, false);
  globalThis.fetch = async () => { throw new Error("secret-key"); };
  const response = await providerRequest("https://synthetic.invalid/send", {}, "Provider");
  assert.equal(response.uncertain, true);
  assert.doesNotMatch(JSON.stringify(response), /secret-key/);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("shutdown stops admission and waits for provider, worker and background work before closing database", async () => {
  const calls = [];
  const workerDone = deferred();
  const providerDone = deferred();
  const tickDone = deferred();
  const task = drainApplication({
    server: { close(done) { calls.push("server-close"); done(); }, closeIdleConnections() {} },
    worker: { stop() { calls.push("worker-stop"); }, drain() { return workerDone.promise; } },
    executor: { stopAccepting() { calls.push("dispatch-stop"); }, drain() { return providerDone.promise; } },
    db: { async close() { calls.push("db-close"); } },
    backgroundWork: tickDone.promise, timeoutMs: 1000
  });
  assert.deepEqual(calls, ["dispatch-stop", "worker-stop", "server-close"]);
  workerDone.resolve();
  providerDone.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes("db-close"), false);
  tickDone.resolve();
  await task;
  assert.equal(calls.at(-1), "db-close");
});

test("shutdown timeout leaves database available to in-flight work and reports a recovery-safe failure", async () => {
  const held = deferred();
  let closed = false;
  const task = drainApplication({
    server: { close(done) { done(); } },
    worker: { stop() {}, drain() { return held.promise; } },
    executor: { stopAccepting() {}, async drain() {} },
    db: { async close() { closed = true; } }, timeoutMs: 5
  });
  await assert.rejects(task, { code: "SHUTDOWN_TIMEOUT" });
  assert.equal(closed, false);
  held.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});
