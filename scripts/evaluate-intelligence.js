import { safeTestEnvironment, assertNoLiveProviders } from "./helpers/testSafety.js";
import { runTestProcess } from "./helpers/runTestProcess.js";
import { fileURLToPath } from "node:url";
import { parseEvaluationArgs, disableEvaluationNetwork, writeEvaluationReport } from "./helpers/intelligenceEvaluationIO.js";

const args = process.argv.slice(2), child = args[0] === "--evaluation-child";
try {
  const options = parseEvaluationArgs(child ? args.slice(1) : args);
  if (!child) {
    console.log("Intelligence evaluation: bundled synthetic corpus, sanitized child, injected adapters; no customer or live model target.");
    process.exitCode = await runTestProcess({ args: [fileURLToPath(import.meta.url), "--evaluation-child", ...(options.writeReport ? [] : ["--check"])], env: { ...safeTestEnvironment(), INTELLIGENCE_EVALUATION_CHILD: "1" } });
  } else {
    assertNoLiveProviders();
    if (process.env.INTELLIGENCE_EVALUATION_CHILD !== "1" || process.env.NODE_ENV !== "test" || process.env.DATABASE_FILE !== ":memory:" || process.env.DATABASE_URL || process.env.NODE_OPTIONS) throw new Error("Evaluation requires its sanitized child environment.");
    disableEvaluationNetwork();
    const { evaluateIntelligenceCorpus } = await import("./helpers/intelligenceEvaluation.js");
    const { evaluationExitCode } = await import("./helpers/intelligenceEvaluationMetrics.js");
    const { assessIntelligenceRegression } = await import("./helpers/intelligenceRegressionGate.js");
    const report = await evaluateIntelligenceCorpus();
    report.engineering_regression = assessIntelligenceRegression(report);
    if (options.writeReport) console.log("Report: " + writeEvaluationReport(report));
    console.log(JSON.stringify({ synthetic_safety: report.synthetic_safety.status, engineering_regression: report.engineering_regression.status, regression_failures: report.engineering_regression.failures, gate_failures: report.synthetic_safety.failure_count, counts: report.corpus.counts, reply_quality: Object.fromEntries(Object.entries(report.reply_quality).map(([mode, metrics]) => [mode, metrics.overall])), external_quality: report.external_quality }));
    if (report.synthetic_safety.failure_count) console.log(JSON.stringify(report.synthetic_safety.failures));
    process.exitCode = evaluationExitCode(report) || (report.engineering_regression.status === "PASS" ? 0 : 1);
  }
} catch {
  console.error("Intelligence evaluation failed or refused its input; no live target is supported. Use the documented fixed runner.");
  process.exitCode = 1;
}
