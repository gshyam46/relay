// Frozen L2-03 additive source association; historical import outcomes stay unchanged.
export const id = "0011_import_identity_resolution";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  await db.exec(`
    CREATE TABLE import_identity_resolutions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
      organization_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      import_row_id TEXT NOT NULL,
      review_revision INTEGER NOT NULL CHECK(review_revision BETWEEN 1 AND 101 AND review_revision=CAST(review_revision AS INTEGER)),
      review_token TEXT NOT NULL CHECK(length(review_token)=64),
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
      decision TEXT NOT NULL CHECK(decision IN ('LINK_EXISTING','CREATE_SEPARATE')),
      classification TEXT NOT NULL CHECK(classification IN ('SAME_ENQUIRY','REPEATED_ENQUIRY','SHARED_CONTACT','DISTINCT_ENQUIRY')),
      target_lead_id TEXT,
      lead_id TEXT NOT NULL,
      event_id TEXT,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      review_snapshot_json TEXT NOT NULL CHECK(${bytes("review_snapshot_json")} BETWEEN 2 AND 524288),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(organization_id,import_row_id),
      UNIQUE(organization_id,event_id),
      FOREIGN KEY(organization_id,import_id) REFERENCES import_batches(organization_id,id),
      FOREIGN KEY(organization_id,import_id,import_row_id) REFERENCES import_rows(organization_id,import_id,id),
      FOREIGN KEY(organization_id,target_lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,event_id) REFERENCES domain_events(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
      CHECK((decision='LINK_EXISTING' AND classification='SAME_ENQUIRY' AND target_lead_id IS NOT NULL AND target_lead_id=lead_id AND event_id IS NULL)
        OR (decision='CREATE_SEPARATE' AND classification IN ('REPEATED_ENQUIRY','SHARED_CONTACT','DISTINCT_ENQUIRY') AND target_lead_id IS NULL AND event_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX idx_identity_resolution_created_lead ON import_identity_resolutions(organization_id,lead_id) WHERE decision='CREATE_SEPARATE';
    CREATE INDEX idx_identity_resolution_import ON import_identity_resolutions(organization_id,import_id,created_at,id);
    CREATE INDEX idx_identity_resolution_sources ON import_identity_resolutions(organization_id,lead_id,created_at,id);
  `);
}
