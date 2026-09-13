import path from "node:path";
import {readFile,lstat} from "node:fs/promises";
import {openRuntimeDatabase,describeDatabaseFailure} from "../src/database/database.js";
import {loadConfig,validateConfig} from "../src/config.js";
import {PilotInterestOperations} from "../src/modules/public-interest/pilotInterestOperations.js";
async function main(){
 let db;
 try{
  const args=process.argv.slice(2),operation=args.shift(),options={};
  if(!["list","mark","preview-purge","purge"].includes(operation))throw new Error("INPUT");
  while(args.length){const key=args.shift();if(!["--database-file","--configured-database","--input","--status","--after-id","--limit"].includes(key)||Object.hasOwn(options,key))throw new Error("INPUT");options[key]=key==="--configured-database"?true:args.shift();if(options[key]===undefined||options[key]===true&&key!=="--configured-database")throw new Error("INPUT");}
  if(Boolean(options["--database-file"])===Boolean(options["--configured-database"]))throw new Error("INPUT");
  let target;
  if(options["--database-file"]){if(!path.isAbsolute(options["--database-file"]))throw new Error("INPUT");target=options["--database-file"];}
  else{const config=loadConfig();if(config.database.driver!=="postgres"||validateConfig(config).length)throw new Error("CONFIG");target=config.database;}
  let input;
  if(["mark","purge"].includes(operation)){
   const file=options["--input"];if(typeof file!=="string"||!path.isAbsolute(file))throw new Error("INPUT");
   const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)throw new Error("INPUT");
   input=JSON.parse(await readFile(file,"utf8"));if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("INPUT");
  }else if(options["--input"])throw new Error("INPUT");
  if(["mark","purge"].includes(operation)&&["--status","--after-id","--limit"].some(key=>options[key]!==undefined))throw new Error("INPUT");
  if(operation==="preview-purge"&&(options["--status"]||options["--after-id"]))throw new Error("INPUT");
  db=await openRuntimeDatabase(target);const service=new PilotInterestOperations(db);
  const result=operation==="list"?await service.list({status:options["--status"]||"NEW",after_id:options["--after-id"]||null,limit:options["--limit"]===undefined?20:Number(options["--limit"])}):operation==="preview-purge"?await service.previewPurge({limit:options["--limit"]===undefined?1000:Number(options["--limit"])}):await service[operation](input);
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(JSON.stringify({code:/^PILOT_/.test(error?.code||"")?error.code:"PILOT_OPERATION_FAILED",message:"Operation did not complete. Supply list|mark|preview-purge|purge and exactly one explicit --database-file <absolute existing SQLite> or --configured-database. mark/purge require --input <absolute JSON command>. No default database, email or automatic migration is used.",...(error?.code?.startsWith("DATABASE_")?{database:describeDatabaseFailure(error).code}:{})}));process.exitCode=1;}
 finally{await db?.close();}
}
await main();
