const BASE = "/api";

class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// The app has exactly one thing to do when any request comes back 401: treat the session as
// gone and fall back to the sign-in screen. Centralizing that here means individual pages don't
// each need their own "am I still logged in" logic — see App.tsx, which wires this once.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

export function isServiceUnavailable(error: unknown) { return error instanceof ApiError && (error.status >= 500 || error.status === 0 || error.status === 404); }
export function isComingSoon(error: unknown) { return error instanceof ApiError && (error.body as { code?: string } | null)?.code === "BACKEND_NOT_CONFIGURED"; }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    let res: Response;
    try { res = await fetch(BASE + path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, signal: controller.signal }); }
    catch { throw new ApiError(controller.signal.aborted ? 504 : 503, { code: "BACKEND_UNAVAILABLE", error: "The service could not be reached." }); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ code: "BACKEND_RESPONSE_INVALID", error: "The service returned an unavailable response." }));
      if (res.status === 401) unauthorizedHandler?.();
      throw new ApiError(res.status, body);
    }
    if (res.status === 204) return undefined as T;
    try { if (!res.headers.get("content-type")?.includes("application/json")) throw new Error(); return await res.json(); }
    catch { throw new ApiError(502, { code: "BACKEND_RESPONSE_INVALID", error: "The service response could not be confirmed." }); }
  } finally { clearTimeout(timer); }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
};

export { ApiError };

// Downloads the server's serialized selection; never reconstruct CSV from cached rows.
export async function downloadLeadExport(leadIds: string[]): Promise<number> {
  const res = await fetch(BASE + "/leads/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_ids: leadIds }) });
  if (!res.ok) { const body = await res.json().catch(() => res.statusText); if (res.status === 401) unauthorizedHandler?.(); throw new ApiError(res.status, body); }
  const count = Number(res.headers.get("X-Export-Record-Count"));
  if (!res.headers.get("Content-Type")?.toLowerCase().startsWith("text/csv") || !Number.isInteger(count) || count !== leadIds.length) throw new Error("Export response did not confirm the exact selected records. No download was created.");
  const blob = await res.blob();
  if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error("Export response is empty or too large. No download was created.");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = "leads-export.csv"; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return count;
}
