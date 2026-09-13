import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { approveStoredAction } from "./helpers/review.js";
import { assertReceiptOwnership } from "../src/modules/webhook-inbox/webhookInboxService.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const services = createServices(db);
  const organization = await services.leadsRepository.createOrganization({ name: "Pending policy fixture" });
  const clock = { value: Date.parse("2026-09-11T10:00:00.000Z") };
  services.actionExecutor.now = () => clock.value;
  services.webhookInbox.random = () => 1;
  services.actionExecutor.channelWorkflowService = null;
  const calls = [];
  services.actionExecutor.adapter = { async invoke(action) {
    calls.push(action.id);
    return { ok: true, provider: "email-sandbox", provider_reference: "synthetic-" + action.id };
  } };
  async function reviewedAction(organizationId = organization.id, email = "recipient@example.test") {
    const lead = await services.leadsRepository.createLead({ organization_id: organizationId, name: "Synthetic recipient", email });
    const action = await services.actionsRepository.createAction({ organization_id: organizationId, lead_id: lead.id,
      type: "SEND_EMAIL", idempotency_key: "pending-policy:" + lead.id,
      payload: { subject: "Synthetic question", message: "Exact reviewed message." } });
    await approveStoredAction(services, action);
    return { lead, action: await services.actionsRepository.getAction(action.id) };
  }
  function command(providerEventId, input, kind = "EXECUTION_CALLBACK") {
    return { organization_id: organization.id, provider: kind === "SENDGRID_EVENT" ? "sendgrid" : "synthetic",
      connection_key: kind === "SENDGRID_EVENT" ? "channel_email" : "application",
      event_kind: kind, provider_event_id: providerEventId, verification_kind: "LOCAL_TEST", input };
  }
  return { db, services, organization, clock, calls, reviewedAction, command };
}

async function actionState(f, id) {
  const action = await f.services.actionsRepository.getAction(id);
  const approval = await f.db.get("SELECT * FROM action_approvals WHERE action_id = ?", [id]);
  const decisions = await f.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ? ORDER BY id", [id]);
  return { action, approval, decisions };
}

test("received opt-out awaiting policy retry defers manual and worker sends without consuming approval or attempts", async (t) => {
  const f = await fixture(t), { lead, action } = await f.reviewedAction();
  const original = await actionState(f, action.id);
  await f.db.exec("CREATE TRIGGER fail_pending_policy BEFORE INSERT ON contact_restrictions BEGIN SELECT RAISE(ABORT,'synthetic policy storage failure'); END;");
  const received = await f.services.webhookInbox.receiveAndProcess(
    f.command("pending-optout", { event: "unsubscribe", sg_event_id: "pending-optout", email: lead.email }, "SENDGRID_EVENT"),
    { throwOnProcessingError: false });
  assert.equal(received.receipt.processing_state, "RETRY_PENDING");
  assert.equal(received.receipt.mandatory_policy_status, "PENDING");
  await f.db.exec("DROP TRIGGER fail_pending_policy");

  const policy = await f.services.contactPolicyService.inspectLead({ organization_id: action.organization_id, lead_id: lead.id, channel: "EMAIL" });
  assert.equal(policy.restricted, false);
  assert.equal(policy.policy_pending, true);
  assert.equal(policy.reason, "CONTACT_POLICY_PENDING");
  const manual = await f.services.actionExecutor.execute(action);
  assert.equal(manual.deferred, true);
  assert.equal(manual.policy_pending, true);
  assert.equal(manual.executable, false);
  const worker = await f.services.worker.runOnce({ organization_id: action.organization_id });
  assert.equal(worker.executed_actions.length, 0, "scheduler excludes an action-only workspace while contact policy is pending");
  assert.equal(worker.visits.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.services.executionsRepository.countForAction(action.id), 0);
  assert.deepEqual(await actionState(f, action.id), original);

  f.clock.value = Date.parse(received.receipt.next_attempt_at);
  assert.equal((await f.services.webhookInbox.processDue()).items[0].processing_state, "PROCESSED");
  const restricted = await f.services.contactPolicyService.inspectLead({ organization_id: action.organization_id, lead_id: lead.id, channel: "EMAIL" });
  assert.equal(restricted.policy_pending, false);
  assert.equal(restricted.restricted, true);
  assert.equal(restricted.reason, "CONTACT_RESTRICTED");
  assert.equal((await f.services.actionExecutor.execute(action)).executable, false);
  assert.equal((await f.services.actionsRepository.getAction(action.id)).status, "BLOCKED");
  assert.equal(f.calls.length, 0);
  assert.equal(await f.services.executionsRepository.countForAction(action.id), 0);
});

