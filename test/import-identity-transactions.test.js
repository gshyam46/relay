import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { ImportsRepository } from "../src/modules/data-foundation/importsRepository.js";
import { ImportsService } from "../src/modules/data-foundation/importsService.js";
import { ImportIdentityService } from "../src/modules/data-foundation/importIdentityService.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";

const actor = { id: "owner", role: "OWNER" }, stamp = "2026-09-12T10:00:00.000Z";
const previewInput = (csv = "One,same@example.test,Table,9007199254740993.01", extra = {}) => ({ organization_id: "org", actor, filename: "synthetic-identities.csv", csv_text: "Name,Email,Interest,Budget\n" + csv, mapping: { name: 0, email: 1, interest: 2, budget_amount: 3 }, options: { date_format: "ISO", default_currency: "INR", assertion: "OPERATOR_OBSERVED" }, default_phone_region: "INTERNATIONAL_ONLY", ...extra });
async function seed(db) {
  await runMigrations(db);
  for (const [org, owner] of [["org", "owner"], ["other", "other-owner"]]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic", stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, org, "Synthetic", owner + "@example.test", stamp]);
  }
}
function services(db) { return { imports: new ImportsService({ importsRepository: new ImportsRepository(db) }), identity: new ImportIdentityService(db) }; }
async function setup(t, options = {}) {
  const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); await seed(db);
  const target = options.noTarget ? null : await new LeadsRepository(db).createLead({ organization_id: "org", name: "Existing customer", email: "same@example.test" });
  return { db, target, ...services(db) };
}
const reviewInput = (batch, index = 0) => ({ organization_id: "org", import_id: batch.import_id, import_row_id: batch.rows[index].id, actor });
const decision = (batch, review, extra = {}) => ({ ...reviewInput(batch), review_token: review.review_token, decision: "CREATE_SEPARATE", classification: "REPEATED_ENQUIRY", target_lead_id: null, reason: "Owner confirmed a distinct enquiry from this source", ...extra });
const total = async (db, table) => Number((await db.get("SELECT count(*) n FROM " + table)).n);

for (const [table, condition] of [["leads", ""], ["lead_enquiry_revisions", ""], ["domain_events", ""], ["import_identity_resolutions", ""], ["audit_logs", "WHEN NEW.event_type='ImportIdentityResolved'"]]) test("identity CREATE rolls back all effects when " + table + " fails", async t => {
  const { db, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  const before = await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]);
  await db.exec("CREATE TRIGGER fail_identity BEFORE INSERT ON " + table + " " + condition + " BEGIN SELECT RAISE(ABORT,'synthetic secret write failure'); END");
  await assert.rejects(identity.resolve(decision(batch, review)), { code: "IDENTITY_WRITE_FAILED", statusCode: 500 });
  assert.equal(await total(db, "leads"), 1);
  for (const name of ["lead_enquiry_revisions", "domain_events", "import_identity_resolutions", "import_row_outcomes"]) assert.equal(await total(db, name), 0, name);
  assert.deepEqual(await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]), before);
  assert.equal((await identity.review(reviewInput(batch))).review_token, review.review_token);
  await db.exec("DROP TRIGGER fail_identity");
  const saved = await identity.resolve(decision(batch, review));
  assert.equal(JSON.parse((await db.get("SELECT review_snapshot_json FROM import_identity_resolutions WHERE id=?", [saved.resolution.id])).review_snapshot_json).normalized_values.enquiry.budget.value.minimum_minor, "900719925474099301");
  assert.equal(await total(db, "leads"), 2); assert.equal(await total(db, "domain_events"), 1);
});

test("concurrent identical and conflicting decisions preserve one row association, lead and event", async t => {
  const { db, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch)), command = decision(batch, review);
  const results = await Promise.all([identity.resolve(command), identity.resolve(command)]);
  assert.equal(results[0].resolution.id, results[1].resolution.id);
  assert.equal(await total(db, "leads"), 2); assert.equal(await total(db, "domain_events"), 1); assert.equal(await total(db, "import_identity_resolutions"), 1);
  await assert.rejects(identity.resolve({ ...command, reason: "Changed owner intent" }), { code: "IDENTITY_DECISION_CONFLICT" });
  await db.run("UPDATE leads SET status='OPTED_OUT' WHERE id=?", [results[0].resolution.lead_id]);
  assert.equal((await identity.resolve(command)).resolution.id, results[0].resolution.id);
});

