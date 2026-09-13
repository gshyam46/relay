import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AccountSecurityService } from "../auth/accountSecurityService.js";
import { authRevision, securityPassword, securityNow } from "../auth/accountSecurityContract.js";
import { FreshnessRepository } from "../lead-intelligence/freshnessRepository.js";
import { verifyPassword } from "../auth/passwords.js";
import { WorkspaceDataRepository, publicErasure } from "./workspaceDataRepository.js";
import { INVENTORY_VERSION, MAX_WORKSPACE_ROWS, MAX_WORKSPACE_BYTES, MAX_ERASURES, ERASURE_CONFIRMATION, RETAINED, LIMITATIONS, exactObject, text, digest, validDigest, invalidInput, lifecycleError } from "./workspaceDataContract.js";
const SCOPE=["organization_id","actor","session_token"];
export class WorkspaceDataLifecycleService {
 constructor(db,{now=Date.now,passwords={verifyPassword}}={}) {this.db=db.rootDatabase||db;this.now=now;this.passwords=passwords;this.policy=new ContactPolicyService(this.db);this.security=new AccountSecurityService(this.db,{now});}
 validate(input,extra=[],optional=[]) {exactObject(input,[...SCOPE,...extra,...optional],[...SCOPE,...extra]);text(input.organization_id);text(input.session_token,128);if(!input.actor||typeof input.actor!=="object"||typeof input.actor.id!=="string")throw invalidInput();}
 async owner(db,input) {const result=await this.security.authenticated(db,{organization_id:input.organization_id,actor:input.actor,session_id:input.session_token},securityNow(this.now));if(result.user.role!=="OWNER")throw lifecycleError("WORKSPACE_DATA_OWNER_REQUIRED","Only the current workspace owner may inspect or change customer-data lifecycle.",403);return result;}
 scope(input,work) {return this.policy.withWorkspacePolicyTransaction(input.organization_id,async tx=>{const {user}=await this.owner(tx,input);return work(new WorkspaceDataRepository(tx),tx,user);});}
 async inspect(input) {
  this.validate(input);return this.scope(input,async repo=>{const inventory=await repo.metadata(input.organization_id,{enforceLimit:false}),holds=await repo.holds(input.organization_id);if(!inventory.within_limits)holds.push({code:"WORKSPACE_DATA_LIMIT",count:1});if((inventory.tables.find(t=>t.table==='workspace_data_erasures')?.count||0)>=MAX_ERASURES)holds.push({code:"WORKSPACE_DATA_HISTORY_LIMIT",count:1});return {inventory_version:INVENTORY_VERSION,inventory,limits:{rows:MAX_WORKSPACE_ROWS,source_bytes:MAX_WORKSPACE_BYTES,history:MAX_ERASURES},can_export:inventory.within_limits,can_erase:holds.length===0,holds,retained:RETAINED,limitations:LIMITATIONS,confirmation:ERASURE_CONFIRMATION};});
 }
 async export(input) {
  this.validate(input);return this.scope(input,async repo=>{
   const inventory=await repo.metadata(input.organization_id),rows=await repo.load(input.organization_id,inventory),records=repo.publicRecords(rows);
   const result={manifest:{version:INVENTORY_VERSION,organization_id:input.organization_id,generated_at:new Date(securityNow(this.now)).toISOString(),inventory,records_sha256:digest(records),format:"WORKSPACE_CUSTOMER_DATA_JSON",retained:RETAINED,limitations:LIMITATIONS,restore_activation:"Independent current erasure and suppression reconciliation is required before restoring service."},records};
   if(Buffer.byteLength(JSON.stringify(result))>64*1024*1024)throw lifecycleError("WORKSPACE_DATA_EXPORT_LIMIT","The encoded export exceeds 64 MiB. An inspected offline export is required.");
   return result;
  });
 }
 async previewErasure(input) {
  this.validate(input);return this.scope(input,async(repo,tx,user)=>{
   const inventory=await repo.metadata(input.organization_id),holds=await repo.holds(input.organization_id),rows=await repo.load(input.organization_id,inventory);
   if((inventory.tables.find(t=>t.table==='workspace_data_erasures')?.count||0)>=MAX_ERASURES)holds.push({code:"WORKSPACE_DATA_HISTORY_LIMIT",count:1});
   return {inventory_version:INVENTORY_VERSION,plan_token:planToken(repo,rows,input,user),inventory,can_erase:holds.length===0,holds,confirmation:ERASURE_CONFIRMATION,retained:RETAINED,limitations:LIMITATIONS,effects:{customer_data_erased:true,channel_setup_reset:true,dispatch_paused:true,account_deleted:false}};
  });
 }
 async erase(input) {
  this.validate(input,["request_key","plan_token","confirmation","current_password"]);text(input.request_key);if(!validDigest(input.plan_token)||input.confirmation!==ERASURE_CONFIRMATION)throw invalidInput();securityPassword(input.current_password);
  const captured=await this.owner(this.db,input);
  if(!await this.passwords.verifyPassword(input.current_password,captured.user.password_hash))throw lifecycleError("AUTH_PASSWORD_REJECTED","The current password could not be verified.",403);
  return this.scope(input,async(repo,tx,user)=>{
   if(user.password_hash!==captured.user.password_hash||authRevision(user)!==authRevision(captured.user))throw lifecycleError("AUTH_CONTEXT_CHANGED","Account authentication changed. Sign in again.",401);
   const requestHash=digest({inventory_version:INVENTORY_VERSION,organization_id:input.organization_id,actor_id:user.id,plan_token:input.plan_token,confirmation:input.confirmation});
   const existing=await repo.byRequest(input.organization_id,input.request_key);
   if(existing){if(existing.request_hash!==requestHash)throw lifecycleError("WORKSPACE_DATA_REQUEST_CONFLICT","This request key already identifies another erasure command.");return {erasure:publicErasure(existing),replayed:true};}
   const inventory=await repo.metadata(input.organization_id);
   if((inventory.tables.find(t=>t.table==='workspace_data_erasures')?.count||0)>=MAX_ERASURES)throw lifecycleError("WORKSPACE_DATA_HISTORY_LIMIT","Workspace erasure history reached its supported limit.");
   const holds=await repo.holds(input.organization_id);
   if(holds.length)throw lifecycleError(holds[0].code,"Active or unresolved work prevents erasure. Reconcile it through the established recovery procedure first.");
   const rows=await repo.load(input.organization_id,inventory);
   if(planToken(repo,rows,input,user)!==input.plan_token)throw lifecycleError("WORKSPACE_DATA_PLAN_STALE","Workspace data or account authority changed. Review a fresh erasure plan.");
   const lastCompletion=rows.workspace_data_erasures.reduce((latest,row)=>Math.max(latest,Date.parse(publicErasure(row).completed_at)),0);
   const timestamp=await new FreshnessRepository(tx).effectiveTime(input.organization_id,Math.max(securityNow(this.now),lastCompletion+1));
   const id=createId("erasure"),at=new Date(timestamp).toISOString(),effects=await repo.erase(input.organization_id,rows,{id,actor_id:user.id,at});
   const erasure={id,organization_id:input.organization_id,request_key:input.request_key,request_hash:requestHash,inventory_version:INVENTORY_VERSION,plan_hash:input.plan_token,erased_counts_json:JSON.stringify(effects.counts),retained_suppression_count:effects.retained_suppression_count,completed_at:at,completed_by:user.id};
   await tx.run("INSERT INTO workspace_data_erasures(id,organization_id,request_key,request_hash,inventory_version,plan_hash,erased_counts_json,retained_suppression_count,completed_at,completed_by) VALUES (?,?,?,?,?,?,?,?,?,?)",Object.values(erasure));
   await tx.run("INSERT INTO audit_logs(id,organization_id,lead_id,action_id,event_type,message,metadata_json,created_at) VALUES (?,?,NULL,NULL,'WorkspaceCustomerDataErased','Workspace customer data erased; account and minimum suppression retained.',?,?)",[createId("audit"),input.organization_id,JSON.stringify({erasure_id:id,inventory_version:INVENTORY_VERSION,plan_hash:input.plan_token,erased_counts:effects.counts,retained_suppression_count:effects.retained_suppression_count,actor_id:user.id}),at]);
   return {erasure:publicErasure(erasure),replayed:false};
  });
 }
 async byRequestKey(input) {this.validate(input,["request_key"]);text(input.request_key);return this.scope(input,async repo=>{const row=await repo.byRequest(input.organization_id,input.request_key);return {erasure:row?publicErasure(row):null};});}
 async history(input) {
  this.validate(input,[],["cursor","limit"]);const limit=input.limit==null?20:Number(input.limit);if(!Number.isInteger(limit)||limit<1||limit>50)throw invalidInput();let before=null;
  if(input.cursor!=null){try{if(typeof input.cursor!=="string"||input.cursor.length>512)throw new Error();before=JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8"));exactObject(before,["id","completed_at"]);text(before.id);if(new Date(before.completed_at).toISOString()!==before.completed_at)throw new Error();}catch{throw invalidInput();}}
  return this.scope(input,async repo=>{const rows=await repo.history(input.organization_id,before,limit),more=rows.length>limit,list=rows.slice(0,limit),last=list.at(-1);return {erasures:list.map(publicErasure),next_cursor:more?Buffer.from(JSON.stringify({id:last.id,completed_at:last.completed_at})).toString("base64url"):null};});
 }
}
function planToken(repo,rows,input,user){return digest({inventory_version:INVENTORY_VERSION,organization_id:input.organization_id,actor_id:user.id,auth_revision:authRevision(user),state:repo.planState(rows)});}
