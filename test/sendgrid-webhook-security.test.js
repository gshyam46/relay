import { provisionEmailWebhooks } from "./helpers/emailSetup.js";
import test from "node:test";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifySendgridWebhook, readBoundedWebhookBody } from "../src/modules/handlers/sendgridWebhookSecurity.js";
import { startClient } from "./helpers/testClient.js";
import { loadConfig } from "../src/config.js";

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
function headersFor(body, pair = keys) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-twilio-email-event-webhook-timestamp": timestamp,
    "x-twilio-email-event-webhook-signature": sign("sha256", Buffer.concat([Buffer.from(timestamp), body]), pair.privateKey).toString("base64")
  };
}

test("SendGrid verification binds the exact original bytes and timestamp", () => {
  const rawBody = Buffer.from('[ { "event": "unsubscribe", "email": "test@example.test" } ]\r\n');
  const headers = headersFor(rawBody);
  verifySendgridWebhook({ headers, rawBody, publicKey });
  verifySendgridWebhook({ headers, rawBody, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }) });
  for (const changed of [Buffer.from(JSON.stringify(JSON.parse(rawBody))), Buffer.concat([rawBody, Buffer.from(" ")])]) {
    assert.throws(() => verifySendgridWebhook({ headers, rawBody: changed, publicKey }), { statusCode: 401 });
  }
  assert.throws(() => verifySendgridWebhook({ headers: { ...headers, "x-twilio-email-event-webhook-timestamp": "1" }, rawBody, publicKey }), { statusCode: 401 });
});

test("configured verification never downgrades to unsigned local testing", () => {
  const rawBody = Buffer.from("[]");
  assert.throws(() => verifySendgridWebhook({ headers: {}, rawBody, publicKey, allowUnsignedTest: true }), { statusCode: 401 });
  assert.throws(() => verifySendgridWebhook({ headers: {}, rawBody }), { statusCode: 503 });
  assert.throws(() => verifySendgridWebhook({ headers: headersFor(rawBody), rawBody, publicKey: "not-a-key" }), { statusCode: 401 });
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(() => verifySendgridWebhook({ headers: headersFor(rawBody, other), rawBody, publicKey }), { statusCode: 401 });
  verifySendgridWebhook({ headers: {}, rawBody, allowUnsignedTest: true });
  assert.throws(() => verifySendgridWebhook({ headers: headersFor(rawBody), rawBody, allowUnsignedTest: true }), { statusCode: 503 });
});

test("webhook body limits reject declared and streamed oversized input", async () => {
  async function* chunks() { yield Buffer.alloc(5); yield Buffer.alloc(6); }
  const declared = Object.assign(Readable.from(chunks()), { headers: { "content-length": "11" } });
  await assert.rejects(readBoundedWebhookBody(declared, 10), { statusCode: 413 });
  const streamed = Object.assign(Readable.from(chunks()), { headers: {} });
  await assert.rejects(readBoundedWebhookBody(streamed, 10), { statusCode: 413 });
});

test("signed webhook saves no-action unsubscribe and rejects tamper, wrong key and missing configuration", async (t) => {
  const client = await startClient(t, ":memory:", { config: loadConfig({ NODE_ENV: "test", WORKER_ENABLED: "false" }) });
  const { organization } = await client.register("Signed webhook workspace");
  const { lead } = await client.post("/api/leads", { name: "Synthetic contact", email: "signed@example.test" });
  const paths = await provisionEmailWebhooks(client, organization.id);
  const rawBody = Buffer.from(JSON.stringify([{ sg_event_id: "signed-optout", event: "unsubscribe", email: lead.email, timestamp: 123 }]));
  const request = (body, headers = {}) => fetch(client.baseUrl + paths.events_path, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body
  });
  assert.equal((await request(rawBody)).status, 503);
  assert.equal((await client.services.contactPolicyService.inspectLead({ organization_id: organization.id, lead_id: lead.id, channel: "EMAIL" })).restricted, false);
  await client.services.settingsRepository.set(organization.id, "channel_email", "sendgrid_events_public_key", publicKey);
  assert.equal((await request(rawBody)).status, 401);
  const validHeaders = headersFor(rawBody);
  assert.equal((await request(Buffer.concat([rawBody, Buffer.from(" ")]), validHeaders)).status, 401);
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.equal((await request(rawBody, headersFor(rawBody, other))).status, 401);
  assert.equal((await request(rawBody, validHeaders)).status, 200);
  assert.equal((await client.services.contactPolicyService.inspectLead({ organization_id: organization.id, lead_id: lead.id, channel: "EMAIL" })).restricted, true);
  assert.equal((await request(rawBody, validHeaders)).status, 200);
});

