import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { bindImportEnquiry } from "../src/modules/business-context/importProvenance.js";
import { emptyEnquiry, normalizeEnquiry } from "../src/modules/business-context/businessContextContract.js";
const manual = { assertion: "OPERATOR_OBSERVED", source_type: "MANUAL", source_reference: "Operator correction", observed_at: null };
async function fixture(t, assertion = "OPERATOR_OBSERVED", observedAt = null) {
  const client = await startClient(t), registered = await client.register("Synthetic imported provenance");
  const actor = { id: registered.user.id, role: "OWNER" }, organization_id = registered.organization.id;
  const preview = await client.services.importsService.previewCsv({ organization_id, actor, filename: "source.csv",
    csv_text: "Name,Email,Company,Interest,Budget,Currency,Enquiry date" + (observedAt ? ",Observed at" : "") + "\nSynthetic customer,source@example.test,Example,A dining table,9007199254740993.01,INR,2026-09-10" + (observedAt ? "," + observedAt : ""),
    default_phone_region: "INTERNATIONAL_ONLY", mapping: { name: 0, email: 1, company: 2, interest: 3, budget_amount: 4, currency: 5, enquiry_date: 6, ...(observedAt ? { observed_at: 7 } : {}) },
    options: { date_format: "ISO", default_currency: null, assertion } });
  return { client, actor, organization_id, preview, context: new BusinessContextService(client.db) };
}
async function commit(f) {
  const result = await f.client.services.importsService.commitImport({ organization_id: f.organization_id, import_id: f.preview.import_id, actor: f.actor,
    expected_revision: f.preview.review_revision, selected_row_ids: [f.preview.rows[0].id] });
  f.lead = await f.client.services.leadsRepository.getLead(result.rows[0].created_lead_id);
  return f.context.getEnquiry({ organization_id: f.organization_id, lead_id: f.lead.id });
}
async function save(f, enquiry, revision = 1, lead = f.lead) {
  return f.context.updateEnquiry({ organization_id: f.organization_id, lead_id: lead.id, actor: f.actor, expected_revision: revision, reason: "Reviewed manual correction", enquiry });
}

test("source binding retains actual assertion/time and requires exact row reference and field", () => {
  const enquiry = { ...emptyEnquiry(), interest: { state: "KNOWN", value: "A desk", provenance: { ...manual, observed_at: "2026-09-10T09:00:00.000Z" } } };
  const bound = bindImportEnquiry(enquiry, { import_id: "batch", import_row_id: "row" });
  assert.deepEqual(bound.interest.provenance, { assertion: "OPERATOR_OBSERVED", source_type: "IMPORT_ROW", source_reference: "import_row:row", observed_at: "2026-09-10T09:00:00.000Z", import_id: "batch", import_row_id: "row", field: "interest" });
  assert.deepEqual(bound.budget, { state: "UNKNOWN", value: null, provenance: null });
  for (const patch of [{ field: "budget" }, { source_reference: "unverified reference" }, { source_type: "CSV" }, { extra: true }]) {
    const invalid = structuredClone(bound); Object.assign(invalid.interest.provenance, patch);
    assert.throws(() => normalizeEnquiry(invalid), { code: "INVALID_BUSINESS_CONTEXT" });
  }
});

