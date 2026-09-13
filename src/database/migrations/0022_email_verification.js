export const id = "0022_email_verification";
export async function up(db) {
 const bytes=column=>db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))";
 await db.exec(`
 CREATE TABLE email_verification_runs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  connection_revision INTEGER NOT NULL CHECK(connection_revision=CAST(connection_revision AS INTEGER) AND connection_revision BETWEEN 1 AND 100),
  config_fingerprint TEXT NOT NULL CHECK(length(config_fingerprint)=64), runtime_fingerprint TEXT NOT NULL CHECK(length(runtime_fingerprint)=64),
  delivery_recipient TEXT NOT NULL CHECK(length(delivery_recipient) BETWEEN 3 AND 320), failure_recipient TEXT NOT NULL CHECK(length(failure_recipient) BETWEEN 3 AND 320),
  reply_to TEXT NOT NULL CHECK(length(reply_to) BETWEEN 3 AND 320), nonce TEXT NOT NULL CHECK(length(nonce)=43),
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  CHECK(delivery_recipient<>failure_recipient),
  UNIQUE(organization_id,id), UNIQUE(organization_id,request_key), UNIQUE(organization_id,config_fingerprint,runtime_fingerprint),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
 );
 CREATE TABLE email_verification_checks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, verification_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  check_number INTEGER NOT NULL CHECK(check_number=CAST(check_number AS INTEGER) AND check_number BETWEEN 1 AND 100),
  state TEXT NOT NULL CHECK(state IN('RUNNING','PASSED','FAILED','UNKNOWN')),
  started_at TEXT NOT NULL, lease_expires_at TEXT NOT NULL, finished_at TEXT, expires_at TEXT,
  checks_json TEXT NOT NULL CHECK(${bytes("checks_json")} BETWEEN 2 AND 16384),
  UNIQUE(organization_id,id), UNIQUE(organization_id,request_key),
  UNIQUE(organization_id,verification_id,check_number),
  FOREIGN KEY(organization_id,verification_id) REFERENCES email_verification_runs(organization_id,id)
 );
 CREATE INDEX idx_email_verification_checks ON email_verification_checks(organization_id,verification_id,check_number DESC);
 CREATE TABLE email_verification_probes (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, verification_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN('DELIVERY','FAILURE')),
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  lead_id TEXT NOT NULL, action_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64), created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  UNIQUE(organization_id,id), UNIQUE(organization_id,verification_id,purpose), UNIQUE(organization_id,request_key), UNIQUE(organization_id,action_id),
  FOREIGN KEY(organization_id,verification_id) REFERENCES email_verification_runs(organization_id,id),
  FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
  FOREIGN KEY(organization_id,lead_id,action_id) REFERENCES actions(organization_id,lead_id,id),
  FOREIGN KEY(organization_id,action_id,revision_id) REFERENCES action_revisions(organization_id,action_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
 );
 CREATE TABLE email_verification_receipts (
  receipt_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, verification_id TEXT NOT NULL, probe_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('DELIVERY','FAILURE','REPLY','STOP')),
  config_fingerprint TEXT NOT NULL CHECK(length(config_fingerprint)=64),
  route_token_hash TEXT NOT NULL CHECK(length(route_token_hash)=64), signing_key_fingerprint TEXT NOT NULL CHECK(length(signing_key_fingerprint)=64),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), proof_json TEXT NOT NULL CHECK(${bytes("proof_json")} BETWEEN 2 AND 8192),
  recorded_at TEXT NOT NULL, UNIQUE(organization_id,receipt_id),
  FOREIGN KEY(organization_id,receipt_id) REFERENCES webhook_receipts(organization_id,id),
  FOREIGN KEY(organization_id,verification_id) REFERENCES email_verification_runs(organization_id,id),
  FOREIGN KEY(organization_id,probe_id) REFERENCES email_verification_probes(organization_id,id)
 );
 CREATE INDEX idx_email_verification_evidence ON email_verification_receipts(organization_id,verification_id,kind,recorded_at);
`);
}