test("LINK audit failure rolls source association back without touching target facts", async t => {
  const { db, target, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  const command = decision(batch, review, { decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: target.id });
  const before = await db.get("SELECT * FROM leads WHERE id=?", [target.id]);
  await db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON audit_logs WHEN NEW.event_type='ImportIdentityResolved' BEGIN SELECT RAISE(ABORT,'synthetic link audit failure'); END");
  await assert.rejects(identity.resolve(command), { code: "IDENTITY_WRITE_FAILED" });
  assert.equal(await total(db, "import_identity_resolutions"), 0); assert.deepEqual(await db.get("SELECT * FROM leads WHERE id=?", [target.id]), before);
  await db.exec("DROP TRIGGER fail_link"); await identity.resolve(command);
  assert.equal(await total(db, "domain_events"), 0); assert.equal(await total(db, "lead_enquiry_revisions"), 0);
});

test("correction versus identity decision has one winner and resolved source stays immutable", async t => {
  const { db, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  const correction = { ...reviewInput(batch), expected_revision: 1, values: { ...batch.rows[0].mapped_values, email: "different@example.test" }, reason: "Checked separate contact" };
  const raced = await Promise.allSettled([identity.resolve(decision(batch, review)), imports.correctRow(correction)]);
  assert.equal(raced.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(raced.find(item => item.status === "rejected").reason.statusCode, 409);
  const current = await imports.getImport(batch.import_id, "org");
  if (current.rows[0].identity_resolution) {
    await assert.rejects(imports.correctRow(correction), { code: "IDENTITY_ROW_RESOLVED" });
    await assert.rejects(imports.commitImport({ organization_id: "org", import_id: batch.import_id, actor, expected_revision: current.review_revision, selected_row_ids: [batch.rows[0].id] }), { code: "IMPORT_INVALID_SELECTION" });
    assert.equal(await total(db, "import_row_outcomes"), 0);
  }
});

test("correcting another source preserves a resolved source's values and original duplicate history", async t => {
  const { db, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput("One,same@example.test,Table,1\nTwo,same@example.test,Chair,2"));
  const review = await identity.review(reviewInput(batch)); await identity.resolve(decision(batch, review));
  const rowBefore = await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]);
  const issuesBefore = await db.all("SELECT * FROM import_issues WHERE import_row_id=? ORDER BY id", [batch.rows[0].id]);
  await imports.correctRow({ ...reviewInput(batch, 1), expected_revision: 1, values: { ...batch.rows[1].mapped_values, email: "separate@example.test" }, reason: "Reviewed corrected source address" });
  assert.deepEqual(await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]), rowBefore);
  assert.deepEqual(await db.all("SELECT * FROM import_issues WHERE import_row_id=? ORDER BY id", [batch.rows[0].id]), issuesBefore);
  const current = await imports.getImport(batch.import_id, "org"), listed = await imports.listImports("org");
  assert.equal(current.rows[1].can_commit, true); assert.equal(current.rows[0].can_commit, false);
  assert.deepEqual(listed.imports[0].resolution_summary, current.resolution_summary);
});

test("matching records outside displayed first50 still invalidate the exact review", async t => {
  const { db, imports, identity } = await setup(t);
  for (let i = 0; i < 60; i++) await new LeadsRepository(db).createLead({ organization_id: "org", name: "Shared " + i, email: "same@example.test" });
  const batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  assert.equal(review.existing_total, 61); assert.equal(review.existing_candidates.length, 50); assert.equal(review.existing_truncated, true);
  const shown = new Set(review.existing_candidates.map(item => item.lead.id)), hidden = (await db.all("SELECT id FROM leads ORDER BY id")).find(lead => !shown.has(lead.id));
  await new ContactPolicyService(db).restrictLead({ organization_id: "org", lead_id: hidden.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "hidden-restriction", actor_id: "owner" });
  await assert.rejects(identity.resolve(decision(batch, review)), { code: "IDENTITY_REVIEW_STALE" });
  assert.equal(await total(db, "import_identity_resolutions"), 0);
});

test("1000 matching input rows have accurate bounds and explicit first creation enables later source link", async t => {
  const { db, imports, identity } = await setup(t, { noTarget: true });
  const batch = await imports.previewCsv(previewInput(Array.from({ length: 1000 }, (_, index) => "Person " + index + ",same@example.test,Table,1").join("\n")));
  const review = await identity.review(reviewInput(batch));
  assert.equal(review.row_total, 999); assert.equal(review.row_candidates.length, 20); assert.equal(review.row_truncated, true); assert.equal(review.can_resolve, true);
  const created = await identity.resolve(decision(batch, review)), nextReview = await identity.review(reviewInput(batch, 999));
  assert.equal(nextReview.existing_total, 1);
  await identity.resolve({ ...decision(batch, nextReview, { decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: created.resolution.lead_id }), import_row_id: batch.rows[999].id });
  assert.equal(await total(db, "leads"), 1); assert.equal(await total(db, "domain_events"), 1);
});

