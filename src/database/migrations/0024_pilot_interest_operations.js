export const id="0024_pilot_interest_operations";
export async function up(db){
 const bytes=column=>db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))";
 await db.exec(`CREATE TABLE pilot_interest_operations(
 id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 1 AND 200),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),operation TEXT NOT NULL CHECK(operation IN('MARK','PURGE')),
 operator_reference TEXT NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 200),
 result_json TEXT NOT NULL CHECK(${bytes("result_json")} BETWEEN 2 AND 262144),created_at TEXT NOT NULL);
 CREATE INDEX idx_pilot_operation_history ON pilot_interest_operations(created_at,id);`);
}
