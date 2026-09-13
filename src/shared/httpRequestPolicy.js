import { isIP } from "node:net";

export class HttpRequestPolicy {
  constructor({ publicAppOrigin, maxInFlight = 64 }) {
    let parsed;
    try { parsed = new URL(publicAppOrigin); } catch { /* Fixed configuration error below. */ }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.origin !== publicAppOrigin) throw new TypeError("A canonical application origin is required.");
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 64) throw new TypeError("Invalid HTTP admission limit.");
    this.publicAppOrigin = publicAppOrigin; this.maxInFlight = maxInFlight; this.inFlight = 0;
  }
  acquire() {
    if (this.inFlight >= this.maxInFlight) throw Object.assign(new Error("The server is busy. Retry shortly."), {
      statusCode: 503, code: "HTTP_BUSY", retryAfterSeconds: 1, closeConnection: true
    });
    this.inFlight++;
    let released = false;
    return () => { if (!released) { released = true; this.inFlight--; } };
  }
  assertOrigin(request, { supportedWebhook = false, stateChangingGet = false } = {}) {
    if (supportedWebhook || (!stateChangingGet && ["GET", "HEAD", "OPTIONS"].includes(request.method))) return;
    const origin = request.headers?.origin;
    const site = request.headers?.["sec-fetch-site"];
    if (site !== undefined && (typeof site !== "string" || !["same-origin", "same-site", "none"].includes(site.toLowerCase()))) throw originError();
    if (origin === undefined) return; // Non-browser clients still require the route's authentication.
    if (typeof origin !== "string" || origin !== this.publicAppOrigin) throw originError();
  }
}

// Socket peer only: forwarded headers never select or multiply auth rate buckets.
export function socketPeerAddress(request) { return normalizePeerAddress(request.socket?.remoteAddress); }
export function normalizePeerAddress(value) {
  if (typeof value !== "string" || value.length > 128) throw Object.assign(new Error("Request peer is unavailable."), { statusCode: 503, code: "AUTH_ADMISSION_UNAVAILABLE" });
  let peer = value.toLowerCase();
  if (peer.startsWith("::ffff:") && isIP(peer.slice(7)) === 4) peer = peer.slice(7);
  const version = isIP(peer);
  if (!version) throw Object.assign(new Error("Request peer is unavailable."), { statusCode: 503, code: "AUTH_ADMISSION_UNAVAILABLE" });
  return version === 6 ? new URL("http://[" + peer + "]").hostname.slice(1, -1) : peer;
}
function originError() { return Object.assign(new Error("Request origin is not allowed."), { statusCode: 403, code: "REQUEST_ORIGIN_DENIED", closeConnection: true }); }
