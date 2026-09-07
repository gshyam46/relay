import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export class ExecutionsRepository {
  constructor(db) {
    this.db = db;
  }

  nextAttempt(actionId) {
    const row = this.db.get("SELECT COALESCE(MAX(attempt), 0) AS last_attempt FROM action_executions WHERE action_id = ?", [
      actionId
    ]);
    return Number(row.last_attempt) + 1;
  }

  createExecution({ action_id, status, attempt, provider, provider_reference = null, idempotency_key, error = null }) {
    const existing = this.getByIdempotencyKey(idempotency_key);
    if (existing) {
      return existing;
    }

    const execution = {
      id: createId("exec"),
      action_id,
      status,
      attempt,
      provider,
      provider_reference,
      idempotency_key,
      error,
      started_at: nowIso(),
      completed_at: status === "FAILED" || status === "COMPLETED" ? nowIso() : null
    };
    this.db.run(
      `INSERT INTO action_executions
          (id, action_id, status, attempt, provider, provider_reference, idempotency_key, error, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        execution.id,
        execution.action_id,
        execution.status,
        execution.attempt,
        execution.provider,
        execution.provider_reference,
        execution.idempotency_key,
        execution.error,
        execution.started_at,
        execution.completed_at
      ]
    );
    return execution;
  }

  getExecution(id) {
    return this.db.get("SELECT * FROM action_executions WHERE id = ?", [id]);
  }

  getByIdempotencyKey(idempotencyKey) {
    return this.db.get("SELECT * FROM action_executions WHERE idempotency_key = ?", [idempotencyKey]);
  }

  listForAction(actionId) {
    return this.db.all("SELECT * FROM action_executions WHERE action_id = ? ORDER BY attempt ASC", [actionId]);
  }

  latestForAction(actionId) {
    return this.db.get("SELECT * FROM action_executions WHERE action_id = ? ORDER BY attempt DESC LIMIT 1", [actionId]);
  }

  markCompleted(actionId, providerReference) {
    const latest = this.latestForAction(actionId);
    this.db.run(
      `UPDATE action_executions
         SET status = 'COMPLETED', provider_reference = COALESCE(provider_reference, ?), completed_at = ?
         WHERE id = (
           SELECT id FROM action_executions
           WHERE action_id = ?
           ORDER BY attempt DESC
           LIMIT 1
         )`,
      [providerReference, nowIso(), actionId]
    );
    return latest ? this.getExecution(latest.id) : null;
  }

  markFailed(actionId, { providerReference = null, error = null } = {}) {
    const latest = this.latestForAction(actionId);
    this.db.run(
      `UPDATE action_executions
         SET status = 'FAILED', provider_reference = COALESCE(provider_reference, ?), error = ?, completed_at = ?
         WHERE id = (
           SELECT id FROM action_executions
           WHERE action_id = ?
           ORDER BY attempt DESC
           LIMIT 1
         )`,
      [providerReference, error, nowIso(), actionId]
    );
    return latest ? this.getExecution(latest.id) : null;
  }
}
