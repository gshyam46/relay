import { createApp } from "./api/app.js";
import { describeConfig, loadConfig, validateConfig } from "./config.js";
import { createDatabase } from "./database/database.js";
import { createLogger } from "./shared/logger.js";

const config = loadConfig();
const logger = createLogger({ level: config.logging.level, json: config.logging.json });

const problems = validateConfig(config);
if (problems.length > 0) {
  // Refuse to boot a misconfigured deployment rather than discovering the gap
  // on the first request that happens to need the missing value.
  logger.error("boot.invalid_configuration", { problems });
  process.exit(1);
}

const db = await createDatabase(config.database, { logger });
const app = createApp({ db, logger, config });

app.listen(config.port, () => {
  logger.info("boot.listening", { url: `http://localhost:${config.port}`, ...describeConfig(config) });
});

// Auto-execute pending outbound actions (approved/planned/retrying) without
// requiring a manual "run worker" call. Keeps approve -> execute -> activity
// feeling instant in the product instead of relying on a dev-only endpoint.
//
// autoCompleteMockExecutions runs as a separate tick (not inside runOnce) so that
// runOnce keeps its narrower, predictable meaning for every other caller (tests,
// POST /api/worker/run, WorkflowsService) — only this live-server loop simulates
// the "delivery webhook" that a real provider would eventually send.
//
// `workerRunning` guards against overlap: now that a tick awaits real network
// round trips (Postgres, and eventually a real provider), a slow tick must not
// have the next one start beside it and execute the same action twice.
let workerRunning = false;
const workerTimer = config.worker.enabled
  ? setInterval(async () => {
      if (workerRunning) {
        logger.debug("worker.tick_skipped", { reason: "previous tick still running" });
        return;
      }
      workerRunning = true;
      try {
        await app.services.worker.runOnce();
        await app.services.worker.autoCompleteMockExecutions();
      } catch (error) {
        logger.error("worker.tick_failed", { error });
      } finally {
        workerRunning = false;
      }
    }, config.worker.intervalMs)
  : null;

// Graceful shutdown: stop taking new work, let in-flight requests finish, then
// close the database. Render (and any container platform) sends SIGTERM before
// replacing an instance; without this, a deploy can cut a request mid-write.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutdown.started", { signal });

    if (workerTimer) {
      clearInterval(workerTimer);
    }

    const forceExit = setTimeout(() => {
      logger.error("shutdown.timed_out", { detail: "Forcing exit after 10s." });
      process.exit(1);
    }, 10000);
    forceExit.unref();

    try {
      await new Promise((resolve) => app.close(resolve));
      await db.close();
      logger.info("shutdown.complete");
      process.exit(0);
    } catch (error) {
      logger.error("shutdown.failed", { error });
      process.exit(1);
    }
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
  process.exit(1);
});
