import { normalizeFitCriteria } from "./fitCriteriaContract.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { contextError, emptyEnquiry, emptyProfile, historyOptions, normalizeEnquiry, normalizeProfile } from "./businessContextContract.js";

const SPECS = {
  profile: { table: "business_profile_revisions", column: "profile_json", normalize: normalizeProfile, empty: emptyProfile },
  enquiry: { table: "lead_enquiry_revisions", column: "enquiry_json", normalize: normalizeEnquiry, empty: emptyEnquiry }
};

export class BusinessContextRepository {
  constructor(db) { this.db = db; }
  async requireWorkspace(organizationId) {
    if (typeof organizationId !== "string" || !organizationId || !await this.db.get("SELECT id FROM organizations WHERE id = ?", [organizationId])) throw contextError("BUSINESS_CONTEXT_NOT_FOUND", "Workspace not found.", 404);
  }
  async requireLead(organizationId, leadId) {
    if (typeof leadId !== "string" || !leadId || !await this.db.get("SELECT id FROM leads WHERE organization_id = ? AND id = ?", [organizationId, leadId])) throw contextError("BUSINESS_CONTEXT_NOT_FOUND", "Lead not found for workspace.", 404);
  }
  async current(kind, organizationId, leadId = null) {
    const { table } = specification(kind);
    const row = await this.db.get("SELECT * FROM " + table + " WHERE organization_id = ?" + (kind === "enquiry" ? " AND lead_id = ?" : "") + " ORDER BY revision DESC LIMIT 1", [organizationId, ...(kind === "enquiry" ? [leadId] : [])]);
    return serialize(kind, row);
  }
  async history(kind, organizationId, leadId, options) {
    const { before_revision, limit } = historyOptions(options), { table } = specification(kind);
    const rows = await this.db.all("SELECT * FROM " + table + " WHERE organization_id = ?" + (kind === "enquiry" ? " AND lead_id = ?" : "") + (before_revision === null ? "" : " AND revision < ?") + " ORDER BY revision DESC LIMIT ?",
      [organizationId, ...(kind === "enquiry" ? [leadId] : []), ...(before_revision === null ? [] : [before_revision]), limit + 1]);
    const items = rows.slice(0, limit).map(row => serialize(kind, row));
    return { items, next_before_revision: rows.length > limit ? items.at(-1).revision : null };
  }
  async append(kind, { organization_id, lead_id = null, revision, value, fit_criteria = null, reason, created_at, created_by }) {
    assertWorkspaceTransaction(this.db, organization_id);
    const { table, column } = specification(kind);
    const columns = ["organization_id", ...(kind === "enquiry" ? ["lead_id"] : []), "revision", "schema_version", column, ...(kind === "profile" ? ["fit_criteria_json"] : []), "reason", "created_at", "created_by"];
    await this.db.run("INSERT INTO " + table + " (" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ")",
      [organization_id, ...(kind === "enquiry" ? [lead_id] : []), revision, 1, JSON.stringify(value), ...(kind === "profile" ? [fit_criteria === null ? null : JSON.stringify(normalizeFitCriteria(fit_criteria))] : []), reason, created_at, created_by]);
    return { revision, schema_version: 1, [kind]: value, ...(kind === "profile" ? { fit_criteria } : {}), reason, created_at, created_by };
  }
}

export async function loadLeadBusinessContext(db, { organization_id, lead_id }) {
  const repository = new BusinessContextRepository(db);
  await repository.requireLead(organization_id, lead_id);
  const profile = await repository.current("profile", organization_id);
  const enquiry = await repository.current("enquiry", organization_id, lead_id);
  return { profile, enquiry, revisions: { profile_revision: profile.revision, enquiry_revision: enquiry.revision } };
}

function specification(kind) {
  if (!Object.hasOwn(SPECS, kind)) throw new TypeError("Unknown business context kind.");
  return SPECS[kind];
}
function serialize(kind, row) {
  const spec = specification(kind);
  if (!row) return { revision: 0, schema_version: 1, [kind]: spec.empty(), ...(kind === "profile" ? { fit_criteria: null } : {}), reason: null, created_at: null, created_by: null };
  try {
    if (row.schema_version !== 1 || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483647 || typeof row[spec.column] !== "string") throw new Error("Invalid persisted version.");
    return { revision: row.revision, schema_version: 1, [kind]: spec.normalize(JSON.parse(row[spec.column])), ...(kind === "profile" ? { fit_criteria: row.fit_criteria_json == null ? null : normalizeFitCriteria(JSON.parse(row.fit_criteria_json)) } : {}), reason: row.reason, created_at: row.created_at, created_by: row.created_by };
  } catch {
    throw contextError("BUSINESS_CONTEXT_INVALID", "Saved business context requires operational review.", 503);
  }
}
