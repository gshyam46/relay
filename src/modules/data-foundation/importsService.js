import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseCsvLeadRows } from "./csvAdapter.js";
import { buildReviewedCsvPreview, normalizeReviewedImportRow } from "./reviewedImportMapping.js";
import { bindImportEnquiry } from "../business-context/importProvenance.js";
import { BusinessContextRepository } from "../business-context/businessContextRepository.js";
import { detectDuplicateCandidates } from "./duplicateDetection.js";
import { normalizeImportedValues, buildNameCompanyLookupKey } from "./normalization.js";
import { validateImportedLead } from "./importValidation.js";
import { PHONE_REGIONS } from "./ingestionContract.js";
import { ImportsRepository, serializeImportBatch, serializeImportIssue, serializeImportRow } from "./importsRepository.js";
import { LeadsRepository } from "./leadsRepository.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { IMPORT_CHUNK_ROWS, IMPORT_MAX_CORRECTIONS, importError, importFingerprint, importRevision, importText, progressFor, selectedRows, safeFailure } from "./reviewedImportContract.js";

import { ImportIdentityRepository } from "./importIdentityRepository.js";
import { identityUnavailable, identitySummary, serializeIdentityResolution } from "./importIdentityContract.js";

export class ImportsService {
  constructor({ importsRepository, leadsRepository, eventsRepository, auditRepository }) {
    Object.assign(this, { importsRepository, leadsRepository, eventsRepository, auditRepository });
    this.db = importsRepository.db;
    this.policy = new ContactPolicyService(this.db);
  }
  async previewCsv(input) {
    const organizationId = importText(input.organization_id, "organization_id"), filename = importText(input.filename, "filename", 200);
    const actor = actorId(input.actor);
    if (typeof input.csv_text !== "string" || !input.csv_text.trim()) throw importError("IMPORT_INVALID_INPUT", "CSV text is required.");
    if (Buffer.byteLength(input.csv_text, "utf8") > 2 * 1024 * 1024) throw importError("IMPORT_FILE_TOO_LARGE", "CSV exceeds the 2 MiB limit.", 413);
    if (!PHONE_REGIONS.has(input.default_phone_region)) throw importError("IMPORT_INVALID_INPUT", "Choose IN, US or INTERNATIONAL_ONLY for phone interpretation.");
    const version = input.mapping === undefined ? 1 : 2;
    if (version === 1 && input.options !== undefined) throw importError("IMPORT_INVALID_INPUT", "Options require an explicit reviewed mapping.");
    const parsed = version === 2 ? buildReviewedCsvPreview(input) : legacyPreview(input.csv_text, input.default_phone_region);
    if ((parsed.parserIssues || []).some(issue => issue.severity === "ERROR")) throw importError("IMPORT_MALFORMED_CSV", "CSV has malformed fields or missing headers. Correct the file before previewing.");
    if (!parsed.rows.length || parsed.rows.length > 1000 || parsed.headers.length > 64) throw importError("IMPORT_FILE_LIMIT", "CSV requires 1 to 1000 rows and at most 64 columns.", parsed.rows.length ? 413 : 400);
    const metadata = { adapter_type: "CSV", filename, headers: parsed.headers, mapping: version === 2 ? input.mapping : parsed.headerMap,
      options: version === 2 ? input.options : null, default_phone_region: input.default_phone_region };
    const key = importFingerprint({ organization_id: organizationId, filename, csv_text: input.csv_text, default_phone_region: input.default_phone_region, mapping: metadata.mapping, options: metadata.options, contract_version: version });
    const batchId = await this.policy.withWorkspacePolicyTransaction(organizationId, async tx => {
      await requireOwner(tx, organizationId, actor);
      const repository = new ImportsRepository(tx), existing = await repository.getBatchByIdempotencyKey(key, organizationId);
      if (existing) return existing.id;
      const batch = await repository.createBatch({ organization_id: organizationId, filename, adapter_type: "CSV", source_metadata: metadata,
        state: "READY_TO_COMMIT", idempotency_key: key, summary: {}, contract_version: version, created_by: actor });
      const rows = parsed.rows.map(row => ({ ...row, id: createId("import_row"), duplicateCandidates: [] }));
      for (const row of rows) if (version === 2) row.normalizedValues.enquiry = bindImportEnquiry(row.normalizedValues.enquiry, { import_id: batch.id, import_row_id: row.id });
      const candidates = detectDuplicateCandidates({ rows, existingLeads: await matchingLeads(tx, organizationId, rows.map(row => row.normalizedValues)) });
      for (const row of rows) {
        row.duplicateCandidates = candidates.get(row.id) || [];
        await repository.createRow({ id: row.id, import_id: batch.id, organization_id: organizationId, row_number: row.rowNumber,
          raw_row: row.rawRow, raw_cells: row.rawCells || [], mapped_values: row.mappedValues, normalized_values: row.normalizedValues,
          validation_state: row.validationState, duplicate_candidates: row.duplicateCandidates });
        await writeIssues(repository, batch, row.id, row.validationIssues, row.duplicateCandidates);
      }
      for (const issue of parsed.parserIssues || []) await repository.createIssue({ import_id: batch.id, organization_id: organizationId, issue_type: issue.issue_type, field: issue.field || null, message: issue.message, severity: issue.severity, metadata: { row_number: issue.rowNumber } });
      const summary = summaryFor((await repository.listRows(batch.id, organizationId)).map(serializeImportRow), await repository.listIssues(batch.id, organizationId));
      await repository.updateBatchState(batch.id, "READY_TO_COMMIT", { organization_id: organizationId, summary });
      await new AuditRepository(tx).record({ organization_id: organizationId, event_type: "ImportPreviewed", message: "CSV mapping and row preview saved for review.", metadata: { import_id: batch.id, contract_version: version, review_revision: 1, actor, summary } });
      return batch.id;
    });
    return this.getImport(batchId, organizationId);
  }
  async listImports(organizationId) {
    importText(organizationId, "organization_id");
    const recent = await this.importsRepository.listBatches(organizationId), batches = recent.slice(0, 100).map(serializeImportBatch);
    const counts = batches.length ? await this.db.all("SELECT import_id,SUM(selected) AS selected_rows,SUM(CASE WHEN selected=1 AND committed=1 THEN 1 ELSE 0 END) AS committed_rows,SUM(CASE WHEN selected=1 AND commit_state='HELD' THEN 1 ELSE 0 END) AS held_rows FROM import_rows WHERE organization_id=? AND import_id IN (" + batches.map(() => "?").join(",") + ") GROUP BY import_id", [organizationId, ...batches.map(batch => batch.id)]) : [];
    const byId = new Map(counts.map(row => [row.import_id, row]));
    for (const batch of batches) if (batch.contract_version > 0) {
      const row = byId.get(batch.id), selected = Number(row?.selected_rows || 0), committed = Number(row?.committed_rows || 0), held = Number(row?.held_rows || 0);
      batch.progress = { selected_rows: selected, committed_rows: committed, held_rows: held, remaining_rows: selected - committed - held };
      batch.summary = { ...batch.summary, ...batch.progress };
    }
    if (batches.length) {
      const summaryRows = await this.db.all("SELECT r.import_id,SUM(CASE WHEN x.decision='LINK_EXISTING' THEN 1 ELSE 0 END) AS linked_rows,SUM(CASE WHEN x.decision='CREATE_SEPARATE' THEN 1 ELSE 0 END) AS created_rows,SUM(CASE WHEN x.id IS NOT NULL AND r.commit_state='HELD' THEN 1 ELSE 0 END) AS resolved_held_rows,SUM(CASE WHEN x.id IS NULL AND r.committed=0 AND (r.commit_state='HELD' OR r.duplicate_candidates_json<>'[]') THEN 1 ELSE 0 END) AS unresolved_duplicate_rows FROM import_rows r LEFT JOIN import_identity_resolutions x ON x.organization_id=r.organization_id AND x.import_row_id=r.id WHERE r.organization_id=? AND r.import_id IN (" + batches.map(() => "?").join(",") + ") GROUP BY r.import_id", [organizationId, ...batches.map(batch => batch.id)]);
      const summaries = new Map(summaryRows.map(row => [row.import_id, Object.fromEntries(["linked_rows", "created_rows", "resolved_held_rows", "unresolved_duplicate_rows"].map(key => [key, Number(row[key] || 0)]))]));
      for (const batch of batches) batch.resolution_summary = summaries.get(batch.id) || { linked_rows: 0, created_rows: 0, resolved_held_rows: 0, unresolved_duplicate_rows: 0 };
    }
    return { imports: batches, has_more: recent.length > 100, limit: 100 };
  }
  async getImport(importId, organizationId) {
    return this.policy.withWorkspacePolicyTransaction(organizationId, async tx => {
      const repository = new ImportsRepository(tx), batch = await requireBatch(repository, importId, organizationId);
      return detail(repository, batch);
    });
  }
  async correctRow({ organization_id, import_id, import_row_id, expected_revision, values, reason, actor }) {
    const owner = actorId(actor), revision = importRevision(expected_revision), note = importText(reason, "reason", 2000);
    await this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
      await requireOwner(tx, organization_id, owner);
      const repository = new ImportsRepository(tx), batch = await requireBatch(repository, import_id, organization_id);
      if (batch.contract_version !== 2 || batch.state !== "READY_TO_COMMIT" || batch.frozen_selection_json) throw importError("IMPORT_REVIEW_FROZEN", "Only an unfrozen reviewed preview can be corrected.", 409);
      if (batch.review_revision !== revision) throw stale();
      if (revision > IMPORT_MAX_CORRECTIONS) throw importError("IMPORT_CORRECTION_LIMIT", "This import has reached 100 corrections. Create a new reviewed preview.", 409);
      const rows = (await repository.listRows(import_id, organization_id)).map(serializeImportRow), row = rows.find(item => item.id === import_row_id);
      if (!row) throw importError("IMPORT_ROW_NOT_FOUND", "Row not found in this import.", 404);
      const resolved = new Map((await new ImportIdentityRepository(tx).list(organization_id, import_id)).map(item => [item.import_row_id, serializeIdentityResolution(item)]));
      if (resolved.has(row.id)) throw importError("IDENTITY_ROW_RESOLVED", "A resolved source row cannot be corrected.", 409);
      for (const item of rows) item.identity_resolution = resolved.get(item.id) || null;
      const metadata = serializeImportBatch(batch).source_metadata;
      const normalized = normalizeReviewedImportRow(values, { mapping: metadata.mapping, options: metadata.options, default_phone_region: metadata.default_phone_region });
      normalized.normalizedValues.enquiry = bindImportEnquiry(normalized.normalizedValues.enquiry, { import_id, import_row_id });
      const before = correctionShape(row);
      row.mapped_values = normalized.mappedValues; row.normalized_values = normalized.normalizedValues; row.validation_state = normalized.validationState;
      const candidates = detectDuplicateCandidates({ rows: rows.map(item => ({ id: item.id, rowNumber: item.row_number, normalizedValues: item.normalized_values })), existingLeads: await matchingLeads(tx, organization_id, rows.map(item => item.normalized_values)) });
      row.duplicate_candidates = candidates.get(row.id) || [];
      await repository.updateRow({ organization_id, row_id: row.id, mapped_values: row.mapped_values, normalized_values: row.normalized_values, validation_state: row.validation_state, duplicate_candidates: row.duplicate_candidates });
      await repository.clearRowIssues(import_id, organization_id, row.id);
      await repository.clearRowIssues(import_id, organization_id, null, true);
      await writeIssues(repository, batch, row.id, normalized.validationIssues, []);
      for (const item of rows) {
        if (item.identity_resolution) continue;
        item.duplicate_candidates = candidates.get(item.id) || [];
        await repository.updateRowDuplicates(item.id, organization_id, item.duplicate_candidates);
        await writeIssues(repository, batch, item.id, [], item.duplicate_candidates);
      }
      await repository.correction({ organization_id, import_id, import_row_id, revision: revision + 1, reason: note, before, after: correctionShape(row), created_by: owner });
      await repository.updateBatchState(import_id, "READY_TO_COMMIT", { organization_id, summary: summaryFor(rows, await repository.listIssues(import_id, organization_id)) });
      await new AuditRepository(tx).record({ organization_id, event_type: "ImportRowCorrected", message: "Owner corrected reviewed import fields without changing source cells.", metadata: { import_id, import_row_id, review_revision: revision + 1, actor: owner, reason: note } });
    });
    return this.getImport(import_id, organization_id);
  }
  async commitImport({ import_id, organization_id, selected_row_ids, expected_revision, actor, simulate_failure_after_rows = null }) {
    const owner = actorId(actor), ids = selectedRows(selected_row_ids);
    const frozen = await this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
      await requireOwner(tx, organization_id, owner);
      const repository = new ImportsRepository(tx), batch = await requireBatch(repository, import_id, organization_id);
      if (batch.contract_version === 0) throw importError("IMPORT_LEGACY_REVIEW_REQUIRED", "Historical imports require a new reviewed preview. Their existing records remain unchanged.", 409);
      const revision = batch.contract_version === 2 || expected_revision !== undefined ? importRevision(expected_revision) : batch.review_revision;
      if (revision !== batch.review_revision) throw stale();
      if (batch.frozen_selection_json) {
        const previous = serializeImportBatch(batch).frozen_selection;
        if (batch.commit_revision !== revision || JSON.stringify(previous) !== JSON.stringify(ids)) throw importError("IMPORT_SELECTION_FROZEN", "Resume the exact reviewed revision and frozen selected rows.", 409);
        if (batch.state === "FAILED") await repository.updateBatchState(import_id, "COMMITTING", { organization_id });
        return { revision, done: batch.state === "COMMITTED" };
      }
      if (batch.state !== "READY_TO_COMMIT") throw importError("IMPORT_NOT_READY", "Import is not ready to commit.", 409);
      const rows = (await repository.getRowsByIds(import_id, organization_id, ids)).map(serializeImportRow);
      if (rows.length !== ids.length) throw importError("IMPORT_ROW_NOT_FOUND", "One or more selected rows were not found in this import.", 404);
      const resolved = new Set((await new ImportIdentityRepository(tx).list(organization_id, import_id)).map(item => item.import_row_id));
      if (rows.some(row => resolved.has(row.id) || !eligible(row, batch.contract_version))) throw importError("IMPORT_INVALID_SELECTION", "Select only valid rows without unresolved duplicate candidates.");
      await repository.freeze(batch, ids);
      await new AuditRepository(tx).record({ organization_id, event_type: "ImportSelectionFrozen", message: "Owner committed an exact reviewed selection.", metadata: { import_id, review_revision: revision, selected_rows: ids.length, actor: owner } });
      return { revision, done: false };
    });
    if (frozen.done) return this.getImport(import_id, organization_id);
    let written = 0;
    try {
      const started = Date.now();
      const pending = await this.db.all("SELECT id FROM import_rows WHERE import_id=? AND organization_id=? AND selected=1 AND commit_state='PENDING' ORDER BY row_number,id LIMIT ?", [import_id, organization_id, IMPORT_CHUNK_ROWS]);
      for (const row of pending) {
        if (written > 0 && Date.now() - started >= 10000) break;
        const changed = await this.commitRow({ import_id, organization_id, import_row_id: row.id, revision: frozen.revision, owner });
        if (changed) written++;
        if (simulate_failure_after_rows !== null && written >= simulate_failure_after_rows) throw new Error("Synthetic import row interruption.");
      }
      await this.finishChunk({ import_id, organization_id, owner });
    } catch (error) {
      await this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
        const repository = new ImportsRepository(tx), batch = await requireBatch(repository, import_id, organization_id);
        if (batch.state !== "COMMITTED") await repository.updateBatchState(import_id, "FAILED", { organization_id, summary: summaryFor((await repository.listRows(import_id, organization_id)).map(serializeImportRow), await repository.listIssues(import_id, organization_id)), last_error: safeFailure().last_error });
      });
      if (error.statusCode && error.statusCode < 500) throw error;
      throw importError("IMPORT_ROW_WRITE_FAILED", safeFailure().message, 500);
    }
    return this.getImport(import_id, organization_id);
  }
  async commitRow({ import_id, organization_id, import_row_id, revision, owner }) {
    return this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
      await requireOwner(tx, organization_id, owner);
      const repository = new ImportsRepository(tx), batch = await requireBatch(repository, import_id, organization_id);
      if (batch.commit_revision !== revision || !batch.frozen_selection_json) throw stale();
      if (!serializeImportBatch(batch).frozen_selection?.includes(import_row_id)) throw corrupt();
      const record = await repository.getRowById(import_row_id, organization_id);
      if (!record || record.import_id !== import_id || !record.selected) throw importError("IMPORT_ROW_NOT_FOUND", "Selected row no longer belongs to this import.", 404);
      const outcome = await repository.getOutcome(organization_id, import_row_id);
      if (outcome) {
        if (record.commit_state !== outcome.state || record.created_lead_id !== outcome.lead_id || Boolean(record.committed) !== (outcome.state === "COMMITTED")) throw corrupt();
        return false;
      }
      if (record.commit_state !== "PENDING" || record.committed || record.created_lead_id) throw corrupt();
      const row = serializeImportRow(record);
      row.identity_resolution = await new ImportIdentityRepository(tx).get(organization_id, import_row_id);
      if (!eligible(row, batch.contract_version)) throw importError("IMPORT_INVALID_SELECTION", "The selected row is no longer eligible. Review import state.", 409);
      const values = row.normalized_values;
      if (batch.contract_version === 2) {
        const matches = await matchingLeads(tx, organization_id, [values], import_id);
        const candidates = detectDuplicateCandidates({ rows: [{ id: row.id, rowNumber: row.row_number, normalizedValues: values }], existingLeads: matches }).get(row.id) || [];
        if (candidates.length) {
          await repository.updateRowDuplicates(row.id, organization_id, candidates);
          await repository.outcome({ organization_id, import_id, import_row_id, review_revision: revision, state: "HELD", hold_reason: "DUPLICATE_REVIEW_REQUIRED" });
          await writeIssues(repository, batch, row.id, [], candidates);
          await new AuditRepository(tx).record({ organization_id, event_type: "ImportRowHeld", message: "A new duplicate candidate requires identity review before import.", metadata: { import_id, import_row_id, review_revision: revision, actor: owner, hold_reason: "DUPLICATE_REVIEW_REQUIRED" } });
          return true;
        }
      }
      const lead = await new LeadsRepository(tx).createLead({ organization_id, name: values.name || values.company || values.email || values.normalized_phone || "Imported Lead", email: values.email, phone: values.raw_phone, normalized_email: values.email, normalized_phone: values.normalized_phone, company: values.company,
        source: values.source || "CSV", import_batch_id: import_id, import_row_id,
        source_metadata: { adapter_type: "CSV", import_id, import_row_id, filename: batch.filename, row_number: row.row_number, duplicate_candidate_count: row.duplicate_candidates.length, import_review_revision: revision } });
      if (batch.contract_version === 2 && Object.values(values.enquiry).some(fact => fact.state !== "UNKNOWN")) {
        await new BusinessContextRepository(tx).append("enquiry", { organization_id, lead_id: lead.id, revision: 1, value: values.enquiry, reason: "Created from owner-reviewed CSV fields.", created_at: nowIso(), created_by: owner });
        await new AuditRepository(tx).record({ organization_id, lead_id: lead.id, event_type: "LeadEnquiryContextUpdated", message: "Initial enquiry facts retained their reviewed import source.", metadata: { import_id, import_row_id, review_revision: revision, actor: owner, revision: 1 } });
      }
      const event = await new EventsRepository(tx).publish({ organization_id, lead_id: lead.id, type: "LeadCreated", payload: { lead_id: lead.id, source: lead.source, import_id, import_row_id } });
      await repository.outcome({ organization_id, import_id, import_row_id, review_revision: revision, state: "COMMITTED", lead_id: lead.id, event_id: event.id });
      await new AuditRepository(tx).record({ organization_id, lead_id: lead.id, event_type: "ImportRowCommitted", message: "Reviewed source row, lead, context and processing event committed together.", metadata: { import_id, import_row_id, review_revision: revision, actor: owner, event_id: event.id } });
      return true;
    });
  }
  async finishChunk({ import_id, organization_id, owner }) {
    return this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
      await requireOwner(tx, organization_id, owner);
      const repository = new ImportsRepository(tx), batch = await requireBatch(repository, import_id, organization_id);
      if (batch.state === "COMMITTED") return;
      if (!batch.frozen_selection_json || batch.commit_revision !== batch.review_revision) throw corrupt();
      const rows = (await repository.listRows(import_id, organization_id)).map(serializeImportRow);
      await verifyOutcomes(repository, batch, rows);
      const progress = progressFor(rows);
      const complete = progress.remaining_rows === 0;
      await repository.updateBatchState(import_id, complete ? "COMMITTED" : "COMMITTING", { organization_id, summary: summaryFor(rows, await repository.listIssues(import_id, organization_id)), committed_at: complete ? nowIso() : null });
      if (complete) await new AuditRepository(tx).record({ organization_id, event_type: "ImportCommitted", message: "Frozen import selection finished processing; held rows remain visible.", metadata: { import_id, actor: owner, ...progress } });
    });
  }
  getBatchForOrganization(importId, organizationId) { return requireBatch(this.importsRepository, importId, organizationId); }
}

