import { createHash } from "node:crypto";

export const PREPARED_POLICY_VERSION = "l1-04-l1-08-reviewed-dispatch-v1";
export const SEND_ACTION_TYPES = new Set(["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "SEND_VOICE_CALL"]);
export const CHANNEL_CONFIGURATION = {
  SEND_EMAIL: { channel: "EMAIL", category: "channel_email", providers: ["sandbox", "resend", "sendgrid"] },
  SEND_SMS: { channel: "SMS", category: "channel_sms", providers: ["sandbox", "twilio"] },
  SEND_WHATSAPP: { channel: "WHATSAPP", category: "channel_whatsapp", providers: ["sandbox", "meta"] },
  SEND_VOICE_CALL: { channel: "VOICE", category: "channel_call", providers: ["sandbox", "twilio_voice"] }
};

export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function reviewError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
