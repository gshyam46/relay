import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { ImportsRepository } from "../src/modules/data-foundation/importsRepository.js";
import { ImportsService } from "../src/modules/data-foundation/importsService.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";

const STAMP = "2026-09-12T10:00:00.000Z", actor = { id: "owner", role: "OWNER" };
const options = { date_format: "ISO", default_currency: "INR", assertion: "OPERATOR_OBSERVED" };
const mapping = { name: 0, email: 1, interest: 2, budget_amount: 3 };
const input = (count = 1, extra = {}) => ({ organization_id: "org", actor, filename: "synthetic-review.csv", csv_text: "Name,Email,Interest,Budget\n" + Array.from({ length: count }, (_, i) => "Synthetic " + i + ",person" + i + "@example.test,Table,9007199254740993.01").join("\n"), default_phone_region: "INTERNATIONAL_ONLY", mapping, options, ...extra });
const serviceFor = db => new ImportsService({ importsRepository: new ImportsRepository(db) });
async function seed(db) {
  await runMigrations(db);
  for (const [org, id] of [["org", "owner"], ["other", "other-owner"]]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic " + org, STAMP]);
    await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [id, org, "Synthetic", id + "@example.test", STAMP]);
  }
}
async function setup(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); await seed(db); return { db, service: serviceFor(db) }; }
const command = (batch, extra = {}) => ({ organization_id: "org", import_id: batch.import_id, actor, expected_revision: batch.review_revision, selected_row_ids: batch.rows.filter(row => row.can_commit).map(row => row.id), ...extra });
async function count(db, table, where = "") { return (await db.get("SELECT count(*) n FROM " + table + (where ? " WHERE " + where : ""))).n; }

for (const table of ["import_batches", "import_rows", "import_issues", "audit_logs"]) test("preview rolls all persisted source back when " + table + " write fails", async t => {
  const { db, service } = await setup(t);
  await db.exec("CREATE TRIGGER fail_preview BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'synthetic preview storage failure'); END");
  const invalid = input(1, { csv_text: "Name,Email,Interest,Budget\nSynthetic,invalid,Table,1" });
  await assert.rejects(service.previewCsv(invalid), /synthetic preview storage failure/);
  for (const table of ["import_batches", "import_rows", "import_issues", "audit_logs", "leads", "domain_events"]) assert.equal(await count(db, table), 0, table);
  await db.exec("DROP TRIGGER fail_preview");
  const preview = await service.previewCsv(invalid);
  assert.equal(preview.rows.length, 1); assert.equal(preview.rows[0].can_commit, false);
});

for (const [table, operation, condition] of [["leads", "INSERT", ""], ["lead_enquiry_revisions", "INSERT", ""], ["domain_events", "INSERT", ""], ["import_row_outcomes", "INSERT", ""], ["import_rows", "UPDATE", "WHEN NEW.committed=1"], ["audit_logs", "INSERT", "WHEN NEW.event_type='ImportRowCommitted'"]]) test("selected row rolls back lead/context/event/outcome when " + table + " fails", async t => {
  const { db, service } = await setup(t), preview = await service.previewCsv(input());
  await db.exec("CREATE TRIGGER fail_row BEFORE " + operation + " ON " + table + " " + condition + " BEGIN SELECT RAISE(ABORT,'synthetic row failure with private data'); END");
  await assert.rejects(service.commitImport(command(preview)), { code: "IMPORT_ROW_WRITE_FAILED", statusCode: 500 });
  for (const table of ["leads", "lead_enquiry_revisions", "domain_events", "import_row_outcomes"]) assert.equal(await count(db, table), 0, table);
  const failed = await service.getImport(preview.import_id, "org");
  assert.equal(failed.state, "FAILED"); assert.equal(failed.import.last_error, "IMPORT_ROW_WRITE_FAILED"); assert.equal(failed.progress.remaining_rows, 1); assert.equal(failed.rows[0].committed, false);
  await db.exec("DROP TRIGGER fail_row");
  const done = await service.commitImport(command(preview)); assert.equal(done.state, "COMMITTED");
  for (const table of ["leads", "lead_enquiry_revisions", "domain_events", "import_row_outcomes"]) assert.equal(await count(db, table), 1, table);
  assert.equal((await service.getImport(preview.import_id, "org")).rows[0].normalized_values.enquiry.budget.value.minimum_minor, "900719925474099301");
});

