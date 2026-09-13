// Frozen L2-04 additive correction and archive authority. No historical state is guessed.
export const id = "0012_lead_data_management";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  const hex = column => "length(" + column + ")=64 AND " + (db.kind === "postgres" ? column + " !~ '[^0-9a-f]'" : column + " NOT GLOB '*[^0-9a-f]*'");
  await db.exec(`
    ALTER TABLE leads ADD COLUMN data_revision INTEGER NOT NULL DEFAULT 0 CHECK(data_revision BETWEEN 0 AND 2147483647 AND data_revision=CAST(data_revision AS INTEGER));
    ALTER TABLE leads ADD COLUMN archived_at TEXT;
    CREATE INDEX idx_leads_workspace_archive_directory ON leads(organization_id,archived_at,created_at,id);
    CREATE TABLE lead_data_changes (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
      organization_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      expected_revision INTEGER NOT NULL CHECK(expected_revision BETWEEN 0 AND 2147483646 AND expected_revision=CAST(expected_revision AS INTEGER)),
      revision INTEGER NOT NULL CHECK(revision=expected_revision+1),
      kind TEXT NOT NULL CHECK(kind IN ('CORRECT','ARCHIVE','RESTORE')),
      before_json TEXT NOT NULL CHECK(${bytes("before_json")} BETWEEN 2 AND 524288),
      after_json TEXT NOT NULL CHECK(${bytes("after_json")} BETWEEN 2 AND 524288),
      review_token TEXT CHECK(review_token IS NULL OR (${hex("review_token")})),
      request_hash TEXT NOT NULL CHECK(${hex("request_hash")}),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      effects_json TEXT NOT NULL CHECK(${bytes("effects_json")} BETWEEN 2 AND 1048576),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(organization_id,lead_id,expected_revision),
      UNIQUE(organization_id,lead_id,revision),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
      CHECK((kind='CORRECT' AND review_token IS NOT NULL) OR (kind IN ('ARCHIVE','RESTORE') AND review_token IS NULL))
    );
  `);
}
