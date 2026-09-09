import { parseJson, stringifyJson } from "../../database/database.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { NEXT_BEST_ACTION_PLAN_STATUS } from "./nextBestActionContract.js";

export class NextBestActionRepository {
  constructor(db) {
    this.db = db;
  }

  async findByFingerprint({ organization_id, lead_id, input_fingerprint, pipeline_version }) {
    return await this.db.get(
      `SELECT * FROM next_best_action_plans
        WHERE organization_id = ? AND lead_id = ? AND input_fingerprint = ? AND pipeline_version = ?
        LIMIT 1`,
      [organization_id, lead_id, input_fingerprint, pipeline_version]
    );
  }

  async createDraft({
    organization_id,
    lead_id,
    intelligence_recommendation_id,
    synthesis_id,
    snapshot_id,
    pipeline_version,
    input_fingerprint
  }) {
    const timestamp = nowIso();
    const plan = {
      id: createId("nba"),
      organization_id,
      lead_id,
      intelligence_recommendation_id,
      synthesis_id,
      snapshot_id,
      version: await this.nextVersionForLead(lead_id, organization_id),
      status: NEXT_BEST_ACTION_PLAN_STATUS.DRAFT,
      pipeline_version,
      input_fingerprint,
      action_type: "REVIEW_LEAD_INTELLIGENCE",
      title: "Plan next best action",
      rationale: "Next best action planning is being prepared.",
      policy_decision_json: stringifyJson({}),
      approval_json: stringifyJson({}),
      decision_evidence_refs_json: stringifyJson([]),
      execution_contract_json: stringifyJson({ executable: false }),
      last_error: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null
    };
    await this.db.run(
      `INSERT INTO next_best_action_plans
        (id, organization_id, lead_id, intelligence_recommendation_id, synthesis_id, snapshot_id,
         version, status, pipeline_version, input_fingerprint, action_type, title, rationale,
         policy_decision_json, approval_json, decision_evidence_refs_json, execution_contract_json,
         last_error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.id,
        plan.organization_id,
        plan.lead_id,
        plan.intelligence_recommendation_id,
        plan.synthesis_id,
        plan.snapshot_id,
        plan.version,
        plan.status,
        plan.pipeline_version,
        plan.input_fingerprint,
        plan.action_type,
        plan.title,
        plan.rationale,
        plan.policy_decision_json,
        plan.approval_json,
        plan.decision_evidence_refs_json,
        plan.execution_contract_json,
        plan.last_error,
        plan.created_at,
        plan.updated_at,
        plan.completed_at
      ]
    );
    return plan;
  }

  async markReady(id, { status, action_type, title, rationale, policy_decision, approval, decision_evidence_refs, execution_contract }) {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE next_best_action_plans
        SET status = ?, action_type = ?, title = ?, rationale = ?, policy_decision_json = ?,
            approval_json = ?, decision_evidence_refs_json = ?, execution_contract_json = ?,
            last_error = NULL, updated_at = ?, completed_at = ?
        WHERE id = ?`,
      [
        status,
        action_type,
        title,
        rationale,
        stringifyJson(policy_decision),
        stringifyJson(approval),
        stringifyJson(decision_evidence_refs),
        stringifyJson(execution_contract),
        timestamp,
        timestamp,
        id
      ]
    );
    return await this.getPlan(id);
  }

  async markFailed(id, error) {
    await this.db.run(
      `UPDATE next_best_action_plans
        SET status = ?, last_error = ?, updated_at = ?
        WHERE id = ?`,
      [NEXT_BEST_ACTION_PLAN_STATUS.FAILED, error.message || String(error), nowIso(), id]
    );
    return await this.getPlan(id);
  }

  async supersedeReadyPlans({ organization_id, lead_id, except_plan_id }) {
    await this.db.run(
      `UPDATE next_best_action_plans
        SET status = ?, updated_at = ?
        WHERE organization_id = ? AND lead_id = ? AND status IN ('PLANNED', 'BLOCKED') AND id <> ?`,
      [NEXT_BEST_ACTION_PLAN_STATUS.SUPERSEDED, nowIso(), organization_id, lead_id, except_plan_id]
    );
  }

  async getPlan(id) {
    return await this.db.get("SELECT * FROM next_best_action_plans WHERE id = ?", [id]);
  }

  async historyForLead(leadId, organizationId) {
    return await this.db.all(
      `SELECT * FROM next_best_action_plans
        WHERE lead_id = ? AND organization_id = ?
        ORDER BY version DESC, created_at DESC`,
      [leadId, organizationId]
    );
  }

  async nextVersionForLead(leadId, organizationId) {
    const row = await this.db.get(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM next_best_action_plans
        WHERE lead_id = ? AND organization_id = ?`,
      [leadId, organizationId]
    );
    return row.next_version;
  }

  planDetail(plan, organizationId = plan?.organization_id) {
    if (!plan || plan.organization_id !== organizationId) {
      return null;
    }
    return serializeNextBestActionPlan(plan);
  }
}

export function serializeNextBestActionPlan(plan) {
  return {
    ...plan,
    policy_decision: parseJson(plan.policy_decision_json) || {},
    approval: parseJson(plan.approval_json) || {},
    decision_evidence_refs: parseJson(plan.decision_evidence_refs_json) || [],
    execution_contract: parseJson(plan.execution_contract_json) || {}
  };
}
