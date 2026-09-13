import { readIntelligenceView } from "../src/modules/lead-intelligence/intelligenceReadView.js";
import { createCurrentIntelligenceServices } from "../src/modules/lead-intelligence/currentIntelligence.js";
import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { emptyEnquiry, emptyProfile } from "../src/modules/business-context/businessContextContract.js";

async function fixture(t) {
  const client = await startClient(t);
  const registered = await client.register("Freshness HTTP");
  const { lead } = await client.post("/api/leads", { name: "Synthetic currentness", email: "currentness@example.test", company: "Synthetic buyer" });
  return { client, lead, ...registered, path: "/api/leads/" + lead.id + "/intelligence" };
}
const run = (f, ids = [f.lead.id]) => f.client.post("/api/intelligence/bulk-run", { lead_ids: ids });
const putEnquiry = (f, enquiry) => f.client.put("/api/leads/" + f.lead.id + "/enquiry-context", { expected_revision: 0, reason: "Record synthetic source", enquiry });
const fact = (value, observed_at = null) => ({ state: "KNOWN", value, provenance: { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic source note", observed_at } });

test("HTTP currentness distinguishes never analysed, outdated criteria and current refresh with bounded recommendation history", async t => {
  const f = await fixture(t);
  assert.equal((await f.client.get(f.path)).currentness.state, "NEVER_ANALYSED");
  const first = await run(f);
  assert.equal(first.succeeded, 1);
  assert.equal(first.results[0].reused, false);
  const original = await f.client.get(f.path);
  assert.equal(original.currentness.state, "CURRENT");
  assert.equal(original.recommendation_comparison.current.id, original.recommendation.id);
  assert.equal(original.recommendation_comparison.previous, null);
  const counts = await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = 'LeadIntelligenceUpdated'");
  const reuse = await run(f);
  assert.equal(reuse.results[0].reused, true);
  assert.deepEqual(await f.client.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = 'LeadIntelligenceUpdated'"), counts);
  const profile = { ...emptyProfile(), business_name: "Synthetic workshop", offerings: ["Custom desks"], service_areas: ["Pune"], timezone: "Asia/Kolkata", language: "English", required_criteria: ["Customer delivery area must be recorded"] };
  await f.client.put("/api/business-profile", { expected_revision: 0, reason: "Clarify qualification criteria", profile });
  const outdated = await f.client.get(f.path);
  assert.equal(outdated.currentness.state, "OUTDATED");
  assert.equal(outdated.intelligence, null);
  assert.equal(outdated.recommendation, null);
  assert.ok(outdated.currentness.reasons.some(reason => ["PROFILE_CHANGED", "LEGACY_ASSESSMENT_REQUIRED"].includes(reason.code)));
  assert.equal(outdated.recommendation_comparison.previous.id, original.recommendation.id);
  const summary = await f.client.get("/api/intelligence/summary");
  assert.equal(summary.leads.find(row => row.lead_id === f.lead.id).currentness.state, "OUTDATED");
  assert.equal((await run(f)).results[0].reused, false);
  const refreshed = await f.client.get(f.path);
  assert.equal(refreshed.currentness.state, "CURRENT");
  assert.equal(refreshed.currentness.current_revisions.profile_revision, 1);
  assert.equal(refreshed.recommendation_comparison.previous.id, original.recommendation.id);
  assert.notEqual(refreshed.recommendation_comparison.current.id, original.recommendation.id);
  assert.ok(refreshed.recommendation_comparison.input_changes.length > 0);
  assert.ok(refreshed.recommendation_comparison.limitations[0].includes("not proof"));
});

test("HTTP reassessment keeps undated and aged customer facts visible without inventing confirmation", async t => {
  const f = await fixture(t);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  await putEnquiry(f, { ...emptyEnquiry(), interest: fact("A saved request without an observation date"), location: fact({ locality: "Pune", country_code: "IN" }, old) });
  assert.equal((await run(f)).succeeded, 1);
  const view = await f.client.get(f.path);
  assert.equal(view.currentness.state, "CURRENT");
  assert.equal(view.freshness.facts.interest.freshness, "AGE_UNKNOWN");
  assert.equal(view.freshness.facts.location.freshness, "STALE");
  assert.equal(view.freshness.facts.interest.usable, false);
  assert.ok(!view.intelligence.claims.some(claim => ["ENQUIRY_INTEREST", "ENQUIRY_LOCATION"].includes(claim.field)));
  const source = await f.client.get("/api/leads/" + f.lead.id + "/enquiry-context");
  assert.equal(source.enquiry.interest.provenance.observed_at, null);
  assert.equal(source.enquiry.location.provenance.observed_at, old);
  const again = await run(f);
  assert.equal(again.results[0].reused, true);
  assert.deepEqual((await f.client.get("/api/leads/" + f.lead.id + "/enquiry-context")).enquiry, source.enquiry);
});

test("HTTP bulk refresh reports scoped per-lead failures safely and validates explicit selections", async t => {
  const f = await fixture(t);
  const original = f.client.services.synthesisService.synthesisAgent.synthesize;
  f.client.services.synthesisService.synthesisAgent.synthesize = async () => { throw new Error("SECRET provider body should not escape"); };
  t.after(() => { f.client.services.synthesisService.synthesisAgent.synthesize = original; });
  const failed = await run(f, [f.lead.id, "missing-lead"]);
  assert.equal(failed.failed, 2);
  assert.equal(failed.succeeded, 0);
  assert.equal(failed.results[0].code, "INTELLIGENCE_ANALYSIS_FAILED");
  assert.ok(!JSON.stringify(failed).includes("SECRET"));
  assert.equal(failed.results[1].code, "not_found");
  f.client.services.synthesisService.synthesisAgent.synthesize = original;
  const partial = await run(f, [f.lead.id, "missing-lead"]);
  assert.equal(partial.succeeded, 1);
  assert.equal(partial.failed, 1);
  for (const lead_ids of [[42], [" "], new Array(1001).fill(f.lead.id)]) {
    const response = await f.client.rawFetch("/api/intelligence/bulk-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lead_ids }) });
    assert.equal(response.status, 400);
  }
  const duplicate = await run(f, [f.lead.id, f.lead.id]);
  assert.equal(duplicate.processed, 1);
  assert.equal(duplicate.results[0].reused, true);
});

test("HTTP archived analysis remains historical, read-only and tenant scoped", async t => {
  const f = await fixture(t);
  await run(f);
  await f.client.post("/api/leads/" + f.lead.id + "/archive", { expected_revision: 0, archived: true, reason: "Close the synthetic enquiry" });
  const view = await f.client.get(f.path);
  assert.equal(view.currentness.state, "ARCHIVED");
  assert.equal(view.currentness.can_refresh, false);
  assert.equal(view.intelligence, null);
  assert.ok(view.recommendation_comparison.previous);
  const blocked = await run(f);
  assert.equal(blocked.failed, 1);
  assert.equal(blocked.results[0].code, "LEAD_ARCHIVED");
  await f.client.register("Foreign freshness workspace");
  assert.equal((await f.client.rawFetch(f.path)).status, 404);
});

test("composed currentness reads use one assessment instant even when the physical clock crosses expiry", async t => {
  const f = await fixture(t);
  const observed = Date.now() - 89 * 86400000, expiry = observed + 90 * 86400000;
  await putEnquiry(f, { ...emptyEnquiry(), interest: fact("Synthetic time-sensitive request", new Date(observed).toISOString()) });
  const services = createCurrentIntelligenceServices(f.client.db, { now: () => expiry - 1 });
  await services.intelligenceService.runForLead(f.lead);
  await services.synthesisService.runForLead(f.lead);
  await services.intelligenceRecommendationService.runForLead(f.lead);
  await services.nextBestActionService.planForLead(f.lead);
  let clockCalls = 0;
  const view = await readIntelligenceView(f.client.db, f.lead, { comparison: true, now: () => ++clockCalls === 1 ? expiry - 1 : expiry + 1 });
  assert.equal(clockCalls, 1, "one physical clock capture per composed database view");
  assert.equal(view.currentness.state, "CURRENT");
  assert.equal(view.currentness.assessed_at, new Date(expiry - 1).toISOString());
  assert.equal(view.freshness.facts.interest.freshness, "CURRENT");
  assert.equal(view.synthesis_status, "READY");
  assert.equal(view.recommendation_status, "READY");
  assert.ok(view.next_best_action);
  const expired = await readIntelligenceView(f.client.db, f.lead, { now: () => expiry });
  assert.equal(expired.currentness.state, "OUTDATED");
  assert.equal(expired.freshness.facts.interest.freshness, "STALE");
  assert.equal(expired.synthesis, null);
  assert.equal(expired.recommendation, null);
  assert.equal(expired.next_best_action, null);
});

test("HTTP refresh caps a selected batch at 50 and leaves the remaining owned lead untouched", async t => {
  const f = await fixture(t);
  const { lead: remaining } = await f.client.post("/api/leads", { name: "Deferred synthetic enquiry", email: "deferred@example.test" });
  const selected = [f.lead.id, ...Array.from({ length: 49 }, (_, i) => "missing-selected-" + i), remaining.id];
  const result = await run(f, selected);
  assert.equal(result.eligible, 51);
  assert.equal(result.processed, 50);
  assert.equal(result.remaining, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 49);
  assert.deepEqual(result.results.map(row => row.lead_id), selected.slice(0, 50));
  assert.equal((await f.client.get("/api/leads/" + remaining.id + "/intelligence")).currentness.state, "NEVER_ANALYSED");
  const resumed = await run(f, [remaining.id]);
  assert.equal(resumed.succeeded, 1);
  assert.equal(resumed.results[0].reused, false);
});
