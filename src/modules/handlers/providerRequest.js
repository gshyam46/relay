// Return fixed operational errors: provider bodies can contain recipient data or credentials.
// Ambiguous transport/server outcomes stay held; only known rejection may retry.
export const PROVIDER_TIMEOUT_MS = 15000;
const MAX_RETRY_HINT_MS = 24 * 60 * 60 * 1000;

export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || !Number.isFinite(now)) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Math.min(Number.isFinite(seconds) ? seconds * 1000 : MAX_RETRY_HINT_MS, MAX_RETRY_HINT_MS);
  }
  // HTTP dates begin with a weekday. Avoid Date.parse's lenient numeric-date syntax.
  if (!/^[A-Za-z]{3,9},?\s/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.min(MAX_RETRY_HINT_MS, Math.max(0, at - now)) : null;
}

export const PROVIDER_RESPONSE_BYTES = 64 * 1024;

export async function providerRequest(url, options, label, { responseMode = "json", timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROVIDER_TIMEOUT_MS || !["json", "headers"].includes(responseMode)) {
    throw new TypeError("Invalid internal provider transport bounds.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    if (!response.ok) {
      cancelBody(response);
      const uncertain = response.status >= 500 || response.status === 408;
      return {
        ok: false, uncertain, retryable: response.status === 429,
        http_status: response.status,
        ...(response.status === 429 ? { retry_after_ms: parseRetryAfter(response.headers?.get("retry-after")) } : {}),
        error: uncertain ? label + " returned an uncertain server outcome; review before retrying."
          : label + " rejected the request (HTTP " + response.status + ")."
      };
    }
    if (responseMode === "headers") { cancelBody(response); return { ok: true, response, data: null, response_issue: null }; }
    // Headers already confirmed acceptance. Body errors cannot turn it into a retry.
    const parsed = await readBoundedJson(response, controller.signal).catch(() => {
      cancelBody(response); return { data: null, response_issue: "RESPONSE_READ_FAILED" };
    });
    return { ok: true, response, ...parsed };
  } catch {
    return { ok: false, uncertain: true, retryable: false, error: label + " did not confirm the request outcome; review before retrying." };
  } finally { clearTimeout(timer); }
}

async function readBoundedJson(response, signal) {
  const contentType = response.headers?.get("content-type") || "";
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    cancelBody(response); return { data: null, response_issue: "NON_JSON_RESPONSE" };
  }
  if (!response.body?.getReader) return { data: null, response_issue: "MISSING_RESPONSE_BODY" };
  const reader = response.body.getReader();
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(new Error("RESPONSE_TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  let completed = false;
  try {
    const chunks = []; let length = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) { completed = true; break; }
      if (!(value instanceof Uint8Array)) throw new Error("INVALID_RESPONSE_BODY");
      length += value.byteLength;
      if (length > PROVIDER_RESPONSE_BYTES) return { data: null, response_issue: "RESPONSE_TOO_LARGE" };
      chunks.push(value);
    }
    try { return { data: JSON.parse(Buffer.concat(chunks, length).toString("utf8")), response_issue: null }; }
    catch { return { data: null, response_issue: "INVALID_JSON_RESPONSE" }; }
  } catch {
    return { data: null, response_issue: signal.aborted ? "RESPONSE_TIMEOUT" : "RESPONSE_READ_FAILED" };
  } finally {
    signal.removeEventListener("abort", abort);
    if (!completed) { try { void reader.cancel().catch(() => {}); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}
function cancelBody(response) { try { void response.body?.cancel().catch(() => {}); } catch {} }
export function providerReference(value) {
  return typeof value === "string" && value.trim() && value.length <= 512 && !/[\r\n\0]/.test(value) ? value : null;
}

export function preparedProvider(configuration, sender, allowed) {
  if (!configuration || !sender || !allowed.includes(sender.provider)
    || sender.provider !== configuration.provider || typeof sender.from !== "string" || !sender.from) {
    return { ok: false, retryable: false, error: "A captured provider configuration and reviewed sender are required." };
  }
  return null;
}
