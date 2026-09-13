import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startClient } from "./helpers/testClient.js";
import { loadConfig } from "../src/config.js";
import { emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";

const raw = (client, method, path, body) => client.rawFetch(path, {
  method, headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const count = async (client, table) => Number((await client.db.get("SELECT count(*) n FROM " + table)).n);
async function fixture(t) {
  const config = loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: "false", WORKER_ENABLED: "false" });
  const client = await startClient(t, ":memory:", { config });
  return { client, ...await client.register("Contactless enquiry HTTP") };
}
const fact = value => ({ state: "KNOWN", value, provenance: {
  assertion: "CUSTOMER_STATED", source_type: "MANUAL", source_reference: "Synthetic recorded customer enquiry",
  observed_at: new Date(Date.now() - 1000).toISOString()
} });
const compose = review_token => ({ request_key: randomUUID(), review_token, acknowledge_pending: false,
  reason: "Owner prepared a question using the subsequently confirmed contact",
  kind: "NEW_MESSAGE", reply_to_message_id: null, subject: "Your desk enquiry",
  body: "Which desk dimensions would suit your space?", scheduled_at: null
});

test("name-only HTTP enquiry supports current intelligence, then audited contact addition and exact approved Sandbox outreach", async t => {
  const { client, user } = await fixture(t);
  const lead = (await client.post("/api/leads", { name: "Synthetic desk enquiry" })).lead;
  assert.equal(lead.email, null);
  assert.equal(lead.phone, null);
  assert.equal(lead.company, null);
  const path = "/api/leads/" + lead.id;
  assert.equal((await client.get(path + "/intelligence")).currentness.state, "NEVER_ANALYSED");
  const enquiry = { ...emptyEnquiry(), interest: fact("Custom desks"),
    location: fact({ locality: "Pune", country_code: "IN" }),
    budget: fact({ currency: "INR", minimum: "100000.10", maximum: "150000.20" }) };
  await client.put(path + "/enquiry-context", { expected_revision: 0, reason: "Record requirements before contact details are known", enquiry });
  const source = await client.get(path + "/enquiry-context");
  assert.equal(source.enquiry.interest.value, "Custom desks");
  assert.deepEqual(source.enquiry.budget.value, { currency: "INR", scale: 2, minimum_minor: "10000010", maximum_minor: "15000020" });
  const run = await client.post("/api/intelligence/bulk-run", { lead_ids: [lead.id], request_key: randomUUID() });
  assert.equal(run.succeeded, 1, JSON.stringify(run));
  assert.equal(run.results[0].status, "COMPLETED");
  const current = await client.get(path + "/intelligence");
  assert.equal(current.currentness.state, "CURRENT");
  assert.ok(current.intelligence.claims.some(claim => claim.field === "ENQUIRY_INTEREST"));
  assert.ok(current.recommendation);
  assert.equal(await count(client, "ai_provider_attempts"), 0);
  assert.equal(await count(client, "action_executions"), 0);
  assert.equal(Number((await client.db.get("SELECT count(*) n FROM actions WHERE type='SEND_EMAIL'")).n), 0);

  const unavailable = await client.get(path + "/composer");
  assert.equal(unavailable.can_create, false);
  assert.equal(unavailable.unavailable_reason, "RECIPIENT_UNAVAILABLE");
  assert.equal(unavailable.recipient, null);
  assert.equal(unavailable.review_token, null);
  assert.equal((await raw(client, "POST", path + "/composer", compose("0".repeat(64)))).status, 409);
  assert.equal((await raw(client, "POST", path + "/actions", { type: "SEND_EMAIL" })).status, 409);
  assert.equal(await count(client, "action_composer_commands"), 0);
  assert.equal(await count(client, "action_executions"), 0);

  const correction = { expected_revision: 0, values: { name: lead.name, email: "Added@Example.test", phone: null, company: null }, default_phone_region: "INTERNATIONAL_ONLY" };
  const preview = await client.post(path + "/data/preview", correction);
  assert.equal(preview.can_save, true);
  const saved = await client.put(path + "/data", { ...correction, review_token: preview.review_token, reason: "Owner confirmed contact details supplied later" });
  assert.equal(saved.current.data_revision, 1);
  assert.equal(saved.change.kind, "CORRECT");
  assert.equal(saved.change.created_by, user.id);
  assert.equal(saved.change.before.values.email, null);
  assert.equal(saved.change.after.values.email, "added@example.test");
  assert.equal(saved.current.field_provenance.email.change_id, saved.change.id);
  assert.deepEqual((await client.get(path + "/enquiry-context")).enquiry, source.enquiry);
  assert.equal((await client.get(path + "/intelligence")).currentness.state, "OUTDATED");
  assert.equal((await client.post("/api/intelligence/bulk-run", { lead_ids: [lead.id], request_key: randomUUID() })).succeeded, 1);
  assert.equal((await client.get(path + "/intelligence")).currentness.state, "CURRENT");

  const available = await client.get(path + "/composer");
  assert.equal(available.can_create, true);
  assert.equal(available.recipient, "added@example.test");
  const command = { ...compose(available.review_token), acknowledge_pending: available.pending_total > 0 };
  const draft = await client.post(path + "/composer", command);
  assert.equal(draft.prepared_revision.envelope.recipient, "added@example.test");
  assert.equal(draft.prepared_revision.envelope.body, command.body);
  const actionPath = "/api/actions/" + draft.command.action_id;
  assert.equal((await client.services.actionsRepository.getAction(draft.command.action_id)).approval_requirement, "REQUIRED");
  assert.equal((await raw(client, "POST", actionPath + "/execute", {})).status, 409);
  assert.equal((await raw(client, "POST", actionPath + "/approval/approve", { expected_revision_id: "unreviewed-revision" })).status, 409);
  assert.equal(await count(client, "action_executions"), 0);
  const review = await client.get(actionPath + "/approval");
  assert.equal(review.prepared_revision.id, draft.prepared_revision.id);
  await client.post(actionPath + "/approval/approve", { expected_revision_id: review.prepared_revision.id });
  assert.equal(await count(client, "action_executions"), 0, "Approval records consent without sending");

  // Exercise the installed Sandbox path, with an assertion before adapter invocation that prevents a live provider.
  const adapter = client.services.actionExecutor.adapter;
  let sends = 0;
  client.services.actionExecutor.adapter = { async invoke(action, payload, attempt, context) {
    assert.equal(context.approvedDispatch.envelope.sender.provider, "sandbox");
    assert.equal(context.approvedDispatch.envelope.recipient, "added@example.test");
    assert.equal(context.approvedDispatch.envelope.body, command.body);
    sends++;
    return adapter.invoke(action, payload, attempt, context);
  } };
  await client.post(actionPath + "/execute", {});
  assert.equal(sends, 1);
  assert.equal(await count(client, "action_executions"), 1);
  assert.equal(await count(client, "ai_provider_attempts"), 0);
});

test("HTTP optional contact forms preserve unknown values and canonicalize actual supplied contact identities", async t => {
  const { client } = await fixture(t);
  for (const contacts of [{}, { email: null, phone: null }, { email: "", phone: "" }, { email: "   ", phone: "   " }]) {
    const lead = (await client.post("/api/leads", { name: "Unknown contacts", ...contacts })).lead;
    assert.equal(lead.email, null);
    assert.equal(lead.phone, null);
    assert.equal(lead.normalized_email, null);
    assert.equal(lead.normalized_phone, null);
  }
  const bounded = (await client.post("/api/leads", { name: "N".repeat(200), company: "C".repeat(200) })).lead;
  assert.equal(bounded.name.length, 200);
  assert.equal(bounded.company.length, 200);
  const supplied = (await client.post("/api/leads", { name: "Known contact", email: "  Known@Example.test  ", phone: "+91 98765 43210" })).lead;
  assert.equal(supplied.normalized_email, "known@example.test");
  assert.equal(supplied.normalized_phone, "+919876543210");
  assert.equal(await count(client, "action_executions"), 0);
});

test("HTTP invalid supplied contacts, field types, control characters and bounds fail atomically", async t => {
  const { client } = await fixture(t);
  const invalid = [
    { name: null }, { name: 10 }, { name: [] }, { name: {} }, { name: true }, { name: " " }, { name: "N".repeat(201) },
    { company: 10 }, { company: [] }, { company: {} }, { company: false }, { company: "C".repeat(201) },
    { email: 10 }, { email: [] }, { email: {} }, { email: false }, { email: "missing-at.example.test" }, { email: "a@b" }, { email: "a @example.test" },
    { email: "x".repeat(308) + "@example.test" },
    { phone: 10 }, { phone: [] }, { phone: {} }, { phone: false }, { phone: "not-a-phone" }, { phone: "9876543210" }, { phone: "+" }, { phone: "+" + "1".repeat(80) },
    { source: "UNSUPPORTED_SOURCE" }
  ];
  for (const control of ["\n", "\r", "\t", "\u0000", "\u0085"]) {
    for (const field of ["name", "company", "email", "phone"]) {
      invalid.push({ [field]: (field === "email" ? "a@example.test" : field === "phone" ? "+919876543210" : "Synthetic") + control });
    }
  }
  const tables = ["leads", "domain_events", "audit_logs", "action_executions"];
  const before = await Promise.all(tables.map(table => count(client, table)));
  for (const values of invalid) {
    const response = await raw(client, "POST", "/api/leads", { name: "Synthetic invalid request", ...values });
    assert.equal(response.status, 400, "Rejected fields: " + JSON.stringify(values) + "; " + await response.text());
  }
  assert.deepEqual(await Promise.all(tables.map(table => count(client, table))), before);
});

test("HTTP contactless capture and later context/correction cannot cross the authenticated workspace", async t => {
  const { client, organization } = await fixture(t);
  const lead = (await client.post("/api/leads", { name: "Original private enquiry" })).lead;
  const other = await client.register("Other contactless workspace");
  const owned = (await client.post("/api/leads", { name: "Other owned enquiry", organization_id: organization.id })).lead;
  assert.equal(owned.organization_id, other.organization.id);
  const path = "/api/leads/" + lead.id;
  for (const suffix of ["", "/enquiry-context", "/data", "/composer", "/intelligence"]) {
    assert.equal((await raw(client, "GET", path + suffix + "?organization_id=" + organization.id)).status, 404);
  }
  assert.equal((await raw(client, "PUT", path + "/enquiry-context", { organization_id: organization.id, expected_revision: 0, reason: "Foreign context attempt", enquiry: emptyEnquiry() })).status, 400);
  assert.equal((await raw(client, "PUT", path + "/enquiry-context", { expected_revision: 0, reason: "Foreign context attempt", enquiry: emptyEnquiry() })).status, 404);
  assert.equal((await raw(client, "POST", path + "/data/preview", { organization_id: organization.id, expected_revision: 0, values: { name: lead.name, email: "foreign@example.test", phone: null, company: null }, default_phone_region: "INTERNATIONAL_ONLY" })).status, 404);
  assert.equal((await raw(client, "POST", path + "/composer", { ...compose("0".repeat(64)), organization_id: organization.id })).status, 404);
  const bulk = await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, lead_ids: [lead.id], request_key: randomUUID() });
  assert.equal(bulk.succeeded, 0);
  assert.equal(bulk.failed, 1);
  assert.equal(bulk.results[0].code, "not_found");
  assert.equal((await client.db.get("SELECT email FROM leads WHERE id=?", [lead.id])).email, null);
  assert.equal(await count(client, "lead_data_changes"), 0);
  assert.equal(await count(client, "lead_enquiry_revisions"), 0);
  assert.equal(await count(client, "action_executions"), 0);
});
