import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class IntelligenceRepository {
  constructor(db) {
    this.db = db;
  }

  createDraftSnapshot({
    organization_id,
    lead_id,
    version,
    pipeline_version,
    input_fingerprint,
    summary = "Lead Intelligence is being prepared.",
    readiness_status = "NEEDS_MORE_DATA",
    readiness_score = 0,
    next_best_action = "CREATE_HUMAN_TASK"
  }) {
    const snapshot = {
      id: createId("intel"),
      organization_id,
      lead_id,
      version,
      status: "DRAFT",
      pipeline_version,
      input_fingerprint,
      readiness_status,
      readiness_score,
      summary,
      score: readiness_score,
      next_best_action,
      evidence_json: stringifyJson([]),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_snapshots
          (id, organization_id, lead_id, version, status, pipeline_version, input_fingerprint,
           readiness_status, readiness_score, summary, score, next_best_action, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.organization_id,
        snapshot.lead_id,
        snapshot.version,
        snapshot.status,
        snapshot.pipeline_version,
        snapshot.input_fingerprint,
        snapshot.readiness_status,
        snapshot.readiness_score,
        snapshot.summary,
        snapshot.score,
        snapshot.next_best_action,
        snapshot.evidence_json,
        snapshot.created_at
      ]
    );
    return snapshot;
  }

  // Backward-compatible M0 entrypoint. New code should use createDraftSnapshot/finalizeSnapshot.
  createSnapshot({ organization_id, lead_id, summary, score, next_best_action, evidence }) {
    const fingerprint = `${lead_id}:legacy:${summary}:${score}:${next_best_action}`;
    const existing = this.findSnapshotByFingerprint({
      organization_id,
      lead_id,
      input_fingerprint: fingerprint,
      pipeline_version: "m0-legacy"
    });
    if (existing) {
      return existing;
    }
    const snapshot = this.createDraftSnapshot({
      organization_id,
      lead_id,
      version: this.nextVersionForLead(lead_id),
      pipeline_version: "m0-legacy",
      input_fingerprint: fingerprint,
      summary,
      readiness_status: score >= 60 ? "READY_FOR_INTELLIGENCE" : "NEEDS_MORE_DATA",
      readiness_score: score,
      next_best_action
    });
    this.finalizeSnapshot(snapshot.id, {
      status: "READY",
      readiness_status: score >= 60 ? "READY_FOR_INTELLIGENCE" : "NEEDS_MORE_DATA",
      readiness_score: score,
      summary,
      next_best_action,
      evidence: evidence || []
    });
    return this.getSnapshot(snapshot.id);
  }

  findSnapshotByFingerprint({ organization_id, lead_id, input_fingerprint, pipeline_version }) {
    return this.db.get(
      `SELECT * FROM intelligence_snapshots
        WHERE organization_id = ? AND lead_id = ? AND input_fingerprint = ? AND pipeline_version = ?
        LIMIT 1`,
      [organization_id, lead_id, input_fingerprint, pipeline_version]
    );
  }

  getSnapshot(id) {
    return this.db.get("SELECT * FROM intelligence_snapshots WHERE id = ?", [id]);
  }

  latestForLead(leadId) {
    return this.db.get(
      `SELECT * FROM intelligence_snapshots
        WHERE lead_id = ? AND status = 'READY'
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [leadId]
    );
  }

  latestForLeadInOrganization(leadId, organizationId) {
    return this.db.get(
      `SELECT * FROM intelligence_snapshots
        WHERE lead_id = ? AND organization_id = ? AND status = 'READY'
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [leadId, organizationId]
    );
  }

  latestAnyForLeadInOrganization(leadId, organizationId) {
    return this.db.get(
      `SELECT * FROM intelligence_snapshots
        WHERE lead_id = ? AND organization_id = ?
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [leadId, organizationId]
    );
  }

  historyForLead(leadId, organizationId) {
    return this.db.all(
      `SELECT * FROM intelligence_snapshots
        WHERE lead_id = ? AND organization_id = ?
        ORDER BY version DESC, created_at DESC`,
      [leadId, organizationId]
    );
  }

  nextVersionForLead(leadId) {
    const row = this.db.get("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM intelligence_snapshots WHERE lead_id = ?", [
      leadId
    ]);
    return row.next_version;
  }

  replaceSnapshotChildren(snapshotId) {
    this.db.run("DELETE FROM intelligence_recommendations WHERE snapshot_id = ?", [snapshotId]);
    this.db.run("DELETE FROM intelligence_qualifications WHERE snapshot_id = ?", [snapshotId]);
    this.db.run("DELETE FROM intelligence_signals WHERE snapshot_id = ?", [snapshotId]);
    this.db.run("DELETE FROM intelligence_claims WHERE snapshot_id = ?", [snapshotId]);
    this.db.run("DELETE FROM intelligence_evidence WHERE snapshot_id = ?", [snapshotId]);
  }

  createEvidence({
    organization_id,
    lead_id,
    snapshot_id,
    source_type,
    source_reference = null,
    source_url = null,
    title = null,
    raw_content_reference = null,
    claim_field = null,
    claim_value = null,
    evidence_timestamp = null,
    retrieved_at = null,
    confidence,
    metadata = {}
  }) {
    const evidence = {
      id: createId("evidence"),
      organization_id,
      lead_id,
      snapshot_id,
      source_type,
      source_reference,
      source_url,
      title,
      raw_content_reference,
      claim_field,
      claim_value,
      evidence_timestamp,
      retrieved_at,
      confidence,
      metadata_json: stringifyJson(metadata),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_evidence
        (id, organization_id, lead_id, snapshot_id, source_type, source_reference, source_url,
         title, raw_content_reference, claim_field, claim_value, evidence_timestamp, retrieved_at,
         confidence, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidence.id,
        evidence.organization_id,
        evidence.lead_id,
        evidence.snapshot_id,
        evidence.source_type,
        evidence.source_reference,
        evidence.source_url,
        evidence.title,
        evidence.raw_content_reference,
        evidence.claim_field,
        evidence.claim_value,
        evidence.evidence_timestamp,
        evidence.retrieved_at,
        evidence.confidence,
        evidence.metadata_json,
        evidence.created_at
      ]
    );
    return evidence;
  }

  createClaim({ organization_id, lead_id, snapshot_id, field, value, confidence, evidence_ids = [] }) {
    const claim = {
      id: createId("claim"),
      organization_id,
      lead_id,
      snapshot_id,
      field,
      value_json: stringifyJson(value),
      confidence,
      evidence_ids_json: stringifyJson(evidence_ids),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_claims
        (id, organization_id, lead_id, snapshot_id, field, value_json, confidence, evidence_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        claim.id,
        claim.organization_id,
        claim.lead_id,
        claim.snapshot_id,
        claim.field,
        claim.value_json,
        claim.confidence,
        claim.evidence_ids_json,
        claim.created_at
      ]
    );
    return claim;
  }

  createSignal({ organization_id, lead_id, snapshot_id, type, value, confidence, explanation, evidence_ids = [] }) {
    const signal = {
      id: createId("signal"),
      organization_id,
      lead_id,
      snapshot_id,
      type,
      value,
      confidence,
      explanation,
      evidence_ids_json: stringifyJson(evidence_ids),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_signals
        (id, organization_id, lead_id, snapshot_id, type, value, confidence, explanation, evidence_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        signal.id,
        signal.organization_id,
        signal.lead_id,
        signal.snapshot_id,
        signal.type,
        signal.value,
        signal.confidence,
        signal.explanation,
        signal.evidence_ids_json,
        signal.created_at
      ]
    );
    return signal;
  }

  createQualification({
    organization_id,
    lead_id,
    snapshot_id,
    status,
    readiness_score,
    reasons = [],
    signal_ids = [],
    evidence_ids = []
  }) {
    const qualification = {
      id: createId("qual"),
      organization_id,
      lead_id,
      snapshot_id,
      status,
      readiness_score,
      reasons_json: stringifyJson(reasons),
      signal_ids_json: stringifyJson(signal_ids),
      evidence_ids_json: stringifyJson(evidence_ids),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_qualifications
        (id, organization_id, lead_id, snapshot_id, status, readiness_score, reasons_json,
         signal_ids_json, evidence_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        qualification.id,
        qualification.organization_id,
        qualification.lead_id,
        qualification.snapshot_id,
        qualification.status,
        qualification.readiness_score,
        qualification.reasons_json,
        qualification.signal_ids_json,
        qualification.evidence_ids_json,
        qualification.created_at
      ]
    );
    return qualification;
  }

  createRecommendation({
    organization_id,
    lead_id,
    snapshot_id,
    action_type,
    outbound_action_type,
    reason,
    confidence,
    evidence_ids = []
  }) {
    const recommendation = {
      id: createId("rec"),
      organization_id,
      lead_id,
      snapshot_id,
      action_type,
      outbound_action_type,
      reason,
      confidence,
      evidence_ids_json: stringifyJson(evidence_ids),
      created_at: nowIso()
    };
    this.db.run(
      `INSERT INTO intelligence_recommendations
        (id, organization_id, lead_id, snapshot_id, action_type, outbound_action_type, reason,
         confidence, evidence_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recommendation.id,
        recommendation.organization_id,
        recommendation.lead_id,
        recommendation.snapshot_id,
        recommendation.action_type,
        recommendation.outbound_action_type,
        recommendation.reason,
        recommendation.confidence,
        recommendation.evidence_ids_json,
        recommendation.created_at
      ]
    );
    return recommendation;
  }

  finalizeSnapshot(snapshotId, { status, readiness_status, readiness_score, summary, next_best_action, evidence }) {
    this.db.run(
      `UPDATE intelligence_snapshots
        SET status = ?, readiness_status = ?, readiness_score = ?, summary = ?, score = ?,
            next_best_action = ?, evidence_json = ?
        WHERE id = ?`,
      [status, readiness_status, readiness_score, summary, readiness_score, next_best_action, stringifyJson(evidence), snapshotId]
    );
    return this.getSnapshot(snapshotId);
  }

  markSnapshotFailed(snapshotId, error) {
    this.db.run("UPDATE intelligence_snapshots SET status = 'FAILED', summary = ? WHERE id = ?", [
      error.message || String(error),
      snapshotId
    ]);
    return this.getSnapshot(snapshotId);
  }

  supersedeReadySnapshots({ organization_id, lead_id, except_snapshot_id }) {
    this.db.run(
      `UPDATE intelligence_snapshots
        SET status = 'SUPERSEDED'
        WHERE organization_id = ? AND lead_id = ? AND status = 'READY' AND id <> ?`,
      [organization_id, lead_id, except_snapshot_id]
    );
  }

  evidenceForSnapshot(snapshotId, organizationId) {
    return this.db.all(
      "SELECT * FROM intelligence_evidence WHERE snapshot_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [snapshotId, organizationId]
    );
  }

  claimsForSnapshot(snapshotId, organizationId) {
    return this.db.all(
      "SELECT * FROM intelligence_claims WHERE snapshot_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [snapshotId, organizationId]
    );
  }

  signalsForSnapshot(snapshotId, organizationId) {
    return this.db.all(
      "SELECT * FROM intelligence_signals WHERE snapshot_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [snapshotId, organizationId]
    );
  }

  qualificationForSnapshot(snapshotId, organizationId) {
    return this.db.get("SELECT * FROM intelligence_qualifications WHERE snapshot_id = ? AND organization_id = ? LIMIT 1", [
      snapshotId,
      organizationId
    ]);
  }

  recommendationForSnapshot(snapshotId, organizationId) {
    return this.db.get("SELECT * FROM intelligence_recommendations WHERE snapshot_id = ? AND organization_id = ? LIMIT 1", [
      snapshotId,
      organizationId
    ]);
  }

  snapshotDetail(snapshot, organizationId = snapshot?.organization_id) {
    if (!snapshot || snapshot.organization_id !== organizationId) {
      return null;
    }
    return serializeSnapshot({
      snapshot,
      evidence: this.evidenceForSnapshot(snapshot.id, organizationId),
      claims: this.claimsForSnapshot(snapshot.id, organizationId),
      signals: this.signalsForSnapshot(snapshot.id, organizationId),
      qualification: this.qualificationForSnapshot(snapshot.id, organizationId),
      recommendation: this.recommendationForSnapshot(snapshot.id, organizationId)
    });
  }
}

