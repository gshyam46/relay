import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

const options = { date_format: "DMY", default_currency: "INR", assertion: "OPERATOR_OBSERVED" };
const mapping = { name: 0, email: 1, phone: 2, interest: 3, budget_amount: 4, enquiry_date: 5 };
const csv = "Customer,Email,Mobile,Interested in,Budget,Date\nAsha,asha@example.test,9876543210,Office desks,9007199254740993.01,12/09/2026\nBad phone,bad@example.test,CALL 9876543211,Chair,10,12/09/2026";
const input = (csv_text = csv, extra = {}) => ({ filename: "reviewed-enquiries.csv", csv_text, default_phone_region: "IN", mapping, options, ...extra });
const raw = (client, method, route, body) => client.rawFetch(route, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const commit = (client, batch, ids = batch.rows.filter(r => r.can_commit).map(r => r.id)) => client.post("/api/imports/" + batch.import_id + "/commit", { expected_revision: batch.review_revision, selected_row_ids: ids });
async function setup(t) {
  const client = await startClient(t);
  const account = await client.register("Reviewed import integration");
  return { client, ...account };
}

test("reviewed HTTP inspection and preview preserve source without creating leads, then commit exact typed context", async t => {
  const { client, user } = await setup(t);
  const inspected = await client.post("/api/imports/csv/inspect", { filename: "reviewed-enquiries.csv", csv_text: csv });
  assert.equal(inspected.headers[0].index, 0);
  assert.equal(inspected.headers[0].label, "Customer");
  assert.equal(inspected.row_count, 2);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM import_batches")).n, 0);
  const preview = await client.post("/api/imports/csv/preview", input());
  assert.equal(preview.contract_version, 2);
  assert.equal(preview.rows.filter(row => row.can_commit).length, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM domain_events")).n, 0);
  assert.equal(preview.rows[0].raw_cells[4], "9007199254740993.01");
  const complete = await commit(client, preview);
  assert.equal(complete.state, "COMMITTED");
  assert.equal(complete.progress.committed_rows, 1);
  const lead = await client.db.get("SELECT * FROM leads WHERE email = ?", ["asha@example.test"]);
  assert.equal(lead.normalized_phone, "+919876543210");
  const context = await client.get("/api/leads/" + lead.id + "/enquiry-context");
  assert.equal(context.created_by, user.id);
  assert.equal(context.enquiry.budget.value.minimum_minor, "900719925474099301");
  assert.equal(context.enquiry.budget.provenance.source_type, "IMPORT_ROW");
  assert.equal(context.enquiry.budget.provenance.import_row_id, preview.rows[0].id);
  assert.equal(context.enquiry.budget.provenance.assertion, "OPERATOR_OBSERVED");
  assert.equal(context.enquiry.budget.provenance.observed_at, null);
  assert.equal(context.enquiry.enquiry_date.value, "2026-09-12");
  assert.equal(context.enquiry.last_interaction.state, "UNKNOWN");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM domain_events WHERE type = 'LeadCreated'")).n, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
  const replay = await commit(client, preview);
  assert.equal(replay.progress.committed_rows, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 1);
});

test("row correction preserves raw cells and rejects stale review, invalid selection and forged commands", async t => {
  const { client } = await setup(t);
  const preview = await client.post("/api/imports/csv/preview", input());
  const invalid = preview.rows.find(row => !row.can_commit);
  const commitPath = "/api/imports/" + preview.import_id + "/commit";
  assert.equal((await raw(client, "POST", commitPath, { expected_revision: preview.review_revision, selected_row_ids: [invalid.id] })).status, 400);
  const correctionPath = "/api/imports/" + preview.import_id + "/rows/" + invalid.id;
  const corrected = await client.put(correctionPath, { expected_revision: preview.review_revision, values: { ...invalid.mapped_values, phone: "9876543211" }, reason: "Operator checked the original telephone note" });
  assert.equal(corrected.review_revision, preview.review_revision + 1);
  const correctedRow = corrected.rows.find(row => row.id === invalid.id);
  assert.equal(correctedRow.raw_cells[2], "CALL 9876543211");
  assert.equal(correctedRow.can_commit, true);
  assert.equal((await raw(client, "POST", commitPath, { expected_revision: preview.review_revision, selected_row_ids: [invalid.id] })).status, 409);
  assert.equal((await raw(client, "PUT", correctionPath, { expected_revision: corrected.review_revision, values: correctedRow.mapped_values, reason: "Forged actor", actor: { id: "fake", role: "OWNER" } })).status, 400);
  const complete = await commit(client, corrected, [invalid.id]);
  assert.equal(complete.progress.committed_rows, 1);
  assert.equal((await raw(client, "PUT", correctionPath, { expected_revision: corrected.review_revision, values: correctedRow.mapped_values, reason: "Frozen change" })).status, 409);
  const history = await client.get("/api/imports/" + preview.import_id);
  assert.equal(history.review_revision, corrected.review_revision);
  assert.equal(history.rows.find(row => row.id === invalid.id).raw_cells[2], "CALL 9876543211");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 1);
});

test("reviewed selection resumes bounded chunks after reload and refuses different retry intent", async t => {
  const { client } = await setup(t);
  const data = ["Name,Email", ...Array.from({ length: 26 }, (_, n) => "Synthetic " + n + ",chunk" + n + "@example.test")].join("\n");
  const preview = await client.post("/api/imports/csv/preview", input(data, { mapping: { name: 0, email: 1 } }));
  const ids = preview.rows.map(row => row.id);
  const first = await commit(client, preview, ids);
  assert.equal(first.state, "COMMITTING");
  assert.equal(first.progress.committed_rows, 25);
  assert.equal(first.progress.remaining_rows, 1);
  const reloaded = await client.get("/api/imports/" + preview.import_id);
  assert.deepEqual([...reloaded.frozen_selection].sort(), [...ids].sort());
  const changed = await raw(client, "POST", "/api/imports/" + preview.import_id + "/commit", { expected_revision: preview.review_revision, selected_row_ids: ids.slice(1) });
  assert.equal(changed.status, 409);
  const complete = await commit(client, reloaded, reloaded.frozen_selection);
  assert.equal(complete.state, "COMMITTED");
  assert.equal(complete.progress.committed_rows, 26);
  assert.equal(complete.progress.remaining_rows, 0);
  await commit(client, reloaded, reloaded.frozen_selection);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 26);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM domain_events WHERE type = 'LeadCreated'")).n, 26);
});

