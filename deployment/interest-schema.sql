-- Run once using a deliberate migration/admin connection, never the function credential.
-- This separate acquisition schema is not part of the application migration registry.
BEGIN;
CREATE SCHEMA relay_interest;
REVOKE ALL ON SCHEMA relay_interest FROM PUBLIC;
SET LOCAL search_path = relay_interest, pg_catalog;

 CREATE TABLE pilot_interest_requests(
  id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 16 AND 200),request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),company TEXT NOT NULL CHECK(length(company) BETWEEN 1 AND 200),workflow TEXT NOT NULL CHECK(length(workflow) BETWEEN 1 AND 2000),
  channel TEXT NOT NULL CHECK(channel IN('EMAIL','WHATSAPP','UNDECIDED')),consent_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('NEW','REVIEWED','CLOSED')),created_at TEXT NOT NULL,expires_at TEXT NOT NULL
 );
 CREATE INDEX idx_pilot_interest_review ON pilot_interest_requests(status,created_at,id);
 CREATE TABLE pilot_request_limits(identity_hash TEXT PRIMARY KEY CHECK(length(identity_hash)=64),window_started_at BIGINT NOT NULL CHECK(window_started_at>=0),attempts INTEGER NOT NULL CHECK(attempts>=0));
 INSERT INTO pilot_request_limits(identity_hash,window_started_at,attempts) VALUES('0000000000000000000000000000000000000000000000000000000000000000',0,0);

CREATE TABLE pilot_interest_operations(
 id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 1 AND 200),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),operation TEXT NOT NULL CHECK(operation IN('MARK','PURGE')),
 operator_reference TEXT NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 200),
 result_json TEXT NOT NULL CHECK(octet_length(result_json) BETWEEN 2 AND 262144),created_at TEXT NOT NULL);
 CREATE INDEX idx_pilot_operation_history ON pilot_interest_operations(created_at,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='relay_interest_writer') THEN CREATE ROLE relay_interest_writer NOLOGIN; END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA relay_interest FROM PUBLIC;
GRANT USAGE ON SCHEMA relay_interest TO relay_interest_writer;
GRANT SELECT, INSERT ON relay_interest.pilot_interest_requests TO relay_interest_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_interest.pilot_request_limits TO relay_interest_writer;
ALTER TABLE relay_interest.pilot_interest_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_interest.pilot_request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_interest.pilot_interest_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY intake_read ON relay_interest.pilot_interest_requests FOR SELECT TO relay_interest_writer USING (true);
CREATE POLICY intake_insert ON relay_interest.pilot_interest_requests FOR INSERT TO relay_interest_writer WITH CHECK (true);
CREATE POLICY intake_limits ON relay_interest.pilot_request_limits TO relay_interest_writer USING (true) WITH CHECK (true);
COMMIT;
-- Create a separate LOGIN role with a generated secret through your database administration tools.
-- Grant relay_interest_writer to that login. It must have no other application privileges or DDL rights.
-- INTEREST_DATABASE_URL identifies that login; never reuse an admin/migration credential.
-- Operator review/purge uses a separate privileged connection and the documented CLI.
