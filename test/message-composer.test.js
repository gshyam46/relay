import test from "node:test";
import assert from "node:assert/strict";
import { composeOutboundMessage } from "../src/modules/outbound-automation/messageComposer.js";
import { startClient } from "./helpers/testClient.js";

// The composer writes what a lead actually receives, so the grounding rule
// matters more here than anywhere else in the product: it may personalise from
// the lead's own record and nothing else. A message that invents a price, a
// product or a prior conversation is worse than a short generic one.

const LEAD = {
  name: "Priya Sharma",
  company: "Sharma Interiors",
  email: "priya@example.com",
  source: "MANUAL"
};

test("composes a real email: greeting, grounded context, a question, and a sign-off", () => {
  const { subject, message } = composeOutboundMessage({
    lead: LEAD,
    actionType: "SEND_EMAIL",
    organizationName: "Meridian Interiors"
  });

  assert.equal(subject, "Following up on your enquiry — Sharma Interiors");
  assert.ok(message.startsWith("Hi Priya,"), "greets by first name");
  assert.ok(message.includes("Sharma Interiors"), "references the company we were given");
  assert.ok(message.includes("Meridian Interiors"), "signs off as the workspace");
  assert.ok(message.includes("?"), "asks the lead something rather than only talking at them");

  // The subject must not be the body — that was the original defect.
  assert.notEqual(subject, message);
  assert.ok(subject.length < 100, "a subject is a subject, not a paragraph");
});

test("invents nothing: no price, product, timeline, or claim about the lead", () => {
  const variants = [
    { lead: LEAD, actionType: "SEND_EMAIL" },
    { lead: { name: "Solo", source: "WEB_FORM" }, actionType: "SEND_EMAIL" },
    { lead: LEAD, actionType: "SEND_SMS" },
    { lead: LEAD, actionType: "SEND_WHATSAPP" },
    { lead: LEAD, actionType: "SEND_VOICE_CALL" },
    { lead: LEAD, actionType: "SEND_EMAIL", replyContext: { event_type: "QUESTION" } },
    { lead: LEAD, actionType: "SEND_EMAIL", replyContext: { event_type: "POSITIVE_REPLY" } }
  ];

  // Wording that would be a fabrication: a number the lead never gave us, a
  // product we do not know they want, or a claim about a past interaction.
  const forbidden = [
    /₹|\$|\d+\s*(%|percent)/,
    /\bdiscount\b/i,
    /\bquote of\b/i,
    /\bas we discussed\b/i,
    /\blast time we spoke\b/i,
    /\byour (sofa|table|kitchen|bedroom)\b/i,
    /\bwithin \d+ (days|weeks)\b/i,
    /\bguarantee\b/i
  ];

  for (const variant of variants) {
    const { subject, message } = composeOutboundMessage({ ...variant, organizationName: "Meridian Interiors" });
    for (const pattern of forbidden) {
      assert.equal(pattern.test(message), false, `message for ${variant.actionType} must not match ${pattern}`);
      assert.equal(pattern.test(subject), false, `subject for ${variant.actionType} must not match ${pattern}`);
    }
    assert.ok(message.trim().length > 0, "never empty");
  }
});

test("a lead we know less about gets a shorter message, not a fabricated one", () => {
  const { message } = composeOutboundMessage({
    lead: { source: "WEB_FORM" },
    actionType: "SEND_EMAIL",
    organizationName: "Meridian Interiors"
  });
  assert.ok(message.startsWith("Hello,"), "no name means a neutral greeting, not a guessed one");
  assert.equal(message.includes("undefined"), false);
  assert.equal(message.includes("null"), false);
  assert.equal(/\bon behalf of\b/.test(message), false, "no company means the company clause is omitted entirely");
});

test("junk names are not used as a greeting", () => {
  for (const name of ["unknown", "N/A", "lead", "customer", "priya@example.com"]) {
    const { message } = composeOutboundMessage({ lead: { name, source: "MANUAL" }, actionType: "SEND_EMAIL" });
    assert.ok(message.startsWith("Hello,"), `"${name}" must not be used as a first name`);
  }
});

test("the message answers what the lead actually said", () => {
  const question = composeOutboundMessage({
    lead: LEAD,
    actionType: "SEND_EMAIL",
    replyContext: { event_type: "QUESTION" }
  });
  assert.match(question.subject, /^Re: your question/);
  assert.ok(question.message.includes("answer"), "a question gets an answer, not a fresh opener");

  const positive = composeOutboundMessage({
    lead: LEAD,
    actionType: "SEND_EMAIL",
    replyContext: { event_type: "POSITIVE_REPLY" }
  });
  assert.match(positive.subject, /^Next steps/);
  assert.notEqual(positive.message, question.message, "different intents produce different messages");
});

test("short-form channels get one line, not a letter", () => {
  const sms = composeOutboundMessage({ lead: LEAD, actionType: "SEND_SMS", organizationName: "Meridian Interiors" });
  assert.equal(sms.message.includes("\n"), false, "an SMS is a single line");
  assert.ok(sms.message.length < 300, "and short enough to send");

  const email = composeOutboundMessage({ lead: LEAD, actionType: "SEND_EMAIL" });
  assert.ok(email.message.includes("\n"), "an email is not");
});

test("an outbound action carries sendable copy, never internal reasoning", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Composed Copy Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Ananya Rao",
      email: "ananya@example.com",
      company: "Rao Furnishings",
      source: "MANUAL"
    })
  ).lead;

  await client.post("/api/intelligence/bulk-run", { organization_id: organization.id, lead_ids: [lead.id] });

  const outbound = await client.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`);
  const emailAction = outbound.actions.find((action) => action.type === "SEND_EMAIL");
  assert.ok(emailAction, "analysing a lead produces an email action to review");

  assert.ok(emailAction.payload.subject, "the action carries a subject");
  assert.ok(emailAction.payload.message, "and a message body");
  assert.ok(emailAction.payload.message.includes("Ananya"), "personalised from the lead's own record");
  assert.ok(emailAction.payload.message.includes("Composed Copy Org"), "signed as the workspace");

  // The regression this guards: the router falls back to `rationale` when no
  // message is present, so an unconfigured payload would have emailed our own
  // internal reasoning to the lead.
  assert.notEqual(emailAction.payload.message, emailAction.payload.rationale);
  assert.equal(
    /evidence-backed intelligence|outbound review|next best action/i.test(emailAction.payload.message),
    false,
    "internal vocabulary must not appear in what the lead receives"
  );
});

test("human tasks stay internal and get no customer-facing copy", async (t) => {
  const client = await startClient(t);
  const { organization } = await client.register("Human Task Copy Org");
  const lead = (
    await client.post("/api/leads", {
      organization_id: organization.id,
      name: "Task Only",
      email: "task@example.com",
      source: "MANUAL"
    })
  ).lead;
  // The initial action planned at lead creation is a human task.
  await client.post("/api/worker/run", { organization_id: organization.id });

  const outbound = await client.get(`/api/leads/${lead.id}/outbound?organization_id=${organization.id}`);
  const task = outbound.actions.find((action) => action.type === "CREATE_HUMAN_TASK");
  assert.ok(task, "a human task exists");
  assert.equal(task.payload.subject, undefined, "an internal task needs no subject");
});
