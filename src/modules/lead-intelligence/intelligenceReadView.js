import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { createCurrentIntelligenceServices } from "./currentIntelligence.js";
import { currentLeadData } from "../data-foundation/leadDataSafety.js";
import { freshnessChanges, parseFreshnessAssessment } from "./freshnessContract.js";

// One short database view keeps badges, current artifacts and comparison on the
// same authority. The only read-side write is the documented freshness clock.
export async function readIntelligenceView(db, lead, { comparison = false, now = Date.now } = {}) {
  const read = async tx => {
    const currentLead = await currentLeadData(tx, lead, { allowArchived: true, checkRevision: false });
    const assessedAt = typeof now === "function" ? now() : now;
    const services = createCurrentIntelligenceServices(tx, { now: () => assessedAt });
    const intelligence = await services.intelligenceService.assessLead(currentLead);
    const synthesis = await services.synthesisService.currentForLead(currentLead);
    const recommendation = await services.intelligenceRecommendationService.currentForLead(currentLead);
    const plan = await services.nextBestActionService.currentForLead(currentLead);
    return {
      ...intelligence,
      intelligence: intelligence.snapshot,
      business_fit: intelligence.currentness.state === "CURRENT" ? intelligence.snapshot?.business_fit || null : null,
      attention_priority: intelligence.currentness.state === "CURRENT" ? intelligence.snapshot?.business_fit?.attention_priority || null : null,
      synthesis: synthesis.synthesis,
      synthesis_status: synthesis.synthesis_status,
      recommendation: recommendation.intelligence_recommendation,
      recommendation_status: recommendation.recommendation_status,
      next_best_action: plan.next_best_action_plan,
      next_best_action_status: plan.plan_status,
      ...(comparison ? { recommendation_comparison: await recommendationComparison(tx, currentLead, intelligence, recommendation.intelligence_recommendation) } : {})
    };
  };
  return db.transactionBound ? read(db) : new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, read);
}

async function recommendationComparison(db, lead, intelligence, current) {
  // Bound JSON in SQL before loading it. Do not materialise an unbounded history
  // or model text merely to show two recommendation descriptors.
  const rows = await db.all(
    `SELECT r.id, r.created_at, r.snapshot_id,
       substr(r.recommendation_json, 1, 8193) AS recommendation_json,
       substr(s.freshness_json, 1, 262145) AS freshness_json
     FROM intelligence_recommendation_runs r
     JOIN intelligence_snapshots s ON s.id = r.snapshot_id AND s.organization_id = r.organization_id AND s.lead_id = r.lead_id
     WHERE r.organization_id = ? AND r.lead_id = ? AND r.status IN ('READY','SUPERSEDED')
     ORDER BY r.version DESC, r.created_at DESC, r.id DESC LIMIT 2`,
    [lead.organization_id, lead.id]
  );
  const previousRow = rows.find(row => row.id !== current?.id) || null;
  const previousAssessment = previousRow ? parseFreshnessAssessment(previousRow.freshness_json) : null;
  const currentAssessment = intelligence.snapshot?.freshness || intelligence.freshness;
  return {
    current: current ? descriptor(current, intelligence.snapshot?.freshness || intelligence.freshness) : null,
    previous: previousRow ? descriptor(previousRow, previousAssessment) : null,
    input_changes: previousRow ? freshnessChanges(previousAssessment, currentAssessment) : [],
    limitations: ["Changed inputs and stored recommendations are shown together; this is not proof of why a model chose a recommendation."]
  };
}

function descriptor(row, assessment) {
  let recommendation = row.recommendation || {};
  if (row.recommendation_json) {
    try { recommendation = JSON.parse(row.recommendation_json); } catch { recommendation = {}; }
  }
  return {
    id: row.id,
    created_at: row.created_at,
    snapshot_id: row.snapshot_id,
    step: typeof recommendation.step === "string" ? recommendation.step.slice(0, 120) : null,
    reason: typeof recommendation.reason === "string" ? recommendation.reason.slice(0, 2000) : null,
    revisions: assessment?.current_revisions || null
  };
}
