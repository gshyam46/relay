import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { LeadDataService } from "../src/modules/data-foundation/leadDataService.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ImportsService } from "../src/modules/data-foundation/importsService.js";
import { ImportsRepository } from "../src/modules/data-foundation/importsRepository.js";
import { ImportIdentityService } from "../src/modules/data-foundation/importIdentityService.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
const actor = { id: "owner", role: "OWNER" }, stamp = "2026-09-12T10:00:00.000Z";
async function seed(db) { await runMigrations(db); for (const [org, owner] of [["org", "owner"], ["other", "other-owner"]]) { await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic", stamp]); await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, org, "Synthetic", owner + "@example.test", stamp]); } }
async function setup(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); await seed(db); const lead = await new LeadsRepository(db).createLead({ organization_id: "org", name: "Original", email: "old@example.test", company: "Original Co" }); return { db, lead, service: new LeadDataService(db) }; }
function input(lead, values = {}, revision = lead.data_revision || 0) { return { organization_id: "org", lead_id: lead.id, actor, expected_revision: revision, values: { name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, ...values }, default_phone_region: "INTERNATIONAL_ONLY" }; }
async function command(service, lead, values = {}, revision = 0) { const change = input(lead, values, revision), preview = await service.preview(change); return { ...change, review_token: preview.review_token, reason: "Owner verified the current customer record" }; }
const total = async (db, table) => Number((await db.get("SELECT count(*) n FROM " + table)).n);
for (const [table, operation, condition] of [["contact_restrictions", "INSERT", ""], ["actions", "UPDATE", ""], ["leads", "UPDATE", "WHEN NEW.data_revision>OLD.data_revision"], ["lead_data_changes", "INSERT", ""], ["audit_logs", "INSERT", "WHEN NEW.event_type='LeadDataChanged'"]]) test("correction rolls back source, safety effects and revision when " + table + " fails", async t => {
  const { db, lead, service } = await setup(t);
  await new ContactPolicyService(db).restrictContact({ organization_id: "org", contact: { kind: "EMAIL", value: lead.email }, reason: "HARD_BOUNCE", channel: "EMAIL", source: "PROVIDER_EVENT", source_event_id: "bounce", actor_id: "owner" });
  const action = await new ActionsRepository(db).createAction({ organization_id: "org", lead_id: lead.id, type: "SEND_EMAIL", status: "AWAITING_APPROVAL", idempotency_key: "pending-original" });
  const change = await command(service, lead, { email: "corrected@example.test" });
  const original = await db.get("SELECT * FROM leads WHERE id=?", [lead.id]), restrictions = await db.all("SELECT * FROM contact_restrictions");
  await db.exec("CREATE TRIGGER fail_data BEFORE " + operation + " ON " + table + " " + condition + " BEGIN SELECT RAISE(ABORT,'synthetic private data failure'); END");
  await assert.rejects(service.update(change), { code: "LEAD_DATA_WRITE_FAILED", statusCode: 500 });
  assert.deepEqual(await db.get("SELECT * FROM leads WHERE id=?", [lead.id]), original); assert.deepEqual(await db.all("SELECT * FROM contact_restrictions"), restrictions);
  assert.equal((await db.get("SELECT status FROM actions WHERE id=?", [action.id])).status, "AWAITING_APPROVAL"); assert.equal(await total(db, "lead_data_changes"), 0);
  await db.exec("DROP TRIGGER fail_data"); const saved = await service.update(change);
  assert.equal(saved.current.data_revision, 1); assert.equal(saved.effects.blocked_actions, 1); assert.equal(saved.effects.carried_restriction_count, 1);
  assert.equal((await db.get("SELECT status FROM actions WHERE id=?", [action.id])).status, "BLOCKED");
});
test("identical concurrent correction replays one original result after later changes", async t => {
  const { db, lead, service } = await setup(t), original = await command(service, lead, { email: "next@example.test" });
  const results = await Promise.all([service.update(original), service.update(original)]); assert.equal(results[0].change.id, results[1].change.id); assert.equal(await total(db, "lead_data_changes"), 1);
  const archived = await service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 1, archived: true, reason: "Close this enquiry" }); assert.equal(archived.current.data_revision, 2);
  const replay = await service.update(original); assert.equal(replay.replayed, true); assert.equal(replay.current.data_revision, 1); assert.equal(replay.current.archived_at, null); assert.deepEqual(replay.history.changes.map(row => row.revision), [1]);
  assert.ok((await service.get({ organization_id: "org", lead_id: lead.id })).current.archived_at); assert.equal(await total(db, "lead_data_changes"), 2);
  await assert.rejects(service.update({ ...original, reason: "Different intent" }), { code: "LEAD_DATA_CHANGE_CONFLICT" });
});
test("competing correction intents consume one expected revision", async t => {
  const { db, lead, service } = await setup(t), a = await command(service, lead, { email: "a@example.test" }), b = await command(service, lead, { email: "b@example.test" });
  const results = await Promise.allSettled([service.update(a), service.update(b)]); assert.equal(results.filter(row => row.status === "fulfilled").length, 1); assert.equal(results.find(row => row.status === "rejected").reason.code, "LEAD_DATA_CHANGE_CONFLICT"); assert.equal(await total(db, "lead_data_changes"), 1);
});
test("correction preserves import cells and enquiry, and retains each field's own correction origin across archive", async t => {
  const { db, service } = await setup(t), imports = new ImportsService({ importsRepository: new ImportsRepository(db) });
  const batch = await imports.previewCsv({ organization_id: "org", actor, filename: "source.csv", csv_text: "Name,Email,Interest\nImported,imported@example.test,Table", mapping: { name: 0, email: 1, interest: 2 }, options: { date_format: "ISO", default_currency: null, assertion: "CUSTOMER_STATED" }, default_phone_region: "INTERNATIONAL_ONLY" });
  const committed = await imports.commitImport({ organization_id: "org", import_id: batch.import_id, expected_revision: 1, actor, selected_row_ids: [batch.rows[0].id] });
  const lead = await new LeadsRepository(db).getLead(committed.rows[0].created_lead_id), sourceBefore = await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]), enquiryBefore = await db.all("SELECT * FROM lead_enquiry_revisions WHERE lead_id=?", [lead.id]);
  const first = await service.update(await command(service, lead, { email: "changed@example.test" }));
  const updated = await new LeadsRepository(db).getLead(lead.id), second = await service.update(await command(service, updated, { company: "Verified Co" }, 1));
  assert.equal(second.current.field_provenance.email.change_id, first.change.id); assert.equal(second.current.field_provenance.company.change_id, second.change.id); assert.equal(second.current.field_provenance.name, null);
  const archived = await service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 2, archived: true, reason: "Archive reviewed record" });
  assert.deepEqual(archived.current.field_provenance, second.current.field_provenance); assert.deepEqual(await db.get("SELECT * FROM import_rows WHERE id=?", [batch.rows[0].id]), sourceBefore); assert.deepEqual(await db.all("SELECT * FROM lead_enquiry_revisions WHERE lead_id=?", [lead.id]), enquiryBefore);
});
test("no-op needs current revision and never creates history or changes original identity", async t => {
  const { db, lead, service } = await setup(t), preview = await service.preview(input(lead));
  assert.equal(preview.unavailable_reason, "LEAD_DATA_NO_CHANGE");
  const result = await service.update({ ...input(lead), review_token: preview.review_token, reason: "Confirmed current values" }); assert.equal(result.changed, false); assert.equal(await total(db, "lead_data_changes"), 0);
  await service.update(await command(service, lead, { company: "Changed" }));
  await assert.rejects(service.preview(input(lead)), { code: "LEAD_DATA_REVISION_STALE" });
});
test("pending old-contact policy blocks correction until the restriction is ready to carry", async t => {
  const { db, lead, service } = await setup(t), earlier = await command(service, lead, { email: "replacement@example.test" });
  await db.run("INSERT INTO webhook_receipts(id,organization_id,provider,connection_key,provider_event_id,event_kind,normalized_input_json,payload_hash,identity_hash,verification_kind,received_at,updated_at) VALUES ('pending','org','SYNTHETIC','local','old-optout','INBOUND_MESSAGE','{}',?,?,'LOCAL_TEST',?,?)", ["a".repeat(64), "b".repeat(64), stamp, stamp]);
  const preview = await service.preview(input(lead, { email: "replacement@example.test" })); assert.equal(preview.can_save, false); assert.equal(preview.review_token, null); assert.equal(preview.unavailable_reason, "LEAD_DATA_POLICY_PENDING");
  await assert.rejects(service.update(earlier), { code: "LEAD_DATA_POLICY_PENDING" });
  await new ContactPolicyService(db).restrictContact({ organization_id: "org", contact: { kind: "EMAIL", value: lead.email }, reason: "OPT_OUT", source: "INBOUND_EVENT", source_event_id: "old-optout" });
  await db.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id='pending'");
  await assert.rejects(service.update(earlier), { code: "LEAD_DATA_REVIEW_STALE" });
  const saved = await service.update(await command(service, lead, { email: "replacement@example.test" })); assert.equal(saved.effects.carried_restriction_count, 1);
});
test("archiving oversized legacy identity changes only archive authority and supports exact restore", async t => {
  const { db, lead, service } = await setup(t), largeName = "Legacy" + "x".repeat(40000);
  await db.run("UPDATE leads SET name=?,email='UPPER@example.test' WHERE id=?", [largeName, lead.id]);
  const before = await new LeadsRepository(db).getLead(lead.id);
  await service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, archived: true, reason: "Archive historical record" });
  const restored = await service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 1, archived: false, reason: "Restore historical record" });
  assert.equal(restored.current.values.name, largeName); assert.equal(restored.current.values.email, "UPPER@example.test");
  const after = await new LeadsRepository(db).getLead(lead.id); for (const key of ["name", "email", "normalized_email", "normalized_name_company_key", "status", "source", "import_row_id"]) assert.deepEqual(after[key], before[key]);
  await assert.rejects(service.preview(input(after)), { code: "LEAD_DATA_INVALID_INPUT" });
});
test("corrected and archived identity candidates invalidate previous import review and refuse archived linking", async t => {
  const { db, lead, service } = await setup(t), imports = new ImportsService({ importsRepository: new ImportsRepository(db) }), identity = new ImportIdentityService(db);
  const batch = await imports.previewCsv({ organization_id: "org", actor, filename: "identity.csv", csv_text: "Name,Email\nOriginal,old@example.test", mapping: { name: 0, email: 1 }, options: { date_format: "ISO", default_currency: null, assertion: "OPERATOR_OBSERVED" }, default_phone_region: "INTERNATIONAL_ONLY" });
  const request = { organization_id: "org", import_id: batch.import_id, import_row_id: batch.rows[0].id, actor }, review = await identity.review(request);
  await service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, archived: true, reason: "Archive existing enquiry" });
  const fresh = await identity.review(request); assert.equal(fresh.existing_candidates[0].lead.data_revision, 1); assert.equal(fresh.existing_candidates[0].can_link, false); assert.equal(fresh.existing_candidates[0].link_block_reason, "LEAD_ARCHIVED");
  await assert.rejects(identity.resolve({ ...request, review_token: review.review_token, decision: "LINK_EXISTING", classification: "SAME_ENQUIRY", target_lead_id: lead.id, reason: "Reviewed duplicate source" }), { code: "IDENTITY_REVIEW_STALE" });
});
test("file-backed lost correction response replays its receipt after restart", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-data-owned-")), file = path.join(dir, "data.sqlite"); let first = new SqliteDatabaseClient(file), second;
  t.after(async () => { await first?.close(); await second?.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await seed(first); const lead = await new LeadsRepository(first).createLead({ organization_id: "org", name: "Original", email: "old@example.test" }), initial = new LeadDataService(first), update = await command(initial, lead, { name: "Corrected" });
  const saved = await initial.update(update); await first.close(); first = null;
  second = new SqliteDatabaseClient(file); const replay = await new LeadDataService(second).update(update); assert.equal(replay.change.id, saved.change.id); assert.equal(replay.replayed, true); assert.equal(await total(second, "lead_data_changes"), 1);
});

test("duplicate review binds hidden candidate state and refuses scans above5000 matches", async t => {
  const { db, lead, service } = await setup(t);
  await db.transaction(async tx => { for (let index = 0; index < 61; index++) await tx.run("INSERT INTO leads(id,organization_id,name,email,normalized_email,source,status,created_at,updated_at) VALUES (?,'org','Shared','shared@example.test','shared@example.test','SYNTHETIC','NEW',?,?)", ["candidate-" + String(index).padStart(5, "0"), stamp, stamp]); });
  const values = { email: "shared@example.test" }, reviewed = await command(service, lead, values), preview = await service.preview(input(lead, values));
  assert.equal(preview.duplicate_total, 61); assert.equal(preview.duplicate_candidates.length, 50); assert.equal(preview.can_save, true);
  await db.run("UPDATE leads SET status='SUPPRESSED' WHERE id='candidate-00060'");
  await assert.rejects(service.update(reviewed), { code: "LEAD_DATA_REVIEW_STALE" });
  await db.transaction(async tx => { for (let index = 61; index < 5001; index++) await tx.run("INSERT INTO leads(id,organization_id,name,email,normalized_email,source,status,created_at,updated_at) VALUES (?,'org','Shared','shared@example.test','shared@example.test','SYNTHETIC','NEW',?,?)", ["candidate-" + String(index).padStart(5, "0"), stamp, stamp]); });
  const limited = await service.preview(input(lead, values)); assert.equal(limited.duplicate_total, 5001); assert.equal(limited.duplicate_candidates.length, 50); assert.equal(limited.can_save, false); assert.equal(limited.review_token, null); assert.equal(limited.unavailable_reason, "LEAD_DATA_CANDIDATE_LIMIT");
});
async function restrictions(db, count) {
  await db.transaction(async tx => { for (let index = 0; index < count; index++) await tx.run("INSERT INTO contact_restrictions(id,organization_id,contact_kind,contact_value,channel,reason,source,source_event_id,effective_at,created_at) VALUES (?,'org','EMAIL','old@example.test','EMAIL','HARD_BOUNCE','PROVIDER_EVENT',?,?,?)", ["old-restriction-" + index, "old-event-" + index, stamp, stamp]); });
}
test("10000 carried restrictions fit immutable effects while public history stays bounded", async t => {
  const { db, lead, service } = await setup(t); await restrictions(db, 10000);
  const saved = await service.update(await command(service, lead, { email: "corrected@example.test" }));
  assert.equal(saved.effects.carried_restriction_count, 10000); assert.equal(saved.effects.carried_restriction_ids.length, 100); assert.equal(saved.effects.carried_restrictions_truncated, true);
  assert.equal(JSON.parse((await db.get("SELECT effects_json FROM lead_data_changes")).effects_json).carried_restriction_ids.length, 10000);
  assert.equal(Number((await db.get("SELECT count(*) n FROM contact_restrictions WHERE contact_kind='LEAD'")).n), 10000);
});
test("10001 policy records and10001 queued actions refuse incomplete correction or archive work", async t => {
  const { db, lead, service } = await setup(t); await restrictions(db, 10001);
  const policyLimited = await service.preview(input(lead, { email: "new@example.test" })); assert.equal(policyLimited.unavailable_reason, "LEAD_DATA_POLICY_LIMIT"); assert.equal(policyLimited.review_token, null); assert.equal(policyLimited.current_policy.policy_incomplete, true); assert.equal(policyLimited.current_policy.restriction_count, null);
  await db.transaction(async tx => { for (let index = 0; index < 10001; index++) await tx.run("INSERT INTO actions(id,organization_id,lead_id,type,status,payload_json,idempotency_key,created_at,updated_at) VALUES (?,'org',?,'SEND_EMAIL','PLANNED','{}',?,?,?)", ["work-" + index, lead.id, "work-key-" + index, stamp, stamp]); });
  await assert.rejects(service.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, archived: true, reason: "Archive over work limit" }), { code: "LEAD_DATA_WORK_LIMIT" });
  assert.equal((await new LeadsRepository(db).getLead(lead.id)).archived_at, null); assert.equal(await total(db, "lead_data_changes"), 0);
});

