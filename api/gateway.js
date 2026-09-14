import { isIP } from "node:net";
import { submitStoredInterest } from "../deployment/interest-store.js";
import { normalizePilotRequest } from "../src/modules/public-interest/pilotInterestService.js";
const MAX_BODY = 1024 * 1024, MAX_RESPONSE = 4 * 1024 * 1024;
const fail = (status, code) => Object.assign(new Error(code), { statusCode: status, code });
function origin(value, allowLoopback) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw fail(503, "FRONTEND_CONFIGURATION_UNAVAILABLE");
  return url.origin;
}
function json(response, status, value) { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); }
async function bodyBytes(request, limit = MAX_BODY) {
  if (Number(request.headers["content-length"]) > limit) throw fail(413, "REQUEST_TOO_LARGE");
  if (request.body !== undefined) {
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body));
    if (bytes.length > limit) throw fail(413, "REQUEST_TOO_LARGE"); return bytes;
  }
  const chunks = []; let size = 0;
  for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) throw fail(413, "REQUEST_TOO_LARGE"); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
async function boundedResponse(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE) throw fail(502, "BACKEND_RESPONSE_INVALID"); chunks.push(Buffer.from(value)); } return Buffer.concat(chunks); }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
}
export function createGateway({ env = process.env, fetchImpl = fetch, submitInterest = submitStoredInterest, allowLoopback = false, timeoutMs = 12000 } = {}) {
  return async function gateway(request, response) {
    response.setHeader("cache-control", "no-store"); response.setHeader("x-content-type-options", "nosniff");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const incoming = new URL(request.url, "http://gateway.local"), selected = request.query?.route ?? incoming.searchParams.get("route");
      const route = selected ?? incoming.pathname.replace(/^\/api\/?/, "");
      if (typeof route !== "string" || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(route)) throw fail(404, "API_ROUTE_NOT_FOUND");
      if (!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method)) throw fail(405, "METHOD_NOT_ALLOWED");
      const frontend = origin(env.FRONTEND_ORIGIN || (env.VERCEL_URL ? "https://" + env.VERCEL_URL : ""), allowLoopback);
      if (!["GET", "HEAD"].includes(request.method) && (request.headers.origin !== frontend || request.headers["sec-fetch-site"] === "cross-site")) throw fail(403, "REQUEST_ORIGIN_DENIED");
      incoming.searchParams.delete("route");
      if (route === "public/pilot-requests") {
        if (request.method !== "POST") throw fail(405, "METHOD_NOT_ALLOWED");
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw fail(415, "JSON_REQUIRED");
        let input; try { input = JSON.parse((await bodyBytes(request, 16384)).toString("utf8")); } catch (error) { if (error.statusCode) throw error; throw fail(400, "PILOT_REQUEST_INVALID"); }
        normalizePilotRequest(input);
        if (input.website?.trim()) throw fail(400, "PILOT_REQUEST_INVALID");
        // Vercel overwrites x-vercel-forwarded-for. Never trust generic forwarded headers.
        const peer = env.VERCEL === "1" ? request.headers["x-vercel-forwarded-for"] : allowLoopback ? request.socket?.remoteAddress : null;
        if (typeof peer !== "string" || !isIP(peer)) throw fail(503, "INTEREST_INTAKE_UNAVAILABLE");
        const result = await submitInterest(input, peer, env);
        if (result?.accepted !== true) throw fail(503, "INTEREST_INTAKE_UNAVAILABLE");
        json(response, 202, { accepted: true }); return;
      }
      if (/^(webhooks|callbacks|dev)(\/|$)/.test(route)) throw fail(404, "API_ROUTE_NOT_FOUND");
      if (!env.BACKEND_ORIGIN) throw fail(503, "BACKEND_NOT_CONFIGURED");
      const backend = origin(env.BACKEND_ORIGIN, allowLoopback);
      if (backend === frontend) throw fail(503, "FRONTEND_CONFIGURATION_UNAVAILABLE");
      const headers = {};
      for (const key of ["content-type", "accept", "cookie", "origin", "sec-fetch-site"]) if (typeof request.headers[key] === "string") headers[key] = request.headers[key];
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : await bodyBytes(request);
      const upstream = await fetchImpl(backend + "/api/" + route + (incoming.searchParams.size ? "?" + incoming.searchParams : ""), { method: request.method, headers, body, signal: controller.signal, redirect: "manual" });
      if (upstream.status >= 300 && upstream.status < 400) throw fail(502, "BACKEND_RESPONSE_INVALID");
      const type = upstream.headers.get("content-type") || "";
      if (upstream.status !== 204 && request.method !== "HEAD" && !/application\/json|text\/csv/.test(type)) throw fail(502, "BACKEND_RESPONSE_INVALID");
      const bytes = await boundedResponse(upstream);
      for (const key of ["content-type", "content-disposition", "x-export-record-count", "retry-after"]) { const value = upstream.headers.get(key); if (value) response.setHeader(key, value); }
      const cookies = upstream.headers.getSetCookie(); if (cookies.length) response.setHeader("set-cookie", cookies);
      response.statusCode = upstream.status; response.end(bytes);
    } catch (error) {
      const status = Number.isInteger(error.statusCode) ? error.statusCode : 503;
      const code = typeof error.code === "string" && /^(PILOT_REQUEST_|REQUEST_|JSON_REQUIRED|METHOD_NOT_ALLOWED|API_ROUTE_|BACKEND_|FRONTEND_|INTEREST_)/.test(error.code) ? error.code : "BACKEND_UNAVAILABLE";
      if (error.retryAfterSeconds) response.setHeader("retry-after", String(error.retryAfterSeconds));
      json(response, status, { code, error: status === 429 ? "Too many requests. Please try again later." : status < 500 ? "The request could not be accepted. Review your details and try again." : "This service is currently unavailable. Please try again shortly." });
    } finally { clearTimeout(timer); }
  };
}
export default createGateway();
