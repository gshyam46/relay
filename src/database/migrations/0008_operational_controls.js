// Frozen L1-10 expansion. Admission counters carry no raw account or peer identity.
export const id = "0008_operational_controls";
export async function up(db) {
  const hashCheck = db.kind === "postgres" ? "identity_hash !~ '[^0-9a-f]'" : "identity_hash NOT GLOB '*[^0-9a-f]*'";
  await db.exec(`
    CREATE TABLE auth_admission_state (
      id TEXT PRIMARY KEY CHECK(id='default'),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_rate_buckets (
      operation TEXT NOT NULL CHECK(operation IN ('LOGIN','REGISTER')),
      bucket_kind TEXT NOT NULL CHECK(bucket_kind IN ('GLOBAL','PEER','ACCOUNT')),
      identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64 AND ${hashCheck}),
      window_started_at TEXT NOT NULL,
      reset_at TEXT NOT NULL,
      attempts INTEGER NOT NULL CHECK(attempts>=0 AND attempts=CAST(attempts AS INTEGER)),
      PRIMARY KEY(operation,bucket_kind,identity_hash),
      CHECK(bucket_kind<>'GLOBAL' OR identity_hash='0000000000000000000000000000000000000000000000000000000000000000')
    );
    CREATE INDEX idx_auth_rate_buckets_reset ON auth_rate_buckets(reset_at);
    CREATE TABLE workspace_dispatch_controls (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      revision INTEGER NOT NULL CHECK(revision>=1 AND revision=CAST(revision AS INTEGER)),
      paused INTEGER NOT NULL CHECK(paused IN (0,1)),
      daily_attempt_limit INTEGER NOT NULL CHECK(daily_attempt_limit BETWEEN 1 AND 1000 AND daily_attempt_limit=CAST(daily_attempt_limit AS INTEGER)),
      unresolved_limit INTEGER NOT NULL CHECK(unresolved_limit BETWEEN 1 AND 10 AND unresolved_limit=CAST(unresolved_limit AS INTEGER)),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL REFERENCES users(id)
    );
  `);
  const stamp = "1970-01-01T00:00:00.000Z", global = "0".repeat(64);
  await db.run("INSERT INTO auth_admission_state(id,updated_at) VALUES ('default',?)", [stamp]);
  for (const operation of ["LOGIN", "REGISTER"]) await db.run("INSERT INTO auth_rate_buckets(operation,bucket_kind,identity_hash,window_started_at,reset_at,attempts) VALUES (?,'GLOBAL',?,?,?,0)", [operation, global, stamp, stamp]);
}
