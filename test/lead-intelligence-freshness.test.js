import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchEvidenceService } from "../src/modules/lead-intelligence/researchEvidenceService.js";
import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { IntelligenceService } from "../src/modules/lead-intelligence/intelligenceService.js";
import { IntelligenceRepository } from "../src/modules/lead-intelligence/intelligenceRepository.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyEnquiry, emptyProfile } from "../src/modules/business-context/businessContextContract.js";
import { evaluateFreshness } from "../src/modules/lead-intelligence/freshnessService.js";
import { assessSource, FRESHNESS_TTL_MS, parseFreshnessAssessment } from "../src/modules/lead-intelligence/freshnessContract.js";
import { ResearchEvidenceRepository } from "../src/modules/lead-intelligence/researchEvidenceRepository.js";
import { normalizeResearchEvidenceItem } from "../src/modules/lead-intelligence/researchProviderContract.js";
const base = Date.parse("2026-01-02T00:00:00.000Z"), actor = { id: "owner", role: "OWNER" };
async function setup(t) {
  const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); await runMigrations(db);
  for (const [org, owner] of [["org", "owner"], ["other", "other-owner"]]) { await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic", new Date(base).toISOString()]); await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, org, "Synthetic", owner + "@example.test", new Date(base).toISOString()]); }
  const lead = await new LeadsRepository(db).createLead({ organization_id: "org", name: "Synthetic", email: "synthetic@example.test", company: "Acme" }); let clock = base;
  const service = new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(db), auditRepository: new AuditRepository(db), now: () => clock });
  const context = new BusinessContextService(db, { now: () => clock });
  const save = (enquiry, expected_revision = 0) => context.updateEnquiry({ organization_id: "org", lead_id: lead.id, actor, expected_revision, enquiry, reason: "Owner recorded exact source" });
  return { db, lead, service, context, save, setTime: value => { clock = value; }, evaluate: () => evaluateFreshness(db, lead, { now: () => clock }) };
}
const known = (value, observed_at = new Date(base).toISOString(), assertion = "CUSTOMER_STATED") => ({ state: "KNOWN", value, provenance: { source_type: "MANUAL", source_reference: "Customer record", assertion, observed_at } });
const interest = () => ({ ...emptyEnquiry(), interest: known("Table") });
async function research(db, lead, values = {}) {
  const repository = new ResearchEvidenceRepository(db), ingestion = await repository.createIngestion({ organization_id: "org", lead_id: lead.id, adapter_type: "APPROVED_MANUAL_RESEARCH", provider_key: "APPROVED_MANUAL_RESEARCH", idempotency_key: "research-" + Math.random() });
  const item = await repository.createEvidenceItem({ ingestion_id: ingestion.id, organization_id: "org", lead_id: lead.id, source_type: "APPROVED_RESEARCH", title: "Reviewed source", claim_field: "COMPANY_NAME", claim_value: "Acme", evidence_timestamp: new Date(base).toISOString(), confidence: "HIGH", ...values });
  await repository.updateIngestionState(ingestion.id, { state: "PERSISTED", completed: true }); return item;
}
test("pure policy changes exactly at90 days, never substitutes capture or legitimizes future timestamps", () => {
  const source = { field: "interest", observed_at: new Date(base).toISOString(), recorded_at: new Date(base).toISOString() };
  assert.equal(assessSource(source, base + FRESHNESS_TTL_MS - 1).freshness, "CURRENT"); assert.equal(assessSource(source, base + FRESHNESS_TTL_MS).freshness, "STALE");
  assert.equal(assessSource({ ...source, observed_at: null }, base).freshness, "AGE_UNKNOWN");
  assert.equal(assessSource({ ...source, observed_at: "2026-01-03T00:00:00Z" }, base + FRESHNESS_TTL_MS).freshness, "FUTURE_DATED");
  assert.equal(assessSource({ ...source, observed_at: "2026-02-30T00:00:00Z" }, base).freshness, "INVALID_TIME");
});
test("expiry invalidates current snapshot, survives clock rollback and explicit refresh is idempotent", async t => {
  const f = await setup(t); await f.save(interest()); const original = await f.service.runForLead(f.lead);
  assert.equal(original.freshness.facts.interest.usable, true); assert.equal((await f.service.assessLead(f.lead)).currentness.state, "CURRENT");
  f.setTime(base + FRESHNESS_TTL_MS - 1); assert.equal((await f.service.runForLead(f.lead)).id, original.id);
  f.setTime(base + FRESHNESS_TTL_MS); const expired = await f.service.assessLead(f.lead);
  assert.equal(expired.snapshot, null); assert.equal(expired.currentness.state, "OUTDATED"); assert.ok(expired.currentness.reasons.some(reason => reason.code === "FRESHNESS_CHANGED"));
  f.setTime(base); assert.equal((await f.evaluate()).facts.interest.freshness, "STALE");
  const refreshed = await f.service.runForLead(f.lead); assert.notEqual(refreshed.id, original.id); assert.ok(!refreshed.claims.some(claim => claim.field === "ENQUIRY_INTEREST")); assert.equal((await f.service.runForLead(f.lead)).id, refreshed.id);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadIntelligenceUpdated'")).n), 2);
  assert.equal((await f.service.assessLead(f.lead)).currentness.state, "CURRENT");
});
test("value state, assertion and historical time remain separate and conflicted/inferred values are unselected", async t => {
  const f = await setup(t), enquiry = emptyEnquiry(); enquiry.interest = known("Table", null); enquiry.budget = known({ currency: "INR", minimum: "100.00", maximum: "100.00" }, new Date(base).toISOString(), "INFERRED");
  enquiry.location = { state: "CONFLICTED", alternatives: [{ value: { locality: "Delhi", country_code: "IN" }, provenance: known("").provenance }, { value: { locality: "Mumbai", country_code: "IN" }, provenance: known("").provenance }] };
  enquiry.enquiry_date = known("2015-01-01", "2015-01-01T00:00:00Z"); enquiry.last_interaction = known("2015-01-02T00:00:00Z", "2015-01-02T00:00:00Z"); await f.save(enquiry);
  const snapshot = await f.service.runForLead(f.lead), assessment = snapshot.freshness;
  assert.equal(assessment.facts.interest.freshness, "AGE_UNKNOWN"); assert.equal(assessment.facts.budget.freshness, "CURRENT"); assert.equal(assessment.facts.budget.assertion, "INFERRED"); assert.equal(assessment.facts.budget.usable, false);
  assert.equal(assessment.facts.location.value_state, "CONFLICTED"); assert.equal(assessment.facts.location.alternatives.length, 2); assert.equal(assessment.facts.enquiry_date.freshness, "HISTORICAL"); assert.equal(assessment.facts.last_interaction.expires_at, null);
  assert.deepEqual(snapshot.claims.filter(claim => claim.field.startsWith("ENQUIRY_")).map(claim => claim.field).sort(), ["ENQUIRY_DATE", "ENQUIRY_LAST_INTERACTION"]);
});
test("copying or resolving an original future-at-recording assertion cannot make its timestamp valid", async t => {
  const f = await setup(t), enquiry = interest(); enquiry.interest = known("Table", "2026-01-03T00:00:00Z"); await f.save(enquiry);
  assert.equal((await f.evaluate()).facts.interest.freshness, "FUTURE_DATED");
  f.setTime(Date.parse("2026-01-20T00:00:00Z")); enquiry.location = known({ locality: "Delhi", country_code: "IN" }); await f.save(enquiry, 1);
  assert.equal((await f.evaluate()).facts.interest.freshness, "FUTURE_DATED");
});
test("criteria revision invalidates analysis and unchanged profile save leaves revision and refreshed result unchanged", async t => {
  const f = await setup(t), before = await f.service.runForLead(f.lead), profile = { ...emptyProfile(), business_name: "Acme", offerings: ["Tables"], required_criteria: ["Delivery location known"] };
  const input = { organization_id: "org", actor, expected_revision: 0, reason: "Owner criteria", profile }; await f.context.updateProfile(input);
  const changed = await f.service.assessLead(f.lead); assert.equal(changed.currentness.state, "OUTDATED");
  const refreshed = await f.service.runForLead(f.lead); assert.notEqual(refreshed.id, before.id); assert.equal(refreshed.freshness.current_revisions.profile_revision, 1);
  assert.equal((await f.context.updateProfile({ ...input, expected_revision: 1 })).revision, 1); assert.equal((await f.service.runForLead(f.lead)).id, refreshed.id);
});
test("research date normalization is strict and old invalid evidence remains visibly unusable", async t => {
  const input = { title: "Source", claim_field: "COMPANY_NAME", claim_value: "Acme", evidence_timestamp: "2026-01-02T05:30:00+05:30" }, options = { provider_key: "APPROVED_MANUAL_RESEARCH" };
  assert.equal(normalizeResearchEvidenceItem(input, options).evidence_timestamp, "2026-01-02T00:00:00.000Z");
  for (const evidence_timestamp of ["2026-02-30T00:00:00Z", "2026-01-02", "arbitrary", 123]) assert.throws(() => normalizeResearchEvidenceItem({ ...input, evidence_timestamp }, options));
  const f = await setup(t); await research(f.db, f.lead, { evidence_timestamp: "old-invalid" }); const assessment = await f.evaluate(); assert.equal(assessment.research[0].freshness, "INVALID_TIME"); assert.equal(assessment.research[0].usable, false);
});
test("new research invalidates old snapshot and distinct usable sources conflict without choosing a winner", async t => {
  const f = await setup(t); await f.save(interest()); const original = await f.service.runForLead(f.lead); await research(f.db, f.lead, { claim_field: "ENQUIRY_INTEREST", claim_value: "Chair" });
  const assessment = await f.evaluate(); assert.equal(assessment.facts.interest.value_state, "CONFLICTED"); assert.equal(assessment.research[0].value_state, "CONFLICTED"); assert.equal(assessment.research[0].usable, false);
  const current = await f.service.assessLead(f.lead); assert.equal(current.currentness.state, "OUTDATED"); assert.ok(current.currentness.reasons.some(reason => reason.code === "SOURCES_CHANGED"));
  const refreshed = await f.service.runForLead(f.lead); assert.notEqual(refreshed.id, original.id); assert.ok(!refreshed.claims.some(claim => claim.field === "ENQUIRY_INTEREST"));
});
test("failed domain command preserves only observed clock and keeps other workspace untouched", async t => {
  const f = await setup(t); await f.save(interest()); const policy = new ContactPolicyService(f.db);
  await assert.rejects(policy.withWorkspacePolicyTransaction("org", async tx => { await evaluateFreshness(tx, f.lead, { now: base + FRESHNESS_TTL_MS }); await tx.run("UPDATE leads SET name='Should roll back' WHERE id=?", [f.lead.id]); throw new Error("Synthetic rejected authority"); }), /Synthetic rejected/);
  assert.equal((await new LeadsRepository(f.db).getLead(f.lead.id)).name, "Synthetic"); assert.equal((await f.evaluate()).facts.interest.freshness, "STALE");
  assert.equal(await f.db.get("SELECT * FROM workspace_freshness_clocks WHERE organization_id='other'"), undefined);
});
test("corrupt persisted assessment or clock fails closed without creating refreshed evidence", async t => {
  const f = await setup(t); await f.save(interest()); const snapshot = await f.service.runForLead(f.lead);
  await f.db.run("UPDATE intelligence_snapshots SET freshness_json='{}' WHERE id=?", [snapshot.id]); await assert.rejects(f.service.assessLead(f.lead), { code: "FRESHNESS_STATE_INVALID" });
  assert.throws(() => parseFreshnessAssessment({ ...snapshot.freshness, authority_fingerprint: "f".repeat(64) }), { code: "FRESHNESS_STATE_INVALID" });
  await f.db.run("UPDATE workspace_freshness_clocks SET high_water_at=?", ["x".repeat(24)]); await assert.rejects(f.evaluate(), { code: "FRESHNESS_STATE_INVALID" });
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_snapshots")).n), 1);
});
test("research count and byte limits reject before materializing unsupported historical evidence", async t => {
  const f = await setup(t), first = await research(f.db, f.lead); let reads = 0; const original = f.db.all.bind(f.db); f.db.all = (sql, args) => { if (sql.includes("SELECT e.id")) reads++; return original(sql, args); };
  const repository = new ResearchEvidenceRepository(f.db); await f.db.run("UPDATE research_evidence_items SET metadata_json=? WHERE id=?", [JSON.stringify({ large: "x".repeat(524288) }), first.id]);
  await assert.rejects(repository.evidenceItemsForLead(f.lead.id, "org"), { code: "FRESHNESS_INPUT_LIMIT" }); assert.equal(reads, 0);
  await f.db.run("UPDATE research_evidence_items SET metadata_json='{}' WHERE id=?", [first.id]);
  for (let index = 0; index < 99; index++) await repository.createEvidenceItem({ ingestion_id: first.ingestion_id, organization_id: "org", lead_id: f.lead.id, source_type: "APPROVED_RESEARCH", title: "Source", claim_field: "COMPANY_NAME", claim_value: "Acme", confidence: "HIGH" });
  assert.equal((await repository.evidenceItemsForLead(f.lead.id, "org")).length, 100); reads = 0;
  await repository.createEvidenceItem({ ingestion_id: first.ingestion_id, organization_id: "org", lead_id: f.lead.id, source_type: "APPROVED_RESEARCH", title: "Source", claim_field: "COMPANY_NAME", claim_value: "Acme", confidence: "HIGH" });
  await assert.rejects(repository.evidenceItemsForLead(f.lead.id, "org"), { code: "FRESHNESS_INPUT_LIMIT" }); assert.equal(reads, 0);
});

