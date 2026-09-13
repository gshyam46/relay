import { createApp } from "./api/app.js";
import { describeConfig, loadConfig, validateConfig } from "./config.js";
import { createDatabase, describeDatabaseFailure, openRuntimeDatabase } from "./database/database.js";
import { createLogger } from "./shared/logger.js";
import { drainApplication } from "./shared/shutdown.js";

async function startServer() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logging.level, json: config.logging.json });

  const problems = validateConfig(config);
  if (problems.length > 0) {
    // Refuse to boot a misconfigured deployment rather than discovering the gap
    // on the first request that happens to need the missing value.
    logger.error("boot.invalid_configuration", { problems });
    process.exitCode = 1;
    return;
  }

  let db;
  try {
    // Only the verified disposable E2E harness may initialize during boot.
    db = config.security.isolatedE2eHarness
      ? await createDatabase(":memory:", { logger })
      : await openRuntimeDatabase(config.database);
  } catch (error) {
    logger.error("boot.database_unavailable", describeDatabaseFailure(error));
    process.exitCode = 1;
    return;
  }
  const app = createApp({ db, logger, config });

  app.listen(config.port, () => {
    logger.info("boot.listening", { url: `http://localhost:${config.port}`, ...describeConfig(config) });
  });

  // The normal worker rotates bounded workspace visits across receipt recovery,
  // lead processing, sequence advancement, human due work and dispatch.
  // The local timer guard avoids overlapping ticks; persisted claims coordinate
  // other requests and processes. Synthetic delivery remains test-only.
  let workerRunning = false;
  let workerCycle = Promise.resolve();
  const workerTimer = config.worker.enabled
    ? setInterval(async () => {
        if (workerRunning) {
          logger.debug("worker.tick_skipped", { reason: "previous tick still running" });
          return;
        }
        workerRunning = true;
        workerCycle = (async () => {
          try {
            const result = await app.services.worker.runOnce();
            logger.debug("worker.tick_completed", { visits: result.visits.length, elapsed_ms: result.elapsed_ms,
              processed_events: result.processed_events.length, executed_actions: result.executed_actions.length,
              processed_runs: result.processed_runs.length, due_follow_ups: result.due_follow_ups.length,
              failed_phases: result.visits.flatMap((visit) => visit.phases).filter((phase) => phase.error_code).length });
            if (config.security.testControlsEnabled) await app.services.worker.autoCompleteMockExecutions();
          } catch (error) {
            logger.error("worker.tick_failed", { code: "SCHEDULER_TICK_FAILED" });
          } finally {
            workerRunning = false;
          }
        })();
        await workerCycle;
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

      try {
        await drainApplication({
          server: app, worker: app.services.worker, executor: app.services.actionExecutor,
          db, backgroundWork: workerCycle, webhookInbox: app.services.webhookInbox, timeoutMs: 30000
        });
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

}

await startServer();
