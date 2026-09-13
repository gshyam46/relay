import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluateBusinessFit, parseBusinessFit, compareBusinessPriority } from "../src/modules/lead-intelligence/businessFit.js";
import { normalizeEnquiry, normalizeProfile } from "../src/modules/business-context/businessContextContract.js";
import { normalizeFitCriteria } from "../src/modules/business-context/fitCriteriaContract.js";
import { assessSource } from "../src/modules/lead-intelligence/freshnessContract.js";
import { analyzeReadiness } from "../src/modules/lead-intelligence/readiness.js";

const bytes = readFileSync(new URL("./fixtures/business-fit/criteria-v1.json", import.meta.url));
const fixture = JSON.parse(bytes);
function inputFor(item) {
  const selected = fixture.profiles[item.profile];
  const enquiry = normalizeEnquiry({ ...structuredClone(fixture.base_enquiry), ...structuredClone(item.enquiry_patch) });
  const facts = Object.fromEntries(Object.entries(enquiry).map(([field, fact]) => {
    const assess = (source, state = "KNOWN") => assessSource({ field, value_state: state, assertion: source.provenance?.assertion || null, source_reference: source.provenance?.source_reference || null, observed_at: source.provenance?.observed_at || null, recorded_at: fixture.recorded_at, historical: ["enquiry_date", "last_interaction"].includes(field) }, Date.parse(fixture.evaluated_at));
    return [field, fact.state === "CONFLICTED" ? { ...assess(fact, fact.state), alternatives: fact.alternatives.map(source => assess(source)) } : assess(fact, fact.state)];
  }));
  return { businessContext: { profile: { revision: 1, profile: normalizeProfile(selected.profile), fit_criteria: normalizeFitCriteria(selected.fit_criteria) }, enquiry: { revision: 1, enquiry }, revisions: { profile_revision: 1, enquiry_revision: 1 } }, freshness: { evaluated_at: fixture.evaluated_at, facts } };
}
function evaluated(id) { return evaluateBusinessFit(inputFor(fixture.cases.find(item => item.id === id))); }

test("business-fit expectations remain the independently frozen synthetic fixture", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "675f97bd0c65aa226be3ee29415c94918ec5b8f500a2a8999b4a5b99018cb55e");
  assert.equal(fixture.cases.length, 37); assert.match(fixture.labels, /not customer judgments/);
});
for (const item of fixture.cases) test("frozen qualification: " + item.id, () => {
  const input = inputFor(item), result = evaluateBusinessFit(input);
  assert.equal(result.status, item.expected.status);
  assert.equal(result.attention_priority.band, item.expected.band);
  for (const [field, expected] of Object.entries(item.expected.outcomes)) assert.equal(result.criterion_results.find(row => row.criterion_id === field)?.outcome, expected, field);
  for (const key of ["preferred_matches", "ranking_incomplete"]) if (Object.hasOwn(item.expected, key)) assert.equal(result.attention_priority[key], item.expected[key], key);
  assert.deepEqual(parseBusinessFit(JSON.stringify(result)), result);
  for (const row of result.criterion_results) {
    assert.deepEqual(row.evidence.fact, input.businessContext.enquiry.enquiry[row.criterion_id], "Criterion retains its exact fact, provenance and alternatives");
    assert.deepEqual(row.evidence.freshness, input.freshness.facts[row.criterion_id]);
    if (row.evidence.fact.state === "UNKNOWN") assert.ok(row.missing_fields.includes(row.criterion_id));
  }
});

function concordant(order, expected) {
  let correct = 0, total = 0;
  for (let i = 0; i < expected.length; i++) for (let j = i + 1; j < expected.length; j++) { total++; if (order.indexOf(expected[i]) < order.indexOf(expected[j])) correct++; }
  return { correct, total };
}
test("frozen business-order pairs improve on two explicitly simple baselines for this synthetic cohort", () => {
  const rows = fixture.ranking_cohort.map(item => ({ ...item, business_fit: evaluated(item.case_id) }));
  const businessOrder = [...rows].sort(compareBusinessPriority).map(item => item.lead_id);
  const recencyOrder = [...rows].sort((a, b) => Date.parse(b.last_recorded_at) - Date.parse(a.last_recorded_at) || a.lead_id.localeCompare(b.lead_id)).map(item => item.lead_id);
  const readiness = row => analyzeReadiness({ ...row.lead, normalized_email: row.lead.email, normalized_phone: row.lead.phone, source: "MANUAL" }).score;
  const readinessOrder = [...rows].sort((a, b) => readiness(b) - readiness(a) || a.lead_id.localeCompare(b.lead_id)).map(item => item.lead_id);
  assert.deepEqual(businessOrder, fixture.expected_order);
  assert.deepEqual(recencyOrder, fixture.expected_recency_order);
  assert.deepEqual(readinessOrder, fixture.expected_readiness_order);
  assert.deepEqual(concordant(businessOrder, fixture.expected_order), { correct: 6, total: 6 });
  assert.deepEqual(concordant(readinessOrder, fixture.expected_order), { correct: 3, total: 6 });
  assert.deepEqual(concordant(recencyOrder, fixture.expected_order), { correct: 1, total: 6 });
});

test("priority uses neither recency nor legacy score and treats outdated/archived/missing assessments as unassessed", () => {
  const fit = evaluated("matching");
  const rows = [
    { lead_id: "b", business_fit: fit, score: 100, created_at: "2099-01-01" },
    { lead_id: "a", business_fit: fit, score: 0, created_at: "2000-01-01" },
    { lead_id: "0", business_fit: fit, currentness: { state: "OUTDATED" } },
    { lead_id: "1", business_fit: fit, archived_at: "2026-01-01T00:00:00.000Z" },
    { lead_id: "2", business_fit: null, attention_priority: fit.attention_priority }
  ];
  assert.deepEqual(rows.sort(compareBusinessPriority).map(item => item.lead_id), ["a", "b", "0", "1", "2"]);
});

test("unknown-language and source-review coverage remains visible instead of inflating match accuracy", () => {
  const results = fixture.cases.map(item => ({ id: item.id, fit: evaluateBusinessFit(inputFor(item)) }));
  const counts = Object.fromEntries(["MATCHES_CRITERIA", "DOES_NOT_MATCH", "NEEDS_REVIEW", "NOT_CONFIGURED"].map(status => [status, results.filter(item => item.fit.status === status).length]));
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 37);
  for (const id of ["unknown_interest", "negated_phrase", "unmapped_language", "stale_interest", "undated_interest", "future_interest", "inferred_interest", "conflicted_interest"]) assert.equal(results.find(item => item.id === id).fit.status, "NEEDS_REVIEW");
  assert.equal(evaluated("repair_business_match").status, "MATCHES_CRITERIA");
  assert.equal(evaluated("repair_against_table_business").status, "DOES_NOT_MATCH");
});
