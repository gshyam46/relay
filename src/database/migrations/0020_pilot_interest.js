export const id="0020_pilot_interest";
export async function up(db){await db.exec(`
 CREATE TABLE pilot_interest_requests(
  id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 16 AND 200),request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),company TEXT NOT NULL CHECK(length(company) BETWEEN 1 AND 200),workflow TEXT NOT NULL CHECK(length(workflow) BETWEEN 1 AND 2000),
  channel TEXT NOT NULL CHECK(channel IN('EMAIL','WHATSAPP','UNDECIDED')),consent_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('NEW','REVIEWED','CLOSED')),created_at TEXT NOT NULL,expires_at TEXT NOT NULL
 );
 CREATE INDEX idx_pilot_interest_review ON pilot_interest_requests(status,created_at,id);
 CREATE TABLE pilot_request_limits(identity_hash TEXT PRIMARY KEY CHECK(length(identity_hash)=64),window_started_at BIGINT NOT NULL CHECK(window_started_at>=0),attempts INTEGER NOT NULL CHECK(attempts>=0));
 INSERT INTO pilot_request_limits(identity_hash,window_started_at,attempts) VALUES('0000000000000000000000000000000000000000000000000000000000000000',0,0);
`);}