test("correction review names carried reason and channel and preserves legacy status warnings", async t => {
  const { db, lead, service } = await setup(t); await restrictions(db, 2);
  for (const [status, reason] of [["OPTED_OUT", "OPT_OUT"], ["SUPPRESSED", "SUPPRESSED"]]) {
    await db.run("UPDATE leads SET status=? WHERE id=?", [status, lead.id]);
    const preview = await service.preview(input(lead, { email: "changed@example.test" }));
    for (const policy of [preview.current_policy, preview.proposed_policy]) {
      assert.deepEqual(policy.reasons, [{ reason: "HARD_BOUNCE", channel: "EMAIL" }, { reason, channel: "ALL" }]);
      assert.equal(policy.restricted, true); assert.equal(policy.policy_incomplete, false); assert.equal(policy.restriction_count, 2);
    }
  }
});
test("preview and save share the work limit while preserved human tasks remain untouched", async t => {
  const { db, lead, service } = await setup(t);
  await db.transaction(async tx => { for (let index = 0; index < 10001; index++) await tx.run("INSERT INTO follow_up_tasks(id,organization_id,lead_id,channel,status,due_at,reason,idempotency_key,created_at,updated_at) VALUES (?,'org',?,'EMAIL','PLANNED',?,'Human task',?,?,?)", ["human-" + index, lead.id, stamp, "human-key-" + index, stamp, stamp]); });
  const blocked = await service.preview(input(lead, { name: "Corrected" }));
  assert.equal(blocked.can_save, false); assert.equal(blocked.review_token, null); assert.equal(blocked.unavailable_reason, "LEAD_DATA_WORK_LIMIT"); assert.equal(blocked.effects.cancelled_follow_ups, 0);
  await db.run("DELETE FROM follow_up_tasks WHERE id='human-10000'");
  const saved = await service.update(await command(service, lead, { name: "Corrected" }));
  assert.equal(saved.effects.cancelled_follow_ups, 0); assert.equal(saved.current.data_revision, 1);
  assert.equal(Number((await db.get("SELECT count(*) n FROM follow_up_tasks WHERE status='PLANNED'")).n), 10000);
});
