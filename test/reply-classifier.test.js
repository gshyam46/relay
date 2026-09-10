import test from "node:test";
import assert from "node:assert/strict";
import { LocalReplyClassifier, SUGGESTED_NEXT_STEP } from "../src/modules/channels/replyClassifier.js";
import { INBOUND_EVENT_TYPES } from "../src/modules/channels/channelContract.js";

// Dedicated coverage for the classifier itself, separate from the inbound
// pipeline that consumes it. Everything downstream — whether a follow-up is
// escalated, whether outbound stops, what the conversation badge says — is
// driven by these three fields, so they are worth pinning precisely.

const classifier = new LocalReplyClassifier();

test("opt-out language wins over everything else in the message", () => {
  // Opt-out must be checked first: "yes please unsubscribe me" is affirmative AND
  // a question-shaped sentence, but treating it as a positive reply would keep
  // sending to someone who asked to be removed.
  for (const text of [
    "stop",
    "Please unsubscribe me",
    "opt out",
    "opt-out please",
    "Remove me from your list",
    "do not contact me again",
    "Take me off this list",
    "yes please unsubscribe me"
  ]) {
    const result = classifier.classify(text);
    assert.equal(result.event_type, INBOUND_EVENT_TYPES.OPT_OUT, `"${text}" must classify as OPT_OUT`);
    assert.equal(result.confidence, "HIGH");
  }
});

test("negative language is recognised without being mistaken for an opt-out", () => {
  for (const text of ["Not interested, thanks", "no thanks", "This is too expensive", "Not a good fit for us"]) {
    const result = classifier.classify(text);
    assert.equal(result.event_type, INBOUND_EVENT_TYPES.NEGATIVE_REPLY, `"${text}" must classify as NEGATIVE_REPLY`);
    assert.equal(result.confidence, "MEDIUM");
  }
});

test("questions are recognised by punctuation or by question words", () => {
  for (const text of [
    "What does this cost?",
    "how long does delivery take",
    "Can you send more details",
    "Is this available in teak"
  ]) {
    assert.equal(
      classifier.classify(text).event_type,
      INBOUND_EVENT_TYPES.QUESTION,
      `"${text}" must classify as QUESTION`
    );
  }
});

test("positive language is recognised", () => {
  for (const text of ["Sounds good", "Yes, let's do it", "Interested — sign me up", "works for me"]) {
    assert.equal(
      classifier.classify(text).event_type,
      INBOUND_EVENT_TYPES.POSITIVE_REPLY,
      `"${text}" must classify as POSITIVE_REPLY`
    );
  }
});

test("anything unrecognised is UNKNOWN with LOW confidence, which is what triggers human review", () => {
  for (const text of ["asdkfj qwoeiru", "...", "ok", ""]) {
    const result = classifier.classify(text);
    assert.equal(result.event_type, INBOUND_EVENT_TYPES.UNKNOWN, `"${text}" must classify as UNKNOWN`);
    assert.equal(result.confidence, "LOW", "LOW confidence is the signal that escalates a follow-up");
  }

  // Null/undefined must not throw — a provider can deliver an event with no body.
  assert.equal(classifier.classify(null).event_type, INBOUND_EVENT_TYPES.UNKNOWN);
  assert.equal(classifier.classify(undefined).event_type, INBOUND_EVENT_TYPES.UNKNOWN);
});

test("every classification is auditable: a reason and a next step, never a bare label", () => {
  for (const text of ["stop", "not interested", "how much?", "sounds good", "zzzz"]) {
    const result = classifier.classify(text);
    assert.ok(result.reason && result.reason.length > 0, `"${text}" must explain itself`);
    assert.equal(
      result.suggested_next_step,
      SUGGESTED_NEXT_STEP[result.event_type],
      "the suggested next step must match the classified type"
    );
    assert.ok(result.suggested_next_step.length > 0);
  }
});

test("classification is case-insensitive and tolerant of surrounding whitespace", () => {
  assert.equal(classifier.classify("   STOP   ").event_type, INBOUND_EVENT_TYPES.OPT_OUT);
  assert.equal(classifier.classify("\n  Not Interested \t").event_type, INBOUND_EVENT_TYPES.NEGATIVE_REPLY);
  assert.equal(classifier.classify("SOUNDS GOOD").event_type, INBOUND_EVENT_TYPES.POSITIVE_REPLY);
});

test("the classifier is pure: the same text always classifies the same way", () => {
  const text = "Can you tell me the price?";
  const first = classifier.classify(text);
  const second = new LocalReplyClassifier().classify(text);
  assert.deepEqual(first, second);
});

test("every classified type has a defined next step, so the UI never renders a blank", () => {
  for (const type of Object.values(INBOUND_EVENT_TYPES)) {
    if (!SUGGESTED_NEXT_STEP[type]) {
      // Types the classifier never produces (delivery receipts and the like) are
      // not its responsibility; only assert on the ones it can return.
      continue;
    }
    assert.ok(SUGGESTED_NEXT_STEP[type].length > 0, `${type} must have a next step`);
  }
  for (const type of [
    INBOUND_EVENT_TYPES.OPT_OUT,
    INBOUND_EVENT_TYPES.NEGATIVE_REPLY,
    INBOUND_EVENT_TYPES.QUESTION,
    INBOUND_EVENT_TYPES.POSITIVE_REPLY,
    INBOUND_EVENT_TYPES.UNKNOWN
  ]) {
    assert.ok(SUGGESTED_NEXT_STEP[type], `${type} is producible by the classifier and needs a next step`);
  }
});