test("committed imported facts survive other manual edits and become truthful CSV-backed intelligence", async t => {
  const observedAt = new Date(Date.now() - 86400000).toISOString();
  const f = await fixture(t, "OPERATOR_OBSERVED", observedAt); const saved = await commit(f);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM actions")).n, 0, "import never generates actions or invokes providers");
  assert.equal(saved.enquiry.budget.value.minimum_minor, "900719925474099301");
  assert.equal(saved.enquiry.interest.provenance.import_row_id, f.preview.rows[0].id);
  const revised = structuredClone(saved.enquiry);
  revised.timeline = { state: "KNOWN", value: { description: "Operator will clarify timing", target_date: null }, provenance: manual };
  const correction = await save(f, revised); assert.equal(correction.revision, 2);
  assert.deepEqual(correction.enquiry.interest, saved.enquiry.interest);
  const result = await f.client.post("/api/intelligence/bulk-run", { organization_id: f.organization_id, lead_ids: [f.lead.id] });
  assert.equal(result.failed, 0, JSON.stringify(result.results));
  const current = await f.client.get("/api/leads/" + f.lead.id + "/intelligence?organization_id=" + f.organization_id);
  assert.equal(current.recommendation_status, "READY"); assert.equal(current.next_best_action_status, "PLANNED");
  const evidence = current.intelligence.evidence.find(item => item.claim_field === "ENQUIRY_INTEREST");
  assert.equal(evidence.source_type, "CSV"); assert.equal(evidence.source_reference, "import_row:" + f.preview.rows[0].id);
  assert.equal(evidence.raw_content_reference, "import_row:" + f.preview.rows[0].id); assert.equal(evidence.metadata.source_verified, false);
  assert.equal(evidence.metadata.field, "interest"); assert.equal(evidence.evidence_timestamp, observedAt);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("changed values or forged import provenance reject without adding revisions; manual corrections preserve history", async t => {
  const f = await fixture(t), saved = await commit(f);
  const before = await f.client.db.all("SELECT * FROM lead_enquiry_revisions WHERE lead_id=? ORDER BY revision", [f.lead.id]);
  for (const mutate of [
    value => { value.interest.value = "A different product"; },
    value => { value.interest.provenance.assertion = "CUSTOMER_STATED"; },
    value => { value.interest.provenance.observed_at = "2026-09-11T10:00:00.000Z"; },
    value => { value.interest.provenance.import_id = "another-import"; },
    value => { value.interest.provenance.import_row_id = "another-row"; value.interest.provenance.source_reference = "import_row:another-row"; }
  ]) {
    const invalid = structuredClone(saved.enquiry); mutate(invalid);
    await assert.rejects(save(f, invalid), { code: "INVALID_IMPORT_PROVENANCE" });
  }
  assert.deepEqual(await f.client.db.all("SELECT * FROM lead_enquiry_revisions WHERE lead_id=? ORDER BY revision", [f.lead.id]), before);
  const corrected = structuredClone(saved.enquiry); corrected.interest = { state: "KNOWN", value: "A different product", provenance: manual };
  const next = await save(f, corrected); assert.equal(next.enquiry.interest.provenance.source_type, "MANUAL");
  assert.equal((await f.context.enquiryHistory({ organization_id: f.organization_id, lead_id: f.lead.id })).items[1].enquiry.interest.value, "A dining table");
});

test("an import citation cannot be copied to another lead, a foreign workspace or an uncommitted row", async t => {
  const f = await fixture(t);
  const manualLead = await f.client.services.leadsRepository.createLead({ organization_id: f.organization_id, name: "Other lead", email: "other@example.test" });
  await assert.rejects(save(f, f.preview.rows[0].normalized_values.enquiry, 0, manualLead), { code: "INVALID_IMPORT_PROVENANCE" });
  const saved = await commit(f);
  await assert.rejects(save(f, saved.enquiry, 0, manualLead), { code: "INVALID_IMPORT_PROVENANCE" });
  const foreign = await f.client.register("Foreign source workspace");
  const foreignLead = await f.client.services.leadsRepository.createLead({ organization_id: foreign.organization.id, name: "Foreign lead", email: "foreign@example.test" });
  await assert.rejects(f.context.updateEnquiry({ organization_id: foreign.organization.id, lead_id: foreignLead.id, actor: { id: foreign.user.id, role: "OWNER" }, expected_revision: 0,
    reason: "Attempted foreign citation", enquiry: saved.enquiry }), { code: "INVALID_IMPORT_PROVENANCE" });
});

test("an exact imported alternative can be retained in a manual conflict without laundering its source", async t => {
  const f = await fixture(t), saved = await commit(f), conflicting = structuredClone(saved.enquiry);
  conflicting.interest = { state: "CONFLICTED", alternatives: [{ value: saved.enquiry.interest.value, provenance: saved.enquiry.interest.provenance }, { value: "An office desk", provenance: manual }] };
  const result = await save(f, conflicting); assert.equal(result.enquiry.interest.state, "CONFLICTED");
  const forged = structuredClone(result.enquiry); forged.interest.alternatives[0].value = "A fabricated imported alternative";
  await assert.rejects(save(f, forged, 2), { code: "INVALID_IMPORT_PROVENANCE" });
});

test("inferred imported facts complete the full analysis pipeline as review without asserted buying need", async t => {
  const f = await fixture(t, "INFERRED"), saved = await commit(f);
  assert.equal(saved.enquiry.interest.provenance.source_type, "IMPORT_ROW"); assert.equal(saved.enquiry.interest.provenance.assertion, "INFERRED");
  const result = await f.client.post("/api/intelligence/bulk-run", { organization_id: f.organization_id, lead_ids: [f.lead.id] });
  assert.equal(result.failed, 0, JSON.stringify(result.results));
  const current = await f.client.get("/api/leads/" + f.lead.id + "/intelligence?organization_id=" + f.organization_id);
  assert.equal(current.synthesis_status, "READY"); assert.equal(current.recommendation_status, "READY"); assert.equal(current.next_best_action_status, "PLANNED");
  assert.equal(current.next_best_action.action_type, "REVIEW_LEAD_INTELLIGENCE");
  assert.equal(current.intelligence.claims.some(claim => claim.field.startsWith("ENQUIRY_")), false);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM actions WHERE type LIKE 'SEND_%'")).n, 0);
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("undated imported interest remains exact source data but cannot become a current factual claim", async t => {
  const f = await fixture(t), saved = await commit(f);
  assert.equal(saved.enquiry.interest.provenance.observed_at, null);
  const result = await f.client.post("/api/intelligence/bulk-run", { lead_ids: [f.lead.id] });
  assert.equal(result.failed, 0, JSON.stringify(result.results));
  const view = await f.client.get("/api/leads/" + f.lead.id + "/intelligence");
  assert.equal(view.currentness.state, "CURRENT");
  assert.equal(view.freshness.facts.interest.freshness, "AGE_UNKNOWN");
  assert.equal(view.freshness.facts.interest.usable, false);
  assert.equal(view.freshness.facts.interest.source_reference, "import_row:" + f.preview.rows[0].id);
  assert.equal(view.intelligence.claims.some(claim => claim.field === "ENQUIRY_INTEREST"), false);
  assert.equal(view.intelligence.claims.some(claim => claim.field === "ENQUIRY_DATE" && claim.value === "2026-09-10"), true);
  assert.deepEqual((await f.context.getEnquiry({ organization_id: f.organization_id, lead_id: f.lead.id })).enquiry, saved.enquiry);
});
