import { spawn } from "node:child_process";

// Cleanup runs only after a normal child close. On interruption, descendants
// may still be exiting, so leave this run's namespace for explicit inspection.
// A later run never cleans it by shared prefix.
export async function runTestProcess({ args, env, cleanup, spawnChild = spawn, signals = process, log = console }) {
  let interrupted = null;
  let failedToStart = false;
  const child = spawnChild(process.execPath, args, { stdio: "inherit", env });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (interrupted) return;
      interrupted = signal;
      child.kill(signal);
    };
    handlers.set(signal, handler);
    signals.on(signal, handler);
  }
  let outcome;
  try {
    outcome = await new Promise((resolve) => {
      child.once("error", () => {
        failedToStart = true;
        log.error("Test child could not start (details redacted).");
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (interrupted || outcome.signal) {
      log.warn("Test run interrupted; cleanup skipped while child termination is uncertain. Only this run's namespace may remain.");
      return interrupted === "SIGINT" || outcome.signal === "SIGINT" ? 130 : 143;
    }
    if (failedToStart) return 1;
    if (cleanup) {
      try { await cleanup(); }
      catch {
        log.error("Test cleanup failed (connection details redacted). Inspect this run's namespace only.");
        return 1;
      }
    }
    return outcome.code ?? 1;
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
}
