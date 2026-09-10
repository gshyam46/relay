import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { startClient } from "./helpers/testClient.js";
import { MASKED_SECRET } from "../src/modules/settings/secretSettings.js";

// The real (non-sandbox) email path. `fetch` is stubbed throughout, so these
// tests exercise exactly what would be sent to Resend/SendGrid without a single
// byte leaving the machine and without needing an API key.

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url: String(url),
      method: options.method,
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null
    };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

async function withServices(run) {
  const db = await createDatabase(":memory:");
  const services = createServices(db);
  try {
    const organization = await services.leadsRepository.createOrganization({ name: "Email Channel Org" });
    const lead = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "Priya Sharma",
      email: "Priya@Example.com",
      company: "Sharma Interiors",
      source: "MANUAL"
    });
    await run({ services, organization, lead });
  } finally {
    await db.close();
  }
}

async function configureEmail(services, organizationId, values) {
  await services.settingsRepository.setBulk(organizationId, "channel_email", values);
}

test("sandbox is the default: an unconfigured workspace never reaches a provider", async () => {
  await withServices(async ({ services, organization, lead }) => {
    const stub = stubFetch(() => {
      throw new Error("no HTTP call should happen in sandbox mode");
    });
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `sandbox-default:${lead.id}`,
        payload: { message: "Hello there" }
      });
      const result = await services.actionExecutor.execute(action);
      assert.equal(result.status, "EXECUTING");
      assert.equal(stub.calls.length, 0, "sandbox must not call any provider");
      const execution = await services.executionsRepository.latestForAction(action.id);
      assert.match(execution.provider, /sandbox/);
    } finally {
      stub.restore();
    }
  });
});

test("configuring Resend routes a real send with a proper subject, text part and idempotency key", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, {
      provider: "resend",
      api_key: "re_test_key",
      from_email: "hello@relay.test"
    });

    const stub = stubFetch(() => jsonResponse(200, { id: "resend-message-1" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-send:${lead.id}`,
        payload: { message: "Thanks for your enquiry.\nShall we talk Thursday?" }
      });
      const result = await services.actionExecutor.execute(action);

      assert.equal(stub.calls.length, 1, "exactly one provider call");
      const call = stub.calls[0];
      assert.equal(call.url, "https://api.resend.com/emails");
      assert.equal(call.headers.Authorization, "Bearer re_test_key");

      // Retrying an attempt that actually succeeded must not send twice.
      assert.equal(call.headers["Idempotency-Key"], `relay-action-${action.id}`);

      assert.equal(call.body.from, "hello@relay.test");
      assert.deepEqual(call.body.to, ["priya@example.com"], "sends to the normalized address");

      // The subject used to be the entire message body.
      assert.equal(call.body.subject, "Following up with Sharma Interiors");
      assert.notEqual(call.body.subject, call.body.text);

      assert.equal(call.body.text, "Thanks for your enquiry.\nShall we talk Thursday?");
      assert.equal(call.body.html, "Thanks for your enquiry.<br />Shall we talk Thursday?");

      assert.equal(result.status, "EXECUTING");
      const execution = await services.executionsRepository.latestForAction(action.id);
      assert.match(execution.provider, /resend/);
      assert.equal(execution.provider_reference, "resend-message-1");
    } finally {
      stub.restore();
    }
  });
});

test("an explicit subject on the action payload wins over the generated one", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, { provider: "resend", api_key: "re_test_key" });
    const stub = stubFetch(() => jsonResponse(200, { id: "resend-message-2" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-subject:${lead.id}`,
        payload: { subject: "Your teak dining table quote", message: "Attached." }
      });
      await services.actionExecutor.execute(action);
      assert.equal(stub.calls[0].body.subject, "Your teak dining table quote");
    } finally {
      stub.restore();
    }
  });
});

test("lead data cannot inject markup into the HTML part", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, { provider: "resend", api_key: "re_test_key" });
    const stub = stubFetch(() => jsonResponse(200, { id: "resend-message-3" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-escape:${lead.id}`,
        payload: { message: '<script>alert("x")</script> & more' }
      });
      await services.actionExecutor.execute(action);
      const html = stub.calls[0].body.html;
      assert.equal(html.includes("<script>"), false, "markup must be escaped");
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(html.includes("&amp;"));
    } finally {
      stub.restore();
    }
  });
});

test("a 5xx from the provider is retryable and the action returns to the queue", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, { provider: "resend", api_key: "re_test_key" });

    let attempts = 0;
    const stub = stubFetch(() => {
      attempts += 1;
      // Fail once with a 503, then succeed — the classic transient provider blip.
      return attempts === 1
        ? jsonResponse(503, { message: "service unavailable" })
        : jsonResponse(200, { id: "resend-after-retry" });
    });
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-retry:${lead.id}`,
        payload: { message: "Retry me" }
      });

      const first = await services.actionExecutor.execute(action);
      assert.equal(first.status, "RETRYING", "a 5xx must not burn the action");

      const retried = await services.actionExecutor.execute(await services.actionsRepository.getAction(action.id));
      assert.equal(retried.status, "EXECUTING");
      assert.equal(attempts, 2);

      const execution = await services.executionsRepository.latestForAction(action.id);
      assert.equal(execution.provider_reference, "resend-after-retry");
    } finally {
      stub.restore();
    }
  });
});

