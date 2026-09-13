import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

export class ExecutionsRepository {
  constructor(db) { this.db = db; }

  async nextAttempt(actionId) {
    const row = await this.db.get("SELECT COALESCE(MAX(attempt), 0) AS last_attempt FROM action_executions WHERE action_id = ?", [actionId]);
    return Number(row.last_attempt) + 1;
  }

  async countForAction(actionId) {
    const row = await this.db.get("SELECT COUNT(*) AS count FROM action_executions WHERE action_id = ?", [actionId]);
    return Number(row.count);
  }

  // New dispatch callers supply the frozen revision, claim and outcome fields.
  // Omitted values remain explicitly unknown for legacy/synthetic setup callers.
  async createExecution({
    id = createId("exec"), action_id, status, attempt, provider, provider_reference = null, idempotency_key, error = null,
    started_at = nowIso(), completed_at = status === "FAILED" || status === "COMPLETED" ? started_at : null,
    action_revision_id = null, envelope_hash = null, provider_intent_key = null, provider_key_expires_at = null,
    lease_owner = null, fence_token = null, lease_expires_at = null, dispatch_authorized_at = null,
    outcome_class = "LEGACY_UNKNOWN", outcome_at = null
  }) {
    if (!Number.isInteger(attempt) || attempt < 1) throw new TypeError("Execution attempt must be a positive integer.");
    const existing = await this.getByIdempotencyKey(idempotency_key);
    if (existing) {
      if (existing.action_id !== action_id || existing.attempt !== attempt
          || existing.action_revision_id !== action_revision_id || existing.envelope_hash !== envelope_hash
          || existing.provider_intent_key !== provider_intent_key || existing.fence_token !== fence_token
          || existing.lease_owner !== lease_owner) {
        throw new Error("Execution idempotency key belongs to a different attempt.");
      }
      return existing;
    }
    const execution = {
      id, action_id, status, attempt, provider, provider_reference, idempotency_key, error, started_at, completed_at,
      action_revision_id, envelope_hash, provider_intent_key, provider_key_expires_at,
      lease_owner, fence_token, lease_expires_at, dispatch_authorized_at, outcome_class, outcome_at
    };
    const columns = Object.keys(execution);
    await this.db.run("INSERT INTO action_executions (" + columns.join(", ") + ") VALUES (" + columns.map(() => "?").join(", ") + ")",
      Object.values(execution));
    return execution;
  }

  async getExecution(id) {
    return this.db.get("SELECT * FROM action_executions WHERE id = ?", [id]);
  }

  async getExecutionForOrganization(id, organizationId) {
    return this.db.get("SELECT e.* FROM action_executions e JOIN actions a ON a.id = e.action_id WHERE e.id = ? AND a.organization_id = ?",
      [id, organizationId]);
  }

  async getByIdempotencyKey(idempotencyKey) {
    return this.db.get("SELECT * FROM action_executions WHERE idempotency_key = ?", [idempotencyKey]);
  }

  async listForAction(actionId) {
    return this.db.all("SELECT * FROM action_executions WHERE action_id = ? ORDER BY attempt ASC", [actionId]);
  }

  async listForRevision(organizationId, actionId, revisionId) {
    return this.db.all("SELECT e.* FROM action_executions e JOIN actions a ON a.id = e.action_id WHERE a.organization_id = ? AND e.action_id = ? AND e.action_revision_id = ? ORDER BY e.attempt ASC",
      [organizationId, actionId, revisionId]);
  }

  async listByProviderReference(organizationId, provider, reference, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("Reference lookup limit must be between 1 and 1000.");
    return this.db.all("SELECT e.* FROM action_executions e JOIN actions a ON a.id = e.action_id WHERE a.organization_id = ? AND e.provider = ? AND e.provider_reference = ? ORDER BY e.started_at ASC, e.id ASC LIMIT ?",
      [organizationId, provider, reference, limit]);
  }

  async latestForAction(actionId) {
    return this.db.get("SELECT * FROM action_executions WHERE action_id = ? ORDER BY attempt DESC LIMIT 1", [actionId]);
  }

  async markExecutionCompleted(executionId, { providerReference = null, outcomeClass = "DELIVERED", completedAt = nowIso() } = {}) {
    await this.#requireWorkspace(executionId);
    await this.db.run(`UPDATE action_executions
      SET status = 'COMPLETED', provider_reference = COALESCE(provider_reference, ?), completed_at = COALESCE(completed_at, ?),
          outcome_class = ?, outcome_at = ?
      WHERE id = ? AND outcome_class <> 'CLOSED_UNRESOLVED'`,
      [providerReference, completedAt, outcomeClass, completedAt, executionId]);
    return this.getExecution(executionId);
  }

  async markExecutionFailed(executionId, { providerReference = null, error = null, outcomeClass = "DELIVERY_FAILED", completedAt = nowIso() } = {}) {
    await this.#requireWorkspace(executionId);
    await this.db.run(`UPDATE action_executions
      SET status = 'FAILED', provider_reference = COALESCE(provider_reference, ?), error = ?, completed_at = COALESCE(completed_at, ?),
          outcome_class = ?, outcome_at = ?
      WHERE id = ? AND status <> 'COMPLETED' AND outcome_class NOT IN ('DELIVERED','CLOSED_UNRESOLVED')`,
      [providerReference, error, completedAt, outcomeClass, completedAt, executionId]);
    return this.getExecution(executionId);
  }

  // Compatibility for explicitly synthetic single-attempt callers only. An
  // action ID cannot authorize mutation of whichever retry happened last.
  async markCompleted(actionId, providerReference) {
    const execution = await this.#unambiguousAttempt(actionId);
    return execution ? this.markExecutionCompleted(execution.id, { providerReference }) : null;
  }

  async markFailed(actionId, { providerReference = null, error = null } = {}) {
    const execution = await this.#unambiguousAttempt(actionId);
    return execution ? this.markExecutionFailed(execution.id, { providerReference, error }) : null;
  }

  async #unambiguousAttempt(actionId) {
    const executions = await this.db.all("SELECT * FROM action_executions WHERE action_id = ? ORDER BY attempt ASC LIMIT 2", [actionId]);
    if (executions.length > 1) throw new Error("An exact execution identity is required for an action with multiple attempts.");
    return executions[0] || null;
  }

  async #requireWorkspace(executionId) {
    const row = await this.db.get("SELECT a.organization_id FROM actions a JOIN action_executions e ON e.action_id = a.id WHERE e.id = ?", [executionId]);
    if (!row) throw Object.assign(new Error("Execution not found."), { statusCode: 404 });
    assertWorkspaceTransaction(this.db, row.organization_id);
  }
}
