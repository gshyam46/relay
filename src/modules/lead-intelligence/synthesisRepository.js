import { parseJson, stringifyJson } from "../../database/database.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { SYNTHESIS_STATUS } from "./synthesisContract.js";

export class SynthesisRepository {
  constructor(db) {
    this.db = db;
  }

  async findByFingerprint({ organization_id, lead_id, input_fingerprint, pipeline_version }) {
    return await this.db.get(
      `SELECT * FROM intelligence_synthesis_runs
        WHERE organization_id = ? AND lead_id = ? AND input_fingerprint = ? AND pipeline_version = ?
        LIMIT 1`,
      [organization_id, lead_id, input_fingerprint, pipeline_version]
    );
  }

  async createDraft({ organization_id, lead_id, snapshot_id, pipeline_version, input_fingerprint }) {
    const timestamp = nowIso();
    const run = {
      id: createId("synthesis"),
      organization_id,
      lead_id,
      snapshot_id,
      version: await this.nextVersionForLead(lead_id, organization_id),
      status: SYNTHESIS_STATUS.DRAFT,
      pipeline_version,
      input_fingerprint,
      summary_json: stringifyJson({ text: "Lead Intelligence synthesis is being prepared.", evidence_refs: [] }),
      findings_json: stringifyJson([]),
      qualification_json: stringifyJson({}),
      recommendation_json: stringifyJson({}),
      evidence_refs_json: stringifyJson([]),
      last_error: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null
    };
    await this.db.run(
      `INSERT INTO intelligence_synthesis_runs
        (id, organization_id, lead_id, snapshot_id, version, status, pipeline_version, input_fingerprint,
         summary_json, findings_json, qualification_json, recommendation_json, evidence_refs_json,
         last_error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.organization_id,
        run.lead_id,
        run.snapshot_id,
        run.version,
        run.status,
        run.pipeline_version,
        run.input_fingerprint,
        run.summary_json,
        run.findings_json,
        run.qualification_json,
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

  async markReady(id, { summary, findings, qualification, recommendation, evidence_refs }) {
    const timestamp = nowIso();
    await this.db.run(
      `UPDATE intelligence_synthesis_runs
        SET status = ?, summary_json = ?, findings_json = ?, qualification_json = ?,
            recommendation_json = ?, evidence_refs_json = ?, last_error = NULL,
            updated_at = ?, completed_at = ?
        WHERE id = ?`,
      [
        SYNTHESIS_STATUS.READY,
        stringifyJson(summary),
        stringifyJson(findings),
        stringifyJson(qualification),
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
      `UPDATE intelligence_synthesis_runs
        SET status = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND status IN ('DRAFT','FAILED')`,
      [SYNTHESIS_STATUS.FAILED, error.message || String(error), nowIso(), id]
    );
    return await this.getRun(id);
  }

  async supersedeReadyRuns({ organization_id, lead_id, except_run_id }) {
    await this.db.run(
      `UPDATE intelligence_synthesis_runs
        SET status = ?, updated_at = ?
        WHERE organization_id = ? AND lead_id = ? AND status = ? AND id <> ?`,
      [SYNTHESIS_STATUS.SUPERSEDED, nowIso(), organization_id, lead_id, SYNTHESIS_STATUS.READY, except_run_id]
    );
  }

  async getRun(id) {
    return await this.db.get("SELECT * FROM intelligence_synthesis_runs WHERE id = ?", [id]);
  }

  async latestForLead(leadId, organizationId) {
    return await this.db.get(
      `SELECT * FROM intelligence_synthesis_runs
        WHERE lead_id = ? AND organization_id = ? AND status = ?
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [leadId, organizationId, SYNTHESIS_STATUS.READY]
    );
  }

  async historyForLead(leadId, organizationId) {
    return await this.db.all(
      `SELECT * FROM intelligence_synthesis_runs
        WHERE lead_id = ? AND organization_id = ?
        ORDER BY version DESC, created_at DESC`,
      [leadId, organizationId]
    );
  }

  async nextVersionForLead(leadId, organizationId) {
    const row = await this.db.get(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM intelligence_synthesis_runs
        WHERE lead_id = ? AND organization_id = ?`,
      [leadId, organizationId]
    );
    return row.next_version;
  }

  runDetail(run, organizationId = run?.organization_id) {
    if (!run || run.organization_id !== organizationId) {
      return null;
    }
    return serializeSynthesisRun(run);
  }
}

export function serializeSynthesisRun(run) {
  return {
    ...run,
    summary: parseJson(run.summary_json) || {},
    findings: parseJson(run.findings_json) || [],
    qualification: parseJson(run.qualification_json) || {},
    recommendation: parseJson(run.recommendation_json) || {},
    evidence_refs: parseJson(run.evidence_refs_json) || []
  };
}
