import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { PreparedActionService } from "../src/modules/outbound-automation/preparedActionService.js";
import { ChannelRouter } from "../src/modules/handlers/channelRouter.js";
import { EmailAdapter } from "../src/modules/handlers/emailAdapter.js";
import { SmsAdapter } from "../src/modules/handlers/smsAdapter.js";
import { WhatsAppAdapter } from "../src/modules/handlers/whatsappAdapter.js";
import { VoiceAdapter } from "../src/modules/handlers/voiceAdapter.js";

async function fixture(t, type = "SEND_EMAIL") {
  const client = await startClient(t);
  const registered = await client.register("Reviewed dispatch");
  const lead = await client.services.leadsRepository.createLead({
    organization_id: registered.organization.id, name: "Synthetic person",
    email: "person@example.test", phone: "+919876543210"
  });
  const action = await client.services.actionsRepository.createAction({
    organization_id: registered.organization.id, lead_id: lead.id, type,
    idempotency_key: "review:" + lead.id, status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED",
    payload: { subject: "A literal question", message: "Hello. Would this be useful?" }
  });
  const input = { organization_id: action.organization_id, action_id: action.id, reviewer_user_id: registered.user.id };
  return { client, action, lead, input, service: client.services.approvalsService };
}
async function approve(f) {
  const preview = await f.service.currentForAction(f.input);
  return f.service.approveAction({ ...f.input, expected_revision_id: preview.prepared_revision.id });
}
async function snapshot(f) {
  return new ContactPolicyService(f.client.db).withWorkspacePolicyTransaction(f.action.organization_id, async (tx) => {
    const action = await tx.get("SELECT * FROM actions WHERE id = ?", [f.action.id]);
    const prepared = new PreparedActionService(tx);
    return prepared.validateForDispatch({ action, ...await prepared.inputs(action) });
  });
}

test("prepared review requires an explicit current token and never exposes private settings fingerprints", async (t) => {
  const f = await fixture(t);
  const before = await f.service.currentForAction(f.input);
  assert.equal(before.prepared_revision.envelope.recipient, "person@example.test");
  assert.equal(before.prepared_revision.envelope.sender.provider, "sandbox");
  assert.equal(JSON.stringify(before).includes("sender_config_fingerprint"), false);
  assert.equal(JSON.stringify(before).includes("context_fingerprint"), false);
  await assert.rejects(f.service.approveAction(f.input), { code: "APPROVAL_REVISION_REQUIRED" });
  await assert.rejects(f.service.approveAction({ ...f.input, expected_revision_id: "other" }), { code: "APPROVAL_REVISION_STALE" });
  assert.equal((await f.client.services.actionsRepository.getAction(f.action.id)).status, "AWAITING_APPROVAL");
  assert.equal((await f.client.db.all("SELECT * FROM action_revision_decisions")).length, 0);
});

test("previewed edits replace the token, preserve original intent and require an explicit new decision", async (t) => {
  const f = await fixture(t);
  const original = await f.service.currentForAction(f.input);
  const edited = await f.service.previewAction({
    ...f.input, expected_revision_id: original.prepared_revision.id,
    edited_payload: { subject: "A revised question", body: "The precise revised body." }
  });
  assert.notEqual(edited.prepared_revision.id, original.prepared_revision.id);
  assert.equal(edited.prepared_revision.envelope.body, "The precise revised body.");
  assert.equal(edited.action.payload.message, "Hello. Would this be useful?");
  assert.equal(edited.approval.status, "PENDING");
  await assert.rejects(f.service.approveAction({ ...f.input, expected_revision_id: original.prepared_revision.id }), { code: "APPROVAL_REVISION_STALE" });
  await assert.rejects(f.service.approveAction({
    ...f.input, expected_revision_id: edited.prepared_revision.id, edited_payload: { body: "Unseen content" }
  }), { code: "EDIT_PREVIEW_REQUIRED" });
  const accepted = await f.service.approveAction({ ...f.input, expected_revision_id: edited.prepared_revision.id });
  assert.equal(accepted.prepared_revision.envelope.body, "The precise revised body.");
  assert.equal((await f.client.db.all("SELECT * FROM action_revisions")).length, 2);
});

