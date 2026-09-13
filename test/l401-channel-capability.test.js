import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { configureChannelRuntime, channelRuntimeFor, assessChannelCapability, requireChannelCapability } from "../src/modules/channels/channelCapability.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { SettingsRepository } from "../src/modules/settings/settingsRepository.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { PREPARED_POLICY_VERSION, fingerprint } from "../src/modules/outbound-automation/preparedActionContract.js";
import { ChannelRouter } from "../src/modules/handlers/channelRouter.js";
import { EmailAdapter } from "../src/modules/handlers/emailAdapter.js";
import { approveStoredAction } from "./helpers/review.js";
import { callbackFixture } from "./helpers/callbackFixture.js";

const publicKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
const completeEmail = Object.freeze({ provider: "sendgrid", from_email: "Sender@Example.test", reply_to: "Replies@Example.test",
  api_key: "synthetic-not-a-provider-credential", sendgrid_events_public_key: publicKey(), sendgrid_inbound_public_key: publicKey(), connection_revision: 1, webhook_token: "synthetic-route" });
const legacyConfig = { env: "test", security: { testControlsEnabled: true, isolatedE2eHarness: false } };

async function fixture(t, { legacy = false, type = "SEND_EMAIL" } = {}) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const config = loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: legacy ? "true" : "false", WORKER_ENABLED: "false" });
  const services = createServices(db, undefined, config);
  const organization = await services.leadsRepository.createOrganization({ name: "Synthetic channel capability" });
  const lead = await services.leadsRepository.createLead({ organization_id: organization.id, name: "Synthetic contact", email: "person@example.test", phone: "+14155550123" });
  const action = await services.actionsRepository.createAction({ organization_id: organization.id, lead_id: lead.id, type,
    status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", idempotency_key: "capability:" + lead.id,
    payload: { subject: "Exact synthetic subject", message: "Exact synthetic reviewed body." } });
  return { db, services, organization, lead, action };
}
async function settings(f, value) { await f.services.settingsRepository.setBulk(f.organization.id, "channel_email", value); }
async function preview(f) { return f.services.approvalsService.currentForAction({ organization_id: f.organization.id, action_id: f.action.id }); }
async function dispatchSnapshot(f, suppliedConfig = {}) {
  return new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.organization.id, async (tx) => {
    const action = await tx.get("SELECT * FROM actions WHERE id = ?", [f.action.id]);
    return new PreparedActionService(tx).validateForDispatch({ action, lead: f.lead, channelConfig: suppliedConfig });
  });
}
async function preserved(f) {
  return { action: await f.services.actionsRepository.getAction(f.action.id),
    revisions: await f.db.all("SELECT * FROM action_revisions ORDER BY revision"),
    decisions: await f.db.all("SELECT * FROM action_revision_decisions ORDER BY id"),
    executions: await f.db.all("SELECT * FROM action_executions ORDER BY id") };
}

// This fixture represents a persisted, exactly approved pre-capability review.
// It does not use a runtime override or grant a new live approval.
async function seedHistoricalApproval(f, configuration, { replyTo = configuration.reply_to || null } = {}) {
  await settings(f, configuration);
  return new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.organization.id, async (tx) => {
    const action = await tx.get("SELECT * FROM actions WHERE id = ?", [f.action.id]);
    const lead = await tx.get("SELECT * FROM leads WHERE id = ?", [f.lead.id]);
    const storedConfig = await new SettingsRepository(tx).getCategory(f.organization.id, "channel_email");
    const service = new PreparedActionService(tx);
    const envelope = { schema_version: 1, organization_id: action.organization_id, action_id: action.id, action_type: action.type,
      channel: "EMAIL", recipient: "person@example.test", sender: { provider: configuration.provider, from: configuration.provider === "sandbox" ? "Sandbox simulation" : configuration.from_email,
        account_id: null, reply_to: replyTo }, subject: "Exact synthetic subject", body: "Exact synthetic reviewed body.",
      scheduled_at: null, policy_version: PREPARED_POLICY_VERSION };
    const revision = await service.repository.create(action, { envelope, contentHash: fingerprint(envelope), senderFingerprint: fingerprint(storedConfig),
      contextFingerprint: service.contextFingerprint(action, lead, { profile_revision: 0, enquiry_revision: 0 }) });
    await service.repository.decide(revision, { decision: "APPROVED", reviewer_user_id: "historical-fixture-reviewer" });
    await tx.run("UPDATE actions SET status = 'APPROVED' WHERE id = ?", [action.id]);
    return revision;
  });
}

