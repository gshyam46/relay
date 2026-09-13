// Routine logs contain operational metadata, not request/provider bodies or exception text.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACTED = "[REDACTED]";
const SENSITIVE = /(?:password|recovery.?codes?|secret|credential|authorization|cookie|token|api.?key|private.?key|(?:^|_)(?:body|payload|subject|text|email|phone|address|recipient|sender|envelope|headers|sql|query|stack|cause|message|details)(?:_|$))/i;
const RESERVED = new Set(["level", "time", "event"]);
const PATH_PARTS = new Set(("api public pilot-requests composer security recover recovery-codes password sessions revoke-others revoke-all history connection provision rotate intelligence-feedback intelligence-evaluation target candidates requests datasets evaluate evaluations ai jobs usage controls cancel retry auth register login logout me health live ready webhooks sendgrid inbound events callbacks leads intelligence summary synthesis recommendation recommendations next-best-action actions approval preview approve reject revoke executions recovery review domain-events webhook-receipts controls dispatch-controls workflows workflow-runs campaigns sequences enroll control settings channels messages data directory archive export imports import-sources identity-review identity-resolution csv inspect rows commit bulk execute activity follow-ups complete cancel dashboard metrics attention outbound organizations research evidence timeline conversations business-profile enquiry-context history assets index.html").split(" "));
const TRANSPORT_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "ABORT_ERR", "ERR_SOCKET_CLOSED"]);

export function safeErrorCode(value) {
  if (typeof value !== "string") return "internal_error";
  if (/^(?:validation_failed|unauthorized|forbidden|not_found|conflict|rate_limited|internal_error|request_failed)$/.test(value)
    || /^(?:WORKSPACE_DATA|OPERATIONS|CONVERSATION|OUTCOME|CUSTOMER|PILOT|PRODUCT|COMPOSER|CHANNEL|EMAIL|FEEDBACK|EVALUATION|AI|ANALYSIS|EVENT|DISPATCH|WEBHOOK|CONTACT|POLICY|AUTH|HTTP|REQUEST|BODY|WORKFLOW|FOLLOW_UP|DATABASE|MIGRATION|SCHEDULER|OPS|INVALID|ACTION|EXECUTION|PREPARED|REVISION|PROVIDER|OUTBOUND|INTELLIGENCE|FRESHNESS|CONTEXT|BUSINESS_CONTEXT|BUSINESS_FIT|IMPORT|CSV|IDENTITY|AMBIGUOUS|INBOUND|LEAD)_[A-Z0-9_]{1,48}$/.test(value)
    || TRANSPORT_CODES.has(value) || /^(?:08|22|23|28|40|53|54|55|57|58)[A-Z0-9]{3}$/.test(value)) return value;
  return "internal_error";
}

export function safeRequestPath(value) {
  if (typeof value !== "string" || value.length > 8192) return "/:unparsed";
  try {
    const pathname = new URL(value, "http://local.invalid").pathname;
    if (/^\/api\/webhooks\/sendgrid\/(inbound|events)\/[^/]+$/.test(pathname)) return pathname.slice(0, pathname.lastIndexOf("/") + 1) + ":token";
    return pathname.split("/").slice(0, 16).map((part) => !part ? "" : PATH_PARTS.has(part) ? part : ":value").join("/");
  } catch { return "/:unparsed"; }
}

export function createLogger({ level = "info", json = true, bindings = {}, write = defaultWrite } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  // Sanitize bindings at creation as well as fields at emission. Never execute getters.
  const fixed = normalizeFields(bindings);
  function emit(levelName, event, fields) {
    if (LEVELS[levelName] < threshold) return;
    const safeEvent = typeof event === "string" && /^[a-z][a-z0-9_.-]{0,95}$/.test(event) ? event : "log.invalid_event";
    write(levelName, { ...fixed, ...normalizeFields(fields), level: levelName, time: new Date().toISOString(), event: safeEvent }, json);
  }
  return {
    level,
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (extraBindings) => createLogger({ level, json, bindings: { ...fixed, ...normalizeFields(extraBindings) }, write })
  };
}

export function createNullLogger() {
  const noop = () => {};
  return { level: "silent", debug: noop, info: noop, warn: noop, error: noop, child: () => createNullLogger() };
}

function normalizeFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const result = sanitize(fields, 0, new WeakSet(), true);
  return result && typeof result === "object" && !Array.isArray(result) ? result : { unreadable: true };
}
function sanitize(value, depth, seen, top = false) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString().slice(0, 80);
  if (typeof value === "string") return cleanString(value);
  if (typeof value !== "object") return "[UNSUPPORTED]";
  if (depth >= 5) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const status = descriptors.statusCode?.value;
      return { category: "Error", code: safeErrorCode(descriptors.code?.value),
        ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}) };
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) return Object.keys(descriptors).filter((key) => /^\d+$/.test(key)).slice(0, 20)
      .map((key) => "value" in descriptors[key] ? sanitize(descriptors[key].value, depth + 1, seen) : "[ACCESSOR]");
    const output = {};
    for (const [key, descriptor] of Object.entries(descriptors).slice(0, 50)) {
      if (!descriptor.enumerable || (top && RESERVED.has(key))) continue;
      const label = key.length <= 80 ? key : "[LONG_KEY]";
      let result;
      if (SENSITIVE.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]/gi, "_"))) result = REDACTED;
      else if (!("value" in descriptor)) result = "[ACCESSOR]";
      else if (key === "path" || key === "route") result = safeRequestPath(descriptor.value);
      else if (key === "url") {
        try { result = typeof descriptor.value === "string" ? new URL(descriptor.value).origin : REDACTED; } catch { result = REDACTED; }
      } else if (key === "code" || key.endsWith("_error_code")) result = safeErrorCode(descriptor.value);
      else result = sanitize(descriptor.value, depth + 1, seen);
      Object.defineProperty(output, label, { value: result, enumerable: true });
    }
    return output;
  } catch { return "[UNREADABLE]"; }
  finally { seen.delete(value); }
}
function cleanString(value) {
  return value.slice(0, 512)
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[URL]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [\s\S]*/g, "[PEM REDACTED]")
    .replace(/[\r\n\u0000-\u001f]/g, " ");
}
function defaultWrite(levelName, record, json) {
  const stream = levelName === "error" || levelName === "warn" ? process.stderr : process.stdout;
  if (json) { stream.write(JSON.stringify(record) + "\n"); return; }
  const { level, time, event, ...rest } = record;
  const details = Object.entries(rest).map(([key, value]) => key + "=" + (typeof value === "object" ? JSON.stringify(value) : value)).join(" ");
  stream.write(time.slice(11, 23) + " " + level.toUpperCase().padEnd(5) + " " + event + (details ? " " + details : "") + "\n");
}
