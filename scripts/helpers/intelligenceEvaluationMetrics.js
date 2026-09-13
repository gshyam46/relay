export const REPLY_CLASSES = ["POSITIVE_REPLY", "NEGATIVE_REPLY", "QUESTION", "OPT_OUT", "UNKNOWN"];
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

export function replyMetrics(rows) {
  const labeled = rows.filter(row => row.gold_class !== null);
  const confusion = Object.fromEntries(REPLY_CLASSES.map(gold => [gold, Object.fromEntries([...REPLY_CLASSES, "INVALID"].map(predicted => [predicted, 0]))]));
  for (const row of labeled) {
    if (!confusion[row.gold_class] || ![...REPLY_CLASSES, "INVALID"].includes(row.event_type)) throw new Error("Evaluation observation has an invalid reply class.");
    confusion[row.gold_class][row.event_type]++;
  }
  const per_class = Object.fromEntries(REPLY_CLASSES.map(label => {
    const tp = confusion[label][label], actual = labeled.filter(row => row.gold_class === label).length, predicted = labeled.filter(row => row.event_type === label).length;
    return [label, { true_positives: tp, actual, predicted, precision: ratio(tp, predicted), recall: ratio(tp, actual) }];
  }));
  const optouts = rows.filter(row => row.explicit_opt_out), nonOptouts = labeled.filter(row => row.gold_class !== "OPT_OUT");
  const decided = labeled.filter(row => REPLY_CLASSES.includes(row.event_type) && row.event_type !== "UNKNOWN");
  const candidates = labeled.filter(row => row.candidate !== null);
  return {
    messages: rows.length, labeled_messages: labeled.length, ambiguous_unlabeled: rows.length - labeled.length,
    confusion, per_class,
    abstentions: rows.filter(row => row.event_type === "UNKNOWN").length,
    invalid_outputs: rows.filter(row => row.event_type === "INVALID").length,
    coverage: ratio(rows.filter(row => REPLY_CLASSES.includes(row.event_type) && row.event_type !== "UNKNOWN").length, rows.length),
    labeled_correct: labeled.filter(row => row.event_type === row.gold_class).length,
    labeled_accuracy: ratio(labeled.filter(row => row.event_type === row.gold_class).length, labeled.length),
    decided_accuracy: ratio(decided.filter(row => row.event_type === row.gold_class).length, decided.length),
    explicit_opt_outs: optouts.length, explicit_opt_out_misses: optouts.filter(row => row.event_type !== "OPT_OUT").length,
    known_non_opt_outs: nonOptouts.length, false_opt_outs: nonOptouts.filter(row => row.event_type === "OPT_OUT").length,
    opt_outs_on_unlabeled_ambiguity: rows.filter(row => row.gold_class === null && row.event_type === "OPT_OUT").length,
    candidates: rows.filter(row => row.candidate !== null).length, labeled_candidates: candidates.length,
    candidate_correct: candidates.filter(row => row.candidate.event_type === row.gold_class).length,
    candidate_accuracy: ratio(candidates.filter(row => row.candidate.event_type === row.gold_class).length, candidates.length)
  };
}

export function replyBreakdown(rows) {
  return { overall: replyMetrics(rows), by_language: Object.fromEntries([...new Set(rows.map(row => row.language))].sort().map(language => [language, replyMetrics(rows.filter(row => row.language === language))])) };
}

export function exactEvidence(text, evidence) {
  return evidence !== null && typeof evidence === "object" && Number.isInteger(evidence.start) && Number.isInteger(evidence.end) && evidence.start >= 0 && evidence.end > evidence.start && evidence.end <= text.length && typeof evidence.quote === "string" && Boolean(evidence.quote.trim()) && evidence.quote.length <= 300 && text.slice(evidence.start, evidence.end) === evidence.quote;
}

export function unsupportedClaims(claims, allowed) {
  if (!Array.isArray(claims)) return [{ reason: "CLAIMS_NOT_ARRAY" }];
  return claims.filter(claim => !allowed.some(fact => fact.field === claim.field && fact.value === claim.value && Array.isArray(claim.evidence_refs) && claim.evidence_refs.length > 0 && new Set(claim.evidence_refs).size === claim.evidence_refs.length && claim.evidence_refs.every(ref => fact.evidence_refs.includes(ref))));
}

export function missingClaims(claims, required) {
  return required.filter(fact => !claims.some(claim => fact.field === claim.field && fact.value === claim.value && unsupportedClaims([claim], [fact]).length === 0));
}

export function evaluationExitCode(report) {
  return report.synthetic_safety.status === "PASS" ? 0 : 1;
}
