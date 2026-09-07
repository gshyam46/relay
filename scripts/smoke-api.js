import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-smoke-"));
const databaseFile = path.join(tempDir, "smoke.db");
const db = createDatabase(databaseFile);
const server = createApp({ db });

try {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await get(`${baseUrl}/api/health`);
  assert.equal(health.product, "AI Lead Intelligence & Outbound Automation");

  const organization = await post(`${baseUrl}/api/organizations`, {
    name: "Smoke Workspace"
  });
  const preview = await post(`${baseUrl}/api/imports/csv/preview`, {
    organization_id: organization.organization.id,
    filename: "smoke.csv",
    csv_text: 'Name,Email,Company\nQuoted,quoted@example.com,"Company, With Comma"',
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  const committed = await post(`${baseUrl}/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: [preview.rows[0].id]
  });
  const leadId = committed.rows[0].created_lead_id;
  const beforeRun = await get(`${baseUrl}/api/leads/${leadId}/intelligence?organization_id=${organization.organization.id}`);
  assert.equal(beforeRun.intelligence_status, "NOT_RUN");
  assert.equal(beforeRun.readiness.status, "READY");

  const afterRun = await post(`${baseUrl}/api/leads/${leadId}/intelligence/run`, {
    organization_id: organization.organization.id
  });
  assert.equal(afterRun.intelligence_status, "GENERATED");
  assert.equal(afterRun.intelligence.recommendation.action_type, "READY_FOR_RESEARCH");

  await post(`${baseUrl}/api/leads/${leadId}/synthesis/run`, {
    organization_id: organization.organization.id
  });
  await post(`${baseUrl}/api/leads/${leadId}/intelligence-recommendation/run`, {
    organization_id: organization.organization.id
  });
  const plan = await post(`${baseUrl}/api/leads/${leadId}/next-best-action/plan`, {
    organization_id: organization.organization.id
  });
  const prepared = await post(`${baseUrl}/api/next-best-action-plans/${plan.next_best_action_plan.id}/action`, {
    organization_id: organization.organization.id
  });
  assert.equal(prepared.action.status, "AWAITING_APPROVAL");

  const manualAction = await post(`${baseUrl}/api/leads/${leadId}/actions`, {
    organization_id: organization.organization.id,
    type: "SEND_EMAIL",
    mock_behavior: "SUCCESS"
  });
  const execution = await post(`${baseUrl}/api/actions/${manualAction.action.id}/execute`, {
    organization_id: organization.organization.id
  });
  assert.equal(execution.execution_result.status, "EXECUTING");
  const callback = await post(`${baseUrl}/api/actions/${manualAction.action.id}/callback`, {
    organization_id: organization.organization.id,
    provider_event_id: "smoke-provider-event",
    status: "COMPLETED"
  });
  assert.equal(callback.action.status, "COMPLETED");

  console.log("Smoke check passed using isolated temporary database.");
} finally {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  await rm(tempDir, { recursive: true, force: true });
}

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return response.json();
}