test("recipient change after approval holds dispatch and preview requires renewed review", async (t) => {
  const f = await fixture(t);
  const approved = await approve(f);
  await new ContactPolicyService(f.client.db).withWorkspacePolicyTransaction(f.action.organization_id,
    (tx) => tx.run("UPDATE leads SET email = ?, normalized_email = ? WHERE id = ?", ["changed@example.test", "changed@example.test", f.lead.id]));
  await assert.rejects(snapshot(f), { code: "APPROVAL_REVISION_STALE" });
  const refreshed = await f.service.currentForAction(f.input);
  assert.equal(refreshed.action.status, "AWAITING_APPROVAL");
  assert.equal(refreshed.prepared_revision.envelope.recipient, "changed@example.test");
  assert.notEqual(refreshed.prepared_revision.id, approved.prepared_revision.id);
  assert.equal((await f.client.db.all("SELECT * FROM action_revision_decisions")).length, 1);
});

test("any sender credential/config change invalidates the existing exact approval without leaking the key", async (t) => {
  const f = await fixture(t);
  const settings = f.client.services.settingsRepository;
  await settings.setBulk(f.action.organization_id, "channel_email", { provider: "resend", api_key: "synthetic-key-one", from_email: "sender@example.test" });
  const approved = await approve(f);
  assert.equal(JSON.stringify(approved).includes("synthetic-key-one"), false);
  await settings.set(f.action.organization_id, "channel_email", "api_key", "synthetic-key-two");
  await assert.rejects(snapshot(f), { code: "APPROVAL_REVISION_STALE" });
  const preview = await f.service.currentForAction(f.input);
  assert.notEqual(preview.prepared_revision.id, approved.prepared_revision.id);
  assert.equal(JSON.stringify(preview).includes("synthetic-key-two"), false);
});

test("revocation preserves the original decision and cannot recall an in-flight attempt", async (t) => {
  const f = await fixture(t);
  const first = await approve(f);
  const revoked = await f.service.revokeAction({ ...f.input, expected_revision_id: first.prepared_revision.id });
  assert.equal(revoked.action.status, "AWAITING_APPROVAL");
  assert.notEqual(revoked.prepared_revision.id, first.prepared_revision.id);
  assert.equal((await f.client.db.get("SELECT decision FROM action_revision_decisions")).decision, "APPROVED");
  await assert.rejects(snapshot(f), { code: "APPROVAL_REQUIRED" });
  const next = await f.service.approveAction({ ...f.input, expected_revision_id: revoked.prepared_revision.id });
  await f.client.services.actionsRepository.updateStatus(f.action.id, "EXECUTING");
  await assert.rejects(f.service.revokeAction({ ...f.input, expected_revision_id: next.prepared_revision.id }), { code: "ACTION_NOT_REVOCABLE" });
  assert.equal((await f.client.services.actionsRepository.getAction(f.action.id)).status, "EXECUTING");
});

test("a known-safe retry keeps the approved revision, while a changed configuration still blocks it", async (t) => {
  const f = await fixture(t);
  const approved = await approve(f);
  await f.client.services.actionsRepository.updateStatus(f.action.id, "RETRYING");
  assert.equal((await snapshot(f)).revision_id, approved.prepared_revision.id);
  await f.client.services.settingsRepository.set(f.action.organization_id, "channel_email", "provider", "sendgrid");
  await assert.rejects(snapshot(f), { code: "APPROVAL_REVISION_STALE" });
});