test("failed restriction processing is durably acknowledged, holds dispatch and completes through worker retry", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Retry webhook workspace");
  const { lead } = await client.post("/api/leads", { name: "Synthetic contact", email: "retry@example.test" });
  const action = await client.services.actionsRepository.createAction({ organization_id: organization.id, lead_id: lead.id,
    type: "SEND_EMAIL", status: "APPROVED", idempotency_key: "pending-policy-dispatch", payload: { subject: "Synthetic", body: "Synthetic reviewed message" } });
  const paths = await provisionEmailWebhooks(client, organization.id);
  let now = Date.now(); client.services.webhookInbox.now = () => now; client.services.webhookInbox.random = () => 0;
  await client.db.exec("CREATE TRIGGER fail_restriction BEFORE INSERT ON contact_restrictions BEGIN SELECT RAISE(ABORT, 'Injected storage failure'); END");
  const body = JSON.stringify([{ sg_event_id: "retry-optout", event: "unsubscribe", email: lead.email }]);
  const send = () => fetch(client.baseUrl + paths.events_path, { method: "POST", body, headers: { "content-type": "application/json" } });
  let response = await send();
  assert.equal(response.status, 200);
  const acknowledged = await response.json();
  assert.equal(acknowledged.results[0].processing_state, "RETRY_PENDING");
  assert.doesNotMatch(JSON.stringify(acknowledged), /Injected storage failure/);
  const original = await client.db.get("SELECT * FROM webhook_receipts WHERE provider_event_id = 'retry-optout'");
  assert.equal(original.id, acknowledged.results[0].receipt_id);
  assert.equal(original.mandatory_policy_status, "PENDING");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 0);
  const eligibility = await client.services.contactPolicyService.inspectLead({ organization_id: organization.id, lead_id: lead.id, channel: "EMAIL" });
  assert.equal(eligibility.policy_pending, true); assert.equal(eligibility.restricted, false);
  const held = await client.services.actionExecutor.execute(action);
  assert.equal(held.deferred, true); assert.equal(held.policy_pending, true);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  await client.db.exec("DROP TRIGGER fail_restriction"); now += 6000;
  await client.services.worker.runOnce({ organization_id: organization.id });
  const completed = await client.db.get("SELECT * FROM webhook_receipts WHERE id = ?", [original.id]);
  assert.equal(completed.processing_state, "PROCESSED"); assert.equal(completed.mandatory_policy_status, "DONE");
  assert.equal(completed.normalized_input_json, original.normalized_input_json); assert.equal(completed.payload_hash, original.payload_hash);
  assert.equal((await client.services.contactPolicyService.inspectLead({ organization_id: organization.id, lead_id: lead.id, channel: "EMAIL" })).restricted, true);
  const restrictions = await client.db.all("SELECT * FROM contact_restrictions ORDER BY id");
  assert.equal(restrictions.length, 1);
  response = await send(); assert.equal(response.status, 200);
  assert.deepEqual(await client.db.all("SELECT * FROM contact_restrictions ORDER BY id"), restrictions);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 1);
});
