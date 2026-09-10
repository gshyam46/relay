import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

// The Intelligence workspace defects found while verifying the production
// foundation end to end in a browser. Both were shipped and invisible to the
// test suite because nothing asserted the relationship between what the summary
// endpoint reports and what the bulk endpoint would actually do.

async function createLead(client, organizationId, name) {
  const response = await client.post("/api/leads", {
    organization_id: organizationId,
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    company: `${name} Co`,
    source: "MANUAL"
  });
  return response.lead;
}

test("a freshly created lead is eligible for analysis even though it already has a snapshot", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Eligibility Org");
  await createLead(client, organization.id, "Asha Menon");

  // Creating a lead queues a LeadCreated event; the background worker turns that
  // into the initial readiness snapshot. The live server runs that worker on an
  // interval, so by the time a user looks at the workspace the snapshot exists —
  // which is exactly the state the bug appeared in. Tests drive the worker
  // explicitly instead of waiting.
  await client.post("/api/worker/run", { organization_id: organization.id });

  const summary = await client.get(`/api/intelligence/summary?organization_id=${organization.id}`);

  // The bug: `not_run` counts leads with no intelligence SNAPSHOT, and creating a
  // lead always produces an initial readiness snapshot. The UI disabled the bulk
  // action on !not_run, so it was permanently disabled.
  assert.equal(summary.totals.not_run, 0, "creating a lead produces a snapshot, so not_run is 0");
  assert.equal(summary.totals.eligible_for_analysis, 1, "but the lead still needs analysing");
  assert.equal(summary.eligible_lead_ids.length, 1);
});

test("summary eligibility matches exactly what bulk-run would process", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Eligibility Parity Org");
  for (const name of ["Lead One", "Lead Two", "Lead Three"]) {
    await createLead(client, organization.id, name);
  }

  const before = await client.get(`/api/intelligence/summary?organization_id=${organization.id}`);
  assert.equal(before.totals.eligible_for_analysis, 3);

  // Running with no explicit ids must pick exactly the same set the summary
  // advertised — this is the invariant that keeps the button honest.
  const run = await client.post("/api/intelligence/bulk-run", { organization_id: organization.id });
  assert.equal(run.eligible, before.totals.eligible_for_analysis);
  assert.deepEqual([...run.results.map((r) => r.lead_id)].sort(), [...before.eligible_lead_ids].sort());
  assert.equal(run.succeeded, 3);
  assert.equal(run.failed, 0);

  const after = await client.get(`/api/intelligence/summary?organization_id=${organization.id}`);
  assert.equal(after.totals.eligible_for_analysis, 0, "nothing left to analyse");
  assert.deepEqual(after.eligible_lead_ids, []);
  assert.equal(after.totals.with_recommendation, 3);

  // And a second run is a genuine no-op rather than redundant work.
  const rerun = await client.post("/api/intelligence/bulk-run", { organization_id: organization.id });
  assert.equal(rerun.eligible, 0);
  assert.equal(rerun.processed, 0);
});

test("analysing a single lead runs the COMPLETE pipeline, not just the readiness snapshot", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Single Lead Pipeline Org");
  const lead = await createLead(client, organization.id, "Rahul Iyer");

  // This is what the workspace row button now calls: the bulk endpoint with one
  // id. Previously it called /intelligence/run, which only refreshes the
  // readiness snapshot, so a lead could never reach "recommendation ready" from
  // the workspace at all.
  const result = await client.post("/api/intelligence/bulk-run", {
    organization_id: organization.id,
    lead_ids: [lead.id]
  });
  assert.equal(result.processed, 1);
  assert.equal(result.succeeded, 1);

  const intelligence = await client.get(`/api/leads/${lead.id}/intelligence?organization_id=${organization.id}`);
  assert.equal(intelligence.intelligence.status, "READY", "readiness snapshot ran");
  assert.equal(intelligence.synthesis_status, "READY", "synthesis ran");
  assert.equal(intelligence.recommendation_status, "READY", "recommendation ran");
  assert.equal(intelligence.next_best_action_status, "PLANNED", "next best action was planned");
  assert.ok(intelligence.next_best_action, "the plan itself is returned, not just its status");

  const row = (await client.get(`/api/intelligence/summary?organization_id=${organization.id}`)).leads.find(
    (r) => r.lead_id === lead.id
  );
  assert.equal(row.intelligence_status, "COMPLETED");
  assert.equal(row.recommendation_status, "COMPLETED");
  assert.ok(row.nba_status, "the workspace row shows a next-best-action once analysed");
});

test("bulk-run only ever touches the caller's own leads", async (t) => {
  const owner = await startClient(t);
  const { organization: mine } = await owner.register("Tenant A Intelligence");
  const myLead = await createLead(owner, mine.id, "My Lead");

  const other = await startClient(t, ":memory:");
  const { organization: theirs } = await other.register("Tenant B Intelligence");

  // Asking tenant B to analyse tenant A's lead must fail rather than cross over.
  const crossTenant = await other.rawFetch("/api/intelligence/bulk-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: theirs.id, lead_ids: [myLead.id] })
  });
  assert.equal(crossTenant.status, 200, "the batch itself succeeds");
  const body = await crossTenant.json();
  assert.equal(body.succeeded, 0, "but the foreign lead is not analysed");
  assert.equal(body.failed, 1);

  // Tenant A's lead is untouched.
  const summary = await owner.get(`/api/intelligence/summary?organization_id=${mine.id}`);
  assert.equal(summary.totals.eligible_for_analysis, 1);
});
