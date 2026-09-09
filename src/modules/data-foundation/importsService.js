import { createHash } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseCsvLeadRows } from "./csvAdapter.js";
import { detectDuplicateCandidates } from "./duplicateDetection.js";
import {
  IMPORT_ADAPTERS,
  IMPORT_STATES,
  IMPORT_VALIDATION_STATES,
  ISSUE_SEVERITIES,
  PHONE_REGIONS
} from "./ingestionContract.js";
import { normalizeImportedValues } from "./normalization.js";
import { validateImportedLead } from "./importValidation.js";
import { serializeImportBatch, serializeImportIssue, serializeImportRow } from "./importsRepository.js";

export class ImportsService {
  constructor({ importsRepository, leadsRepository, eventsRepository, auditRepository }) {
    this.importsRepository = importsRepository;
    this.leadsRepository = leadsRepository;
    this.eventsRepository = eventsRepository;
    this.auditRepository = auditRepository;
  }

  async previewCsv({ organization_id, filename, csv_text, default_phone_region }) {
    validatePreviewInput({ organization_id, filename, csv_text, default_phone_region });
    const idempotencyKey = buildImportIdempotencyKey({
      organization_id,
      filename,
      csv_text,
      default_phone_region
    });
    const existing = await this.importsRepository.getBatchByIdempotencyKey(idempotencyKey);
    if (existing) {
      return await this.getImport(existing.id, organization_id);
    }

    const sourceMetadata = {
      adapter_type: IMPORT_ADAPTERS.CSV,
      filename,
      default_phone_region
    };
    const batch = await this.importsRepository.createBatch({
      organization_id,
      filename,
      adapter_type: IMPORT_ADAPTERS.CSV,
      source_metadata: sourceMetadata,
      state: IMPORT_STATES.UPLOADED,
      idempotency_key: idempotencyKey,
      summary: emptySummary()
    });
    await this.importsRepository.updateBatchState(batch.id, IMPORT_STATES.PREVIEWED);

    const parsed = parseCsvLeadRows(csv_text);
    const rows = parsed.rows.map((row) => {
      const normalizedValues = normalizeImportedValues(row.mappedValues, default_phone_region);
      const validationIssues = validateImportedLead(normalizedValues);
      return {
        id: createId("import_row"),
        import_id: batch.id,
        organization_id,
        rowNumber: row.rowNumber,
        rawRow: row.rawRow,
        mappedValues: row.mappedValues,
        normalizedValues: stripInternalNormalizationFields(normalizedValues),
        normalizedValuesWithInternal: normalizedValues,
        validationIssues,
        validationState:
          validationIssues.filter((issue) => issue.severity === ISSUE_SEVERITIES.ERROR).length === 0
            ? IMPORT_VALIDATION_STATES.VALID
            : IMPORT_VALIDATION_STATES.INVALID
      };
    });

    const duplicateCandidates = detectDuplicateCandidates({
      rows: rows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        normalizedValues: row.normalizedValues
      })),
      existingLeads: await this.leadsRepository.listLeads(organization_id)
    });

    for (const row of rows) {
      row.duplicateCandidates = duplicateCandidates.get(row.id) || [];
      await this.importsRepository.createRow({
        id: row.id,
        import_id: row.import_id,
        organization_id: row.organization_id,
        row_number: row.rowNumber,
        raw_row: row.rawRow,
        mapped_values: row.mappedValues,
        normalized_values: row.normalizedValues,
        validation_state: row.validationState,
        duplicate_candidates: row.duplicateCandidates
      });
      for (const issue of row.validationIssues) {
        await this.importsRepository.createIssue({
          import_id: batch.id,
          import_row_id: row.id,
          organization_id,
          ...issue
        });
      }
      for (const candidate of row.duplicateCandidates) {
        await this.importsRepository.createIssue({
          import_id: batch.id,
          import_row_id: row.id,
          organization_id,
          issue_type: "DUPLICATE_CANDIDATE",
          field: duplicateField(candidate.duplicate_type),
          message: candidate.message,
          severity: ISSUE_SEVERITIES.WARNING,
          metadata: candidate
        });
      }
    }

    for (const parserIssue of parsed.parserIssues) {
      await this.importsRepository.createIssue({
        import_id: batch.id,
        organization_id,
        issue_type: parserIssue.issue_type,
        field: parserIssue.field,
        message: parserIssue.message,
        severity: parserIssue.severity,
        metadata: { row_number: parserIssue.rowNumber }
      });
    }

    const summary = buildSummary({
      rows,
      parserIssues: parsed.parserIssues,
      committedRows: 0,
      selectedRows: 0
    });
    await this.importsRepository.updateBatchState(batch.id, IMPORT_STATES.READY_TO_COMMIT, { summary });
    await this.auditRepository?.record({
      organization_id,
      event_type: "ImportPreviewed",
      message: "CSV import preview generated for Lead Data Foundation.",
      metadata: { import_id: batch.id, filename, summary }
    });
    return await this.getImport(batch.id, organization_id);
  }

  async listImports(organizationId) {
    return {
      imports: (await this.importsRepository.listBatches(organizationId)).map((batch) => serializeImportBatch(batch))
    };
  }

  async getImport(importId, organizationId) {
    const batch = await this.getBatchForOrganization(importId, organizationId);
    const serializedBatch = serializeImportBatch(batch);
    const rows = (await this.importsRepository.listRows(importId, organizationId)).map((row) => serializeImportRow(row));
    const issues = (await this.importsRepository.listIssues(importId, organizationId)).map((issue) => serializeImportIssue(issue));
    return {
      import_id: batch.id,
      state: batch.state,
      summary: serializedBatch.summary,
      import: serializedBatch,
      rows,
      issues,
      duplicate_candidates: rows.flatMap((row) =>
        row.duplicate_candidates.map((candidate) => ({
          import_row_id: row.id,
          row_number: row.row_number,
          ...candidate
        }))
      )
    };
  }

  async commitImport({ import_id, organization_id, selected_row_ids, simulate_failure_after_rows = null }) {
    if (!Array.isArray(selected_row_ids) || selected_row_ids.length === 0) {
      throw httpError(400, "selected_row_ids is required.");
    }
    const batch = await this.getBatchForOrganization(import_id, organization_id);
    if (batch.state === IMPORT_STATES.COMMITTED) {
      return await this.getImport(import_id, organization_id);
    }
    if (batch.state === IMPORT_STATES.COMMITTING) {
      return await this.getImport(import_id, organization_id);
    }
    if (![IMPORT_STATES.READY_TO_COMMIT, IMPORT_STATES.FAILED].includes(batch.state)) {
      throw httpError(409, "Import is not ready to commit.");
    }
    if (batch.state === IMPORT_STATES.FAILED) {
      await this.importsRepository.updateBatchState(import_id, IMPORT_STATES.READY_TO_COMMIT, { last_error: null });
    }

    const rowIds = [...new Set(selected_row_ids)];
    const selectedRowRecords = await this.importsRepository.getRowsByIds(import_id, organization_id, rowIds);
    const selectedRows = selectedRowRecords.map((row) => serializeImportRow(row));
    if (selectedRows.length !== rowIds.length) {
      throw httpError(404, "One or more selected rows were not found for this import.");
    }
    const invalidRows = selectedRows.filter((row) => row.validation_state !== IMPORT_VALIDATION_STATES.VALID);
    if (invalidRows.length > 0) {
      throw httpError(400, "Invalid rows cannot be committed.");
    }

    await this.importsRepository.markRowsSelected(import_id, organization_id, rowIds);
    await this.importsRepository.updateBatchState(import_id, IMPORT_STATES.COMMITTING, { last_error: null });

    let committedThisRequest = 0;
    try {
      for (const row of selectedRows) {
        if (row.committed) {
          continue;
        }
        const normalizedValues = row.normalized_values;
        const duplicateCandidates = row.duplicate_candidates;
        const lead = await this.leadsRepository.createLead({
          organization_id,
          name: displayNameForImportedLead(normalizedValues),
          email: normalizedValues.email,
          phone: normalizedValues.raw_phone,
          normalized_email: normalizedValues.email,
          normalized_phone: normalizedValues.normalized_phone,
          company: normalizedValues.company,
          source: normalizedValues.source || "CSV",
          import_batch_id: import_id,
          import_row_id: row.id,
          source_metadata: {
            adapter_type: IMPORT_ADAPTERS.CSV,
            import_id,
            import_row_id: row.id,
            filename: batch.filename,
            row_number: row.row_number,
            duplicate_candidate_count: duplicateCandidates.length
          }
        });
        await this.importsRepository.markRowCommitted(row.id, lead.id);
        await this.eventsRepository?.publish({
          organization_id,
          lead_id: lead.id,
          type: "LeadCreated",
          payload: { lead_id: lead.id, source: lead.source, import_id, import_row_id: row.id }
        });
        committedThisRequest += 1;
        if (simulate_failure_after_rows !== null && committedThisRequest >= simulate_failure_after_rows) {
          throw new Error("Simulated commit failure after partial row commit.");
        }
      }

      const rows = (await this.importsRepository.listRows(import_id, organization_id)).map((row) => serializeImportRow(row));
      const issues = (await this.importsRepository.listIssues(import_id, organization_id)).map((issue) => serializeImportIssue(issue));
      const duplicateCandidateRows = rows.filter((row) => row.duplicate_candidates.length > 0).length;
      const invalidRows = rows.filter((row) => row.validation_state === IMPORT_VALIDATION_STATES.INVALID).length;
      const summary = {
        total_rows: rows.length,
        valid_rows: rows.length - invalidRows,
        invalid_rows: invalidRows,
        duplicate_candidate_rows: duplicateCandidateRows,
        issue_count: issues.length,
        selected_rows: rows.filter((row) => row.selected).length,
        committed_rows: rows.filter((row) => row.committed).length
      };
      await this.importsRepository.updateBatchState(import_id, IMPORT_STATES.COMMITTED, {
        summary,
        committed_at: nowIso(),
        last_error: null
      });
      await this.auditRepository?.record({
        organization_id,
        event_type: "ImportCommitted",
        message: "CSV import committed to leads.",
        metadata: { import_id, committed_rows: committedThisRequest }
      });
      return await this.getImport(import_id, organization_id);
    } catch (error) {
      const rows = (await this.importsRepository.listRows(import_id, organization_id)).map((row) => serializeImportRow(row));
      const summary = {
        ...serializeImportBatch(await this.importsRepository.getBatch(import_id)).summary,
        committed_rows: rows.filter((row) => row.committed).length,
        selected_rows: rows.filter((row) => row.selected).length
      };
      await this.importsRepository.updateBatchState(import_id, IMPORT_STATES.FAILED, {
        summary,
        last_error: error.message || String(error)
      });
      throw httpError(500, "Import commit failed. Retry is safe because committed rows are tracked.");
    }
  }

  async getBatchForOrganization(importId, organizationId) {
    const batch = await this.importsRepository.getBatch(importId);
    if (!batch || batch.organization_id !== organizationId) {
      throw httpError(404, "Import not found for organization.");
    }
    return batch;
  }
}

