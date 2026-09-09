import { readFile } from "node:fs/promises";
import path from "node:path";
import { describeError } from "./errors.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

export async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

export function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

/**
 * Renders an error as an HTTP response and logs it.
 *
 * Expected errors (4xx — validation, auth, not found) return their message to
 * the caller, because that message is the product telling the user what to fix.
 * Unexpected errors (5xx) return a generic message plus the request id: the real
 * message is written to the structured log instead, so that a SQL fragment or a
 * stack detail never reaches a browser in production.
 *
 * `error` is still read for `statusCode`/`publicMessage`, so the plain Errors
 * thrown by the existing per-module `httpError()` helpers keep working unchanged.
 */
export function sendError(response, error, { logger = null, requestId = null } = {}) {
  const described = describeError(error);

  logger?.[described.expected ? "warn" : "error"]("http.request_failed", {
    status: described.statusCode,
    code: described.code,
    message: described.message,
    ...(described.expected ? {} : { error })
  });

  sendJson(response, described.statusCode, {
    error: described.expected ? described.message : "Unexpected server error.",
    code: described.code,
    ...(described.details ? { details: described.details } : {}),
    ...(requestId ? { request_id: requestId } : {})
  });
}

export async function serveStatic(request, response, publicDir) {
  const url = new URL(request.url, "http://localhost");
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = path.normalize(requestedPath).replace(/^([/\\])+/, "");
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(content);
  } catch {
    // Single-page app client-side routing: any path without a file extension
    // (e.g. /leads/123) falls back to index.html instead of 404ing.
    if (!path.extname(normalized)) {
      try {
        const indexContent = await readFile(path.join(publicDir, "index.html"));
        response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
        response.end(indexContent);
        return;
      } catch {
        // fall through to 404 below
      }
    }
    response.writeHead(404);
    response.end("Not found");
  }
}
