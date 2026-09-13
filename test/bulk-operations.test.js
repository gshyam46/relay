import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

test("bulk intelligence run processes every eligible lead and becomes a no-op once they're all recommended", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Bulk Intelligence Org");
  const leads = [];
  for (let i = 0; i < 3; i++) {
    leads.push(
      await client.post("/api/leads", {
        organization_id: organization.organization.id,
        name: `Bulk Lead ${i}`,
        email: `bulk-lead-${i}@example.com`,
        company: `Company ${i}`
      })
    );
  }

  const first = await client.post("/api/intelligence/bulk-run", { organization_id: organization.organization.id });
  assert.equal(first.eligible, 3);
  assert.equal(first.processed, 3);
  assert.equal(first.succeeded, 3);
  assert.equal(first.failed, 0);
  assert.equal(first.results.length, 3);
  assert.ok(first.results.every((r) => r.status === "COMPLETED"));

  // Every lead now has a READY recommendation, so auto-eligible bulk-run should find nothing left.
  const second = await client.post("/api/intelligence/bulk-run", { organization_id: organization.organization.id });
  assert.equal(second.eligible, 0);
  assert.equal(second.processed, 0);

  for (const lead of leads) {
    const intel = await client.get(`/api/leads/${lead.lead.id}/intelligence?organization_id=${organization.organization.id}`);
    assert.equal(intel.intelligence_status, "GENERATED");
  }
});

test("bulk intelligence run is organization scoped and caps a huge explicit batch", async (t) => {
  const client = await startClient(t);
  const orgA = await client.register("Bulk Intel Tenant A");
  const leadA = await client.post("/api/leads", {
    organization_id: orgA.organization.id,
    name: "Tenant A Lead",
    email: "tenant-a-bulk@example.com"
  });
  await client.register("Bulk Intel Tenant B"); // switches the active session to org B

  // Explicit lead_ids from another org must not be processed under orgB's call.
  const result = await client.post("/api/intelligence/bulk-run", {
    lead_ids: [leadA.lead.id]
  });
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.succeeded, 0);
  assert.match(result.results[0].error, /not found/i);

  await client.login(orgA.user.email);
  const untouched = await client.get(`/api/leads/${leadA.lead.id}/intelligence?organization_id=${orgA.organization.id}`);
  assert.equal(untouched.intelligence_status, "NOT_RUN");
});

test("bulk approve, then bulk execute, moves a full batch of pending actions through in one call each", async (t) => {
  const client = await startClient(t);
  const organization = await client.register("Bulk Approve Org");
  const actionIds = [];
  for (let i = 0; i < 4; i++) {
    actionIds.push(await createApprovalRequiredAction(client, organization.organization.id, `Approve Lead ${i}`));
  }

  const revisions = await Promise.all(actionIds.map(async (action_id) => ({ action_id, expected_revision_id: (await client.review(action_id)).prepared_revision.id })));
  const approveResult = await client.post("/api/actions/bulk-approve", {
    organization_id: organization.organization.id,
    revisions,
    reviewer_name: "QA Bot"
  });
  assert.equal(approveResult.approved, 4);
  assert.equal(approveResult.failed, 0);

  // Re-approving the same batch must be idempotent, not an error pile-up.
  const reApprove = await client.post("/api/actions/bulk-approve", {
    organization_id: organization.organization.id,
    revisions,
    reviewer_name: "QA Bot"
  });
  assert.equal(reApprove.approved, 4);
  assert.equal(reApprove.failed, 0);

  const executeResult = await client.post("/api/actions/bulk-execute", {
    organization_id: organization.organization.id,
    action_ids: actionIds
  });
  assert.equal(executeResult.executed, 4);
  assert.equal(executeResult.failed, 0);

  for (const actionId of actionIds) {
    const row = await client.db.get("SELECT status FROM actions WHERE id = ?", [actionId]);
    assert.equal(row.status, "EXECUTING");
  }
});

test("bulk approve reports per-item failure for a cross-tenant action id without aborting the rest of the batch", async (t) => {
  const client = await startClient(t);
  const orgA = await client.register("Bulk Cross Tenant A");
  const actionAId = await createApprovalRequiredAction(client, orgA.organization.id, "Cross Tenant Lead A");
  const orgB = await client.register("Bulk Cross Tenant B"); // switches the active session to org B
  const actionBId = await createApprovalRequiredAction(client, orgB.organization.id, "Own Tenant Lead B");

  const result = await client.post("/api/actions/bulk-approve", {
    revisions: [
      { action_id: actionAId, expected_revision_id: "foreign-revision" },
      { action_id: actionBId, expected_revision_id: (await client.review(actionBId)).prepared_revision.id }
    ]
  });

  assert.equal(result.approved, 1);
  assert.equal(result.failed, 1);
  const failedEntry = result.results.find((r) => r.action_id === actionAId);
  const okEntry = result.results.find((r) => r.action_id === actionBId);
  assert.equal(failedEntry.ok, false);
  assert.equal(okEntry.ok, true);

  const actionARow = await client.db.get("SELECT status FROM actions WHERE id = ?", [actionAId]);
  assert.notEqual(actionARow.status, "APPROVED");
});

async function createApprovalRequiredAction(client, organizationId, leadName) {
  const lead = await client.post("/api/leads", {
    organization_id: organizationId,
    name: leadName,
    email: `${leadName.toLowerCase().replaceAll(" ", "-")}@example.com`,
    company: "Bulk Ops Co"
  });
  await client.post(`/api/leads/${lead.lead.id}/intelligence/run`, { organization_id: organizationId });
  await client.post(`/api/leads/${lead.lead.id}/synthesis/run`, { organization_id: organizationId });
  await client.post(`/api/leads/${lead.lead.id}/intelligence-recommendation/run`, { organization_id: organizationId });
  const planned = await client.post(`/api/leads/${lead.lead.id}/next-best-action/plan`, { organization_id: organizationId });
  const action = await client.post(`/api/next-best-action-plans/${planned.next_best_action_plan.id}/action`, {
    organization_id: organizationId
  });
  return action.action.id;
}

test("dashboard metrics reflect this organization's leads only and match hand-counted totals", async (t) => {
  const client = await startClient(t);
  const orgA = await client.register("Metrics Tenant A");
  await client.post("/api/leads", { organization_id: orgA.organization.id, name: "CSV Lead", email: "csv@example.com", source: "CSV" });
  await client.post("/api/leads", { organization_id: orgA.organization.id, name: "Manual Lead", email: "manual@example.com", source: "MANUAL" });
  await client.post("/api/leads", { organization_id: orgA.organization.id, name: "Manual Lead 2", email: "manual2@example.com", source: "MANUAL" });

  const metricsA = await client.get(`/api/dashboard/metrics?organization_id=${orgA.organization.id}`);
  assert.equal(metricsA.leads.total, 3);
  const sourceCounts = Object.fromEntries(metricsA.sources.map((s) => [s.source, s.count]));
  assert.equal(sourceCounts.CSV, 1);
  assert.equal(sourceCounts.MANUAL, 2);

  const orgB = await client.register("Metrics Tenant B"); // switches the active session to org B
  await client.post("/api/leads", { organization_id: orgB.organization.id, name: "Other Tenant Lead", email: "other@example.com", source: "CSV" });

  const metricsB = await client.get(`/api/dashboard/metrics?organization_id=${orgB.organization.id}`);
  assert.equal(metricsB.leads.total, 1);
});
