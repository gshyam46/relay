import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { startClient } from "./helpers/testClient.js";

async function actionFixture(client, label, approvalRequired = false) {
  const { lead } = await client.post("/api/leads", { name: label, email: randomUUID() + "@example.com" });
  const { action } = await client.post("/api/leads/" + lead.id + "/actions", { type: "SEND_EMAIL" });
  if (approvalRequired) {
    await client.db.run("UPDATE actions SET approval_requirement = 'REQUIRED', status = 'AWAITING_APPROVAL' WHERE id = ?", [action.id]);
  }
  return { lead, action };
}

async function command(client, url, body = {}, method = "POST") {
  const response = await client.rawFetch(url, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function tenantState(db, organizationId) {
  const state = {};
  for (const table of ["leads", "actions", "action_approvals", "callbacks", "domain_events", "audit_logs", "channel_messages", "follow_up_tasks"]) {
    state[table] = await db.all("SELECT * FROM " + table + " WHERE organization_id = ? ORDER BY id", [organizationId]);
  }
  state.executions = await db.all(
    "SELECT e.* FROM action_executions e JOIN actions a ON a.id = e.action_id WHERE a.organization_id = ? ORDER BY e.id",
    [organizationId]
  );
  return state;
}

test("both synthetic callback paths deny foreign actions without state changes or record disclosure", async (t) => {
  const client = await startClient(t);
  const ownerA = await client.register("Callback A");
  assert.equal((await client.get("/api/auth/me")).capabilities.test_controls, true);
  const fixtureA = await actionFixture(client, "A recipient");
  await client.approve(fixtureA.action.id);
  await client.post("/api/actions/" + fixtureA.action.id + "/execute", {});
  await client.register("Callback B");
  const before = await tenantState(client.db, ownerA.organization.id);
  for (const legacy of [true, false]) {
    const endpoint = (id) => legacy ? "/api/callbacks/mock" : "/api/actions/" + id + "/callback";
    const foreign = await command(client, endpoint(fixtureA.action.id), {
      organization_id: ownerA.organization.id, action_id: fixtureA.action.id, provider_event_id: "forged-" + legacy
    });
    const missing = await command(client, endpoint("missing"), {
      action_id: "missing", provider_event_id: "missing-" + legacy
    });
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(foreign.body.error, missing.body.error);
    assert.equal(JSON.stringify(foreign.body).includes(fixtureA.lead.email), false);
    assert.deepEqual(await tenantState(client.db, ownerA.organization.id), before);
  }
  await client.login(ownerA.user.email);
  const own = await command(client, "/api/callbacks/mock", {
    action_id: fixtureA.action.id, provider_event_id: "own-callback"
  });
  assert.equal(own.status, 202);
  assert.equal(own.body.action.status, "COMPLETED");
});

test("callback event identities are tenant scoped and never return another tenant receipt", async (t) => {
  const client = await startClient(t);
  const a = await client.register("Replay A");
  const first = await actionFixture(client, "A");
  await client.approve(first.action.id);
  await client.post("/api/actions/" + first.action.id + "/execute", {});
  await client.post("/api/callbacks/mock", { action_id: first.action.id, provider_event_id: "shared-event" });
  const b = await client.register("Replay B");
  const second = await actionFixture(client, "B");
  await client.approve(second.action.id);
  await client.post("/api/actions/" + second.action.id + "/execute", {});
  const beforeA = await tenantState(client.db, a.organization.id);
  const beforeB = await tenantState(client.db, b.organization.id);
  const collision = await command(client, "/api/callbacks/mock", {
    action_id: second.action.id, provider_event_id: "shared-event"
  });
  assert.equal(collision.status, 202);
  assert.equal(collision.body.callback.organization_id, b.organization.id);
  assert.equal(collision.body.callback.action_id, second.action.id);
  assert.equal(JSON.stringify(collision.body).includes(first.action.id), false);
  assert.deepEqual(await tenantState(client.db, a.organization.id), beforeA);
  assert.equal((await tenantState(client.db, b.organization.id)).callbacks.length, beforeB.callbacks.length + 1);
  const duplicate = await command(client, "/api/callbacks/mock", { action_id: second.action.id, provider_event_id: "shared-event" });
  assert.equal(duplicate.body.duplicate, true);
  assert.equal((await tenantState(client.db, b.organization.id)).callbacks.length, 1);
});

test("sandbox HTTP worker processes only the authenticated workspace, including pending events", async (t) => {
  const client = await startClient(t);
  const a = await client.register("Worker A");
  await actionFixture(client, "A queued");
  const b = await client.register("Worker B");
  const own = await actionFixture(client, "B queued");
  await client.approve(own.action.id);
  const before = await tenantState(client.db, a.organization.id);
  const result = await client.post("/api/worker/run", { organization_id: a.organization.id });
  assert.ok(result.processed_events.length > 0);
  assert.ok(result.executed_actions.length > 0);
  assert.deepEqual(await tenantState(client.db, a.organization.id), before);
  assert.equal((await client.db.get("SELECT status FROM actions WHERE id = ?", [own.action.id])).status, "EXECUTING");
  const events = await client.db.all("SELECT status FROM domain_events WHERE organization_id = ?", [b.organization.id]);
  assert.ok(events.some((event) => event.status === "PROCESSED"));
});

const controls = [
  "/api/worker/run", "/api/workflows/run-due", "/api/callbacks/mock",
  "/api/inbound-events/mock", "/api/actions/missing/callback"
];
for (const environment of ["production", "staging", "development"]) {
  test(environment + " disables HTTP test controls before authentication and ignores forged switches", async (t) => {
    // Valid unrelated runtime settings keep this fixture focused on forged test controls.
    const config = loadConfig({ NODE_ENV: environment, ENABLE_TEST_CONTROLS: environment === "development" ? "false" : "true",
      PUBLIC_APP_ORIGIN: "https://app.example.test", AUTH_RATE_LIMIT_SECRET: "synthetic-test-only-auth-key-with-at-least-32-bytes" });
    if (environment !== "development") config.security.testControlsEnabled = true;
    const client = await startClient(t, ":memory:", { config });
    for (const route of controls) {
      const response = await fetch(client.baseUrl + route, { method: "POST" });
      assert.equal(response.status, 404, route + " without session");
    }
    const owner = await client.register("Disabled " + environment);
    assert.equal((await client.get("/api/auth/me")).capabilities.test_controls, false);
    assert.equal((await (await fetch(client.baseUrl + "/api/health")).json()).test_harness, undefined);
    const { lead } = await client.post("/api/leads", { name: "Normal restricted controls", email: "normal@example.test" });
    const action = await client.services.actionsRepository.createAction({ organization_id: owner.organization.id, lead_id: lead.id,
      type: "CREATE_HUMAN_TASK", idempotency_key: owner.organization.id + ":human" });
    const fixture = { lead, action };
    assert.equal((await command(client, "/api/leads/" + lead.id + "/actions", { type: "SEND_EMAIL" })).status, 409);
    const before = await tenantState(client.db, owner.organization.id);
    for (const route of controls) {
      const result = await command(client, route.replace("missing", fixture.action.id), {
        action_id: fixture.action.id, provider_event_id: "fake", lead_id: fixture.lead.id, channel: "EMAIL",
        event_type: "OPT_OUT", due_at: "2099-01-01T00:00:00.000Z", enable_test_controls: true
      });
      assert.equal(result.status, 404, route + " with session");
    }
    const injectionRoutes = [
      ["/api/leads/" + fixture.lead.id + "/research-evidence", { simulate_failure_stage: "AFTER_INGESTION" }],
      ["/api/leads/" + fixture.lead.id + "/synthesis/run", { simulate_failure_stage: "AFTER_SYNTHESIS" }],
      ["/api/leads/" + fixture.lead.id + "/intelligence-recommendation/run", { simulate_failure_stage: "AFTER_RECOMMENDATION" }],
      ["/api/leads/" + fixture.lead.id + "/next-best-action/plan", { simulate_failure_stage: "AFTER_POLICY" }],
      ["/api/imports/missing/commit", { simulate_failure_after_rows: 1 }],
      ["/api/leads/" + fixture.lead.id + "/actions", { mock_behavior: "PERMANENT_FAILURE" }]
    ];
    for (const [route, body] of injectionRoutes) {
      assert.equal((await command(client, route, body)).status, 403, route);
    }
    assert.deepEqual(await tenantState(client.db, owner.organization.id), before);
  });
}

test("test-control configuration defaults off and cannot be enabled in staging or production", () => {
  assert.equal(loadConfig({}).security.testControlsEnabled, false);
  assert.equal(loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: "true" }).security.testControlsEnabled, true);
  for (const env of ["staging", "stage", "production", "prod"]) {
    assert.equal(loadConfig({ NODE_ENV: env, ENABLE_TEST_CONTROLS: "true" }).security.testControlsEnabled, false);
  }
});

