import { REPLY_EVENT_TYPES, REPLY_NEXT_STEPS, boundedProviderInfo, replyResult } from "./replyInterpretationContract.js";

const MODES = ["LOCAL_POLICY", "DETERMINISTIC_CLASSIFICATION", "LLM_CLASSIFICATION", "DETERMINISTIC_FALLBACK"];
// Retain known historical versions explicitly when adding a later interpreter.
const KNOWN_POLICY_VERSIONS = new Set(["l3.02-reply-policy-v1"]);
const KNOWN_PROMPT_VERSIONS = new Set(["l3.02-reply-prompt-v1"]);
const LOCAL_REASONS = { POSITIVE_REPLY: "POSITIVE_WORDING", NEGATIVE_REPLY: "NEGATIVE_WORDING", QUESTION: "QUESTION_WORDING" };
const FALLBACK_REASONS = new Set(["EMPTY_INPUT", "INVALID_INPUT", "INPUT_TOO_LARGE", "INPUT_REQUIRES_REVIEW", "SOURCE_SPAN_LIMIT", "QUOTED_SOURCE_REQUIRES_REVIEW", "CONTACT_INTENT_AMBIGUOUS", "SENTIMENT_REQUIRES_REVIEW", "UNRECOGNIZED_MESSAGE", "PROVIDER_FAILURE", "MODEL_OUTPUT_REJECTED", "CLASSIFICATION_REQUIRES_REVIEW"]);
const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"];
function sourceSpan(value, body) {
  return value && typeof body === "string" && Number.isInteger(value.start) && Number.isInteger(value.end)
    && value.start >= 0 && value.end > value.start && value.end <= body.length && value.end - value.start <= 300
    && typeof value.quote === "string" && value.quote.trim() && body.slice(value.start, value.end) === value.quote
    ? { start: value.start, end: value.end, quote: value.quote } : null;
}

// Persisted row columns own the category. Old or malformed auxiliary JSON never
// upgrades history to today's method or removes an existing contact stop.
export function publicReplyInterpretation(message) {
  if (message.direction !== "INBOUND") return null;
  const event_type = REPLY_EVENT_TYPES.includes(message.classification_event_type) ? message.classification_event_type : "UNKNOWN";
  const confidence = CONFIDENCES.includes(message.classification_confidence) ? message.classification_confidence : null;
  const result = { event_type, confidence, reason: "Interpretation method was not recorded or is unavailable.",
    suggested_next_step: REPLY_NEXT_STEPS[event_type], generation: null, evidence: null, review_required: true, candidate: null };
  const stored = message.payload?.classification;
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || JSON.stringify(stored).length > 8192
    || stored.event_type !== event_type || stored.confidence !== confidence) return result;
  const generation = stored.generation;
  if (!generation || !MODES.includes(generation.mode) || !KNOWN_POLICY_VERSIONS.has(generation.reply_policy_version)
    || (generation.prompt_version != null && !KNOWN_PROMPT_VERSIONS.has(generation.prompt_version))) return result;
  if (typeof stored.review_required !== "boolean") return result;
  const evidence = sourceSpan(stored.evidence, message.body);
  if (event_type !== "UNKNOWN" && !evidence) return result;
  const candidateEvidence = sourceSpan(stored.candidate?.evidence, message.body);
  const validCandidate = ["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION"].includes(stored.candidate?.event_type)
    && stored.candidate.confidence === "HIGH" && candidateEvidence;
  const mode = generation.mode, code = generation.reason;
  const consistent = (mode === "LOCAL_POLICY" && event_type === "OPT_OUT" && confidence === "HIGH" && code === "EXPLICIT_OPT_OUT" && generation.prompt_version === null)
    || (mode === "DETERMINISTIC_CLASSIFICATION" && confidence === "MEDIUM" && LOCAL_REASONS[event_type] === code && generation.prompt_version === null)
    || (mode === "DETERMINISTIC_FALLBACK" && event_type === "UNKNOWN" && confidence === "LOW" && FALLBACK_REASONS.has(code))
    || (mode === "LLM_CLASSIFICATION" && KNOWN_PROMPT_VERSIONS.has(generation.prompt_version)
      && ((code === "MODEL_AGREEMENT" && LOCAL_REASONS[event_type] && confidence === "MEDIUM")
        || (code === "MODEL_POSSIBLE_OPT_OUT" && event_type === "OPT_OUT")
        || (code === "MODEL_CANDIDATE_REQUIRES_REVIEW" && event_type === "UNKNOWN" && confidence === "LOW" && validCandidate)));
  if (!consistent || (event_type === "UNKNOWN" && stored.evidence != null)
    || (code !== "MODEL_CANDIDATE_REQUIRES_REVIEW" && stored.candidate != null)) return result;
  // Resolve only application-owned reason codes, never echo historical exception text.
  let reason;
  try { reason = replyResult({ reason: generation.reason }).reason; } catch { return result; }
  result.reason = reason;
  result.generation = { mode: generation.mode, reason: generation.reason, reply_policy_version: generation.reply_policy_version,
    prompt_version: generation.prompt_version ?? null, ...boundedProviderInfo(generation) };
  result.evidence = evidence;
  if (event_type === "UNKNOWN" && generation.mode === "LLM_CLASSIFICATION"
    && ["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION"].includes(stored.candidate?.event_type)
    && stored.candidate.confidence === "HIGH") {
    const evidence = sourceSpan(stored.candidate.evidence, message.body);
    if (evidence) result.candidate = { event_type: stored.candidate.event_type, confidence: "HIGH", evidence };
  }
  result.review_required = stored.review_required !== false || event_type === "UNKNOWN" || confidence === "LOW"
    || generation.mode === "DETERMINISTIC_FALLBACK" || generation.reason === "MODEL_POSSIBLE_OPT_OUT"
    || (stored.evidence != null && result.evidence === null);
  return result;
}
