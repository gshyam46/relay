import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";

for (const [label, payload, expectedSubject, expectedBody] of [
  ["internal rationale", { title: "Invented budget", rationale: "The lead has a $50000 budget", reason: "Your prior enquiry" },
    "A quick question", "Would you be open to a conversation?"],
  ["explicit copy", { subject: "Reviewed subject", message: "Reviewed body.", rationale: "Internal reason" },
    "Reviewed subject", "Reviewed body."],
  ["edited instruction", { subject: "Original", message: "Original body", human_review: { edited_payload: { subject: "Final subject", instruction: "Final approved copy." } } },
    "Final subject", "Final approved copy."],
  ["edited message", { message: "Original body", human_review: { edited_payload: { message: "Edited message body." } } },
    "A quick question", "Edited message body."]
]) {
  test("provider and persisted conversation agree for " + label, async (t) => {
    const client = await startClient(t);
    const owner = await client.register("Copy parity");
    const { lead } = await client.post("/api/leads", { name: "Recipient", email: "recipient@example.com" });
    const captured = [];
    client.services.emailAdapter.send = async (organizationId, copy) => {
      assert.equal(organizationId, owner.organization.id);
      captured.push(copy);
      return { ok: true, provider: "test-capture", provider_reference: "captured-send" };
    };
    await client.services.settingsRepository.setBulk(owner.organization.id, "channel_email", { provider: "resend", api_key: "fixture-key", from_email: "sender@example.test" });
    const action = await client.services.actionsRepository.createAction({
      organization_id: owner.organization.id, lead_id: lead.id, type: "SEND_EMAIL",
      idempotency_key: "parity:" + label, payload
    });
    await client.approve(action.id);
    const result = await client.post("/api/actions/" + action.id + "/execute", {});
    assert.equal(result.action.status, "EXECUTING");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].subject, expectedSubject);
    assert.equal(captured[0].body, expectedBody);
    const saved = await client.db.get("SELECT * FROM channel_messages WHERE action_id = ?", [action.id]);
    assert.equal(saved.subject, captured[0].subject);
    assert.equal(saved.body, captured[0].body);
    assert.equal(saved.summary, captured[0].body);
  });
}