test("legacy approval has no dispatch authority and is archived when a real preview is prepared", async (t) => {
  const f = await fixture(t);
  await f.client.services.approvalsRepository.createPendingForAction(f.action, { requested_reason: "Historical fixture" });
  await f.client.services.approvalsRepository.approve(f.action.id, f.action.organization_id, { reviewer_name: "Historical reviewer" });
  await f.client.services.actionsRepository.updateStatus(f.action.id, "APPROVED");
  await assert.rejects(snapshot(f), { code: "APPROVAL_REQUIRED" });
  const reviewed = await f.service.currentForAction(f.input);
  assert.equal(reviewed.action.status, "AWAITING_APPROVAL");
  assert.equal(reviewed.approval.status, "PENDING");
  assert.equal((await f.client.db.all("SELECT * FROM action_revision_decisions")).length, 0);
  const archive = await f.client.db.get("SELECT metadata_json FROM audit_logs WHERE event_type = 'LegacyApprovalArchived'");
  assert.equal(JSON.parse(archive.metadata_json).legacy_approval.reviewer_name, "Historical reviewer");
});

test("provider request uses only captured reviewed recipient, sender and exact text after settings change", async (t) => {
  const f = await fixture(t);
  await f.client.services.settingsRepository.setBulk(f.action.organization_id, "channel_email",
    { provider: "resend", api_key: "captured-key", from_email: "captured@example.test" });
  await approve(f);
  const approvedDispatch = await snapshot(f);
  await f.client.services.settingsRepository.setBulk(f.action.organization_id, "channel_email",
    { provider: "sendgrid", api_key: "later-key", from_email: "later@example.test" });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: "synthetic-accepted" });
  };
  try {
    const router = new ChannelRouter({
      emailAdapter: new EmailAdapter(),
      settingsRepository: { getCategory() { throw new Error("Forbidden settings reread"); } },
      leadsRepository: { getLead() { throw new Error("Forbidden recipient reread"); } }
    });
    const result = await router.invoke(f.action, {}, 1, {
      approvedDispatch, execution_id: "synthetic-execution",
      provider_intent_key: "relay-action-" + f.action.id + "-revision-" + approvedDispatch.revision_id
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    const sent = JSON.parse(calls[0].options.body);
    assert.deepEqual(sent.to, [approvedDispatch.envelope.recipient]);
    assert.equal(sent.from, approvedDispatch.envelope.sender.from);
    assert.equal(sent.text, approvedDispatch.envelope.body);
    assert.equal(sent.subject, approvedDispatch.envelope.subject);
    assert.equal(calls[0].options.headers.Authorization, "Bearer captured-key");
  } finally { globalThis.fetch = realFetch; }
});

test("routers and direct provider adapters fail closed without a captured reviewed context", async () => {
  const router = new ChannelRouter({});
  for (const type of ["SEND_EMAIL", "UPDATE_CRM", "RUN_RESEARCH", "WAIT", "UNKNOWN"]) {
    assert.equal((await router.invoke({ type, id: "fixture" }, {}, 1)).ok, false);
  }
  for (const Adapter of [EmailAdapter, SmsAdapter, WhatsAppAdapter, VoiceAdapter]) {
    const adapter = new Adapter({ settingsRepository: { getCategory() { throw new Error("Must not reread settings"); } } });
    assert.equal((await adapter.send("fixture", { to: "unused@example.test", body: "test", message: "test" })).ok, false);
  }
});

test("revocation after a confirmed retryable rejection prevents another provider invocation", async (t) => {
  const f = await fixture(t);
  const approved = await approve(f);
  let calls = 0;
  f.client.services.actionExecutor.adapter = { async invoke() {
    calls++;
    return { ok: false, retryable: true, uncertain: false, error: "Synthetic confirmed HTTP 429 rejection." };
  } };
  const rejected = await f.client.services.actionExecutor.execute(f.action);
  assert.equal(rejected.status, "RETRYING");
  const revoked = await f.service.revokeAction({ ...f.input, expected_revision_id: approved.prepared_revision.id });
  assert.equal(revoked.action.status, "AWAITING_APPROVAL");
  const held = await f.client.services.actionExecutor.execute(f.action);
  assert.equal(held.status, "AWAITING_APPROVAL");
  assert.equal(calls, 1);
  assert.equal((await f.client.db.get("SELECT decision FROM action_revision_decisions WHERE action_revision_id = ?", [approved.prepared_revision.id])).decision, "APPROVED");
});

