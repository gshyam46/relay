// Frozen L2-01 expansion: immutable context snapshots, with no legacy backfill.
export const id = "0009_business_context";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  await db.exec(`
    CREATE UNIQUE INDEX idx_users_workspace_identity ON users(organization_id,id);
    CREATE UNIQUE INDEX idx_leads_workspace_identity ON leads(organization_id,id);
    CREATE TABLE business_profile_revisions (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647 AND revision=CAST(revision AS INTEGER)),
      schema_version INTEGER NOT NULL CHECK(schema_version=1),
      profile_json TEXT NOT NULL CHECK(${bytes("profile_json")} BETWEEN 2 AND 32768),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      PRIMARY KEY(organization_id,revision),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE lead_enquiry_revisions (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      lead_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647 AND revision=CAST(revision AS INTEGER)),
      schema_version INTEGER NOT NULL CHECK(schema_version=1),
      enquiry_json TEXT NOT NULL CHECK(${bytes("enquiry_json")} BETWEEN 2 AND 32768),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      PRIMARY KEY(organization_id,lead_id,revision),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
  `);
}
