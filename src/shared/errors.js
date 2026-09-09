/**
 * Application error taxonomy.
 *
 * Two things every error carries: an HTTP `statusCode` and a machine-readable
 * `code`. The code is what a client can branch on; the message is for humans and
 * may change. `expected: true` marks errors that are a normal part of the
 * product's operation (a validation failure, a missing record) as opposed to
 * defects — the API layer logs the two differently and only reveals the message
 * of the former to callers.
 *
 * `statusCode` and `publicMessage` are kept as plain properties because the
 * pre-existing per-module `httpError()` helpers already set them, and
 * `sendError()` has always read them. An AppError is therefore a strict
 * superset of what the codebase already threw.
 */
export class AppError extends Error {
  constructor(message, { statusCode = 500, code = "internal_error", expected = false, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expected = expected;
    this.details = details;
    if (expected) {
      this.publicMessage = message;
    }
  }
}

export function validationError(message, details = null) {
  return new AppError(message, { statusCode: 400, code: "validation_failed", expected: true, details });
}

export function unauthorizedError(message = "Authentication is required.") {
  return new AppError(message, { statusCode: 401, code: "unauthorized", expected: true });
}

export function forbiddenError(message = "You do not have access to this resource.") {
  return new AppError(message, { statusCode: 403, code: "forbidden", expected: true });
}

export function notFoundError(message = "Resource not found.") {
  return new AppError(message, { statusCode: 404, code: "not_found", expected: true });
}

export function conflictError(message, details = null) {
  return new AppError(message, { statusCode: 409, code: "conflict", expected: true, details });
}

export function internalError(message, cause) {
  return new AppError(message, { statusCode: 500, code: "internal_error", expected: false, cause });
}

/**
 * Normalises anything thrown anywhere in the app into a consistent shape for
 * logging and for the HTTP response.
 *
 * Errors thrown by the pre-existing `httpError()`/`validationError()` helpers
 * are plain Errors carrying a `statusCode`. Any 4xx is treated as expected —
 * those are deliberate, caller-facing rejections. A 5xx (or a status-less error,
 * which is an unhandled defect) is not, and its message is withheld from the
 * response.
 */
export function describeError(error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const expected = error?.expected ?? (statusCode >= 400 && statusCode < 500);
  return {
    statusCode,
    expected,
    code: error?.code || defaultCodeFor(statusCode),
    message: error?.publicMessage || error?.message || "Unexpected server error.",
    details: error?.details || null
  };
}

function defaultCodeFor(statusCode) {
  switch (statusCode) {
    case 400:
      return "validation_failed";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return statusCode >= 500 ? "internal_error" : "request_failed";
  }
}
