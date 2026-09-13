import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { ContactPolicyService, assertWorkspaceTransaction } from "../src/modules/contact-policy/contactPolicyService.js";
import { canonicalContact, canonicalContactsForLead, recipientForLead } from "../src/modules/contact-policy/contactPolicyContract.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

async function fixture(t, db = null) {
  db ||= await createDatabase(":memory:");
  t.after(() => db.close());
  const leads = new LeadsRepository(db);
  const actions = new ActionsRepository(db);
  const followups = new FollowUpsRepository(db);
  const workflows = new WorkflowsRepository(db);
  const policy = new ContactPolicyService(db);
  const org = await leads.createOrganization({ name: "Policy fixture" });
  const foreign = await leads.createOrganization({ name: "Other policy fixture" });
  const lead = await leads.createLead({ organization_id: org.id, name: "Original", email: "Shared@Example.test", phone: "+91 98765 43210" });
  return { db, leads, actions, followups, workflows, policy, org, foreign, lead };
}

function input(f, overrides = {}) {
  return { organization_id: f.org.id, lead_id: f.lead.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "request-1", ...overrides };
}

async function action(f, lead = f.lead, type = "SEND_EMAIL", status = "PLANNED") {
  return f.actions.createAction({ organization_id: lead.organization_id, lead_id: lead.id, type, status,
    idempotency_key: lead.id + ":" + type + ":" + status });
}

async function inspect(f, lead = f.lead, channel = "EMAIL") {
  return f.policy.inspectLead({ organization_id: lead.organization_id, lead_id: lead.id, channel });
}

test("contact identity uses exact validated email and explicit international phone only", () => {
  assert.deepEqual(canonicalContact("EMAIL", " A+tag@Example.Test "), { kind: "EMAIL", value: "a+tag@example.test" });
  assert.equal(canonicalContact("EMAIL", "not-an-address"), null);
  assert.equal(canonicalContact("PHONE", "9876543210"), null);
  assert.equal(canonicalContact("PHONE", "+000123456789"), null);
  assert.deepEqual(canonicalContact("PHONE", "+91 (98765) 43210"), { kind: "PHONE", value: "+919876543210" });
  assert.equal(recipientForLead({ phone: "9876543210", normalized_phone: "9876543210" }, "SMS"), null);
  assert.deepEqual(recipientForLead({ id: "x", normalized_email: "invalid", email: " Valid@Example.test " }, "EMAIL"), { kind: "EMAIL", value: "valid@example.test" });
  assert.equal(canonicalContactsForLead({ id: "x", email: "a@example.test", normalized_email: "a@example.test" }).length, 2);
});

test("restriction guards refuse foreign leads, wrong workspace transactions and malformed inputs without writes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.policy.restrictLead(input(f, { organization_id: f.foreign.id })), { statusCode: 404 });
  await assert.rejects(f.policy.inspectLead({ organization_id: f.foreign.id, lead_id: f.lead.id, channel: "EMAIL" }), { statusCode: 404 });
  await assert.rejects(f.db.transaction((tx) => f.policy.restrictLeadInTransaction(tx, input(f))), /workspace transaction gate/);
  await assert.rejects(f.policy.withWorkspacePolicyTransaction(f.foreign.id, (tx) => f.policy.inspectLeadInTransaction(tx, { organization_id: f.org.id, lead_id: f.lead.id })), /workspace transaction gate/);
  for (const patch of [{ source_event_id: "" }, { reason: "ALLOW" }, { source: "UNVERIFIED" }, { channel: "FAX" }]) {
    await assert.rejects(f.policy.restrictLead(input(f, patch)), { statusCode: 400 });
  }
  await assert.rejects(f.policy.restrictContact(input(f, { contact: { kind: "PHONE", value: "9876543210" } })), { statusCode: 400 });
  await assert.rejects(f.policy.restrictContact(input(f, { channel: "EMAIL", contact: { kind: "PHONE", value: "+919876543210" } })), { statusCode: 400 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 0);
});

