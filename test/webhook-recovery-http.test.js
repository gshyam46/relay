import test from "node:test";
import assert from "node:assert/strict";
import { provisionEmailWebhooks } from "./helpers/emailSetup.js";
import { startClient } from "./helpers/testClient.js";
import { assertReceiptOwnership } from "../src/modules/webhook-inbox/webhookInboxService.js";

async function fixture(t) {
  const client = await startClient(t);
  const owner = await client.register("Event recovery owner");
  const paths = await provisionEmailWebhooks(client, owner.organization.id);
  return { client, owner, paths };
}
async function postProvider(client, path, events) {
  const response = await fetch(client.baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(events) });
  return { status: response.status, body: await response.json() };
}
async function review(client, id, body) {
  const response = await client.rawFetch("/api/webhook-receipts/" + id + "/review", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test("batch receipt persistence is all acknowledged only after storage and replay does not repeat first-item effects", async (t) => {
  const { client, paths } = await fixture(t);
  await client.db.exec("CREATE TRIGGER fail_second_receipt BEFORE INSERT ON webhook_receipts WHEN NEW.provider_event_id='two' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
  const events = [
    { event: "unsubscribe", sg_event_id: "one", email: "one@example.test", api_key: "must-not-persist" },
    { event: "unsubscribe", sg_event_id: "two", email: "two@example.test" }
  ];
  assert.equal((await postProvider(client, paths.events_path, events)).status, 503);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 1);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM contact_restrictions")).n, 0);
  await client.db.exec("DROP TRIGGER fail_second_receipt");
  const accepted = await postProvider(client, paths.events_path, events);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.received, 2);
  assert.equal(accepted.body.processed, 2);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM webhook_receipts")).n, 2);
  const restrictions = await client.db.all("SELECT * FROM contact_restrictions ORDER BY id");
  assert.equal((await postProvider(client, paths.events_path, events)).status, 200);
  assert.deepEqual(await client.db.all("SELECT * FROM contact_restrictions ORDER BY id"), restrictions);
  assert.doesNotMatch(JSON.stringify(await client.db.all("SELECT * FROM webhook_receipts")), /must-not-persist|api_key/);
});

test("changed authenticated opt-out retains a conflict and applies only the new recipient policy", async (t) => {
  const { client, paths, owner } = await fixture(t);
  await postProvider(client, paths.events_path, [{ event: "unsubscribe", sg_event_id: "same", email: "first@example.test" }]);
  const conflict = await postProvider(client, paths.events_path, [{ event: "unsubscribe", sg_event_id: "same", email: "second@example.test" }]);
  assert.equal(conflict.status, 200);
  assert.equal(conflict.body.processed, 0);
  const list = await client.get("/api/webhook-receipts");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].processing_state, "QUARANTINED");
  assert.equal(list.items[0].mandatory_policy_status, "DONE");
  const rows = await client.db.all("SELECT * FROM contact_restrictions WHERE organization_id=?", [owner.organization.id]);
  assert.ok(JSON.stringify(rows).includes("first@example.test"));
  assert.ok(JSON.stringify(rows).includes("second@example.test"));
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM callbacks")).n, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM channel_messages")).n, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("owner receipt views paginate and review binds actor and fence while foreign access is denied", async (t) => {
  const { client, owner, paths } = await fixture(t);
  await postProvider(client, paths.events_path, [
    { event: "delivered", sg_event_id: "unknown-one", relay_action_id: "missing-one" },
    { event: "delivered", sg_event_id: "unknown-two", relay_action_id: "missing-two" }
  ]);
  const list = await client.get("/api/webhook-receipts?limit=1");
  assert.equal(list.total, 2);
  assert.equal(list.has_more, true);
  const item = list.items[0];
  const detail = await client.get("/api/webhook-receipts/" + item.id);
  assert.equal(detail.normalized_input_json, undefined);
  assert.equal(detail.lease_owner, undefined);
  assert.equal(detail.can_close, true);
  const input = { expected_fence: detail.processing_fence, decision: "CLOSE", evidence_note: "Reviewed unsupported historical reference.", reviewer_user_id: "forged" };
  assert.equal((await review(client, item.id, { ...input, expected_fence: 999 })).status, 409);
  assert.equal((await review(client, item.id, input)).status, 200);
  assert.equal((await review(client, item.id, input)).body.duplicate, true);
  assert.equal((await client.db.get("SELECT reviewer_user_id FROM webhook_receipt_reviews WHERE receipt_id=?", [item.id])).reviewer_user_id, owner.user.id);
  const other = await client.register("Other event owner");
  assert.equal((await client.get("/api/webhook-receipts?state=ALL")).total, 0);
  assert.equal((await client.rawFetch("/api/webhook-receipts/" + item.id)).status, 404);
  assert.equal((await review(client, item.id, input)).status, 404);
  await client.db.run("UPDATE users SET role='VIEWER' WHERE id=?", [other.user.id]);
  assert.equal((await client.rawFetch("/api/webhook-receipts")).status, 403);
  assert.equal((await review(client, item.id, input)).status, 403);
});

test("owner retry schedules the original event and the normal worker completes it", async (t) => {
  const { client, owner } = await fixture(t);
  const inbox = client.services.webhookInbox;
  let fails = true, calls = 0;
  inbox.handlers.EXECUTION_CALLBACK = async (_, { receipt }) => {
    calls++;
    await client.services.contactPolicyService.withWorkspacePolicyTransaction(owner.organization.id, async (tx) => {
      await assertReceiptOwnership(tx, receipt);
      await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
    });
    if (fails) throw Object.assign(new Error("missing synthetic source"), { statusCode: 404 });
    return { restored: true };
  };
  const event = await inbox.receiveAndProcess({ organization_id: owner.organization.id, provider: "synthetic", connection_key: "application",
    event_kind: "EXECUTION_CALLBACK", provider_event_id: "repairable", verification_kind: "TRUSTED_INTERNAL", input: { original: "immutable" } }, { throwOnProcessingError: false });
  fails = false;
  const saved = await review(client, event.receipt.id, { expected_fence: event.receipt.processing_fence, decision: "RETRY", evidence_note: "Restored the required source record." });
  assert.equal(saved.status, 200);
  assert.equal(calls, 1);
  await client.post("/api/worker/run", {});
  assert.equal((await client.get("/api/webhook-receipts/" + event.receipt.id)).processing_state, "PROCESSED");
  assert.equal(calls, 2);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM action_executions")).n, 0);
});

test("repeated Parse identity fields are retained as reviewable ambiguity instead of silently overwriting", async (t) => {
  const { client, paths } = await fixture(t);
  const boundary = "synthetic-duplicate-identity";
  const fields = [["from", "first@example.test"], ["from", "second@example.test"], ["text", "Hello"],
    ["headers", "Message-ID: <duplicate@example.test>"]];
  const body = fields.map(([name, value]) => "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").join("") + "--" + boundary + "--\r\n";
  const response = await fetch(client.baseUrl + paths.inbound_path, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=" + boundary }, body });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).processing_state, "QUARANTINED");
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM inbound_events")).n, 0);
  assert.equal((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n, 0);
  const stored = await client.db.get("SELECT * FROM webhook_receipts");
  assert.match(stored.normalized_input_json, /INBOUND_IDENTITY_AMBIGUOUS/);
});