export function serializeSnapshot({ snapshot, evidence = [], claims = [], signals = [], qualification = null, recommendation = null }) {
  return {
    ...snapshot,
    evidence: evidence.map(serializeEvidence),
    claims: claims.map(serializeClaim),
    signals: signals.map(serializeSignal),
    qualification: qualification ? serializeQualification(qualification) : null,
    recommendation: recommendation ? serializeRecommendation(recommendation) : null,
    evidence_summary: parseJson(snapshot.evidence_json) || []
  };
}

function serializeEvidence(evidence) {
  return {
    ...evidence,
    metadata: parseJson(evidence.metadata_json) || {}
  };
}

function serializeClaim(claim) {
  return {
    ...claim,
    value: parseJson(claim.value_json),
    evidence_ids: parseJson(claim.evidence_ids_json) || []
  };
}

function serializeSignal(signal) {
  return {
    ...signal,
    evidence_ids: parseJson(signal.evidence_ids_json) || []
  };
}

function serializeQualification(qualification) {
  return {
    ...qualification,
    reasons: parseJson(qualification.reasons_json) || [],
    signal_ids: parseJson(qualification.signal_ids_json) || [],
    evidence_ids: parseJson(qualification.evidence_ids_json) || []
  };
}

function serializeRecommendation(recommendation) {
  return {
    ...recommendation,
    evidence_ids: parseJson(recommendation.evidence_ids_json) || []
  };
}
