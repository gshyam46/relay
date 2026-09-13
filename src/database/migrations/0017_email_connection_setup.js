// L4-01A adds reviewed setup history and unique signed-webhook routing aliases.
export const id = "0017_email_connection_setup";
export async function up(db) {
  const bytes=column=>db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))";
  await db.exec(`
    CREATE TABLE email_connection_revisions (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      revision INTEGER NOT NULL CHECK(revision=CAST(revision AS INTEGER) AND revision BETWEEN 1 AND 100),
      expected_revision INTEGER NOT NULL CHECK(expected_revision=CAST(expected_revision AS INTEGER) AND expected_revision=revision-1),
      operation TEXT NOT NULL CHECK(operation IN('SAVE','PROVISION_ROUTE','ROTATE_ROUTE')),
      config_fingerprint TEXT NOT NULL CHECK(length(config_fingerprint)=64),
      before_json TEXT NOT NULL CHECK(${bytes("before_json")} BETWEEN 2 AND 16384),
      after_json TEXT NOT NULL CHECK(${bytes("after_json")} BETWEEN 2 AND 16384),
      request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
      reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(organization_id,revision), UNIQUE(organization_id,request_key), UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE email_webhook_routes (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      token TEXT NOT NULL UNIQUE CHECK(length(token) BETWEEN 1 AND 200),
      route_kind TEXT NOT NULL DEFAULT 'GENERATED' CHECK(route_kind IN('GENERATED','LEGACY') AND (route_kind='LEGACY' OR length(token)>=32)),
      created_revision INTEGER NOT NULL CHECK(created_revision=CAST(created_revision AS INTEGER) AND created_revision BETWEEN 1 AND 100),
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(organization_id,created_revision,route_kind),
      FOREIGN KEY(organization_id,created_revision) REFERENCES email_connection_revisions(organization_id,revision),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE INDEX idx_email_connection_history ON email_connection_revisions(organization_id,revision);
    CREATE INDEX idx_email_route_history ON email_webhook_routes(organization_id,created_revision,id);
  `);
}
