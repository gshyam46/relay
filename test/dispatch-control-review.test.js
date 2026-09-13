import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { approveStoredAction } from "./helpers/review.js";

const DAY = Date.parse("2026-09-11T10:00:00.000Z"), MIDNIGHT = Date.parse("2026-09-12T00:00:00.000Z");
test("UTC-day quota inspection and authorization use one captured instant across midnight", async (t) => {
  const client = await startClient(t), registered = await client.register("Synthetic boundary workspace");
  const org = registered.organization.id, actor = registered.user.id;
  const { actionsRepository: actions, executionsRepository: executions, actionExecutor: executor, dispatchControlsService: controls } = client.services;
  const lead = await client.services.leadsRepository.createLead({ organization_id: org, name: "Synthetic recipient", email: "boundary@example.test" });
  let now = DAY, calls = 0; executor.now = () => now; executor.channelWorkflowService = null;
  executor.adapter = { async invoke() { calls++; return { ok: true, provider: "synthetic", provider_reference: "synthetic:" + calls }; } };
  await controls.update({ organization_id: org, actor, expected_revision: 0, paused: false, daily_attempt_limit: 1, unresolved_limit: 2, reason: "Synthetic single attempt daily allowance." });
  async function action(key) {
    const row = await actions.createAction({ organization_id: org, lead_id: lead.id, type: "SEND_EMAIL", idempotency_key: key,
      payload: { subject: "Reviewed question", message: "Synthetic boundary check." } });
    await approveStoredAction(client.services, row); return row;
  }
  const first = await action("boundary-first"), second = await action("boundary-second");
  assert.equal((await executor.execute(first)).dispatched, true); assert.equal(calls, 1);
  let reads = 0;
  executor.now = () => ++reads === 1 ? MIDNIGHT - 1 : MIDNIGHT;
  const result = await executor.execute(second);
  assert.equal(result.operations_hold, "DAILY_DISPATCH_LIMIT");
  assert.equal(calls, 1); assert.equal(await executions.countForAction(second.id), 0);
  assert.equal((await actions.getAction(second.id)).status, "APPROVED");
  // The next independent admission may legitimately use the next UTC day.
  executor.now = () => MIDNIGHT;
  assert.equal((await executor.execute(second)).dispatched, true); assert.equal(calls, 2);
  const stored = await executions.listForAction(second.id);
  assert.equal(stored[0].dispatch_authorized_at, new Date(MIDNIGHT).toISOString());
});
