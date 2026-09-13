import { evidenceForPattern, inspectReplyText, replyResult, REPLY_NEXT_STEPS } from "./replyInterpretationContract.js";
export const SUGGESTED_NEXT_STEP = REPLY_NEXT_STEPS;
const NEGATIVE_PATTERN = /\b(not\s+(?:(?:really|very|at\s+all|currently|particularly|even)\s+){0,3}(?:interested|ready|a\s+good\s+fit)|no\s+longer\s+interested|not\s+now|no\s+thanks|no\s+thank\s+you|too\s+expensive|go\s+away|never|pass\s+on\s+this|don['\u2019]?t\s+(?:need|want)|do\s+not\s+(?:need|want))\b/iu;
const QUESTION_PATTERN = /\?|\b(how|what|when|where|why|who|can\s+you|could\s+you|do\s+you|does\s+this|is\s+this|are\s+you)\b/iu;
const POSITIVE_PATTERN = /\b(yes|sounds\s+good|interested|let['\u2019]?s|lets|sure|great|sign\s+me\s+up|works\s+for\s+me|schedule|book\s+a|count\s+me\s+in|definitely)\b/iu;
const UNCERTAIN_PATTERN = /\b(sarcasm|sarcastic|yeah\s+right|as\s+if|joking|spam|not\s+(?:really\s+)?(?:sure|certain|decided|convinced)|unsure|maybe|perhaps)\b/iu;

// Finite keyless interpretation. Policy and exact source spans are shared with
// the bounded configured interpreter; no result authorizes a send or re-consent.
export class LocalReplyClassifier {
  classify(text) {
    const context = inspectReplyText(text);
    if (context.policy_evidence) return replyResult({ event_type: "OPT_OUT", confidence: "HIGH", mode: "LOCAL_POLICY", reason: "EXPLICIT_OPT_OUT", evidence: context.policy_evidence, review_required: false });
    if (context.review_reason || context.semantic_reason) return replyResult({ reason: context.review_reason || context.semantic_reason });
    if (UNCERTAIN_PATTERN.test(context.text)) return replyResult({ reason: "SENTIMENT_REQUIRES_REVIEW" });
    const negativeSpans = [...context.text.matchAll(new RegExp(NEGATIVE_PATTERN.source, "giu"))].map(match => [match.index, match.index + match[0].length]);
    const independentPositive = negativeSpans.length && [...context.text.matchAll(new RegExp(POSITIVE_PATTERN.source, "giu"))].some(match => !negativeSpans.some(([start, end]) => match.index >= start && match.index + match[0].length <= end));
    if (independentPositive) return replyResult({ reason: "SENTIMENT_REQUIRES_REVIEW" });
    for (const [pattern, event_type, reason] of [[NEGATIVE_PATTERN, "NEGATIVE_REPLY", "NEGATIVE_WORDING"], [QUESTION_PATTERN, "QUESTION", "QUESTION_WORDING"], [POSITIVE_PATTERN, "POSITIVE_REPLY", "POSITIVE_WORDING"]]) {
      const evidence = evidenceForPattern(context, pattern);
      if (evidence) return replyResult({ event_type, confidence: "MEDIUM", mode: "DETERMINISTIC_CLASSIFICATION", reason, evidence, review_required: false });
    }
    return replyResult({ reason: "UNRECOGNIZED_MESSAGE" });
  }
}