test("concurrent identical previews and commits preserve one batch, row outcome and completion audit", async t => {
  const { db, service } = await setup(t);
  const previews = await Promise.all([service.previewCsv(input(2)), service.previewCsv(input(2))]);
  assert.equal(previews[0].import_id, previews[1].import_id); assert.equal(await count(db, "import_batches"), 1);
  const results = await Promise.all([service.commitImport(command(previews[0])), service.commitImport(command(previews[1]))]);
  assert.ok(results.every(result => result.state === "COMMITTED"));
  for (const table of ["leads", "lead_enquiry_revisions", "domain_events", "import_row_outcomes"]) assert.equal(await count(db, table), 2, table);
  assert.equal(await count(db, "audit_logs", "event_type='ImportCommitted'"), 1);
  assert.equal(await count(db, "audit_logs", "event_type='ImportSelectionFrozen'"), 1);
  await assert.rejects(service.commitImport(command(previews[0], { selected_row_ids: [previews[0].rows[0].id] })), { code: "IMPORT_SELECTION_FROZEN" });
});

test("competing different selections freeze one intent and cannot expand after completion", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input(2));
  const results = await Promise.allSettled(batch.rows.map(row => service.commitImport(command(batch, { selected_row_ids: [row.id] }))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "IMPORT_SELECTION_FROZEN");
  assert.equal(await count(db, "leads"), 1);
  await assert.rejects(service.commitImport(command(batch)), { code: "IMPORT_SELECTION_FROZEN" });
});

test("final audit failure preserves row outcomes and retry completes the same intent once", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input(2));
  await db.exec("CREATE TRIGGER fail_finish BEFORE INSERT ON audit_logs WHEN NEW.event_type='ImportCommitted' BEGIN SELECT RAISE(ABORT,'synthetic final audit failure'); END");
  await assert.rejects(service.commitImport(command(batch)), { code: "IMPORT_ROW_WRITE_FAILED" });
  assert.equal(await count(db, "leads"), 2); assert.equal(await count(db, "domain_events"), 2);
  assert.equal((await service.getImport(batch.import_id, "org")).state, "FAILED");
  assert.equal(await count(db, "audit_logs", "event_type='ImportCommitted'"), 0);
  await db.exec("DROP TRIGGER fail_finish");
  assert.equal((await service.commitImport(command(batch))).state, "COMMITTED");
  assert.equal(await count(db, "audit_logs", "event_type='ImportCommitted'"), 1);
  assert.equal(await count(db, "leads"), 2); assert.equal(await count(db, "domain_events"), 2);
});

test("correction rollback preserves old review, source cells, issues and source lineage", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input(1, { csv_text: "Name,Email,Interest,Budget\nSynthetic,not-email,Table,1" }));
  const row = batch.rows[0], edit = { organization_id: "org", import_id: batch.import_id, import_row_id: row.id, actor, expected_revision: 1, values: { ...row.mapped_values, email: "corrected@example.test" }, reason: "Owner checked source contact" };
  for (const [table, condition] of [["import_row_corrections", ""], ["audit_logs", "WHEN NEW.event_type='ImportRowCorrected'"]]) {
    await db.exec("CREATE TRIGGER fail_correction BEFORE INSERT ON " + table + " " + condition + " BEGIN SELECT RAISE(ABORT,'synthetic correction failure'); END");
    await assert.rejects(service.correctRow(edit), /synthetic correction failure/);
    const unchanged = await service.getImport(batch.import_id, "org"); assert.equal(unchanged.review_revision, 1); assert.deepEqual(unchanged.rows[0].mapped_values, row.mapped_values); assert.equal(unchanged.corrections.length, 0); assert.equal(unchanged.issues.length, batch.issues.length);
    await db.exec("DROP TRIGGER fail_correction");
  }
  const revised = await service.correctRow(edit); assert.equal(revised.review_revision, 2); assert.deepEqual(revised.rows[0].raw_cells, row.raw_cells); assert.equal(revised.rows[0].can_commit, true); assert.equal(revised.corrections[0].before.mapped_values.email, "not-email");
  await assert.rejects(service.correctRow(edit), { code: "IMPORT_REVIEW_STALE" });
  await assert.rejects(service.commitImport(command(batch, { selected_row_ids: [row.id] })), { code: "IMPORT_REVIEW_STALE" });
});

