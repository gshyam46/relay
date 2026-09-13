// L3-04: immutable reviewed outputs, revisioned judgments, and protected replay.
export const id = "0016_intelligence_feedback_evaluation";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  await db.exec(`
    CREATE UNIQUE INDEX idx_feedback_snapshot_identity ON intelligence_snapshots(organization_id,lead_id,id);
    CREATE UNIQUE INDEX idx_feedback_synthesis_identity ON intelligence_synthesis_runs(organization_id,lead_id,id);
    CREATE UNIQUE INDEX idx_feedback_recommendation_identity ON intelligence_recommendation_runs(organization_id,lead_id,id);
    CREATE UNIQUE INDEX idx_feedback_plan_identity ON next_best_action_plans(organization_id,lead_id,id);
    CREATE UNIQUE INDEX idx_feedback_message_identity ON channel_messages(organization_id,lead_id,id);
    CREATE TABLE intelligence_feedback_targets (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), lead_id TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK(target_kind IN('SNAPSHOT','SYNTHESIS','RECOMMENDATION','PLAN','REPLY')),
      target_id TEXT NOT NULL, snapshot_id TEXT, synthesis_id TEXT, recommendation_id TEXT, plan_id TEXT, message_id TEXT,
      source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
      snapshot_json TEXT NOT NULL CHECK(${bytes("snapshot_json")} BETWEEN 2 AND 1048576),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(organization_id,id), UNIQUE(organization_id,lead_id,id), UNIQUE(organization_id,target_kind,target_id),
      CHECK(
        (target_kind='SNAPSHOT' AND snapshot_id IS NOT NULL AND snapshot_id=target_id AND synthesis_id IS NULL AND recommendation_id IS NULL AND plan_id IS NULL AND message_id IS NULL) OR
        (target_kind='SYNTHESIS' AND synthesis_id IS NOT NULL AND synthesis_id=target_id AND snapshot_id IS NULL AND recommendation_id IS NULL AND plan_id IS NULL AND message_id IS NULL) OR
        (target_kind='RECOMMENDATION' AND recommendation_id IS NOT NULL AND recommendation_id=target_id AND snapshot_id IS NULL AND synthesis_id IS NULL AND plan_id IS NULL AND message_id IS NULL) OR
        (target_kind='PLAN' AND plan_id IS NOT NULL AND plan_id=target_id AND snapshot_id IS NULL AND synthesis_id IS NULL AND recommendation_id IS NULL AND message_id IS NULL) OR
        (target_kind='REPLY' AND message_id IS NOT NULL AND message_id=target_id AND snapshot_id IS NULL AND synthesis_id IS NULL AND recommendation_id IS NULL AND plan_id IS NULL)),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
      FOREIGN KEY(organization_id,lead_id,snapshot_id) REFERENCES intelligence_snapshots(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,lead_id,synthesis_id) REFERENCES intelligence_synthesis_runs(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,lead_id,recommendation_id) REFERENCES intelligence_recommendation_runs(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,lead_id,plan_id) REFERENCES next_best_action_plans(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,lead_id,message_id) REFERENCES channel_messages(organization_id,lead_id,id)
    );
    CREATE TABLE intelligence_feedback_revisions (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), lead_id TEXT NOT NULL, feedback_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision=CAST(revision AS INTEGER) AND revision BETWEEN 1 AND 100), expected_revision INTEGER NOT NULL CHECK(expected_revision=CAST(expected_revision AS INTEGER) AND expected_revision=revision-1),
      status TEXT NOT NULL CHECK(status IN('RECORDED','WITHDRAWN')),
      labels_json TEXT CHECK(labels_json IS NULL OR ${bytes("labels_json")} BETWEEN 2 AND 4096),
      reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
      request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      CHECK((status='WITHDRAWN' AND labels_json IS NULL) OR (status='RECORDED' AND labels_json IS NOT NULL)),
      UNIQUE(organization_id,feedback_id,revision), UNIQUE(organization_id,request_key),
      FOREIGN KEY(organization_id,lead_id,feedback_id) REFERENCES intelligence_feedback_targets(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE INDEX idx_feedback_history ON intelligence_feedback_revisions(organization_id,feedback_id,revision);
    CREATE TABLE intelligence_evaluation_datasets (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), version INTEGER NOT NULL CHECK(version=CAST(version AS INTEGER) AND version BETWEEN 1 AND 2147483647),
      split TEXT NOT NULL CHECK(split IN('DEV','HOLDOUT')),
      request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
      manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64), manifest_json TEXT NOT NULL CHECK(${bytes("manifest_json")} BETWEEN 2 AND 131072),
      case_count INTEGER NOT NULL CHECK(case_count=CAST(case_count AS INTEGER) AND case_count BETWEEN 1 AND 100), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(organization_id,id), UNIQUE(organization_id,name,version), UNIQUE(organization_id,request_key),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE intelligence_evaluation_members (
      organization_id TEXT NOT NULL REFERENCES organizations(id), dataset_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position=CAST(position AS INTEGER) AND position BETWEEN 0 AND 99),
      feedback_id TEXT NOT NULL, feedback_revision INTEGER NOT NULL CHECK(feedback_revision=CAST(feedback_revision AS INTEGER) AND feedback_revision BETWEEN 1 AND 100), lead_id TEXT NOT NULL,
      reply_text_sha256 TEXT NOT NULL CHECK(length(reply_text_sha256)=64), case_sha256 TEXT NOT NULL CHECK(length(case_sha256)=64),
      PRIMARY KEY(dataset_id,position), UNIQUE(dataset_id,feedback_id), UNIQUE(dataset_id,reply_text_sha256),
      FOREIGN KEY(organization_id,dataset_id) REFERENCES intelligence_evaluation_datasets(organization_id,id),
      FOREIGN KEY(organization_id,feedback_id,feedback_revision) REFERENCES intelligence_feedback_revisions(organization_id,feedback_id,revision),
      FOREIGN KEY(organization_id,lead_id,feedback_id) REFERENCES intelligence_feedback_targets(organization_id,lead_id,id),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id)
    );
    CREATE TABLE intelligence_evaluations (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), dataset_id TEXT NOT NULL,
      candidate_source_sha256 TEXT NOT NULL CHECK(length(candidate_source_sha256)=64),
      candidate_versions_json TEXT NOT NULL CHECK(${bytes("candidate_versions_json")} BETWEEN 2 AND 32768),
      manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64), metrics_json TEXT NOT NULL CHECK(${bytes("metrics_json")} BETWEEN 2 AND 262144),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(organization_id,id), UNIQUE(dataset_id,candidate_source_sha256),
      FOREIGN KEY(organization_id,dataset_id) REFERENCES intelligence_evaluation_datasets(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE intelligence_evaluation_groups (
      organization_id TEXT NOT NULL REFERENCES organizations(id), group_kind TEXT NOT NULL CHECK(group_kind IN('LEAD','REPLY_TEXT')),
      group_key TEXT NOT NULL CHECK(length(group_key) BETWEEN 1 AND 256), split TEXT NOT NULL CHECK(split IN('DEV','HOLDOUT')),
      first_dataset_id TEXT NOT NULL, consumed_evaluation_id TEXT,
      PRIMARY KEY(organization_id,group_kind,group_key),
      FOREIGN KEY(organization_id,first_dataset_id) REFERENCES intelligence_evaluation_datasets(organization_id,id),
      FOREIGN KEY(organization_id,consumed_evaluation_id) REFERENCES intelligence_evaluations(organization_id,id)
    );
    CREATE INDEX idx_evaluation_datasets_history ON intelligence_evaluation_datasets(organization_id,created_at,id);
    CREATE INDEX idx_evaluations_history ON intelligence_evaluations(organization_id,dataset_id,created_at,id);
    CREATE INDEX idx_evaluation_member_feedback ON intelligence_evaluation_members(organization_id,feedback_id,feedback_revision);
    CREATE INDEX idx_evaluation_group_dataset ON intelligence_evaluation_groups(organization_id,first_dataset_id);
  `);
}
