import test from "node:test";
import assert from "node:assert/strict";
import { providerRequest, providerReference, PROVIDER_RESPONSE_BYTES } from "../src/modules/handlers/providerRequest.js";
function mock(t, work) { const old = globalThis.fetch; globalThis.fetch = work; t.after(() => { globalThis.fetch = old; }); }
const request = (options = {}) => providerRequest("https://synthetic.invalid/send", { method: "POST" }, "Provider", options);
test("bounded JSON reads a real stream and retains the same request deadline signal", async t => {
 let signal;
 mock(t, async (_url, options) => { signal = options.signal; assert.equal(options.redirect, "error"); return Response.json({ id: "safe-reference" }); });
 const result = await request(); assert.equal(result.ok, true); assert.equal(result.data.id, "safe-reference"); assert.equal(result.response_issue, null);
 assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false);
});
test("oversized streamed acceptance cancels its body without turning into a retry", async t => {
 let cancelled = false;
 mock(t, async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(PROVIDER_RESPONSE_BYTES + 1)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
 const result = await request(); assert.equal(result.ok, true); assert.equal(result.data, null); assert.equal(result.response_issue, "RESPONSE_TOO_LARGE"); assert.equal(cancelled, true); assert.notEqual(result.retryable, true);
});
test("stalled accepted body ends under the original deadline and cancels", async t => {
 let signal, cancelled = false;
 mock(t, async (_url, options) => { signal = options.signal; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }); });
 const result = await request({ timeoutMs: 15 }); assert.equal(result.ok, true); assert.equal(result.response_issue, "RESPONSE_TIMEOUT"); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
test("header acceptance cancels even an endless body without waiting", async t => {
 let cancelled = false;
 mock(t, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 202, headers: { "x-message-id": "accepted" } }));
 const result = await request({ responseMode: "headers" }); assert.equal(result.ok, true); assert.equal(cancelled, true); assert.equal(result.response.headers.get("x-message-id"), "accepted");
});
for (const [status, contentType, expected] of [[429, "application/json", false], [200, "text/html", true]]) test("HTTP " + status + " nonconsumed body is cancelled without parsing secrets", async t => {
 let cancelled = false;
 mock(t, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { "content-type": contentType } }));
 const result = await request(); assert.equal(result.ok, expected); assert.equal(cancelled, true); assert.doesNotMatch(JSON.stringify(result), /credential/);
});
test("malformed accepted JSON stays accepted with a safe fixed issue", async t => {
 mock(t, async () => new Response("secret-credential-not-json", { headers: { "content-type": "application/json" } }));
 const result = await request(); assert.equal(result.ok, true); assert.equal(result.response_issue, "INVALID_JSON_RESPONSE"); assert.doesNotMatch(JSON.stringify(result), /secret-credential/);
});
test("references have exact bounded identity, with no silent truncation", () => {
 assert.equal(providerReference("safe"), "safe"); assert.equal(providerReference("x".repeat(512)).length, 512);
 for (const value of [undefined, null, {}, 1, "", " ", "x".repeat(513), "bad\nvalue", "bad\rvalue", "bad\0value"]) assert.equal(providerReference(value), null);
});
test("transport never admits a longer internal deadline", async () => { await assert.rejects(request({ timeoutMs: 15001 }), TypeError); });
