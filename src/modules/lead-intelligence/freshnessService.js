import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { loadLeadBusinessContext } from "../business-context/businessContextRepository.js";
import { ENQUIRY_FIELDS } from "../business-context/businessContextContract.js";
import { enquiryValueText } from "./businessContextEvidence.js";
import { ResearchEvidenceRepository } from "./researchEvidenceRepository.js";
import { FreshnessRepository } from "./freshnessRepository.js";
import { assessSource, freshnessError, freshnessHash, parseFreshnessAssessment } from "./freshnessContract.js";
const FIELD_KEYS = { interest: "ENQUIRY_INTEREST", location: "ENQUIRY_LOCATION", budget: "ENQUIRY_BUDGET", timeline: "ENQUIRY_TIMELINE", enquiry_date: "ENQUIRY_DATE", last_interaction: "ENQUIRY_LAST_INTERACTION" };
export async function evaluateFreshness(db, lead, { now = Date.now } = {}) {
  if (!db.transactionBound) return new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, tx => evaluateFreshness(tx, lead, { now }));
  assertWorkspaceTransaction(db, lead.organization_id);
  const saved = await db.get("SELECT id,organization_id,data_revision,archived_at,name,email,phone,normalized_email,normalized_phone,company FROM leads WHERE organization_id=? AND id=?", [lead.organization_id, lead.id]);
  if (!saved) throw freshnessError("FRESHNESS_NOT_FOUND", "Enquiry not found in this workspace.", 404);
  const repository = new FreshnessRepository(db);
  const context = await loadLeadBusinessContext(db, { organization_id: lead.organization_id, lead_id: lead.id });
  const research = await new ResearchEvidenceRepository(db).evidenceItemsForLead(lead.id, lead.organization_id);
  const reply = await db.get("SELECT id,event_type,received_at FROM inbound_events WHERE organization_id=? AND lead_id=? ORDER BY received_at DESC,created_at DESC,id DESC LIMIT 1", [lead.organization_id, lead.id]);
  const revisions = { ...context.revisions, data_revision: Number(saved.data_revision || 0) };
  const adopted = Boolean(revisions.profile_revision || revisions.enquiry_revision || revisions.data_revision || research.length || reply);
  const physical = typeof now === "function" ? now() : now;
  if (!Number.isSafeInteger(physical) || !Number.isFinite(new Date(physical).getTime())) throw freshnessError("FRESHNESS_CLOCK_INVALID", "Freshness clock requires operational review.");
  const effective = adopted ? await repository.effectiveTime(lead.organization_id, physical) : physical;
  const facts = {}, values = [];
  for (const field of ENQUIRY_FIELDS) {
    const fact = context.enquiry.enquiry[field], historical = ["enquiry_date", "last_interaction"].includes(field);
    const assess = async (item, state = "KNOWN") => {
      const recorded_at = state === "UNKNOWN" ? null : await repository.recordedAt(lead.organization_id, lead.id, field, { value: item.value, provenance: item.provenance });
      const result = assessSource({ field, value_state: state, assertion: item.provenance?.assertion || null, source_reference: item.provenance?.source_reference || null, observed_at: item.provenance?.observed_at || null, recorded_at, historical }, effective);
      if (historical && state !== "UNKNOWN") {
        const recorded = Date.parse(recorded_at);
        // Date-only history has no zone: UTC+14 is the latest plausible local date.
        const latestDate = Number.isFinite(recorded) ? new Date(Math.min(Date.parse("9999-12-31T23:59:59.999Z"), recorded + 14 * 60 * 60 * 1000)).toISOString().slice(0, 10) : null;
        const future = field === "last_interaction" ? Date.parse(item.value) > recorded : latestDate && item.value > latestDate;
        if (future) { result.freshness = "FUTURE_DATED"; result.usable = false; if (!result.reasons.includes("FUTURE_DATED")) result.reasons.push("FUTURE_DATED"); }
      }
      return result;
    };
    if (fact.state === "CONFLICTED") {
      const alternatives = []; for (const item of fact.alternatives) alternatives.push(await assess(item));
      facts[field] = { ...assessSource({ field, value_state: "CONFLICTED" }, effective), alternatives };
    } else facts[field] = await assess(fact, fact.state);
    if (facts[field].usable) values.push({ field: FIELD_KEYS[field], value: enquiryValueText(field, fact.value), assessment: facts[field] });
  }
  const items = research.map(item => {
    const assessment = { ...assessSource({ field: item.claim_field, source_reference: item.source_reference, observed_at: item.evidence_timestamp, recorded_at: item.created_at }, effective), id: item.id, ingestion_id: item.ingestion_id };
    if (item.ingestion_state !== "PERSISTED") { assessment.usable = false; assessment.reasons.push("SOURCE_NOT_PERSISTED"); }
    if (assessment.usable) values.push({ field: item.claim_field, value: item.claim_value, assessment });
    return assessment;
  });
  const identities = { LEAD_NAME: saved.name, COMPANY_NAME: saved.company, CONTACT_EMAIL: saved.normalized_email || saved.email, CONTACT_PHONE: saved.normalized_phone || saved.phone };
  for (const [field, value] of Object.entries(identities)) if (value) values.push({ field, value, assessment: null });
  const byField = new Map();
  for (const row of values) { const group = byField.get(row.field) || []; group.push(row); byField.set(row.field, group); }
  for (const group of byField.values()) if (new Set(group.map(row => row.value)).size > 1) for (const row of group) if (row.assessment) {
    row.assessment.value_state = "CONFLICTED"; row.assessment.usable = false; if (!row.assessment.reasons.includes("CONFLICTED_FACT")) row.assessment.reasons.push("CONFLICTED_FACT");
  }
  const review = new Map(), transitions = [];
  for (const [scope, collection] of [["ENQUIRY", Object.values(facts)], ["RESEARCH", items]]) for (const item of collection) {
    for (const reason of item.reasons) { if (reason === "UNKNOWN_FACT" && !revisions.enquiry_revision) continue; const key = scope + ":" + reason, fields = review.get(key)?.fields || []; if (!fields.includes(item.field)) fields.push(item.field); review.set(key, { code: reason, scope, fields }); }
    for (const alternative of item.alternatives || [item]) if (alternative.freshness === "CURRENT" && alternative.expires_at) transitions.push(alternative.expires_at);
  }
  const source_fingerprint = freshnessHash({ revisions, research, reply });
  const assessment = { policy_version: adopted ? 1 : 0, evaluated_at: new Date(effective).toISOString(), next_transition_at: transitions.sort()[0] || null, current_revisions: revisions, source_fingerprint, facts, research: items, review_reasons: [...review.values()].sort((a,b) => a.scope.localeCompare(b.scope) || a.code.localeCompare(b.code)) };
  assessment.authority_fingerprint = adopted ? freshnessHash({ policy_version: assessment.policy_version, current_revisions: revisions, source_fingerprint, facts, research: items }) : null;
  return parseFreshnessAssessment(assessment);
}
