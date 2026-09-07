import { buildNameCompanyKey } from "./normalization.js";
import { DUPLICATE_CONFIDENCE, DUPLICATE_TYPES } from "./ingestionContract.js";

export function detectDuplicateCandidates({ rows, existingLeads }) {
  const existingEmail = indexExisting(existingLeads, "normalized_email");
  const existingPhone = indexExisting(existingLeads, "normalized_phone");
  const existingNameCompany = new Map();
  for (const lead of existingLeads) {
    const key = buildNameCompanyKey(lead.name, lead.company);
    if (key && !existingNameCompany.has(key)) {
      existingNameCompany.set(key, lead);
    }
  }

  const seenEmail = new Map();
  const seenPhone = new Map();
  const seenNameCompany = new Map();
  const byRowId = new Map(rows.map((row) => [row.id, []]));

  for (const row of rows) {
    const values = row.normalizedValues;
    addExistingCandidate(byRowId, row, existingEmail.get(values.email), DUPLICATE_TYPES.STRONG_EMAIL);
    addExistingCandidate(byRowId, row, existingPhone.get(values.normalized_phone), DUPLICATE_TYPES.STRONG_PHONE);
    addExistingCandidate(
      byRowId,
      row,
      existingNameCompany.get(buildNameCompanyKey(values.name, values.company)),
      DUPLICATE_TYPES.POSSIBLE_NAME_COMPANY
    );

    addPreviewCandidate(byRowId, row, seenEmail, values.email, DUPLICATE_TYPES.STRONG_EMAIL);
    addPreviewCandidate(byRowId, row, seenPhone, values.normalized_phone, DUPLICATE_TYPES.STRONG_PHONE);
    addPreviewCandidate(
      byRowId,
      row,
      seenNameCompany,
      buildNameCompanyKey(values.name, values.company),
      DUPLICATE_TYPES.POSSIBLE_NAME_COMPANY
    );
  }

  return byRowId;
}

function indexExisting(leads, fieldName) {
  const index = new Map();
  for (const lead of leads) {
    if (lead[fieldName] && !index.has(lead[fieldName])) {
      index.set(lead[fieldName], lead);
    }
  }
  return index;
}

function addExistingCandidate(byRowId, row, matchedLead, duplicateType) {
  if (!matchedLead) {
    return;
  }
  byRowId.get(row.id).push({
    duplicate_type: duplicateType,
    matched_lead_id: matchedLead.id,
    matched_import_row_id: null,
    confidence: duplicateType === DUPLICATE_TYPES.POSSIBLE_NAME_COMPANY ? DUPLICATE_CONFIDENCE.POSSIBLE : DUPLICATE_CONFIDENCE.STRONG,
    message: duplicateMessage(duplicateType, "existing lead")
  });
}

function addPreviewCandidate(byRowId, row, index, key, duplicateType) {
  if (!key) {
    return;
  }
  const existingRow = index.get(key);
  if (existingRow) {
    const candidate = {
      duplicate_type: duplicateType,
      matched_lead_id: null,
      matched_import_row_id: existingRow.id,
      confidence: duplicateType === DUPLICATE_TYPES.POSSIBLE_NAME_COMPANY ? DUPLICATE_CONFIDENCE.POSSIBLE : DUPLICATE_CONFIDENCE.STRONG,
      message: duplicateMessage(duplicateType, `preview row ${existingRow.rowNumber}`)
    };
    byRowId.get(row.id).push(candidate);
    byRowId.get(existingRow.id).push({
      ...candidate,
      matched_import_row_id: row.id,
      message: duplicateMessage(duplicateType, `preview row ${row.rowNumber}`)
    });
    return;
  }
  index.set(key, row);
}

function duplicateMessage(duplicateType, target) {
  const label = {
    STRONG_EMAIL: "matching email",
    STRONG_PHONE: "matching phone",
    POSSIBLE_NAME_COMPANY: "matching name and company"
  }[duplicateType];
  return `Duplicate candidate: ${label} with ${target}.`;
}