test("channel runtime registration is immutable, explicit, root-scoped and strict by default", async (t) => {
  const unregistered = {};
  assert.equal(channelRuntimeFor(unregistered).legacy_adapter_tests, false);
  const profiles = [undefined, { env: "development", security: { testControlsEnabled: true } },
    { env: "staging", security: { testControlsEnabled: true } }, { env: "production", security: { testControlsEnabled: true } },
    { env: "test", security: { testControlsEnabled: false } }, { env: "test", security: { testControlsEnabled: true, isolatedE2eHarness: true } }];
  for (const config of profiles) {
    const root = {};
    assert.equal(configureChannelRuntime(root, config).legacy_adapter_tests, false);
    assert.throws(() => requireChannelCapability(root, { action_type: "SEND_EMAIL", configuration: { provider: "resend", verified: true } }), { code: "CHANNEL_LIVE_UNSUPPORTED" });
  }
  const db = await createDatabase(":memory:"); t.after(() => db.close());
  const editable = structuredClone(legacyConfig);
  const registered = configureChannelRuntime(db, editable);
  editable.security.testControlsEnabled = false;
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(configureChannelRuntime(db, legacyConfig), registered);
  await db.transaction(async (tx) => { assert.equal(channelRuntimeFor(tx), registered); });
  assert.throws(() => configureChannelRuntime(db, { env: "production" }), /immutable/);
  assert.equal(channelRuntimeFor(db).legacy_adapter_tests, true);
});

