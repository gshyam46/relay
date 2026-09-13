import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile,writeFile,mkdir,stat,symlink,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {createDatabase,openDatabaseClient} from "../src/database/database.js";
import {LeadsRepository} from "../src/modules/data-foundation/leadsRepository.js";
import {ActionsRepository} from "../src/modules/outbound-automation/actionsRepository.js";
import {backupSqlite,restoreSqliteDrill,parseRecoveryArguments} from "../scripts/helpers/databaseRecovery.js";
import {safeTestEnvironment} from "../scripts/helpers/testSafety.js";
async function fixture(t){
 const parent=path.resolve(tmpdir()),dir=await mkdtemp(path.join(parent,"l501-recovery-"));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith("l501-recovery-"));await rm(dir,{recursive:true,force:true});});
 const source=path.join(dir,"source.sqlite"),db=await createDatabase(source),leads=new LeadsRepository(db);
 const org=await leads.createOrganization({name:"Private recovery fixture"}),lead=await leads.createLead({organization_id:org.id,name:"Exact private lead",email:"recover@example.test",source:"MANUAL"});
 const action=await new ActionsRepository(db).createAction({organization_id:org.id,lead_id:lead.id,type:"SEND_EMAIL",payload:{subject:"Historical",message:"Never resend during restoration"},idempotency_key:"historical-intent",status:"FAILED",approval_requirement:"REQUIRED",provider:"sandbox"});
 await db.run("INSERT INTO action_executions(id,action_id,status,attempt,provider,idempotency_key,started_at,outcome_class) VALUES(?,?,'FAILED',1,'sandbox',?,?,'UNCERTAIN')",["recovery-attempt",action.id,"historical-attempt","2026-09-12T00:00:00.000Z"]);
 await db.run("INSERT INTO contact_restrictions(id,organization_id,contact_kind,contact_value,channel,reason,source,source_event_id,lead_id,effective_at,created_at) VALUES(?,?,'EMAIL',?,'ALL','OPT_OUT','INBOUND_EVENT',?,?,?,?)",["recovery-restriction",org.id,lead.email,"historical-stop",lead.id,"2026-09-12T01:00:00.000Z","2026-09-12T01:00:00.000Z"]);
 await db.run("INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES(?,?)",[org.id,"2026-09-13T00:00:00.000Z"]);
 await db.close();return {dir,source,org,lead,action,destination:path.join(dir,"backup"),restore:path.join(dir,"restore")};
}
test("consistent backup and isolated restore preserve uncertain attempts, restrictions, clocks and original data",async t=>{
 const f=await fixture(t),before=await readFile(f.source),backup=await backupSqlite({source:f.source,destination:f.destination});
 assert.equal(backup.status,"BACKUP_VERIFIED");assert.equal(backup.outbound_enabled,false);assert.equal(backup.table_counts.action_executions,"1");assert.equal(JSON.stringify(backup).includes("recover@example.test"),false);
 const restored=await restoreSqliteDrill({backupDirectory:f.destination,destination:f.restore});assert.equal(restored.status,"RESTORE_DRILL_VERIFIED");assert.equal(restored.application_started,false);assert.deepEqual(restored.table_counts,backup.table_counts);
 const db=await openDatabaseClient(path.join(f.restore,"database.sqlite"),{readOnly:true});
 try{assert.equal((await db.get("SELECT outcome_class FROM action_executions WHERE id='recovery-attempt'")).outcome_class,"UNCERTAIN");assert.equal((await db.get("SELECT reason FROM contact_restrictions WHERE id='recovery-restriction'")).reason,"OPT_OUT");assert.equal((await db.get("SELECT high_water_at FROM workspace_freshness_clocks")).high_water_at,"2026-09-13T00:00:00.000Z");assert.equal((await db.get("SELECT count(*) n FROM ai_provider_attempts")).n,0);assert.equal((await db.get("SELECT count(*) n FROM action_executions")).n,1);}finally{await db.close();}
 assert.deepEqual(await readFile(f.source),before);
});
test("engine backup includes committed WAL data without copying or checkpointing application files",async t=>{
 const f=await fixture(t),writer=new DatabaseSync(f.source);
 try{
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  writer.prepare("UPDATE leads SET name=? WHERE id=?").run("Only committed in WAL",f.lead.id);
  assert.ok((await stat(f.source+"-wal")).size>0);
  await backupSqlite({source:f.source,destination:f.destination});
  const copy=new DatabaseSync(path.join(f.destination,"database.sqlite"),{readOnly:true});
  try{assert.equal(copy.prepare("SELECT name FROM leads WHERE id=?").get(f.lead.id).name,"Only committed in WAL");}finally{copy.close();}
 }finally{writer.close();}
});
test("backup refuses existing targets, relative inputs and absent parents without deleting their contents",async t=>{
 const f=await fixture(t);await mkdir(f.destination);await writeFile(path.join(f.destination,"keep.txt"),"keep");
 await assert.rejects(backupSqlite({source:f.source,destination:f.destination}),{code:"RECOVERY_TARGET_EXISTS"});
 assert.equal(await readFile(path.join(f.destination,"keep.txt"),"utf8"),"keep");
 await assert.rejects(backupSqlite({source:"relative.sqlite",destination:f.restore}),{code:"RECOVERY_INPUT_INVALID"});
 await assert.rejects(backupSqlite({source:f.source,destination:path.join(f.dir,"missing","child")}),{code:"RECOVERY_SOURCE_INVALID"});
 assert.equal((await readdir(f.dir)).includes("missing"),false);
});
test("symlink or junction ancestry cannot redirect backup writes",async t=>{
 const f=await fixture(t),real=path.join(f.dir,"real"),link=path.join(f.dir,"link");await mkdir(real);
 await symlink(real,link,process.platform==="win32"?"junction":"dir");
 await assert.rejects(backupSqlite({source:f.source,destination:path.join(link,"new")}),{code:"RECOVERY_TARGET_UNSAFE"});
 assert.deepEqual(await readdir(real),[]);
});
test("changed archive bytes fail verification before a restore directory is created",async t=>{
 const f=await fixture(t);await backupSqlite({source:f.source,destination:f.destination});
 const artifact=path.join(f.destination,"database.sqlite"),bytes=await readFile(artifact);bytes[bytes.length-1]^=1;await writeFile(artifact,bytes);
 await assert.rejects(restoreSqliteDrill({backupDirectory:f.destination,destination:f.restore}),{code:"RECOVERY_BACKUP_INVALID"});
 assert.equal((await readdir(f.dir)).includes("restore"),false);
});
test("lying manifest counts cannot pass rehearsal and only the newly owned failed target is cleaned",async t=>{
 const f=await fixture(t);await backupSqlite({source:f.source,destination:f.destination});
 const file=path.join(f.destination,"manifest.json"),meta=JSON.parse(await readFile(file,"utf8"));meta.table_counts.actions="999";await writeFile(file,JSON.stringify(meta));
 await assert.rejects(restoreSqliteDrill({backupDirectory:f.destination,destination:f.restore}),{code:"RECOVERY_BACKUP_INVALID"});
 assert.equal((await readdir(f.dir)).includes("restore"),false);assert.ok((await stat(f.source)).isFile());assert.ok((await stat(file)).isFile());
});
test("missing structures and foreign-key corruption reject backup without leaving partial artifacts",async t=>{
 const f=await fixture(t),writer=new DatabaseSync(f.source);writer.exec("PRAGMA foreign_keys=OFF; DELETE FROM leads;");writer.close();
 await assert.rejects(backupSqlite({source:f.source,destination:f.destination}),{code:"RECOVERY_INTEGRITY_FAILED"});
 assert.equal((await readdir(f.dir)).includes("backup"),false);
});
test("a complete ledger with missing table cannot produce a verified backup",async t=>{
 const f=await fixture(t),writer=new DatabaseSync(f.source);writer.exec("DROP TABLE email_verification_receipts");writer.close();
 await assert.rejects(backupSqlite({source:f.source,destination:f.destination}),{code:"RECOVERY_SCHEMA_INCOMPATIBLE"});
 assert.equal((await readdir(f.dir)).includes("backup"),false);
});
test("CLI requires exact explicit paths, ignores inherited database/provider secrets and emits safe failures",async t=>{
 const f=await fixture(t),env={...safeTestEnvironment(),DATABASE_URL:"postgresql://never:sentinel-private@127.0.0.1:1/never",SENDGRID_API_KEY:"sentinel-private",OUTBOUND_DISPATCH_ENABLED:"true",WORKER_ENABLED:"true"};
 const invoke=(file,args)=>spawnSync(process.execPath,[file,...args],{env,encoding:"utf8",timeout:15000,windowsHide:true});
 const good=invoke("scripts/db-backup.js",["--source",f.source,"--destination",f.destination]);assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/"outbound_enabled":false/);assert.doesNotMatch(good.stdout+good.stderr,/sentinel-private|recover@example/);
 const bad=invoke("scripts/db-restore-drill.js",["--backup","relative","--destination",f.restore]);assert.equal(bad.status,1);assert.match(bad.stderr,/RECOVERY_INPUT_INVALID/);assert.doesNotMatch(bad.stderr,/sentinel-private|at .*\.js/);
 assert.throws(()=>parseRecoveryArguments(["--source",f.source,"--source",f.source],"backup"),{code:"RECOVERY_INPUT_INVALID"});
});
