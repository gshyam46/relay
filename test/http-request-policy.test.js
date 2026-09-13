import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { once } from "node:events";
import { readRequestBody, readJsonBody } from "../src/shared/requestBody.js";
import { HttpRequestPolicy, socketPeerAddress, normalizePeerAddress } from "../src/shared/httpRequestPolicy.js";

function stream(chunks, headers = {}) { const req = Readable.from(chunks); req.headers = headers; return req; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function readerServer(t, policy) {
  const handled = deferred(), received = deferred(), closed = deferred();
  const server = createServer(async (req, res) => {
    received.resolve(req); req.once("close", () => closed.resolve(req));
    let result;
    try { result = { body: await readRequestBody(req, policy) }; }
    catch (error) { result = { error }; }
    handled.resolve({ ...result, request: req });
    if (!res.destroyed) { res.writeHead(result.error?.statusCode || 200, { connection: "close" }); res.end(result.error?.code || "ok", () => { if (!req.readableEnded) req.destroy(); }); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const socket = connect(server.address().port, "127.0.0.1"); socket.on("error", () => {}); t.after(() => socket.destroy());
  await once(socket, "connect");
  let response = ""; socket.on("data", (chunk) => { response += chunk.toString(); });
  const ended = new Promise((resolve) => socket.once("close", resolve));
  return { socket, handled: handled.promise, received: received.promise, closed: closed.promise, ended, response: () => response };
}

test("real chunked HTTP bytes enforce the cap and clean reader listeners on close", async (t) => {
  const f = await readerServer(t, { maxBytes: 16, timeoutMs: 500 });
  f.socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n12345678\r\n9\r\n123456789\r\n0\r\n\r\n");
  const { error, request, originalEndListeners } = await f.handled; assert.equal(error.code, "REQUEST_BODY_TOO_LARGE"); assert.equal(error.statusCode, 413);
  await f.ended; await f.closed; assert.ok(f.response().includes("HTTP/1.1 413"));
  for (const name of ["data", "error"]) assert.equal(request.listenerCount(name), 0, name);
  assert.equal(request.destroyed, true); assert.equal(request.socket.destroyed, true);
});

test("a declared oversized HTTP body is rejected without waiting for its bytes", async (t) => {
  const f = await readerServer(t, { maxBytes: 16, timeoutMs: 500 });
  f.socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 17\r\n\r\n");
  assert.equal((await f.handled).error.code, "REQUEST_BODY_TOO_LARGE"); await f.ended; await f.closed;
  assert.ok(f.response().includes("HTTP/1.1 413"));
});

test("real HTTP client abort rejects promptly without accepting an incomplete body", async (t) => {
  const f = await readerServer(t, { maxBytes: 128, timeoutMs: 500 });
  f.socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{}");
  await f.received; f.socket.destroy(); const { error, request } = await f.handled;
  assert.equal(error.code, "REQUEST_ABORTED"); await f.closed;
  assert.equal(request.listenerCount("error"), 0);
});

test("body deadline is absolute even while a client keeps trickling bytes", async (t) => {
  const f = await readerServer(t, { maxBytes: 128, timeoutMs: 90 });
  f.socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx");
  const timer = setInterval(() => f.socket.write("x"), 10); t.after(() => clearInterval(timer));
  const { error } = await f.handled; clearInterval(timer);
  assert.equal(error.code, "REQUEST_BODY_TIMEOUT"); assert.equal(error.statusCode, 408);
  await f.ended; await f.closed;
  // A peer still writing can observe a TCP reset; rejection and cleanup stay bounded.
  assert.equal(f.socket.destroyed, true);
});

test("late stream errors after oversize or timeout are guarded only until close", async () => {
  for (const mode of ["oversize", "timeout"]) {
    const req = new PassThrough(); req.headers = {};
    const result = readRequestBody(req, { maxBytes: 4, timeoutMs: 20 });
    if (mode === "oversize") req.write("12345");
    await assert.rejects(result, { code: mode === "oversize" ? "REQUEST_BODY_TOO_LARGE" : "REQUEST_BODY_TIMEOUT" });
    assert.equal(req.listenerCount("data"), 0); assert.equal(req.listenerCount("end"), 0);
    const closed = new Promise((resolve) => req.once("close", resolve)); req.destroy(new Error("synthetic late socket error")); await closed;
    assert.equal(req.listenerCount("error"), 0); assert.equal(req.listenerCount("close"), 0);
  }
});

test("invalid stream inputs are rejected before installing timers or listeners", async () => {
  await assert.rejects(readRequestBody({ headers: {}, async *[Symbol.asyncIterator]() { yield "x"; } }, { timeoutMs: 1 }), /readable HTTP request/);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("JSON preserves valid UTF-8 objects and rejects unsupported encoding, malformed bytes and nonobjects", async () => {
  const headers = { "content-type": "application/json; charset=UTF-8" };
  const input = { text: String.fromCodePoint(0xe9), nested: { valid: true } }, encoded = Buffer.from(JSON.stringify(input));
  assert.deepEqual(await readJsonBody(stream([encoded.subarray(0, 11), encoded.subarray(11)], headers)), input);
  for (const [chunks, patch, code] of [
    [["{}"], { "content-type": "text/plain" }, "REQUEST_MEDIA_TYPE_UNSUPPORTED"],
    [["{}"], { "content-encoding": "gzip" }, "REQUEST_ENCODING_UNSUPPORTED"],
    [["{}"], { "content-type": "application/json;charset=latin1" }, "REQUEST_ENCODING_UNSUPPORTED"],
    [[Buffer.from([0x7b, 0xff, 0x7d])], {}, "REQUEST_JSON_INVALID"],
    [["{"], {}, "REQUEST_JSON_INVALID"],
    [["[]"], {}, "REQUEST_OBJECT_REQUIRED"],
    [["null"], {}, "REQUEST_OBJECT_REQUIRED"],
    [["42"], {}, "REQUEST_OBJECT_REQUIRED"]
  ]) {
    const req = stream(chunks, { ...headers, ...patch });
    await assert.rejects(readJsonBody(req), { code }); req.destroy();
  }
});

test("streamed byte accounting includes UTF-8 bytes and validates declared completion", async () => {
  const req = stream([Buffer.from(String.fromCodePoint(0xe9).repeat(3))]);
  await assert.rejects(readRequestBody(req, { maxBytes: 5 }), { statusCode: 413 }); req.destroy();
  const incomplete = stream([Buffer.from("xy")], { "content-length": "3" });
  await assert.rejects(readRequestBody(incomplete), { code: "REQUEST_LENGTH_INVALID" }); incomplete.destroy();
});

test("Origin decisions use configured trust and explicitly cover state-changing GETs", () => {
  const policy = new HttpRequestPolicy({ publicAppOrigin: "https://app.example.test", maxInFlight: 1 });
  const request = (headers = {}, method = "POST") => ({ method, headers });
  policy.assertOrigin(request()); policy.assertOrigin(request({ origin: "https://app.example.test", "sec-fetch-site": "same-origin" }));
  for (const headers of [{ origin: "null" }, { origin: "https://foreign.example.test" }, { origin: "https://app.example.test", "sec-fetch-site": "cross-site" }, { origin: "https://evil.example.test", host: "evil.example.test", "x-forwarded-host": "evil.example.test" }]) {
    assert.throws(() => policy.assertOrigin(request(headers)), { code: "REQUEST_ORIGIN_DENIED" });
  }
  const crossSiteGet = request({ "sec-fetch-site": "cross-site" }, "GET");
  policy.assertOrigin(crossSiteGet);
  assert.throws(() => policy.assertOrigin(crossSiteGet, { stateChangingGet: true }), { code: "REQUEST_ORIGIN_DENIED" });
  policy.assertOrigin(request({ "sec-fetch-site": "same-origin" }, "GET"), { stateChangingGet: true });
  policy.assertOrigin(request({ origin: "https://provider.example.test" }), { supportedWebhook: true });
  const release = policy.acquire(); assert.throws(() => policy.acquire(), { code: "HTTP_BUSY", retryAfterSeconds: 1 });
  release(); release(); assert.equal(policy.inFlight, 0); policy.acquire()();
});

test("auth peers ignore forwarded identities and normalize equivalent IP spellings", () => {
  assert.equal(socketPeerAddress({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { "x-forwarded-for": "198.51.100.2", forwarded: "for=198.51.100.3" } }), "127.0.0.1");
  assert.equal(normalizePeerAddress("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.throws(() => socketPeerAddress({ headers: { "x-forwarded-for": "198.51.100.2" } }), { code: "AUTH_ADMISSION_UNAVAILABLE" });
});