test("general opt-out covers exact duplicate channels without merging a contact graph", async (t) => {
  const f = await fixture(t);
  const emailDuplicate = await f.leads.createLead({ organization_id: f.org.id, name: "Separate enquiry", email: " shared@example.test ", phone: "+14155550123" });
  const phoneDuplicate = await f.leads.createLead({ organization_id: f.org.id, name: "Phone duplicate", email: "different@example.test", phone: "+91 (98765) 43210" });
  const transitive = await f.leads.createLead({ organization_id: f.org.id, name: "Unrelated person", email: "unrelated@example.test", phone: "+14155550123" });
  const foreign = await f.leads.createLead({ organization_id: f.foreign.id, name: "Other business", email: f.lead.email, phone: f.lead.phone });
  const duplicateSms = await action(f, emailDuplicate, "SEND_SMS");
  const duplicateEmail = await action(f, phoneDuplicate, "SEND_EMAIL");
  const unrelatedSms = await action(f, transitive, "SEND_SMS");
  const result = await f.policy.restrictLead(input(f));
  assert.equal(result.restrictions.length, 3);
  assert.equal((await f.actions.getAction(duplicateSms.id)).status, "BLOCKED");
  assert.equal((await f.actions.getAction(duplicateEmail.id)).status, "BLOCKED");
  assert.equal((await f.actions.getAction(unrelatedSms.id)).status, "PLANNED");
  assert.equal((await inspect(f)).restricted, true);
  assert.equal((await inspect(f, f.lead, "SMS")).restricted, true);
  assert.equal((await inspect(f, emailDuplicate)).restricted, true);
  assert.equal((await inspect(f, emailDuplicate, "SMS")).restricted, true);
  assert.equal((await inspect(f, phoneDuplicate, "SMS")).restricted, true);
  assert.equal((await inspect(f, phoneDuplicate)).restricted, true);
  assert.equal((await inspect(f, transitive, "SMS")).restricted, false);
  assert.equal((await inspect(f, foreign)).restricted, false);
});

test("provider contact restriction survives new import identities and does not require an existing lead", async (t) => {
  const f = await fixture(t);
  await f.policy.restrictContact(input(f, { lead_id: null, channel: "EMAIL", reason: "UNSUBSCRIBE", source: "PROVIDER_EVENT",
    contact: { kind: "EMAIL", value: "Future@Example.test" } }));
  const imported = await f.leads.createLead({ organization_id: f.org.id, name: "Imported again", email: " future@example.test ", phone: "+14155550123",
    source: "CSV", import_batch_id: "source-batch", import_row_id: "source-row" });
  assert.equal((await inspect(f, imported)).restricted, true);
  assert.equal((await inspect(f, imported, "SMS")).restricted, false);
  assert.equal((await f.leads.getLead(imported.id)).status, "NEW");
  assert.equal((await f.db.get("SELECT * FROM contact_restrictions")).reason, "UNSUBSCRIBE");
});

test("restriction cancels relevant queued work while preserving human work and in-flight/completed sends", async (t) => {
  const f = await fixture(t);
  const queued = await action(f);
  const inflight = await action(f, f.lead, "SEND_EMAIL", "EXECUTING");
  const completed = await action(f, f.lead, "SEND_EMAIL", "COMPLETED");
  const human = await action(f, f.lead, "CREATE_HUMAN_TASK");
  const sms = await action(f, f.lead, "SEND_SMS");
  const emailFollowup = await f.followups.create({ organization_id: f.org.id, lead_id: f.lead.id, channel: "EMAIL", status: "PLANNED", due_at: "2026-10-01", reason: "No response", idempotency_key: "email-followup" });
  const smsFollowup = await f.followups.create({ organization_id: f.org.id, lead_id: f.lead.id, channel: "SMS", status: "DUE", due_at: "2026-10-01", reason: "No response", idempotency_key: "sms-followup" });
  const campaign = await f.workflows.createCampaign({ organization_id: f.org.id, name: "Outbound" });
  const sequence = await f.workflows.createSequence({ organization_id: f.org.id, campaign_id: campaign.id, name: "Email flow", steps: [{ type: "SEND_EMAIL", channel: "EMAIL", title: "Review", body: "Hello", delay_hours: 0 }] });
  const run = await f.workflows.enrollLead({ organization_id: f.org.id, campaign_id: campaign.id, sequence_id: sequence.id, lead_id: f.lead.id, idempotency_key: "workflow" });
  const result = await f.policy.restrictContact(input(f, { channel: "EMAIL", reason: "COMPLAINT", source: "PROVIDER_EVENT", contact: { kind: "EMAIL", value: f.lead.email } }));
  assert.equal(result.blocked_actions, 1);
  assert.equal(result.cancelled_follow_ups, 1);
  assert.equal(result.stopped_workflows, 1);
  assert.equal((await f.actions.getAction(queued.id)).status, "BLOCKED");
  assert.equal((await f.actions.getAction(inflight.id)).status, "EXECUTING");
  assert.equal((await f.actions.getAction(completed.id)).status, "COMPLETED");
  assert.equal((await f.actions.getAction(human.id)).status, "PLANNED");
  assert.equal((await f.actions.getAction(sms.id)).status, "PLANNED");
  assert.equal((await f.followups.getForOrganization(emailFollowup.id, f.org.id)).status, "CANCELLED");
  assert.equal((await f.followups.getForOrganization(smsFollowup.id, f.org.id)).status, "DUE");
  assert.equal((await f.db.get("SELECT status FROM workflow_runs WHERE id = ?", [run.id])).status, "STOPPED");
});

