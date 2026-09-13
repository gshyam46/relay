import { createHash } from "node:crypto";
export const IMPORT_CHUNK_ROWS = 25;
export const IMPORT_MAX_CORRECTIONS = 100;
export function importError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function importText(value, name, maximum = 256) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw importError("IMPORT_INVALID_INPUT", name + " requires bounded text without control characters.");
  return value.trim();
}
export function importRevision(value) {
  if (!Number.isInteger(value) || value < 1 || value > 101) throw importError("IMPORT_INVALID_REVISION", "Supply the current import review revision.");
  return value;
}
export function selectedRows(value) {
  if (!Array.isArray(value) || !value.length || value.length > 1000 || value.some(id => typeof id !== "string" || !id || id.length > 256) || new Set(value).size !== value.length) throw importError("IMPORT_INVALID_SELECTION", "Select 1 to 1000 distinct rows from this import.");
  return [...value].sort();
}
export function importFingerprint(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function progressFor(rows) {
  const selected = rows.filter(row => Boolean(row.selected));
  const committed = selected.filter(row => Boolean(row.committed)).length;
  const held = selected.filter(row => row.commit_state === "HELD").length;
  return { selected_rows: selected.length, committed_rows: committed, held_rows: held, remaining_rows: selected.length - committed - held };
}
export function safeFailure() { return { last_error: "IMPORT_ROW_WRITE_FAILED", message: "Import progress was saved. Read its current state and explicitly resume unfinished selected rows." }; }
