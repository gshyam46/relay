import { readFile } from "node:fs/promises";
import path from "node:path";
import { describeError } from "./errors.js";
import { readJsonBody } from "./requestBody.js";

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
  return readJsonBody(request, request.bodyPolicy);
}

export function sendJson(response, statusCode, body) {
  if (response.destroyed || response.writableEnded || response.headersSent) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

/**
 * Renders an error as an HTTP response and logs it.
 *
 * Expected errors (4xx — validation, auth, not found) return their message to
 * the caller, because that message is the product telling the user what to fix.
 * Unexpected errors (5xx) return a generic message plus the request id: routine logs retain safe status/code/request correlation only. SQL, provider
 * bodies and stacks belong in neither public responses nor routine logs.
 *
 * `error` is still read for `statusCode`/`publicMessage`, so the plain Errors
 * thrown by the existing per-module `httpError()` helpers keep working unchanged.
 */
export function sendError(response, error, { logger = null, requestId = null } = {}) {
  const described = describeError(error);
  logger?.[described.expected ? "warn" : "error"]("http.request_failed", {
    status: described.statusCode, code: described.code
  });
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.destroy?.(); return; }
  if (error?.closeConnection) {
    response.shouldKeepAlive = false;
    response.setHeader?.("connection", "close");
  }
  if (Number.isSafeInteger(error?.retryAfterSeconds) && error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 86400) {
    response.setHeader?.("retry-after", String(error.retryAfterSeconds));
  }
  sendJson(response, described.statusCode, {
    error: described.expected ? described.message : "Unexpected server error.",
    code: described.code,
    ...(described.expected && described.details ? { details: described.details } : {}),
    ...(requestId ? { request_id: requestId } : {})
  });
}

export async function serveStatic(request, response, publicDir, { publicOrigin = null } = {}) {
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
    const document = contentType.startsWith("text/html") ? applicationDocument(content, url.pathname, response, publicOrigin) : content;
    response.writeHead(200, { "content-type": contentType });
    response.end(document);
  } catch {
    // Single-page app client-side routing: any path without a file extension
    // (e.g. /leads/123) falls back to index.html instead of 404ing.
    if (!path.extname(normalized)) {
      try {
        const indexContent = await readFile(path.join(publicDir, "index.html"));
        const document = applicationDocument(indexContent, url.pathname, response, publicOrigin);
        response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
        response.end(document);
        return;
      } catch {
        // fall through to 404 below
      }
    }
    response.writeHead(404);
    response.end("Not found");
  }
}

function applicationDocument(content, pathname, response, publicOrigin) {
 let html=content.toString("utf8");response.setHeader("cache-control","no-store");
 if(pathname==="/product-information"){response.setHeader("x-robots-tag","noindex, nofollow");html=html.replace(/<!--PUBLIC_START-->[\s\S]*?<!--PUBLIC_END-->/,"<main style=\"max-width:960px;margin:auto;padding:48px 24px;color:#10212b;background:#f8faf9;font-family:system-ui;line-height:1.7\"><a href=\"/\">Product home</a><p>AI Lead Intelligence &amp; Outbound Automation</p><h1>Product information, privacy and support</h1><p>This is a product preview and Sandbox candidate. The interactive example is synthetic and does not establish live-channel verification.</p><h2>Pilot-interest information</h2><p>The form stores your name, business email, company, workflow description, channel choice and consent for review, along with request identity, timestamps and abuse-prevention metadata. Requests are separate from workspace customer records. Successful submission confirms saved interest; no automatic email or pilot place is promised.</p><h2>Retention and workspace data</h2><p>Pilot-interest records have a declared 90-day retention policy. The operator must run and monitor the retention process. This page does not confirm a scheduled purge has run. Workspace data, external providers and backups have separate operational commitments.</p><h2>Privacy and support contacts</h2><p>The responsible operator identity, privacy contact, support contact and hours have not been published for this preview. Public publication requires those details and an operating access, correction and deletion process. No response SLA is advertised.</p><p><a href=\"/#example\">Explore the synthetic example</a> or <a href=\"/login\">Sign in</a>.</p></main>").replace(/<title>.*?<\/title>/,"<title>Product information | AI Lead Intelligence &amp; Outbound Automation</title>");}
 else if(pathname!=="/"&&pathname!=="/index.html") { response.setHeader("x-robots-tag","noindex, nofollow");html=html.replace(/<!--PUBLIC_START-->[\s\S]*?<!--PUBLIC_END-->/," ").replace(/<title>.*?<\/title>/,"<title>Workspace | AI Lead Intelligence &amp; Outbound Automation</title>"); }
 else if(publicOrigin){const safe=String(publicOrigin).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");html=html.replace("</head>",'<link rel="canonical" href="'+safe+'/" /></head>');}
 return html;
}
