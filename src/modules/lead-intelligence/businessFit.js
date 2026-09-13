import { FRESHNESS_TTL_MS } from "./freshnessContract.js";
import { contextError, emptyEnquiry, exactObject, instant, normalizeEnquiry, normalizeMoney } from "../business-context/businessContextContract.js";
import { FIT_FIELDS, fitTextKey, normalizeFitCriteria } from "../business-context/fitCriteriaContract.js";
export const BUSINESS_FIT_VERSION = 1;
export const BUSINESS_FIT_MAX_BYTES = 131072;
const LIMITATIONS = Object.freeze({
  SEMANTIC: "Exact owner-approved rules only; unrecognized language needs review.",
  SOURCE: "Recorded statements are not independently verified and fit does not grant contact permission.",
  REQUIRED: "Descriptive required criteria or exclusions remain unevaluated and require owner review.",
  PREFERRED: "Descriptive preferred criteria remain unevaluated; preference ranking is incomplete.",
  NONE: "No structured business criteria are configured."
});
const bands = { MATCHING: 0, REVIEW: 1, LOW: 2, UNASSESSED: 3 };
function invalid() { throw contextError("BUSINESS_FIT_INVALID", "Saved business-fit assessment requires operational review.", 503); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function stable(value) { return JSON.stringify(value && typeof value === "object" ? (Array.isArray(value) ? value.map(item => JSON.parse(stable(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))]))) : value); }
function checkedFact(field, fact) { return normalizeEnquiry({ ...emptyEnquiry(), [field]: fact })[field]; }
function validateFreshness(value, field, evaluatedAt, alternative = false) {
  exactObject(value, ["field", "source_reference", "value_state", "assertion", "freshness", "observed_at", "expires_at", "usable", "reasons", ...(Object.hasOwn(value || {}, "alternatives") ? ["alternatives"] : [])], "business_fit.freshness");
  if (value.field !== field || !["UNKNOWN", "KNOWN", "CONFLICTED"].includes(value.value_state) || ![null, "CUSTOMER_STATED", "OPERATOR_OBSERVED", "INFERRED"].includes(value.assertion) || !["CURRENT", "STALE", "AGE_UNKNOWN", "FUTURE_DATED", "INVALID_TIME", "HISTORICAL", "NOT_APPLICABLE"].includes(value.freshness) || typeof value.usable !== "boolean") invalid();
  for (const key of ["source_reference", "observed_at"]) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 500)) invalid();
  if (value.expires_at !== null) instant(value.expires_at, "expires_at", true);
  if (!Array.isArray(value.reasons) || value.reasons.length > 10 || value.reasons.some(reason => typeof reason !== "string" || !/^[A-Z_]{1,80}$/.test(reason))) invalid();
  if (value.usable) { instant(value.observed_at, "observed_at", true); if (value.observed_at > evaluatedAt || new Date(Date.parse(value.observed_at) + FRESHNESS_TTL_MS).toISOString() !== value.expires_at) invalid(); }
  if (value.usable && (value.value_state !== "KNOWN" || value.assertion === "INFERRED" || value.freshness !== "CURRENT" || value.reasons.length || !value.observed_at || !value.expires_at || value.expires_at <= evaluatedAt)) invalid();
  if (value.alternatives) {
    if (alternative || value.value_state !== "CONFLICTED" || !Array.isArray(value.alternatives) || value.alternatives.length < 2 || value.alternatives.length > 5) invalid();
    for (const item of value.alternatives) validateFreshness(item, field, evaluatedAt, true);
  }
  return copy(value);
}
function criterion(field, rule, fact, freshness) {
  const result = { criterion_id: field, requirement: rule.requirement, rule, outcome: "UNKNOWN", reason_codes: [], evidence: { fact, freshness }, missing_fields: [] };
  const finish = (outcome, codes, missing = []) => ({ ...result, outcome, reason_codes: [...new Set(codes)], missing_fields: missing });
  if (fact.state === "UNKNOWN") return finish("UNKNOWN", ["UNKNOWN_FACT"], [field]);
  if (fact.state === "CONFLICTED" || freshness.value_state === "CONFLICTED") return finish("NEEDS_REVIEW", ["CONFLICTED_FACT", ...freshness.reasons], [field]);
  if (fact.provenance.assertion === "INFERRED") return finish("NEEDS_REVIEW", ["INFERRED_FACT", ...freshness.reasons], [field]);
  if (!freshness.usable || freshness.freshness !== "CURRENT") return finish("NEEDS_REVIEW", freshness.reasons.length ? freshness.reasons : [freshness.freshness], [field]);
  if (freshness.value_state !== "KNOWN" || freshness.assertion !== fact.provenance.assertion || freshness.observed_at !== fact.provenance.observed_at || freshness.source_reference !== fact.provenance.source_reference) invalid();
  const value = fact.value;
  if (field === "interest") {
    const key = fitTextKey(value);
    if (rule.excluded_aliases.includes(key)) return finish("NOT_MATCH", ["EXPLICIT_EXCLUSION"]);
    return rule.accepted_aliases.includes(key) ? finish("MATCH", ["EXACT_ALIAS_MATCH"]) : finish("UNKNOWN", ["UNMAPPED_INTEREST"], [field]);
  }
  if (field === "location") {
    if (!value.country_code) return finish("UNKNOWN", ["MISSING_COUNTRY"], ["location.country_code"]);
    const matches = area => area.country_code === value.country_code && (area.locality === null || [area.locality, ...area.aliases].includes(fitTextKey(value.locality)));
    if (rule.excluded_areas.some(matches)) return finish("NOT_MATCH", ["EXPLICIT_EXCLUSION"]);
    if (rule.areas.some(matches)) return finish("MATCH", ["LOCATION_MATCH"]);
    if (!rule.areas.some(area => area.country_code === value.country_code)) return finish("NOT_MATCH", ["COUNTRY_OUTSIDE_AREAS"]);
    return finish("UNKNOWN", ["UNMAPPED_LOCALITY"], ["location.locality"]);
  }
  if (field === "budget") {
    if (value.currency !== rule.currency) return finish("UNKNOWN", ["CURRENCY_MISMATCH"], [field]);
    const minimum = BigInt(normalizeMoney({ currency: rule.currency, minimum: rule.minimum, maximum: rule.minimum }).minimum_minor);
    if (BigInt(value.minimum_minor) >= minimum) return finish("MATCH", ["BUDGET_MEETS_MINIMUM"]);
    if (BigInt(value.maximum_minor) < minimum) return finish("NOT_MATCH", ["BUDGET_BELOW_MINIMUM"]);
    return finish("UNKNOWN", ["BUDGET_STRADDLES_MINIMUM"], [field]);
  }
  if (!value.target_date) return finish("UNKNOWN", ["MISSING_TARGET_DATE"], ["timeline.target_date"]);
  return (rule.earliest_date && value.target_date < rule.earliest_date) || (rule.latest_date && value.target_date > rule.latest_date) ? finish("NOT_MATCH", ["TARGET_DATE_OUTSIDE_WINDOW"]) : finish("MATCH", ["TARGET_DATE_IN_WINDOW"]);
}
function assemble(revision, evaluatedAt, results, unassessedRequired, unassessedPreferred) {
  let status, band, reason;
  if (!results.length) { status = "NOT_CONFIGURED"; band = "UNASSESSED"; reason = "No structured criteria have been evaluated."; }
  else if (results.some(item => item.outcome === "NOT_MATCH" && (item.requirement === "REQUIRED" || item.reason_codes.includes("EXPLICIT_EXCLUSION")))) { status = "DOES_NOT_MATCH"; band = "LOW"; reason = "A required criterion fails or an explicit exclusion applies."; }
  else if (unassessedRequired || results.some(item => item.requirement === "REQUIRED" && item.outcome !== "MATCH")) { status = "NEEDS_REVIEW"; band = "REVIEW"; reason = "Required information or descriptive criteria still need review."; }
  else { status = "MATCHES_CRITERIA"; band = "MATCHING"; reason = "Current recorded facts meet every structured required criterion."; }
  const preferred = results.filter(item => item.requirement === "PREFERRED");
  const limitations = [LIMITATIONS.SEMANTIC, LIMITATIONS.SOURCE, ...(unassessedRequired ? [LIMITATIONS.REQUIRED] : []), ...(unassessedPreferred ? [LIMITATIONS.PREFERRED] : []), ...(!results.length ? [LIMITATIONS.NONE] : [])];
  return { version: BUSINESS_FIT_VERSION, criteria_revision: revision, evaluated_at: evaluatedAt, status, criterion_results: results, unassessed_profile_criteria: unassessedRequired, limitations,
    attention_priority: { band, reason, preferred_matches: preferred.filter(item => item.outcome === "MATCH").length, preferred_total: preferred.length, ranking_incomplete: !results.length || unassessedRequired || unassessedPreferred || results.some(item => ["UNKNOWN", "NEEDS_REVIEW"].includes(item.outcome)), criterion_refs: results.map(item => item.criterion_id) } };
}
export function evaluateBusinessFit({ businessContext, freshness }) {
  try {
    const revision = businessContext?.profile?.revision;
    if (!Number.isInteger(revision) || revision < 0 || revision > 2147483647) invalid();
    const at = instant(freshness?.evaluated_at, "evaluated_at", true), criteria = normalizeFitCriteria(businessContext.profile.fit_criteria ?? null), profile = businessContext.profile.profile;
    const results = FIT_FIELDS.filter(field => criteria?.[field]).map(field => criterion(field, criteria[field], checkedFact(field, businessContext.enquiry.enquiry[field]), validateFreshness(freshness.facts[field], field, at)));
    const result = assemble(revision, at, results, Boolean(profile?.required_criteria?.length || profile?.exclusions?.length), Boolean(profile?.preferred_criteria?.length));
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > BUSINESS_FIT_MAX_BYTES) invalid();
    return result;
  } catch { invalid(); }
}
export function parseBusinessFit(value) {
  if (value === null || value === undefined) return null;
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > BUSINESS_FIT_MAX_BYTES) invalid();
    const item = JSON.parse(json);
    exactObject(item, ["version", "criteria_revision", "evaluated_at", "status", "criterion_results", "unassessed_profile_criteria", "limitations", "attention_priority"], "business_fit");
    if (item.version !== BUSINESS_FIT_VERSION || !Number.isInteger(item.criteria_revision) || item.criteria_revision < 0 || item.criteria_revision > 2147483647 || typeof item.unassessed_profile_criteria !== "boolean" || !Array.isArray(item.criterion_results) || item.criterion_results.length > 4 || !Array.isArray(item.limitations) || item.limitations.length > 5 || item.limitations.some(value => !Object.values(LIMITATIONS).includes(value))) invalid();
    instant(item.evaluated_at, "evaluated_at", true);
    let criteria = { version: 1, ...Object.fromEntries(FIT_FIELDS.map(field => [field, null])) };
    const seen = new Set();
    for (const result of item.criterion_results) {
      exactObject(result, ["criterion_id", "requirement", "rule", "outcome", "reason_codes", "evidence", "missing_fields"], "business_fit.criterion");
      if (!FIT_FIELDS.includes(result.criterion_id) || seen.has(result.criterion_id)) invalid(); seen.add(result.criterion_id); criteria[result.criterion_id] = result.rule;
      exactObject(result.evidence, ["fact", "freshness"], "business_fit.evidence");
    }
    if (seen.size && item.criteria_revision === 0) invalid();
    criteria = seen.size ? normalizeFitCriteria(criteria) : null;
    const results = FIT_FIELDS.filter(field => criteria?.[field]).map(field => { const old = item.criterion_results.find(result => result.criterion_id === field); return criterion(field, criteria[field], checkedFact(field, old.evidence.fact), validateFreshness(old.evidence.freshness, field, item.evaluated_at)); });
    const expected = assemble(item.criteria_revision, item.evaluated_at, results, item.unassessed_profile_criteria, item.limitations.includes(LIMITATIONS.PREFERRED));
    if (stable(item) !== stable(expected)) invalid();
    return expected;
  } catch { invalid(); }
}
export function compareBusinessPriority(a, b) {
  const usable = row => row?.business_fit && !row.archived_at && (!row.currentness || row.currentness.state === "CURRENT") ? row.business_fit.attention_priority : null;
  const aa = usable(a), bb = usable(b), left = bands[aa?.band] ?? bands.UNASSESSED, right = bands[bb?.band] ?? bands.UNASSESSED;
  if (left !== right) return left - right;
  if (left === bands.MATCHING && aa.preferred_matches !== bb.preferred_matches) return bb.preferred_matches - aa.preferred_matches;
  const idA = String(a?.lead_id ?? a?.id ?? ""), idB = String(b?.lead_id ?? b?.id ?? ""); return idA < idB ? -1 : idA > idB ? 1 : 0;
}
