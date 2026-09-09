import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";

export class ImportsRepository {
  constructor(db) {
    this.db = db;
  }

  async createBatch({ organization_id, filename, adapter_type, source_metadata, state, idempotency_key, summary }) {
    const timestamp = nowIso();
    const batch = {
      id: createId("import"),
      organization_id,
      filename,
      adapter_type,
      source_metadata_json: stringifyJson(source_metadata),
      state,
      idempotency_key,
      summary_json: stringifyJson(summary),
      last_error: null,
      created_at: timestamp,
      updated_at: timestamp,
      committed_at: null
    };
    await this.db.run(
      `INSERT INTO import_batches
        (id, organization_id, filename, adapter_type, source_metadata_json, state, idempotency_key,
         summary_json, last_error, created_at, updated_at, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch.id,
        batch.organization_id,
        batch.filename,
        batch.adapter_type,
        batch.source_metadata_json,
        batch.state,
        batch.idempotency_key,
        batch.summary_json,
        batch.last_error,
        batch.created_at,
        batch.updated_at,
        batch.committed_at
      ]
    );
    return batch;
  }

  async getBatch(id) {
    return await this.db.get("SELECT * FROM import_batches WHERE id = ?", [id]);
  }

  async getBatchByIdempotencyKey(idempotencyKey) {
    return await this.db.get("SELECT * FROM import_batches WHERE idempotency_key = ?", [idempotencyKey]);
  }

  async listBatches(organizationId) {
    return await this.db.all("SELECT * FROM import_batches WHERE organization_id = ? ORDER BY created_at DESC", [
      organizationId
    ]);
  }

  async updateBatchState(id, state, { summary = null, last_error = null, committed_at = null } = {}) {
    const existing = await this.getBatch(id);
    const nextSummary = summary === null ? existing.summary_json : stringifyJson(summary);
    await this.db.run(
      `UPDATE import_batches
          SET state = ?, summary_json = ?, last_error = ?, committed_at = COALESCE(?, committed_at), updated_at = ?
        WHERE id = ?`,
      [state, nextSummary, last_error, committed_at, nowIso(), id]
    );
    return await this.getBatch(id);
  }

  async createRow({
    id = createId("import_row"),
    import_id,
    organization_id,
    row_number,
    raw_row,
    mapped_values,
    normalized_values,
    validation_state,
    duplicate_candidates
  }) {
    const timestamp = nowIso();
    const row = {
      id,
      import_id,
      organization_id,
      row_number,
      raw_row_json: stringifyJson(raw_row),
      mapped_values_json: stringifyJson(mapped_values),
      normalized_values_json: stringifyJson(normalized_values),
      validation_state,
      selected: 0,
      committed: 0,
      created_lead_id: null,
      duplicate_candidates_json: stringifyJson(duplicate_candidates),
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.run(
      `INSERT INTO import_rows
        (id, import_id, organization_id, row_number, raw_row_json, mapped_values_json, normalized_values_json,
         validation_state, selected, committed, created_lead_id, duplicate_candidates_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.import_id,
        row.organization_id,
        row.row_number,
        row.raw_row_json,
        row.mapped_values_json,
        row.normalized_values_json,
        row.validation_state,
        row.selected,
        row.committed,
        row.created_lead_id,
        row.duplicate_candidates_json,
        row.created_at,
        row.updated_at
      ]
    );
    return row;
  }

  async listRows(importId, organizationId) {
    return await this.db.all(
      "SELECT * FROM import_rows WHERE import_id = ? AND organization_id = ? ORDER BY row_number ASC",
      [importId, organizationId]
    );
  }

  async getRowById(rowId, organizationId) {
    return await this.db.get("SELECT * FROM import_rows WHERE id = ? AND organization_id = ?", [rowId, organizationId]);
  }

  async getRowsByIds(importId, organizationId, rowIds) {
    if (rowIds.length === 0) {
      return [];
    }
    const placeholders = rowIds.map(() => "?").join(", ");
    return await this.db.all(
      `SELECT * FROM import_rows WHERE import_id = ? AND organization_id = ? AND id IN (${placeholders})`,
      [importId, organizationId, ...rowIds]
    );
  }

  async updateRowDuplicates(rowId, duplicateCandidates) {
    await this.db.run("UPDATE import_rows SET duplicate_candidates_json = ?, updated_at = ? WHERE id = ?", [
      stringifyJson(duplicateCandidates),
      nowIso(),
      rowId
    ]);
  }

  async markRowsSelected(importId, organizationId, rowIds) {
    if (rowIds.length === 0) {
      return;
    }
    const placeholders = rowIds.map(() => "?").join(", ");
    await this.db.run(
      `UPDATE import_rows SET selected = 1, updated_at = ?
        WHERE import_id = ? AND organization_id = ? AND id IN (${placeholders})`,
      [nowIso(), importId, organizationId, ...rowIds]
    );
  }

  async markRowCommitted(rowId, leadId) {
    await this.db.run("UPDATE import_rows SET committed = 1, created_lead_id = ?, updated_at = ? WHERE id = ?", [
      leadId,
      nowIso(),
      rowId
    ]);
  }

  async createIssue({ import_id, import_row_id = null, organization_id, issue_type, field = null, message, severity, metadata = {} }) {
    const issue = {
      id: createId("issue"),
      import_id,
      import_row_id,
      organization_id,
      issue_type,
      field,
      message,
      severity,
      metadata_json: stringifyJson(metadata),
      created_at: nowIso()
    };
    await this.db.run(
      `INSERT INTO import_issues
        (id, import_id, import_row_id, organization_id, issue_type, field, message, severity, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issue.id,
        issue.import_id,
        issue.import_row_id,
        issue.organization_id,
        issue.issue_type,
        issue.field,
        issue.message,
        issue.severity,
        issue.metadata_json,
        issue.created_at
      ]
    );
    return issue;
  }

  async listIssues(importId, organizationId) {
    return await this.db.all(
      "SELECT * FROM import_issues WHERE import_id = ? AND organization_id = ? ORDER BY created_at ASC",
      [importId, organizationId]
    );
  }
}

export function serializeImportBatch(batch) {
  return {
    ...batch,
    source_metadata: parseJson(batch.source_metadata_json) || {},
    summary: parseJson(batch.summary_json) || {}
  };
}

export function serializeImportRow(row) {
  return {
    ...row,
    selected: Boolean(row.selected),
    committed: Boolean(row.committed),
    raw_row: parseJson(row.raw_row_json) || {},
    mapped_values: parseJson(row.mapped_values_json) || {},
    normalized_values: parseJson(row.normalized_values_json) || {},
    duplicate_candidates: parseJson(row.duplicate_candidates_json) || []
  };
}

export function serializeImportIssue(issue) {
  return {
    ...issue,
    metadata: parseJson(issue.metadata_json) || {}
  };
}
