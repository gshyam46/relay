import { createHash } from "node:crypto";
import { MAX_PASSWORD_BYTES } from "./passwords.js";
export const MAX_ACCOUNT_SESSIONS = 100;
export const MAX_SECURITY_CHANGES = 1000;
export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const SECURITY_OPERATIONS = ["CHANGE_PASSWORD", "ROTATE_RECOVERY_CODES", "RECOVER", "REVOKE_SESSION", "REVOKE_OTHER_SESSIONS", "REVOKE_ALL_SESSIONS"];
export function securityError(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
export function invalidSecurityInput() { return securityError("AUTH_SECURITY_INPUT_INVALID", "Provide the supported account security fields and values.", 400); }
export function recoveryRejected() { return securityError("AUTH_RECOVERY_REJECTED", "Account recovery could not be verified. Check the account and an unused, unexpired recovery code.", 401); }
export function securityObject(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalidSecurityInput();
}
export function securityPassword(value, { next = false } = {}) {
  if (typeof value !== "string" || !value || (next && value.length < 8) || Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) throw invalidSecurityInput();
  return value;
}
export function securityText(value, max = 200) { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalidSecurityInput(); return value.trim(); }
export function securityInteger(value, { min = 0, max = MAX_SECURITY_CHANGES, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalidSecurityInput(); return value;
}
export function authRevision(user) {
  const revision = user?.auth_revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483647) throw securityError("AUTH_SECURITY_STATE_INVALID", "Account security state needs operational inspection.", 503);
  return revision;
}
export function nextAuthRevision(user) { const value = authRevision(user); if (value === 2147483647) throw securityError("AUTH_SECURITY_LIMIT", "Account security reached its supported revision limit."); return value + 1; }
export function sessionPublicId(id) { return "sref_" + createHash("sha256").update(id).digest("hex"); }
export function recoveryHash(code) { return createHash("sha256").update(code).digest("hex"); }
export function canonicalInstant(value) { const time = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null; }
export function securityNow(now) { const time = now(); if (!Number.isSafeInteger(time) || time < 0 || !Number.isFinite(new Date(time).getTime())) throw securityError("AUTH_SECURITY_STATE_INVALID", "Account security clock needs operational inspection.", 503); return time; }
export function publicSecurityChange(row) {
  try {
    if (!row || typeof row.summary_json !== "string" || Buffer.byteLength(row.summary_json) > 4096) throw new Error();
    const summary = JSON.parse(row.summary_json);
    const keys = ["revoked_session_count", "recovery_generation", "recovery_codes_issued", "recovery_expires_at", "session_public_id"];
    if (!summary || typeof summary !== "object" || Array.isArray(summary) || Object.keys(summary).length !== keys.length || keys.some(key => !Object.hasOwn(summary, key))) throw new Error();
    if (!Number.isSafeInteger(summary.revoked_session_count) || summary.revoked_session_count < 0 || !Number.isSafeInteger(summary.recovery_generation) || summary.recovery_generation < 0 || ![0, RECOVERY_CODE_COUNT].includes(summary.recovery_codes_issued) || (summary.recovery_expires_at !== null && canonicalInstant(summary.recovery_expires_at) === null) || (summary.session_public_id !== null && !/^sref_[0-9a-f]{64}$/.test(summary.session_public_id))) throw new Error();
    if (!SECURITY_OPERATIONS.includes(row.operation) || !["PASSWORD", "RECOVERY_CODE"].includes(row.authentication_method)) throw new Error();
    return { id: row.id, revision: row.revision, operation: row.operation, authentication_method: row.authentication_method, ...summary, created_at: row.created_at, actor_user_id: row.actor_user_id };
  } catch { throw securityError("AUTH_SECURITY_STATE_INVALID", "Account security history needs operational inspection.", 503); }
}
