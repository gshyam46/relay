import { e2eEnvironment } from "./helpers/testSafety.js";
import { runTestProcess } from "./helpers/runTestProcess.js";

try {
  const env = e2eEnvironment();
  console.log("E2E target: disposable SQLite :memory:, port " + env.PORT + "; providers disabled; automatic worker disabled.");
  process.exitCode = await runTestProcess({ args: ["src/server.js"], env });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
