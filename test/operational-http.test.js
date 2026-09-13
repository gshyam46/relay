import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";
import { loadConfig } from "../src/config.js";
import { createLogger, safeRequestPath } from "../src/shared/logger.js";
import { describeError } from "../src/shared/errors.js";

async function fixture(t, configure = () => {}) {
  const db = await createDatabase(":memory:");
  const config = loadConfig({ NODE_ENV: "test", WORKER_ENABLED: "false", PUBLIC_APP_ORIGIN: "http://client.example.test" });
  configure(config);
  const records = [], logger = createLogger({ level: "debug", write: (_level, record) => records.push(record) });
  const server = createApp({ db, config, logger });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); });
  const url = "http://127.0.0.1:" + server.address().port;
  return { db, server, records, url, config,
    post: (path, body, headers = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) };
}
const registration = (email = "owner@example.test") => ({ organization_name: "Synthetic workspace", name: "Owner", email, password: "synthetic-password" });

test("logs redact nested secrets, exceptions and webhook paths without executing getters or changing reserved fields", () => {
  const records = [], logger = createLogger({ level: "debug", write: (_level, record) => records.push(record),
    bindings: { authorization: "Bearer secret-header", level: "forged", event: "forged", time: "forged" } });
  let getterRuns = 0;
  const nested = { secret: "secret-nested", value: 5n };
  nested.self = nested;
  Object.defineProperty(nested, "computed", { enumerable: true, get() { getterRuns++; throw new Error("secret-getter"); } });
  const error = Object.assign(new Error("secret-sql postgres://user:password@host/db"), { code: "ECONNRESET", cause: new Error("secret-cause") });
  logger.child({ cookie: "secret-cookie", request_id: "req_synthetic" }).error("http.request_failed", {
    nested, error, payload: { text: "secret-body" }, path: "/api/webhooks/sendgrid/inbound/secret-routing-token?password=secret-query",
    code: "REQUEST_BODY_TOO_LARGE", level: "forged", count: 3
  });
  const output = JSON.stringify(records);
  for (const privateValue of ["secret-header", "secret-nested", "secret-getter", "secret-sql", "secret-cause", "secret-cookie", "secret-body", "secret-routing-token", "secret-query", "password@"]) assert.equal(output.includes(privateValue), false, privateValue);
  assert.equal(getterRuns, 0);
  assert.equal(records[0].event, "http.request_failed");
  assert.equal(records[0].level, "error");
  assert.equal(records[0].request_id, "req_synthetic");
  assert.equal(records[0].count, 3);
  assert.equal(records[0].error.code, "ECONNRESET");
  assert.equal(records[0].nested.value, "5");
  assert.equal(records[0].nested.self, "[CIRCULAR]");
  assert.equal(records[0].path, "/api/webhooks/sendgrid/inbound/:token");
  assert.equal(safeRequestPath("/api/webhooks/sendgrid/events/settings"), "/api/webhooks/sendgrid/events/:token", "even token matching a route literal is redacted");
  assert.doesNotThrow(() => logger.warn("test.proxy", new Proxy({}, { ownKeys() { throw Error("secret-proxy"); } })));
});

test("unexpected errors cannot promote private details through expected/publicMessage flags", () => {
  const result = describeError(Object.assign(new Error("secret-error"), { statusCode: 500, expected: true, publicMessage: "secret-public", details: { secret: "secret-detail" } }));
  assert.equal(result.expected, false);
  assert.equal(result.message, "Unexpected server error.");
  assert.equal(result.details, null);
  assert.equal(describeError({ statusCode: 999, message: "invalid status" }).statusCode, 500);
  const busy = describeError({ statusCode: 503, code: "AUTH_BUSY", message: "secret-driver" });
  assert.equal(busy.message, "The service is busy. Retry shortly.");
});

test("real HTTP ingress rejects unsafe browser origins and non-object JSON before registration; successful auth remains usable", async (t) => {
  const f = await fixture(t);
  for (const headers of [{ origin: "https://foreign.example.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" },
    { origin: "https://foreign.example.test", "x-forwarded-host": "client.example.test", "x-forwarded-proto": "http" }]) {
    assert.equal((await f.post("/api/auth/register", registration(), headers)).status, 403);
  }
  const text = await fetch(f.url + "/api/auth/register", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(registration()) });
  assert.equal(text.status, 415);
  assert.equal((await f.post("/api/auth/register", [])).status, 400);
  assert.equal((await f.post("/api/auth/register", { ...registration(), ignored: "x".repeat(17 * 1024) })).status, 413);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM organizations")).n, 0);
  assert.equal((await f.db.get("SELECT SUM(attempts) AS n FROM auth_rate_buckets")).n, 0);
  const registered = await f.post("/api/auth/register", registration(), { origin: f.config.security.publicAppOrigin, "sec-fetch-site": "same-origin" });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(f.url + "/api/auth/me", { headers: { cookie } })).status, 200);
  const keys = await fetch(f.url + "/api/settings/channels/email/webhooks", { headers: { cookie, "sec-fetch-site": "cross-site" } });
  assert.equal(keys.status, 403);
  assert.equal((await fetch(f.url + "/api/auth/me", { headers: { cookie: "relay_session=%GG" } })).status, 401);
  const invalid = await fetch(f.url + "/api/webhooks/sendgrid/events/secret-routing-token", { method: "POST", headers: { "content-type": "application/json" }, body: "[]" });
  assert.equal(invalid.status, 404);
  assert.equal(JSON.stringify(f.records).includes("secret-routing-token"), false);
  assert.equal(JSON.stringify(f.records).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(f.records).includes("owner@example.test"), false);
  assert.equal(JSON.stringify(f.records).includes(cookie), false);
});

test("stalled real HTTP input has a deadline, admission sheds load and liveness survives without database access", async (t) => {
  const f = await fixture(t, config => { config.http.maxInFlight = 1; config.http.bodyTimeout = 300; });
  const req = http.request(f.url + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "content-length": "100" } });
  const responsePromise = once(req, "response");
  req.on("error", () => {});
  req.write('{"email":');
  const deadline = Date.now() + 1000;
  while (f.server.httpPolicy.inFlight !== 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.server.httpPolicy.inFlight, 1);
  const read = f.db.get; f.db.get = async () => { throw new Error("liveness must not read DB"); };
  try { assert.equal((await fetch(f.url + "/api/health/live")).status, 200); } finally { f.db.get = read; }
  const busy = await fetch(f.url + "/api/health/ready");
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("retry-after"), "1");
  const [timedOut] = await responsePromise;
  const chunks = []; for await (const chunk of timedOut) chunks.push(chunk);
  assert.equal(timedOut.statusCode, 408);
  assert.equal(timedOut.headers.connection, "close");
  assert.equal(JSON.parse(Buffer.concat(chunks)).code, "REQUEST_BODY_TIMEOUT");
  req.destroy();
  assert.equal(f.server.httpPolicy.inFlight, 0);
  assert.equal((await f.db.get("SELECT SUM(attempts) AS n FROM auth_rate_buckets")).n, 0);
  assert.equal((await f.post("/api/auth/register", registration("recovered@example.test"))).status, 201);
});