test("more than5000 existing matches disables review with accurate total and no incomplete token", async t => {
  const { db, imports, identity } = await setup(t, { noTarget: true });
  await db.transaction(async tx => { for (let i = 0; i < 5001; i++) await tx.run("INSERT INTO leads(id,organization_id,name,email,normalized_email,source,status,created_at,updated_at) VALUES (?,'org','Shared','same@example.test','same@example.test','SYNTHETIC','NEW',?,?)", ["cap-" + i, stamp, stamp]); });
  const batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  assert.equal(review.existing_total, 5001); assert.equal(review.existing_candidates.length, 50); assert.equal(review.can_resolve, false); assert.equal(review.review_token, null); assert.equal(review.unavailable_reason, "IDENTITY_CANDIDATE_LIMIT");
  assert.equal(await total(db, "import_identity_resolutions"), 0);
});

test("conflicting legacy raw and normalized contact blocks LINK and binds its restrictions", async t => {
  const { db, imports, identity, target } = await setup(t);
  await db.run("UPDATE leads SET email='different@example.test' WHERE id=?", [target.id]);
  const batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  assert.equal(review.existing_candidates[0].can_link, false); assert.equal(review.existing_candidates[0].link_block_reason, "LEGACY_CONTACT_CONFLICT");
  await assert.rejects(identity.resolve(decision(batch, review, { decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: target.id })), { code: "IDENTITY_LINK_NOT_ALLOWED" });
  await new ContactPolicyService(db).restrictContact({ organization_id: "org", contact: { kind: "EMAIL", value: "different@example.test" }, reason: "OPT_OUT", source: "MANUAL", source_event_id: "legacy-raw", actor_id: "owner" });
  await assert.rejects(identity.resolve(decision(batch, review)), { code: "IDENTITY_REVIEW_STALE" });
});

