import { provisionEmailWebhooks } from "./helpers/emailSetup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { parseMultipartFormData } from "../src/shared/multipart.js";

const BOUNDARY = "xYzBoundary123";

function buildInboundParseBody(fields) {
  const parts = Object.entries(fields).map(
    ([name, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
  return Buffer.from(`${parts.join("")}--${BOUNDARY}--\r\n`, "utf8");
}

test("parseMultipartFormData extracts text fields and skips file parts", async () => {
  const body = Buffer.from(
    [
      `--${BOUNDARY}`,
      `Content-Disposition: form-data; name="from"`,
      "",
      '"Jane Doe" <jane@example.com>',
      `--${BOUNDARY}`,
      `Content-Disposition: form-data; name="attachment1"; filename="photo.png"`,
      "Content-Type: image/png",
      "",
      "binary-garbage-not-utf8-safe",
      `--${BOUNDARY}--`,
      ""
    ].join("\r\n"),
    "utf8"
  );
  const fields = parseMultipartFormData(body, `multipart/form-data; boundary=${BOUNDARY}`);
  assert.equal(fields.from, '"Jane Doe" <jane@example.com>');
  assert.equal(fields.attachment1, undefined);
});

test("parseMultipartFormData returns empty object without a boundary", async () => {
  assert.deepEqual(parseMultipartFormData(Buffer.from("x"), "multipart/form-data"), {});
  assert.deepEqual(parseMultipartFormData(null, "multipart/form-data; boundary=abc"), {});
});

test("SendGrid Inbound Parse webhook resolves the org by token and auto-classifies the reply", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Inbound Webhook Org");
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Webhook Lead",
    email: "webhook-lead@example.com"
  });
  const webhooks = await provisionEmailWebhooks(client, organization.organization.id);
  assert.match(webhooks.inbound_path, /^\/api\/webhooks\/sendgrid\/inbound\/whk_/);

  const body = buildInboundParseBody({
    from: `"${lead.lead.name}" <${lead.lead.email}>`,
    subject: "Re: your outreach",
    text: "Sounds good, let's schedule a call",
    headers: "Message-ID: <abc123@mail.example.com>\r\nFrom: webhook-lead@example.com"
  });

  // Real SendGrid webhooks are unauthenticated POSTs from the public internet — no session
  // exists, only the per-org token baked into the URL, so this deliberately bypasses `client`.
  const res = await fetch(`${client.baseUrl}${webhooks.inbound_path}`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    body
  });
  assert.equal(res.status, 202);
  const result = await res.json();
  assert.equal(result.duplicate, false);

  const timeline = await client.get(`/api/leads/${lead.lead.id}/timeline?organization_id=${organization.organization.id}`);
  const message = timeline.timeline.find((item) => item.kind === "message" && item.direction === "INBOUND");
  assert.equal(message.classification_event_type, "POSITIVE_REPLY");

  const inboundRow = await client.db.get("SELECT * FROM inbound_events WHERE lead_id = ?", [lead.lead.id]);
  assert.equal(inboundRow.provider, "sendgrid");
  assert.equal(inboundRow.provider_event_id, "<abc123@mail.example.com>");

  // Retried delivery of the same message (SendGrid retries on non-2xx) must not double-count.
  const retry = await fetch(`${client.baseUrl}${webhooks.inbound_path}`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    body
  });
  const retryResult = await retry.json();
  assert.equal(retryResult.duplicate, true);

  // And the redelivery must not queue a second re-analysis of the lead, or a
  // provider retrying a webhook would cost an extra pass of the whole
  // intelligence pipeline every time.
  const queued = await client.db.all("SELECT * FROM domain_events WHERE type = ? AND lead_id = ?", [
    "LeadReplyReceived",
    lead.lead.id
  ]);
  assert.equal(queued.length, 1);
});

test("SendGrid Inbound Parse webhook rejects an unknown token", async (t) => {
  const client = await startClient(t);
  const res = await fetch(`${client.baseUrl}/api/webhooks/sendgrid/inbound/whk_not-a-real-token`, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    body: buildInboundParseBody({ from: "a@b.com", text: "hi" })
  });
  assert.equal(res.status, 404);
});

async function configureSyntheticSendgrid(t, client, organizationId) {
  await client.put("/api/settings", { organization_id: organizationId, category: "channel_email",
    values: { provider: "sendgrid", api_key: "synthetic-sendgrid-key", from_email: "fixture@example.com" } });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith(client.baseUrl)) return originalFetch(url, options);
    assert.equal(String(url), "https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(options.body);
    assert.ok(body.custom_args.relay_execution_id);
    assert.ok(body.custom_args.relay_revision_id);
    return new Response(null, { status: 202, headers: { "x-message-id": "http-acceptance-reference" } });
  });
}

