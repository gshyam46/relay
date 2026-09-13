import test from "node:test";
import assert from "node:assert/strict";
import { createServices } from "../src/api/app.js";
import { createUnitOfWork } from "../src/database/unitOfWork.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { ApprovalsRepository } from "../src/modules/outbound-automation/approvalsRepository.js";
import { ApprovalsService } from "../src/modules/outbound-automation/approvalsService.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { startClient } from "./helpers/testClient.js";

async function fixture(t) {
  const client = await startClient(t);
  const organization = await client.services.leadsRepository.createOrganization({ name: "Approval transaction fixture" });
  const lead = await client.services.leadsRepository.createLead({
    organization_id: organization.id, name: "Synthetic lead", email: "lead@example.test"
  });
  const action = await client.services.actionsRepository.createAction({
    organization_id: organization.id, lead_id: lead.id, type: "SEND_EMAIL",
    idempotency_key: organization.id + ":review", status: "AWAITING_APPROVAL",
    approval_requirement: "REQUIRED", payload: { message: "Original reviewed draft" }
  });
  return { client, action, input: { organization_id: organization.id, action_id: action.id, reviewer_user_id: "fixture-reviewer" } };
}

function failingApprovalWork(db, organizationId, work) {
  return new ContactPolicyService(db).withWorkspacePolicyTransaction(organizationId, (tx) => {
    const auditRepository = new AuditRepository(tx);
    const record = auditRepository.record.bind(auditRepository);
    auditRepository.record = async (input) => {
      await record(input);
      throw new Error("Injected failure after audit persistence");
    };
    return work(new ApprovalsService({
      actionsRepository: new ActionsRepository(tx), approvalsRepository: new ApprovalsRepository(tx), auditRepository
    }));
  });
}

test("approval unit of work commits exact reviewed payload, actor audit and immutable decision once", async (t) => {
  const { client, action, input } = await fixture(t);
  const service = client.services.approvalsService;
  const first = await service.currentForAction(input);
  const edited = await service.previewAction({ ...input, expected_revision_id: first.prepared_revision.id,
    edited_payload: { body: "A human-reviewed message", subject: "Hello" } });
  const decisionInput = { ...input, expected_revision_id: edited.prepared_revision.id };
  const result = await service.approveAction(decisionInput);
  assert.equal(result.action.status, "APPROVED");
  assert.equal(result.prepared_revision.envelope.body, "A human-reviewed message");
  const duplicate = await service.approveAction(decisionInput);
  assert.equal(duplicate.approval.id, result.approval.id);
  await assert.rejects(service.approveAction({ ...decisionInput, edited_payload: { body: "Must not overwrite" } }),
    { code: "EDIT_PREVIEW_REQUIRED" });
  assert.equal((await service.currentForAction(input)).prepared_revision.envelope.body, "A human-reviewed message");
  const audits = await client.db.all("SELECT * FROM audit_logs WHERE action_id = ? AND event_type = 'ActionApproved'", [action.id]);
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].metadata_json).reviewer_user_id, input.reviewer_user_id);
  assert.equal((await client.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ?", [action.id])).length, 1);
});

test("failed initial preview rolls back revision, pending projection, action pointer and audit together", async (t) => {
  const { client, action, input } = await fixture(t);
  const before = await client.services.actionsRepository.getAction(action.id);
  await assert.rejects(failingApprovalWork(client.db, input.organization_id,
    (service) => service.currentForAction(input)), /Injected failure after audit persistence/);
  assert.deepEqual(await client.services.actionsRepository.getAction(action.id), before);
  for (const table of ["action_revisions", "action_approvals", "audit_logs"]) {
    assert.deepEqual(await client.db.all("SELECT * FROM " + table + " WHERE action_id = ?", [action.id]), []);
  }
  assert.ok((await client.services.approvalsService.currentForAction(input)).prepared_revision);
});

