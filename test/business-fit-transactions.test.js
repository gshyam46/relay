import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyProfile, emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";
import { IntelligenceService } from "../src/modules/lead-intelligence/intelligenceService.js";
import { IntelligenceRepository } from "../src/modules/lead-intelligence/intelligenceRepository.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { FRESHNESS_TTL_MS } from "../src/modules/lead-intelligence/freshnessContract.js";
const AT = "2026-09-12T10:00:00.000Z", actor = { id: "owner", role: "OWNER" };
const criteria = () => ({ version: 1, interest: { requirement: "REQUIRED", accepted_aliases: ["table"], excluded_aliases: ["chair"] }, location: null, budget: null, timeline: null });
const profile = () => ({ ...emptyProfile(), business_name: "Synthetic business", offerings: ["Tables"] });
const enquiry = () => ({ ...emptyEnquiry(), interest: { state: "KNOWN", value: "table", provenance: { assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic customer statement", observed_at: AT } } });
async function setup(t, filename = ":memory:") {
  const db = new SqliteDatabaseClient(filename); t.after(() => db.close()); await runMigrations(db);
  for (const [organization, owner] of [["org", "owner"], ["other", "other-owner"]]) { await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [organization, "Synthetic", AT]); await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, organization, "Synthetic", owner + "@example.test", AT]); }
  const lead = await new LeadsRepository(db).createLead({ organization_id: "org", name: "Synthetic", email: "synthetic@example.test" }); let time = Date.parse(AT);
  const context = new BusinessContextService(db, { now: () => time }), intelligence = new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(db), auditRepository: new AuditRepository(db), now: () => time });
  const saveProfile = (fit_criteria, expected_revision = 0, extra = {}) => context.updateProfile({ organization_id: "org", actor, expected_revision, profile: profile(), reason: "Owner reviewed criteria", ...(fit_criteria === undefined ? {} : { fit_criteria }), ...extra });
  const saveEnquiry = () => context.updateEnquiry({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, enquiry: enquiry(), reason: "Exact customer source" });
  return { db, lead, context, intelligence, saveProfile, saveEnquiry, setTime: value => { time = value; } };
}
test("criteria shares profile revision/history; equivalent edits no-op; omission preserves and explicit null disables", async t => {
  const f = await setup(t); const original = await f.saveProfile(criteria()); assert.equal(original.revision, 1);
  const unchanged = await f.saveProfile({ ...criteria(), interest: { ...criteria().interest, accepted_aliases: ["  TABLE  "] } }, 1); assert.deepEqual(unchanged, original);
  const descriptive = await f.saveProfile(undefined, 1, { profile: { ...profile(), business_name: "Renamed business" } }); assert.equal(descriptive.revision, 2); assert.deepEqual(descriptive.fit_criteria, original.fit_criteria);
  const disabled = await f.saveProfile(null, 2); assert.equal(disabled.revision, 3); assert.equal(disabled.fit_criteria, null);
  const history = await f.context.profileHistory({ organization_id: "org" }); assert.deepEqual(history.items.map(item => [item.revision, Boolean(item.fit_criteria)]), [[3, false], [2, true], [1, true]]);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessProfileUpdated'")).n), 3);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_snapshots")).n), 0);
});
test("owner, tenant and concurrent stale revisions prevent unauthorized or duplicate criteria writes", async t => {
  const f = await setup(t);
  for (const actor of [{ id: "other-owner", role: "OWNER" }, { id: "owner", role: "MEMBER" }, { id: "absent", role: "OWNER" }]) await assert.rejects(f.saveProfile(criteria(), 0, { actor }), { code: "BUSINESS_CONTEXT_OWNER_REQUIRED" });
  const competing = await Promise.allSettled([f.saveProfile(criteria()), f.saveProfile({ ...criteria(), interest: { ...criteria().interest, accepted_aliases: ["desk"] } })]);
  assert.equal(competing.filter(item => item.status === "fulfilled").length, 1); assert.equal(competing.find(item => item.status === "rejected").reason.code, "BUSINESS_CONTEXT_STALE");
  assert.equal((await f.context.getProfile({ organization_id: "other" })).revision, 0);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM business_profile_revisions")).n), 1);
});
test("failed profile audit rolls criteria and revision back atomically", async t => {
  const f = await setup(t); await f.saveProfile(criteria());
  await f.db.exec("CREATE TRIGGER reject_fit_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='BusinessProfileUpdated' BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END;");
  await assert.rejects(f.saveProfile(null, 1), /Synthetic audit failure/);
  const current = await f.context.getProfile({ organization_id: "org" }); assert.equal(current.revision, 1); assert.ok(current.fit_criteria);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM business_profile_revisions")).n), 1); assert.equal(Number((await f.db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessProfileUpdated'")).n), 1);
});
test("deterministic snapshot captures fit once; criteria edits invalidate and stale facts need review without redating source", async t => {
  const f = await setup(t); await f.saveProfile(criteria()); await f.saveEnquiry();
  const first = await f.intelligence.runForLead(f.lead); assert.equal(first.business_fit.status, "MATCHES_CRITERIA"); assert.equal(first.business_fit.criteria_revision, 1); assert.equal(first.business_fit.criterion_results[0].evidence.fact.provenance.observed_at, AT);
  assert.equal((await f.intelligence.runForLead(f.lead)).id, first.id);
  await f.saveProfile({ ...criteria(), interest: { requirement: "REQUIRED", accepted_aliases: ["chair"], excluded_aliases: ["table"] } }, 1);
  assert.equal((await f.intelligence.assessLead(f.lead)).currentness.state, "OUTDATED");
  const next = await f.intelligence.runForLead(f.lead); assert.equal(next.business_fit.status, "DOES_NOT_MATCH"); assert.equal(next.business_fit.criteria_revision, 2);
  f.setTime(Date.parse(AT) + FRESHNESS_TTL_MS); const expired = await f.intelligence.runForLead(f.lead); assert.equal(expired.business_fit.status, "NEEDS_REVIEW"); assert.equal(expired.business_fit.criterion_results[0].evidence.fact.provenance.observed_at, AT); assert.ok(expired.business_fit.criterion_results[0].reason_codes.includes("STALE"));
  const historical = await new IntelligenceRepository(f.db).snapshotDetail(await new IntelligenceRepository(f.db).getSnapshot(first.id)); assert.equal(historical.business_fit.status, "MATCHES_CRITERIA");
});
test("legacy null fit stays current without snapshot rewrite; failure draft retains exact fit and retry reuses it", async t => {
  const f = await setup(t); const legacy = await f.intelligence.runForLead(f.lead); assert.equal(legacy.business_fit.status, "NOT_CONFIGURED");
  await f.db.run("UPDATE intelligence_snapshots SET business_fit_json=NULL WHERE id=?", [legacy.id]); assert.equal((await f.intelligence.assessLead(f.lead)).currentness.state, "CURRENT"); assert.equal((await f.intelligence.runForLead(f.lead)).business_fit, null);
  await f.saveProfile(criteria()); await f.saveEnquiry(); await assert.rejects(f.intelligence.runForLead(f.lead, { simulate_failure_stage: "AFTER_DRAFT" }), /Simulated/);
  const failed = await f.db.get("SELECT * FROM intelligence_snapshots WHERE status='FAILED'"); assert.equal(JSON.parse(failed.business_fit_json).status, "MATCHES_CRITERIA");
  const retried = await f.intelligence.runForLead(f.lead); assert.equal(retried.id, failed.id); assert.equal(retried.business_fit.status, "MATCHES_CRITERIA");
});
test("persisted malformed criteria and fit fail closed without creating replacement analysis", async t => {
  const f = await setup(t); await f.saveProfile(criteria()); await f.saveEnquiry(); const snapshot = await f.intelligence.runForLead(f.lead);
  await f.db.run("UPDATE intelligence_snapshots SET business_fit_json='{}' WHERE id=?", [snapshot.id]); await assert.rejects(f.intelligence.assessLead(f.lead), { code: "BUSINESS_FIT_INVALID" });
  await f.db.run("UPDATE business_profile_revisions SET fit_criteria_json='{}' WHERE organization_id='org'"); await assert.rejects(f.context.getProfile({ organization_id: "org" }), { code: "BUSINESS_CONTEXT_INVALID" });
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_snapshots")).n), 1);
});
test("file-backed restart retains exact criteria and historical assessment without recomputation", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "business-fit-"));
  const filename = path.join(directory, "fixture.sqlite"), f = await setup(t, filename); await f.saveProfile(criteria()); await f.saveEnquiry(); const first = await f.intelligence.runForLead(f.lead); await f.db.close();
  const reopened = new SqliteDatabaseClient(filename); t.after(async () => { await reopened.close(); await rm(directory, { recursive: true, force: true }); }); await runMigrations(reopened);
  const service = new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(reopened), now: () => Date.parse(AT) }); const result = await service.runForLead(f.lead);
  assert.equal(result.id, first.id); assert.deepEqual(result.business_fit, first.business_fit); assert.equal((await new BusinessContextService(reopened).getProfile({ organization_id: "org" })).revision, 1);
});