test("SendGrid Event Webhook completes an action on delivered and fails it on bounce", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Events Webhook Org");
  await configureSyntheticSendgrid(t, client, organization.organization.id);
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Delivery Lead",
    email: "delivery-lead@example.com"
  });
  const action = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  await client.approve(action.action.id);
  const dispatched = await client.post(`/api/actions/${action.action.id}/execute`, { organization_id: organization.organization.id });
  const execution = dispatched.execution_result.execution;

  const webhooks = await provisionEmailWebhooks(client, organization.organization.id);

  const deliveredRes = await fetch(`${client.baseUrl}${webhooks.events_path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        event: "delivered",
        email: lead.lead.email,
        sg_event_id: "evt-delivered-1",
        sg_message_id: "sg-msg-1",
        timestamp: 1710000000,
        relay_action_id: action.action.id,
        relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id,
        relay_org_id: organization.organization.id
      }
    ])
  });
  assert.equal(deliveredRes.status, 200);
  const deliveredBody = await deliveredRes.json();
  assert.equal(deliveredBody.results[0].applied, true);

  const afterDelivered = await client.get(`/api/leads/${lead.lead.id}/outbound?organization_id=${organization.organization.id}`);
  assert.equal(afterDelivered.actions[0].status, "COMPLETED");

  // A duplicate delivery of the same sg_event_id must be a no-op, not a second completion.
  const duplicateRes = await fetch(`${client.baseUrl}${webhooks.events_path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        event: "delivered",
        email: lead.lead.email,
        sg_event_id: "evt-delivered-1",
        sg_message_id: "sg-msg-1",
        timestamp: 1710000000,
        custom_args: { relay_action_id: action.action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id }
      }
    ])
  });
  const duplicateBody = await duplicateRes.json();
  assert.equal(duplicateBody.results[0].processing_state, "PROCESSED");
  assert.equal(duplicateBody.results[0].duplicate, true);
  assert.equal(duplicateBody.results[0].receipt_id, deliveredBody.results[0].receipt_id);
});

test("SendGrid Event Webhook bounce fails the action and tracking-only events do not change status", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Bounce Webhook Org");
  await configureSyntheticSendgrid(t, client, organization.organization.id);
  const lead = await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Bounce Lead",
    email: "bounce-lead@example.com"
  });
  const action = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  await client.approve(action.action.id);
  const dispatched = await client.post(`/api/actions/${action.action.id}/execute`, { organization_id: organization.organization.id });
  const execution = dispatched.execution_result.execution;
  const webhooks = await provisionEmailWebhooks(client, organization.organization.id);

  await fetch(`${client.baseUrl}${webhooks.events_path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { event: "open", sg_event_id: "evt-open-1", sg_message_id: "sg-msg-2", timestamp: 1, custom_args: { relay_action_id: action.action.id } },
      {
        event: "bounce",
        type: "bounce",
        email: lead.lead.email,
        sg_event_id: "evt-bounce-1",
        sg_message_id: "sg-msg-2",
        timestamp: 2,
        reason: "550 mailbox unavailable",
        custom_args: { relay_action_id: action.action.id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id }
      }
    ])
  });

  const afterBounce = await client.get(`/api/leads/${lead.lead.id}/outbound?organization_id=${organization.organization.id}`);
  assert.equal(afterBounce.actions[0].status, "FAILED");
  const restriction = await client.services.contactPolicyService.inspectLead({ organization_id: organization.organization.id, lead_id: lead.lead.id, channel: "EMAIL" });
  assert.equal(restriction.restricted, true);
});

test("SendGrid Event Webhook cannot apply events against another organization's action", async (t) => {
  const client = await startClient(t);
  const orgA = await client.register("Tenant A Webhook");
  const lead = await client.post("/api/leads", {
    organization_id: orgA.organization.id,
    name: "Cross Tenant Lead",
    email: "cross-tenant@example.com"
  });
  const action = await client.post(`/api/leads/${lead.lead.id}/actions`, {
    organization_id: orgA.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  await client.approve(action.action.id);
  await client.post(`/api/actions/${action.action.id}/execute`, { organization_id: orgA.organization.id });

  const orgB = await client.register("Tenant B Webhook"); // switches the active session to org B
  const orgBWebhooks = await provisionEmailWebhooks(client, orgB.organization.id);
  const res = await fetch(`${client.baseUrl}${orgBWebhooks.events_path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { event: "delivered", sg_event_id: "evt-cross-1", sg_message_id: "sg-msg-x", timestamp: 1, custom_args: { relay_action_id: action.action.id } }
    ])
  });
  const body = await res.json();
  assert.equal(body.results[0].ok, false);

  await client.login(orgA.user.email);
  const afterAttempt = await client.get(`/api/leads/${lead.lead.id}/outbound?organization_id=${orgA.organization.id}`);
  assert.equal(afterAttempt.actions[0].status, "EXECUTING");
});
