import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { ImportIdentityService } from "../src/modules/data-foundation/importIdentityService.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
const manual = { assertion: "OPERATOR_OBSERVED", source_type: "MANUAL", source_reference: "Reviewed operator note", observed_at: null };
async function fixture(t, { late = false, assertion = "OPERATOR_OBSERVED" } = {}) {
  const client = await startClient(t), registered = await client.register("Synthetic identity safety"), organization_id = registered.organization.id;
  const actor = { id: registered.user.id, role: "OWNER" }, context = new BusinessContextService(client.db), identity = new ImportIdentityService(client.db);
  const createTarget = () => client.services.leadsRepository.createLead({ organization_id, name: "Synthetic customer", email: "shared@example.test", company: "Example" });
  let target = late ? null : await createTarget();
  const preview = await client.services.importsService.previewCsv({ organization_id, actor, filename: "identity-safety.csv",
    csv_text: "Name,Email,Company,Interest,Budget,Currency\nSynthetic customer,shared@example.test,Example,A dining table,9007199254740993.01,INR", default_phone_region: "INTERNATIONAL_ONLY",
    mapping: { name: 0, email: 1, company: 2, interest: 3, budget_amount: 4, currency: 5 }, options: { date_format: "ISO", default_currency: null, assertion } });
  if (late) {
    target = await createTarget();
    await client.services.importsService.commitImport({ organization_id, actor, import_id: preview.import_id, expected_revision: preview.review_revision, selected_row_ids: [preview.rows[0].id] });
  }
  const scope = { organization_id, actor, import_id: preview.import_id, import_row_id: preview.rows[0].id };
  return { client, actor, organization_id, context, identity, preview, target, scope };
}
async function resolve(f, decision = "LINK_EXISTING") {
  const review = await f.identity.review(f.scope);
  assert.equal(review.can_resolve, true);
  return f.identity.resolve({ ...f.scope, review_token: review.review_token, decision,
    classification: decision === "LINK_EXISTING" ? "SAME_ENQUIRY" : "SHARED_CONTACT", target_lead_id: decision === "LINK_EXISTING" ? f.target.id : null, reason: "Reviewed source and contact identity" });
}
const current = (f, lead = f.target) => f.context.getEnquiry({ organization_id: f.organization_id, lead_id: lead.id });
const save = (f, enquiry, revision = 0, lead = f.target) => f.context.updateEnquiry({ organization_id: f.organization_id, lead_id: lead.id, actor: f.actor, expected_revision: revision, reason: "Explicitly reviewed enquiry correction", enquiry });
async function dispatchRevision(f, action) {
  return f.client.services.contactPolicyService.withWorkspacePolicyTransaction(f.organization_id, async tx => {
    const service = new PreparedActionService(tx), currentAction = await tx.get("SELECT * FROM actions WHERE id=?", [action.id]);
    return service.validateForDispatch({ action: currentAction, ...await service.inputs(currentAction) });
  });
}

