import { constants, lstatSync, openSync, realpathSync, closeSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

export const REPORT_RELATIVE_PATH = "docs/verification/L3-02-evaluation.json";
export const REPORT_MAX_BYTES = 1048576;
export function parseEvaluationArgs(args) {
  if (!Array.isArray(args) || args.length > 1 || args.some(arg => arg !== "--check")) throw new Error("Only --check is accepted. Evaluation uses bundled synthetic inputs and a fixed report destination.");
  return { writeReport: !args.includes("--check") };
}
export function disableEvaluationNetwork() {
  const refuse = () => { throw new Error("Evaluation forbids network access."); };
  globalThis.fetch = refuse;
  if (globalThis.WebSocket) globalThis.WebSocket = class { constructor() { refuse(); } };
  for (const transport of [http, https]) { transport.request = refuse; transport.get = refuse; }
  net.connect = refuse; net.createConnection = refuse; net.Socket.prototype.connect = refuse; dgram.createSocket = refuse;
  syncBuiltinESMExports();
}
export function serializeEvaluationReport(report) {
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > REPORT_MAX_BYTES) throw new Error("Evaluation report exceeds the fixed byte limit.");
  return serialized;
}
export function writeEvaluationReport(report) {
  const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  const directory = join(root, "docs", "verification"), file = resolve(root, REPORT_RELATIVE_PATH);
  const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(realpathSync(directory), directory) || !same(resolve(directory, "L3-02-evaluation.json"), file)) throw new Error("Evaluation report directory must remain inside the workspace.");
  let entry;
  try { entry = lstatSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (entry && (!entry.isFile() || entry.isSymbolicLink() || entry.nlink > 1)) throw new Error("Evaluation refuses a non-regular or linked report destination.");
  const serialized = serializeEvaluationReport(report);
  const handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
  try { writeFileSync(handle, serialized, "utf8"); } finally { closeSync(handle); }
  return REPORT_RELATIVE_PATH;
}
