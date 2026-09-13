/**
 * Compose repositories with a single transaction client. The context belongs
 * only to this callback; providers and other external work must run outside it.
 */
export function createUnitOfWork(db, buildContext) {
  if (typeof db?.transaction !== "function" || typeof buildContext !== "function") {
    throw new TypeError("A database client and transaction context builder are required.");
  }
  return {
    async run(work) {
      if (typeof work !== "function") throw new TypeError("Unit of work requires a callback.");
      return db.transaction(async (tx) => work(await buildContext(tx)));
    }
  };
}
