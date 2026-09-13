import { freshnessError } from "./freshnessContract.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export class ResearchEvidenceRepository {
  constructor(db) {
    this.db = db;
  }

  async createIngestion({ organization_id, lead_id, adapter_type, provider_key, idempotency_key, request = {} }) {
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
    await this.db.run(
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

  async findIngestionByIdempotencyKey({ organization_id, lead_id, idempotency_key }) {
    return await this.db.get(
      `SELECT * FROM research_evidence_ingestions
        WHERE organization_id = ? AND lead_id = ? AND idempotency_key = ?
        LIMIT 1`,
      [organization_id, lead_id, idempotency_key]
    );
  }

  async updateIngestionState(id, { state, summary = null, last_error = null, completed = false }) {
    const updatedAt = nowIso();
    const completedAt = completed ? updatedAt : null;
    await this.db.run(
      `UPDATE research_evidence_ingestions
        SET state = ?, summary_json = COALESCE(?, summary_json), last_error = ?, updated_at = ?,
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?`,
      [state, summary ? stringifyJson(summary) : null, last_error, updatedAt, completedAt, id]
    );
    return await this.getIngestion(id);
  }

  async replaceEvidenceItems(ingestionId) {
    await this.db.run("DELETE FROM research_evidence_items WHERE ingestion_id = ?", [ingestionId]);
  }

  async createEvidenceItem({
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
    await this.db.run(
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

  async listIngestionsForLead(leadId, organizationId) {
    const ingestions = await this.db.all(
      `SELECT * FROM research_evidence_ingestions
          WHERE lead_id = ? AND organization_id = ?
          ORDER BY created_at DESC`,
      [leadId, organizationId]
    );
    return Promise.all(ingestions.map((ingestion) => this.ingestionDetail(ingestion)));
  }

  async getIngestion(id) {
    return await this.db.get("SELECT * FROM research_evidence_ingestions WHERE id = ?", [id]);
  }

  async evidenceItemsForIngestion(ingestionId, organizationId) {
    return await this.db.all(
      "SELECT * FROM research_evidence_items WHERE ingestion_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [ingestionId, organizationId]
    );
  }

  async evidenceItemsForLead(leadId, organizationId) {
    const columns = ["id", "ingestion_id", "organization_id", "lead_id", "source_type", "source_reference", "source_url", "title", "raw_content_reference", "claim_field", "claim_value", "evidence_timestamp", "retrieved_at", "confidence", "metadata_json", "created_at"];
    const bytes = column => "coalesce(" + (this.db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))") + ",0)";
    const limits = { id: 256, ingestion_id: 256, source_reference: 500, source_url: 2048, title: 500, raw_content_reference: 500, claim_field: 100, claim_value: 500, evidence_timestamp: 500, retrieved_at: 500, created_at: 500 };
    const bounds = await this.db.get("SELECT count(*) n,coalesce(sum(" + columns.map(bytes).join("+") + "),0) AS bytes,coalesce(sum(CASE WHEN " + Object.entries(limits).map(([key, max]) => "length(" + key + ")>" + max).join(" OR ") + " THEN 1 ELSE 0 END),0) AS oversized FROM research_evidence_items WHERE lead_id=? AND organization_id=?", [leadId, organizationId]);
    if (Number(bounds.n) > 100 || Number(bounds.bytes) > 524288 || Number(bounds.oversized)) throw freshnessError("FRESHNESS_INPUT_LIMIT", "Research sources exceed the supported 100-record or bounded input limit. Review source history.", 409);
    return this.db.all("SELECT " + columns.map(column => "e." + column).join(",") + ",i.state AS ingestion_state FROM research_evidence_items e LEFT JOIN research_evidence_ingestions i ON i.id=e.ingestion_id AND i.organization_id=e.organization_id AND i.lead_id=e.lead_id WHERE e.lead_id=? AND e.organization_id=? ORDER BY e.created_at ASC,e.id ASC", [leadId, organizationId]);
  }

  async ingestionDetail(ingestion) {
    if (!ingestion) {
      return null;
    }
    const evidenceItems = await this.evidenceItemsForIngestion(ingestion.id, ingestion.organization_id);
    return {
      ...serializeIngestion(ingestion),
      evidence_items: evidenceItems.map(serializeEvidenceItem)
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