test("resolving a harmless receipt releases the original reviewed action without resetting its dispatch budget", async (t) => {
  const f = await fixture(t), { action } = await f.reviewedAction();
  const original = await actionState(f, action.id);
  let first = true;
  f.services.webhookInbox.handlers.EXECUTION_CALLBACK = async (_, { receipt }) => {
    if (first) { first = false; throw new Error("Synthetic policy check unavailable"); }
    await f.services.contactPolicyService.withWorkspacePolicyTransaction(receipt.organization_id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
    });
  };
  const received = await f.services.webhookInbox.receiveAndProcess(f.command("harmless", { event: "synthetic" }), { throwOnProcessingError: false });
  assert.equal((await f.services.actionExecutor.execute(action)).deferred, true);
  assert.deepEqual(await actionState(f, action.id), original);
  f.clock.value = Date.parse(received.receipt.next_attempt_at);
  assert.equal((await f.services.webhookInbox.processDue()).items[0].processing_state, "PROCESSED");
  assert.deepEqual(await actionState(f, action.id), original);

  const executed = await f.services.actionExecutor.execute(action);
  assert.equal(executed.outcome_class, "ACCEPTED");
  assert.equal(f.calls.length, 1);
  assert.equal(await f.services.executionsRepository.countForAction(action.id), 1);
  const current = await f.services.actionsRepository.getAction(action.id);
  assert.equal(current.current_revision_id, original.action.current_revision_id);
  assert.equal(current.max_attempts, original.action.max_attempts);
  assert.equal(current.first_dispatch_at, new Date(f.clock.value).toISOString());
  assert.equal(Date.parse(current.retry_deadline_at) - f.clock.value, f.services.actionExecutor.policy.retryWindowMs);
  assert.deepEqual((await actionState(f, action.id)).approval, original.approval);
  assert.deepEqual((await actionState(f, action.id)).decisions, original.decisions);
});

test("pending policy conservatively covers every contact in its workspace while another workspace remains eligible", async (t) => {
  const f = await fixture(t), local = await f.reviewedAction();
  const otherOrg = await f.services.leadsRepository.createOrganization({ name: "Independent workspace" });
  const other = await f.reviewedAction(otherOrg.id, "other@example.test");
  const receipt = await f.services.webhookInbox.receive(f.command("unresolved-contact", {
    event: "unsubscribe", sg_event_id: "unresolved-contact", email: "different-contact@example.test"
  }, "SENDGRID_EVENT"));
  assert.equal(receipt.row.mandatory_policy_status, "PENDING");
  const localPolicy = await f.services.contactPolicyService.inspectLead({ organization_id: local.action.organization_id, lead_id: local.lead.id, channel: "EMAIL" });
  const otherPolicy = await f.services.contactPolicyService.inspectLead({ organization_id: other.action.organization_id, lead_id: other.lead.id, channel: "EMAIL" });
  assert.equal(localPolicy.policy_pending, true);
  assert.equal(otherPolicy.policy_pending, false);
  assert.equal((await f.services.actionExecutor.execute(local.action)).deferred, true);
  assert.equal((await f.services.actionExecutor.execute(other.action)).outcome_class, "ACCEPTED");
  assert.deepEqual(f.calls, [other.action.id]);
  assert.equal(await f.services.executionsRepository.countForAction(local.action.id), 0);
});

test("quarantined pending policy still defers sends and existing contact restrictions retain priority", async (t) => {
  const f = await fixture(t), { lead, action } = await f.reviewedAction();
  f.services.webhookInbox.handlers.EXECUTION_CALLBACK = async () => {
    throw Object.assign(new Error("Synthetic unresolved identity"), { statusCode: 400 });
  };
  const received = await f.services.webhookInbox.receiveAndProcess(f.command("unresolved", { event: "synthetic" }), { throwOnProcessingError: false });
  assert.equal(received.receipt.processing_state, "QUARANTINED");
  assert.equal(received.receipt.mandatory_policy_status, "PENDING");
  assert.equal((await f.services.actionExecutor.execute(action)).deferred, true);
  await f.services.contactPolicyService.restrictContact({ organization_id: action.organization_id,
    contact: { kind: "EMAIL", value: lead.email }, channel: "EMAIL", reason: "UNSUBSCRIBE",
    source: "PROVIDER_EVENT", source_event_id: "confirmed-separate-restriction" });
  const policy = await f.services.contactPolicyService.inspectLead({ organization_id: action.organization_id, lead_id: lead.id, channel: "EMAIL" });
  assert.equal(policy.policy_pending, true);
  assert.equal(policy.restricted, true);
  assert.equal(policy.reason, "CONTACT_RESTRICTED");
  const result = await f.services.actionExecutor.execute(action);
  assert.equal(result.executable, false);
  assert.notEqual(result.deferred, true);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.services.executionsRepository.countForAction(action.id), 0);
});
