import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0009_business_context.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { loadLeadBusinessContext } from "../src/modules/business-context/businessContextRepository.js";
import { CURRENCY_SCALES, emptyEnquiry, emptyProfile, normalizeEnquiry, normalizeMoney, normalizeProfile } from "../src/modules/business-context/businessContextContract.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";

const STAMP = "2026-09-12T10:00:00.000Z";
const ACTOR = { id: "owner", role: "OWNER" };
const reason = "Customer context correction reviewed by owner";
const profile = () => ({ ...emptyProfile(), business_name: "Synthetic workshop", offerings: ["Custom furniture"], timezone: "Asia/Kolkata" });
const source = (assertion = "CUSTOMER_STATED") => ({ assertion, source_type: "MANUAL", source_reference: "Operator-transcribed customer conversation", observed_at: STAMP });
const known = value => ({ state: "KNOWN", value, provenance: source() });
const command = value => ({ organization_id: "org", actor: ACTOR, expected_revision: 0, reason, profile: value });
async function setup(t) {
  const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close());
  await runMigrations(db);
  for (const [org, actor, lead] of [["org", "owner", "lead"], ["other", "foreign-owner", "foreign-lead"]]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic " + org, STAMP]);
    await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,'OWNER',?)", [actor, org, "Synthetic", actor + "@example.test", "synthetic-hash", STAMP]);
    await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','OPTED_OUT',?,?)", [lead, org, "Synthetic enquiry", STAMP, STAMP]);
  }
  return { db, service: new BusinessContextService(db, { now: () => Date.parse(STAMP) }) };
}

test("business context starts unknown without inventing revisions or enquiries", async t => {
  const { db, service } = await setup(t);
  const context = await loadLeadBusinessContext(db, { organization_id: "org", lead_id: "lead" });
  assert.deepEqual(context.revisions, { profile_revision: 0, enquiry_revision: 0 });
  assert.deepEqual(context.profile.profile, emptyProfile());
  assert.deepEqual(context.enquiry.enquiry, emptyEnquiry());
  assert.equal(context.enquiry.created_at, null);
  assert.deepEqual(await service.enquiryHistory({ organization_id: "org", lead_id: "lead" }), { items: [], next_before_revision: null });
  assert.equal((await service.updateEnquiry({ organization_id: "org", lead_id: "lead", actor: ACTOR, expected_revision: 0, reason, enquiry: emptyEnquiry() })).revision, 0);
  assert.equal((await db.get("SELECT count(*) n FROM audit_logs")).n, 0);
});