test("link attaches source without changing existing enquiry, original lead, intelligence or exact approved envelope", async t => {
  const f = await fixture(t), original = emptyEnquiry();
  original.interest = { state: "KNOWN", value: "A chair", provenance: manual };
  const beforeContext = await save(f, original);
  const analysis = await f.client.post("/api/intelligence/bulk-run", { organization_id: f.organization_id, lead_ids: [f.target.id] });
  assert.equal(analysis.failed, 0);
  const action = await f.client.services.actionsRepository.createAction({ organization_id: f.organization_id, lead_id: f.target.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", idempotency_key: "identity-source-review", payload: { subject: "A question", body: "Would this be useful?" } });
  const reviewInput = { organization_id: f.organization_id, action_id: action.id, reviewer_user_id: f.actor.id };
  const preview = await f.client.services.approvalsService.currentForAction(reviewInput);
  await f.client.services.approvalsService.approveAction({ ...reviewInput, expected_revision_id: preview.prepared_revision.id });
  const beforeDispatch = await dispatchRevision(f, action), beforeLead = await f.client.services.leadsRepository.getLead(f.target.id);
  const beforeIntelligence = await f.client.get("/api/leads/" + f.target.id + "/intelligence?organization_id=" + f.organization_id);
  const result = await resolve(f);
  assert.equal(result.resolution.lead_id, f.target.id); assert.equal(result.resolution.event_id, null);
  assert.deepEqual(await current(f), beforeContext);
  assert.deepEqual(await f.client.services.leadsRepository.getLead(f.target.id), beforeLead);
  assert.deepEqual(await dispatchRevision(f, action), beforeDispatch);
  const afterIntelligence = await f.client.get("/api/leads/" + f.target.id + "/intelligence?organization_id=" + f.organization_id);
  assert.ok(Date.parse(afterIntelligence.currentness.assessed_at) >= Date.parse(beforeIntelligence.currentness.assessed_at));
  assert.ok(Date.parse(afterIntelligence.freshness.evaluated_at) >= Date.parse(beforeIntelligence.freshness.evaluated_at));
  // Rechecking time is allowed; no source, assessment authority, recommendation
  // or exact prepared envelope may change merely because a source was linked.
  const authorityView = value => ({ ...value,
    currentness: { ...value.currentness, assessed_at: null },
    freshness: { ...value.freshness, evaluated_at: null }
  });
  assert.deepEqual(authorityView(afterIntelligence), authorityView(beforeIntelligence));
  const sources = await f.identity.listSources({ organization_id: f.organization_id, lead_id: f.target.id });
  assert.equal(sources.sources[0].normalized_values.enquiry.interest.value, "A dining table");
  const explicitCorrection = structuredClone(beforeContext.enquiry);
  explicitCorrection.interest = sources.sources[0].normalized_values.enquiry.interest;
  await save(f, explicitCorrection, 1);
  await assert.rejects(dispatchRevision(f, action), { code: "APPROVAL_REVISION_STALE" });
  assert.equal((await f.client.db.get("SELECT count(*) n FROM action_executions")).n, 0);
});

for (const decision of ["LINK_EXISTING", "CREATE_SEPARATE"]) test(decision + " source permits exact preserved facts and rejects unassociated, changed and foreign citations", async t => {
  const f = await fixture(t), source = f.preview.rows[0].normalized_values.enquiry;
  await assert.rejects(save(f, source), { code: "INVALID_IMPORT_PROVENANCE" });
  const result = await resolve(f, decision), lead = await f.client.services.leadsRepository.getLead(result.resolution.lead_id);
  const base = await current(f, lead), revised = structuredClone(source);
  revised.timeline = { state: "KNOWN", value: { description: "Operator will clarify timing", target_date: null }, provenance: manual };
  const saved = await save(f, revised, base.revision, lead);
  assert.equal(saved.enquiry.budget.value.minimum_minor, "900719925474099301");
  const originalRow = await f.client.db.get("SELECT * FROM import_rows WHERE id=?", [f.scope.import_row_id]);
  assert.equal(originalRow.committed, 0); assert.equal(originalRow.created_lead_id, null);
  const beforeHistory = await f.context.enquiryHistory({ organization_id: f.organization_id, lead_id: lead.id });
  for (const mutate of [
    value => { value.interest.value = "Forged value"; },
    value => { value.interest.provenance.assertion = "CUSTOMER_STATED"; },
    value => { value.interest.provenance.observed_at = "2026-09-12T00:00:00.000Z"; },
    value => { value.interest.provenance.import_id = "other-import"; },
    value => { value.interest.provenance.import_row_id = "other-row"; value.interest.provenance.source_reference = "import_row:other-row"; }
  ]) { const changed = structuredClone(saved.enquiry); mutate(changed); await assert.rejects(save(f, changed, saved.revision, lead), { code: "INVALID_IMPORT_PROVENANCE" }); }
  const other = await f.client.services.leadsRepository.createLead({ organization_id: f.organization_id, name: "Other enquiry", email: "other@example.test" });
  await assert.rejects(save(f, source, 0, other), { code: "INVALID_IMPORT_PROVENANCE" });
  assert.deepEqual(await f.context.enquiryHistory({ organization_id: f.organization_id, lead_id: lead.id }), beforeHistory);
  const conflict = structuredClone(saved.enquiry);
  const importedAlternative = { value: source.interest.value, provenance: source.interest.provenance };
  conflict.interest = { state: "CONFLICTED", alternatives: [importedAlternative, { value: "A chair", provenance: manual }] };
  const conflicted = await save(f, conflict, saved.revision, lead);
  assert.deepEqual(conflicted.enquiry.interest.alternatives[0], importedAlternative);
});

test("resolved late-held source preserves original HELD ledger and restrictions while supporting exact enquiry history", async t => {
  const f = await fixture(t, { late: true });
  await f.client.services.contactPolicyService.restrictLead({ organization_id: f.organization_id, lead_id: f.target.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "identity-suppression" });
  const beforeOutcome = await f.client.db.get("SELECT * FROM import_row_outcomes WHERE import_row_id=?", [f.scope.import_row_id]);
  const beforeRestrictions = await f.client.db.all("SELECT * FROM contact_restrictions ORDER BY id");
  const result = await resolve(f, "CREATE_SEPARATE"), lead = await f.client.services.leadsRepository.getLead(result.resolution.lead_id);
  assert.equal((await f.client.services.contactPolicyService.inspectLead({ organization_id: f.organization_id, lead_id: lead.id, channel: "EMAIL" })).restricted, true);
  assert.deepEqual(await f.client.db.get("SELECT * FROM import_row_outcomes WHERE import_row_id=?", [f.scope.import_row_id]), beforeOutcome);
  assert.equal(beforeOutcome.state, "HELD");
  assert.deepEqual(await f.client.db.all("SELECT * FROM contact_restrictions ORDER BY id"), beforeRestrictions);
  const saved = await current(f, lead), changed = structuredClone(saved.enquiry);
  changed.timeline = { state: "KNOWN", value: { description: "No contact while opted out", target_date: null }, provenance: manual };
  await save(f, changed, saved.revision, lead);
  assert.equal((await f.client.db.get("SELECT count(*) n FROM actions WHERE lead_id=?", [lead.id])).n, 0);
  assert.equal((await f.client.db.get("SELECT count(*) n FROM action_executions")).n, 0);
});

test("inferred separate enquiry keeps its real import source and completes analysis without asserted buying need", async t => {
  const f = await fixture(t, { assertion: "INFERRED" }), result = await resolve(f, "CREATE_SEPARATE");
  const lead = await f.client.services.leadsRepository.getLead(result.resolution.lead_id), saved = await current(f, lead);
  assert.equal(saved.enquiry.interest.provenance.assertion, "INFERRED");
  assert.equal(saved.enquiry.interest.provenance.import_row_id, f.scope.import_row_id);
  const analyzed = await f.client.post("/api/intelligence/bulk-run", { organization_id: f.organization_id, lead_ids: [lead.id] });
  assert.equal(analyzed.failed, 0);
  const state = await f.client.get("/api/leads/" + lead.id + "/intelligence?organization_id=" + f.organization_id);
  assert.equal(state.recommendation_status, "READY"); assert.equal(state.next_best_action_status, "PLANNED");
  assert.equal(state.intelligence.evidence.some(item => item.claim_field?.startsWith("ENQUIRY_")), false);
  assert.equal((await f.client.db.get("SELECT count(*) n FROM action_executions")).n, 0);
});