test("compatible duplicate events repair queued work once without rewriting restriction provenance", async (t) => {
  const f = await fixture(t);
  const first = await f.policy.restrictLead(input(f));
  const inserted = await action(f);
  const repeated = await f.policy.restrictLead(input(f));
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.blocked_actions, 1);
  assert.deepEqual(repeated.restrictions.map((row) => row.id), first.restrictions.map((row) => row.id));
  assert.equal((await f.actions.getAction(inserted.id)).status, "BLOCKED");
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = 'ContactRestricted'")).n, 1);
  await assert.rejects(f.policy.restrictLead(input(f, { reason: "SUPPRESSED" })), { statusCode: 409 });
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 3);
});

test("policy state, queued cancellation and audit roll back as one unit", async (t) => {
  const f = await fixture(t);
  const queued = await action(f);
  await assert.rejects(f.policy.withWorkspacePolicyTransaction(f.org.id, async (tx) => {
    const independent = new ContactPolicyService(f.db);
    independent.assertWorkspaceTransaction(tx, f.org.id);
    await independent.restrictLeadInTransaction(tx, input(f));
    throw new Error("Fail after all policy effects");
  }), /Fail after all policy effects/);
  assert.equal((await f.actions.getAction(queued.id)).status, "PLANNED");
  assert.equal((await f.leads.getLead(f.lead.id)).status, "NEW");
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM audit_logs")).n, 0);
});

test("ordinary lifecycle writes cannot clear opt-out or weaken suppression", async (t) => {
  const f = await fixture(t);
  await f.policy.restrictLead(input(f));
  for (const status of ["ACTIVE", "NEW", "INTELLIGENCE_READY"]) {
    assert.equal((await f.leads.updateLeadStatus(f.lead.id, status)).status, "OPTED_OUT");
  }
  await f.leads.updateLeadStatus(f.lead.id, "SUPPRESSED");
  assert.equal((await f.leads.updateLeadStatus(f.lead.id, "OPTED_OUT")).status, "SUPPRESSED");
  assert.equal((await inspect(f)).restricted, true);
});

test("missing contact blocks dispatch inspection; unknown permission is not described as consent", async (t) => {
  const f = await fixture(t);
  const unknown = await f.leads.createLead({ organization_id: f.org.id, name: "Unknown contact", phone: "9876543210" });
  const denied = await inspect(f, unknown, "SMS");
  assert.equal(denied.restricted, true);
  assert.equal(denied.reason, "CONTACT_UNRESOLVED");
  assert.equal(denied.contact, null);
  const clean = await inspect(f);
  assert.equal(clean.restricted, false);
  assert.equal("consent" in clean, false);
  assert.equal("allowed" in clean, false);
});

test("workspace gate serializes suppression before authorization and rejects escaped contexts", async (t) => {
  const f = await fixture(t);
  let escaped;
  await f.policy.withWorkspacePolicyTransaction(f.org.id, async (tx) => {
    escaped = tx;
    assertWorkspaceTransaction(tx, f.org.id);
    await f.policy.restrictLeadInTransaction(tx, input(f));
  });
  assert.throws(() => assertWorkspaceTransaction(escaped, f.org.id), /workspace transaction gate/);
  const observed = await f.policy.withWorkspacePolicyTransaction(f.org.id, (tx) =>
    f.policy.inspectLeadInTransaction(tx, { organization_id: f.org.id, lead_id: f.lead.id, channel: "EMAIL" }));
  assert.equal(observed.restricted, true);
});