function validatePreviewInput({ organization_id, filename, csv_text, default_phone_region }) {
  if (!organization_id || typeof organization_id !== "string" || !organization_id.trim()) {
    throw httpError(400, "organization_id is required.");
  }
  if (!filename || typeof filename !== "string" || !filename.trim()) {
    throw httpError(400, "filename is required.");
  }
  if (!csv_text || typeof csv_text !== "string" || !csv_text.trim()) {
    throw httpError(400, "csv_text is required.");
  }
  if (!PHONE_REGIONS.has(default_phone_region)) {
    throw httpError(400, "default_phone_region must be one of: IN, US, INTERNATIONAL_ONLY.");
  }
}

function buildImportIdempotencyKey({ organization_id, filename, csv_text, default_phone_region }) {
  return createHash("sha256")
    .update(`${organization_id}\n${filename.trim()}\n${default_phone_region}\n${csv_text}`)
    .digest("hex");
}

function stripInternalNormalizationFields(values) {
  return {
    name: values.name,
    company: values.company,
    email: values.email,
    raw_phone: values.raw_phone,
    normalized_phone: values.normalized_phone,
    source: values.source
  };
}

function displayNameForImportedLead(values) {
  return values.name || values.company || values.email || values.normalized_phone || "Imported Lead";
}

