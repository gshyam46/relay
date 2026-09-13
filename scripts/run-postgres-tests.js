import { cleanupRunSchemas, newTestRunId, postgresTestTarget, safeTestEnvironment, schemaPrefix } from "./helpers/testSafety.js";
import { runTestProcess } from "./helpers/runTestProcess.js";

try {
  const context = { ...postgresTestTarget(), runId: newTestRunId() };
  console.log("PostgreSQL test target: " + context.description);
  console.log("Run-owned schema prefix: " + schemaPrefix(context.runId));
  const env = {
    ...safeTestEnvironment(),
    RELAY_TEST_PG: "1",
    RELAY_TEST_RUN_ID: context.runId,
    TEST_DATABASE_URL: context.connectionString,
    TEST_DATABASE_DISPOSABLE: "1",
    TEST_DATABASE_SSL: context.ssl ? "enable" : "disable"
  };
  process.exitCode = await runTestProcess({
    args: ["--test", ...process.argv.slice(2)],
    env,
    cleanup: async () => console.log("Cleaned up " + await cleanupRunSchemas(context) + " schema(s) owned by this run.")
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