test("all approval entry points record the session reviewer and stable audit actor", async (t) => {
  const client = await startClient(t);
  const owner = await client.register("Actual reviewer", { name: "Actual Owner" });
  for (const kind of ["approve", "preview-approve", "reject", "bulk-approve", "bulk-reject"]) {
    const { action } = await actionFixture(client, kind, true);
    let review = await client.review(action.id);
    if (kind === "preview-approve") {
      review = await client.post("/api/actions/" + action.id + "/approval/preview", {
        expected_revision_id: review.prepared_revision.id, edited_payload: { body: "Approved text" }
      });
    }
    const body = {
      organization_id: "forged-org", reviewer_name: "Impersonated manager", reviewer_user_id: "forged-user",
      reviewer_note: "Reviewed", expected_revision_id: review.prepared_revision.id,
      revisions: [{ action_id: action.id, expected_revision_id: review.prepared_revision.id }]
    };
    const route = kind.startsWith("bulk-") ? "/api/actions/" + kind
      : "/api/actions/" + action.id + "/approval/" + (kind === "preview-approve" ? "approve" : kind);
    const result = await command(client, route, body);
    assert.equal(result.status, 200, kind);
    const approval = await client.db.get("SELECT * FROM action_approvals WHERE action_id = ?", [action.id]);
    assert.equal(approval.reviewer_name, owner.user.name);
    assert.equal(approval.reviewer_user_id, owner.user.id);
    const decisions = await client.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ?", [action.id]);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].reviewer_user_id, owner.user.id);
  }
});