test("historical dates without observation timestamps retain quoted history and a nonblocking age warning", async t => {
  const f = await setup(t), enquiry = emptyEnquiry(); enquiry.enquiry_date = known("2025-01-01", null); await f.save(enquiry);
  const result = await f.service.runForLead(f.lead), fact = result.freshness.facts.enquiry_date;
  assert.equal(fact.freshness, "HISTORICAL"); assert.equal(fact.observed_at, null); assert.equal(fact.usable, true); assert.deepEqual(fact.reasons, ["AGE_UNKNOWN"]); assert.ok(result.claims.some(claim => claim.field === "ENQUIRY_DATE"));
  assert.ok(!result.evidence.some(item => item.metadata.context_review_required));
});
test("source recording search refuses more than1000 revisions before evaluating JSON history", async t => {
  const f = await setup(t), enquiry = interest(); await f.save(enquiry);
  const json = JSON.stringify((await f.context.getEnquiry({ organization_id: "org", lead_id: f.lead.id })).enquiry);
  await f.db.transaction(async tx => { for (let revision = 2; revision <= 1001; revision++) await tx.run("INSERT INTO lead_enquiry_revisions(organization_id,lead_id,revision,schema_version,enquiry_json,reason,created_at,created_by) VALUES ('org',?, ?,1,?,'Historical full snapshot',?,'owner')", [f.lead.id, revision, json, new Date(base).toISOString()]); });
  await assert.rejects(f.evaluate(), { code: "FRESHNESS_INPUT_LIMIT" });
});
test("neutral revision0 history stays compatible and authoritative reads create no analysis or clock", async t => {
  const f = await setup(t), first = await f.service.runForLead(f.lead); assert.equal(first.freshness.policy_version, 0); assert.equal(first.freshness.authority_fingerprint, null);
  await f.db.run("UPDATE intelligence_snapshots SET freshness_json=NULL WHERE id=?", [first.id]); f.setTime(base + FRESHNESS_TTL_MS * 10);
  const read = await f.service.assessLead(f.lead); assert.equal(read.currentness.state, "CURRENT"); assert.equal(read.snapshot.id, first.id); assert.equal((await f.service.runForLead(f.lead)).id, first.id);
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM workspace_freshness_clocks")).n), 0); assert.equal(Number((await f.db.get("SELECT count(*) n FROM intelligence_snapshots")).n), 1);
});

