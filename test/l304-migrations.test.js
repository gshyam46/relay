import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0016_intelligence_feedback_evaluation.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
const previous=MIGRATIONS.filter(item=>item.id<migration.id),current=[...previous,migration];
const tables=["intelligence_feedback_targets","intelligence_feedback_revisions","intelligence_evaluation_datasets","intelligence_evaluation_members","intelligence_evaluations","intelligence_evaluation_groups"];
const stamp="2026-09-12T00:00:00.000Z",hash="a".repeat(64);
async function sqlite(t){const db=new SqliteDatabaseClient(":memory:");t.after(()=>db.close());return db;}
async function seed(db){
  await runMigrations(db,{migrations:previous});
  for(const org of ["org","other"]){
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)",[org,"Synthetic",stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[org+"-owner",org,"Owner",org+"@example.test","synthetic",stamp]);
    for(const suffix of ["-lead","-second"]) await db.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES(?,?,?,'MANUAL','NEW',?,?)",[org+suffix,org,"Legacy",stamp,stamp]);
    await db.run("INSERT INTO intelligence_snapshots(id,organization_id,lead_id,summary,score,next_best_action,evidence_json,created_at) VALUES(?,?,?,'Saved',50,'CREATE_HUMAN_TASK','[]',?)",[org+"-snapshot",org,org+"-lead",stamp]);
  }
}
async function target(db,{id="feedback",org="org",lead="org-lead",artifact="org-snapshot",owner="org-owner",json="{}"}={}){
  return db.run("INSERT INTO intelligence_feedback_targets(id,organization_id,lead_id,target_kind,target_id,snapshot_id,source_sha256,snapshot_json,created_at,created_by) VALUES(?,?,?,'SNAPSHOT',?,?,?,?,?,?)",[id,org,lead,artifact,artifact,hash,json,stamp,owner]);
}
async function dataset(db,{id="dataset",org="org",owner="org-owner",manifest="{}"}={}){
  return db.run("INSERT INTO intelligence_evaluation_datasets(id,organization_id,name,version,split,request_key,request_hash,manifest_sha256,manifest_json,case_count,created_by,created_at) VALUES(?,?,?,1,'HOLDOUT',?,?,?,?,1,?,?)",[id,org,id,id,hash,hash,manifest,owner,stamp]);
}
async function upgrade(db){
  await seed(db);const before=await db.all("SELECT * FROM intelligence_snapshots ORDER BY id");
  assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
  assert.deepEqual(await db.all("SELECT * FROM intelligence_snapshots ORDER BY id"),before);
  for(const table of tables)assert.equal(Number((await db.get("SELECT count(*) n FROM "+table)).n),0);
  assert.deepEqual(await runMigrations(db,{migrations:current}),[]);
}
async function constraints(db){
  await seed(db);await runMigrations(db,{migrations:current});
  for(const changes of [{lead:"org-second"},{artifact:"other-snapshot"},{owner:"other-owner"},{json:"x".repeat(1048577)},{json:"\u0939".repeat(350000)}])await assert.rejects(target(db,changes),/foreign key|constraint|check/i);
  await target(db);
  await assert.rejects(db.run("UPDATE intelligence_feedback_targets SET message_id=target_id WHERE id='feedback'"),/constraint|check/i);
  await assert.rejects(db.run("UPDATE intelligence_feedback_targets SET snapshot_id=NULL WHERE id='feedback'"),/constraint|check/i);
  await db.run("INSERT INTO intelligence_feedback_revisions(id,organization_id,lead_id,feedback_id,revision,expected_revision,status,labels_json,reason,request_key,request_hash,created_at,created_by) VALUES('revision','org','org-lead','feedback',1,0,'RECORDED','{}','Reviewed','review',?,?,'org-owner')",[hash,stamp]);
  for(const sql of ["UPDATE intelligence_feedback_revisions SET labels_json=NULL","UPDATE intelligence_feedback_revisions SET expected_revision=1","UPDATE intelligence_feedback_revisions SET lead_id='org-second'","UPDATE intelligence_feedback_revisions SET created_by='other-owner'"])await assert.rejects(db.run(sql),/foreign key|constraint|check/i);
  await assert.rejects(dataset(db,{owner:"other-owner"}),/foreign key/i);
  await assert.rejects(dataset(db,{manifest:"\u0939".repeat(45000)}),/constraint|check/i);
  await dataset(db);
  if(db.kind!=="postgres")for(const sql of ["UPDATE intelligence_feedback_revisions SET revision=1.5,expected_revision=0.5", "UPDATE intelligence_evaluation_datasets SET version=1.5", "UPDATE intelligence_evaluation_datasets SET case_count=1.5"])await assert.rejects(db.run(sql),/constraint|check|integer/i);
  await dataset(db,{id:"foreign",org:"other",owner:"other-owner"});
  const member=(lead,datasetId="dataset")=>db.run("INSERT INTO intelligence_evaluation_members(organization_id,dataset_id,position,feedback_id,feedback_revision,lead_id,reply_text_sha256,case_sha256) VALUES('org',?,0,'feedback',1,?,?,?)",[datasetId,lead,hash,hash]);
  await assert.rejects(member("org-second"),/foreign key/i);await assert.rejects(member("org-lead","foreign"),/foreign key/i);await member("org-lead");
  if(db.kind!=="postgres")await assert.rejects(db.run("UPDATE intelligence_evaluation_members SET position=0.5"),/constraint|check|integer/i);
  await db.run("INSERT INTO intelligence_evaluations(id,organization_id,dataset_id,candidate_source_sha256,candidate_versions_json,manifest_sha256,metrics_json,created_by,created_at) VALUES('evaluation','other','foreign',?,'{}',?,'{}','other-owner',?)",[hash,hash,stamp]);
  await assert.rejects(db.run("INSERT INTO intelligence_evaluation_groups(organization_id,group_kind,group_key,split,first_dataset_id,consumed_evaluation_id) VALUES('org','LEAD','org-lead','HOLDOUT','dataset','evaluation')"),/foreign key/i);
}
test("0016 preserves historical assessments without fabricating reviews or datasets",async t=>upgrade(await sqlite(t)));
test("0016 enforces exact lead artifacts, revision state, evaluation scope and byte bounds",async t=>constraints(await sqlite(t)));
test("0016 DDL and marker failures roll back all new tables and permit retry",async t=>{
  const db=await sqlite(t);await seed(db);
  await assert.rejects(runMigrations(db,{migrations:[...previous,{id:migration.id,async up(tx){await migration.up(tx);throw new Error("Synthetic interruption");}}]}),/Synthetic interruption/);
  for(const table of tables)assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("CREATE TRIGGER reject_feedback_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0016_intelligence_feedback_evaluation' BEGIN SELECT RAISE(ABORT,'Synthetic marker failure'); END");
  await assert.rejects(runMigrations(db,{migrations:current}),/Synthetic marker failure/);
  for(const table of tables)assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("DROP TRIGGER reject_feedback_marker");assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
});
const context=postgresTestContext();
async function postgres(t){
  const schema=schemaFor(context.runId,"l304-migration"),admin=await connectTestAdmin(context);
  try{await admin.exec('CREATE SCHEMA "'+schema+'"');}finally{await admin.close();}
  const db=await openDatabaseClient(schemaDatabaseConfig(context,schema));
  t.after(async()=>{await db.close();const cleanup=await connectTestAdmin(context);try{await cleanup.exec('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await cleanup.close();}});return db;
}
test("postgres0016 preserves populated history",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>upgrade(await postgres(t)));
test("postgres0016 enforces exact references and UTF8 byte limits",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>constraints(await postgres(t)));
