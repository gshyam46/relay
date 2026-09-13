import {createHash} from "node:crypto";
import {createId} from "../../shared/ids.js";
const GLOBAL="0".repeat(64),STATES=["NEW","REVIEWED","CLOSED"],MAX=1000;
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail=(code,status=400)=>Object.assign(new Error("Pilot-interest operation was refused. Refresh the reviewed selection and check the command."),{code,statusCode:status});
function text(value,max=200){if(typeof value!=="string"||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw fail("PILOT_OPERATION_INVALID");return value.trim();}
function ids(value){if(!Array.isArray(value)||!value.length||value.length>MAX)throw fail("PILOT_OPERATION_INVALID");const result=value.map(id=>text(id));if(new Set(result).size!==result.length)throw fail("PILOT_OPERATION_INVALID");return result.sort();}
export class PilotInterestOperations{
 constructor(db,{now=Date.now}={}){this.db=db;this.now=now;}
 async gate(work){return this.db.transaction(async tx=>{const guard=await tx.get("SELECT identity_hash FROM pilot_request_limits WHERE identity_hash=?"+(tx.kind==="postgres"?" FOR UPDATE":""),[GLOBAL]);if(!guard)throw fail("PILOT_OPERATION_UNAVAILABLE",503);return work(tx);});}
 async list({status="NEW",after_id=null,limit=20}={}){
  if(!STATES.includes(status)||!Number.isInteger(limit)||limit<1||limit>50)throw fail("PILOT_OPERATION_INVALID");
  const after=after_id===null?null:text(after_id),rows=await this.db.all("SELECT id,name,email,company,workflow,channel,status,created_at,expires_at FROM pilot_interest_requests WHERE status=?"+(after?" AND id>?":"")+" ORDER BY id LIMIT ?",[status,...(after?[after]:[]),limit+1]);
  return {requests:rows.slice(0,limit),has_more:rows.length>limit,next_after_id:rows.length>limit?rows[limit-1].id:null,limit};
 }
 async mark(input){
  const key=text(input.request_key),operator=text(input.operator_reference),id=text(input.record_id),expected=input.expected_status,status=input.status;
  if(!STATES.includes(expected)||!["REVIEWED","CLOSED"].includes(status)||expected==="CLOSED"||expected===status)throw fail("PILOT_OPERATION_INVALID");
  const requestHash=hash({operation:"MARK",operator,id,expected,status});
  return this.gate(async tx=>{
   const prior=await this.prior(tx,key,requestHash);if(prior)return prior;
   const row=await tx.get("SELECT id,status FROM pilot_interest_requests WHERE id=?",[id]);if(!row)throw fail("PILOT_REQUEST_NOT_FOUND",404);if(row.status!==expected)throw fail("PILOT_OPERATION_STALE",409);
   await tx.run("UPDATE pilot_interest_requests SET status=? WHERE id=? AND status=?",[status,id,expected]);
   return this.record(tx,{key,operator,requestHash,operation:"MARK",result:{record_id:id,before_status:expected,status}});
  });
 }
 async previewPurge({cutoff=new Date(this.now()).toISOString(),limit=1000}={}){
  const time=Date.parse(cutoff);if(!Number.isFinite(time)||new Date(time).toISOString()!==cutoff||time>this.now()||!Number.isInteger(limit)||limit<1||limit>MAX)throw fail("PILOT_OPERATION_INVALID");
  return this.gate(async tx=>{
   const rows=await tx.all("SELECT id,status,expires_at FROM pilot_interest_requests WHERE expires_at<=? ORDER BY id LIMIT ?",[cutoff,limit+1]),selected=rows.slice(0,limit);
   return {version:1,cutoff,record_ids:selected.map(row=>row.id),review_token:hash({cutoff,rows:selected}),count:selected.length,has_more:rows.length>limit};
  });
 }
 async purge(input){
  const key=text(input.request_key),operator=text(input.operator_reference),selected=ids(input.record_ids),token=text(input.review_token,64),cutoff=text(input.cutoff,30),time=Date.parse(cutoff);
  if(!/^[a-f0-9]{64}$/.test(token)||!Number.isFinite(time)||new Date(time).toISOString()!==cutoff)throw fail("PILOT_OPERATION_INVALID");
  const requestHash=hash({operation:"PURGE",operator,selected,token,cutoff});
  return this.gate(async tx=>{
   const prior=await this.prior(tx,key,requestHash);if(prior)return prior;
   if(time>this.now())throw fail("PILOT_OPERATION_STALE",409);
   const rows=[];for(const id of selected){const row=await tx.get("SELECT id,status,expires_at FROM pilot_interest_requests WHERE id=?",[id]);if(!row||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)>time)throw fail("PILOT_OPERATION_STALE",409);rows.push(row);}
   if(hash({cutoff,rows})!==token)throw fail("PILOT_OPERATION_STALE",409);
   for(const id of selected)await tx.run("DELETE FROM pilot_interest_requests WHERE id=?",[id]);
   return this.record(tx,{key,operator,requestHash,operation:"PURGE",result:{record_ids:selected,count:selected.length,cutoff}});
  });
 }
 async prior(tx,key,requestHash){
  const prior=await tx.get("SELECT request_hash,result_json FROM pilot_interest_operations WHERE request_key=?",[key]);if(!prior)return null;
  if(prior.request_hash!==requestHash)throw fail("PILOT_OPERATION_REQUEST_CONFLICT",409);
  if(Buffer.byteLength(prior.result_json,"utf8")>262144)throw fail("PILOT_OPERATION_UNAVAILABLE",503);
  return {...JSON.parse(prior.result_json),replayed:true};
 }
 async record(tx,{key,operator,requestHash,operation,result}){
  const timestamp=new Date(this.now()).toISOString(),output={operation_id:createId("pilot_op"),operation,...result,recorded_at:timestamp},json=JSON.stringify(output);
  if(Buffer.byteLength(json,"utf8")>262144)throw fail("PILOT_OPERATION_LIMIT",413);
  await tx.run("INSERT INTO pilot_interest_operations(id,request_key,request_hash,operation,operator_reference,result_json,created_at) VALUES(?,?,?,?,?,?,?)",[output.operation_id,key,requestHash,operation,operator,json,timestamp]);
  return {...output,replayed:false};
 }
}