test("profile updates append history, preserve exact actor/time and reuse identical normalized content", async t => {
  const { db, service } = await setup(t);
  const first = await service.updateProfile(command(profile()));
  assert.equal(first.revision, 1); assert.equal(first.created_by, ACTOR.id); assert.equal(first.created_at, STAMP);
  const same = await service.updateProfile({ ...command({ ...profile(), business_name: "  Synthetic workshop  " }), expected_revision: 1, reason: "Unchanged normalized content" });
  assert.deepEqual(same, first);
  const next = await service.updateProfile({ ...command({ ...profile(), offerings: ["Custom furniture", "Restoration"] }), expected_revision: 1 });
  assert.equal(next.revision, 2);
  assert.equal((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessProfileUpdated'")).n, 2);
  const history = await service.profileHistory({ organization_id: "org", limit: 1 });
  assert.equal(history.items[0].revision, 2); assert.equal(history.next_before_revision, 2);
  const older = await service.profileHistory({ organization_id: "org", before_revision: 2, limit: 1 });
  assert.deepEqual(older.items[0], first); assert.equal(older.next_before_revision, null);
});

test("competing expected revisions admit one correction and stale retries cannot append or change audits", async t => {
  const { db, service } = await setup(t);
  const outcomes = await Promise.allSettled([service.updateProfile(command(profile())), service.updateProfile(command({ ...profile(), business_name: "Other reviewed name" }))]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(item => item.status === "rejected").reason.code, "BUSINESS_CONTEXT_STALE");
  await assert.rejects(service.updateProfile(command(profile())), { code: "BUSINESS_CONTEXT_STALE", statusCode: 409 });
  assert.equal((await db.get("SELECT count(*) n FROM business_profile_revisions")).n, 1);
  assert.equal((await db.get("SELECT count(*) n FROM audit_logs")).n, 1);
});

test("profile and enquiry writes require a current same-workspace owner and exact server command", async t => {
  const { db, service } = await setup(t);
  for (const actor of [{ id: "foreign-owner", role: "OWNER" }, { id: "missing", role: "OWNER" }, { id: "owner", role: "MEMBER" }]) await assert.rejects(service.updateProfile({ ...command(profile()), actor }), { code: "BUSINESS_CONTEXT_OWNER_REQUIRED", statusCode: 403 });
  await db.run("UPDATE users SET role='MEMBER' WHERE id='owner'");
  await assert.rejects(service.updateProfile(command(profile())), { statusCode: 403 });
  await db.run("UPDATE users SET role='OWNER' WHERE id='owner'");
  await assert.rejects(service.updateProfile({ ...command(profile()), user_id: "owner" }), { code: "INVALID_BUSINESS_CONTEXT" });
  await assert.rejects(service.updateProfile({ ...command(profile()), actor: { ...ACTOR, organization_id: "other" } }), { code: "INVALID_BUSINESS_CONTEXT" });
  for (const call of [() => service.getEnquiry({ organization_id: "org", lead_id: "foreign-lead" }), () => service.enquiryHistory({ organization_id: "org", lead_id: "foreign-lead" }), () => loadLeadBusinessContext(db, { organization_id: "org", lead_id: "foreign-lead" }), () => service.updateEnquiry({ organization_id: "org", lead_id: "foreign-lead", actor: ACTOR, expected_revision: 0, reason, enquiry: { ...emptyEnquiry(), interest: known("A chair") } })]) await assert.rejects(call(), { statusCode: 404 });
  assert.equal((await db.get("SELECT count(*) n FROM business_profile_revisions")).n, 0);
  assert.equal((await db.get("SELECT count(*) n FROM lead_enquiry_revisions")).n, 0);
});

test("audit failure rolls revision append back while preserving contact policy and other lead history", async t => {
  const { db, service } = await setup(t);
  const leadBefore = await db.get("SELECT * FROM leads WHERE id='lead'");
  await db.exec("CREATE TRIGGER reject_context_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  await assert.rejects(service.updateProfile(command(profile())), /synthetic audit failure/);
  await assert.rejects(service.updateEnquiry({ organization_id: "org", lead_id: "lead", actor: ACTOR, expected_revision: 0, reason, enquiry: { ...emptyEnquiry(), interest: known("A table") } }), /synthetic audit failure/);
  assert.equal((await service.getProfile({ organization_id: "org" })).revision, 0);
  assert.equal((await service.getEnquiry({ organization_id: "org", lead_id: "lead" })).revision, 0);
  assert.deepEqual(await db.get("SELECT * FROM leads WHERE id='lead'"), leadBefore);
  await db.exec("DROP TRIGGER reject_context_audit");
  await service.updateEnquiry({ organization_id: "org", lead_id: "lead", actor: ACTOR, expected_revision: 0, reason, enquiry: { ...emptyEnquiry(), interest: known("A table") } });
  assert.deepEqual(await db.get("SELECT * FROM leads WHERE id='lead'"), leadBefore);
});

test("enquiry stores distinct known, unknown, inferred and conflicting facts with immutable source history", async t => {
  const { db, service } = await setup(t), enquiry = emptyEnquiry();
  enquiry.interest = known("A dining table");
  enquiry.interest.provenance.observed_at = "2026-09-12T15:30:00+05:30";
  enquiry.location = { ...known({ locality: "Pune", country_code: "IN" }), provenance: { ...source("INFERRED"), observed_at: null } };
  enquiry.budget = known({ currency: "INR", minimum: "9007199254740993.01", maximum: "9007199254740993.09" });
  enquiry.timeline = { state: "CONFLICTED", alternatives: [{ value: { description: "Before winter", target_date: "2026-11-01" }, provenance: source() }, { value: { description: "Next spring", target_date: "2027-03-01" }, provenance: source("OPERATOR_OBSERVED") }] };
  enquiry.enquiry_date = known("2024-02-29");
  enquiry.last_interaction = known("2026-09-12T15:30:00+05:30");
  const saved = await service.updateEnquiry({ organization_id: "org", lead_id: "lead", actor: ACTOR, expected_revision: 0, reason, enquiry });
  assert.equal(saved.enquiry.budget.value.minimum_minor, "900719925474099301");
  assert.equal(saved.enquiry.last_interaction.value, STAMP);
  assert.equal(saved.enquiry.interest.provenance.observed_at, STAMP);
  assert.equal(saved.enquiry.location.provenance.assertion, "INFERRED");
  assert.equal(saved.enquiry.timeline.alternatives.length, 2);
  const corrected = await service.updateEnquiry({ organization_id: "org", lead_id: "lead", actor: ACTOR, expected_revision: 1, reason, enquiry: { ...saved.enquiry, interest: known("Two chairs") } });
  assert.equal(corrected.revision, 2);
  const history = await service.enquiryHistory({ organization_id: "org", lead_id: "lead", before_revision: 2 });
  assert.deepEqual(history.items[0], saved);
  await new ContactPolicyService(db).withWorkspacePolicyTransaction("org", async tx => assert.equal((await loadLeadBusinessContext(tx, { organization_id: "org", lead_id: "lead" })).revisions.enquiry_revision, 2));
});

test("exact money supports configured zero, two and three decimal currencies without floating point", () => {
  for (const [currency, scale] of Object.entries(CURRENCY_SCALES)) {
    const money = normalizeMoney({ currency, minimum: scale ? "0." + "0".repeat(scale) : "0", maximum: scale ? "9007199254740993." + "1".repeat(scale) : "9007199254740993" });
    assert.equal(money.minimum_minor, "0"); assert.equal(money.scale, scale);
    assert.equal(money.maximum_minor, "9007199254740993" + "1".repeat(scale));
    assert.deepEqual(normalizeMoney(money), money);
  }
  assert.equal(normalizeMoney({ currency: "INR", minimum: "9999999999999999999999.99", maximum: "9999999999999999999999.99" }).minimum_minor, "9".repeat(24));
});

test("money rejects floating numbers, excess precision, unsupported or forged scale and malformed ranges", () => {
  const base = { currency: "INR", minimum: "1", maximum: "2" };
  for (const patch of [{ minimum: 0.1 }, { minimum: "1e2" }, { minimum: "-0" }, { minimum: "+1" }, { minimum: "01" }, { minimum: "1,000" }, { minimum: "1.001" }, { minimum: "3" }, { maximum: "9".repeat(25) }, { currency: "ZZZ" }, { currency: "JPY", minimum: "0.1" }, { minimum: "1\u0000" }]) assert.throws(() => normalizeMoney({ ...base, ...patch }), { code: "INVALID_BUSINESS_CONTEXT" });
  for (const patch of [{ scale: 3 }, { minimum_minor: "01" }, { minimum_minor: "1.2" }, { maximum_minor: 4 }]) assert.throws(() => normalizeMoney({ currency: "INR", scale: 2, minimum_minor: "0", maximum_minor: "200", ...patch }), { code: "INVALID_BUSINESS_CONTEXT" });
});

test("strict enquiry dates, provenance and shapes reject fabricated or ambiguous records", () => {
  for (const [field, value] of [["enquiry_date", "2025-02-29"], ["enquiry_date", "2026-04-31"], ["enquiry_date", "12/09/2026"], ["enquiry_date", "0000-01-01"], ["last_interaction", "2026-02-30T10:00:00Z"], ["last_interaction", "2026-09-12T10:00:00"], ["last_interaction", "2026-09-12T24:00:00Z"], ["last_interaction", "2026-09-12T10:00:00+24:00"], ["location", { locality: "Pune", country_code: "in" }], ["timeline", { description: "Soon", target_date: "2026-02-30" }]]) assert.throws(() => normalizeEnquiry({ ...emptyEnquiry(), [field]: known(value) }), { code: "INVALID_BUSINESS_CONTEXT" });
  for (const fact of [{ state: "UNKNOWN", value: 0, provenance: null }, { state: "KNOWN", value: "A chair", provenance: { ...source(), observed_at: "2026-02-30T10:00:00Z" } }, { state: "KNOWN", value: "A chair", provenance: { ...source(), source_type: "IMPORT_ROW" } }, { state: "KNOWN", value: "A chair", provenance: { ...source(), actor: "spoof" } }, { state: "CONFLICTED", alternatives: [{ value: "A chair", provenance: source() }, { value: " A chair ", provenance: source("INFERRED") }] }, { state: "CONFLICTED", alternatives: [{ value: "A chair", provenance: source() }] }]) assert.throws(() => normalizeEnquiry({ ...emptyEnquiry(), interest: fact }), { code: "INVALID_BUSINESS_CONTEXT" });
  assert.throws(() => normalizeEnquiry({ ...emptyEnquiry(), contact_permission: true }), { code: "INVALID_BUSINESS_CONTEXT" });
});

test("profile schema, control characters, timezone and snapshot bytes are bounded", () => {
  for (const patch of [{ business_name: "" }, { offerings: [] }, { offerings: ["Chair", " Chair "] }, { offerings: ["\u0000hidden"] }, { timezone: "Asia/NotAPlace" }, { timezone: "+05:30" }, { required_criteria: "anything" }, { language: 42 }, { business_name: "x".repeat(201) }, { offerings: Array.from({ length: 21 }, (_, index) => "Offering " + index) }, { executable_policy: true }]) assert.throws(() => normalizeProfile({ ...profile(), ...patch }), { code: "INVALID_BUSINESS_CONTEXT" });
  const large = profile();
  for (const key of ["offerings", "service_areas", "target_customers", "exclusions", "required_criteria", "preferred_criteria"]) large[key] = Array.from({ length: 20 }, (_, index) => index + "x".repeat(498));
  assert.throws(() => normalizeProfile(large), /32 KiB/);
  const unicode = { ...large, offerings: Array.from({ length: 20 }, (_, index) => index + "\u20ac".repeat(498)) };
  assert.throws(() => normalizeProfile(unicode), /32 KiB/);
});

test("history bounds and corrupt persisted context fail closed", async t => {
  const { db, service } = await setup(t);
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { before_revision: 0 }, { before_revision: "2" }]) await assert.rejects(service.profileHistory({ organization_id: "org", ...options }), { code: "INVALID_BUSINESS_CONTEXT" });
  await service.updateProfile(command(profile()));
  await db.run("UPDATE business_profile_revisions SET profile_json='{}' WHERE organization_id='org'");
  await assert.rejects(service.getProfile({ organization_id: "org" }), { code: "BUSINESS_CONTEXT_INVALID", statusCode: 503 });
  await assert.rejects(service.updateProfile({ ...command(profile()), expected_revision: 1 }), { code: "BUSINESS_CONTEXT_INVALID" });
});

test("source observation offsets normalize to UTC while unknown and invalid dates stay explicit", () => {
  for (const observed_at of ["2026-09-12T15:30:00+05:30", "2026-09-12T06:00:00-04:00", "2026-09-12T10:00:00Z", STAMP]) {
    const normalized = normalizeEnquiry({ ...emptyEnquiry(), interest: { ...known("A chair"), provenance: { ...source(), observed_at } } });
    assert.equal(normalized.interest.provenance.observed_at, STAMP);
    assert.deepEqual(normalizeEnquiry(normalized), normalized);
  }
  const unknown = normalizeEnquiry({ ...emptyEnquiry(), interest: { ...known("A chair"), provenance: { ...source(), observed_at: null } } });
  assert.equal(unknown.interest.provenance.observed_at, null);
  for (const observed_at of ["2026-02-30T10:00:00+05:30", "2025-02-29T10:00:00Z", "2026-09-12T10:00:00", "2026-09-12", "2026-09-12T24:00:00Z", "2026-09-12T10:00:00+24:00"]) {
    assert.throws(() => normalizeEnquiry({ ...emptyEnquiry(), interest: { ...known("A chair"), provenance: { ...source(), observed_at } } }), { code: "INVALID_BUSINESS_CONTEXT" });
  }
});
