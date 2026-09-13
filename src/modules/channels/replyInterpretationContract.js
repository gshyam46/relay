export const REPLY_POLICY_VERSION = "l3.02-reply-policy-v1";
export const REPLY_PROMPT_VERSION = "l3.02-reply-prompt-v1";
export const MAX_REPLY_POLICY_CHARS = 5 * 1024 * 1024;
export const MAX_REPLY_SEMANTIC_CHARS = 32768;
export const MAX_REPLY_SEMANTIC_BYTES = 65536;
export const MAX_REPLY_AUTHORED_SPANS = 1000;
export const REPLY_EVENT_TYPES = Object.freeze(["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION", "OPT_OUT", "UNKNOWN"]);
export const REPLY_NEXT_STEPS = Object.freeze({
  POSITIVE_REPLY: "Review the reply and choose the next step in the conversation.",
  NEGATIVE_REPLY: "Stand down for now and review the objection before deciding whether any later contact is appropriate.",
  QUESTION: "Answer the question directly and specifically; do not send generic follow-up copy.",
  OPT_OUT: "Stop all outbound to this lead immediately; review any uncertain interpretation without lifting the restriction.",
  UNKNOWN: "Have a human read the original message before deciding; its interpretation is unconfirmed."
});
const REASONS = Object.freeze({
  EMPTY_INPUT: "No message text was provided to classify.", INVALID_INPUT: "Message input requires human review.",
  INPUT_TOO_LARGE: "Message exceeds the bounded interpretation limit and requires human review.",
  INPUT_REQUIRES_REVIEW: "Source text requires human review before interpretation.",
  SOURCE_SPAN_LIMIT: "Message structure exceeds the bounded interpretation limit and requires human review.",
  QUOTED_SOURCE_REQUIRES_REVIEW: "Quoted, historical or signature text makes attribution uncertain; read the original reply.",
  CONTACT_INTENT_AMBIGUOUS: "Contact wording is negated, informational or otherwise ambiguous; read the original reply.",
  SENTIMENT_REQUIRES_REVIEW: "Mixed or uncertain sentiment requires human review.",
  UNRECOGNIZED_MESSAGE: "No clear supported intent signal was found in the message text.",
  EXPLICIT_OPT_OUT: "The authored message contains an explicit request to stop contact.",
  NEGATIVE_WORDING: "The authored message contains negative or declining language.",
  QUESTION_WORDING: "The authored message contains a question or question word.",
  POSITIVE_WORDING: "The authored message contains positive or affirmative language.",
  AI_ADMISSION_UNAVAILABLE: "The workspace AI request could not be admitted or accounted for; human review is required.",
  PROVIDER_FAILURE: "The configured interpreter was unavailable; human review is required.",
  MODEL_OUTPUT_REJECTED: "The configured interpretation failed validation; human review is required.",
  CLASSIFICATION_REQUIRES_REVIEW: "Interpretations conflict or remain uncertain; human review is required.",
  MODEL_AGREEMENT: "Model and deterministic interpretation agree; this is not independent confirmation of intent.",
  MODEL_CANDIDATE_REQUIRES_REVIEW: "A model suggested an interpretation; read the original message before deciding.",
  MODEL_POSSIBLE_OPT_OUT: "Possible contact restriction identified by a model; conservative stop handling requires review."
});
const POLICY_WORDS = /\b(stop|unsubscribe|opt[\s-]?out|remove me|take me off)\b|\u092c\u0902\u0926|\u092e\u0924|\bmat\b/iu;
const NEGATED_STOP = /\b(?:do\s+not|don['\u2019]?t|dont|never|not)\s+(?:(?:want|wish|need|intend|ask|asked|asking|to|you|me|please|ever|just|really|actually)\s+){0,5}(?:stop|unsubscribe|remove|delete|opt[\s-]?out|take)\b|\b(?:mat|nahi|nahin)\s+(?:band|roko|rokna)\b|(?:\u092e\u0924|\u0928\u0939\u0940\u0902)\s*(?:\u092c\u0902\u0926|\u0930\u094b\u0915)|(?:\u092c\u0902\u0926|\u0930\u094b\u0915\u0928\u093e).{0,10}(?:\u092e\u0924|\u0928\u0939\u0940\u0902|\u0928)\s*(?:\u0915\u0930\u0947\u0902|\u0915\u0930\u094b)/iu;
const POLICY_INFORMATION = /\b(?:how|where|why|what|did|does|should|whether|if)\b.{0,90}\b(?:unsubscribe|opt[\s-]?out|stop|remove me)\b|\b(?:unsubscribe|opt[\s-]?out)\b.{0,35}\b(?:link|button|process|option|instructions|example|word)\b|\bstop\s+(?:by|over|at|in|the\s+(?:car|bus|video|recording))\b|\b(?:he|she|they|you)\s+(?:said|wrote|asked)\b.{0,90}\b(?:stop|unsubscribe)\b|(?:^|[\s([{])["'\u201c\u2018].{0,100}\b(?:stop|unsubscribe|opt[\s-]?out)\b/iu;
const POLICY_PATTERNS = [
  /\b(?:do\s+not|don['\u2019]?t|dont|never)\s+(?:ever\s+|please\s+|again\s+)?(?:contact|call|email|e-mail|message|text)\b/iu,
  /\b(?:do\s+not|don['\u2019]?t|dont)\s+send\s+(?:(?:me|us|any|more|your)\s+){0,3}(?:emails?|e-mails?|messages?|texts?|mail)\b/iu,
  /\bstop\s+(?:all\s+)?(?:contacting|calling|emailing|e-mailing|messaging|texting|sending\s+(?:(?:me|us|any|more|your)\s+){0,3}(?:emails?|e-mails?|messages?|texts?|mail))\b/iu,
  /\b(?:no\s+more|do\s+not\s+want|don['\u2019]?t\s+want)\s+(?:(?:any|your|these|more|marketing|promotional)\s+){0,3}(?:emails?|e-mails?|messages?|calls?|texts?|contact)\b/iu,
  /\b(?:remove|delete)\s+(?:me|us)\b|\btake\s+(?:me|us)\s+off\b/iu,
  /\bunsubscribe\s+(?:me|us)\b|\b(?:want|wish|like)\s+to\s+(?:unsubscribe|opt[\s-]?out)\b/iu,
  /^(?:yes\s+)?(?:please\s+)?(?:stop|unsubscribe|opt[\s-]?out)(?:\s+(?:please|now|thanks|thank\s+you))?[.!\s]*$/iu,
  /(?:\u0938\u0902\u092a\u0930\u094d\u0915|\u0938\u092e\u094d\u092a\u0930\u094d\u0915|\u0915\u0949\u0932|\u092b\u094b\u0928|\u092b\u093c\u094b\u0928|\u092e\u0948\u0938\u0947\u091c|\u0938\u0902\u0926\u0947\u0936|\u0908\u092e\u0947\u0932).{0,20}(?:\u092e\u0924|\u0928\u0939\u0940\u0902|\u0928)\s*(?:\u092d\u0947\u091c|\u0915\u0930)/u,
  /(?:\u0938\u0902\u092a\u0930\u094d\u0915|\u0915\u0949\u0932|\u092b\u094b\u0928|\u092e\u0948\u0938\u0947\u091c|\u0938\u0902\u0926\u0947\u0936|\u0908\u092e\u0947\u0932).{0,25}\u092c\u0902\u0926\s*(?:\u0915\u0930|\u0915\u0940\u091c)/u,
  /\b(?:message|msg|messages|email|emails|mail|call|calls|phone|contact|sampark|sandesh)\b.{0,25}\b(?:mat|nahi|nahin)\s+(?:bhej|kar)/iu,
  /\b(?:message|msg|messages|email|emails|mail|call|calls|phone|contact|sampark|sandesh)\b.{0,25}\bband\s+(?:kar|kij)/iu
];
function trimmedSpan(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  return { start, end };
}
export function evidenceSpan(text, start, end) {
  if (typeof text !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length || end - start > 300) return null;
  return { start, end, quote: text.slice(start, end) };
}
function matchedEvidence(text, span, match) {
  const absolute = span.start + match.index, start = Math.max(span.start, absolute - 80), end = Math.min(span.end, Math.max(absolute + match[0].length, start + 300));
  return evidenceSpan(text, Math.max(start, end - 300), end);
}
export function inspectReplyText(text) {
  const context = { text: typeof text === "string" ? text : "", authored_spans: [], policy_evidence: null, review_reason: null, semantic_reason: null };
  if (typeof text !== "string") { context.semantic_reason = text == null ? "EMPTY_INPUT" : "INVALID_INPUT"; return context; }
  if (!text.trim()) { context.semantic_reason = "EMPTY_INPUT"; return context; }
  if (text.length > MAX_REPLY_POLICY_CHARS) { context.semantic_reason = "INPUT_TOO_LARGE"; return context; }
  let history = false, spanCount = 0;
  // Iterate the full bounded body without allocating one array entry per line.
  const lines = /[^\r\n]+/gu;
  for (const line of text.matchAll(lines)) {
    const span = trimmedSpan(text, line.index, line.index + line[0].length); if (span.start === span.end) continue;
    const value = text.slice(span.start, span.end);
    const marker = /^(?:On .{1,200} wrote:|[-_]{2,}\s*(?:Original Message|Forwarded message)|From:|Sent:|To:|Subject:|--\s*$|Sent from my\b)/iu.test(value);
    if (marker) history = true;
    const quoted = history || /^>/u.test(value) || /\b(?:reply|text|send)\s+["']?(?:stop|unsubscribe)\b|\bto\s+unsubscribe\b.{0,50}\b(?:click|reply|visit)|\bclick\b.{0,50}\bunsubscribe\b/iu.test(value);
    if (quoted) { context.review_reason ||= "QUOTED_SOURCE_REQUIRES_REVIEW"; continue; }
    spanCount++;
    if (spanCount <= MAX_REPLY_AUTHORED_SPANS) context.authored_spans.push(span);
    else context.semantic_reason = "SOURCE_SPAN_LIMIT";
    for (const fragment of value.matchAll(/[^.!?;,]+[.!?;,]?/gu)) {
      const part = trimmedSpan(text, span.start + fragment.index, span.start + fragment.index + fragment[0].length), clause = text.slice(part.start, part.end);
      if (NEGATED_STOP.test(clause) || (POLICY_WORDS.test(clause) && (POLICY_INFORMATION.test(clause) || /^\s*(?:unsubscribe|opt[\s-]?out)\s*\?\s*$/iu.test(clause)))) { context.review_reason ||= "CONTACT_INTENT_AMBIGUOUS"; continue; }
      let direct = null;
      for (const pattern of POLICY_PATTERNS) { const found = pattern.exec(clause); if (found) { direct = found; break; } }
      if (direct) { context.policy_evidence = matchedEvidence(text, part, direct); if (spanCount > MAX_REPLY_AUTHORED_SPANS) context.authored_spans[context.authored_spans.length - 1] = span; return context; }
      if (POLICY_WORDS.test(clause)) context.review_reason ||= "CONTACT_INTENT_AMBIGUOUS";
    }
  }
  if (text.length > MAX_REPLY_SEMANTIC_CHARS || Buffer.byteLength(text, "utf8") > MAX_REPLY_SEMANTIC_BYTES) context.semantic_reason = "INPUT_TOO_LARGE";
  else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f<>]/u.test(text) || /\b(ignore|override|disregard)\b.{0,60}\b(instructions?|rules?|prompts?|previous|above)\b|\b(system prompt|developer message|assistant message|reveal secrets?|api[_ -]?key|execute code)\b/iu.test(text)) context.semantic_reason = "INPUT_REQUIRES_REVIEW";
  return context;
}
export function findReplyEvidence(context, quote) {
  if (typeof quote !== "string" || !quote.trim() || quote.length > 300 || !context || typeof context.text !== "string") return null;
  let from = 0, start;
  while ((start = context.text.indexOf(quote, from)) >= 0) {
    const end = start + quote.length;
    if (context.authored_spans.some(span => start >= span.start && end <= span.end)) return evidenceSpan(context.text, start, end);
    from = start + 1;
  }
  return null;
}
export function evidenceForPattern(context, pattern) {
  for (const span of context.authored_spans) { const match = pattern.exec(context.text.slice(span.start, span.end)); if (match) return matchedEvidence(context.text, span, match); }
  return null;
}
export function boundedProviderInfo(info) {
  const identifier = (value, maximum) => typeof value === "string" && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) && !value.includes("://") && !/^(?:sk-|gsk_|Bearer)/i.test(value) ? value : null;
  return { provider: identifier(info?.provider, 100), model: identifier(info?.model, 200) };
}
export function replyResult({ event_type = "UNKNOWN", confidence = "LOW", mode = "DETERMINISTIC_FALLBACK", reason = "UNRECOGNIZED_MESSAGE", evidence = null, review_required = event_type === "UNKNOWN", candidate = null, providerInfo = null }) {
  if (!REPLY_EVENT_TYPES.includes(event_type) || !["HIGH", "MEDIUM", "LOW"].includes(confidence) || !Object.hasOwn(REASONS, reason)) throw new TypeError("Invalid internal reply result.");
  return { event_type, confidence, reason: REASONS[reason], suggested_next_step: REPLY_NEXT_STEPS[event_type],
    generation: { mode, reason, reply_policy_version: REPLY_POLICY_VERSION, prompt_version: mode === "LLM_CLASSIFICATION" || providerInfo !== null ? REPLY_PROMPT_VERSION : null, ...(providerInfo !== null ? boundedProviderInfo(providerInfo) : {}) },
    evidence, review_required, candidate };
}
