import { normalizeEmail, normalizePhone } from "./normalization.js";
import { importFingerprint } from "./reviewedImportContract.js";
export { importFingerprint as leadDataFingerprint };
export const LEAD_DATA_FIELDS = Object.freeze(["name", "email", "phone", "company"]);
export const LEAD_DATA_MAX_REVISION = 2147483647;
export function leadDataError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function leadDataText(value, field, maximum = 256, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw leadDataError("LEAD_DATA_INVALID_INPUT", field + " requires bounded text without control characters.");
  return value.trim();
}
export function leadDataObject(input, allowed, required = allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) throw leadDataError("LEAD_DATA_INVALID_INPUT", "Supply exactly the documented fields.");
  return input;
}
export function leadDataRevision(value) {
  if (!Number.isInteger(value) || value < 0 || value >= LEAD_DATA_MAX_REVISION) throw leadDataError("LEAD_DATA_INVALID_REVISION", "Supply the current integer data revision.");
  return value;
}
export function normalizeLeadData(values, region) {
  leadDataObject(values, LEAD_DATA_FIELDS);
  if (!["IN", "US", "INTERNATIONAL_ONLY"].includes(region)) throw leadDataError("LEAD_DATA_INVALID_INPUT", "Choose explicit phone interpretation.");
  const name = leadDataText(values.name, "name", 200), company = leadDataText(values.company, "company", 200, true);
  const email = normalizeEmail(leadDataText(values.email, "email", 320, true)), phone = normalizePhone(leadDataText(values.phone, "phone", 80, true), region);
  if (!email.valid || !phone.valid) throw leadDataError("LEAD_DATA_INVALID_INPUT", !email.valid ? "email must be a valid email address." : phone.message);
  return { values: { name, email: email.value, phone: phone.raw_phone, company }, normalized_values: { name, email: email.value, phone: phone.raw_phone, normalized_email: email.value, normalized_phone: phone.normalized_phone, company } };
}
export function leadDataCommand(input, kind) {
  const extras = kind === "ARCHIVE" ? ["archived", "reason"] : ["values", "default_phone_region", ...(kind === "UPDATE" ? ["review_token", "reason"] : [])];
  leadDataObject(input, ["organization_id", "lead_id", "actor", "expected_revision", ...extras]);
  const command = { organization_id: leadDataText(input.organization_id, "organization_id"), lead_id: leadDataText(input.lead_id, "lead_id"), expected_revision: leadDataRevision(input.expected_revision) };
  if (!input.actor || input.actor.role !== "OWNER") throw leadDataError("LEAD_DATA_OWNER_REQUIRED", "A current workspace owner is required.", 403);
  command.actor = { id: leadDataText(input.actor.id, "actor.id"), role: "OWNER" };
  if (kind === "ARCHIVE") {
    if (typeof input.archived !== "boolean") throw leadDataError("LEAD_DATA_INVALID_INPUT", "archived must be an explicit boolean.");
    return { ...command, archived: input.archived, reason: leadDataText(input.reason, "reason", 2000) };
  }
  const proposed = normalizeLeadData(input.values, input.default_phone_region);
  const result = { ...command, proposed, default_phone_region: input.default_phone_region };
  if (kind === "UPDATE") {
    if (typeof input.review_token !== "string" || !/^[a-f0-9]{64}$/.test(input.review_token)) throw leadDataError("LEAD_DATA_INVALID_INPUT", "Supply the exact correction review token.");
    Object.assign(result, { review_token: input.review_token, reason: leadDataText(input.reason, "reason", 2000) });
  }
  return result;
}
export async function requireLeadDataOwner(db, org, actor) {
  if (!actor || actor.role !== "OWNER" || !await db.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [org, actor.id])) throw leadDataError("LEAD_DATA_OWNER_REQUIRED", "A current workspace owner is required.", 403);
}
export function emptyLeadFieldProvenance() { return Object.fromEntries(LEAD_DATA_FIELDS.map(field => [field, null])); }
export function leadDataValues(lead) { return Object.fromEntries(LEAD_DATA_FIELDS.map(field => [field, lead[field] ?? null])); }
export function leadDataSnapshot(lead, provenance = emptyLeadFieldProvenance()) {
  return { data_revision: Number(lead.data_revision || 0), archived_at: lead.archived_at || null, values: leadDataValues(lead), normalized_values: { ...leadDataValues(lead), normalized_email: lead.normalized_email ?? null, normalized_phone: lead.normalized_phone ?? null }, field_provenance: provenance };
}
export function publicDataEffects(effects) {
  const ids = effects.carried_restriction_ids || [];
  return { ...effects, carried_restriction_ids: ids.slice(0, 100), carried_restriction_count: ids.length, carried_restrictions_truncated: ids.length > 100 };
}
export function serializeLeadDataChange(row) {
  if (!row) return null;
  try {
    return { id: row.id, expected_revision: row.expected_revision, revision: row.revision, kind: row.kind, before: JSON.parse(row.before_json), after: JSON.parse(row.after_json), reason: row.reason, created_at: row.created_at, created_by: row.created_by, effects: publicDataEffects(JSON.parse(row.effects_json)) };
  } catch { throw leadDataError("LEAD_DATA_STATE_INVALID", "Saved data history requires operational review.", 503); }
}