test("forward migration recovers overwritten opt-out and provider history without inventing a hard bounce", async (t) => {
  const db = await openDatabaseClient(":memory:");
  await runMigrations(db, { migrations: MIGRATIONS.slice(0, 2) });
  t.after(() => db.close());
  const org = await new LeadsRepository(db).createOrganization({ name: "Historical policy fixture" });
  // Seed the actual 0002 lead/action shape; current repositories require current columns.
  const legacyLead = async (name, email, phone = null) => {
    const id = "legacy-lead-" + name.toLowerCase();
    await db.run("INSERT INTO leads (id,organization_id,name,email,phone,normalized_email,normalized_phone,source,source_metadata_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'MANUAL\',\'{}\',\'NEW\',\'2026-01-01\',\'2026-01-01\')",
      [id, org.id, name, email, phone, canonicalContact("EMAIL", email)?.value || null, canonicalContact("PHONE", phone)?.value || null]);
    return db.get("SELECT * FROM leads WHERE id=?", [id]);
  };
  const f = { org, lead: await legacyLead("Original", "Shared@Example.test", "+91 98765 43210"),
    actions: new ActionsRepository(db), policy: new ContactPolicyService(db) };
  const legacyAction = async (lead, status) => {
    const id = "legacy-action-" + lead.id;
    await db.run("INSERT INTO actions (id, organization_id, lead_id, type, status, payload_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'SEND_EMAIL', ?, '{}', ?, '2026-01-01', '2026-01-01')",
      [id, f.org.id, lead.id, status, id]);
    return { id };
  };
  const queued = await legacyAction(f.lead, "PLANNED");
  await db.run("INSERT INTO inbound_events (id,organization_id,lead_id,channel,provider,provider_event_id,event_type,payload_json,received_at,created_at) VALUES ('historical-optout',?,?, 'EMAIL','sendgrid','historical-event','OPT_OUT','{}','2026-01-01','2026-01-01')", [f.org.id,f.lead.id]);
  await db.run("UPDATE leads SET status = 'ACTIVE' WHERE id = ?", [f.lead.id]);
  const complaintLead = await legacyLead("Complaint", "complaint@example.test");
  const complaintAction = await legacyAction(complaintLead, "COMPLETED");
  await db.run("INSERT INTO callbacks (id,action_id,provider_event_id,payload_json,received_at,organization_id,lead_id) VALUES ('historical-bounce',?,'bounce-event',?,'2026-01-01',?,?)",
    [complaintAction.id, JSON.stringify({ details: { reason: "bounce" } }),f.org.id,complaintLead.id]);
  await db.run("INSERT INTO audit_logs (id,organization_id,lead_id,action_id,event_type,message,metadata_json,created_at) VALUES ('historical-unsubscribe',?,?,?,'EmailTrackingEvent','Provider record',?,'2026-01-01')",
    [f.org.id,complaintLead.id,complaintAction.id,JSON.stringify({event:"group_unsubscribe"})]);
  await runMigrations(db);
  assert.equal((await inspect(f)).restricted, true);
  assert.equal((await f.actions.getAction(queued.id)).status, "BLOCKED");
  assert.equal((await f.actions.getAction(complaintAction.id)).status, "COMPLETED");
  const reasons = (await db.all("SELECT DISTINCT reason FROM contact_restrictions WHERE lead_id = ?", [complaintLead.id])).map((row) => row.reason).sort();
  assert.deepEqual(reasons, ["DELIVERY_REVIEW", "UNSUBSCRIBE"]);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM contact_restrictions WHERE source = 'LEGACY_INBOUND'")).n, 3);
  assert.deepEqual(await runMigrations(db), []);
});

