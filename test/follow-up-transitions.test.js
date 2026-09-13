import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { FollowUpsRepository } from "../src/modules/channels/followUpsRepository.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const services = createServices(db);
  const organization = await services.leadsRepository.createOrganization({ name: "Synthetic follow-up transitions" });
  const foreign = await services.leadsRepository.createOrganization({ name: "Independent workspace" });
  const lead = await services.leadsRepository.createLead({ organization_id: organization.id, name: "Synthetic contact", email: "followup@example.test" });
  let sequence = 0;
  const create = (status) => services.followUpsRepository.create({ organization_id: organization.id, lead_id: lead.id,
    channel: "EMAIL", status, due_at: status === "BLOCKED" ? "invalid-date" : "2026-09-11T10:00:00.000Z",
    reason: "Review a synthetic question.", idempotency_key: "follow-up-transition:" + ++sequence });
  const command = (row, organizationId = organization.id) => ({ organization_id: organizationId, follow_up_id: row.id });
  const current = (row) => services.followUpsRepository.getForOrganization(row.id, organization.id);
  const audits = () => db.all("SELECT * FROM audit_logs WHERE event_type IN ('FollowUpCompleted','FollowUpCancelled') ORDER BY created_at,id");
  return { db, services, organization, foreign, lead, create, command, current, audits };
}

test("open follow-ups complete once and repeat requests preserve completion history", async (t) => {
  const f = await fixture(t);
  for (const status of ["PLANNED", "DUE"]) {
    const task = await f.create(status);
    const result = await f.services.channelWorkflowService.completeFollowUp(f.command(task));
    assert.equal(result.duplicate, false);
    assert.equal(result.follow_up.status, "COMPLETED");
    assert.ok(result.follow_up.completed_at);
    assert.equal(result.follow_up.completed_at, result.follow_up.updated_at);
    const saved = await f.current(task);
    const duplicate = await f.services.channelWorkflowService.completeFollowUp(f.command(task));
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.follow_up, saved);
    assert.deepEqual(await f.current(task), saved);
  }
  const logs = await f.audits();
  assert.equal(logs.length, 2);
  for (const log of logs) {
    assert.equal(log.event_type, "FollowUpCompleted");
    assert.equal(log.organization_id, f.organization.id);
    assert.equal(log.lead_id, f.lead.id);
    const metadata = JSON.parse(log.metadata_json);
    assert.equal(metadata.status, "COMPLETED");
    assert.ok(["PLANNED", "DUE"].includes(metadata.previous_status));
    assert.ok(metadata.follow_up_id);
  }
});

test("open or blocked follow-ups can be cancelled once without fabricating completion", async (t) => {
  const f = await fixture(t);
  for (const status of ["PLANNED", "DUE", "BLOCKED"]) {
    const task = await f.create(status);
    const result = await f.services.channelWorkflowService.cancelFollowUp(f.command(task));
    assert.equal(result.duplicate, false);
    assert.equal(result.follow_up.status, "CANCELLED");
    assert.equal(result.follow_up.completed_at, null);
    assert.equal(result.follow_up.reason, task.reason);
    assert.equal(result.follow_up.due_at, task.due_at);
    const saved = await f.current(task);
    const duplicate = await f.services.channelWorkflowService.cancelFollowUp(f.command(task));
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.follow_up, saved);
  }
  const logs = await f.audits();
  assert.equal(logs.length, 3);
  for (const log of logs) assert.equal(log.event_type, "FollowUpCancelled");
});