test("normal capability honestly distinguishes Sandbox, unsupported providers, incomplete setup and unverified complete setup", () => {
  for (const action_type of ["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "SEND_VOICE_CALL", "CREATE_HUMAN_TASK"]) {
    const value = assessChannelCapability({ action_type });
    assert.equal(value.can_review, true); assert.equal(value.can_dispatch, true); assert.equal(value.verification, "NOT_APPLICABLE");
  }
  for (const [action_type, provider] of [["SEND_EMAIL", "resend"], ["SEND_SMS", "twilio"], ["SEND_WHATSAPP", "meta"], ["SEND_VOICE_CALL", "twilio_voice"]]) {
    const value = assessChannelCapability({ action_type, configuration: { ...completeEmail, provider, verified: true } });
    assert.equal(value.implementation_supported, false); assert.equal(value.review_hold_code, "CHANNEL_LIVE_UNSUPPORTED"); assert.equal(value.can_dispatch, false);
  }
  const missing = assessChannelCapability({ action_type: "SEND_EMAIL", configuration: { provider: "sendgrid", api_key: "key", verified: true } });
  assert.equal(missing.review_hold_code, "CHANNEL_SETUP_REQUIRED"); assert.equal(missing.dispatch_hold_code, "CHANNEL_SETUP_REQUIRED");
  const complete = assessChannelCapability({ action_type: "SEND_EMAIL", configuration: { ...completeEmail, verified: true, delivery_verified: true } });
  assert.equal(complete.can_review, true); assert.equal(complete.can_dispatch, false); assert.equal(complete.verification, "NOT_VERIFIED");
  assert.equal(complete.dispatch_hold_code, "CHANNEL_VERIFICATION_REQUIRED");
  assert.equal(JSON.stringify(complete).includes(completeEmail.api_key), false);
});

test("strict setup review rejects malformed or incomplete configuration without creating a review or approval", async (t) => {
  const f = await fixture(t);
  for (const bad of [ { provider: "sendgrid" }, { ...completeEmail, reply_to: "" }, { ...completeEmail, reply_to: "Replies <reply@example.test>" },
    { ...completeEmail, reply_to: "reply@example.test\r\nBcc: other@example.test" }, { ...completeEmail, sendgrid_inbound_public_key: "not-a-key" } ]) {
    // Explicit clear prevents a previous complete field from masking a missing-field case.
    await settings(f, { ...completeEmail, reply_to: "", ...bad });
    await assert.rejects(preview(f), { code: "CHANNEL_SETUP_REQUIRED" });
  }
  assert.equal((await f.db.all("SELECT * FROM action_revisions")).length, 0);
  assert.equal((await f.db.all("SELECT * FROM action_revision_decisions")).length, 0);
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("complete SendGrid review binds explicit Reply-To; concurrent dispatch requests hold with no attempt, provider call or approval rewrite", async (t) => {
  const f = await fixture(t); await settings(f, completeEmail);
  const approved = await approveStoredAction(f.services, f.action);
  assert.equal(approved.prepared_revision.envelope.sender.from, "sender@example.test");
  assert.equal(approved.prepared_revision.envelope.sender.reply_to, "replies@example.test");
  assert.equal(JSON.stringify(approved).includes(completeEmail.api_key), false);
  const before = await preserved(f);
  let calls = 0;
  f.services.actionExecutor.adapter = { async invoke() { calls += 1; throw new Error("Forbidden provider invocation"); } };
  const results = await Promise.all([f.services.actionExecutor.execute(f.action), f.services.actionExecutor.execute(f.action)]);
  for (const result of results) {
    assert.equal(result.executable, false); assert.equal(result.channel_hold, true); assert.equal(result.hold_code, "CHANNEL_VERIFICATION_REQUIRED");
    assert.equal(result.status, "APPROVED");
  }
  assert.equal(calls, 0); assert.deepEqual(await preserved(f), before);
  await assert.rejects(dispatchSnapshot(f, completeEmail), { code: "CHANNEL_VERIFICATION_REQUIRED" });
});

test("historical exact approvals cannot bypass normal unsupported-provider or setup holds", async (t) => {
  for (const [configuration, code] of [
    [{ provider: "resend", from_email: "sender@example.test", api_key: "synthetic" }, "CHANNEL_LIVE_UNSUPPORTED"],
    [{ provider: "sendgrid", from_email: "sender@example.test", api_key: "synthetic" }, "CHANNEL_SETUP_REQUIRED"]
  ]) {
    const f = await fixture(t); await seedHistoricalApproval(f, configuration);
    const before = await preserved(f);
    let calls = 0; f.services.actionExecutor.adapter = { async invoke() { calls += 1; throw new Error("Forbidden invocation"); } };
    const result = await f.services.actionExecutor.execute(f.action);
    assert.equal(result.hold_code, code); assert.equal(result.executable, false);
    assert.equal(calls, 0); assert.deepEqual(await preserved(f), before);
  }
});

test("dispatch ignores stale caller configuration and saved connection revisions prevent edit-back approval resurrection", async (t) => {
  const f = await fixture(t, { legacy: true }); await settings(f, completeEmail);
  const approved = await approveStoredAction(f.services, f.action);
  const captured = await dispatchSnapshot(f);
  assert.equal(captured.revision_id, approved.prepared_revision.id);
  await settings(f, { reply_to: "changed@example.test", connection_revision: 2 });
  await assert.rejects(dispatchSnapshot(f, captured.provider_config), { code: "APPROVAL_REVISION_STALE" });
  await settings(f, { reply_to: completeEmail.reply_to, connection_revision: 3 });
  await assert.rejects(dispatchSnapshot(f, captured.provider_config), { code: "APPROVAL_REVISION_STALE" });
  const refreshed = await preview(f);
  assert.notEqual(refreshed.prepared_revision.id, approved.prepared_revision.id);
  assert.equal(refreshed.action.status, "AWAITING_APPROVAL");
  assert.equal((await f.db.all("SELECT * FROM action_revision_decisions")).length, 1);
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("every connection authority field invalidates its earlier exact approval", async (t) => {
  const f = await fixture(t, { legacy: true }); await settings(f, completeEmail);
  for (const update of [{ api_key: "another-synthetic-key" }, { webhook_token: "another-synthetic-route" },
    { sendgrid_events_public_key: publicKey() }, { sendgrid_inbound_public_key: publicKey() }, { from_email: "other@example.test" }]) {
    await approveStoredAction(f.services, f.action);
    const early = await dispatchSnapshot(f);
    await settings(f, update);
    await assert.rejects(dispatchSnapshot(f, early.provider_config), { code: "APPROVAL_REVISION_STALE" });
    await preview(f);
  }
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("an already authorized synthetic transport uses captured Reply-To and config after later edits", async (t) => {
  const f = await fixture(t, { legacy: true }); await settings(f, completeEmail);
  await approveStoredAction(f.services, f.action);
  const approvedDispatch = await dispatchSnapshot(f);
  await settings(f, { reply_to: "later@example.test", api_key: "later-synthetic-key", connection_revision: 2 });
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 202, headers: { "x-message-id": "synthetic-provider-reference" } }); };
  try {
    const router = new ChannelRouter({ emailAdapter: new EmailAdapter(), settingsRepository: { getCategory() { throw new Error("Unexpected mutable config read"); } }, leadsRepository: {} });
    const result = await router.invoke(f.action, {}, 1, { approvedDispatch, execution_id: "synthetic-execution", provider_intent_key: "synthetic-intent" });
    assert.equal(result.ok, true); assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.reply_to, { email: "replies@example.test" });
    assert.deepEqual(body.from, { email: "sender@example.test" });
    assert.equal(calls[0].options.headers.Authorization, "Bearer " + completeEmail.api_key);
    assert.equal(body.personalizations[0].to[0].email, "person@example.test");
  } finally { globalThis.fetch = original; }
});

test("new channel holds preserve truthful exact late callbacks and their duplicate idempotency", async (t) => {
  const f = await callbackFixture(t);
  await new SettingsRepository(f.db).setBulk(f.organization.id, "channel_email", completeEmail);
  const action = await f.createAction();
  const execution = await f.createAttempt(action, { outcome_class: "UNCERTAIN" });
  await new SettingsRepository(f.db).setBulk(f.organization.id, "channel_email", { provider: "resend", api_key: "changed-synthetic", connection_revision: 2 });
  const input = { organization_id: f.organization.id, action_id: action.id, action_execution_id: execution.id,
    revision_id: execution.action_revision_id, provider: "sendgrid", provider_event_id: "exact-late-event", status: "COMPLETED", provider_reference: "synthetic-old-send" };
  const first = await f.callbacksService.receiveExecutionCallback(input);
  assert.equal(first.applied, true); assert.equal(first.execution.outcome_class, "DELIVERED"); assert.equal(first.action.status, "COMPLETED");
  await f.callbacksService.receiveExecutionCallback(input);
  assert.equal((await f.executionsRepository.listForAction(action.id)).length, 1);
  assert.equal((await f.db.all("SELECT * FROM callbacks")).length, 1);
  assert.equal((await f.db.get("SELECT outcome_class FROM action_executions WHERE id = ?", [execution.id])).outcome_class, "DELIVERED");
});

test("Sandbox exact review captures an explicit return address while missing configuration retains the original envelope", async (t) => {
  const f = await fixture(t);
  const original = await preview(f);
  assert.deepEqual(original.prepared_revision.envelope.sender, { provider: "sandbox", from: "Sandbox simulation", account_id: null, reply_to: null });
  await settings(f, { provider: "sandbox", reply_to: "Replies@Example.test", connection_revision: 1 });
  const approved = await approveStoredAction(f.services, f.action);
  assert.notEqual(approved.prepared_revision.id, original.prepared_revision.id);
  assert.equal(approved.prepared_revision.envelope.sender.reply_to, "replies@example.test");
  const captured = await dispatchSnapshot(f);
  assert.equal(captured.envelope.sender.reply_to, "replies@example.test");
  assert.equal(captured.envelope_hash, approved.prepared_revision.content_hash);
  await settings(f, { reply_to: "changed@example.test", connection_revision: 2 });
  await assert.rejects(dispatchSnapshot(f, captured.provider_config), { code: "APPROVAL_REVISION_STALE" });
  assert.equal(captured.envelope.sender.reply_to, "replies@example.test");
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});

test("an older exact envelope that omitted configured Reply-To requires renewed review without a global policy change", async (t) => {
  const f = await fixture(t);
  const old = await seedHistoricalApproval(f, { provider: "sandbox", reply_to: "replies@example.test", connection_revision: 1 }, { replyTo: null });
  await assert.rejects(dispatchSnapshot(f), { code: "APPROVAL_REVISION_STALE" });
  const refreshed = await preview(f);
  assert.notEqual(refreshed.prepared_revision.id, old.id);
  assert.equal(refreshed.prepared_revision.envelope.sender.reply_to, "replies@example.test");
  assert.equal(refreshed.prepared_revision.envelope.policy_version, PREPARED_POLICY_VERSION);
  assert.equal(refreshed.action.status, "AWAITING_APPROVAL");
  assert.equal((await f.db.all("SELECT * FROM action_revision_decisions")).length, 1);
  assert.equal((await f.db.all("SELECT * FROM action_executions")).length, 0);
});
