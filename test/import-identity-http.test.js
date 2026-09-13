import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

const options = { date_format: "ISO", default_currency: null, assertion: "OPERATOR_OBSERVED" };
const payload = (filename, csv_text) => ({ filename, csv_text, default_phone_region: "INTERNATIONAL_ONLY", mapping: { name: 0, email: 1, phone: 2, interest: 3 }, options });
const rows = (values) => "Name,Email,Phone,Interest\n" + values.map(row => row.join(",")).join("\n");
const prefix = (batch, row = batch.rows[0]) => "/api/imports/" + batch.import_id + "/rows/" + row.id;
const raw = (client, method, route, body) => client.rawFetch(route, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const link = (review, id, reason = "Owner compared the source and confirmed the same enquiry") => ({ review_token: review.review_token, decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: id, reason });
const separate = (review, classification = "REPEATED_ENQUIRY") => ({ review_token: review.review_token, decision: "CREATE_SEPARATE", classification, target_lead_id: null, reason: "Owner reviewed a separate need and retained its original source" });
async function setup(t) { const client = await startClient(t); const account = await client.register("Identity HTTP"); return { client, ...account }; }
async function preview(client, filename, values) { return client.post("/api/imports/csv/preview", payload(filename, rows(values))); }
async function normal(client, filename, values) {
  const batch = await preview(client, filename, values);
  return client.post("/api/imports/" + batch.import_id + "/commit", { expected_revision: batch.review_revision, selected_row_ids: batch.rows.map(row => row.id) });
}
const count = async (client, table) => Number((await client.db.get("SELECT COUNT(*) AS n FROM " + table)).n);

test("HTTP same-enquiry resolution attaches source once without changing current facts or existing lead history", async t => {
  const { client, user } = await setup(t);
  const original = await normal(client, "first.csv", [["Asha", "asha@example.test", "", "Desk"]]);
  const leadId = original.rows[0].created_lead_id;
  const before = await client.get("/api/leads/" + leadId + "/enquiry-context");
  const leadBefore = await client.db.get("SELECT * FROM leads WHERE id=?", [leadId]);
  const second = await preview(client, "repeat.csv", [["Asha source correction", "ASHA@example.test", "", "Chair"]]);
  const route = prefix(second);
  const review = await client.get(route + "/identity-review");
  assert.equal(review.can_resolve, true);
  assert.equal(review.existing_total, 1);
  assert.equal(review.existing_candidates[0].can_link, true);
  const command = link(review, leadId);
  const result = await client.post(route + "/identity-resolution", command);
  assert.equal(result.resolution.lead_id, leadId);
  assert.equal(result.resolution.created_by, user.id);
  assert.equal(result.resolution.decision, "LINK_EXISTING");
  assert.equal(result.import.resolution_summary.linked_rows, 1);
  assert.equal(result.import.rows[0].can_commit, false);
  assert.equal(result.import.rows[0].identity_resolution.id, result.resolution.id);
  assert.deepEqual(await client.get("/api/leads/" + leadId + "/enquiry-context"), before);
  assert.deepEqual(await client.db.get("SELECT * FROM leads WHERE id=?", [leadId]), leadBefore);
  assert.equal(await count(client, "leads"), 1);
  assert.equal(await count(client, "domain_events"), 1);
  assert.equal(await count(client, "action_executions"), 0);
  const retried = await client.post(route + "/identity-resolution", command);
  assert.equal(retried.resolution.id, result.resolution.id);
  assert.equal(await count(client, "import_identity_resolutions"), 1);
  assert.equal((await raw(client, "POST", route + "/identity-resolution", { ...command, reason: "Different owner intent" })).status, 409);
  assert.equal((await raw(client, "PUT", route, { expected_revision: second.review_revision, values: second.rows[0].mapped_values, reason: "Alter resolved source" })).status, 409);
  const sources = await client.get("/api/leads/" + leadId + "/import-sources");
  assert.equal(sources.sources.length, 2);
  assert.ok(sources.sources.some(source => source.import_id === original.import_id));
  const attached = sources.sources.find(source => source.import_id === second.import_id);
  assert.equal(attached.normalized_values.enquiry.interest.value, "Chair");
  assert.deepEqual(attached.raw_cells, second.rows[0].raw_cells);
});

test("HTTP in-file duplicate group can create its first enquiry then link another row without replaying normal import", async t => {
  const { client } = await setup(t);
  const batch = await preview(client, "group.csv", [["Shared", "shared@example.test", "", "Desk"], ["Shared", "shared@example.test", "", "Desk"]]);
  assert.equal(batch.rows.filter(row => row.can_commit).length, 0);
  const review = await client.get(prefix(batch) + "/identity-review");
  assert.equal(review.existing_total, 0);
  assert.equal(review.row_total, 1);
  const first = await client.post(prefix(batch) + "/identity-resolution", separate(review, "DISTINCT_ENQUIRY"));
  const secondPath = prefix(batch, batch.rows[1]);
  const secondReview = await client.get(secondPath + "/identity-review");
  assert.equal(secondReview.existing_total, 1);
  const second = await client.post(secondPath + "/identity-resolution", link(secondReview, first.resolution.lead_id));
  assert.equal(second.import.resolution_summary.created_rows, 1);
  assert.equal(second.import.resolution_summary.linked_rows, 1);
  assert.equal(second.import.resolution_summary.unresolved_duplicate_rows, 0);
  assert.equal(await count(client, "leads"), 1);
  assert.equal(await count(client, "domain_events"), 1);
  const committed = await raw(client, "POST", "/api/imports/" + batch.import_id + "/commit", { expected_revision: batch.review_revision, selected_row_ids: batch.rows.map(row => row.id) });
  assert.equal(committed.status, 400);
  const context = await client.get("/api/leads/" + first.resolution.lead_id + "/enquiry-context");
  assert.equal(context.enquiry.interest.provenance.import_row_id, batch.rows[0].id);
});

test("HTTP late HELD source resolves without rewriting its frozen import outcome", async t => {
  const { client } = await setup(t);
  const batch = await preview(client, "late.csv", [["Late", "late@example.test", "", "New project"]]);
  const existing = await client.post("/api/leads", { name: "Earlier contact", email: "late@example.test" });
  const held = await client.post("/api/imports/" + batch.import_id + "/commit", { expected_revision: batch.review_revision, selected_row_ids: [batch.rows[0].id] });
  assert.equal(held.rows[0].commit_state, "HELD");
  const ledger = await client.db.get("SELECT * FROM import_row_outcomes WHERE import_row_id=?", [batch.rows[0].id]);
  const review = await client.get(prefix(batch) + "/identity-review");
  const result = await client.post(prefix(batch) + "/identity-resolution", separate(review));
  assert.notEqual(result.resolution.lead_id, existing.lead.id);
  assert.equal(result.import.state, "COMMITTED");
  assert.equal(result.import.progress.held_rows, 1);
  assert.equal(result.import.resolution_summary.resolved_held_rows, 1);
  assert.deepEqual(result.import.frozen_selection, held.frozen_selection);
  assert.deepEqual(await client.db.get("SELECT * FROM import_row_outcomes WHERE import_row_id=?", [batch.rows[0].id]), ledger);
  const replay = await client.post("/api/imports/" + batch.import_id + "/commit", { expected_revision: batch.review_revision, selected_row_ids: [batch.rows[0].id] });
  assert.equal(replay.resolution_summary.created_rows, 1);
  assert.equal(await count(client, "leads"), 2);
});

test("HTTP resolution review rejects stale candidate and restriction state and preserves opt-out on a separate enquiry", async t => {
  const { client } = await setup(t);
  const { lead } = await client.post("/api/leads", { name: "Existing", email: "restricted@example.test" });
  const batch = await preview(client, "restricted.csv", [["Another need", "restricted@example.test", "", "Shelving"]]);
  const route = prefix(batch);
  const firstReview = await client.get(route + "/identity-review");
  await client.post("/api/leads", { name: "Another shared enquiry", email: "restricted@example.test" });
  assert.equal((await raw(client, "POST", route + "/identity-resolution", separate(firstReview))).status, 409);
  const beforeRestriction = await client.get(route + "/identity-review");
  await client.post("/api/leads/" + lead.id + "/contact-restrictions", { reason: "OPT_OUT", channel: "ALL", idempotency_key: "owner-contact-optout" });
  assert.equal((await raw(client, "POST", route + "/identity-resolution", separate(beforeRestriction))).status, 409);
  const finalReview = await client.get(route + "/identity-review");
  assert.ok(finalReview.existing_candidates.every(candidate => candidate.contact_policy.restricted));
  const result = await client.post(route + "/identity-resolution", separate(finalReview, "SHARED_CONTACT"));
  const policy = await client.get("/api/leads/" + result.resolution.lead_id + "/contact-policy?channel=EMAIL");
  assert.equal(policy.restricted, true);
  assert.equal(await count(client, "action_executions"), 0);
  assert.equal(await count(client, "import_identity_resolutions"), 1);
});

test("HTTP identity paths require owner/session/workspace and exact supported commands", async t => {
  const { client, organization, user } = await setup(t);
  const { lead } = await client.post("/api/leads", { name: "Existing", email: "scope@example.test", phone: "+919876543210" });
  const batch = await preview(client, "scope.csv", [["Source", "scope@example.test", "", "Desk"]]);
  const route = prefix(batch);
  const review = await client.get(route + "/identity-review");
  assert.equal(review.existing_candidates[0].can_link, false);
  assert.equal((await raw(client, "POST", route + "/identity-resolution", link(review, lead.id))).status, 409);
  const command = separate(review, "SHARED_CONTACT");
  for (const extra of [{ actor: { id: user.id, role: "OWNER" } }, { approval: true }, { expected_revision: 1 }]) {
    assert.equal((await raw(client, "POST", route + "/identity-resolution", { ...command, ...extra })).status, 400);
  }
  assert.equal((await fetch(client.baseUrl + route + "/identity-review")).status, 401);
  assert.equal((await fetch(client.baseUrl + "/api/leads/" + lead.id + "/import-sources")).status, 401);
  await client.db.run("UPDATE users SET role='MEMBER' WHERE id=?", [user.id]);
  assert.equal((await raw(client, "GET", route + "/identity-review")).status, 403);
  assert.equal((await raw(client, "POST", route + "/identity-resolution", command)).status, 403);
  await client.db.run("UPDATE users SET role='OWNER' WHERE id=?", [user.id]);
  const foreign = await client.register("Foreign identity HTTP");
  assert.equal((await raw(client, "GET", route + "/identity-review?organization_id=" + organization.id)).status, 404);
  assert.equal((await raw(client, "POST", route + "/identity-resolution", { ...command, organization_id: organization.id })).status, 404);
  assert.equal((await raw(client, "GET", "/api/leads/" + lead.id + "/import-sources?organization_id=" + organization.id)).status, 404);
  assert.equal(await count(client, "import_identity_resolutions"), 0);
  assert.notEqual(foreign.organization.id, organization.id);
});
