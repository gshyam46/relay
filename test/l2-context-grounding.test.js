import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { LocalRecommendationAgent } from "../src/modules/lead-intelligence/localRecommendationAgent.js";
import { buildGroundedContext } from "../src/modules/ai/grounding.js";

const provenance = { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic source record", observed_at: null };
function context(interest) {
  const result = Object.fromEntries(["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"].map(field =>
    [field, { state: "UNKNOWN", value: null, provenance: null }]));
  result.interest = interest;
  result.enquiry_date = { state: "KNOWN", value: "2026-09-10", provenance: { ...provenance, assertion: "OPERATOR_OBSERVED" } };
  return result;
}
const cases = [
  { name: "conflicted interest", interest: { state: "CONFLICTED", alternatives: [
    { value: "A dining table", provenance }, { value: "An office desk", provenance: { ...provenance, source_reference: "Second synthetic source" } }
  ] } },
  { name: "inferred interest", interest: { state: "KNOWN", value: "A dining table", provenance: { ...provenance, assertion: "INFERRED" } } }
];
for (const scenario of cases) {
  test("complete analysis turns " + scenario.name + " with an observed date and unknown budget into a review plan", async t => {
    const client = await startClient(t), registered = await client.register("Synthetic context grounding");
    const lead = await client.services.leadsRepository.createLead({ organization_id: registered.organization.id, name: "Synthetic recipient", email: "context@example.test", company: "Example" });
    await new BusinessContextService(client.db).updateEnquiry({ organization_id: lead.organization_id, lead_id: lead.id, actor: { id: registered.user.id, role: "OWNER" },
      expected_revision: 0, reason: "Preserve conflicting or inferred source context", enquiry: context(scenario.interest) });
    const result = await client.post("/api/intelligence/bulk-run", { organization_id: lead.organization_id, lead_ids: [lead.id] });
    assert.equal(result.failed, 0, JSON.stringify(result.results)); assert.equal(result.succeeded, 1);
    const current = await client.get("/api/leads/" + lead.id + "/intelligence?organization_id=" + lead.organization_id);
    assert.equal(current.intelligence.status, "READY"); assert.equal(current.synthesis_status, "READY");
    assert.equal(current.recommendation_status, "READY"); assert.equal(current.next_best_action_status, "PLANNED");
    assert.equal(current.synthesis.qualification.outcome, "NEEDS_REVIEW");
    assert.equal(current.recommendation.segment.type, "NEEDS_INTELLIGENCE_REVIEW");
    assert.equal(current.next_best_action.action_type, "REVIEW_LEAD_INTELLIGENCE");
    const claims = current.intelligence.claims;
    assert.equal(claims.some(claim => claim.field === "ENQUIRY_DATE" && claim.value === "2026-09-10"), true);
    assert.equal(claims.some(claim => ["ENQUIRY_INTEREST", "ENQUIRY_BUDGET"].includes(claim.field)), false);
    const marker = current.intelligence.evidence.find(item => item.metadata?.context_review_required === true);
    assert.ok(marker, "metadata-only source warning remains visible");
    assert.equal(buildGroundedContext({ lead, snapshot: current.intelligence }).lowConfidence, true);
    const allowed = new Set(claims.flatMap(claim => claim.evidence_ids));
    const enquiryEvidence = new Set(current.intelligence.evidence.filter(item => item.claim_field?.startsWith("ENQUIRY_")).map(item => item.id));
    for (const signal of current.intelligence.signals) {
      assert.equal(signal.evidence_ids.includes(marker.id), false, "non-claim warning is not represented as supporting a factual signal");
      assert.equal(signal.evidence_ids.every(id => allowed.has(id)), true);
      assert.equal(signal.evidence_ids.some(id => enquiryEvidence.has(id)), false, "unrelated enquiry values do not support contact/readiness signals");
    }
    assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
    assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM actions WHERE type LIKE 'SEND_%'")).n, 0);

    // Keep the strict grounding boundary: neither a metadata-only warning nor
    // an unknown/foreign reference can be promoted into factual signal support.
    const agent = new LocalRecommendationAgent();
    for (const invalidId of [marker.id, "missing-or-foreign-evidence"]) {
      const invalid = structuredClone(current.intelligence);
      invalid.signals[0].evidence_ids.push(invalidId);
      assert.throws(() => agent.recommend({ lead, snapshot: invalid, synthesis: current.synthesis }), /signal context/);
    }
    const rerun = await client.post("/api/intelligence/bulk-run", { organization_id: lead.organization_id });
    assert.equal(rerun.processed, 0, "a usable review recommendation is current, not a perpetual failed-analysis row");
  });
}
