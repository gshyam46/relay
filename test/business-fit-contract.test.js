import test from "node:test";
import assert from "node:assert/strict";
import { emptyEnquiry, emptyProfile, normalizeEnquiry } from "../src/modules/business-context/businessContextContract.js";
import { normalizeFitCriteria } from "../src/modules/business-context/fitCriteriaContract.js";
import { assessSource } from "../src/modules/lead-intelligence/freshnessContract.js";
import { evaluateBusinessFit, parseBusinessFit, BUSINESS_FIT_MAX_BYTES } from "../src/modules/lead-intelligence/businessFit.js";
const AT = "2026-09-12T10:00:00.000Z";
const criteria = () => ({ version: 1, interest: { requirement: "REQUIRED", accepted_aliases: ["Table"], excluded_aliases: [] }, location: null, budget: null, timeline: null });
const known = value => ({ state: "KNOWN", value, provenance: { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic customer record", observed_at: AT } });
function evaluate(config = criteria(), fact = known("table"), profile = emptyProfile()) {
  const enquiry = normalizeEnquiry({ ...emptyEnquiry(), interest: fact });
  const facts = Object.fromEntries(Object.entries(enquiry).map(([field, value]) => [field, assessSource({ field, value_state: value.state, ...value.provenance, recorded_at: AT }, Date.parse(AT))]));
  return evaluateBusinessFit({ businessContext: { profile: { revision: 1, profile, fit_criteria: config }, enquiry: { enquiry } }, freshness: { evaluated_at: AT, facts } });
}
test("criteria normalization preserves exact decimals and collapses canonical alias permutations for no-op comparison", () => {
  const config = { ...criteria(), interest: { requirement: "REQUIRED", accepted_aliases: ["  DINING   TABLE ", "Cafe\u0301"], excluded_aliases: ["  CHAIR "] }, budget: { requirement: "PREFERRED", currency: "KWD", minimum: "9007199254740993.01" } };
  const normalized = normalizeFitCriteria(config); assert.deepEqual(normalized.interest.accepted_aliases, ["caf\u00e9", "dining table"]); assert.equal(normalized.budget.minimum, "9007199254740993.010");
  assert.deepEqual(normalizeFitCriteria({ ...config, interest: { ...config.interest, accepted_aliases: ["CAF\u00c9", "dining table"] }, budget: { ...config.budget, minimum: "9007199254740993.010" } }), normalized);
  assert.equal(normalizeFitCriteria(null), null);
});
test("criteria rejects ambiguity, missing required criteria, unsupported expressions and snapshot byte overflow", () => {
  const invalid = [
    { ...criteria(), extra: true }, { ...criteria(), version: 2 }, { ...criteria(), interest: null },
    { ...criteria(), interest: { ...criteria().interest, requirement: "PREFERRED" } },
    { ...criteria(), interest: { ...criteria().interest, accepted_aliases: ["Table", " TABLE "] } },
    { ...criteria(), interest: { ...criteria().interest, excluded_aliases: [" table "] } },
    { ...criteria(), budget: { requirement: "REQUIRED", currency: "INR", minimum: 100 } },
    { ...criteria(), budget: { requirement: "REQUIRED", currency: "INR", minimum: "1.001" } },
    { ...criteria(), budget: { requirement: "REQUIRED", currency: "BTC", minimum: "1" } },
    { ...criteria(), timeline: { requirement: "REQUIRED", earliest_date: null, latest_date: null } },
    { ...criteria(), timeline: { requirement: "REQUIRED", earliest_date: "2026-02-30", latest_date: null } },
    { ...criteria(), timeline: { requirement: "REQUIRED", earliest_date: "2026-12-01", latest_date: "2026-11-01" } },
    { ...criteria(), interest: { ...criteria().interest, accepted_aliases: Array.from({length:21}, (_,i) => "alias" + i) } }
  ];
  for (const input of invalid) assert.throws(() => normalizeFitCriteria(input), { code: "INVALID_BUSINESS_CONTEXT" });
  const location = { requirement: "REQUIRED", areas: Array.from({ length: 20 }, (_, index) => ({ country_code: "IN", locality: "area" + index, aliases: Array.from({ length: 20 }, (_, alias) => "\u754c".repeat(190) + index + "/" + alias) })), excluded_areas: [] };
  assert.throws(() => normalizeFitCriteria({ ...criteria(), location }), { code: "INVALID_BUSINESS_CONTEXT" });
});
test("geography rejects overlapping country-wide/locality aliases across both accepted and excluded areas", () => {
  const rule = { requirement: "REQUIRED", areas: [{ country_code: "IN", locality: "Mumbai", aliases: ["Bombay"] }], excluded_areas: [] };
  assert.deepEqual(normalizeFitCriteria({ ...criteria(), location: rule }).location.areas[0], { country_code: "IN", locality: "mumbai", aliases: ["bombay"] });
  for (const location of [
    { ...rule, excluded_areas: [{ country_code: "IN", locality: "BOMBAY", aliases: [] }] },
    { ...rule, areas: [...rule.areas, { country_code: "IN", locality: null, aliases: [] }] },
    { ...rule, areas: [{ country_code: "in", locality: null, aliases: [] }] },
    { ...rule, areas: [{ country_code: "IN", locality: null, aliases: ["Mumbai"] }] },
    { ...rule, areas: [{ country_code: "IN", locality: "Mumbai", aliases: ["MUMBAI"] }] }
  ]) assert.throws(() => normalizeFitCriteria({ ...criteria(), location }), { code: "INVALID_BUSINESS_CONTEXT" });
});
test("snapshot parser preserves exact evidence and fails closed on optimistic outcome, source and expiry tampering", () => {
  const result = evaluate(); assert.equal(result.status, "MATCHES_CRITERIA"); assert.deepEqual(parseBusinessFit(JSON.stringify(result)), result);
  const change = mutation => { const copy = structuredClone(result); mutation(copy); assert.throws(() => parseBusinessFit(copy), { code: "BUSINESS_FIT_INVALID", statusCode: 503 }); };
  change(copy => { copy.criterion_results[0].evidence.fact.value = "chair"; });
  change(copy => { copy.criterion_results[0].evidence.fact.provenance.observed_at = null; });
  change(copy => { copy.criterion_results[0].evidence.fact.provenance.source_reference = "Unrelated source"; });
  change(copy => { copy.criterion_results[0].evidence.fact.provenance.assertion = "OPERATOR_OBSERVED"; });
  change(copy => { copy.criterion_results[0].evidence.freshness.expires_at = "2027-01-01T00:00:00.000Z"; });
  change(copy => { copy.criterion_results[0].evidence.freshness.observed_at = "2026-09-13T10:00:00.000Z"; });
  change(copy => { copy.criterion_results[0].evidence.freshness.usable = false; });
  change(copy => { copy.attention_priority.preferred_matches = 99; });
  change(copy => { copy.criteria_revision = 0; });
  change(copy => { copy.criterion_results.push(copy.criterion_results[0]); });
  assert.throws(() => parseBusinessFit(" ".repeat(BUSINESS_FIT_MAX_BYTES + 1)), { code: "BUSINESS_FIT_INVALID" });
  assert.throws(() => parseBusinessFit("{}"), { code: "BUSINESS_FIT_INVALID" });
  assert.equal(parseBusinessFit(null), null);
});
test("no configuration remains unassessed and descriptive notes cannot silently become structured matches", () => {
  const noRules = evaluate(null); assert.equal(noRules.status, "NOT_CONFIGURED"); assert.equal(noRules.attention_priority.band, "UNASSESSED"); assert.deepEqual(parseBusinessFit(noRules), noRules);
  const required = evaluate(criteria(), known("table"), { ...emptyProfile(), required_criteria: ["Custom requirement"] }); assert.equal(required.status, "NEEDS_REVIEW"); assert.equal(required.unassessed_profile_criteria, true);
  const preferred = evaluate(criteria(), known("table"), { ...emptyProfile(), preferred_criteria: ["Custom preference"] }); assert.equal(preferred.status, "MATCHES_CRITERIA"); assert.equal(preferred.attention_priority.ranking_incomplete, true); assert.deepEqual(parseBusinessFit(preferred), preferred);
});
