import { createHash } from "node:crypto";
export const INVENTORY_VERSION = 1;
export const MAX_WORKSPACE_ROWS = 50000;
export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
export const MAX_ERASURES = 1000;
export const ERASURE_CONFIRMATION = "ERASE WORKSPACE CUSTOMER DATA";
export function lifecycleError(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
export function invalidInput() { return lifecycleError("WORKSPACE_DATA_INPUT_INVALID", "Provide the supported workspace data fields and exact confirmation.", 400); }
export function stateInvalid() { return lifecycleError("WORKSPACE_DATA_STATE_INVALID", "Workspace data requires operational inspection before this operation.", 503); }
export function boundedFailure() { return lifecycleError("WORKSPACE_DATA_LIMIT", "Workspace data exceeds 50000 rows or 32 MiB. An inspected offline operation is required."); }
export function exactObject(value, allowed, required = allowed) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw invalidInput(); }
export function text(value, max = 200) { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalidInput(); return value; }
export function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex"); }
export function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])); return value; }
export function validDigest(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
export const RETAINED = Object.freeze(["Workspace and account identity", "Sessions, password and offline recovery/security records", "Minimum exact-contact suppression", "Dispatch pause and technical freshness clock", "Completed erasure receipts"]);
export const LIMITATIONS = Object.freeze(["This erases workspace customer data, not the account.", "Active database deletion does not erase backups, logs, exported files or provider copies.", "Database pages and storage replicas may retain physical remnants until separately managed.", "Before restoring service, independently reconcile erasures and suppression recorded after the selected backup.", "Protected evaluation datasets and membership are omitted from exports; original customer records are exported independently.", "No automatic retention schedule, account deletion, backup purge or provider deletion is performed."]);
