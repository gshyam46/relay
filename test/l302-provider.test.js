import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider } from "../src/modules/ai/providers/openaiCompatible.js";

const request = { messages: [{ role: "user", content: "Synthetic fixture only" }] };
const completion = (content = '{"ok":true}') => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
const adapter = (options = {}) => new OpenAICompatibleProvider({ baseUrl: "https://provider.invalid/v1", apiKey: "fixture-secret", model: "fixture-model", ...options });
function jsonResponse(data) { return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }); }

test("bounded adapter makes one text JSON request with redirects forbidden and no tools", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://provider.invalid/v1/chat/completions");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.tools, undefined);
    return jsonResponse(completion());
  });
  assert.deepEqual(await adapter().jsonCompletion(request), { ok: true });
  assert.equal(calls, 1);
});

test("request byte, message and token limits reject before any transport", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("invalid request must not reach transport"));
  for (const input of [
    { messages: [{ role: "user", content: "\u0939".repeat(100000) }] },
    { messages: Array.from({ length: 33 }, () => ({ role: "user", content: "x" })) },
    { messages: [{ role: "tool", content: "x" }] },
    { ...request, maxTokens: 4097 },
    { ...request, temperature: Infinity },
    { messages: [{ role: "user", content: "x", tool_calls: [] }] }
  ]) await assert.rejects(adapter().jsonCompletion(input), /AI request/);
});

test("provider bodies and transport exceptions never escape fixed errors and are not retried", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("fixture-secret customer text", { status: 429 }); });
  await assert.rejects(adapter().jsonCompletion(request), { message: "AI provider completion unavailable." });
  assert.equal(calls, 1);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("fixture-secret customer text"); });
  await assert.rejects(adapter().jsonCompletion(request), { message: "AI provider completion unavailable." });
});

test("malformed, nontext, tool, refusal and truncated completions never become domain output", async (t) => {
  const outputs = [
    {}, { choices: [] }, { choices: [null] }, { choices: [completion().choices[0], completion().choices[0]] },
    { choices: [{ ...completion().choices[0], finish_reason: "length" }] },
    ...[null, [], {}, ""].map(content => completion(content)),
    ...[{ tool_calls: [] }, { function_call: {} }, { refusal: "No" }, { role: "tool" }]
      .map(extra => ({ choices: [{ finish_reason: "stop", message: { ...completion().choices[0].message, ...extra } }] }))
  ];
  for (const output of outputs) {
    t.mock.method(globalThis, "fetch", async () => jsonResponse(output));
    await assert.rejects(adapter().jsonCompletion(request), { message: "AI provider completion rejected." });
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => jsonResponse(completion("private text is not JSON")));
  await assert.rejects(adapter().jsonCompletion(request), { message: "AI provider JSON completion rejected." });
});

test("non JSON and oversized response streams fail with a bounded fixed reason", async (t) => {
  for (const response of [
    new Response("not-json", { headers: { "content-type": "text/html" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
    jsonResponse(completion("x".repeat(65536)))
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(adapter().jsonCompletion(request), { message: "AI provider completion unavailable." });
    t.mock.restoreAll();
  }
});

test("request deadline aborts both pending headers and an unfinished response body", async (t) => {
  let aborted = false;
  t.mock.method(globalThis, "fetch", (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }));
  await assert.rejects(adapter({ timeoutMs: 20 }).jsonCompletion(request), { message: "AI provider completion unavailable." });
  assert.equal(aborted, true);
  t.mock.restoreAll();
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":')); },
    cancel() { cancelled = true; }
  }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(adapter({ timeoutMs: 20 }).jsonCompletion(request), { message: "AI provider completion unavailable." });
  assert.equal(cancelled, true);
  assert.throws(() => adapter({ timeoutMs: 15001 }), /deadline/);
});
