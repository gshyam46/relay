import { createPublicKey, verify } from "node:crypto";
import { assertIdentityEncoding, readRequestBody } from "../../shared/requestBody.js";

export function verifySendgridWebhook({ headers, rawBody, publicKey, allowUnsignedTest = false }) {
  const signature = headers["x-twilio-email-event-webhook-signature"];
  const timestamp = headers["x-twilio-email-event-webhook-timestamp"];
  // Synthetic compatibility is explicit and only supplied by local test
  // configuration. Configured keys always require a valid signature.
  if (!publicKey && allowUnsignedTest && !signature && !timestamp) return;
  if (typeof publicKey !== "string" || !publicKey.trim()) {
    throw failure(503, "WEBHOOK_VERIFICATION_UNCONFIGURED", "Provider webhook verification is not configured.");
  }
  if (typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp) ||
      typeof signature !== "string" || signature.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
    throw failure(401, "WEBHOOK_SIGNATURE_INVALID", "Provider webhook signature is invalid.");
  }
  let valid = false;
  try {
    const key = publicKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(publicKey)
      : createPublicKey({ key: Buffer.from(publicKey.trim(), "base64"), format: "der", type: "spki" });
    valid = key.asymmetricKeyType === "ec" && verify(
      "sha256", Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]),
      key, Buffer.from(signature, "base64")
    );
  } catch { /* Never include key material or provider-controlled values. */ }
  if (!valid) throw failure(401, "WEBHOOK_SIGNATURE_INVALID", "Provider webhook signature is invalid.");
  // Do not invent a short timestamp expiry that can discard provider retries.
  // Durable provider event identity handles replay; retry/freshness acceptance
  // for actual provider traffic remains a deployment integration gate.
}

export async function readBoundedWebhookBody(request, maxBytes) {
  assertIdentityEncoding(request);
  try { return await readRequestBody(request, { maxBytes, timeoutMs: request.bodyPolicy?.timeoutMs || 10000 }); }
  catch (error) {
    if (error.code === "REQUEST_BODY_TOO_LARGE") throw Object.assign(
      failure(413, "WEBHOOK_BODY_TOO_LARGE", "Provider webhook payload is too large."), { closeConnection: true });
    throw error;
  }
}

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
