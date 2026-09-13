// Frozen L1-06 expansion. Historical unclaimed events and workflow cursors
// cannot prove whether their effects completed; preserve them without replay.
export const id = "0007_scheduler_event_recovery";

export async function up(db) {
  const hexCheck = (column) => "length(" + column + ") = 64 AND " + (db.kind === "postgres"
    ? column + " !~ '[^0-9a-f]'" : column + " NOT GLOB '*[^0-9a-f]*'");
  await db.exec(`
    ALTER TABLE domain_events ADD COLUMN payload_hash TEXT CHECK(payload_hash IS NULL OR (${hexCheck("payload_hash")}));
    ALTER TABLE domain_events ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100 AND max_attempts = CAST(max_attempts AS INTEGER));
    ALTER TABLE domain_events ADD COLUMN first_processing_at TEXT;
    ALTER TABLE domain_events ADD COLUMN retry_deadline_at TEXT;
    ALTER TABLE domain_events ADD COLUMN next_attempt_at TEXT;
    ALTER TABLE domain_events ADD COLUMN lease_owner TEXT;
    ALTER TABLE domain_events ADD COLUMN lease_expires_at TEXT;
    ALTER TABLE domain_events ADD COLUMN processing_fence INTEGER NOT NULL DEFAULT 0 CHECK(processing_fence >= 0 AND processing_fence = CAST(processing_fence AS INTEGER));
    ALTER TABLE domain_events ADD COLUMN processing_hold_reason TEXT;
    ALTER TABLE domain_events ADD COLUMN last_error_code TEXT;
    ALTER TABLE domain_events ADD COLUMN updated_at TEXT;
    ALTER TABLE domain_events ADD COLUMN processing_version INTEGER NOT NULL DEFAULT 0 CHECK(processing_version IN (0,1))
      CHECK(processing_version = 0 OR (payload_hash IS NOT NULL AND updated_at IS NOT NULL AND attempts >= 0 AND attempts = CAST(attempts AS INTEGER)
        AND status IN ('PENDING','PROCESSING','RETRY_PENDING','PROCESSED','QUARANTINED','DISMISSED')));

    CREATE TABLE domain_event_stages (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      event_id TEXT NOT NULL REFERENCES domain_events(id),
      stage_key TEXT NOT NULL CHECK(length(trim(stage_key)) BETWEEN 1 AND 100),
      input_fingerprint TEXT NOT NULL CHECK(${hexCheck("input_fingerprint")}),
      status TEXT NOT NULL CHECK(status IN ('PREPARED','DONE','SKIPPED')),
      artifact_type TEXT,
      artifact_id TEXT,
      prepared_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(event_id,stage_key),
      CHECK((artifact_type IS NULL AND artifact_id IS NULL) OR (artifact_type IS NOT NULL AND artifact_id IS NOT NULL)),
      CHECK((status = 'PREPARED' AND completed_at IS NULL) OR (status IN ('DONE','SKIPPED') AND completed_at IS NOT NULL))
    );
    CREATE TABLE domain_event_reviews (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      event_id TEXT NOT NULL REFERENCES domain_events(id),
      expected_fence INTEGER NOT NULL CHECK(expected_fence >= 0 AND expected_fence = CAST(expected_fence AS INTEGER)),
      decision TEXT NOT NULL CHECK(decision IN ('RETRY','CLOSE')),
      evidence_note TEXT NOT NULL CHECK(length(trim(evidence_note)) > 0 AND length(evidence_note) <= 2000),
      reviewer_user_id TEXT NOT NULL CHECK(length(trim(reviewer_user_id)) > 0 AND length(reviewer_user_id) <= 256),
      created_at TEXT NOT NULL,
      UNIQUE(event_id,expected_fence)
    );
    CREATE TABLE scheduler_state (
      id TEXT PRIMARY KEY CHECK(id = 'default'),
      last_organization_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE scheduler_workspaces (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      lease_owner TEXT,
      lease_expires_at TEXT,
      visit_fence INTEGER NOT NULL DEFAULT 0 CHECK(visit_fence >= 0 AND visit_fence = CAST(visit_fence AS INTEGER)),
      next_phase INTEGER NOT NULL DEFAULT 0 CHECK(next_phase BETWEEN 0 AND 5 AND next_phase = CAST(next_phase AS INTEGER)),
      last_served_at TEXT
    );

    ALTER TABLE workflow_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0 AND revision = CAST(revision AS INTEGER));
    ALTER TABLE workflow_runs ADD COLUMN processing_version INTEGER NOT NULL DEFAULT 0 CHECK(processing_version IN (0,1));
    ALTER TABLE workflow_runs ADD COLUMN paused_at TEXT;
    ALTER TABLE workflow_runs ADD COLUMN pause_reason TEXT;
    ALTER TABLE workflow_runs ADD COLUMN step_anchor_at TEXT;
    ALTER TABLE workflow_runs ADD COLUMN scheduler_hold_reason TEXT;
    ALTER TABLE actions ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id);
    ALTER TABLE actions ADD COLUMN sequence_step_id TEXT REFERENCES sequence_steps(id);
    CREATE UNIQUE INDEX idx_actions_workflow_step ON actions(workflow_run_id,sequence_step_id);

    CREATE INDEX idx_domain_events_due ON domain_events(organization_id,processing_version,status,next_attempt_at,created_at,id);
    CREATE INDEX idx_domain_events_lease ON domain_events(organization_id,processing_version,status,lease_expires_at,id);
    CREATE INDEX idx_domain_event_stages_event ON domain_event_stages(organization_id,event_id,stage_key);
    CREATE INDEX idx_domain_event_reviews_event ON domain_event_reviews(organization_id,event_id,created_at,id);
    CREATE INDEX idx_scheduler_workspaces_lease ON scheduler_workspaces(lease_expires_at,organization_id);
    CREATE INDEX idx_scheduler_workflow_due ON workflow_runs(organization_id,processing_version,status,next_run_at,id);
    CREATE INDEX idx_scheduler_actions_due ON actions(organization_id,status,execution_hold_reason,scheduled_at,next_attempt_at,id);
    CREATE INDEX idx_scheduler_followups_due ON follow_up_tasks(organization_id,status,due_at,id);
    CREATE INDEX idx_scheduler_receipts_due ON webhook_receipts(organization_id,processing_state,next_attempt_at,received_at,id);
    CREATE INDEX idx_scheduler_receipts_lease ON webhook_receipts(organization_id,processing_state,lease_expires_at,id);
    CREATE INDEX idx_scheduler_execution_lease ON action_executions(action_id,outcome_class,lease_expires_at,id);
  `);
  await db.run("UPDATE domain_events SET processing_hold_reason='LEGACY_EVENT_REVIEW_REQUIRED' WHERE status NOT IN ('PROCESSED','DISMISSED')");
  await db.run("UPDATE workflow_runs SET scheduler_hold_reason='LEGACY_SCHEDULE_REVIEW_REQUIRED' WHERE status NOT IN ('COMPLETED','STOPPED')");
  await db.run("INSERT INTO scheduler_state (id,last_organization_id,updated_at) VALUES ('default',NULL,?)", [new Date().toISOString()]);
}
