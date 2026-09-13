export const id = "0004_prepared_action_revisions";

// Additive review history. Existing approvals are not retroactively assigned a
// reviewed envelope; dispatch must hold them until an explicit new review.
export async function up(db) {
  await db.exec(`
    CREATE TABLE action_revisions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      action_id TEXT NOT NULL REFERENCES actions(id),
      revision INTEGER NOT NULL,
      envelope_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      sender_config_fingerprint TEXT NOT NULL,
      context_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, action_id, revision)
    );
    CREATE TABLE action_revision_decisions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      action_id TEXT NOT NULL REFERENCES actions(id),
      action_revision_id TEXT NOT NULL UNIQUE REFERENCES action_revisions(id),
      decision TEXT NOT NULL CHECK(decision IN ('APPROVED', 'REJECTED')),
      reviewed_hash TEXT NOT NULL,
      reviewer_user_id TEXT NOT NULL,
      reviewer_name TEXT,
      reviewer_note TEXT,
      decided_at TEXT NOT NULL
    );
    CREATE INDEX idx_action_revisions_action ON action_revisions(organization_id, action_id, revision);
    CREATE INDEX idx_action_revision_decisions_action ON action_revision_decisions(organization_id, action_id);
    ALTER TABLE actions ADD COLUMN current_revision_id TEXT REFERENCES action_revisions(id);
    ALTER TABLE action_approvals ADD COLUMN action_revision_id TEXT REFERENCES action_revisions(id);
    ALTER TABLE action_approvals ADD COLUMN reviewed_hash TEXT;
    ALTER TABLE action_approvals ADD COLUMN reviewer_user_id TEXT;
  `);
}
