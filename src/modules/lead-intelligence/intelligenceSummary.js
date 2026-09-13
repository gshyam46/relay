import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { readIntelligenceView } from "./intelligenceReadView.js";
import { compareBusinessPriority } from "./businessFit.js";

export const INTELLIGENCE_SUMMARY_PAGE_SIZE = 100;
export async function readIntelligenceSummary(db, organizationId, { after_lead_id = null, now = Date.now } = {}) {
  if (after_lead_id !== null && (typeof after_lead_id !== "string" || !after_lead_id.trim() || after_lead_id.trim() !== after_lead_id || after_lead_id.length > 200)) {
    throw Object.assign(new Error("after_lead_id must be a nonempty lead identifier of at most 200 characters."), { statusCode: 400 });
  }
  return new ContactPolicyService(db).withWorkspacePolicyTransaction(organizationId, async tx => {
    const at = now();
    const pageClause = " WHERE organization_id = ? AND archived_at IS NULL" + (after_lead_id === null ? "" : " AND id > ?") + " ORDER BY id ASC LIMIT ?";
    const parameters = [organizationId, ...(after_lead_id === null ? [] : [after_lead_id]), INTELLIGENCE_SUMMARY_PAGE_SIZE + 1];
    const bytes = field => "COALESCE(" + (tx.kind === "postgres" ? "octet_length(" + field + ")" : "length(CAST(" + field + " AS BLOB))") + ",0)";
    const fields = ["id","organization_id","name","email","phone","normalized_email","normalized_phone","company","source","import_batch_id","import_row_id","source_metadata_json","status","created_at","updated_at","archived_at","normalized_name_company_key"];
    const display = ["id","organization_id","name","email","phone","company","source"];
    const metadata = await tx.all("SELECT (" + fields.map(bytes).join("+") + ") AS data_bytes, CASE WHEN length(id)>200 OR " + display.map(field => bytes(field) + ">2048").join(" OR ") + " THEN 1 ELSE 0 END AS oversized FROM leads" + pageClause, parameters);
    if (metadata.slice(0, INTELLIGENCE_SUMMARY_PAGE_SIZE).some(row => Number(row.oversized) || Number(row.data_bytes)>1048576) || metadata.slice(0, INTELLIGENCE_SUMMARY_PAGE_SIZE).reduce((sum,row) => sum+Number(row.data_bytes),0)>8388608) {
      throw Object.assign(new Error("This page exceeds analysis display limits. Review its source data in Leads before loading priority."), {code:"INTELLIGENCE_SUMMARY_LIMIT",statusCode:409});
    }
    const candidates = await tx.all(
      "SELECT * FROM leads WHERE organization_id = ? AND archived_at IS NULL" +
      (after_lead_id === null ? "" : " AND id > ?") + " ORDER BY id ASC LIMIT ?",
      [organizationId, ...(after_lead_id === null ? [] : [after_lead_id]), INTELLIGENCE_SUMMARY_PAGE_SIZE]
    );
    const leads = candidates.slice(0, INTELLIGENCE_SUMMARY_PAGE_SIZE);
    const count = await tx.get("SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND archived_at IS NULL", [organizationId]);
    const rows = [], eligible = [];
    const mapStatus = status => ({ READY: "COMPLETED", DRAFT: "PENDING", FAILED: "FAILED" }[status] || status);
    for (const lead of leads) {
      const current = await readIntelligenceView(tx, lead, { now: () => at });
      const snap = current.snapshot, rec = current.recommendation, nba = current.next_best_action;
      if (current.recommendation_status !== "READY") eligible.push(lead.id);
      rows.push({
        lead_id: lead.id, name: lead.name, email: lead.email, company: lead.company, source: lead.source,
        lead_status: lead.status, intelligence_status: snap ? mapStatus(snap.status) : "NOT_RUN",
        currentness: current.currentness, freshness: summaryFreshness(current.freshness),
        business_fit: summaryFit(current.business_fit), attention_priority: current.attention_priority,
        intelligence_at: snap?.created_at || null, recommendation_status: rec ? mapStatus(rec.status) : "NOT_RUN",
        nba_status: nba ? mapStatus(nba.status) : null, nba_action_type: nba?.action_type || null, nba_title: nba?.title || null
      });
    }
    rows.sort(compareBusinessPriority);
    const totals = {
      total: rows.length,
      not_run: rows.filter(r => r.intelligence_status === "NOT_RUN").length,
      pending: rows.filter(r => r.intelligence_status === "PENDING").length,
      completed: rows.filter(r => r.intelligence_status === "COMPLETED").length,
      failed: rows.filter(r => r.intelligence_status === "FAILED").length,
      with_recommendation: rows.filter(r => r.recommendation_status === "COMPLETED").length,
      with_nba: rows.filter(r => r.nba_status !== null).length,
      eligible_for_analysis: eligible.length
    };
    return {
      leads: rows, totals, eligible_lead_ids: eligible,
      ranking: {
        basis: "CONFIGURED_CRITERIA_V1", scope: "RETURNED_LEADS", returned_count: rows.length,
        has_more: metadata.length > leads.length,
        next_after_lead_id: metadata.length > leads.length ? leads.at(-1).id : null,
        workspace_active_count: Number(count.n), assessed_at: rows[0]?.currentness.assessed_at || new Date(at).toISOString()
      }
    };
  });
}

function summaryFit(fit) {
  if (!fit) return null;
  return { version: fit.version, criteria_revision: fit.criteria_revision, status: fit.status, unassessed_profile_criteria: fit.unassessed_profile_criteria, attention_priority: fit.attention_priority,
    criterion_results: fit.criterion_results.map(({criterion_id,requirement,outcome,reason_codes,missing_fields}) => ({criterion_id,requirement,outcome,reason_codes,missing_fields})) };
}

function summaryFreshness(value) {
  if (!value) return null;
  const {policy_version,evaluated_at,next_transition_at,current_revisions,review_reasons}=value;
  return {policy_version,evaluated_at,next_transition_at,current_revisions,review_reasons};
}
