import { parseJson, stringifyJson } from "../../database/database.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { INTELLIGENCE_RECOMMENDATION_STATUS } from "./intelligenceRecommendationContract.js";

export class IntelligenceRecommendationRepository {
  constructor(db) {
    this.db = db;
  }

  async findByFingerprint({ organization_id, lead_id, input_fingerprint, pipeline_version }) {
    return await this.db.get(
      `SELECT * FROM intelligence_recommendation_runs
        WHERE organization_id = ? AND lead_id = ? AND input_fingerprint = ? AND pipeline_version = ?
        LIMIT 1`,
      [organization_id, lead_id, input_fingerprint, pipeline_version]
    );
  }

  async createDraft({ organization_id, lead_id, synthesis_id, snapshot_id, pipeline_version, input_fingerprint }) {
    const timestamp = nowIso();
    const run = {
      id: createId("intel_rec"),
      organization_id,
      lead_id,
      synthesis_id,
      snapshot_id,
      version: await this.nextVersionForLead(lead_id, organization_id),
      status: INTELLIGENCE_RECOMMENDATION_STATUS.DRAFT,
      pipeline_version,
      input_fingerprint,
      priority_json: stringifyJson({}),
      segment_json: stringifyJson({}),
      personalization_json: stringifyJson([]),
      recommendation_json: stringifyJson({}),
      evidence_refs_json: stringifyJson([]),
      last_error: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null
    };
    await this.db.run(
      `INSERT INTO intelligence_recommendation_runs
        (id, organization_id, lead_id, synthesis_id, snapshot_id, version, status, pipeline_version,
         input_fingerprint, priority_json, segment_json, personalization_json, recommendation_json,
         evidence_refs_json, last_error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.organization_id,
        run.lead_id,
        run.synthesis_id,
        run.snapshot_id,
        run.version,
        run.status,
        run.pipeline_version,
        run.input_fingerprint,
        run.priority_json,
        run.segment_json,
        run.personalization_json,
        run.recommendation_json,
        run.evidence_refs_json,
        run.last_error,
        run.created_at,
        run.updated_at,
        run.completed_at
      ]
    );
    return run;
  }

  async markReady(id, { priority, segment, personalization_context, recommendation, evidence_refs }) {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE intelligence_recommendation_runs
        SET status = ?, priority_json = ?, segment_json = ?, personalization_json = ?,
            recommendation_json = ?, evidence_refs_json = ?, last_error = NULL,
            updated_at = ?, completed_at = ?
        WHERE id = ?`,
      [
        INTELLIGENCE_RECOMMENDATION_STATUS.READY,
        stringifyJson(priority),
        stringifyJson(segment),
        stringifyJson(personalization_context),
        stringifyJson(recommendation),
        stringifyJson(evidence_refs),
        timestamp,
        timestamp,
        id
      ]
    );
    return await this.getRun(id);
  }

  async markFailed(id, error) {
    await this.db.run(
      `UPDATE intelligence_recommendation_runs
        SET status = ?, last_error = ?, updated_at = ?
        WHERE id = ?`,
      [INTELLIGENCE_RECOMMENDATION_STATUS.FAILED, error.message || String(error), nowIso(), id]
    );
    return await this.getRun(id);
  }

  async supersedeReadyRuns({ organization_id, lead_id, except_run_id }) {
    await this.db.run(
      `UPDATE intelligence_recommendation_runs
        SET status = ?, updated_at = ?
        WHERE organization_id = ? AND lead_id = ? AND status = ? AND id <> ?`,
      [
        INTELLIGENCE_RECOMMENDATION_STATUS.SUPERSEDED,
        nowIso(),
        organization_id,
        lead_id,
        INTELLIGENCE_RECOMMENDATION_STATUS.READY,
        except_run_id
      ]
    );
  }

  async getRun(id) {
    return await this.db.get("SELECT * FROM intelligence_recommendation_runs WHERE id = ?", [id]);
  }

  async historyForLead(leadId, organizationId) {
    return await this.db.all(
      `SELECT * FROM intelligence_recommendation_runs
        WHERE lead_id = ? AND organization_id = ?
        ORDER BY version DESC, created_at DESC`,
      [leadId, organizationId]
    );
  }

  async nextVersionForLead(leadId, organizationId) {
    const row = await this.db.get(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM intelligence_recommendation_runs
        WHERE lead_id = ? AND organization_id = ?`,
      [leadId, organizationId]
    );
    return row.next_version;
  }

  runDetail(run, organizationId = run?.organization_id) {
    if (!run || run.organization_id !== organizationId) {
      return null;
    }
    return serializeIntelligenceRecommendationRun(run);
  }
}

export function serializeIntelligenceRecommendationRun(run) {
  return {
    ...run,
    priority: parseJson(run.priority_json) || {},
    segment: parseJson(run.segment_json) || {},
    personalization_context: parseJson(run.personalization_json) || [],
    recommendation: parseJson(run.recommendation_json) || {},
    evidence_refs: parseJson(run.evidence_refs_json) || []
  };
}
