export async function drainApplication({ server, worker, executor, db, backgroundWork = Promise.resolve(), webhookInbox = null, timeoutMs = 30000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError("Shutdown grace must be between 1 and 60000 milliseconds.");
  server.stopAcceptingRequests?.();
  webhookInbox?.stopAccepting();
  executor.stopAccepting();
  worker.stop();
  const closed = new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
  // Never close the database beneath a background worker or provider completion.
  const complete = (async () => {
    await Promise.all([closed.then(() => server.drainRequests?.()), backgroundWork, worker.drain(), executor.drain(), webhookInbox?.drain()]);
    await db.close();
  })();
  let timer;
  try {
    await Promise.race([
      complete,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Shutdown deadline exceeded; in-flight dispatch remains held for recovery."),
          { code: "SHUTDOWN_TIMEOUT" })), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