test("non-owner mutations and settings access fail closed; changed session organization is invalid", async (t) => {
  const client = await startClient(t);
  const owner = await client.register("Role boundary");
  const { action } = await actionFixture(client, "Pending approval", true);
  await client.db.run("UPDATE users SET role = 'OPERATOR' WHERE id = ?", [owner.user.id]);
  const before = await tenantState(client.db, owner.organization.id);
  for (const [url, body, method] of [
    ["/api/settings", { category: "channel_email", values: { api_key: "fake" } }, "PUT"],
    ["/api/actions/" + action.id + "/approval/approve", {}, "POST"],
    ["/api/worker/run", {}, "POST"],
    ["/api/leads", { name: "Unpermitted" }, "POST"]
  ]) {
    assert.equal((await command(client, url, body, method)).status, 403, url);
  }
  for (const route of ["/api/settings", "/api/settings/channels/email/webhooks", "/api/actions/" + action.id + "/approval"]) {
    assert.equal((await client.rawFetch(route)).status, 403);
  }
  assert.deepEqual(await tenantState(client.db, owner.organization.id), before);
  await client.db.run("UPDATE users SET role = 'OWNER' WHERE id = ?", [owner.user.id]);
  assert.equal((await command(client, "/api/settings", { category: "general", values: { name: "Own settings" } }, "PUT")).status, 200);
  const other = await client.register("Other session organization");
  await client.login(owner.user.email);
  await client.db.run("UPDATE sessions SET organization_id = ? WHERE user_id = ?", [other.organization.id, owner.user.id]);
  assert.equal((await client.rawFetch("/api/auth/me")).status, 401);
});

