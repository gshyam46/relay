import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/shared/logger.js";
import { drainApplication } from "../src/shared/shutdown.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  const config = loadConfig({ NODE_ENV: "test", WORKER_ENABLED: "false" });
  config.http.maxInFlight = 1;
  const server = createApp({ db, config });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); });
  return { db, server, url: "http://127.0.0.1:" + server.address().port };
}
async function eventually(predicate) {
  const until = Date.now() + 2000;
  while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), "expected bounded asynchronous completion");
}

test("disconnecting a slow readiness request cannot free its active handler admission slot", async t => {
  const f = await fixture(t);
  let unblock, entered;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const get = f.db.get.bind(f.db);
  let calls = 0;
  f.db.get = async (...args) => {
    calls++;
    if (calls === 1) { entered(); await barrier; }
    return get(...args);
  };
  const first = http.get(f.url + "/api/health/ready");
  first.on("error", () => {});
  try {
    await started;
    const closed = new Promise(resolve => first.once("close", resolve));
    first.destroy();
    await closed;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await fetch(f.url + "/api/health/live")).status, 200);
    const second = await fetch(f.url + "/api/health/ready");
    assert.equal(second.status, 503, "the abandoned handler still owns its admission slot until its DB operation settles");
    assert.equal(second.headers.get("retry-after"), "1");
    assert.equal(calls, 1, "rejected replacement requests cannot start additional DB work");
  } finally {
    unblock(); first.destroy();
    await eventually(() => f.server.httpPolicy.inFlight === 0);
    f.db.get = get;
  }
  assert.equal((await fetch(f.url + "/api/health/ready")).status, 200);
});

test("unsupported public static mutations close unread input instead of serving the SPA", async t => {
  const f = await fixture(t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const request = http.request(f.url + "/unsupported-public-mutation", {
      method, headers: { "content-type": "text/plain", "content-length": "10000000" }
    });
    request.on("error", () => {});
    try {
      const received = once(request, "response");
      request.write("partial unread body");
      const [response] = await received;
      const chunks = []; for await (const chunk of response) chunks.push(chunk);
      assert.equal(response.statusCode, 405, method + " must be rejected before static file access or background body draining");
      assert.equal(response.headers.connection, "close");
      assert.equal(JSON.parse(Buffer.concat(chunks)).code, "request_failed");
    } finally { request.destroy(); }
  }
  await eventually(() => f.server.httpPolicy.inFlight === 0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM organizations")).n, 0);
});

test("logging camelCase sensitive fields and non-string URLs never exposes values or invokes coercion getters", () => {
  const records = [];
  const logger = createLogger({ write: (_level, record) => records.push(record) });
  let getters = 0;
  const url = { get toString() { getters++; return () => "https://synthetic.example.test"; } };
  logger.info("review.synthetic", { url, count: 2, nested: {
    rawBody: "synthetic-body", responseBody: "synthetic-response", publicMessage: "synthetic-message",
    toEmail: "synthetic-address", recipientAddress: "synthetic-recipient", requestHeaders: { value: "synthetic-header" }
  } });
  assert.equal(getters, 0, "logging cannot execute a value's URL coercion getter");
  assert.equal(records[0].count, 2);
  for (const value of ["synthetic-body", "synthetic-response", "synthetic-message", "synthetic-address", "synthetic-recipient", "synthetic-header"]) {
    assert.equal(JSON.stringify(records).includes(value), false, value);
  }
});

test("shutdown waits for disconnected handler work before closing its database", async t => {
  const f = await fixture(t);
  let unblock, entered;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const get = f.db.get.bind(f.db), close = f.db.close.bind(f.db);
  let databaseClosed = false, handlerReadCompleted = false;
  f.db.get = async (...args) => {
    entered(); await barrier;
    try { return await get(...args); } finally { handlerReadCompleted = true; }
  };
  f.db.close = async () => { databaseClosed = true; return close(); };
  const request = http.get(f.url + "/api/health/ready");
  request.on("error", () => {});
  await started;
  const socketClosed = new Promise(resolve => request.once("close", resolve));
  request.destroy(); await socketClosed;
  let shutdownSettled = false;
  const shutdown = drainApplication({ server: f.server, db: f.db, worker: f.server.services.worker,
    executor: f.server.services.actionExecutor, webhookInbox: f.server.services.webhookInbox, timeoutMs: 2000 });
  shutdown.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(handlerReadCompleted, false);
    assert.equal(databaseClosed, false, "a disconnected request can still need its database");
    assert.equal(shutdownSettled, false, "socket close is not handler completion");
  } finally {
    unblock(); request.destroy();
    await shutdown;
    await eventually(() => handlerReadCompleted);
  }
  assert.equal(databaseClosed, true);
  assert.equal(f.server.httpPolicy.inFlight, 0);
});
