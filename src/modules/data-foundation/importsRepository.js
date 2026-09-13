import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

export class ImportsRepository {
  constructor(db) { this.db = db; }
  async createBatch({ organization_id, filename, adapter_type, source_metadata, state, idempotency_key, summary, contract_version, created_by }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const timestamp = nowIso(), batch = { id: createId("import"), organization_id, filename, adapter_type,
      source_metadata_json: stringifyJson(source_metadata), state, idempotency_key, summary_json: stringifyJson(summary),
      last_error: null, created_at: timestamp, updated_at: timestamp, committed_at: null, contract_version, review_revision: 1,
      frozen_selection_json: null, commit_revision: null, created_by };
    const keys = Object.keys(batch);
    await this.db.run("INSERT INTO import_batches (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(batch));
    return batch;
  }
  getBatch(id, organizationId = null) { return this.db.get("SELECT * FROM import_batches WHERE id=?" + (organizationId === null ? "" : " AND organization_id=?"), [id, ...(organizationId === null ? [] : [organizationId])]); }
  getBatchByIdempotencyKey(key, organizationId) { return this.db.get("SELECT * FROM import_batches WHERE idempotency_key=? AND organization_id=?", [key, organizationId]); }
  listBatches(organizationId) { return this.db.all("SELECT * FROM import_batches WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 101", [organizationId]); }
  async updateBatchState(id, state, { organization_id, summary = null, last_error = null, committed_at = null } = {}) {
    assertWorkspaceTransaction(this.db, organization_id);
    const existing = await this.getBatch(id, organization_id);
    await this.db.run("UPDATE import_batches SET state=?,summary_json=?,last_error=?,committed_at=COALESCE(?,committed_at),updated_at=? WHERE id=? AND organization_id=?",
      [state, summary === null ? existing.summary_json : stringifyJson(summary), last_error, committed_at, nowIso(), id, organization_id]);
    return this.getBatch(id, organization_id);
  }
  async createRow({ id = createId("import_row"), import_id, organization_id, row_number, raw_row, raw_cells, mapped_values, normalized_values, validation_state, duplicate_candidates }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const timestamp = nowIso(), row = { id, import_id, organization_id, row_number, raw_row_json: stringifyJson(raw_row),
      raw_cells_json: stringifyJson(raw_cells), mapped_values_json: stringifyJson(mapped_values), normalized_values_json: stringifyJson(normalized_values),
      validation_state, selected: 0, committed: 0, created_lead_id: null, duplicate_candidates_json: stringifyJson(duplicate_candidates),
      created_at: timestamp, updated_at: timestamp, commit_state: "PENDING", hold_reason: null };
    const keys = Object.keys(row);
    await this.db.run("INSERT INTO import_rows (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(row));
    return row;
  }
  listRows(importId, organizationId) { return this.db.all("SELECT * FROM import_rows WHERE import_id=? AND organization_id=? ORDER BY row_number,id", [importId, organizationId]); }
  getRowById(rowId, organizationId) { return this.db.get("SELECT * FROM import_rows WHERE id=? AND organization_id=?", [rowId, organizationId]); }
  getRowsByIds(importId, organizationId, ids) { return ids.length ? this.db.all("SELECT * FROM import_rows WHERE import_id=? AND organization_id=? AND id IN (" + ids.map(() => "?").join(",") + ")", [importId, organizationId, ...ids]) : Promise.resolve([]); }
  async updateRow({ organization_id, row_id, mapped_values, normalized_values, validation_state, duplicate_candidates }) {
    assertWorkspaceTransaction(this.db, organization_id);
    await this.db.run("UPDATE import_rows SET mapped_values_json=?,normalized_values_json=?,validation_state=?,duplicate_candidates_json=?,updated_at=? WHERE id=? AND organization_id=?",
      [stringifyJson(mapped_values), stringifyJson(normalized_values), validation_state, stringifyJson(duplicate_candidates), nowIso(), row_id, organization_id]);
  }
  async updateRowDuplicates(rowId, organizationId, candidates) {
    assertWorkspaceTransaction(this.db, organizationId);
    await this.db.run("UPDATE import_rows SET duplicate_candidates_json=?,updated_at=? WHERE id=? AND organization_id=?", [stringifyJson(candidates), nowIso(), rowId, organizationId]);
  }
  async freeze(batch, rowIds) {
    assertWorkspaceTransaction(this.db, batch.organization_id);
    await this.db.run("UPDATE import_batches SET frozen_selection_json=?,commit_revision=review_revision,state='COMMITTING',last_error=NULL,updated_at=? WHERE id=? AND organization_id=?", [stringifyJson(rowIds), nowIso(), batch.id, batch.organization_id]);
    await this.db.run("UPDATE import_rows SET selected=1,updated_at=? WHERE import_id=? AND organization_id=? AND id IN (" + rowIds.map(() => "?").join(",") + ")", [nowIso(), batch.id, batch.organization_id, ...rowIds]);
  }
  async outcome({ organization_id, import_id, import_row_id, review_revision, state, lead_id = null, event_id = null, hold_reason = null }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const stamp = nowIso();
    await this.db.run("INSERT INTO import_row_outcomes(organization_id,import_id,import_row_id,review_revision,state,lead_id,event_id,hold_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [organization_id, import_id, import_row_id, review_revision, state, lead_id, event_id, hold_reason, stamp]);
    await this.db.run("UPDATE import_rows SET committed=?,created_lead_id=?,commit_state=?,hold_reason=?,updated_at=? WHERE id=? AND import_id=? AND organization_id=?", [state === "COMMITTED" ? 1 : 0, lead_id, state, hold_reason, stamp, import_row_id, import_id, organization_id]);
  }
  listOutcomes(importId, organizationId) { return this.db.all("SELECT * FROM import_row_outcomes WHERE import_id=? AND organization_id=?", [importId, organizationId]); }
  getOutcome(organizationId, rowId) { return this.db.get("SELECT * FROM import_row_outcomes WHERE organization_id=? AND import_row_id=?", [organizationId, rowId]); }
  async createIssue({ import_id, import_row_id = null, organization_id, issue_type, field = null, message, severity, metadata = {} }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const issue = { id: createId("issue"), import_id, import_row_id, organization_id, issue_type, field, message, severity, metadata_json: stringifyJson(metadata), created_at: nowIso() };
    const keys = Object.keys(issue);
    await this.db.run("INSERT INTO import_issues (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(issue));
    return issue;
  }
  listIssues(importId, organizationId) { return this.db.all("SELECT * FROM import_issues WHERE import_id=? AND organization_id=? ORDER BY created_at,id", [importId, organizationId]); }
  async clearRowIssues(importId, organizationId, rowId = null, duplicatesOnly = false) {
    assertWorkspaceTransaction(this.db, organizationId);
    await this.db.run("DELETE FROM import_issues WHERE import_id=? AND organization_id=?" + (rowId ? " AND import_row_id=?" : "") + (duplicatesOnly ? " AND issue_type='DUPLICATE_CANDIDATE' AND NOT EXISTS (SELECT 1 FROM import_identity_resolutions x WHERE x.organization_id=import_issues.organization_id AND x.import_row_id=import_issues.import_row_id)" : ""), [importId, organizationId, ...(rowId ? [rowId] : [])]);
  }
  async correction({ organization_id, import_id, import_row_id, revision, reason, before, after, created_by }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const data = { id: createId("icorr"), organization_id, import_id, import_row_id, revision, reason, before_json: stringifyJson(before), after_json: stringifyJson(after), created_at: nowIso(), created_by };
    const keys = Object.keys(data);
    await this.db.run("INSERT INTO import_row_corrections (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(data));
    await this.db.run("UPDATE import_batches SET review_revision=?,updated_at=? WHERE id=? AND organization_id=?", [revision, data.created_at, import_id, organization_id]);
  }
  async corrections(importId, organizationId) {
    return (await this.db.all("SELECT * FROM import_row_corrections WHERE import_id=? AND organization_id=? ORDER BY revision DESC LIMIT 100", [importId, organizationId])).map(row => ({ id: row.id, import_row_id: row.import_row_id, revision: row.revision, reason: row.reason, created_by: row.created_by, created_at: row.created_at, before: parseJson(row.before_json), after: parseJson(row.after_json) }));
  }
}
export function serializeImportBatch(batch) {
  return { ...batch, source_metadata: parseJson(batch.source_metadata_json) || {}, summary: parseJson(batch.summary_json) || {}, frozen_selection: batch.frozen_selection_json ? parseJson(batch.frozen_selection_json) : null };
}
export function serializeImportRow(row) {
  return { ...row, selected: Boolean(row.selected), committed: Boolean(row.committed), raw_row: parseJson(row.raw_row_json) || {}, raw_cells: row.raw_cells_json ? parseJson(row.raw_cells_json) : null, mapped_values: parseJson(row.mapped_values_json) || {}, normalized_values: parseJson(row.normalized_values_json) || {}, duplicate_candidates: parseJson(row.duplicate_candidates_json) || [] };
}
export function serializeImportIssue(issue) { return { ...issue, metadata: parseJson(issue.metadata_json) || {} }; }
