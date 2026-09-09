import { INBOUND_EVENT_TYPES } from "./channelContract.js";

const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out|remove me|do not contact|don't contact|take me off)\b/i;
const NEGATIVE_PATTERN =
  /\b(not interested|no thanks|no thank you|not now|too expensive|stop calling|go away|never|not a good fit|pass on this)\b/i;
const QUESTION_PATTERN = /\?|\b(how|what|when|where|why|who|can you|could you|do you|does this|is this|are you)\b/i;
const POSITIVE_PATTERN =
  /\b(yes|sounds good|interested|let'?s|lets|sure|great|sign me up|works for me|schedule|book a|count me in|definitely)\b/i;

export const SUGGESTED_NEXT_STEP = {
  [INBOUND_EVENT_TYPES.POSITIVE_REPLY]: "Schedule a call or send the next step in the conversation while interest is high.",
  [INBOUND_EVENT_TYPES.NEGATIVE_REPLY]: "Stand down for now — log the objection and revisit later rather than pushing further.",
  [INBOUND_EVENT_TYPES.QUESTION]: "Answer the question directly and specifically; don't send generic follow-up copy.",
  [INBOUND_EVENT_TYPES.OPT_OUT]: "Stop all outbound to this lead immediately — no next step.",
  [INBOUND_EVENT_TYPES.UNKNOWN]: "Have a human read the raw message before deciding — the classifier couldn't place it confidently."
};

/**
 * Deterministic local reply classifier — the free, keyless equivalent of the LocalSynthesisAgent
 * and LocalRecommendationAgent pattern used elsewhere in this codebase. Classifies raw inbound
 * reply text into one of the existing INBOUND_EVENT_TYPES, with a confidence and a human-readable
 * reason so the classification is auditable rather than a black box. An LLM-backed classifier can
 * follow the same interface (classify(text) -> {event_type, confidence, reason}) later.
 */
export class LocalReplyClassifier {
  classify(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      return this.#result(INBOUND_EVENT_TYPES.UNKNOWN, "LOW", "No message text was provided to classify.");
    }
    if (OPT_OUT_PATTERN.test(trimmed)) {
      return this.#result(INBOUND_EVENT_TYPES.OPT_OUT, "HIGH", "Message contains an opt-out or unsubscribe phrase.");
    }
    if (NEGATIVE_PATTERN.test(trimmed)) {
      return this.#result(INBOUND_EVENT_TYPES.NEGATIVE_REPLY, "MEDIUM", "Message contains negative or declining language.");
    }
    if (QUESTION_PATTERN.test(trimmed)) {
      return this.#result(INBOUND_EVENT_TYPES.QUESTION, "MEDIUM", "Message contains a question or question word.");
    }
    if (POSITIVE_PATTERN.test(trimmed)) {
      return this.#result(INBOUND_EVENT_TYPES.POSITIVE_REPLY, "MEDIUM", "Message contains positive or affirmative language.");
    }
    return this.#result(
      INBOUND_EVENT_TYPES.UNKNOWN,
      "LOW",
      "No clear sentiment or intent signal was found in the message text."
    );
  }

  #result(event_type, confidence, reason) {
    return { event_type, confidence, reason, suggested_next_step: SUGGESTED_NEXT_STEP[event_type] };
  }
}