for (const scenario of [
  { type: "SEND_EMAIL", category: "channel_email", config: { provider: "sendgrid", api_key: "captured-key", from_email: "captured@example.test" } },
  { type: "SEND_SMS", category: "channel_sms", config: { provider: "twilio", account_sid: "ACsynthetic", auth_token: "captured-token", from_number: "+14155550100" } },
  { type: "SEND_WHATSAPP", category: "channel_whatsapp", config: { provider: "meta", api_key: "captured-key", phone_number_id: "synthetic-phone-id" } },
  { type: "SEND_VOICE_CALL", category: "channel_call", config: { provider: "twilio_voice", account_sid: "ACsynthetic", auth_token: "captured-token", from_number: "+14155550100" } },
]) {
  test(scenario.type + " sends the reviewed sender, recipient and exact content through its real adapter contract", async (t) => {
    const f = await fixture(t, scenario.type);
    await f.client.services.settingsRepository.setBulk(f.action.organization_id, scenario.category, scenario.config);
    const initial = await f.service.currentForAction(f.input);
    const edited = await f.service.previewAction({ ...f.input, expected_revision_id: initial.prepared_revision.id,
      edited_payload: { body: 'Literal <message> & "reviewed"\nsecond line.' } });
    await f.service.approveAction({ ...f.input, expected_revision_id: edited.prepared_revision.id });
    const approvedDispatch = await snapshot(f);
    // These changes happen after authorization: the captured sender remains the sole dispatch input.
    await f.client.services.settingsRepository.set(f.action.organization_id, scenario.category, "provider", "sandbox");
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return Response.json({ sid: "synthetic-id", messages: [{ id: "synthetic-id" }] }, { headers: { "x-message-id": "synthetic-id" } });
    };
    try {
      const router = new ChannelRouter({ emailAdapter: new EmailAdapter(), smsAdapter: new SmsAdapter(),
        whatsappAdapter: new WhatsAppAdapter(), voiceAdapter: new VoiceAdapter() });
      assert.equal((await router.invoke(f.action, { message: "Unreviewed replacement" }, 1, {
      approvedDispatch, execution_id: "synthetic-execution",
      provider_intent_key: "relay-action-" + f.action.id + "-revision-" + approvedDispatch.revision_id
    })).ok, true);
      assert.equal(requests.length, 1);
      const { url, options } = requests[0];
      const envelope = approvedDispatch.envelope;
      if (scenario.type === "SEND_EMAIL") {
        assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
        const sent = JSON.parse(options.body);
        assert.equal(sent.personalizations[0].to[0].email, envelope.recipient);
        assert.equal(sent.from.email, envelope.sender.from);
        assert.equal(sent.subject, envelope.subject);
        assert.equal(sent.content[0].value, envelope.body);
        assert.equal(sent.custom_args.relay_revision_id, approvedDispatch.revision_id);
        assert.equal(sent.custom_args.relay_execution_id, "synthetic-execution");
        assert.equal(options.headers.Authorization, "Bearer captured-key");
      } else if (scenario.type === "SEND_WHATSAPP") {
        assert.equal(url, "https://graph.facebook.com/v20.0/synthetic-phone-id/messages");
        const sent = JSON.parse(options.body);
        assert.equal(sent.to, envelope.recipient);
        assert.equal(sent.text.body, envelope.body);
        assert.equal(options.headers.Authorization, "Bearer captured-key");
      } else {
        assert.ok(url.includes("/Accounts/ACsynthetic/"));
        assert.equal(options.body.get("To"), envelope.recipient);
        assert.equal(options.body.get("From"), envelope.sender.from);
        assert.equal(options.headers.Authorization, "Basic " + Buffer.from("ACsynthetic:captured-token").toString("base64"));
        if (scenario.type === "SEND_SMS") assert.equal(options.body.get("Body"), envelope.body);
        else assert.equal(options.body.get("Twiml"), '<Response><Say>Literal &lt;message&gt; &amp; &quot;reviewed&quot;\nsecond line.</Say></Response>');
      }
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("transport loss and provider 5xx are uncertain and never become automatic retries", async () => {
  const adapter = new EmailAdapter();
  const captured = { configuration: { provider: "resend", api_key: "synthetic-key" },
    sender: { provider: "resend", from: "from@example.test" } };
  const message = { to: "to@example.test", subject: "Synthetic", body: "Test" };
  const originalFetch = globalThis.fetch;
  try {
    for (const behavior of ["throw", 503, 429, 401]) {
      globalThis.fetch = async () => {
        if (behavior === "throw") throw new Error("Raw unsafe synthetic-key server content");
        return { ok: false, status: behavior, async text() { throw new Error("Must not expose response body"); } };
      };
      const result = await adapter.send("synthetic-org", message, captured);
      assert.equal(result.ok, false);
      assert.equal(result.uncertain, behavior === "throw" || behavior === 503);
      assert.equal(result.retryable, behavior === 429);
      assert.equal(JSON.stringify(result).includes("synthetic-key"), false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("sender configuration updates roll back as one unit when a later value cannot be saved", async (t) => {
  const f = await fixture(t);
  const settings = f.client.services.settingsRepository;
  await settings.setBulk(f.action.organization_id, "channel_email", { provider: "sandbox", from_email: "original@example.test" });
  await assert.rejects(settings.setBulk(f.action.organization_id, "channel_email",
    { from_email: "partial@example.test", unserializable: 1n }));
  assert.deepEqual(await settings.getCategory(f.action.organization_id, "channel_email"),
    { provider: "sandbox", from_email: "original@example.test" });
});

test("revocation remains available after sender configuration becomes invalid", async (t) => {
  const f = await fixture(t);
  await f.client.services.settingsRepository.setBulk(f.action.organization_id, "channel_email",
    { provider: "resend", api_key: "synthetic-key", from_email: "sender@example.test" });
  const accepted = await approve(f);
  await f.client.services.settingsRepository.delete(f.action.organization_id, "channel_email", "api_key");
  const revoked = await f.service.revokeAction({ ...f.input, expected_revision_id: accepted.prepared_revision.id });
  assert.equal(revoked.action.status, "AWAITING_APPROVAL");
  assert.equal(revoked.prepared_revision, null);
  assert.equal(revoked.approval.status, "PENDING");
  assert.equal(revoked.approval.action_revision_id, null);
  await assert.rejects(snapshot(f), { code: "APPROVAL_REQUIRED" });
  assert.equal((await f.client.db.get("SELECT decision FROM action_revision_decisions WHERE action_revision_id = ?", [accepted.prepared_revision.id])).decision, "APPROVED");
  assert.equal((await f.client.db.get("SELECT COUNT(*) AS count FROM audit_logs WHERE event_type = 'ActionApprovalRevoked'")).count, 1);
  await f.client.services.settingsRepository.set(f.action.organization_id, "channel_email", "api_key", "replacement-synthetic-key");
  const prepared = await f.service.currentForAction(f.input);
  assert.notEqual(prepared.prepared_revision.id, accepted.prepared_revision.id);
  assert.equal(prepared.approval.status, "PENDING");
  await assert.rejects(snapshot(f), { code: "APPROVAL_REQUIRED" });
});