test("file-backed lost response survives restart and another connection replays one resolution", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-identity-owned-")), file = path.join(dir, "identity.sqlite");
  let first = new SqliteDatabaseClient(file), second;
  t.after(async () => { await first?.close(); await second?.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await seed(first); await new LeadsRepository(first).createLead({ organization_id: "org", name: "Existing", email: "same@example.test" });
  const initial = services(first), batch = await initial.imports.previewCsv(previewInput()), review = await initial.identity.review(reviewInput(batch)), command = decision(batch, review);
  const saved = await initial.identity.resolve(command); await first.close(); first = null;
  second = new SqliteDatabaseClient(file); const replay = await services(second).identity.resolve(command);
  assert.equal(replay.resolution.id, saved.resolution.id); assert.equal(await total(second, "leads"), 2); assert.equal(await total(second, "domain_events"), 1);
  assert.equal((await services(second).identity.listSources({ organization_id: "org", lead_id: saved.resolution.lead_id })).sources[0].import_row_id, batch.rows[0].id);
});

async function restrictionFixtures(db, count, kind = "EMAIL", value = "same@example.test", prefix = "scope") {
  await db.transaction(async tx => { for (let index = 0; index < count; index++) await tx.run("INSERT INTO contact_restrictions(id,organization_id,contact_kind,contact_value,channel,reason,source,source_event_id,effective_at,created_at) VALUES (?,'org',?,?,'ALL','OPT_OUT','MANUAL',?,?,?)", [prefix + index, kind, value, prefix + index, stamp, stamp]); });
}
test("policy scan counts shared restrictions once across candidate pages and binds hidden history", async t => {
  const { db, imports, identity } = await setup(t);
  for (let index = 0; index < 201; index++) await new LeadsRepository(db).createLead({ organization_id: "org", name: "Shared " + index, email: "same@example.test" });
  await restrictionFixtures(db, 200);
  const batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  assert.equal(review.can_resolve, true); assert.equal(review.row.contact_policy.restriction_count, 200); assert.equal(review.row.contact_policy.restriction_ids.length, 100); assert.equal(review.row.contact_policy.restrictions_truncated, true);
  assert.equal(review.existing_total, 202); assert.equal(review.existing_candidates[0].contact_policy.restricted, true);
  await db.run("UPDATE contact_restrictions SET effective_at='2026-09-13T10:00:00.000Z' WHERE id='scope199'");
  await assert.rejects(identity.resolve(decision(batch, review)), { code: "IDENTITY_REVIEW_STALE" });
});
test("policy scan disables decisions above10000 distinct relevant records without loading partial authority", async t => {
  const { db, imports, identity } = await setup(t);
  await restrictionFixtures(db, 10001);
  const batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  assert.equal(review.can_resolve, false); assert.equal(review.review_token, null); assert.equal(review.unavailable_reason, "IDENTITY_POLICY_LIMIT");
  assert.equal(review.row.contact_policy.restricted, true); assert.equal(review.row.contact_policy.restriction_count, 10001); assert.equal(review.row.contact_policy.policy_incomplete, true);
  assert.equal(await total(db, "import_identity_resolutions"), 0);
});
test("public resolutions remain compact while exact source snapshot stays durable", async t => {
  const { db, imports, identity } = await setup(t), batch = await imports.previewCsv(previewInput()), review = await identity.review(reviewInput(batch));
  const result = await identity.resolve(decision(batch, review));
  assert.equal(Object.hasOwn(result.resolution, "review_snapshot"), false); assert.equal(Object.hasOwn(result.import.rows[0].identity_resolution, "review_snapshot"), false);
  assert.ok(JSON.parse((await db.get("SELECT review_snapshot_json FROM import_identity_resolutions")).review_snapshot_json).normalized_values.enquiry.budget);
  const source = (await identity.listSources({ organization_id: "org", lead_id: result.resolution.lead_id })).sources[0];
  assert.equal(source.normalized_values.enquiry.budget.value.minimum_minor, "900719925474099301"); assert.equal(Object.hasOwn(source.resolution, "review_snapshot"), false);
});

test("source history materializes within8MiB across dense files and retains exact raw source", async t => {
  const { imports, identity, target } = await setup(t);
  const cells = ["Name", "Email", ...Array.from({ length: 62 }, (_, i) => "Raw" + i)], values = ["Shared", "same@example.test", ...Array.from({ length: 62 }, () => "x".repeat(4096))];
  const csv_text = cells.join(",") + "\n" + values.join(",");
  for (let index = 0; index < 18; index++) {
    const batch = await imports.previewCsv(previewInput("", { filename: "dense-source-" + index + ".csv", csv_text, mapping: { name: 0, email: 1 } }));
    const review = await identity.review(reviewInput(batch));
    await identity.resolve(decision(batch, review, { decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: target.id }));
  }
  const sources = await identity.listSources({ organization_id: "org", lead_id: target.id });
  assert.equal(sources.byte_limit, 8388608); assert.equal(sources.has_more, true); assert.ok(sources.sources.length > 0 && sources.sources.length < 18);
  assert.deepEqual(sources.sources[0].raw_cells, values); assert.ok(Buffer.byteLength(JSON.stringify(sources.sources), "utf8") <= sources.byte_limit + 100);
});

test("resolution-created same-batch lead remains a late duplicate after fallback name creates a new matching key", async t => {
  const { db, imports, identity } = await setup(t, { noTarget: true });
  await new LeadsRepository(db).createLead({ organization_id: "org", name: "Existing", company: "Different", email: "a@example.test" });
  const batch = await imports.previewCsv(previewInput("", { csv_text: "Name,Company,Email\n,Acme,a@example.test\nAcme,Acme,b@example.test", mapping: { name: 0, company: 1, email: 2 } }));
  assert.equal(batch.rows[0].can_commit, false); assert.equal(batch.rows[1].can_commit, true);
  const review = await identity.review(reviewInput(batch)); await identity.resolve(decision(batch, review));
  assert.ok((await identity.review(reviewInput(batch, 1))).existing_candidates.some(candidate => candidate.match_types.includes("POSSIBLE_NAME_COMPANY")));
  const committed = await imports.commitImport({ organization_id: "org", import_id: batch.import_id, actor, expected_revision: 1, selected_row_ids: [batch.rows[1].id] });
  assert.equal(committed.state, "COMMITTED"); assert.equal(committed.rows[1].commit_state, "HELD"); assert.equal(committed.rows[1].created_lead_id, null);
  assert.deepEqual(committed.progress, { selected_rows: 1, committed_rows: 0, held_rows: 1, remaining_rows: 0 });
  assert.equal(await total(db, "leads"), 2); assert.equal(await total(db, "domain_events"), 1);
  assert.equal((await db.get("SELECT state FROM import_row_outcomes WHERE import_row_id=?", [batch.rows[1].id])).state, "HELD");
});