for (const decision of ["approveAction", "rejectAction"]) {
  test(decision + " failure rolls back the immutable decision, current projection, action and audit", async (t) => {
    const { client, action, input } = await fixture(t);
    const preview = await client.services.approvalsService.currentForAction(input);
    const decisionInput = { ...input, expected_revision_id: preview.prepared_revision.id };
    const beforeAction = await client.services.actionsRepository.getAction(action.id);
    const beforeApproval = await client.services.approvalsRepository.getByActionId(action.id, input.organization_id);
    const beforeAudit = await client.db.all("SELECT * FROM audit_logs WHERE action_id = ?", [action.id]);
    await assert.rejects(failingApprovalWork(client.db, input.organization_id,
      (service) => service[decision](decisionInput)), /Injected failure after audit persistence/);
    assert.deepEqual(await client.services.actionsRepository.getAction(action.id), beforeAction);
    assert.deepEqual(await client.services.approvalsRepository.getByActionId(action.id, input.organization_id), beforeApproval);
    assert.deepEqual(await client.db.all("SELECT * FROM audit_logs WHERE action_id = ?", [action.id]), beforeAudit);
    assert.deepEqual(await client.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ?", [action.id]), []);
    const recovered = await client.services.approvalsService[decision](decisionInput);
    assert.equal(recovered.approval.status, decision === "approveAction" ? "APPROVED" : "REJECTED");
  });
}

test("competing approve and reject produce one consistent immutable decision and one decision audit", async (t) => {
  const { client, action, input } = await fixture(t);
  const preview = await client.services.approvalsService.currentForAction(input);
  const decisionInput = { ...input, expected_revision_id: preview.prepared_revision.id };
  const competingService = createServices(client.db).approvalsService;
  const results = await Promise.allSettled([
    client.services.approvalsService.approveAction(decisionInput), competingService.rejectAction(decisionInput)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 409);
  const approval = await client.services.approvalsRepository.getByActionId(action.id, input.organization_id);
  const stored = await client.services.actionsRepository.getAction(action.id);
  assert.equal(stored.status, approval.status === "APPROVED" ? "APPROVED" : "BLOCKED");
  assert.equal((await client.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ?", [action.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM audit_logs WHERE action_id = ? AND event_type IN ('ActionApproved','ActionRejected')", [action.id])).length, 1);
});

test("competing approval requests and reads create only one pending record and one revision", async (t) => {
  const { client, action, input } = await fixture(t);
  const service = client.services.approvalsService;
  const second = createServices(client.db).approvalsService;
  const [first, current, repeated] = await Promise.all([
    service.requestForAction(action, { requested_reason: "Review first" }),
    second.currentForAction(input), second.requestForAction(action, { requested_reason: "Review again" })
  ]);
  assert.equal(first.id, current.approval.id);
  assert.equal(first.id, repeated.id);
  assert.equal((await client.db.all("SELECT * FROM action_approvals WHERE action_id = ?", [action.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM action_revisions WHERE action_id = ?", [action.id])).length, 1);
});

test("approval transaction validates tenant ownership before creating or editing review state", async (t) => {
  const { client, action, input } = await fixture(t);
  const wrong = { ...input, organization_id: "another-workspace" };
  for (const method of ["currentForAction", "approveAction", "rejectAction"]) {
    await assert.rejects(client.services.approvalsService[method](wrong), { statusCode: 404 });
  }
  assert.equal(await client.services.approvalsRepository.getByActionId(action.id, action.organization_id), null);
  assert.equal((await client.services.actionsRepository.getAction(action.id)).status, "AWAITING_APPROVAL");
  assert.deepEqual(await client.db.all("SELECT * FROM audit_logs WHERE action_id = ?", [action.id]), []);
});

test("approval composition rejects unscoped or mixed repositories and contexts expire", async (t) => {
  const { client } = await fixture(t);
  assert.throws(() => new ApprovalsService({
    actionsRepository: client.services.actionsRepository,
    approvalsRepository: client.services.approvalsRepository, auditRepository: client.services.auditRepository
  }), /bound to one transaction/);
  await assert.rejects(client.services.actionsRepository.getActionForUpdate("missing", "missing"), /transaction-scoped/);
  let escaped;
  await createUnitOfWork(client.db, (tx) => {
    assert.throws(() => new ApprovalsService({
      actionsRepository: new ActionsRepository(tx), approvalsRepository: new ApprovalsRepository(tx),
      auditRepository: client.services.auditRepository
    }), /bound to one transaction/);
    return { actionsRepository: new ActionsRepository(tx) };
  }).run((context) => { escaped = context.actionsRepository; });
  await assert.rejects(escaped.getAction("missing"), /complet|active|closed/i);
});

for (const status of ["EXECUTING", "COMPLETED", "BLOCKED", "FAILED"]) {
  test("review cannot reactivate " + status + " action with missing revision metadata", async (t) => {
    const { client, action, input } = await fixture(t);
    await client.services.actionsRepository.updateStatus(action.id, status);
    const service = client.services.approvalsService;
    const detail = await service.currentForAction(input);
    assert.equal(detail.prepared_revision, null);
    for (const method of ["approveAction", "rejectAction"]) {
      await assert.rejects(service[method]({ ...input, expected_revision_id: "unreviewed" }), { statusCode: 409 });
    }
    assert.equal((await client.services.actionsRepository.getAction(action.id)).status, status);
    assert.equal(await client.services.approvalsRepository.getByActionId(action.id, action.organization_id), null);
    assert.deepEqual(await client.db.all("SELECT * FROM audit_logs WHERE action_id = ?", [action.id]), []);
  });
}

for (const status of ["PLANNED", "APPROVED", "RETRYING"]) {
  test("legacy " + status + " message must receive a fresh exact preview without automatic approval", async (t) => {
    const { client, action, input } = await fixture(t);
    await client.services.actionsRepository.updateStatus(action.id, status);
    const detail = await client.services.approvalsService.currentForAction(input);
    assert.equal(detail.action.status, "AWAITING_APPROVAL");
    assert.equal(detail.approval.status, "PENDING");
    assert.ok(detail.prepared_revision);
    assert.deepEqual(await client.db.all("SELECT * FROM action_revision_decisions WHERE action_id = ?", [action.id]), []);
  });
}

test("repeating the exact approved decision after completion preserves execution history", async (t) => {
  const { client, action, input } = await fixture(t);
  const service = client.services.approvalsService;
  const preview = await service.currentForAction(input);
  const decisionInput = { ...input, expected_revision_id: preview.prepared_revision.id };
  const approved = await service.approveAction(decisionInput);
  await client.services.actionsRepository.updateStatus(action.id, "COMPLETED");
  const repeated = await service.approveAction(decisionInput);
  assert.equal(repeated.action.status, "COMPLETED");
  assert.equal(repeated.approval.id, approved.approval.id);
  assert.equal((await client.db.all("SELECT * FROM audit_logs WHERE action_id = ? AND event_type = 'ActionApproved'", [action.id])).length, 1);
});
