import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0015_analysis_jobs_ai_usage.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const previous = MIGRATIONS.filter(item => item.id < migration.id), current = [...previous, migration];
const stamp = "2026-09-12T00:00:00.000Z", hash = "a".repeat(64);
const tables = ["analysis_jobs","analysis_job_items","workspace_ai_controls","workspace_ai_control_revisions","ai_provider_attempts"];
async function sqlite(t) { const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); return db; }
async function seed(db) {
  await runMigrations(db,{migrations:previous});
  for (const org of ["org","other"]) {
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)",[org,"Synthetic",stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,'OWNER',?)",[org+"-owner",org,"Owner",org+"@example.test","synthetic",stamp]);
    await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','NEW',?,?)",[org+"-lead",org,"Legacy",stamp,stamp]);
    await db.run("INSERT INTO domain_events(id,organization_id,lead_id,type,payload_json,status,created_at) VALUES (?,?,?,'LeadCreated','{}','PROCESSED',?)",[org+"-event",org,org+"-lead",stamp]);
  }
}
async function upgraded(db) { await seed(db); await runMigrations(db,{migrations:current}); }
async function insertJob(db,{id="job",owner="org-owner",generation="{}",history="[]"}={}) {
  return db.run("INSERT INTO analysis_jobs(id,organization_id,request_key,request_hash,requested_by,mode,target_stage,execution_scope,generation_json,command_history_json,created_at,updated_at) VALUES (?,'org',?,?,?,'ANALYSIS_ONLY','PLAN','PIPELINE',?,?,?,?)",
    [id,id,hash,owner,generation,history,stamp,stamp]);
}
async function upgrade(db) {
  await seed(db);
  const before = await db.all("SELECT * FROM domain_events ORDER BY id");
  assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
  assert.deepEqual(await db.all("SELECT * FROM domain_events ORDER BY id"),before);
  for (const table of tables) assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM "+table)).n),0);
  assert.deepEqual(await runMigrations(db,{migrations:current}),[]);
}
async function constraints(db) {
  await upgraded(db);
  await assert.rejects(insertJob(db,{owner:"other-owner"}),/foreign key/i);
  await assert.rejects(insertJob(db,{generation:"x".repeat(8193)}),/constraint|check/i);
  await assert.rejects(insertJob(db,{generation:"\u0939".repeat(3000)}),/constraint|check/i);
  await assert.rejects(insertJob(db,{history:"x".repeat(65537)}),/constraint|check/i);
  await insertJob(db);
  await assert.rejects(db.run("INSERT INTO analysis_job_items(id,organization_id,job_id,lead_id,event_id,ordinal) VALUES ('bad','org','job','other-lead','org-event',0)"),/foreign key/i);
  await assert.rejects(db.run("INSERT INTO analysis_job_items(id,organization_id,job_id,lead_id,event_id,ordinal) VALUES ('bad','org','job','org-lead','other-event',0)"),/foreign key/i);
  await db.run("INSERT INTO analysis_job_items(id,organization_id,job_id,lead_id,event_id,ordinal) VALUES ('item','org','job','org-lead','org-event',0)");
  await assert.rejects(db.run("INSERT INTO analysis_job_items(id,organization_id,job_id,lead_id,event_id,ordinal) VALUES ('duplicate','org','job','org-lead','org-event',1)"),/unique/i);
  await db.run("INSERT INTO workspace_ai_controls(organization_id,updated_at) VALUES ('org',?)",[stamp]);
  await assert.rejects(db.run("UPDATE workspace_ai_controls SET max_daily_attempts=0 WHERE organization_id='org'"),/constraint|check/i);
  await assert.rejects(db.run("UPDATE workspace_ai_controls SET pricing_json=? WHERE organization_id='org'",["x".repeat(32769)]),/constraint|check/i);
  await assert.rejects(db.run("UPDATE workspace_ai_controls SET updated_by='other-owner' WHERE organization_id='org'"),/foreign key/i);
}
test("0015 preserves old events and does not fabricate historical jobs, usage or controls",async t=>upgrade(await sqlite(t)));
test("0015 enforces scoped identities, unique intent associations and bounded metadata",async t=>constraints(await sqlite(t)));
test("0015 interrupted DDL and migration marker failure roll back every new table",async t=>{
  const db=await sqlite(t);await seed(db);
  await assert.rejects(runMigrations(db,{migrations:[...previous,{id:migration.id,async up(tx){await migration.up(tx);throw new Error("Synthetic interrupted analysis migration");}}]}),/Synthetic interrupted/);
  for(const table of tables) assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("CREATE TRIGGER reject_analysis_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0015_analysis_jobs_ai_usage' BEGIN SELECT RAISE(ABORT,'synthetic analysis marker failure'); END");
  await assert.rejects(runMigrations(db,{migrations:current}),/synthetic analysis marker/);
  for(const table of tables) assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("DROP TRIGGER reject_analysis_marker");
  assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
});
test("transaction-scoped clients expose immutable nonenumerable originating database identity",async t=>{
  const db=await sqlite(t);
  await db.transaction(async tx=>{
    assert.equal(tx.rootDatabase,db);
    assert.equal(Object.keys(tx).includes("rootDatabase"),false);
    assert.throws(()=>{tx.rootDatabase={};},TypeError);
  });
});
const context=postgresTestContext();
async function postgres(t) {
  const schema=schemaFor(context.runId,"l303-migration"),admin=await connectTestAdmin(context);
  try{await admin.exec('CREATE SCHEMA "'+schema+'"');}finally{await admin.close();}
  const db=await openDatabaseClient(schemaDatabaseConfig(context,schema));
  t.after(async()=>{await db.close();const cleanup=await connectTestAdmin(context);try{await cleanup.exec('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await cleanup.close();}});
  return db;
}
test("postgres0015 preserves populated historical events",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>upgrade(await postgres(t)));
test("postgres0015 enforces scoped identities and metadata byte bounds",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>constraints(await postgres(t)));
