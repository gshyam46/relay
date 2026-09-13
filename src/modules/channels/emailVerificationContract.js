import { createHash, createPublicKey } from "node:crypto";
import { isValidEmailMailbox, isValidSendgridPublicKey } from "./emailConnectionContract.js";
export const VERIFICATION_VERSION = 1;
export const CHECK_TTL_MS = 86400000;
export const CHECK_LEASE_MS = 120000;
export const CHECK_IDS = Object.freeze(["credential", "sender_domain", "event_webhook", "inbound_parse", "inbound_signature"]);
export const PROOF_KINDS = Object.freeze(["DELIVERY", "FAILURE", "REPLY", "STOP"]);
export function verificationError(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
export function invalidVerificationState() { return verificationError("EMAIL_VERIFICATION_STATE_INVALID", "Saved provider verification requires operational inspection.", 503); }
export function verificationObject(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw verificationError("EMAIL_VERIFICATION_INVALID_INPUT", "Provide only the supported verification fields.", 400);
}
export function verificationText(value, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw verificationError("EMAIL_VERIFICATION_INVALID_INPUT", "Provide a bounded verification identifier or reason.", 400);
  return value.trim();
}
export function sha(value) { return createHash("sha256").update(value).digest("hex"); }
export function keyFingerprint(value) {
  if (!isValidSendgridPublicKey(value)) return null;
  const key = value.includes("BEGIN PUBLIC KEY") ? createPublicKey(value) : createPublicKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "spki" });
  return sha(key.export({ type: "spki", format: "der" }));
}
export function verificationRuntime({ publicOrigin = null, controlledRecipients = {} } = {}) {
  let origin = null;
  if (publicOrigin) { const url = new URL(publicOrigin); if (url.origin !== publicOrigin || !["http:", "https:"].includes(url.protocol)) throw new TypeError("Invalid verification origin."); origin = url.origin; }
  const recipients = {};
  for (const role of ["delivery", "failure"]) {
    const value = controlledRecipients?.[role];
    if (value != null && value !== "" && !isValidEmailMailbox(value)) throw new TypeError("Invalid controlled verification mailbox.");
    recipients[role] = value ? value.toLowerCase() : null;
  }
  if (recipients.delivery && recipients.delivery === recipients.failure) throw new TypeError("Controlled verification recipients must be distinct.");
  return Object.freeze({ publicOrigin: origin, controlledRecipients: Object.freeze(recipients) });
}
export function runtimeConfigured(runtime) { return Boolean(runtime?.publicOrigin?.startsWith("https://") && runtime.controlledRecipients?.delivery && runtime.controlledRecipients?.failure); }
export function probeCopy(run, purpose) {
  const subject = "AI Lead Intelligence & Outbound Automation: controlled email verification";
  const reply = "I am interested. Verification code " + run.nonce + ".";
  const stop = "Stop contacting me. Verification code " + run.nonce + ".";
  const body = purpose === "DELIVERY"
    ? "This is the single delivery check explicitly approved for the deployment-controlled mailbox. It is not customer outreach.\n\nReply with exactly:\n" + reply + "\n\nThen send a separate reply with exactly:\n" + stop + "\n\nThe stop request will remain effective; this check does not resubscribe this address."
    : "This is the single failure check explicitly approved for the deployment-controlled rejection sink. It is not customer outreach.\n\nVerification code " + run.nonce + ".\nThe sink must reject delivery so the signed failure path can be verified.";
  return { subject, body, reply, stop };
}
export function parseChecks(value) {
  let parsed;
  try { if (typeof value !== "string" || Buffer.byteLength(value) > 16384) throw new Error(); parsed = JSON.parse(value); } catch { throw invalidVerificationState(); }
  if (!parsed || parsed.version !== VERIFICATION_VERSION || !Array.isArray(parsed.checks) || parsed.checks.length !== CHECK_IDS.length || parsed.checks.some((row, i) => row.id !== CHECK_IDS[i] || !["PASS", "FAIL", "UNKNOWN"].includes(row.status) || typeof row.code !== "string" || !/^[A-Z0-9_]{1,100}$/.test(row.code) || !(row.http_status === null || Number.isInteger(row.http_status) && row.http_status >= 100 && row.http_status <= 599))) throw invalidVerificationState();
  return { version: VERIFICATION_VERSION, checks: parsed.checks.map(({ id, status, code, http_status }) => ({ id, status, code, http_status })) };
}
export function emptyChecks(code = "NOT_CHECKED") { return { version: VERIFICATION_VERSION, checks: CHECK_IDS.map(id => ({ id, status: "UNKNOWN", code, http_status: null })) }; }
export function canonicalTime(value) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalidVerificationState(); return Date.parse(value); }