test("blocked, cancelled and unknown follow-ups cannot be completed; completed tasks cannot be cancelled", async (t) => {
  const f = await fixture(t);
  for (const status of ["BLOCKED", "CANCELLED", "UNKNOWN_LEGACY"]) {
    const task = await f.create(status), before = await f.current(task);
    await assert.rejects(f.services.channelWorkflowService.completeFollowUp(f.command(task)), { statusCode: 409, code: "FOLLOW_UP_STATE_CONFLICT" });
    assert.deepEqual(await f.current(task), before);
  }
  const task = await f.create("DUE");
  await f.services.channelWorkflowService.completeFollowUp(f.command(task));
  const completed = await f.current(task);
  await assert.rejects(f.services.channelWorkflowService.cancelFollowUp(f.command(task)), { statusCode: 409, code: "FOLLOW_UP_STATE_CONFLICT" });
  assert.deepEqual(await f.current(task), completed);
  const unknown = await f.create("UNKNOWN_LEGACY"), previous = await f.current(unknown);
  await assert.rejects(f.services.channelWorkflowService.cancelFollowUp(f.command(unknown)), { statusCode: 409, code: "FOLLOW_UP_STATE_CONFLICT" });
  assert.deepEqual(await f.current(unknown), previous);
  assert.equal((await f.audits()).length, 1, "rejected transitions never append success audits");
});

test("concurrent completion and cancellation have one winner and preserve its terminal outcome", async (t) => {
  const f = await fixture(t), task = await f.create("DUE");
  const outcomes = await Promise.allSettled([
    f.services.channelWorkflowService.completeFollowUp(f.command(task)),
    f.services.channelWorkflowService.cancelFollowUp(f.command(task))
  ]);
  const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const losers = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "FOLLOW_UP_STATE_CONFLICT");
  assert.equal(losers[0].reason.statusCode, 409);
  const saved = await f.current(task);
  assert.equal(saved.status, winners[0].value.follow_up.status);
  assert.equal(winners[0].value.duplicate, false);
  assert.equal((await f.audits()).length, 1);
  const repeat = saved.status === "COMPLETED" ? "completeFollowUp" : "cancelFollowUp";
  assert.equal((await f.services.channelWorkflowService[repeat](f.command(task))).duplicate, true);
  assert.deepEqual(await f.current(task), saved);
});

test("concurrent identical requests return one transition and one duplicate with one audit", async (t) => {
  const f = await fixture(t), task = await f.create("PLANNED");
  const results = await Promise.all([
    f.services.channelWorkflowService.completeFollowUp(f.command(task)),
    f.services.channelWorkflowService.completeFollowUp(f.command(task))
  ]);
  assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
  assert.deepEqual(results[0].follow_up, results[1].follow_up);
  assert.equal((await f.audits()).length, 1);
});

test("workspace scope and transaction authority prevent foreign or unguarded follow-up changes", async (t) => {
  const f = await fixture(t), task = await f.create("DUE"), before = await f.current(task);
  for (const method of ["completeFollowUp", "cancelFollowUp"]) {
    await assert.rejects(f.services.channelWorkflowService[method](f.command(task, f.foreign.id)), { statusCode: 404 });
    await assert.rejects(f.services.channelWorkflowService[method]({ organization_id: f.organization.id, follow_up_id: "missing" }), { statusCode: 404 });
  }
  for (const method of ["complete", "cancel"]) {
    await assert.rejects(f.services.followUpsRepository[method](task.id, f.organization.id), /matching workspace transaction gate/);
    await assert.rejects(f.services.contactPolicyService.withWorkspacePolicyTransaction(f.foreign.id,
      (tx) => new FollowUpsRepository(tx)[method](task.id, f.organization.id)), /matching workspace transaction gate/);
  }
  assert.deepEqual(await f.current(task), before);
  assert.equal((await f.audits()).length, 0);
});

test("audit persistence failure rolls back the follow-up transition and allows a single successful retry", async (t) => {
  const f = await fixture(t), task = await f.create("DUE"), before = await f.current(task);
  await f.db.exec("CREATE TRIGGER fail_follow_up_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='FollowUpCompleted' BEGIN SELECT RAISE(ABORT,'synthetic audit storage failure'); END");
  await assert.rejects(f.services.channelWorkflowService.completeFollowUp(f.command(task)), /synthetic audit storage failure/);
  assert.deepEqual(await f.current(task), before);
  assert.equal((await f.audits()).length, 0);
  await f.db.exec("DROP TRIGGER fail_follow_up_audit");
  const result = await f.services.channelWorkflowService.completeFollowUp(f.command(task));
  assert.equal(result.duplicate, false);
  assert.equal(result.follow_up.status, "COMPLETED");
  assert.equal((await f.audits()).length, 1);
});
