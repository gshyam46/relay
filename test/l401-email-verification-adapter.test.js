import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SendgridVerificationAdapter } from "../src/modules/channels/sendgridVerificationAdapter.js";
import { PROVIDER_RESPONSE_BYTES } from "../src/modules/handlers/providerRequest.js";
const publicKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
const configuration = { provider: "sendgrid", from_email: "sender@example.test", reply_to: "replies@parse.example.test", api_key: "synthetic-provider-secret", sendgrid_events_public_key: publicKey(), sendgrid_inbound_public_key: publicKey() };
const input = { configuration, events_url: "https://verification.example.test/api/webhooks/sendgrid/events/synthetic", inbound_url: "https://verification.example.test/api/webhooks/sendgrid/inbound/synthetic" };
function bodies() { return [
  { scopes: ["mail.send", "user.webhooks.event.settings.read"] }, [{ domain: "example.test", valid: true }],
  { webhooks: [{ id: "synthetic-event", enabled: true, url: input.events_url, public_key: configuration.sendgrid_events_public_key, delivered: true, bounce: true, dropped: true, spam_report: true, unsubscribe: true, group_unsubscribe: true }] },
  { hostname: "parse.example.test", url: input.inbound_url, send_raw: false, security_policy: "synthetic-policy" },
  { policy: { id: "synthetic-policy", signature: { public_key: configuration.sendgrid_inbound_public_key } } }
]; }
async function inspect(values = bodies()) {
  const requests = [], adapter = new SendgridVerificationAdapter({ request: async (url, options) => { const index = requests.length; requests.push({ url, options }); return { ok: true, data: values[index], response: { status: 200 }, response_issue: null }; } });
  return { result: await adapter.check(input), requests };
}
test("bounded provider inspection uses five fixed GET routes and records no raw configuration or response", async () => {
  const { result, requests } = await inspect(); assert.equal(requests.length, 5); assert.ok(result.checks.every(row => row.status === "PASS"));
  for (const request of requests) { const url = new URL(request.url); assert.equal(url.origin, "https://api.sendgrid.com"); assert.equal(request.options.method, "GET"); assert.equal(request.options.body, undefined); }
  assert.equal(new URL(requests[1].url).searchParams.get("limit"), "100");
  const serialized = JSON.stringify(result); for (const raw of [configuration.api_key, configuration.sendgrid_events_public_key, input.events_url, "synthetic-policy"]) assert.equal(serialized.includes(raw), false);
});
test("missing send scope and unavailable read permission are distinct from operational sendability", async () => {
  const values = bodies(); values[0] = { scopes: ["templates.read"] }; const missing = await inspect(values);
  assert.equal(missing.requests.length, 1); assert.equal(missing.result.checks[0].code, "MAIL_SEND_SCOPE_MISSING");
  let calls = 0; const adapter = new SendgridVerificationAdapter({ request: async () => ++calls === 1 ? { ok: true, data: bodies()[0], response: { status: 200 } } : { ok: false, http_status: 403 } });
  const unavailable = await adapter.check(input); assert.equal(unavailable.checks[0].status, "PASS"); assert.equal(unavailable.checks[1].status, "UNKNOWN"); assert.equal(unavailable.checks[1].code, "READ_PERMISSION_UNAVAILABLE");
});
test("sender/domain, exact signed URL/key, required stop events and Parse policy all fail closed", async () => {
  const alterations = [
    rows => { rows[1] = [{ domain: "elsewhere.test", valid: true }]; },
    rows => { rows[1][0].valid = false; },
    rows => { rows[2].webhooks[0].url += "/different"; },
    rows => { rows[2].webhooks[0].public_key = publicKey(); },
    rows => { rows[2].webhooks[0].unsubscribe = false; },
    rows => { rows[2].webhooks.push({ ...rows[2].webhooks[0] }); },
    rows => { rows[3].send_raw = true; },
    rows => { delete rows[3].security_policy; },
    rows => { rows[4].policy.signature.public_key = publicKey(); }
  ];
  for (const alter of alterations) { const rows = bodies(); alter(rows); const { result } = await inspect(rows); assert.equal(result.checks.every(row => row.status === "PASS"), false); }
});
test("unbounded domain pages and webhook lists cannot be treated as a complete match", async () => {
  for (const [index, value] of [[1, Array.from({ length: 100 }, () => ({ domain: "example.test", valid: true }))], [2, { webhooks: Array.from({ length: 101 }, () => bodies()[2].webhooks[0]) }]]) {
    const rows = bodies(); rows[index] = value; const { result } = await inspect(rows); assert.equal(result.checks[index].status, "UNKNOWN");
  }
});
test("malformed local configuration makes no provider request", async () => {
  let calls = 0; const adapter = new SendgridVerificationAdapter({ request: async () => { calls++; throw new Error(); } });
  const result = await adapter.check({ ...input, configuration: { ...configuration, sendgrid_inbound_public_key: null } }); assert.equal(calls, 0); assert.ok(result.checks.every(row => row.status === "UNKNOWN"));
});
test("actual provider transport rejects redirects and oversized response bodies without leaking provider text", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(new URL(url).origin, "https://api.sendgrid.com"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal); return new Response(JSON.stringify({ scopes: ["provider-private-" + "x".repeat(PROVIDER_RESPONSE_BYTES)] }), { headers: { "content-type": "application/json" } }); };
  const result = await new SendgridVerificationAdapter().check(input); assert.equal(calls, 1); assert.equal(result.checks[0].status, "UNKNOWN"); assert.equal(JSON.stringify(result).includes("provider-private"), false);
});
test("transport rejection or partial malformed provider shape retains unverified status", async () => {
  const adapter = new SendgridVerificationAdapter({ request: async () => { throw new Error("provider-secret should not escape"); } });
  const result = await adapter.check(input); assert.equal(result.checks[0].code, "PROVIDER_READ_UNAVAILABLE"); assert.equal(JSON.stringify(result).includes("provider-secret"), false);
  const rows = bodies(); rows[0] = { unexpected: ["mail.send"] }; assert.equal((await inspect(rows)).result.checks[0].status, "UNKNOWN");
});
