import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { emptyProfile, emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";

const profile = (name = "Synthetic workshop") => ({ ...emptyProfile(), business_name: name, offerings: ["Made-to-measure desks"], service_areas: ["Pune"], required_criteria: ["Delivery location must be known"], timezone: "Asia/Kolkata", language: "English" });
const source = (assertion = "CUSTOMER_STATED") => ({ assertion, source_type: "MANUAL", source_reference: "Synthetic enquiry note", observed_at: "2026-09-10T10:00:00.000Z" });
const fact = (value, assertion) => ({ state: "KNOWN", value, provenance: source(assertion) });
const put = (client, route, body) => client.rawFetch(route, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function fixture(t) {
  const client = await startClient(t);
  const registered = await client.register("Context integration");
  const { lead } = await client.post("/api/leads", { name: "Synthetic enquiry", email: "context@example.test", company: "Synthetic buyer" });
  return { client, ...registered, lead, path: "/api/leads/" + lead.id + "/enquiry-context" };
}

test("context HTTP records sources and exact money, paginates history and rejects stale or forged ownership", async t => {
  const f = await fixture(t), { client } = f;
  assert.equal((await client.get("/api/business-profile")).revision, 0);
  assert.equal((await client.get(f.path)).enquiry.budget.state, "UNKNOWN");
  const saved = await client.put("/api/business-profile", { expected_revision: 0, reason: "Initial operator setup", profile: profile() });
  assert.equal(saved.revision, 1);
  assert.equal(saved.created_by, f.user.id);
  assert.equal((await put(client, "/api/business-profile", { expected_revision: 1, reason: "Spoof", profile: profile(), organization_id: f.organization.id })).status, 400);
  const enquiry = { ...emptyEnquiry(), interest: fact("Desk for the new office"), budget: fact({ currency: "INR", minimum: "9007199254740993.01", maximum: "9007199254740993.99" }) };
  const first = await client.put(f.path, { expected_revision: 0, reason: "Record customer statement", enquiry });
  assert.deepEqual(first.enquiry.budget.value, { currency: "INR", scale: 2, minimum_minor: "900719925474099301", maximum_minor: "900719925474099399" });
  assert.equal(first.enquiry.enquiry_date.state, "UNKNOWN", "capture time cannot invent enquiry time");
  const changed = { ...first.enquiry, interest: fact("Two desks") };
  assert.equal((await client.put(f.path, { expected_revision: 1, reason: "Correction", enquiry: changed })).revision, 2);
  const stale = await put(client, f.path, { expected_revision: 1, reason: "Stale draft", enquiry: first.enquiry });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "BUSINESS_CONTEXT_STALE");
  const page = await client.get(f.path + "/history?limit=1");
  assert.equal(page.items[0].revision, 2); assert.equal(page.next_before_revision, 2);
  const older = await client.get(f.path + "/history?before_revision=2&limit=1");
  assert.equal(older.items[0].enquiry.interest.value, "Desk for the new office"); assert.equal(older.next_before_revision, null);
  assert.equal((await client.rawFetch(f.path + "/history?limit=0")).status, 400);
  assert.equal((await client.rawFetch(f.path + "/history?before_revision=1e2")).status, 400);
  await client.register("Foreign context workspace");
  assert.equal((await client.rawFetch(f.path)).status, 404);
  assert.equal((await client.rawFetch(f.path + "/history")).status, 404);
  assert.equal((await put(client, f.path, { expected_revision: 2, reason: "Foreign mutation", enquiry: changed })).status, 404);
  assert.equal((await client.get("/api/business-profile")).revision, 0);
});

test("context HTTP requires current owner role while allowing scoped member reads", async t => {
  const f = await fixture(t), { client } = f;
  await client.db.run("UPDATE users SET role = 'MEMBER' WHERE id = ?", [f.user.id]);
  assert.equal((await client.get(f.path)).revision, 0);
  assert.equal((await client.get("/api/business-profile")).revision, 0);
  assert.equal((await put(client, f.path, { expected_revision: 0, reason: "No authority", enquiry: emptyEnquiry() })).status, 403);
  assert.equal((await put(client, "/api/business-profile", { expected_revision: 0, reason: "No authority", profile: profile() })).status, 403);
});

test("revised context makes summaries and old plans stale without rewriting history or creating sends", async t => {
  const f = await fixture(t), { client } = f;
  const services = client.services;
  const snapshot = await services.intelligenceService.runForLead(f.lead);
  await services.synthesisService.runForLead(f.lead);
  await services.intelligenceRecommendationService.runForLead(f.lead);
  const plan = await services.nextBestActionService.planForLead(f.lead);
  const before = await client.get("/api/intelligence/summary");
  assert.equal(before.leads.find(item => item.lead_id === f.lead.id).intelligence_status, "COMPLETED");
  await client.put("/api/business-profile", { expected_revision: 0, reason: "Actual offering", profile: profile() });
  const current = await services.intelligenceService.assessLead(f.lead);
  assert.equal(current.snapshot, null);
  assert.equal(current.business_context.revisions.profile_revision, 1);
  const summary = await client.get("/api/intelligence/summary");
  const row = summary.leads.find(item => item.lead_id === f.lead.id);
  assert.equal(row.intelligence_status, "NOT_RUN"); assert.equal(row.recommendation_status, "NOT_RUN"); assert.equal(row.nba_status, null);
  assert.ok(summary.eligible_lead_ids.includes(f.lead.id));
  const attention = await client.get("/api/dashboard/attention");
  assert.ok(attention.items.some(item => item.lead_id === f.lead.id && item.reason === "Needs analysis"));
  const stalePlan = await client.rawFetch("/api/next-best-action-plans/" + plan.id + "/action", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(stalePlan.status, 409);
  assert.equal((await client.db.get("SELECT status FROM intelligence_snapshots WHERE id = ?", [snapshot.id])).status, "READY", "immutable history remains rather than mass invalidation");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  const refreshed = await services.intelligenceService.runForLead(f.lead);
  assert.notEqual(refreshed.id, snapshot.id);
  assert.equal((await services.intelligenceService.runForLead(f.lead)).id, refreshed.id);
});

test("known enquiry evidence preserves exact provenance while conflicting and inferred values never become asserted facts", async t => {
  const f = await fixture(t), { client } = f;
  const enquiry = { ...emptyEnquiry(), interest: fact("Two desks"), budget: fact({ currency: "KWD", minimum: "0.001", maximum: "0.001" }),
    timeline: fact({ description: "Probably next month", target_date: null }, "INFERRED"),
    location: { state: "CONFLICTED", alternatives: [
      { value: { locality: "Pune", country_code: "IN" }, provenance: source() },
      { value: { locality: "Mumbai", country_code: "IN" }, provenance: source("OPERATOR_OBSERVED") }
    ] }
  };
  await client.put(f.path, { expected_revision: 0, reason: "Record unresolved source facts", enquiry });
  const snapshot = await client.services.intelligenceService.runForLead(f.lead);
  const budget = snapshot.claims.find(item => item.field === "ENQUIRY_BUDGET");
  assert.equal(budget.value, "KWD 0.001"); assert.equal(budget.confidence, "MEDIUM");
  const evidence = snapshot.evidence.find(item => item.id === budget.evidence_ids[0]);
  assert.equal(evidence.evidence_timestamp, source().observed_at);
  assert.equal(evidence.source_reference, source().source_reference);
  assert.equal(evidence.metadata.assertion, "CUSTOMER_STATED"); assert.equal(evidence.metadata.source_verified, false);
  for (const field of ["ENQUIRY_LOCATION", "ENQUIRY_TIMELINE", "ENQUIRY_DATE"]) assert.equal(snapshot.claims.some(item => item.field === field), false);
  const synthesis = await client.services.synthesisService.runForLead(f.lead);
  assert.equal(synthesis.qualification.outcome, "NEEDS_REVIEW");
  const state = await client.services.intelligenceService.assessLead(f.lead);
  assert.ok(state.context_warnings.some(item => item.field === "location" && item.state === "CONFLICTED"));
  assert.ok(state.context_warnings.some(item => item.field === "timeline" && item.assertion === "INFERRED"));
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("HTTP synthesis racing a profile save returns a context conflict without publishing stale output", async t => {
  const f = await fixture(t), { client } = f, services = client.services;
  await services.intelligenceService.runForLead(f.lead);
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const agent = services.synthesisService.synthesisAgent, original = agent.synthesize.bind(agent);
  agent.synthesize = async input => { started(); await gate; return original(input); };
  const responsePromise = client.rawFetch("/api/leads/" + f.lead.id + "/synthesis/run", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  });
  try {
    await entered;
    await client.put("/api/business-profile", { expected_revision: 0, reason: "Changed while synthesis was running", profile: profile() });
  } finally { release(); }
  const response = await responsePromise;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "INTELLIGENCE_CONTEXT_CHANGED");
  assert.equal((await services.synthesisService.currentForLead(f.lead)).synthesis, null);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM intelligence_synthesis_runs WHERE status = 'READY'")).n, 0);
});