test("correction recomputes both sides of duplicate warnings without silently resolving identity", async t => {
  const { service } = await setup(t), batch = await service.previewCsv(input(1, { csv_text: "Name,Email,Interest,Budget\nOne,same@example.test,Table,1\nTwo,same@example.test,Chair,2" }));
  assert.ok(batch.rows.every(row => !row.can_commit));
  const updated = await service.correctRow({ organization_id: "org", import_id: batch.import_id, import_row_id: batch.rows[1].id, expected_revision: 1, values: { ...batch.rows[1].mapped_values, email: "different@example.test" }, reason: "Checked distinct address in source", actor });
  assert.ok(updated.rows.every(row => row.can_commit)); assert.equal(updated.duplicate_candidates.length, 0);
  assert.equal((await service.commitImport(command(updated))).progress.committed_rows, 2);
});

test("a new external duplicate is durably held and a contact restriction survives a clean import", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input(2));
  const leads = new LeadsRepository(db);
  await leads.createLead({ organization_id: "org", name: "New external lead", email: "person0@example.test" });
  const policy = new ContactPolicyService(db);
  await policy.restrictContact({ organization_id: "org", contact: { kind: "EMAIL", value: "person1@example.test" }, reason: "OPT_OUT", source: "MANUAL", source_event_id: "synthetic-import-restriction", actor_id: "owner" });
  const restrictionsBefore = await db.all("SELECT * FROM contact_restrictions");
  const done = await service.commitImport(command(batch));
  assert.equal(done.state, "COMMITTED"); assert.deepEqual(done.progress, { selected_rows: 2, committed_rows: 1, held_rows: 1, remaining_rows: 0 });
  assert.equal(done.rows.find(row => row.commit_state === "HELD").created_lead_id, null);
  const imported = done.rows.find(row => row.committed);
  assert.equal((await policy.inspectLead({ organization_id: "org", lead_id: imported.created_lead_id, channel: "EMAIL" })).restricted, true);
  assert.deepEqual(await db.all("SELECT * FROM contact_restrictions"), restrictionsBefore);
  assert.equal(await count(db, "domain_events"), 1); assert.equal(await count(db, "lead_enquiry_revisions"), 1);
});

test("owner, foreign row and revision failures never freeze or mutate preview", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input());
  await assert.rejects(service.previewCsv(input(1, { actor: { id: "other-owner", role: "OWNER" } })), { code: "IMPORT_OWNER_REQUIRED" });
  await assert.rejects(service.commitImport(command(batch, { actor: { id: "other-owner", role: "OWNER" } })), { code: "IMPORT_OWNER_REQUIRED" });
  await assert.rejects(service.commitImport(command(batch, { selected_row_ids: ["foreign-row"] })), { code: "IMPORT_ROW_NOT_FOUND" });
  await assert.rejects(service.commitImport(command(batch, { selected_row_ids: [batch.rows[0].id, batch.rows[0].id] })), { code: "IMPORT_INVALID_SELECTION" });
  await assert.rejects(service.commitImport(command(batch, { expected_revision: 2 })), { code: "IMPORT_REVIEW_STALE" });
  await db.run("UPDATE users SET role='MEMBER' WHERE id='owner'");
  await assert.rejects(service.commitImport(command(batch)), { code: "IMPORT_OWNER_REQUIRED" });
  assert.equal((await service.getImport(batch.import_id, "org")).frozen_selection, null); assert.equal(await count(db, "leads"), 0);
});