function actorId(actor) {
  if (!actor || actor.role !== "OWNER") throw importError("IMPORT_OWNER_REQUIRED", "Only a current workspace owner may import or correct lead data.", 403);
  return importText(actor.id, "actor.id");
}
async function requireOwner(tx, org, actor) {
  if (!await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [org, actor])) throw importError("IMPORT_OWNER_REQUIRED", "Only a current workspace owner may import or correct lead data.", 403);
}
async function requireBatch(repository, id, org) {
  const batch = await repository.getBatch(id, org);
  if (!batch) throw importError("IMPORT_NOT_FOUND", "Import not found for organization.", 404);
  return batch;
}
function stale() { return importError("IMPORT_REVIEW_STALE", "Import review changed. Load the latest preview before deciding.", 409); }
function corrupt() { return importError("IMPORT_STATE_INVALID", "Stored import outcome requires operational review.", 503); }
function eligible(row, version) { return !row.identity_resolution && row.validation_state === "VALID" && row.commit_state === "PENDING" && !row.committed && (version === 1 || row.duplicate_candidates.length === 0); }
function correctionShape(row) { return { mapped_values: row.mapped_values, normalized_values: row.normalized_values, validation_state: row.validation_state, duplicate_candidates: row.duplicate_candidates }; }
async function detail(repository, batch) {
  const serialized = serializeImportBatch(batch), rows = (await repository.listRows(batch.id, batch.organization_id)).map(serializeImportRow);
  await verifyOutcomes(repository, batch, rows);
  const issues = (await repository.listIssues(batch.id, batch.organization_id)).map(serializeImportIssue);
  const resolutions = (await new ImportIdentityRepository(repository.db).list(batch.organization_id, batch.id)).map(serializeIdentityResolution), byRow = new Map(resolutions.map(item => [item.import_row_id, item]));
  for (const row of rows) {
    row.identity_resolution = byRow.get(row.id) || null;
    row.can_commit = batch.contract_version > 0 && !batch.frozen_selection_json && eligible(row, batch.contract_version);
    row.can_resolve_identity = !identityUnavailable(batch, row, Boolean(row.identity_resolution)) && (row.commit_state === "HELD" || row.duplicate_candidates.length > 0);
  }
  const progress = progressFor(rows), summary = summaryFor(rows, issues);
  return { import_id: batch.id, state: batch.state, summary, import: { ...serialized, summary }, rows, issues,
    duplicate_candidates: rows.flatMap(row => row.duplicate_candidates.map(candidate => ({ import_row_id: row.id, row_number: row.row_number, ...candidate }))),
    review_revision: batch.review_revision, contract_version: batch.contract_version, frozen_selection: serialized.frozen_selection,
    progress, resolutions, resolution_summary: identitySummary(rows), corrections: await repository.corrections(batch.id, batch.organization_id), legacy_review_required: batch.contract_version === 0 && batch.state !== "COMMITTED" };
}
function summaryFor(rows, issues) {
  const progress = progressFor(rows), invalid = rows.filter(row => row.validation_state !== "VALID").length;
  return { total_rows: rows.length, valid_rows: rows.length - invalid, invalid_rows: invalid, duplicate_candidate_rows: rows.filter(row => row.duplicate_candidates.length).length, issue_count: issues.length, ...progress };
}
async function writeIssues(repository, batch, rowId, validation, duplicates) {
  for (const issue of validation || []) await repository.createIssue({ import_id: batch.id, import_row_id: rowId, organization_id: batch.organization_id, ...issue });
  for (const candidate of duplicates || []) await repository.createIssue({ import_id: batch.id, import_row_id: rowId, organization_id: batch.organization_id, issue_type: "DUPLICATE_CANDIDATE", field: candidate.duplicate_type === "STRONG_EMAIL" ? "email" : candidate.duplicate_type === "STRONG_PHONE" ? "phone" : "name_company", message: candidate.message, severity: "WARNING", metadata: candidate });
}
function legacyPreview(csvText, region) {
  const parsed = parseCsvLeadRows(csvText);
  return { ...parsed, rows: parsed.rows.map(row => {
    const normalized = normalizeImportedValues(row.mappedValues, region), validationIssues = validateImportedLead(normalized);
    const { _valid_email, _valid_phone, _phone_message, ...normalizedValues } = normalized;
    return { ...row, normalizedValues, validationIssues, validationState: validationIssues.some(issue => issue.severity === "ERROR") ? "INVALID" : "VALID" };
  }) };
}
async function matchingLeads(tx, org, values, excludeImportId = null) {
  const found = [], scope = "organization_id=?" + (excludeImportId === null ? "" : " AND NOT EXISTS (SELECT 1 FROM import_row_outcomes ordinary WHERE ordinary.organization_id=leads.organization_id AND ordinary.import_id=? AND ordinary.lead_id=leads.id AND ordinary.state='COMMITTED')"), base = [org, ...(excludeImportId === null ? [] : [excludeImportId])];
  for (const [field, key] of [["normalized_email", "email"], ["normalized_phone", "normalized_phone"]]) {
    const needles = [...new Set(values.map(value => value[key]).filter(Boolean))];
    if (needles.length) found.push(...await tx.all("SELECT MIN(id) AS id," + field + " FROM leads WHERE " + scope + " AND " + field + " IN (" + needles.map(() => "?").join(",") + ") GROUP BY " + field, [...base, ...needles]));
  }
  const keys = [...new Set(values.map(value => buildNameCompanyLookupKey(value.name, value.company)).filter(Boolean))];
  if (keys.length) found.push(...await tx.all("SELECT matched.id,matched.name,matched.company FROM leads matched JOIN (SELECT MIN(id) AS id FROM leads WHERE " + scope + " AND normalized_name_company_key IN (" + keys.map(() => "?").join(",") + ") GROUP BY normalized_name_company_key) canonical ON canonical.id=matched.id", [...base, ...keys]));
  return found;
}

async function verifyOutcomes(repository, batch, rows) {
  if (batch.contract_version === 0) return;
  const outcomes = await repository.listOutcomes(batch.id, batch.organization_id), byId = new Map(outcomes.map(item => [item.import_row_id, item]));
  const frozen = serializeImportBatch(batch).frozen_selection;
  if (frozen !== null && (!Array.isArray(frozen) || frozen.length === 0 || frozen.length > 1000 || new Set(frozen).size !== frozen.length || batch.commit_revision !== batch.review_revision)) throw corrupt();
  for (const row of rows) {
    if (Boolean(row.selected) !== Boolean(frozen?.includes(row.id))) throw corrupt();
    const outcome = byId.get(row.id);
    if (outcome) {
      if (!row.selected || outcome.review_revision !== batch.commit_revision || row.commit_state !== outcome.state || row.created_lead_id !== outcome.lead_id || Boolean(row.committed) !== (outcome.state === "COMMITTED")) throw corrupt();
      byId.delete(row.id);
    } else if (row.commit_state !== "PENDING" || row.committed || row.created_lead_id) throw corrupt();
  }
  if (byId.size || (frozen && rows.filter(row => row.selected).length !== frozen.length)) throw corrupt();
}

export { detail as importDetailInTransaction };
