// Migration 0001 — baseline schema.
//
// This is the schema that existed as one inline `db.exec()` block in
// `src/database/database.js` before the database layer was split into a
// dialect-aware client + versioned migrations. Every statement is written to be
// idempotent (`IF NOT EXISTS`, plus `ensureColumn`) so that databases created by
// the pre-migration code can adopt the migration runner without being rebuilt:
// applying 0001 to an already-populated dev database is a no-op that simply
// records the version row.
//
// The DDL is deliberately dialect-neutral. SQLite and PostgreSQL both accept
// TEXT/INTEGER/REAL, `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT
// EXISTS`, inline REFERENCES, and `ON CONFLICT (...) DO UPDATE`. The only
// genuinely dialect-specific operation — "does this column already exist?" — is
// hidden behind the client's `columnExists()` method.

export const id = "0001_baseline_schema";

export async function up(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      normalized_email TEXT,
      normalized_phone TEXT,
      company TEXT,
      source TEXT NOT NULL,
      import_batch_id TEXT,
      import_row_id TEXT,
      source_metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      filename TEXT NOT NULL,
      adapter_type TEXT NOT NULL,
      source_metadata_json TEXT NOT NULL,
      state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      summary_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      committed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS import_rows (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL REFERENCES import_batches(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      row_number INTEGER NOT NULL,
      raw_row_json TEXT NOT NULL,
      mapped_values_json TEXT NOT NULL,
      normalized_values_json TEXT NOT NULL,
      validation_state TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      committed INTEGER NOT NULL DEFAULT 0,
      created_lead_id TEXT REFERENCES leads(id),
      duplicate_candidates_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(import_id, row_number)
    );

    CREATE TABLE IF NOT EXISTS import_issues (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL REFERENCES import_batches(id),
      import_row_id TEXT REFERENCES import_rows(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      issue_type TEXT NOT NULL,
      field TEXT,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_snapshots (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'READY',
      pipeline_version TEXT NOT NULL DEFAULT 'm2.0-deterministic-v1',
      input_fingerprint TEXT,
      readiness_status TEXT NOT NULL DEFAULT 'NEEDS_MORE_DATA',
      readiness_score INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      score INTEGER NOT NULL,
      next_best_action TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_evidence (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      source_type TEXT NOT NULL,
      source_reference TEXT,
      source_url TEXT,
      title TEXT,
      raw_content_reference TEXT,
      claim_field TEXT,
      claim_value TEXT,
      evidence_timestamp TEXT,
      retrieved_at TEXT,
      confidence TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_claims (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      field TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_signals (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence TEXT NOT NULL,
      explanation TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_qualifications (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      status TEXT NOT NULL,
      readiness_score INTEGER NOT NULL,
      reasons_json TEXT NOT NULL,
      signal_ids_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_recommendations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      action_type TEXT NOT NULL,
      outbound_action_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research_evidence_ingestions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      adapter_type TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS research_evidence_items (
      id TEXT PRIMARY KEY,
      ingestion_id TEXT NOT NULL REFERENCES research_evidence_ingestions(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      source_type TEXT NOT NULL,
      source_reference TEXT,
      source_url TEXT,
      title TEXT NOT NULL,
      raw_content_reference TEXT,
      claim_field TEXT NOT NULL,
      claim_value TEXT NOT NULL,
      evidence_timestamp TEXT,
      retrieved_at TEXT,
      confidence TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_synthesis_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      qualification_json TEXT NOT NULL,
      recommendation_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(organization_id, lead_id, input_fingerprint, pipeline_version)
    );

    CREATE TABLE IF NOT EXISTS intelligence_recommendation_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      synthesis_id TEXT NOT NULL REFERENCES intelligence_synthesis_runs(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      priority_json TEXT NOT NULL,
      segment_json TEXT NOT NULL,
      personalization_json TEXT NOT NULL,
      recommendation_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(organization_id, lead_id, input_fingerprint, pipeline_version)
    );

    CREATE TABLE IF NOT EXISTS next_best_action_plans (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      intelligence_recommendation_id TEXT NOT NULL REFERENCES intelligence_recommendation_runs(id),
      synthesis_id TEXT NOT NULL REFERENCES intelligence_synthesis_runs(id),
      snapshot_id TEXT NOT NULL REFERENCES intelligence_snapshots(id),
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      policy_decision_json TEXT NOT NULL,
      approval_json TEXT NOT NULL,
      decision_evidence_refs_json TEXT NOT NULL,
      execution_contract_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(organization_id, lead_id, input_fingerprint, pipeline_version)
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      scheduled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_executions (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL REFERENCES actions(id),
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      idempotency_key TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS action_approvals (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      action_id TEXT NOT NULL REFERENCES actions(id),
      status TEXT NOT NULL,
      requested_reason TEXT NOT NULL,
      reviewer_name TEXT,
      reviewer_note TEXT,
      edited_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      UNIQUE(action_id)
    );

    CREATE TABLE IF NOT EXISTS callbacks (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL REFERENCES actions(id),
      provider_event_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      action_id TEXT REFERENCES actions(id),
      inbound_event_id TEXT,
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      summary TEXT,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      provider_event_id TEXT,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS inbound_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      sentiment TEXT,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, provider, provider_event_id)
    );

    CREATE TABLE IF NOT EXISTS follow_up_tasks (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      action_id TEXT REFERENCES actions(id),
      inbound_event_id TEXT REFERENCES inbound_events(id),
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(organization_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      objective TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      stop_on_reply INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sequence_steps (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      sequence_id TEXT NOT NULL REFERENCES sequences(id),
      step_order INTEGER NOT NULL,
      type TEXT NOT NULL,
      channel TEXT,
      title TEXT NOT NULL,
      body TEXT,
      delay_hours REAL NOT NULL DEFAULT 0,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      stop_on_reply INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(sequence_id, step_order)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      sequence_id TEXT NOT NULL REFERENCES sequences(id),
      lead_id TEXT NOT NULL REFERENCES leads(id),
      status TEXT NOT NULL,
      current_step_order INTEGER NOT NULL,
      next_run_at TEXT,
      last_action_id TEXT REFERENCES actions(id),
      stop_reason TEXT,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(organization_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS organization_settings (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, category, key)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      lead_id TEXT,
      action_id TEXT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await ensureColumn(db, "leads", "normalized_email", "TEXT");
  await ensureColumn(db, "leads", "normalized_phone", "TEXT");
  await ensureColumn(db, "leads", "import_batch_id", "TEXT");
  await ensureColumn(db, "leads", "import_row_id", "TEXT");
  await ensureColumn(db, "leads", "source_metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn(db, "actions", "next_best_action_plan_id", "TEXT");
  await ensureColumn(db, "actions", "approval_requirement", "TEXT NOT NULL DEFAULT 'NOT_REQUIRED'");
  await ensureColumn(db, "actions", "execution_mode", "TEXT NOT NULL DEFAULT 'SANDBOX'");
  await ensureColumn(db, "actions", "provider", "TEXT NOT NULL DEFAULT 'mock-n8n'");
  await ensureColumn(db, "actions", "last_error", "TEXT");
  await ensureColumn(db, "callbacks", "organization_id", "TEXT");
  await ensureColumn(db, "callbacks", "lead_id", "TEXT");
  await ensureColumn(db, "callbacks", "action_execution_id", "TEXT");
  await ensureColumn(db, "callbacks", "status", "TEXT NOT NULL DEFAULT 'RECEIVED'");
  await ensureColumn(db, "callbacks", "provider_reference", "TEXT");
  await ensureColumn(db, "intelligence_snapshots", "version", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "intelligence_snapshots", "status", "TEXT NOT NULL DEFAULT 'READY'");
  await ensureColumn(db, "intelligence_snapshots", "pipeline_version", "TEXT NOT NULL DEFAULT 'm2.0-deterministic-v1'");
  await ensureColumn(db, "intelligence_snapshots", "input_fingerprint", "TEXT");
  await ensureColumn(db, "intelligence_snapshots", "readiness_status", "TEXT NOT NULL DEFAULT 'NEEDS_MORE_DATA'");
  await ensureColumn(db, "intelligence_snapshots", "readiness_score", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "inbound_events", "confidence", "TEXT");
  await ensureColumn(db, "inbound_events", "reason", "TEXT");
  await ensureColumn(db, "inbound_events", "suggested_next_step", "TEXT");
  await ensureColumn(db, "channel_messages", "classification_event_type", "TEXT");
  await ensureColumn(db, "channel_messages", "classification_confidence", "TEXT");
  await ensureColumn(db, "channel_messages", "suggested_next_step", "TEXT");
  await ensureColumn(db, "follow_up_tasks", "escalated", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "users", "password_hash", "TEXT");
  await ensureColumn(db, "users", "role", "TEXT NOT NULL DEFAULT 'OWNER'");

  await db.run("UPDATE leads SET normalized_email = lower(trim(email)) WHERE normalized_email IS NULL AND email IS NOT NULL");
  await db.run("UPDATE leads SET normalized_phone = phone WHERE normalized_phone IS NULL AND phone IS NOT NULL");
  await db.run("UPDATE leads SET source_metadata_json = '{}' WHERE source_metadata_json IS NULL");

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_snapshot_idempotency
      ON intelligence_snapshots(organization_id, lead_id, input_fingerprint, pipeline_version);
    CREATE INDEX IF NOT EXISTS idx_research_evidence_items_lead
      ON research_evidence_items(organization_id, lead_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_intelligence_synthesis_runs_lead
      ON intelligence_synthesis_runs(organization_id, lead_id, version);
    CREATE INDEX IF NOT EXISTS idx_intelligence_recommendation_runs_lead
      ON intelligence_recommendation_runs(organization_id, lead_id, version);
    CREATE INDEX IF NOT EXISTS idx_next_best_action_plans_lead
      ON next_best_action_plans(organization_id, lead_id, version);
    CREATE INDEX IF NOT EXISTS idx_actions_lead_status
      ON actions(organization_id, lead_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_next_best_action_plan
      ON actions(organization_id, next_best_action_plan_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_action_executions_idempotency
      ON action_executions(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_action_approvals_queue
      ON action_approvals(organization_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_callbacks_action
      ON callbacks(action_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_lead
      ON channel_messages(organization_id, lead_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_action
      ON channel_messages(organization_id, action_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_inbound_events_lead
      ON inbound_events(organization_id, lead_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_queue
      ON follow_up_tasks(organization_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_campaigns_org
      ON campaigns(organization_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sequences_org
      ON sequences(organization_id, campaign_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence
      ON sequence_steps(organization_id, sequence_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_due
      ON workflow_runs(organization_id, status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_lead
      ON workflow_runs(organization_id, lead_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
}

async function ensureColumn(db, tableName, columnName, definition) {
  if (await db.columnExists(tableName, columnName)) {
    return;
  }
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
