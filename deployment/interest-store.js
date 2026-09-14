import { PostgresDatabaseClient } from "../src/database/postgresClient.js";
import { PilotInterestService } from "../src/modules/public-interest/pilotInterestService.js";
const qualify = sql => sql.replace(/\b(pilot_interest_requests|pilot_request_limits|pilot_interest_operations)\b/g, "relay_interest.$1");
export function scopedInterestDatabase(db) {
  return { kind: "postgres", get: (sql, args) => db.get(qualify(sql), args), all: (sql, args) => db.all(qualify(sql), args), run: (sql, args) => db.run(qualify(sql), args), transaction: (work, options) => db.transaction(tx => work(scopedInterestDatabase(tx)), options) };
}
export async function openInterestDatabase(env = process.env) {
  if (!env.INTEREST_DATABASE_URL) throw new Error("Interest storage unavailable");
  const db = await PostgresDatabaseClient.connect({ connectionString: env.INTEREST_DATABASE_URL, ssl: true, sslCa: env.INTEREST_DATABASE_SSL_CA, environment: "production", maxConnections: 1, connectionTimeoutMillis: 4000, statementTimeoutMillis: 5000, queryTimeoutMillis: 6000, idleInTransactionSessionTimeoutMillis: 5000 });
  return { db: scopedInterestDatabase(db), close: () => db.close() };
}
export async function submitStoredInterest(input, peer, env = process.env) {
  const connection = await openInterestDatabase(env);
  try { return await new PilotInterestService(connection.db, { secret: env.INTEREST_ADMISSION_SECRET }).submit(input, peer); }
  finally { await connection.close(); }
}
