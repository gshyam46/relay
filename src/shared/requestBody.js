const DEFAULT_BODY_LIMIT = 1024 * 1024;
const MAX_BODY_LIMIT = 5 * 1024 * 1024;
const BODY_DEADLINE_MS = 10000;

export async function readRequestBody(request, { maxBytes = DEFAULT_BODY_LIMIT, timeoutMs = BODY_DEADLINE_MS } = {}) {
  assertRequestStream(request);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BODY_LIMIT
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BODY_DEADLINE_MS) throw new TypeError("Invalid request body policy.");
  if (request.aborted || request.destroyed) throw rejectUnreadRequest(request, bodyError(400, "REQUEST_ABORTED", "Request body was interrupted."));
  const declared = request.headers?.["content-length"];
  if (declared !== undefined && (typeof declared !== "string" || !/^[0-9]+$/.test(declared))) {
    throw rejectUnreadRequest(request, bodyError(400, "REQUEST_LENGTH_INVALID", "Request length is invalid."));
  }
  if (declared !== undefined && (!Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
    throw rejectUnreadRequest(request, bodyError(413, "REQUEST_BODY_TOO_LARGE", "Request body is too large."));
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", data); request.off("end", end); request.off("error", failed); request.off("close", closed);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) { chunks.length = 0; reject(rejectUnreadRequest(request, error)); }
      else resolve(value);
    };
    const data = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) return finish(bodyError(413, "REQUEST_BODY_TOO_LARGE", "Request body is too large."));
      chunks.push(bytes);
    };
    const end = () => {
      if (declared !== undefined && Number(declared) !== size) return finish(bodyError(400, "REQUEST_LENGTH_INVALID", "Request body is incomplete."));
      finish(null, Buffer.concat(chunks, size));
    };
    const failed = () => finish(bodyError(400, "REQUEST_ABORTED", "Request body was interrupted."));
    const closed = () => { if (!request.readableEnded) failed(); };
    const timer = setTimeout(() => finish(bodyError(408, "REQUEST_BODY_TIMEOUT", "Request body took too long.")), timeoutMs);
    request.on("data", data); request.once("end", end); request.once("error", failed); request.once("close", closed);
    if (request.readableEnded) end();
  });
}

export async function readJsonBody(request, options) {
  assertRequestStream(request);
  const type = request.headers?.["content-type"];
  if (typeof type !== "string" || !/^application\/json(?:\s*;|\s*$)/i.test(type)) {
    throw rejectUnreadRequest(request, bodyError(415, "REQUEST_MEDIA_TYPE_UNSUPPORTED", "Use application/json for this request."));
  }
  const charset = type.match(/;\s*charset\s*=\s*"?([^;"\s]+)/i)?.[1];
  if (charset && !/^utf-?8$/i.test(charset)) throw rejectUnreadRequest(request, bodyError(415, "REQUEST_ENCODING_UNSUPPORTED", "Use UTF-8 JSON for this request."));
  assertIdentityEncoding(request);
  const raw = await readRequestBody(request, options);
  let body;
  try { body = raw.length ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) : {}; }
  catch { throw bodyError(400, "REQUEST_JSON_INVALID", "Request body must be valid JSON.", false); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bodyError(400, "REQUEST_OBJECT_REQUIRED", "Request body must be an object.", false);
  return body;
}

export function assertIdentityEncoding(request) {
  const encoding = request.headers?.["content-encoding"];
  if (encoding !== undefined && (typeof encoding !== "string" || encoding.trim().toLowerCase() !== "identity")) {
    throw rejectUnreadRequest(request, bodyError(415, "REQUEST_ENCODING_UNSUPPORTED", "Compressed request bodies are not supported."));
  }
}
function bodyError(statusCode, code, message, closeConnection = true) {
  return Object.assign(new Error(message), { statusCode, code, closeConnection });
}

function assertRequestStream(request) {
  if (!request || ["on", "off", "once", "pause"].some((method) => typeof request[method] !== "function")) {
    throw new TypeError("A readable HTTP request stream is required.");
  }
}
const rejectedRequests = new WeakSet();
function rejectUnreadRequest(request, error) {
  // The caller closes rejected requests. A late socket error can arrive between
  // reader rejection and close; guard only that interval without draining bytes.
  if (!request.closed && !rejectedRequests.has(request)) {
    rejectedRequests.add(request);
    const ignore = () => {};
    const closed = () => { request.off("error", ignore); rejectedRequests.delete(request); };
    request.on("error", ignore); request.once("close", closed);
  }
  request.pause();
  return error;
}
