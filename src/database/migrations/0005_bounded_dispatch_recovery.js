// Frozen L1-05 expansion. Historical outcomes and ownership are unknown; this
// migration never invents send authority or turns an old attempt into a retry.
export const id = "0005_bounded_dispatch_recovery";

export async function up(db) {
  const invalidType = db.kind === "sqlite" ? " OR typeof(attempt) <> 'integer'" : "";
  const invalid = await db.get("SELECT 1 AS invalid FROM action_executions WHERE attempt < 1" + invalidType + " LIMIT 1");
  const duplicate = await db.get("SELECT 1 AS invalid FROM action_executions GROUP BY action_id, attempt HAVING COUNT(*) > 1 LIMIT 1");
  if (invalid || duplicate) {
    throw Object.assign(new Error("Historical execution numbering requires reviewed offline remediation before this upgrade."), {
      code: "MIGRATION_EXECUTION_REVIEW_REQUIRED"
    });
  }

  await db.exec(`
    ALTER TABLE actions ADD COLUMN next_attempt_at TEXT;
    ALTER TABLE actions ADD COLUMN first_dispatch_at TEXT;
    ALTER TABLE actions ADD COLUMN retry_deadline_at TEXT;
    ALTER TABLE actions ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 100 AND max_attempts = CAST(max_attempts AS INTEGER));
    ALTER TABLE actions ADD COLUMN execution_fence INTEGER NOT NULL DEFAULT 0 CHECK(execution_fence >= 0 AND execution_fence = CAST(execution_fence AS INTEGER));
    ALTER TABLE actions ADD COLUMN active_execution_id TEXT REFERENCES action_executions(id);
    ALTER TABLE actions ADD COLUMN execution_hold_reason TEXT CHECK(execution_hold_reason IS NULL OR length(execution_hold_reason) BETWEEN 1 AND 256);

    ALTER TABLE action_executions ADD COLUMN action_revision_id TEXT REFERENCES action_revisions(id);
    ALTER TABLE action_executions ADD COLUMN envelope_hash TEXT;
    ALTER TABLE action_executions ADD COLUMN provider_intent_key TEXT;
    ALTER TABLE action_executions ADD COLUMN provider_key_expires_at TEXT;
    ALTER TABLE action_executions ADD COLUMN lease_owner TEXT;
    ALTER TABLE action_executions ADD COLUMN fence_token INTEGER CHECK(fence_token IS NULL OR (fence_token > 0 AND fence_token = CAST(fence_token AS INTEGER)));
    ALTER TABLE action_executions ADD COLUMN lease_expires_at TEXT;
    ALTER TABLE action_executions ADD COLUMN dispatch_authorized_at TEXT;
    ALTER TABLE action_executions ADD COLUMN outcome_class TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN' CHECK(outcome_class IN ('DISPATCHING','ACCEPTED','RETRYABLE_FAILURE','PERMANENT_FAILURE','UNCERTAIN','LEGACY_UNKNOWN','DELIVERED','DELIVERY_FAILED','CLOSED_UNRESOLVED')) CHECK(attempt > 0 AND attempt = CAST(attempt AS INTEGER));
    ALTER TABLE action_executions ADD COLUMN outcome_at TEXT;

    CREATE TABLE dispatch_resolutions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      action_id TEXT NOT NULL REFERENCES actions(id),
      action_execution_id TEXT NOT NULL UNIQUE REFERENCES action_executions(id),
      fence_token INTEGER CHECK(fence_token IS NULL OR (fence_token > 0 AND fence_token = CAST(fence_token AS INTEGER))),
      decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','CLOSE_WITHOUT_RETRY')),
      evidence_note TEXT NOT NULL CHECK(length(trim(evidence_note)) > 0 AND length(evidence_note) <= 2000),
      provider_reference TEXT CHECK(provider_reference IS NULL OR (length(trim(provider_reference)) > 0 AND length(provider_reference) <= 512)),
      reviewer_user_id TEXT NOT NULL CHECK(length(trim(reviewer_user_id)) > 0 AND length(reviewer_user_id) <= 256),
      created_at TEXT NOT NULL,
      CHECK(decision <> 'ACCEPTED' OR provider_reference IS NOT NULL)
    );

    CREATE UNIQUE INDEX idx_action_executions_attempt ON action_executions(action_id, attempt);
    CREATE UNIQUE INDEX idx_action_executions_fence ON action_executions(action_id, fence_token) WHERE fence_token IS NOT NULL;
    CREATE INDEX idx_actions_retry_queue ON actions(organization_id, status, next_attempt_at, created_at);
    CREATE INDEX idx_actions_global_retry_queue ON actions(status, next_attempt_at, created_at);
    CREATE INDEX idx_action_executions_lease ON action_executions(lease_expires_at, action_id) WHERE outcome_class = 'DISPATCHING';
    CREATE INDEX idx_action_executions_provider_reference ON action_executions(provider, provider_reference, action_id);
    CREATE INDEX idx_dispatch_resolutions_action ON dispatch_resolutions(organization_id, action_id, created_at);
  `);

  // Review can reactivate an AWAITING_APPROVAL action, so it must inherit the
  // same durable hold as an already executable action with ambiguous history.
  // Preserve coarse status, errors, provider references and all old timestamps.
  await db.run(`UPDATE actions SET execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED'
    WHERE status IN ('EXECUTING','RETRYING')
       OR (status IN ('PLANNED','APPROVED','AWAITING_APPROVAL') AND EXISTS (
         SELECT 1 FROM action_executions WHERE action_executions.action_id = actions.id
       ))`);
}