function buildSummary({ rows, parserIssues, committedRows, selectedRows }) {
  const duplicateCandidateRows = rows.filter((row) => row.duplicateCandidates?.length > 0).length;
  const duplicateCandidateCount = rows.reduce((count, row) => count + (row.duplicateCandidates?.length || 0), 0);
  const invalidRows = rows.filter((row) => row.validationState === IMPORT_VALIDATION_STATES.INVALID).length;
  return {
    total_rows: rows.length,
    valid_rows: rows.length - invalidRows,
    invalid_rows: invalidRows,
    duplicate_candidate_rows: duplicateCandidateRows,
    issue_count:
      parserIssues.length + rows.reduce((count, row) => count + (row.validationIssues?.length || 0), 0) + duplicateCandidateCount,
    selected_rows: selectedRows,
    committed_rows: committedRows
  };
}

function emptySummary() {
  return {
    total_rows: 0,
    valid_rows: 0,
    invalid_rows: 0,
    duplicate_candidate_rows: 0,
    issue_count: 0,
    selected_rows: 0,
    committed_rows: 0
  };
}

function duplicateField(duplicateType) {
  if (duplicateType === "STRONG_EMAIL") {
    return "email";
  }
  if (duplicateType === "STRONG_PHONE") {
    return "phone";
  }
  return "name_company";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