test("restrictions persist after database restart and affect a newly created duplicate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-policy-"));
  const file = path.join(directory, "isolated.sqlite");
  let db;
  try {
    db = await createDatabase(file);
    const leads = new LeadsRepository(db);
    const org = await leads.createOrganization({name:"Durable policy"});
    const lead = await leads.createLead({organization_id:org.id,name:"Before restart",email:"durable@example.test"});
    await new ContactPolicyService(db).restrictLead({organization_id:org.id,lead_id:lead.id,reason:"OPT_OUT",source:"MANUAL",source_event_id:"durable-optout"});
    await db.close();
    db = await openDatabaseClient(file);
    const duplicate = await new LeadsRepository(db).createLead({organization_id:org.id,name:"After restart",email:"DURABLE@example.test"});
    assert.equal((await new ContactPolicyService(db).inspectLead({organization_id:org.id,lead_id:duplicate.id,channel:"EMAIL"})).restricted,true);
  } finally {
    if(db)await db.close();
    await rm(directory,{recursive:true,force:true});
  }
});

test("independent SQLite connections preserve the authorization-before-suppression boundary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lead-policy-race-"));
  const file = path.join(directory, "isolated.sqlite");
  let first, second;
  try {
    first = await createDatabase(file);
    second = await openDatabaseClient(file);
    const leads = new LeadsRepository(first);
    const org = await leads.createOrganization({ name: "SQLite policy ordering" });
    const lead = await leads.createLead({ organization_id: org.id, name: "In flight", email: "flight@example.test" });
    const actions = new ActionsRepository(first);
    const send = await actions.createAction({ organization_id: org.id, lead_id: lead.id, type: "SEND_EMAIL", status: "APPROVED", idempotency_key: "inflight-policy" });
    const one = new ContactPolicyService(first), two = new ContactPolicyService(second);
    let release, entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const ready = new Promise((resolve) => { entered = resolve; });
    const authorize = one.withWorkspacePolicyTransaction(org.id, async (tx) => {
      const eligibility = await one.inspectLeadInTransaction(tx, { organization_id: org.id, lead_id: lead.id, channel: "EMAIL" });
      assert.equal(eligibility.restricted, false);
      await tx.run("UPDATE actions SET status = 'EXECUTING' WHERE id = ?", [send.id]);
      entered();
      await gate;
    });
    await ready;
    const suppress = two.restrictLead({ organization_id: org.id, lead_id: lead.id, reason: "OPT_OUT", source: "MANUAL", source_event_id: "during-flight" });
    release();
    await Promise.all([authorize, suppress]);
    assert.equal((await actions.getAction(send.id)).status, "EXECUTING");
    const after = await one.withWorkspacePolicyTransaction(org.id, (tx) => one.inspectLeadInTransaction(tx, { organization_id: org.id, lead_id: lead.id, channel: "EMAIL" }));
    assert.equal(after.restricted, true);
  } finally {
    if (second) await second.close();
    if (first) await first.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const pgContext = postgresTestContext();
const pgSkip = pgContext ? false : "Requires explicit disposable PostgreSQL test target";

test("postgres contact policy: independent connections serialize suppression and dispatch authorization", {skip:pgSkip}, async () => {
  const schema=schemaFor(pgContext.runId,"adapter");
  const admin=await connectTestAdmin(pgContext);
  let first,second;
  try{
    await admin.exec('CREATE SCHEMA "'+schema+'"');
    const config=schemaDatabaseConfig(pgContext,schema);
    first=await createDatabase(config);
    second=await openDatabaseClient(config);
    const leads=new LeadsRepository(first);
    const org=await leads.createOrganization({name:"Postgres policy race"});
    const lead=await leads.createLead({organization_id:org.id,name:"Race",email:"race@example.test"});
    const one=new ContactPolicyService(first),two=new ContactPolicyService(second);
    let release,entered;
    const gate=new Promise(resolve=>{release=resolve;});
    const ready=new Promise(resolve=>{entered=resolve;});
    const restriction=one.withWorkspacePolicyTransaction(org.id,async(tx)=>{
      await one.restrictLeadInTransaction(tx,{organization_id:org.id,lead_id:lead.id,source:"MANUAL",source_event_id:"race",reason:"OPT_OUT"});
      entered();
      await gate;
    });
    await ready;
    const inspection=two.withWorkspacePolicyTransaction(org.id,tx=>two.inspectLeadInTransaction(tx,{organization_id:org.id,lead_id:lead.id,channel:"EMAIL"}));
    release();
    await restriction;
    assert.equal((await inspection).restricted,true);
  }finally{
    if(second)await second.close();
    if(first)await first.close();
    await admin.exec('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
    await admin.close();
  }
});
