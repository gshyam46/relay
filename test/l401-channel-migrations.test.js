import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import * as migration from "../src/database/migrations/0017_email_connection_setup.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
const previous=MIGRATIONS.filter(item=>item.id<migration.id),current=[...previous,migration],hash="a".repeat(64),stamp="2026-09-12T00:00:00.000Z";
const tables=["email_connection_revisions","email_webhook_routes"];
async function sqlite(t){const db=new SqliteDatabaseClient(":memory:");t.after(()=>db.close());return db;}
async function seed(db){
  await runMigrations(db,{migrations:previous});
  for(const org of ["org","other"]){
    await db.run("INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)",[org,"Synthetic",stamp]);
    await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[org+"-owner",org,"Owner",org+"@example.test","synthetic",stamp]);
    await db.run("INSERT INTO organization_settings(organization_id,category,key,value,updated_at) VALUES(?,'channel_email','webhook_token',?,?)",[org,JSON.stringify("legacy-token"),stamp]);
    await db.run("INSERT INTO organization_settings(organization_id,category,key,value,updated_at) VALUES(?,'channel_email','api_key',?,?)",[org,JSON.stringify("synthetic-secret"),stamp]);
  }
}
async function revision(db,{org="org",id="change",owner="org-owner",before="{}",after="{}",number=1,expected=0,request="request"}={}){
  return db.run("INSERT INTO email_connection_revisions(id,organization_id,revision,expected_revision,operation,config_fingerprint,before_json,after_json,request_key,request_hash,reason,created_at,created_by) VALUES(?,?,?,?,'PROVISION_ROUTE',?,?,?,?,?,'Synthetic owner setup',?,?)",[id,org,number,expected,hash,before,after,request,hash,stamp,owner]);
}
async function route(db,{org="org",id="route",token="r".repeat(40),number=1,owner="org-owner",kind="GENERATED"}={}){
  return db.run("INSERT INTO email_webhook_routes(id,organization_id,token,route_kind,created_revision,created_at,created_by) VALUES(?,?,?,?,?,?,?)",[id,org,token,kind,number,stamp,owner]);
}
async function upgrade(db){
  await seed(db);const before=await db.all("SELECT * FROM organization_settings ORDER BY organization_id,key");
  assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
  assert.deepEqual(await db.all("SELECT * FROM organization_settings ORDER BY organization_id,key"),before);
  for(const table of tables)assert.equal(Number((await db.get("SELECT count(*) n FROM "+table)).n),0);
  assert.deepEqual(await runMigrations(db,{migrations:current}),[]);
}
async function constraints(db){
  await seed(db);await runMigrations(db,{migrations:current});
  for(const change of [{owner:"other-owner"},{number:101,expected:100},{before:"x".repeat(16385)},{after:"\u0939".repeat(5500)}])await assert.rejects(revision(db,change),/constraint|check|foreign key/i);
  if(db.kind!=="postgres")await assert.rejects(revision(db,{number:1.5,expected:0.5}),/constraint|check/i);
  await revision(db);await revision(db,{org:"other",id:"other-change",owner:"other-owner"});
  await assert.rejects(revision(db,{id:"duplicate"}),/unique/i);
  for(const change of [{owner:"other-owner"},{number:2},{token:"short"}])await assert.rejects(route(db,change),/constraint|check|foreign key/i);
  await route(db);await route(db,{id:"legacy",token:"old-short-token",kind:"LEGACY"});
  await assert.rejects(route(db,{id:"foreign-route",org:"other",owner:"other-owner"}),/unique/i);
  await assert.rejects(route(db,{id:"duplicate-kind",token:"s".repeat(40)}),/unique/i);
  await assert.rejects(db.run("UPDATE email_connection_revisions SET expected_revision=1 WHERE id='change'"),/constraint|check/i);
  assert.equal(Number((await db.get("SELECT count(*) n FROM email_webhook_routes")).n),2);
}
test("0017 preserves old secrets and ambiguous legacy tokens without fabricating setup authority",async t=>upgrade(await sqlite(t)));
test("0017 enforces scoped owners, integral revisions, bounded history and globally unique aliases",async t=>constraints(await sqlite(t)));
test("0017 interrupted DDL and ledger failure roll back both tables and permit exact retry",async t=>{
  const db=await sqlite(t);await seed(db);
  await assert.rejects(runMigrations(db,{migrations:[...previous,{id:migration.id,async up(tx){await migration.up(tx);throw new Error("Synthetic interruption");}}]}),/Synthetic interruption/);
  for(const table of tables)assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("CREATE TRIGGER reject_connection_marker BEFORE INSERT ON schema_migrations WHEN NEW.id='0017_email_connection_setup' BEGIN SELECT RAISE(ABORT,'Synthetic marker failure'); END");
  await assert.rejects(runMigrations(db,{migrations:current}),/Synthetic marker failure/);
  for(const table of tables)assert.equal(await db.columnExists(table,"organization_id"),false);
  await db.exec("DROP TRIGGER reject_connection_marker");assert.deepEqual(await runMigrations(db,{migrations:current}),[migration.id]);
});
const context=postgresTestContext();
async function postgres(t){
  const schema=schemaFor(context.runId,"l401-migration"),admin=await connectTestAdmin(context);
  try{await admin.exec('CREATE SCHEMA "'+schema+'"');}finally{await admin.close();}
  const db=await openDatabaseClient(schemaDatabaseConfig(context,schema));
  t.after(async()=>{await db.close();const cleanup=await connectTestAdmin(context);try{await cleanup.exec('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');}finally{await cleanup.close();}});return db;
}
test("postgres0017 preserves populated legacy configuration",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>upgrade(await postgres(t)));
test("postgres0017 enforces alias identity and bounded setup history",{skip:context?false:"Requires explicit disposable PostgreSQL runner"},async t=>constraints(await postgres(t)));
