import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { loadConfig } from "../src/config.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  const config = loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: "true", WORKER_ENABLED: "false" }); config.http.bodyTimeout = 100;
  const server = createApp({ db, config });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await db.close(); });
  const url = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(url + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organization_name: "Synthetic body review", name: "Owner", email: "body-review@example.test", password: "synthetic-passphrase" }) });
  assert.equal(response.status, 201); const registration = await response.json(), cookie = response.headers.get("set-cookie").split(";")[0];
  const calls = []; server.services.worker.runOnce = async (input) => { calls.push(input); return { visited_workspaces: 0 }; };
  return { server, url, cookie, calls, org: registration.organization.id };
}
function unfinished(f, headers, write = () => {}) {
  let request;
  const result = new Promise((resolve, reject) => {
    request = http.request(f.url + "/api/worker/run", { method: "POST", headers: { cookie: f.cookie, ...headers } }, (response) => {
      let body = ""; response.on("data", (chunk) => { body += chunk.toString(); }); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on("error", reject);
    });
    request.on("error", reject); request.flushHeaders(); write(request);
  });
  return { result, close: () => request.destroy() };
}

test("worker run consumes empty or small ignored bodies and keeps workspace scope session-derived", async (t) => {
  const f = await fixture(t);
  const empty = await fetch(f.url + "/api/worker/run", { method: "POST", headers: { cookie: f.cookie } });
  assert.equal(empty.status, 200); await empty.arrayBuffer();
  const small = await fetch(f.url + "/api/worker/run", { method: "POST", headers: { cookie: f.cookie, "content-type": "text/plain" }, body: "previously ignored small input" });
  assert.equal(small.status, 200); await small.arrayBuffer();
  const spoofed = await fetch(f.url + "/api/worker/run", { method: "POST", headers: { cookie: f.cookie, "content-type": "application/json" }, body: JSON.stringify({ organization_id: "foreign-workspace" }) });
  assert.equal(spoofed.status, 200); await spoofed.arrayBuffer();
  assert.deepEqual(f.calls, Array.from({ length: 3 }, () => ({ organization_id: f.org })));
  assert.equal(f.server.httpPolicy.inFlight, 0);
});

test("worker run rejects declared and chunked oversized bodies before invoking worker", async (t) => {
  const f = await fixture(t);
  for (const mode of ["declared", "chunked"]) {
    const pending = unfinished(f, mode === "declared" ? { "content-length": String(1024 * 1024 + 1) } : { "transfer-encoding": "chunked" },
      mode === "declared" ? () => {} : (request) => request.end(Buffer.alloc(1024 * 1024 + 1, 120)));
    t.after(pending.close);
    const result = await pending.result;
    assert.equal(result.status, 413, mode); assert.equal(result.headers.connection, "close");
    assert.equal(f.calls.length, 0); assert.equal(f.server.httpPolicy.inFlight, 0);
  }
});

test("worker run waits for complete input and stalled input times out without worker effects", async (t) => {
  const f = await fixture(t);
  const pending = unfinished(f, { "content-length": "100" }, (request) => request.write("{}")); t.after(pending.close);
  const result = await pending.result;
  assert.equal(result.status, 408); assert.equal(result.headers.connection, "close"); assert.equal(f.calls.length, 0);
  assert.equal(f.server.httpPolicy.inFlight, 0);
  const retry = await fetch(f.url + "/api/worker/run", { method: "POST", headers: { cookie: f.cookie } });
  assert.equal(retry.status, 200); await retry.arrayBuffer(); assert.equal(f.calls.length, 1);
});
