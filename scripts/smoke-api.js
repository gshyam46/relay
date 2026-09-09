import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

// End-to-end smoke check against a real server on an isolated temporary
// database: register -> import a CSV -> intelligence -> synthesis ->
// recommendation -> next best action -> approval-gated action -> manual
// execution -> provider callback.
//
// Every /api/ route except health/register/login requires a session, so this
// registers a workspace first and carries the session cookie on every
// subsequent request.

const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-smoke-"));
const databaseFile = path.join(tempDir, "smoke.db");
const db = await createDatabase(databaseFile);
const server = createApp({ db });

let sessionCookie = null;

try {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await get(`${baseUrl}/api/health`);
  assert.equal(health.product, "AI Lead Intelligence & Outbound Automation");

  const ready = await get(`${baseUrl}/api/health/ready`);
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.migrations.pending, []);

  const registration = await post(`${baseUrl}/api/auth/register`, {
    organization_name: "Smoke Workspace",
    name: "Smoke Owner",
    email: "smoke-owner@test.relay.local",
    password: "correct-horse-battery-staple"
  });
  const organizationId = registration.organization.id;

  const preview = await post(`${baseUrl}/api/imports/csv/preview`, {
    organization_id: organizationId,
    filename: "smoke.csv",
    csv_text: 'Name,Email,Company\nQuoted,quoted@example.com,"Company, With Comma"',
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  const committed = await post(`${baseUrl}/api/imports/${preview.import.id}/commit`, {
    organization_id: organizationId,
    selected_row_ids: [preview.rows[0].id]
  });
  const leadId = committed.rows[0].created_lead_id;

  const beforeRun = await get(`${baseUrl}/api/leads/${leadId}/intelligence?organization_id=${organizationId}`);
  assert.equal(beforeRun.readiness.status, "READY");

  const afterRun = await post(`${baseUrl}/api/leads/${leadId}/intelligence/run`, {
    organization_id: organizationId
  });
  assert.equal(afterRun.intelligence.status, "READY");
  assert.ok(afterRun.intelligence.evidence.length > 0, "intelligence must be evidence-grounded");

  await post(`${baseUrl}/api/leads/${leadId}/synthesis/run`, { organization_id: organizationId });
  await post(`${baseUrl}/api/leads/${leadId}/intelligence-recommendation/run`, { organization_id: organizationId });
  const plan = await post(`${baseUrl}/api/leads/${leadId}/next-best-action/plan`, {
    organization_id: organizationId
  });
  const prepared = await post(`${baseUrl}/api/next-best-action-plans/${plan.next_best_action_plan.id}/action`, {
    organization_id: organizationId
  });
  assert.equal(prepared.action.status, "AWAITING_APPROVAL");

  const manualAction = await post(`${baseUrl}/api/leads/${leadId}/actions`, {
    organization_id: organizationId,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  const execution = await post(`${baseUrl}/api/actions/${manualAction.action.id}/execute`, {
    organization_id: organizationId
  });
  assert.equal(execution.execution_result.status, "EXECUTING");

  const callback = await post(`${baseUrl}/api/actions/${manualAction.action.id}/callback`, {
    organization_id: organizationId,
    provider_event_id: "smoke-provider-event",
    status: "COMPLETED"
  });
  assert.equal(callback.action.status, "COMPLETED");

  console.log("Smoke check passed using isolated temporary database.");
} finally {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await rm(tempDir, { recursive: true, force: true });
}

function authHeaders(extra = {}) {
  return sessionCookie ? { ...extra, cookie: `relay_session=${sessionCookie}` } : extra;
}

function captureCookie(response) {
  const raw = response.headers.get("set-cookie");
  const match = raw && /relay_session=([^;]+)/.exec(raw);
  if (match) {
    sessionCookie = match[1];
  }
}

async function get(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    assert.fail(`GET ${url} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    assert.fail(`POST ${url} -> ${response.status} ${await response.text()}`);
  }
  captureCookie(response);
  return response.json();
}
