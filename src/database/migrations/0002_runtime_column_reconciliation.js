// Frozen forward repair for the extension columns required by the current
// repositories. Do not import/replay or modify 0001: its recorded version can
// exist on a populated schema without these extensions. This supports the
// explicitly tested prior shape, not arbitrary corrupt/missing base tables.
export const id = "0002_runtime_column_reconciliation";

const COLUMNS = [
  ["leads", "normalized_email", "TEXT"],
  ["leads", "normalized_phone", "TEXT"],
  ["leads", "import_batch_id", "TEXT"],
  ["leads", "import_row_id", "TEXT"],
  ["leads", "source_metadata_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["actions", "next_best_action_plan_id", "TEXT"],
  ["actions", "approval_requirement", "TEXT NOT NULL DEFAULT 'REQUIRED'"],
  ["actions", "execution_mode", "TEXT NOT NULL DEFAULT 'SANDBOX'"],
  ["actions", "provider", "TEXT NOT NULL DEFAULT 'mock-n8n'"],
  ["actions", "last_error", "TEXT"],
  ["callbacks", "organization_id", "TEXT"],
  ["callbacks", "lead_id", "TEXT"],
  ["callbacks", "action_execution_id", "TEXT"],
  ["callbacks", "status", "TEXT NOT NULL DEFAULT 'RECEIVED'"],
  ["callbacks", "provider_reference", "TEXT"],
  ["intelligence_snapshots", "version", "INTEGER NOT NULL DEFAULT 1"],
  ["intelligence_snapshots", "status", "TEXT NOT NULL DEFAULT 'READY'"],
  ["intelligence_snapshots", "pipeline_version", "TEXT NOT NULL DEFAULT 'm2.0-deterministic-v1'"],
  ["intelligence_snapshots", "input_fingerprint", "TEXT"],
  ["intelligence_snapshots", "readiness_status", "TEXT NOT NULL DEFAULT 'NEEDS_MORE_DATA'"],
  ["intelligence_snapshots", "readiness_score", "INTEGER NOT NULL DEFAULT 0"],
  ["inbound_events", "confidence", "TEXT"],
  ["inbound_events", "reason", "TEXT"],
  ["inbound_events", "suggested_next_step", "TEXT"],
  ["channel_messages", "classification_event_type", "TEXT"],
  ["channel_messages", "classification_confidence", "TEXT"],
  ["channel_messages", "suggested_next_step", "TEXT"],
  ["follow_up_tasks", "escalated", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "password_hash", "TEXT"],
  ["users", "role", "TEXT NOT NULL DEFAULT 'UNASSIGNED'"]
];

export async function up(db) {
  let missingAuthorization = false;
  for (const [table, column, definition] of COLUMNS) {
    if (await db.columnExists(table, column)) continue;
    if (table === "actions" && ["approval_requirement", "execution_mode", "provider"].includes(column)) {
      missingAuthorization = true;
    }
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // Never treat absent historical authorization/sender metadata as permission.
  // Do not restart EXECUTING or rewrite completed/failed history. An in-flight
  // legacy attempt needs explicit reconciliation before operator recovery.
  if (missingAuthorization) {
    await db.run(
      "UPDATE actions SET status = 'BLOCKED', last_error = ? WHERE status IN ('PLANNED', 'AWAITING_APPROVAL', 'APPROVED', 'RETRYING')",
      ["Legacy action authorization metadata was missing; review recipient, sender, content and approval before creating a new intent."]
    );
  }

  // Backfill only an exact normalized email and missing structural metadata.
  // No consent, phone-country assumption, password or ownership is invented.
  await db.run("UPDATE leads SET normalized_email = lower(trim(email)) WHERE normalized_email IS NULL AND email IS NOT NULL");
  await db.run("UPDATE leads SET source_metadata_json = '{}' WHERE source_metadata_json IS NULL");

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_snapshot_idempotency
      ON intelligence_snapshots(organization_id, lead_id, input_fingerprint, pipeline_version);
    CREATE INDEX IF NOT EXISTS idx_actions_next_best_action_plan
      ON actions(organization_id, next_best_action_plan_id);
    CREATE INDEX IF NOT EXISTS idx_callbacks_action
      ON callbacks(action_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_lead
      ON channel_messages(organization_id, lead_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_inbound_events_lead
      ON inbound_events(organization_id, lead_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_queue
      ON follow_up_tasks(organization_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
}
