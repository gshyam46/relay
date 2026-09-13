export const DEFAULT_DISPATCH_POLICY = Object.freeze({
  maxAttempts: 3, retryWindowMs: 60 * 60 * 1000,
  baseRetryMs: 30000, maxRetryMs: 5 * 60 * 1000,
  leaseMs: 60000, providerKeyWindowMs: 23 * 60 * 60 * 1000
});

export function resolveDispatchPolicy(overrides = {}) {
  const policy = { ...DEFAULT_DISPATCH_POLICY, ...overrides };
  for (const key of Object.keys(DEFAULT_DISPATCH_POLICY)) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new TypeError("Dispatch policy requires positive integer limits.");
  }
  if (policy.maxAttempts > 100 || policy.baseRetryMs > policy.maxRetryMs || policy.providerKeyWindowMs > DEFAULT_DISPATCH_POLICY.providerKeyWindowMs) throw new TypeError("Dispatch policy limits are invalid.");
  return Object.freeze(policy);
}

export function instantMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

export function currentTime(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError("Dispatch clock must return valid epoch milliseconds.");
  }
  return value;
}

export function iso(value) { return new Date(value).toISOString(); }

export function retryDue({ nowMs, attempt, retryAfterMs = null, policy, random }) {
  const ceiling = Math.min(policy.maxRetryMs, policy.baseRetryMs * 2 ** Math.min(Math.max(attempt - 1, 0), 30));
  const draw = random();
  if (typeof draw !== "number" || !Number.isFinite(draw) || draw < 0 || draw > 1) throw new TypeError("Dispatch jitter source is invalid.");
  const jitter = Math.ceil(ceiling * (0.5 + draw * 0.5));
  const hint = Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 0;
  const due = nowMs + Math.max(jitter, hint);
  return Number.isSafeInteger(due) && Number.isFinite(new Date(due).getTime()) ? due : Infinity;
}

export function providerIntentKey(action, revisionId) {
  return revisionId ? `relay-action-${action.id}-revision-${revisionId}` : `relay-action-${action.id}-internal`;
}

export function dispatchError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function executionDetail(action, executions) {
  const execution = executions.find((row) => row.id === action.active_execution_id) || executions.at(-1) || null;
  const used = executions.length;
  return {
    action_id: action.id, status: action.status, execution,
    active_execution_id: action.active_execution_id || null,
    execution_fence: Number(action.execution_fence || 0),
    outcome_class: execution?.outcome_class || null,
    hold_reason: action.execution_hold_reason || null,
    next_attempt_at: action.next_attempt_at || null,
    first_dispatch_at: action.first_dispatch_at || null,
    retry_deadline_at: action.retry_deadline_at || null,
    max_attempts: Number(action.max_attempts),
    attempts_used: used, attempts_remaining: Math.max(0, Number(action.max_attempts) - used)
  };
}
