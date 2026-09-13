import { DatabaseSync, backup } from "node:sqlite";
import { createHash,randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat,realpath,mkdir,open,readFile,writeFile,copyFile,unlink,rmdir,chmod } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { getMigrationStatus } from "../../src/database/migrate.js";
import { inspectRuntimeSchema,assertRuntimeSchema,schemaFingerprint } from "../../src/database/schemaVerifier.js";
const MAX_BYTES=1073741824,MAX_METADATA=1048576;
const codes=new Set(["RECOVERY_INPUT_INVALID","RECOVERY_TARGET_EXISTS","RECOVERY_TARGET_UNSAFE","RECOVERY_SOURCE_INVALID","RECOVERY_LIMIT","RECOVERY_BACKUP_INVALID","RECOVERY_SCHEMA_INCOMPATIBLE","RECOVERY_INTEGRITY_FAILED","RECOVERY_OPERATION_FAILED"]);
export function recoveryError(code){return Object.assign(new Error("The isolated database recovery operation was refused or could not complete."),{code});}
export function safeRecoveryFailure(error){return {code:codes.has(error?.code)?error.code:"RECOVERY_OPERATION_FAILED",message:"Recovery did not complete. Inspect the explicitly selected local paths and matching release; no application database was replaced."};}
async function checkedPath(value,{exists=true,directory=false}={}){
 if(typeof value!=="string"||!path.isAbsolute(value)||value.includes("\0"))throw recoveryError("RECOVERY_INPUT_INVALID");
 const target=path.resolve(value),root=path.parse(target).root,parts=path.relative(root,target).split(path.sep).filter(Boolean);
 let current=root;
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);
  let info;try{info=await lstat(current);}catch(e){if(e.code==="ENOENT"&&!exists&&i===parts.length-1)return target;throw recoveryError("RECOVERY_SOURCE_INVALID");}
  if(info.isSymbolicLink())throw recoveryError("RECOVERY_TARGET_UNSAFE");
  if(i<parts.length-1&&!info.isDirectory())throw recoveryError("RECOVERY_TARGET_UNSAFE");
  if(i===parts.length-1){if(!exists)throw recoveryError("RECOVERY_TARGET_EXISTS");if(directory?!info.isDirectory():!info.isFile())throw recoveryError("RECOVERY_SOURCE_INVALID");}
 }
 if(!parts.length)throw recoveryError("RECOVERY_TARGET_UNSAFE");
 const resolved=await realpath(target);
 if(path.resolve(resolved).toLowerCase()!==target.toLowerCase()&&process.platform==="win32")throw recoveryError("RECOVERY_TARGET_UNSAFE");
 return target;
}
async function reserveDirectory(value){
 const directory=await checkedPath(value,{exists:false});
 await mkdir(directory,{mode:0o700});
 const token=randomBytes(32).toString("hex"),marker=path.join(directory,".recovery-owner");
 try{await writeFile(marker,token,{flag:"wx",mode:0o600});}catch(e){try{await rmdir(directory);}catch{}throw e;}
 return {directory,token,files:[".recovery-owner"]};
}
async function cleanup(owner){
 if(!owner)return;
 const directory=await checkedPath(owner.directory,{directory:true});
 if(await readFile(path.join(directory,".recovery-owner"),"utf8")!==owner.token)throw recoveryError("RECOVERY_TARGET_UNSAFE");
 // No recursive deletion: only this command's named files are removed.
 for(const name of owner.files.filter(n=>n!==".recovery-owner")){
  const file=path.join(directory,name);let info;try{info=await lstat(file);}catch(e){if(e.code==="ENOENT")continue;throw e;}
  if(!info.isFile()||info.isSymbolicLink())throw recoveryError("RECOVERY_TARGET_UNSAFE");
  await unlink(file);
 }
 await unlink(path.join(directory,".recovery-owner"));await rmdir(directory);
}
async function digest(file){const info=await lstat(file);if(info.size>MAX_BYTES)throw recoveryError("RECOVERY_LIMIT");const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return {bytes:info.size,sha256:hash.digest("hex")};}
function reader(connection){return {kind:"sqlite",async all(sql,params=[]){return connection.prepare(sql).all(...params);},async get(sql,params=[]){return connection.prepare(sql).get(...params);}};}
async function inspect(file){
 const connection=new DatabaseSync(file,{readOnly:true});
 try{
  connection.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
  const pages=connection.prepare("PRAGMA page_count").get().page_count,size=connection.prepare("PRAGMA page_size").get().page_size;
  if(!Number.isSafeInteger(pages)||pages*size>MAX_BYTES)throw recoveryError("RECOVERY_LIMIT");
  const integrity=connection.prepare("PRAGMA integrity_check(1)").all();
  if(integrity.length!==1||integrity[0].integrity_check!=="ok"||connection.prepare("PRAGMA foreign_key_check").iterate().next().done!==true)throw recoveryError("RECOVERY_INTEGRITY_FAILED");
  const db=reader(connection),migrations=await getMigrationStatus(db);
  if(!migrations.initialized||!migrations.compatible||migrations.pending.length)throw recoveryError("RECOVERY_SCHEMA_INCOMPATIBLE");
  try{await assertRuntimeSchema(db);}catch{throw recoveryError("RECOVERY_SCHEMA_INCOMPATIBLE");}
  const catalog=await inspectRuntimeSchema(db),counts={};
  for(const table of catalog.tables)counts[table.name]=connection.prepare('SELECT CAST(count(*) AS TEXT) n FROM "'+table.name.replaceAll('"','""')+'"').get().n;
  return {migration_ids:migrations.applied.map(m=>m.id),schema_fingerprint:schemaFingerprint(catalog),table_counts:counts};
 }finally{connection.close();}
}
function metadataValid(value){
 const keys=["version","engine","created_at","artifact","bytes","sha256","migration_ids","schema_fingerprint","table_counts"];
 if(!value||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k))||value.version!==1||value.engine!=="sqlite"||value.artifact!=="database.sqlite"||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(value.sha256)||!/^[a-f0-9]{64}$/.test(value.schema_fingerprint)||!Array.isArray(value.migration_ids)||value.migration_ids.length>1000||!value.table_counts||Array.isArray(value.table_counts)||Object.keys(value.table_counts).length>256||Object.values(value.table_counts).some(n=>typeof n!=="string"||!/^\d{1,16}$/.test(n))||typeof value.created_at!=="string"||!Number.isFinite(Date.parse(value.created_at))||new Date(value.created_at).toISOString()!==value.created_at)throw recoveryError("RECOVERY_BACKUP_INVALID");
 return value;
}
export async function backupSqlite({source,destination,now=Date.now}){
 const file=await checkedPath(source),target=await checkedPath(destination,{exists:false});
 if(path.dirname(file)===target||file===target)throw recoveryError("RECOVERY_TARGET_UNSAFE");
 let owner,connection;
 try{
  const stat=await lstat(file);if(stat.size>MAX_BYTES)throw recoveryError("RECOVERY_LIMIT");
  connection=new DatabaseSync(file,{readOnly:true});connection.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
  const pageSize=connection.prepare("PRAGMA page_size").get().page_size,pageCount=connection.prepare("PRAGMA page_count").get().page_count;
  if(pageCount*pageSize>MAX_BYTES)throw recoveryError("RECOVERY_LIMIT");
  owner=await reserveDirectory(target);
  const artifact=path.join(target,"database.sqlite");owner.files.push("database.sqlite","database.sqlite-journal","database.sqlite-wal","database.sqlite-shm");
  const claimed=await open(artifact,"wx",0o600);await claimed.close();
  const deadline=Date.now()+60000;
  await backup(connection,artifact,{rate:100,progress:({totalPages})=>{if(totalPages*pageSize>MAX_BYTES||Date.now()>deadline)throw recoveryError("RECOVERY_LIMIT");}});
  connection.close();connection=null;await chmod(artifact,0o600);
  const info=await inspect(artifact),hashed=await digest(artifact),metadata={version:1,engine:"sqlite",created_at:new Date(now()).toISOString(),artifact:"database.sqlite",...hashed,...info};
  metadataValid(metadata);owner.files.push("manifest.json");await writeFile(path.join(target,"manifest.json"),JSON.stringify(metadata,null,2)+"\n",{flag:"wx",mode:0o600});
  return {status:"BACKUP_VERIFIED",...metadata,outbound_enabled:false,worker_enabled:false};
 }catch(e){try{connection?.close();}catch{}try{await cleanup(owner);}catch{}throw codes.has(e?.code)?e:recoveryError("RECOVERY_OPERATION_FAILED");}
}
export async function restoreSqliteDrill({backupDirectory,destination,now=Date.now}){
 const source=await checkedPath(backupDirectory,{directory:true}),target=await checkedPath(destination,{exists:false});
 const manifestFile=await checkedPath(path.join(source,"manifest.json")),artifact=await checkedPath(path.join(source,"database.sqlite"));
 if((await lstat(manifestFile)).size>MAX_METADATA)throw recoveryError("RECOVERY_LIMIT");
 let metadata;try{metadata=metadataValid(JSON.parse(await readFile(manifestFile,"utf8")));}catch(e){throw codes.has(e?.code)?e:recoveryError("RECOVERY_BACKUP_INVALID");}
 const hashed=await digest(artifact);if(hashed.bytes!==metadata.bytes||hashed.sha256!==metadata.sha256)throw recoveryError("RECOVERY_BACKUP_INVALID");
 let owner;
 try{
  owner=await reserveDirectory(target);const restored=path.join(target,"database.sqlite");owner.files.push("database.sqlite");
  await copyFile(artifact,restored,constants.COPYFILE_EXCL);await chmod(restored,0o600);
  const copied=await digest(restored);if(copied.sha256!==metadata.sha256||copied.bytes!==metadata.bytes)throw recoveryError("RECOVERY_BACKUP_INVALID");
  const actual=await inspect(restored);
  for(const field of ["migration_ids","schema_fingerprint","table_counts"])if(JSON.stringify(actual[field])!==JSON.stringify(metadata[field]))throw recoveryError("RECOVERY_BACKUP_INVALID");
  const result={version:1,status:"RESTORE_DRILL_VERIFIED",verified_at:new Date(now()).toISOString(),artifact_sha256:copied.sha256,...actual,outbound_enabled:false,worker_enabled:false,application_started:false};
  owner.files.push("drill.json");await writeFile(path.join(target,"drill.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  return result;
 }catch(e){try{await cleanup(owner);}catch{}throw codes.has(e?.code)?e:recoveryError("RECOVERY_OPERATION_FAILED");}
}
export function parseRecoveryArguments(argv,kind){
 const fields=kind==="backup"?["--source","--destination"]:["--backup","--destination"],values={};
 if(argv.length!==4)throw recoveryError("RECOVERY_INPUT_INVALID");
 for(let i=0;i<argv.length;i+=2){if(!fields.includes(argv[i])||Object.hasOwn(values,argv[i])||!argv[i+1])throw recoveryError("RECOVERY_INPUT_INVALID");values[argv[i]]=argv[i+1];}
 return kind==="backup"?{source:values["--source"],destination:values["--destination"]}:{backupDirectory:values["--backup"],destination:values["--destination"]};
}