test("file-backed COMMITTING survives lost response/restart and another connection resumes only unfinished rows", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-import-owned-")), file = path.join(dir, "import.sqlite");
  let first = new SqliteDatabaseClient(file), second;
  t.after(async () => { await first?.close(); await second?.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await seed(first); const initial = serviceFor(first), batch = await initial.previewCsv(input(28));
  const partial = await initial.commitImport(command(batch));
  assert.equal(partial.state, "COMMITTING"); assert.equal(partial.progress.committed_rows, 25); assert.equal(partial.progress.remaining_rows, 3);
  await first.close(); first = null;
  second = new SqliteDatabaseClient(file); const resumed = serviceFor(second), recovered = await resumed.getImport(batch.import_id, "org");
  assert.deepEqual(recovered.frozen_selection, partial.frozen_selection);
  const done = await resumed.commitImport(command(recovered, { selected_row_ids: recovered.frozen_selection }));
  assert.equal(done.state, "COMMITTED"); assert.equal(await count(second, "leads"), 28); assert.equal(await count(second, "domain_events"), 28); assert.equal(await count(second, "audit_logs", "event_type='ImportCommitted'"), 1);
  const replay = await resumed.commitImport(command(recovered, { selected_row_ids: recovered.frozen_selection })); assert.equal(replay.progress.committed_rows, 28);
});

test("historical unfinished previews remain review-held and completed historical state stays readable", async t => {
  const { db, service } = await setup(t), batch = await service.previewCsv(input());
  await db.run("UPDATE import_batches SET contract_version=0,review_revision=0 WHERE id=?", [batch.import_id]);
  assert.equal((await service.getImport(batch.import_id, "org")).legacy_review_required, true);
  await assert.rejects(service.commitImport(command(batch)), { code: "IMPORT_LEGACY_REVIEW_REQUIRED" });
  await db.run("UPDATE import_batches SET state='COMMITTED' WHERE id=?", [batch.import_id]);
  const historic = await service.getImport(batch.import_id, "org"); assert.equal(historic.state, "COMMITTED"); assert.equal(historic.legacy_review_required, false);
  assert.equal(await count(db, "leads"), 0);
});

test("history derives progress after a row commit without batch finalization and labels its recent limit", async t => {
  const { db, service } = await setup(t), preview = await service.previewCsv(input(2));
  const ids = preview.rows.map(row => row.id).sort();
  await new ContactPolicyService(db).withWorkspacePolicyTransaction("org", async tx => {
    const repository = new ImportsRepository(tx), batch = await repository.getBatch(preview.import_id, "org");
    await repository.freeze(batch, ids);
  });
  await service.commitRow({ import_id: preview.import_id, organization_id: "org", import_row_id: preview.rows[0].id, revision: 1, owner: "owner" });
  const history = await service.listImports("org");
  assert.deepEqual(history.imports[0].progress, { selected_rows: 2, committed_rows: 1, held_rows: 0, remaining_rows: 1 });
  assert.equal(history.imports[0].summary.committed_rows, 1); assert.equal(history.has_more, false); assert.equal(history.limit, 100);
  for (let i = 0; i < 100; i++) await service.previewCsv(input(1, { filename: "recent-" + i + ".csv" }));
  const recent = await service.listImports("org"); assert.equal(recent.imports.length, 100); assert.equal(recent.has_more, true); assert.equal(recent.limit, 100);
});

test("outcome-marker inconsistency fails closed instead of repeating a lead creation", async t => {
  const { db, service } = await setup(t), preview = await service.previewCsv(input());
  await service.commitImport(command(preview));
  await db.run("UPDATE import_rows SET committed=0 WHERE id=?", [preview.rows[0].id]);
  await assert.rejects(service.getImport(preview.import_id, "org"), { code: "IMPORT_STATE_INVALID" });
  await assert.rejects(service.commitImport(command(preview)), { code: "IMPORT_STATE_INVALID" });
  assert.equal(await count(db, "leads"), 1);
});

test("Unicode name/company matching uses the same canonical key in preview and late duplicate recheck", async t => {
  const { db, service } = await setup(t), leads = new LeadsRepository(db);
  const upper = String.fromCodePoint(201) + "lodie", lower = upper.toLowerCase();
  await leads.createLead({ organization_id: "org", name: "  " + upper + "  ", company: "  AcME  ", email: "existing@example.test" });
  const preview = await service.previewCsv(input(1, { mapping: { ...mapping, company: 4 }, csv_text: "Name,Email,Interest,Budget,Company\n" + lower + ",other@example.test,Table,1,acme" }));
  assert.equal(preview.rows[0].can_commit, false); assert.ok(preview.rows[0].duplicate_candidates.some(candidate => candidate.duplicate_type === "POSSIBLE_NAME_COMPANY"));
  const late = await service.previewCsv(input(1, { filename: "late-unicode.csv", mapping: { ...mapping, company: 4 }, csv_text: "Name,Email,Interest,Budget,Company\n" + upper + ",late@example.test,Table,1,Other workshop" }));
  assert.equal(late.rows[0].can_commit, true);
  await leads.createLead({ organization_id: "org", name: lower, company: " OTHER WORKSHOP ", email: "new-external@example.test" });
  const done = await service.commitImport(command(late)); assert.equal(done.progress.held_rows, 1); assert.equal(done.progress.committed_rows, 0);
  assert.equal(await count(db, "domain_events"), 0);
});

test("a supported 1000-row duplicate file can correct its first row without dropping source or candidate history", async t => {
  const { db, service } = await setup(t);
  const csv_text = "Name,Email,Phone,Company,Interest\n" + Array.from({ length: 1000 }, () => "Shared Name,shared@example.test,+919876543210,Shared Workshop,Table").join("\n");
  const preview = await service.previewCsv(input(1, { csv_text, mapping: { name: 0, email: 1, phone: 2, company: 3, interest: 4 } }));
  assert.equal(preview.rows.length, 1000);
  const first = preview.rows[0]; assert.equal(first.duplicate_candidates.length, 2997); assert.equal(first.can_commit, false);
  const corrected = await service.correctRow({ organization_id: "org", import_id: preview.import_id, import_row_id: first.id, actor, expected_revision: 1, reason: "Owner checked this row's distinct email", values: { ...first.mapped_values, email: "corrected@example.test" } });
  const current = corrected.rows.find(row => row.id === first.id), history = corrected.corrections[0];
  assert.equal(corrected.review_revision, 2); assert.deepEqual(current.raw_cells, first.raw_cells); assert.equal(current.raw_cells[1], "shared@example.test");
  assert.equal(current.normalized_values.email, "corrected@example.test"); assert.equal(current.duplicate_candidates.length, 1998); assert.equal(current.can_commit, false);
  assert.ok(current.duplicate_candidates.every(candidate => candidate.duplicate_type !== "STRONG_EMAIL"));
  assert.deepEqual(history.before.duplicate_candidates, first.duplicate_candidates); assert.deepEqual(history.after.duplicate_candidates, current.duplicate_candidates);
  assert.equal(history.before.mapped_values.email, "shared@example.test"); assert.equal(history.after.mapped_values.email, "corrected@example.test");
  const stored = await db.get("SELECT before_json,after_json FROM import_row_corrections WHERE id=?", [history.id]);
  assert.ok(Buffer.byteLength(stored.before_json, "utf8") > 262144); assert.ok(Buffer.byteLength(stored.before_json, "utf8") <= 2097152); assert.ok(Buffer.byteLength(stored.after_json, "utf8") <= 2097152);
  assert.equal(await count(db, "leads"), 0); assert.equal(await count(db, "domain_events"), 0);
});
