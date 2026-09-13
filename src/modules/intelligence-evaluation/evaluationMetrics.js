import { REPLY_CLASSES, hash } from "./evaluationContract.js";

const ratio = (n, d) => d ? n / d : null;
export function scoreReplies(rows) {
  const confusion = Object.fromEntries(REPLY_CLASSES.map(label => [label, Object.fromEntries([...REPLY_CLASSES, "INVALID"].map(prediction => [prediction, 0]))]));
  for (const row of rows) { if (!REPLY_CLASSES.includes(row.expected) || ![...REPLY_CLASSES, "INVALID"].includes(row.actual)) throw new TypeError("Evaluation categories are invalid."); confusion[row.expected][row.actual]++; }
  const correct = rows.filter(row => row.expected === row.actual).length;
  return {
    messages: rows.length, correct, accuracy: ratio(correct, rows.length), abstentions: rows.filter(row => row.actual === "UNKNOWN").length,
    coverage: ratio(rows.filter(row => row.actual !== "UNKNOWN" && row.actual !== "INVALID").length, rows.length), invalid_outputs: rows.filter(row => row.actual === "INVALID").length,
    expected_opt_outs: rows.filter(row => row.expected === "OPT_OUT").length,
    missed_expected_opt_outs: rows.filter(row => row.expected === "OPT_OUT" && row.actual !== "OPT_OUT").length,
    false_opt_outs: rows.filter(row => row.expected !== "OPT_OUT" && row.actual === "OPT_OUT").length, confusion,
    per_class: Object.fromEntries(REPLY_CLASSES.map(label => { const actual = rows.filter(row => row.expected === label).length, predicted = rows.filter(row => row.actual === label).length, true_positives = confusion[label][label]; return [label, { actual, predicted, true_positives, precision: ratio(true_positives, predicted), recall: ratio(true_positives, actual) }]; }))
  };
}
export function aggregateReplay(cases, predictions) {
  const baseline = scoreReplies(cases.map(item => ({ expected: item.labels.expected_category, actual: item.reply.recorded_category })));
  const candidate = scoreReplies(cases.map((item, index) => ({ expected: item.labels.expected_category, actual: REPLY_CLASSES.includes(predictions[index]?.event_type) ? predictions[index].event_type : "INVALID" })));
  return {
    version: 1, execution_mode: "LOCAL_RULE_REPLAY", case_count: cases.length,
    label_origins: Object.fromEntries(["SYNTHETIC", "PERMISSION_REVIEWED"].map(origin => [origin, cases.filter(item => item.labels.eval_use === origin).length])),
    baseline: { kind: "RECORDED_OPERATIONAL_CLASS", ...baseline }, candidate: { kind: "CURRENT_LOCAL_RULES", ...candidate },
    delta: Object.fromEntries(["correct", "abstentions", "missed_expected_opt_outs", "false_opt_outs"].map(key => [key, candidate[key] - baseline[key]])),
    provider_calls: 0, hosted_model_quality: "NOT_MEASURED", customer_generalization: "NOT_ESTABLISHED", release_decision: "NOT_AUTHORIZED", language_breakdown: "NOT_CAPTURED"
  };
}

export function validateAggregateReplay(metrics) {
  const invalid = () => { throw new Error("Stored evaluation aggregates are invalid."); };
  if (!metrics || !Number.isInteger(metrics.case_count) || metrics.case_count < 1 || metrics.case_count > 100) invalid();
  const scores = {};
  for (const side of ["baseline", "candidate"]) {
    const rows = [], confusion = metrics[side]?.confusion;
    if (!confusion || Object.keys(confusion).sort().join(",") !== [...REPLY_CLASSES].sort().join(",")) invalid();
    for (const expected of REPLY_CLASSES) {
      if (!confusion[expected] || Object.keys(confusion[expected]).sort().join(",") !== [...REPLY_CLASSES, "INVALID"].sort().join(",")) invalid();
      for (const actual of [...REPLY_CLASSES, "INVALID"]) {
        const n = confusion[expected][actual]; if (!Number.isInteger(n) || n < 0 || n > 100 || rows.length + n > metrics.case_count) invalid();
        for (let i = 0; i < n; i++) rows.push({ expected, actual });
      }
    }
    if (rows.length !== metrics.case_count) invalid();
    scores[side] = scoreReplies(rows);
  }
  const origins = metrics.label_origins;
  if (!origins || !Number.isInteger(origins.SYNTHETIC) || !Number.isInteger(origins.PERMISSION_REVIEWED) || origins.SYNTHETIC < 0 || origins.PERMISSION_REVIEWED < 0 || origins.SYNTHETIC + origins.PERMISSION_REVIEWED !== metrics.case_count) invalid();
  const expected = {
    version: 1, execution_mode: "LOCAL_RULE_REPLAY", case_count: metrics.case_count, label_origins: { SYNTHETIC: origins.SYNTHETIC, PERMISSION_REVIEWED: origins.PERMISSION_REVIEWED },
    baseline: { kind: "RECORDED_OPERATIONAL_CLASS", ...scores.baseline }, candidate: { kind: "CURRENT_LOCAL_RULES", ...scores.candidate },
    delta: Object.fromEntries(["correct", "abstentions", "missed_expected_opt_outs", "false_opt_outs"].map(key => [key, scores.candidate[key] - scores.baseline[key]])),
    provider_calls: 0, hosted_model_quality: "NOT_MEASURED", customer_generalization: "NOT_ESTABLISHED", release_decision: "NOT_AUTHORIZED", language_breakdown: "NOT_CAPTURED"
  };
  if (hash(expected) !== hash(metrics)) invalid();
  return expected;
}