test("a 4xx from the provider is permanent and blocks the action instead of retrying forever", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, { provider: "resend", api_key: "re_bad_key" });
    const stub = stubFetch(() => jsonResponse(401, { message: "invalid api key" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-permanent:${lead.id}`,
        payload: { message: "Will not send" }
      });
      const result = await services.actionExecutor.execute(action);
      assert.equal(result.status, "BLOCKED", "a bad API key is not worth retrying");
      const stored = await services.actionsRepository.getAction(action.id);
      assert.match(stored.last_error || "", /401/);
    } finally {
      stub.restore();
    }
  });
});

test("a missing API key fails before any HTTP call is attempted", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, { provider: "resend" });
    const stub = stubFetch(() => {
      throw new Error("must not reach the network without a key");
    });
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-nokey:${lead.id}`,
        payload: { message: "No key" }
      });
      const result = await services.actionExecutor.execute(action);
      assert.equal(result.status, "BLOCKED");
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });
});

test("a lead with no email address is blocked rather than sent into the void", async () => {
  await withServices(async ({ services, organization }) => {
    await configureEmail(services, organization.id, { provider: "resend", api_key: "re_test_key" });
    const phoneOnly = await services.leadsRepository.createLead({
      organization_id: organization.id,
      name: "No Email",
      phone: "+919876543210",
      source: "MANUAL"
    });
    const stub = stubFetch(() => jsonResponse(200, { id: "never" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: phoneOnly.id,
        type: "SEND_EMAIL",
        idempotency_key: `resend-noemail:${phoneOnly.id}`,
        payload: { message: "Nowhere to go" }
      });
      const result = await services.actionExecutor.execute(action);
      assert.equal(result.status, "BLOCKED");
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });
});

test("SendGrid sends both parts and the custom args the event webhook needs", async () => {
  await withServices(async ({ services, organization, lead }) => {
    await configureEmail(services, organization.id, {
      provider: "sendgrid",
      api_key: "SG.test",
      from_email: "hello@relay.test"
    });
    const stub = stubFetch(() => jsonResponse(202, {}, { "x-message-id": "sg-message-1" }));
    try {
      const action = await services.actionsRepository.createAction({
        organization_id: organization.id,
        lead_id: lead.id,
        type: "SEND_EMAIL",
        idempotency_key: `sendgrid-send:${lead.id}`,
        payload: { message: "Hello from SendGrid" }
      });
      await services.actionExecutor.execute(action);

      const call = stub.calls[0];
      assert.equal(call.url, "https://api.sendgrid.com/v3/mail/send");
      assert.deepEqual(
        call.body.content.map((part) => part.type),
        ["text/plain", "text/html"]
      );
      // These are what let the Event Webhook attribute a delivery/bounce back to
      // the right action and tenant without trusting the caller.
      assert.equal(call.body.custom_args.relay_org_id, organization.id);
      assert.equal(call.body.custom_args.relay_action_id, action.id);

      const execution = await services.executionsRepository.latestForAction(action.id);
      assert.equal(execution.provider_reference, "sg-message-1");
    } finally {
      stub.restore();
    }
  });
});

test("provider credentials are never returned to the browser", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Secret Settings Org");

  await client.put("/api/settings", {
    organization_id: organization.id,
    category: "channel_email",
    values: { provider: "resend", api_key: "re_super_secret", from_email: "hello@relay.test" }
  });

  const settings = await client.get(`/api/settings?organization_id=${organization.id}`);
  const email = settings.settings.channel_email;
  assert.equal(email.api_key, MASKED_SECRET, "the key must be masked on read");
  assert.equal(email.api_key_configured, true, "but the UI can still tell it is set");
  assert.equal(email.from_email, "hello@relay.test", "non-secret settings are returned as-is");
  assert.equal(JSON.stringify(settings).includes("re_super_secret"), false, "the raw key must not appear anywhere");
});

test("saving settings without retyping the key keeps the stored key intact", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Secret Preserve Org");

  await client.put("/api/settings", {
    organization_id: organization.id,
    category: "channel_email",
    values: { provider: "resend", api_key: "re_original_key" }
  });

  // The Settings page loaded the mask and submits it back unchanged, which is
  // exactly what happens when a user edits only the from address.
  await client.put("/api/settings", {
    organization_id: organization.id,
    category: "channel_email",
    values: { provider: "resend", api_key: MASKED_SECRET, from_email: "new@relay.test" }
  });

  // Read the stored value directly: what matters is that the real credential
  // survived, which the masked API response cannot show by design.
  const stored = await client.db.get(
    "SELECT value FROM organization_settings WHERE organization_id = ? AND category = ? AND key = ?",
    [organization.id, "channel_email", "api_key"]
  );
  assert.equal(JSON.parse(stored.value), "re_original_key", "the mask must not overwrite the real key");

  const settings = await client.get(`/api/settings?organization_id=${organization.id}`);
  assert.equal(settings.settings.channel_email.from_email, "new@relay.test", "the edited field was saved");
  assert.equal(settings.settings.channel_email.api_key_configured, true);
});

test("clearing a key explicitly still works", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Secret Clear Org");

  await client.put("/api/settings", {
    organization_id: organization.id,
    category: "channel_email",
    values: { provider: "resend", api_key: "re_to_be_cleared" }
  });
  await client.put("/api/settings", {
    organization_id: organization.id,
    category: "channel_email",
    values: { provider: "sandbox", api_key: "" }
  });

  const settings = await client.get(`/api/settings?organization_id=${organization.id}`);
  assert.equal(settings.settings.channel_email.api_key_configured, false);
  assert.equal(settings.settings.channel_email.provider, "sandbox");
});
