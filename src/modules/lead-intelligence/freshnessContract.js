import { createHash } from "node:crypto";
import { ENQUIRY_FIELDS, instant } from "../business-context/businessContextContract.js";
export const FRESHNESS_POLICY_VERSION = 1;
export const FRESHNESS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const FRESHNESS_MAX_BYTES = 262144;
export function freshnessError(code, message, statusCode = 503) { return Object.assign(new Error(message), { code, statusCode }); }
export function freshnessHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function freshnessFingerprintPart(assessment) { return assessment?.policy_version ? { freshness: { policy_version: assessment.policy_version, authority_fingerprint: assessment.authority_fingerprint } } : {}; }
export function assessSource({ field, source_reference = null, value_state = "KNOWN", assertion = null, observed_at = null, recorded_at = null, historical = false }, now) {
  const item = { field, source_reference, value_state, assertion, freshness: "NOT_APPLICABLE", observed_at, expires_at: null, usable: false, reasons: [] };
  if (value_state === "UNKNOWN") { item.reasons.push("UNKNOWN_FACT"); return item; }
  let observed = null, recorded = null;
  if (observed_at === null) { item.freshness = historical ? "HISTORICAL" : "AGE_UNKNOWN"; if (historical) item.reasons.push("AGE_UNKNOWN"); }
  else {
    try { observed = Date.parse(instant(observed_at)); recorded = Date.parse(instant(recorded_at)); }
    catch { item.freshness = "INVALID_TIME"; }
    if (observed !== null && recorded !== null) {
      if (observed > recorded) item.freshness = "FUTURE_DATED";
      else if (historical) item.freshness = "HISTORICAL";
      else {
        const expiry = observed + FRESHNESS_TTL_MS;
        if (!Number.isFinite(new Date(expiry).getTime())) item.freshness = "INVALID_TIME";
        else { item.expires_at = new Date(expiry).toISOString(); item.freshness = now >= expiry ? "STALE" : "CURRENT"; }
      }
    }
  }
  if (historical && observed_at === null) { try { instant(recorded_at); } catch { item.freshness = "INVALID_TIME"; } }
  if (!["CURRENT", "HISTORICAL"].includes(item.freshness)) item.reasons.push(item.freshness);
  if (assertion === "INFERRED") item.reasons.push("INFERRED_FACT");
  if (value_state === "CONFLICTED") item.reasons.push("CONFLICTED_FACT");
  item.usable = !item.reasons.length || (item.freshness === "HISTORICAL" && item.reasons.length === 1 && item.reasons[0] === "AGE_UNKNOWN");
  return item;
}
export function freshnessChanges(previous, current) {
  if (!previous) return current.policy_version ? [{ code: "LEGACY_ASSESSMENT_REQUIRED", scope: "POLICY", fields: [] }] : [];
  const reasons = [], add = (code, scope, fields = []) => reasons.push({ code, scope, fields });
  if (previous.policy_version !== current.policy_version) add("POLICY_CHANGED", "POLICY");
  for (const [key, code, scope] of [["profile_revision", "PROFILE_CHANGED", "BUSINESS"], ["enquiry_revision", "ENQUIRY_CHANGED", "ENQUIRY"], ["data_revision", "LEAD_DATA_CHANGED", "LEAD"]]) if (previous.current_revisions[key] !== current.current_revisions[key]) add(code, scope);
  if (previous.source_fingerprint !== current.source_fingerprint) add("SOURCES_CHANGED", "SOURCES");
  if (previous.authority_fingerprint !== current.authority_fingerprint && previous.source_fingerprint === current.source_fingerprint) add("FRESHNESS_CHANGED", "FRESHNESS", ENQUIRY_FIELDS.filter(field => JSON.stringify(previous.facts[field]) !== JSON.stringify(current.facts[field])));
  return reasons;
}
export function parseFreshnessAssessment(value) {
  if (value === null || value === undefined) return null;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > FRESHNESS_MAX_BYTES) throw new Error();
    const item = typeof value === "string" ? JSON.parse(value) : value;
    if (!item || ![0, 1].includes(item.policy_version)) throw new Error();
    instant(item.evaluated_at, "evaluated_at", true); if (item.next_transition_at !== null) instant(item.next_transition_at, "next_transition_at", true);
    for (const key of ["profile_revision", "enquiry_revision", "data_revision"]) if (!Number.isInteger(item.current_revisions?.[key]) || item.current_revisions[key] < 0 || item.current_revisions[key] > 2147483647) throw new Error();
    if (!/^[0-9a-f]{64}$/.test(item.source_fingerprint) || (item.policy_version ? !/^[0-9a-f]{64}$/.test(item.authority_fingerprint) : item.authority_fingerprint !== null)) throw new Error();
    if (!item.facts || Object.keys(item.facts).sort().join(",") !== [...ENQUIRY_FIELDS].sort().join(",") || !Array.isArray(item.research) || item.research.length > 100 || !Array.isArray(item.review_reasons) || item.review_reasons.length > 200) throw new Error();
    if (item.policy_version === 0 && (Object.values(item.current_revisions).some(value => value !== 0) || item.research.length || item.next_transition_at !== null || ENQUIRY_FIELDS.some(field => item.facts[field].value_state !== "UNKNOWN"))) throw new Error();
    for (const field of ENQUIRY_FIELDS) validateFact(item.facts[field], field);
    for (const fact of item.research) { validateFact(fact, fact.field); if (typeof fact.id !== "string" || !fact.id || typeof fact.ingestion_id !== "string" || !fact.ingestion_id) throw new Error(); }
    for (const reason of item.review_reasons) if (typeof reason.code !== "string" || reason.code.length > 80 || !["ENQUIRY", "RESEARCH"].includes(reason.scope) || !Array.isArray(reason.fields) || reason.fields.length > 100 || reason.fields.some(field => typeof field !== "string" || field.length > 100)) throw new Error();
    if (item.policy_version && item.authority_fingerprint !== freshnessHash({ policy_version: item.policy_version, current_revisions: item.current_revisions, source_fingerprint: item.source_fingerprint, facts: item.facts, research: item.research })) throw new Error();
    return item;
  } catch { throw freshnessError("FRESHNESS_STATE_INVALID", "Saved freshness assessment requires operational review."); }
}
function validateFact(item, field, alternative = false) {
  if (!item || item.field !== field || typeof field !== "string" || field.length > 100 || !["UNKNOWN", "KNOWN", "CONFLICTED"].includes(item.value_state) || ![null, "CUSTOMER_STATED", "OPERATOR_OBSERVED", "INFERRED"].includes(item.assertion) || !["CURRENT", "STALE", "AGE_UNKNOWN", "FUTURE_DATED", "INVALID_TIME", "HISTORICAL", "NOT_APPLICABLE"].includes(item.freshness) || typeof item.usable !== "boolean") throw new Error();
  for (const key of ["source_reference", "observed_at"]) if (item[key] !== null && (typeof item[key] !== "string" || item[key].length > 500)) throw new Error();
  if (item.expires_at !== null) instant(item.expires_at, "expires_at", true);
  if (!Array.isArray(item.reasons) || item.reasons.length > 10 || item.reasons.some(reason => typeof reason !== "string" || reason.length > 80)) throw new Error();
  if (item.usable && (item.value_state !== "KNOWN" || item.assertion === "INFERRED" || !["CURRENT", "HISTORICAL"].includes(item.freshness) || (item.reasons.length && !(item.freshness === "HISTORICAL" && item.observed_at === null && item.reasons.length === 1 && item.reasons[0] === "AGE_UNKNOWN")))) throw new Error();
  if (item.alternatives) { if (alternative || item.value_state !== "CONFLICTED" || !Array.isArray(item.alternatives) || item.alternatives.length < 2 || item.alternatives.length > 5) throw new Error(); for (const value of item.alternatives) validateFact(value, field, true); }
}
