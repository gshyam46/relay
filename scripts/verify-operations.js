import {spawn} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {safeTestEnvironment} from "./helpers/testSafety.js";
if(process.argv[2]==="--child"&&process.argv.length===3){
 try{const {runOperationalWorkload}=await import("./helpers/operationalWorkload.js");const result=await runOperationalWorkload();console.log(JSON.stringify(result));if(result.status!=="PASS")process.exitCode=1;}
 catch{console.error(JSON.stringify({status:"FAIL",code:"OPERATIONAL_WORKLOAD_FAILED",scope:"ISOLATED_LOCAL"}));process.exitCode=1;}
}else{
 const args=process.argv.slice(2);if(args.length!==0&&(args.length!==2||args[0]!=="--output"||!args[1])){console.error("Use --output <new report file> or no arguments.");process.exitCode=1;}
 else{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),"--child"],{env:{...safeTestEnvironment(),OUTBOUND_DISPATCH_ENABLED:"false"},stdio:["ignore","pipe","pipe"],windowsHide:true});
  let stdout="",stderr="",oversized=false;const collect=(kind,chunk)=>{if(oversized)return;if(kind==="out")stdout+=chunk;else stderr+=chunk;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>2097152){oversized=true;child.kill();}};
  child.stdout.on("data",c=>collect("out",c.toString()));child.stderr.on("data",c=>collect("err",c.toString()));
  const timer=setTimeout(()=>child.kill(),180000);
  const code=await new Promise(resolve=>{child.once("error",()=>resolve(1));child.once("close",resolve);});clearTimeout(timer);
  try{if(oversized)throw new Error();const result=JSON.parse(stdout.trim());if(args.length)await writeFile(args[1],JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,version:result.version,scope:result.scope,timing:result.timing,row_counts:result.row_counts,checks:result.checks}));process.exitCode=code===0&&result.status==="PASS"?0:1;}
  catch{console.error(JSON.stringify({status:"FAIL",code:"OPERATIONAL_WORKLOAD_FAILED",scope:"ISOLATED_LOCAL"}));process.exitCode=1;}
 }
}
