// Reproducible actual React verification on an owned in-memory fixture.
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeTestEnvironment, e2eEnvironment } from "./helpers/testSafety.js";
import { runTestProcess } from "./helpers/runTestProcess.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") {
  console.error("Supply --playwright-module followed by the absolute path to an installed Playwright index.mjs. No browser is installed automatically.");
  process.exitCode = 1;
} else {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...e2eEnvironment({ ...safeTestEnvironment(), E2E_PORT: String(port) }),
    PUBLIC_APP_ORIGIN: "http://127.0.0.1:" + port, LOG_LEVEL: "error" };
  console.log("Completion UI target: owned loopback port " + port + ", disposable in-memory SQLite, providers disabled.");
  process.exitCode = await runTestProcess({
    args: ["scripts/verify-completion-ui.js", ...args], env,
    spawnChild: (file, childArgs, options) => spawn(file, childArgs, { ...options, windowsHide: true })
  });
}
