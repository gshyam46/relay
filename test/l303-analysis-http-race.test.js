import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

test("legacy bulk cannot label an old job current by mixing a newer analysis with its old draft action", async t => {
  const client = await startClient(t), { organization } = await client.register("Synthetic analysis result race");
  const { lead } = await client.post("/api/leads", { organization_id: organization.id, name: "Synthetic enquiry", email: "race@example.test", company: "Before" });
  const jobs = client.services.analysisJobsService, original = jobs.compatibilityResult.bind(jobs);
  let inserted = false, freshJob, oldResult;
  jobs.compatibilityResult = async command => {
    const result = await original(command);
    if (!inserted) {
      inserted = true; oldResult = result;
      // The first job has finished, but its HTTP adapter has not read the final
      // current view yet. Another owner action and analysis now finish first.
      await client.services.contactPolicyService.withWorkspacePolicyTransaction(organization.id,
        tx => tx.run("UPDATE leads SET company='After' WHERE organization_id=? AND id=?", [organization.id, lead.id]));
      const actor = await client.db.get("SELECT id,role FROM users WHERE organization_id=?", [organization.id]);
      const accepted = await jobs.enqueue({ organization_id: organization.id, request_key: "concurrent-new-analysis", lead_ids: [lead.id], mode: "PREPARE_DRAFTS", target_stage: "PLAN", actor });
      freshJob = (await jobs.processOnce({ organization_id: organization.id, job_id: accepted.job.id })).job;
    }
    return result;
  };
  const response = await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, request_key: "original-analysis", lead_ids: [lead.id] });
  assert.equal(freshJob.status, "COMPLETED", "the replacement analysis really completed before the original response");
  assert.notEqual(oldResult.item.artifacts.plan_id, freshJob.items[0].artifacts.plan_id);
  assert.ok(oldResult.item.artifacts.action_id);
  const oldAction = await client.db.get("SELECT next_best_action_plan_id FROM actions WHERE id=?", [oldResult.item.artifacts.action_id]);
  assert.equal(oldAction.next_best_action_plan_id, oldResult.item.artifacts.plan_id, "historical draft remains linked to its original plan");
  assert.equal(response.results[0].status, "FAILED");
  assert.equal(response.results[0].code, "INTELLIGENCE_CONTEXT_CHANGED");
  assert.equal(response.results[0].action_id, undefined, "the response must not label the old draft as the new current result");
  assert.equal(Number((await client.db.get("SELECT count(*) AS n FROM action_executions")).n), 0);
});