test("duplicate appearing after reviewed preview is held with source intact and no extra lead or event", async t => {
  const { client } = await setup(t);
  const preview = await client.post("/api/imports/csv/preview", input("Customer,Email,Mobile,Interested in,Budget,Date\nAsha,asha@example.test,,Office desks,0,12/09/2026"));
  assert.equal(preview.rows[0].can_commit, true);
  await client.post("/api/leads", { name: "Existing contact", email: "asha@example.test" });
  const complete = await commit(client, preview);
  assert.equal(complete.state, "COMMITTED");
  assert.equal(complete.progress.committed_rows, 0);
  assert.equal(complete.progress.held_rows, 1);
  assert.equal(complete.rows[0].commit_state, "HELD");
  assert.ok(complete.rows[0].hold_reason);
  assert.equal(complete.rows[0].raw_cells[3], "Office desks");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM lead_enquiry_revisions")).n, 0);
});

test("import HTTP enforces current owner, tenant boundaries and unambiguous parser failures", async t => {
  const { client, user } = await setup(t);
  const preview = await client.post("/api/imports/csv/preview", input());
  const before = await client.db.get("SELECT COUNT(*) AS n FROM import_batches");
  const malformed = await raw(client, "POST", "/api/imports/csv/preview", input('Customer,Email\n"Unclosed,broken@example.test'));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await client.db.get("SELECT COUNT(*) AS n FROM import_batches"), before);
  assert.equal((await raw(client, "POST", "/api/imports/csv/inspect", { filename: "x.csv", csv_text: csv, actor: "spoof" })).status, 400);
  await client.db.run("UPDATE users SET role = 'MEMBER' WHERE id = ?", [user.id]);
  assert.equal((await client.get("/api/imports/" + preview.import_id)).import_id, preview.import_id);
  assert.equal((await raw(client, "POST", "/api/imports/csv/preview", input())).status, 403);
  assert.equal((await raw(client, "POST", "/api/imports/" + preview.import_id + "/commit", { expected_revision: preview.review_revision, selected_row_ids: [preview.rows[0].id] })).status, 403);
  await client.register("Other import workspace");
  assert.equal((await client.rawFetch("/api/imports/" + preview.import_id)).status, 404);
  assert.equal((await raw(client, "PUT", "/api/imports/" + preview.import_id + "/rows/" + preview.rows[0].id, { expected_revision: preview.review_revision, values: preview.rows[0].mapped_values, reason: "Foreign attempt" })).status, 404);
  assert.equal((await raw(client, "POST", "/api/imports/" + preview.import_id + "/commit", { expected_revision: preview.review_revision, selected_row_ids: [preview.rows[0].id] })).status, 404);
});