for (const kind of ["reject", "execute"]) {
  test("mixed-tenant bulk " + kind + " preserves foreign action and reports per-item failure", async (t) => {
    const client = await startClient(t);
    const a = await client.register("Bulk A " + kind);
    const foreign = await actionFixture(client, "Foreign", kind === "reject");
    await client.register("Bulk B " + kind);
    const own = await actionFixture(client, "Own", kind === "reject");
    const before = await tenantState(client.db, a.organization.id);
    const body = kind === "reject"
      ? { revisions: [
        { action_id: foreign.action.id, expected_revision_id: "foreign-revision" },
        { action_id: own.action.id, expected_revision_id: (await client.review(own.action.id)).prepared_revision.id }
      ] }
      : { action_ids: [foreign.action.id, own.action.id] };
    const result = await client.post("/api/actions/bulk-" + kind, body);
    assert.equal(result.failed, 1);
    assert.equal(result.results.find((row) => row.action_id === foreign.action.id).ok, false);
    assert.equal(result.results.find((row) => row.action_id === own.action.id).ok, true);
    assert.deepEqual(await tenantState(client.db, a.organization.id), before);
  });
}

test("only a verified isolated harness advertises its identity and refuses live provider configuration", async (t) => {
  const env = { NODE_ENV: "test", DATABASE_FILE: ":memory:", ENABLE_TEST_CONTROLS: "true", ISOLATED_E2E_HARNESS: "1" };
  for (const override of [
    { NODE_ENV: "production" }, { NODE_ENV: "staging" }, { ENABLE_TEST_CONTROLS: "false" },
    { DATABASE_FILE: "existing.db" }, { DATABASE_URL: "postgres://invalid.example/test" },
    { OPENAI_API_KEY: "synthetic" }, { LLM_PROVIDER: "ollama" }
  ]) {
    assert.equal(loadConfig({ ...env, ...override }).security.isolatedE2eHarness, false);
  }
  const config = loadConfig(env);
  const client = await startClient(t, ":memory:", { config });
  const health = await (await fetch(client.baseUrl + "/api/health")).json();
  assert.deepEqual(health.test_harness, { kind: "isolated-e2e", database: "sqlite-memory", providers: "disabled" });
  const owner = await client.register("Isolated provider guard");
  const before = await client.db.all("SELECT * FROM organization_settings WHERE organization_id = ?", [owner.organization.id]);
  for (const category of ["channel_email", "channel_sms", "channel_whatsapp", "channel_call"]) {
    const result = await command(client, "/api/settings", {
      category, values: { provider: "live", api_key: "synthetic-key" }
    }, "PUT");
    assert.equal(result.status, 403);
  }
  assert.deepEqual(await client.db.all("SELECT * FROM organization_settings WHERE organization_id = ?", [owner.organization.id]), before);
  assert.equal((await command(client, "/api/settings", {
    category: "channel_email", values: { provider: "sandbox", api_key: "synthetic-key" }
  }, "PUT")).status, 409);
  const endpoint = "/api/settings/channels/email/connection";
  const current = await client.get(endpoint);
  const setup = { expected_revision: current.revision, review_token: current.review_token,
    request_key: "isolated-sandbox-setup", reason: "Review synthetic Sandbox configuration",
    values: { provider: "sandbox", from_email: "", reply_to: "", api_key: "synthetic-key", sendgrid_events_public_key: "", sendgrid_inbound_public_key: "" } };
  assert.equal((await command(client, endpoint, { ...setup, values: { ...setup.values, provider: "sendgrid" } }, "PUT")).status, 403);
  assert.equal((await command(client, endpoint, setup, "PUT")).status, 200);
  await client.services.settingsRepository.set(owner.organization.id, "channel_email", "provider", "sendgrid");
  const live = await client.get(endpoint);
  assert.equal((await command(client, endpoint + "/provision", { expected_revision: live.revision,
    review_token: live.review_token, request_key: "isolated-live-provision", reason: "Refuse isolated live route changes" }, "POST")).status, 403);
  assert.equal(Number((await client.db.get("SELECT count(*) n FROM email_webhook_routes")).n), 0);
});
