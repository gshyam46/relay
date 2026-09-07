import { parseJson, stringifyJson } from "../../database/database.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export class ResearchEvidenceRepository {
  constructor(db) {
    this.db = db;
  }

  createIngestion({ organization_id, lead_id, adapter_type, provider_key, idempotency_key, request = {} }) {
    const ingestion = {
      id: createId("research_ingestion"),
      organization_id,
      lead_id,
      adapter_type,
      provider_key,
      state: "RECEIVED",
      idempotency_key,
      request_json: stringifyJson(request),
      summary_json: stringifyJson({ evidence_count: 0 }),
      last_error: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null
    };
    this.db.run(
      `INSERT INTO research_evidence_ingestions
        (id, organization_id, lead_id, adapter_type, provider_key, state, idempotency_key,
         request_json, summary_json, last_error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ingestion.id,
        ingestion.organization_id,
        ingestion.lead_id,
        ingestion.adapter_type,
        ingestion.provider_key,
        ingestion.state,
        ingestion.idempotency_key,
        ingestion.request_json,
        ingestion.summary_json,
        ingestion.last_error,
        ingestion.created_at,
        ingestion.updated_at,
        ingestion.completed_at
      ]
    );
    return ingestion;
  }

  findIngestionByIdempotencyKey({ organization_id, lead_id, idempotency_key }) {
    return this.db.get(
      `SELECT * FROM research_evidence_ingestions
        WHERE organization_id = ? AND lead_id = ? AND idempotency_key = ?
        LIMIT 1`,
      [organization_id, lead_id, idempotency_key]
    );
  }

  updateIngestionState(id, { state, summary = null, last_error = null, completed = false }) {
    const updatedAt = nowIso();
    const completedAt = completed ? updatedAt : null;
    this.db.run(
      `UPDATE research_evidence_ingestions
        SET state = ?, summary_json = COALESCE(?, summary_json), last_error = ?, updated_at = ?,
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?`,
      [state, summary ? stringifyJson(summary) : null, last_error, updatedAt, completedAt, id]
    );
    return this.getIngestion(id);
  }

  replaceEvidenceItems(ingestionId) {
    this.db.run("DELETE FROM research_evidence_items WHERE ingestion_id = ?", [ingestionId]);
  }

  createEvidenceItem({
    ingestion_id,
    organization_id,
    lead_id,
    source_type,
    source_reference = null,
    source_url = null,
    title,
    raw_content_reference = null,
    claim_field,
    claim_value,
    evidence_timestamp = null,
    retrieved_at = null,
    confidence,
    metadata = {}
  }) {
    const evidence = {
      id: createId("research_evidence"),
      ingestion_id,
      organization_id,
      lead_id,
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
      `INSERT INTO research_evidence_items
        (id, ingestion_id, organization_id, lead_id, source_type, source_reference, source_url,
         title, raw_content_reference, claim_field, claim_value, evidence_timestamp, retrieved_at,
         confidence, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidence.id,
        evidence.ingestion_id,
        evidence.organization_id,
        evidence.lead_id,
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

  listIngestionsForLead(leadId, organizationId) {
    return this.db
      .all(
        `SELECT * FROM research_evidence_ingestions
          WHERE lead_id = ? AND organization_id = ?
          ORDER BY created_at DESC`,
        [leadId, organizationId]
      )
      .map((ingestion) => this.ingestionDetail(ingestion));
  }

  getIngestion(id) {
    return this.db.get("SELECT * FROM research_evidence_ingestions WHERE id = ?", [id]);
  }

  evidenceItemsForIngestion(ingestionId, organizationId) {
    return this.db.all(
      "SELECT * FROM research_evidence_items WHERE ingestion_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [ingestionId, organizationId]
    );
  }

  evidenceItemsForLead(leadId, organizationId) {
    return this.db.all(
      "SELECT * FROM research_evidence_items WHERE lead_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [leadId, organizationId]
    );
  }

  ingestionDetail(ingestion) {
    if (!ingestion) {
      return null;
    }
    return {
      ...serializeIngestion(ingestion),
      evidence_items: this.evidenceItemsForIngestion(ingestion.id, ingestion.organization_id).map(serializeEvidenceItem)
    };
  }
}

export function serializeIngestion(ingestion) {
  return {
    ...ingestion,
    request: parseJson(ingestion.request_json) || {},
    summary: parseJson(ingestion.summary_json) || {}
  };
}

export function serializeEvidenceItem(item) {
  return {
    ...item,
    metadata: parseJson(item.metadata_json) || {}
  };
}