test("historical future instants and impossible local dates stay unusable while plausible next-day dates remain historical", async t => {
  const f = await setup(t), recorded = Date.parse("2026-01-02T20:00:00Z"), enquiry = emptyEnquiry(); f.setTime(recorded);
  enquiry.enquiry_date = known("2026-01-03", null); enquiry.last_interaction = known("2026-01-02T20:00:01Z", null); await f.save(enquiry);
  let assessment = await f.evaluate(); assert.equal(assessment.facts.enquiry_date.freshness, "HISTORICAL"); assert.equal(assessment.facts.enquiry_date.usable, true); assert.equal(assessment.facts.last_interaction.freshness, "FUTURE_DATED");
  enquiry.enquiry_date = known("2026-01-04", null); await f.save(enquiry, 1); assessment = await f.evaluate(); assert.equal(assessment.facts.enquiry_date.freshness, "FUTURE_DATED"); assert.equal(assessment.facts.enquiry_date.usable, false);
  f.setTime(recorded + FRESHNESS_TTL_MS); assert.equal((await f.evaluate()).facts.enquiry_date.freshness, "FUTURE_DATED");
});
test("source recording search enforces aggregate8MiB even below revision count cap", async t => {
  const f = await setup(t), enquiry = interest(); await f.save(enquiry); const current = (await f.context.getEnquiry({ organization_id: "org", lead_id: f.lead.id })).enquiry, json = JSON.stringify(current).padEnd(32768, " ");
  await f.db.transaction(async tx => { for (let revision = 2; revision <= 257; revision++) await tx.run("INSERT INTO lead_enquiry_revisions(organization_id,lead_id,revision,schema_version,enquiry_json,reason,created_at,created_by) VALUES ('org',?, ?,1,?,'Historical source',?,'owner')", [f.lead.id, revision, json, new Date(base).toISOString()]); });
  await assert.rejects(f.evaluate(), error => error.code === "FRESHNESS_INPUT_LIMIT" && /8 MiB/.test(error.message));
});
test("new research count and byte overflow rejects before any ingestion or evidence writes", async t => {
  const f = await setup(t), service = new ResearchEvidenceService({ researchEvidenceRepository: new ResearchEvidenceRepository(f.db) });
  const item = { title: "Source", claim_field: "COMPANY_NAME", claim_value: "Acme", evidence_timestamp: new Date(base).toISOString() }, input = { lead: f.lead, provider_key: "APPROVED_MANUAL_RESEARCH", idempotency_key: "bounded-source" };
  await assert.rejects(service.ingestForLead({ ...input, evidence_items: Array(101).fill(item) }), { code: "FRESHNESS_INPUT_LIMIT" });
  await assert.rejects(service.ingestForLead({ ...input, evidence_items: [{ ...item, metadata: { large: "x".repeat(524288) } }] }), { code: "FRESHNESS_INPUT_LIMIT" });
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM research_evidence_ingestions")).n), 0);
  await service.ingestForLead({ ...input, evidence_items: Array(100).fill(item) });
  await assert.rejects(service.ingestForLead({ ...input, idempotency_key: "one-more", evidence_items: [item] }), { code: "FRESHNESS_INPUT_LIMIT" });
  assert.equal(Number((await f.db.get("SELECT count(*) n FROM research_evidence_items")).n), 100); assert.equal(Number((await f.db.get("SELECT count(*) n FROM research_evidence_ingestions")).n), 1);
});
test("file-backed restart cannot resurrect expired authority and repeated refresh retains one new snapshot", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "relay-freshness-owned-")), file = path.join(dir, "data.sqlite"); let first = new SqliteDatabaseClient(file), second;
  t.after(async () => { await first?.close(); await second?.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await runMigrations(first); await first.run("INSERT INTO organizations(id,name,created_at) VALUES ('org','Synthetic',?)", [new Date(base).toISOString()]); await first.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES ('owner','org','Owner','owner@example.test','OWNER',?)", [new Date(base).toISOString()]);
  const lead = await new LeadsRepository(first).createLead({ organization_id: "org", name: "Restart", email: "restart@example.test" });
  await new BusinessContextService(first, { now: () => base }).updateEnquiry({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, reason: "Original source", enquiry: interest() });
  const original = await new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(first), now: () => base }).runForLead(lead);
  await evaluateFreshness(first, lead, { now: base + FRESHNESS_TTL_MS }); await first.close(); first = null;
  second = new SqliteDatabaseClient(file); const service = new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(second), now: () => base });
  assert.equal((await service.assessLead(lead)).currentness.state, "OUTDATED"); const refreshed = await service.runForLead(lead); assert.notEqual(refreshed.id, original.id); assert.equal((await service.runForLead(lead)).id, refreshed.id);
  assert.equal(Number((await second.get("SELECT count(*) n FROM intelligence_snapshots")).n), 2); assert.equal(refreshed.freshness.facts.interest.freshness, "STALE");
});
