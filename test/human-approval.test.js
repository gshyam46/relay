import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startClient } from "./helpers/testClient.js";

test("approval-required action creates one pending approval request", async (t) => {
  const client = await startClient(t);
  const { organization, lead, plan } = await createReadyPlan(client, "M5 Pending Org");

  const first = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });
  const second = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });
  const queue = await client.get(`/api/approvals?organization_id=${organization.id}`);

  assert.equal(first.action.id, second.action.id);
  assert.equal(first.action.status, "AWAITING_APPROVAL");
  assert.equal(first.action.approval.status, "PENDING");
  assert.equal(queue.approvals.length, 1);
  assert.equal(queue.approvals[0].lead_id, lead.id);
  assert.equal((await client.db.all("SELECT * FROM action_approvals WHERE action_id = ?", [first.action.id])).length, 1);
});

test("approving an action is idempotent and allows sandbox execution", async (t) => {
  const client = await startClient(t);
  const { organization, plan } = await createReadyPlan(client, "M5 Approve Org");
  const prepared = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });

  const approved = await client.post(`/api/actions/${prepared.action.id}/approval/approve`, {
    organization_id: organization.id,
    reviewer_name: "Ops reviewer",
    reviewer_note: "Looks good."
  });
  const repeated = await client.post(`/api/actions/${prepared.action.id}/approval/approve`, {
    organization_id: organization.id,
    reviewer_name: "Ops reviewer",
    reviewer_note: "Looks good."
  });
  const started = await client.post(`/api/actions/${prepared.action.id}/execute`, {
    organization_id: organization.id
  });

  assert.equal(approved.approval.status, "APPROVED");
  assert.equal(approved.action.status, "APPROVED");
  assert.equal(repeated.approval.id, approved.approval.id);
  assert.equal(started.execution_result.status, "EXECUTING");
  assert.equal((await client.db.all("SELECT * FROM action_approvals WHERE action_id = ?", [prepared.action.id])).length, 1);
});

test("edit and approve stores reviewed payload without losing action metadata", async (t) => {
  const client = await startClient(t);
  const { organization, plan } = await createReadyPlan(client, "M5 Edit Org");
  const prepared = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });

  const approved = await client.post(`/api/actions/${prepared.action.id}/approval/edit-and-approve`, {
    organization_id: organization.id,
    reviewer_name: "Sales lead",
    reviewer_note: "Use a warmer opener.",
    edited_payload: {
      instruction: "Use a warmer opener before contacting."
    }
  });
  const detail = await client.get(`/api/actions/${prepared.action.id}/approval?organization_id=${organization.id}`);

  assert.equal(approved.approval.status, "APPROVED");
  assert.deepEqual(approved.approval.edited_payload, {
    instruction: "Use a warmer opener before contacting."
  });
  assert.equal(detail.action.payload.source, "NEXT_BEST_ACTION_PLAN");
  assert.deepEqual(detail.action.payload.human_review.edited_payload, {
    instruction: "Use a warmer opener before contacting."
  });
});

test("rejecting an action blocks execution and cannot be reversed by approve", async (t) => {
  const client = await startClient(t);
  const { organization, plan } = await createReadyPlan(client, "M5 Reject Org");
  const prepared = await client.post(`/api/next-best-action-plans/${plan.id}/action`, {
    organization_id: organization.id
  });

  const rejected = await client.post(`/api/actions/${prepared.action.id}/approval/reject`, {
    organization_id: organization.id,
    reviewer_name: "Manager",
    reviewer_note: "Do not contact yet."
  });
  const execute = await client.rawFetch(`/api/actions/${prepared.action.id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.id })
  });
  const approveAfterReject = await client.rawFetch(`/api/actions/${prepared.action.id}/approval/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: organization.id })
  });

  assert.equal(rejected.approval.status, "REJECTED");
  assert.equal(rejected.action.status, "BLOCKED");
  assert.equal(execute.status, 202);
  assert.equal((await execute.json()).execution_result.executable, false);
  assert.equal(approveAfterReject.status, 409);
});

test("approval APIs are organization scoped and validate decision inputs", async (t) => {
  const client = await startClient(t);
  const first = await createReadyPlan(client, "M5 Tenant A");
  const prepared = await client.post(`/api/next-best-action-plans/${first.plan.id}/action`, {
    organization_id: first.organization.id
  });

  await client.register("M5 Tenant B"); // switches the active session to org B
  const wrongQueue = await client.get("/api/approvals");
  const wrongApprove = await client.rawFetch(`/api/actions/${prepared.action.id}/approval/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });

  await client.login(first.user.email); // back to org A: this call tests input validation, not isolation
  const invalidApprove = await client.rawFetch(`/api/actions/${prepared.action.id}/approval/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewer_name: 123 })
  });

  assert.equal(wrongQueue.approvals.length, 0);
  assert.equal(wrongApprove.status, 404);
  assert.equal(invalidApprove.status, 400);
});

test("approval state survives restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m5-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const { organization, plan, user } = await createReadyPlan(firstClient, "M5 Restart Org");
    const prepared = await firstClient.post(`/api/next-best-action-plans/${plan.id}/action`, {
      organization_id: organization.id
    });
    await firstClient.post(`/api/actions/${prepared.action.id}/approval/approve`, {
      organization_id: organization.id,
      reviewer_name: "Restart reviewer"
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(user.email);
    const detail = await secondClient.get(`/api/actions/${prepared.action.id}/approval?organization_id=${organization.id}`);
    const queue = await secondClient.get(`/api/approvals?organization_id=${organization.id}&status=APPROVED`);

    assert.equal(detail.approval.status, "APPROVED");
    assert.equal(detail.action.status, "APPROVED");
    assert.equal(queue.approvals.length, 1);
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createReadyPlan(client, organizationName) {
  const registered = await client.register(organizationName);
  const organization = registered.organization;
  const leadResponse = await client.post("/api/leads", {
    organization_id: organization.id,
    name: "M5 Ready Lead",
    email: `${organizationName.toLowerCase().replaceAll(" ", "-")}@example.com`,
    company: "M5 Ready Co"
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence/run`, {
    organization_id: organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/synthesis/run`, {
    organization_id: organization.id
  });
  await client.post(`/api/leads/${leadResponse.lead.id}/intelligence-recommendation/run`, {
    organization_id: organization.id
  });
  const planned = await client.post(`/api/leads/${leadResponse.lead.id}/next-best-action/plan`, {
    organization_id: organization.id
  });
  return { organization, user: registered.user, lead: leadResponse.lead, plan: planned.next_best_action_plan };
}
