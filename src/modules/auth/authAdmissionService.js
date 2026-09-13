import { createHmac } from "node:crypto";
import { normalizePeerAddress } from "../../shared/httpRequestPolicy.js";

const MINUTE = 60000, HOUR = 60 * MINUTE, GLOBAL_KEY = "0".repeat(64), MAX_ROWS = 10000;
export const AUTH_BUDGETS = Object.freeze({
  LOGIN: Object.freeze({ GLOBAL: Object.freeze({ limit: 200, windowMs: MINUTE }), PEER: Object.freeze({ limit: 30, windowMs: 5 * MINUTE }), ACCOUNT: Object.freeze({ limit: 10, windowMs: 15 * MINUTE }) }),
  REGISTER: Object.freeze({ GLOBAL: Object.freeze({ limit: 20, windowMs: HOUR }), PEER: Object.freeze({ limit: 10, windowMs: HOUR }), ACCOUNT: Object.freeze({ limit: 3, windowMs: HOUR }) })
});

export class AuthAdmissionService {
  constructor({ db, secret, now = Date.now, maxConcurrentHashes = 2 }) {
    if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 4096) throw new TypeError("A bounded auth admission secret of at least 32 bytes is required.");
    if (!Number.isInteger(maxConcurrentHashes) || maxConcurrentHashes < 1 || maxConcurrentHashes > 2) throw new TypeError("Invalid auth concurrency limit.");
    this.db = db; this.secret = secret; this.now = now; this.maxConcurrentHashes = maxConcurrentHashes; this.active = 0;
  }
  async run(command, work) {
    if (typeof work !== "function") throw new TypeError("Auth work is required.");
    if (this.active >= this.maxConcurrentHashes) throw admissionError(503, "AUTH_BUSY", 1);
    this.active++;
    try { await this.admit(command); return await work(); }
    finally { this.active--; }
  }
  async admit({ operation, peerAddress, email }) {
    if (!Object.hasOwn(AUTH_BUDGETS, operation) || typeof email !== "string" || !email.trim() || email.length > 320) {
      throw Object.assign(new Error("Valid authentication input is required."), { statusCode: 400, code: "AUTH_INPUT_INVALID" });
    }
    const peer = normalizePeerAddress(peerAddress), account = email.trim().toLowerCase();
    const keys = { GLOBAL: GLOBAL_KEY, PEER: this.key("PEER", peer), ACCOUNT: this.key("ACCOUNT", account) };
    let result;
    try {
      result = await this.db.transaction(async (tx) => {
        const lock = await tx.get("SELECT id FROM auth_admission_state WHERE id='default'" + (tx.kind === "postgres" ? " FOR UPDATE" : ""));
        if (!lock) throw new Error("Admission state is unavailable.");
        const now = this.now();
        if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw new TypeError("Invalid admission clock.");
        const timestamp = new Date(now).toISOString();
        // Cleanup is bounded and never evicts a live budget to admit a new identity.
        const expired = await tx.all("SELECT * FROM auth_rate_buckets WHERE bucket_kind<>'GLOBAL' AND reset_at<=? ORDER BY reset_at LIMIT 100", [timestamp]);
        const removable = expired.filter((row) => {
          const started = instant(row.window_started_at), reset = instant(row.reset_at);
          return started !== null && reset !== null && reset >= started && reset <= now && Number.isSafeInteger(row.attempts) && row.attempts >= 0;
        });
        if (removable.length) await tx.run("DELETE FROM auth_rate_buckets WHERE (operation,bucket_kind,identity_hash) IN (" + removable.map(() => "(?,?,?)").join(",") + ")",
          removable.flatMap((row) => [row.operation, row.bucket_kind, row.identity_hash]));
        const buckets = [];
        let retry = 0, additions = 0;
        for (const kind of ["GLOBAL", "PEER", "ACCOUNT"]) {
          const spec = AUTH_BUDGETS[operation][kind];
          const row = await tx.get("SELECT * FROM auth_rate_buckets WHERE operation=? AND bucket_kind=? AND identity_hash=?", [operation, kind, keys[kind]]);
          if (kind === "GLOBAL" && !row) throw new Error("Global admission state is unavailable.");
          const started = row ? instant(row.window_started_at) : null, expires = row ? instant(row.reset_at) : null;
          if (row && (started === null || expires === null || expires < started || !Number.isSafeInteger(row.attempts) || row.attempts < 0)) throw new Error("Admission state is invalid.");
          const reset = !row || expires <= now;
          const attempts = reset ? 0 : row.attempts;
          const resetAt = reset ? now + spec.windowMs : expires;
          if (!Number.isSafeInteger(resetAt) || !Number.isFinite(new Date(resetAt).getTime())) throw new Error("Admission clock is invalid.");
          if (attempts >= spec.limit) retry = Math.max(retry, Math.ceil((resetAt - now) / 1000));
          if (!row) additions++;
          buckets.push({ kind, attempts, started: reset ? timestamp : row.window_started_at, reset: new Date(resetAt).toISOString() });
        }
        if (retry) return { rejected: true, retry };
        const count = Number((await tx.get("SELECT COUNT(*) AS n FROM auth_rate_buckets")).n);
        if (!Number.isSafeInteger(count) || count + additions > MAX_ROWS) return { unavailable: true };
        for (const bucket of buckets) {
          await tx.run("INSERT INTO auth_rate_buckets(operation,bucket_kind,identity_hash,window_started_at,reset_at,attempts) VALUES (?,?,?,?,?,?) ON CONFLICT(operation,bucket_kind,identity_hash) DO UPDATE SET window_started_at=excluded.window_started_at,reset_at=excluded.reset_at,attempts=excluded.attempts",
            [operation, bucket.kind, keys[bucket.kind], bucket.started, bucket.reset, bucket.attempts + 1]);
        }
        await tx.run("UPDATE auth_admission_state SET updated_at=? WHERE id='default'", [timestamp]);
        return { admitted: true };
      }, { lockTimeoutMs: 5000 });
    } catch { throw admissionError(503, "AUTH_ADMISSION_UNAVAILABLE", 1); }
    if (result.rejected) throw admissionError(429, "AUTH_RATE_LIMITED", result.retry);
    if (result.unavailable) throw admissionError(503, "AUTH_ADMISSION_UNAVAILABLE", 1);
    return { admitted: true };
  }
  key(kind, identity) { return createHmac("sha256", this.secret).update(JSON.stringify([kind, identity])).digest("hex"); }
}
function instant(value) { const n = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(n) && new Date(n).toISOString() === value ? n : null; }
function admissionError(statusCode, code, retryAfterSeconds) {
  return Object.assign(new Error(code === "AUTH_RATE_LIMITED" ? "Too many authentication attempts. Try again later." : "Authentication is busy. Retry shortly."), { statusCode, code, retryAfterSeconds });
}
