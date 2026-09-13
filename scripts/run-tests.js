import { safeTestEnvironment } from "./helpers/testSafety.js";
import { runTestProcess } from "./helpers/runTestProcess.js";

console.log("Test target: disposable SQLite; inherited database/provider configuration removed.");
process.exitCode = await runTestProcess({ args: ["--test", ...process.argv.slice(2)], env: safeTestEnvironment() });
