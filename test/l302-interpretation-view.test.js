import test from "node:test";
import assert from "node:assert/strict";
import { publicReplyInterpretation } from "../src/modules/channels/replyInterpretationView.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { LlmReplyClassifier } from "../src/modules/ai/llmReplyClassifier.js";
import { LlmSynthesisAgent } from "../src/modules/ai/llmSynthesisAgent.js";
import { startClient } from "./helpers/testClient.js";

function message(body, classification = new LocalReplyClassifier().classify(body)) {
  return { direction: "INBOUND", body, classification_event_type: classification.event_type,
    classification_confidence: classification.confidence, payload: { classification } };
}
test("reply view preserves stop handling independently of uncertainty and validated original evidence", () => {
  const row = message("Please unsubscribe me.");
  const result = publicReplyInterpretation(row);
  assert.equal(result.event_type, "OPT_OUT");
  assert.equal(result.generation.mode, "LOCAL_POLICY");
  assert.equal(row.body.slice(result.evidence.start, result.evidence.end), result.evidence.quote);
  row.payload.classification.evidence.quote = "fabricated";
  assert.equal(publicReplyInterpretation(row).evidence, null);
  assert.equal(publicReplyInterpretation(row).review_required, true);
  assert.equal(publicReplyInterpretation(row).event_type, "OPT_OUT");
});

test("missing, malformed and historical method metadata cannot be relabeled or reflect exceptions", () => {
  const row = message("Please unsubscribe me.");
  for (const classification of [
    null, { event_type: "OPT_OUT", confidence: "HIGH", reason: "private provider error" },
    { ...row.payload.classification, reason: "private provider error", generation: { mode: "LLM_CLASSIFICATION", grounding_version: "old" } },
    { ...row.payload.classification, event_type: "POSITIVE_REPLY" },
    { ...row.payload.classification, reason: "x".repeat(9000) },
    { ...row.payload.classification, generation: { ...row.payload.classification.generation, reason: "private provider error" } }
  ]) {
    const result = publicReplyInterpretation({ ...row, payload: { classification } });
    assert.equal(result.event_type, "OPT_OUT");
    assert.equal(result.generation, null);
    assert.equal(result.review_required, true);
    assert.equal(JSON.stringify(result).includes("private provider error"), false);
  }
  assert.equal(publicReplyInterpretation({ ...row, direction: "OUTBOUND" }), null);
});

test("inconsistent or unrecognized metadata cannot imply trustworthy contact-stop evidence", () => {
  for (const mutate of [
    row => { row.payload.classification.evidence = null; },
    row => { row.payload.classification.generation.reply_policy_version = "unknown-future-version"; },
    row => { row.payload.classification.generation.reason = "POSITIVE_WORDING"; }
  ]) {
    const row = message("Please unsubscribe me."); mutate(row);
    const result = publicReplyInterpretation(row);
    assert.equal(result.event_type, "OPT_OUT");
    assert.equal(result.generation, null);
    assert.equal(result.review_required, true);
  }
});

test("unrecognized model suggestion stays UNKNOWN with exact evidence and no leaked provider identifiers", async () => {
  const body = "That proposal deserves consideration.";
  const classification = await new LlmReplyClassifier({
    info: { provider: "https://private.invalid/key", model: "sk-secret" },
    async jsonCompletion() { return { event_type: "POSITIVE_REPLY", confidence: "HIGH", evidence_quote: body }; }
  }).classify(body);
  const result = publicReplyInterpretation(message(body, classification));
  assert.equal(result.event_type, "UNKNOWN");
  assert.equal(result.review_required, true);
  assert.equal(result.candidate.event_type, "POSITIVE_REPLY");
  assert.equal(result.candidate.evidence.quote, body);
  assert.equal(result.generation.provider, null);
  assert.equal(result.generation.model, null);
});

test("empty model fact selection is explicit fallback and cannot mark assessment ready", async () => {
  const lead = { id: "lead", organization_id: "org", name: "Synthetic", status: "NEW" };
  const input = { lead, snapshot: { id: "snapshot", organization_id: "org", lead_id: "lead", status: "READY", claims: [{ id: "claim", organization_id: "org", lead_id: "lead", snapshot_id: "snapshot", field: "LEAD_NAME", value: "Synthetic", confidence: "HIGH", evidence_ids: ["evidence"] }], evidence: [{ id: "evidence", organization_id: "org", lead_id: "lead", snapshot_id: "snapshot", claim_field: "LEAD_NAME", claim_value: "Synthetic" }] } };
  const result = await new LlmSynthesisAgent({ async jsonCompletion() { return { selected_claims: [] }; } }).synthesize(input);
  assert.equal(result.summary.generation.mode, "DETERMINISTIC_FALLBACK");
  assert.equal(result.summary.generation.reason, "NO_SUPPORTED_SELECTION");
  assert.equal(result.qualification.outcome, "NEEDS_REVIEW");
  assert.deepEqual(result.summary.claims, []);
});

test("persisted reply details and nullable original text agree across inbox and lead timeline", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Interpretation fixture");
  const { lead } = await client.post("/api/leads", { organization_id: organization.id, name: "Synthetic reply", email: "reply@example.test" });
  const body = "What is the price?\nThanks";
  await client.post("/api/inbound-events/mock", { organization_id: organization.id, lead_id: lead.id, channel: "EMAIL", provider_event_id: "l302-view", payload: { text: body } });
  const timeline = await client.get("/api/leads/" + lead.id + "/timeline");
  const item = timeline.timeline.find(item => item.kind === "message");
  assert.equal(item.original_text, body);
  assert.equal(item.interpretation.event_type, "QUESTION");
  assert.equal(item.interpretation.generation.mode, "DETERMINISTIC_CLASSIFICATION");
  const rows = await client.services.channelMessagesRepository.listForLead(organization.id, lead.id);
  assert.deepEqual(rows[0].interpretation, item.interpretation);
  const inbox = await client.get("/api/channels/messages?organization_id=" + organization.id);
  assert.deepEqual(inbox.messages[0].interpretation, item.interpretation);
  await client.db.run("UPDATE channel_messages SET body = NULL WHERE id = ?", [rows[0].id]);
  const absent = (await client.get("/api/leads/" + lead.id + "/timeline")).timeline.find(item => item.kind === "message");
  assert.equal(absent.original_text, null);
  assert.equal(absent.interpretation.evidence, null);
  assert.equal(absent.interpretation.review_required, true);
});
