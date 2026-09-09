import { INBOUND_EVENT_TYPES } from "../channels/channelContract.js";
import { LocalReplyClassifier } from "../channels/replyClassifier.js";

const VALID_TYPES = new Set(Object.values(INBOUND_EVENT_TYPES));
const VALID_CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW"]);

/**
 * LLM-backed reply classifier — same classify(text) -> {event_type, confidence, reason,
 * suggested_next_step} interface as LocalReplyClassifier, following the LlmSynthesisAgent /
 * LlmRecommendationAgent pattern: real understanding when an LLM provider is configured
 * (Groq/OpenAI/OpenRouter/Ollama — swap providers via LLM_PROVIDER, no code change), with an
 * automatic fallback to the deterministic local classifier on any failure so a flaky or
 * misconfigured provider never blocks inbound processing.
 */
export class LlmReplyClassifier {
  constructor(llmProvider) {
    this.llm = llmProvider;
    this.fallback = new LocalReplyClassifier();
  }

  async classify(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      return await this.fallback.classify(text);
    }

    const messages = [
      {
        role: "system",
        content: `You classify a lead's inbound reply to a sales/outreach message. Return JSON with exactly these fields:

{
  "event_type": one of "POSITIVE_REPLY" | "NEGATIVE_REPLY" | "QUESTION" | "OPT_OUT" | "UNKNOWN",
  "confidence": one of "HIGH" | "MEDIUM" | "LOW",
  "reason": "one sentence explaining why you chose this classification, referencing the actual message",
  "suggested_next_step": "one specific, actionable sentence telling a salesperson what to do next given this reply"
}

Guidance:
- OPT_OUT: the person wants contact to stop (unsubscribe, stop, remove me, etc).
- NEGATIVE_REPLY: declining, not interested, objection, but not asking to stop contact entirely.
- QUESTION: asking for information before deciding.
- POSITIVE_REPLY: interested, agreeing, or ready to move forward.
- UNKNOWN: use this and LOW confidence if the message is unclear, off-topic, or you cannot tell.
Never invent a classification you're not reasonably confident in — use UNKNOWN + LOW confidence instead of guessing.`
      },
      { role: "user", content: trimmed }
    ];

    try {
      const result = await this.llm.jsonCompletion({ messages, maxTokens: 300 });
      const event_type = VALID_TYPES.has(result.event_type) ? result.event_type : INBOUND_EVENT_TYPES.UNKNOWN;
      const confidence = VALID_CONFIDENCE.has(result.confidence) ? result.confidence : "LOW";
      return {
        event_type,
        confidence,
        reason: typeof result.reason === "string" && result.reason.trim() ? result.reason.trim() : "AI-classified reply.",
        suggested_next_step:
          typeof result.suggested_next_step === "string" && result.suggested_next_step.trim()
            ? result.suggested_next_step.trim()
            : (await this.fallback.classify(text)).suggested_next_step
      };
    } catch (error) {
      console.error("LLM reply classification failed, falling back to deterministic classifier:", error.message);
      return await this.fallback.classify(text);
    }
  }
}
