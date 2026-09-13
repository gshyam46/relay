import { randomBytes, randomUUID } from "node:crypto";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { currentAiInvocationContext } from "./aiInvocationContext.js";
import { createGenerationDescriptor, registerGenerationDescriptor, getGenerationDescriptor } from "./generationDescriptor.js";
import { REPLY_POLICY_VERSION, REPLY_PROMPT_VERSION } from "../channels/replyInterpretationContract.js";
import { aiError, isAiAdmissionError, hash, identifier, boundInteger, normalizeControls, parseControls, normalizeObservation, estimateCost, usd } from "./aiUsageContract.js";

const SHA = /^[0-9a-f]{64}$/;
const PUBLIC_FIELDS = ["id","lead_id","purpose","provider","requested_model","response_model","pipeline_version","prompt_version","schema_version","authorized_at","deadline_at","request_state","outcome","usage_status","input_tokens","output_tokens","total_tokens","usage_reason","elapsed_ms","cost_status","cost_estimate_microusd","pricing_revision","observed_at","closed_at"];
function projectAttempt(row) { return { ...Object.fromEntries(PUBLIC_FIELDS.map(key=>[key,row[key] ?? null])), cost_estimate_usd: usd(row.cost_estimate_microusd) }; }
function timestamp(value) { const n=typeof value === "number" ? value : Date.parse(value); if (!Number.isFinite(n)) throw aiError("AI_STATE_INVALID"); try { return new Date(n).toISOString(); } catch { throw aiError("AI_STATE_INVALID"); } }
function effectiveTime(row, now) { const at=timestamp(now()); if (!row?.budget_high_water_at) return at; const saved=timestamp(row.budget_high_water_at); if(saved!==row.budget_high_water_at) throw aiError("AI_STATE_INVALID");return saved>at?saved:at; }
function dayOf(at) { return at.slice(0,10); }
function resetAt(at) { return new Date(Date.parse(dayOf(at)+"T00:00:00.000Z")+86400000).toISOString(); }
function holdCode(controls, admitted, active) { return controls.paused ? "AI_PAUSED" : admitted>=controls.max_daily_attempts ? "AI_DAILY_LIMIT" : active>=controls.max_in_flight ? "AI_IN_FLIGHT_LIMIT" : null; }

export class AiInvocationService {
 constructor(db,{now=Date.now}={}) { this.db=db.rootDatabase||db; this.now=now; }
 async gate(org,work) { return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(org,work); }
 async getControls({organization_id,before_revision,limit=20}) {
  identifier(organization_id,256); boundInteger(limit,1,50); if(before_revision!==undefined)boundInteger(before_revision,1,2147483647);
  return this.gate(organization_id,tx=>this.controlsView(tx,organization_id,{before_revision,limit}));
 }
 async controlsView(tx,org,{before_revision,limit=20}={}) {
  const row=await tx.get("SELECT * FROM workspace_ai_controls WHERE organization_id=?",[org]);
  const params=[org];let cursor="";if(before_revision!==undefined){cursor=" AND revision<?";params.push(before_revision);}params.push(limit+1);
  const rows=await tx.all("SELECT revision,controls_json,reason,created_by,created_at FROM workspace_ai_control_revisions WHERE organization_id=?"+cursor+" ORDER BY revision DESC LIMIT ?",params);
  const items=rows.slice(0,limit).map(item=>{try{return {revision:item.revision,controls:normalizeControls(JSON.parse(item.controls_json)),reason:item.reason,created_by:item.created_by,created_at:item.created_at};}catch{throw aiError("AI_STATE_INVALID");}});
  return {controls:parseControls(row),history:{items,has_more:rows.length>limit,next_before_revision:rows.length>limit?items.at(-1).revision:null,limit},usage:await this.summary(tx,org,row)};
 }
 async updateControls(input) {
  const org=identifier(input.organization_id,256),actor=input.actor;
  if(!actor||actor.role!=="OWNER")throw aiError("AI_OWNER_REQUIRED");identifier(actor.id,256);
  boundInteger(input.expected_revision,0,2147483646);if(typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>2000)throw aiError("AI_REQUEST_INVALID");
  const controls=normalizeControls({paused:input.paused,max_daily_attempts:input.max_daily_attempts,max_in_flight:input.max_in_flight,pricing:input.pricing});
  return this.gate(org,async tx=>{
   const owner=await tx.get("SELECT role FROM users WHERE organization_id=? AND id=?",[org,actor.id]);if(owner?.role!=="OWNER")throw aiError("AI_OWNER_REQUIRED");
   const row=await tx.get("SELECT * FROM workspace_ai_controls WHERE organization_id=?",[org]);const current=parseControls(row);
   if(current.revision!==input.expected_revision)throw aiError("AI_CONTROLS_STALE");
   const at=effectiveTime(row,this.now), revision=current.revision+1;
   await tx.run("INSERT INTO workspace_ai_controls (organization_id,revision,paused,max_daily_attempts,max_in_flight,pricing_json,budget_high_water_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision,paused=excluded.paused,max_daily_attempts=excluded.max_daily_attempts,max_in_flight=excluded.max_in_flight,pricing_json=excluded.pricing_json,budget_high_water_at=excluded.budget_high_water_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at",[org,revision,Number(controls.paused),controls.max_daily_attempts,controls.max_in_flight,JSON.stringify(controls.pricing),at,actor.id,at]);
   await tx.run("INSERT INTO workspace_ai_control_revisions (organization_id,revision,controls_json,reason,created_by,created_at) VALUES (?,?,?,?,?,?)",[org,revision,JSON.stringify(controls),input.reason.trim(),actor.id,at]);
   await new AuditRepository(tx).record({organization_id:org,event_type:"AiControlsUpdated",message:"Owner updated workspace AI request controls.",metadata:{revision,actor:actor.id}});
   return this.controlsView(tx,org);
  });
 }
 async summary(tx,org,row) {
  const controls=parseControls(row),at=effectiveTime(row,this.now),day=dayOf(at);
  const attempts=await tx.all("SELECT usage_status,input_tokens,output_tokens,total_tokens,cost_status,cost_estimate_microusd FROM ai_provider_attempts WHERE organization_id=? AND budget_day=? LIMIT 10001",[org,day]);
  if(attempts.length>10000)throw aiError("AI_STATE_INVALID");
  const active=await tx.get("SELECT COUNT(*) AS count FROM ai_provider_attempts WHERE organization_id=? AND request_state='ADMITTED' AND deadline_at>?",[org,at]);
  const measured=attempts.filter(a=>a.usage_status==="PROVIDER_REPORTED"),estimated=attempts.filter(a=>a.cost_status==="ESTIMATED");
  const subtotal=estimated.length?estimated.reduce((sum,item)=>sum+BigInt(item.cost_estimate_microusd),0n).toString():null;
  const code=holdCode(controls,attempts.length,Number(active.count));
  return {budget_day:day,next_reset_at:resetAt(at),admitted_attempts:attempts.length,in_flight:Number(active.count),limits:{paused:controls.paused,max_daily_attempts:controls.max_daily_attempts,max_in_flight:controls.max_in_flight},can_invoke:code===null,hold_code:code,provider_reported_attempts:measured.length,unknown_usage_attempts:attempts.length-measured.length,input_tokens_known_total:measured.length?measured.reduce((sum,a)=>sum+a.input_tokens,0):null,output_tokens_known_total:measured.length?measured.reduce((sum,a)=>sum+a.output_tokens,0):null,total_tokens_known_total:measured.length?measured.reduce((sum,a)=>sum+a.total_tokens,0):null,cost:{currency:"USD",estimated_microusd:subtotal,estimated_usd:usd(subtotal),estimated_attempts:estimated.length,unknown_attempts:attempts.length-estimated.length,basis:"OWNER_RATES_PROVIDER_REPORTED_TOKENS",is_invoice:false,is_monetary_cap:false}};
 }
 async usage({organization_id,before_attempt_id,limit=25}) {
  const org=identifier(organization_id,256);boundInteger(limit,1,50);if(before_attempt_id!==undefined)identifier(before_attempt_id,256);
  return this.gate(org,async tx=>{
   const row=await tx.get("SELECT * FROM workspace_ai_controls WHERE organization_id=?",[org]), summary=await this.summary(tx,org,row);
   let cursor="";const params=[org,summary.budget_day];
   if(before_attempt_id!==undefined){const before=await tx.get("SELECT authorized_at,id FROM ai_provider_attempts WHERE organization_id=? AND budget_day=? AND id=?",[org,summary.budget_day,before_attempt_id]);if(!before)throw aiError("AI_REQUEST_INVALID");cursor=" AND (authorized_at<? OR (authorized_at=? AND id<?))";params.push(before.authorized_at,before.authorized_at,before.id);}params.push(limit+1);
   const rows=await tx.all("SELECT "+PUBLIC_FIELDS.join(",")+" FROM ai_provider_attempts WHERE organization_id=? AND budget_day=?"+cursor+" ORDER BY authorized_at DESC,id DESC LIMIT ?",params),items=rows.slice(0,limit).map(projectAttempt);
   return {summary,items,limit,has_more:rows.length>limit,next_before_attempt_id:rows.length>limit?items.at(-1).id:null};
  });
 }
 async admit(input) {
  const org=identifier(input.organization_id,256),origin=input.origin;
  if(!origin||!["DOMAIN_EVENT","INBOUND_RECEIPT"].includes(origin.kind)||!["SYNTHESIS","REPLY_CLASSIFICATION"].includes(input.purpose))throw aiError("AI_CONTEXT_REQUIRED");
  if(Object.keys(origin).sort().join(",")!=="fence,id,kind")throw aiError("AI_REQUEST_INVALID");
  identifier(origin.id,256);boundInteger(origin.fence,1,2147483647);if(input.lead_id)identifier(input.lead_id,256);
  if((input.purpose==="SYNTHESIS" && (origin.kind!=="DOMAIN_EVENT"||!input.lead_id))||(input.purpose==="REPLY_CLASSIFICATION"&&origin.kind!=="INBOUND_RECEIPT"))throw aiError("AI_CONTEXT_REQUIRED");
  for(const field of ["provider","requested_model","pipeline_version","prompt_version","schema_version"])identifier(input[field]);
  if(!SHA.test(input.request_fingerprint)||!SHA.test(input.input_fingerprint))throw aiError("AI_REQUEST_INVALID");
  // Return holds from the transaction, so a UTC day already observed cannot be
  // undone by a later clock rollback. No domain artifact is written here.
  const result=await this.gate(org,async tx=>{
   const old=await tx.get("SELECT * FROM workspace_ai_controls WHERE organization_id=?",[org]), controls=parseControls(old),at=effectiveTime(old,this.now);
   await tx.run("INSERT INTO workspace_ai_controls (organization_id,revision,paused,max_daily_attempts,max_in_flight,pricing_json,budget_high_water_at,updated_at) VALUES (?,0,0,100,2,'[]',?,?) ON CONFLICT(organization_id) DO UPDATE SET budget_high_water_at=excluded.budget_high_water_at",[org,at,at]);
   await tx.run("UPDATE ai_provider_attempts SET request_state='UNCONFIRMED',outcome='RECOVERY_UNKNOWN',closed_at=?,usage_reason='NOT_REPORTED' WHERE organization_id=? AND request_state='ADMITTED' AND deadline_at<=?",[at,org,at]);
   const invocationKey=hash({organization_id:org,origin:{kind:origin.kind,id:origin.id,fence:origin.fence},purpose:input.purpose});
   if(await tx.get("SELECT id FROM ai_provider_attempts WHERE organization_id=? AND invocation_key=?",[org,invocationKey]))return {error:aiError("AI_INVOCATION_REPLAYED")};
   if(!await this.originCurrent(tx,input,at))return {error:aiError("AI_ORIGIN_STALE")};
   const counts=await tx.get("SELECT COUNT(*) AS count FROM ai_provider_attempts WHERE organization_id=? AND budget_day=?",[org,dayOf(at)]),active=await tx.get("SELECT COUNT(*) AS count FROM ai_provider_attempts WHERE organization_id=? AND request_state='ADMITTED'",[org]);
   const code=holdCode(controls,Number(counts.count),Number(active.count));if(code)return {error:aiError(code)};
   const token=randomBytes(32).toString("hex"),id="ai_"+randomUUID(),deadline=new Date(Date.parse(at)+15000).toISOString();
   const pricing=controls.pricing.find(rate=>rate.provider===input.provider&&rate.model===input.requested_model)||null;
   const attempt={id,organization_id:org,lead_id:input.lead_id||null,purpose:input.purpose,domain_event_id:origin.kind==="DOMAIN_EVENT"?origin.id:null,webhook_receipt_id:origin.kind==="INBOUND_RECEIPT"?origin.id:null,origin_fence:origin.fence,invocation_key:invocationKey,authorization_hash:hash(token),request_fingerprint:input.request_fingerprint,input_fingerprint:input.input_fingerprint,pipeline_version:input.pipeline_version,prompt_version:input.prompt_version,schema_version:input.schema_version,provider:input.provider,requested_model:input.requested_model,authorized_at:at,budget_day:dayOf(at),deadline_at:deadline,request_state:"ADMITTED",usage_status:"UNKNOWN",usage_reason:"NOT_REPORTED",pricing_revision:controls.revision,pricing_json:pricing?JSON.stringify(pricing):null,cost_status:"UNKNOWN"};
   const keys=Object.keys(attempt);await tx.run("INSERT INTO ai_provider_attempts ("+keys.join(",")+") VALUES ("+keys.map(()=>"?").join(",")+")",keys.map(key=>attempt[key]));
   return {attempt_id:id,authorization_token:token,admitted_at:at,request_deadline_at:deadline};
  });
  if(result.error)throw result.error;return result;
 }
 async originCurrent(tx,input,at) {
  const org=input.organization_id,origin=input.origin;
  if(input.lead_id){const lead=await tx.get("SELECT archived_at FROM leads WHERE organization_id=? AND id=?",[org,input.lead_id]);if(!lead||lead.archived_at)return false;}
  if(origin.kind==="INBOUND_RECEIPT"){
   const row=await tx.get("SELECT processing_state,processing_fence,lease_expires_at FROM webhook_receipts WHERE organization_id=? AND id=?",[org,origin.id]);
   return row?.processing_state==="PROCESSING"&&row.processing_fence===origin.fence&&Number.isFinite(Date.parse(row.lease_expires_at))&&Date.parse(row.lease_expires_at)>Date.parse(at);
  }
  const row=await tx.get("SELECT type,lead_id,status,processing_version,processing_hold_reason,processing_fence,lease_expires_at FROM domain_events WHERE organization_id=? AND id=?",[org,origin.id]);
  if(row?.status!=="PROCESSING"||row.processing_version!==1||row.processing_hold_reason||row.processing_fence!==origin.fence||row.lead_id!==input.lead_id||!Number.isFinite(Date.parse(row.lease_expires_at))||Date.parse(row.lease_expires_at)<=Date.parse(at))return false;
  if(row.type==="AnalysisRequested"){
   const job=await tx.get("SELECT j.cancelled_at,j.generation_json FROM analysis_job_items i JOIN analysis_jobs j ON j.organization_id=i.organization_id AND j.id=i.job_id WHERE i.organization_id=? AND i.event_id=? AND i.lead_id=?",[org,origin.id,input.lead_id]);
   if(!job||job.cancelled_at)return false;try{if(hash(JSON.parse(job.generation_json))!==hash(getGenerationDescriptor(this.db)))return false;}catch{return false;}
  }
  return true;
 }
 async observe({organization_id,attempt_id,authorization_token,observation}) {
  const org=identifier(organization_id,256);identifier(attempt_id,256);if(typeof authorization_token!=="string"||!SHA.test(authorization_token))throw aiError("AI_USAGE_INVALID");
  const safe=normalizeObservation(observation),digest=hash(safe);
  return this.gate(org,async tx=>{
   const row=await tx.get("SELECT * FROM ai_provider_attempts WHERE organization_id=? AND id=?",[org,attempt_id]);if(!row||row.authorization_hash!==hash(authorization_token))throw aiError("AI_USAGE_INVALID");
   if(row.observation_hash){if(row.observation_hash!==digest)throw aiError("AI_OBSERVATION_CONFLICT");return projectAttempt(row);}
   const at=[timestamp(this.now()),row.authorized_at].sort().at(-1),amount=estimateCost(row.pricing_json?JSON.parse(row.pricing_json):null,safe);
   const updated={...safe,request_state:"OBSERVED",cost_status:amount===null?"UNKNOWN":"ESTIMATED",cost_estimate_microusd:amount,observation_hash:digest,observed_at:at,closed_at:at};const keys=Object.keys(updated);
   await tx.run("UPDATE ai_provider_attempts SET "+keys.map(key=>key+"=?").join(",")+" WHERE organization_id=? AND id=?",[...keys.map(key=>updated[key]),org,attempt_id]);
   return projectAttempt({...row,...updated});
  });
 }
}

export function configureAiRuntime(db,{provider=null,now=Date.now}={}) {
 const generationDescriptor=registerGenerationDescriptor(db,createGenerationDescriptor(provider));
 const invocationService=new AiInvocationService(db,{now});
 if(!provider)return {provider:null,invocationService,generationDescriptor};
 const info=Object.freeze({provider:generationDescriptor.provider,model:generationDescriptor.model});
 const metered=Object.freeze({get info(){return info;},async jsonCompletion(request){
  const context=currentAiInvocationContext();if(!context)throw aiError("AI_CONTEXT_REQUIRED");
  if(provider.info?.provider!==info.provider||provider.info?.model!==info.model)throw aiError("AI_STATE_INVALID");
  let prepared;try{prepared=provider.prepareJsonRequest(request);}catch{throw aiError("AI_REQUEST_INVALID");}
  const descriptor=context.purpose==="SYNTHESIS"?generationDescriptor:{pipeline_version:REPLY_POLICY_VERSION,prompt_version:REPLY_PROMPT_VERSION,schema_version:"l3.02-reply-interpretation-v1"};
  let permit;try{permit=await invocationService.admit({...context,provider:info.provider,requested_model:info.model,pipeline_version:descriptor.pipeline_version,prompt_version:descriptor.prompt_version,schema_version:descriptor.schema_version,request_fingerprint:hash(prepared.encoded),input_fingerprint:context.input_fingerprint||hash(prepared.encoded)});}catch(error){if(isAiAdmissionError(error))throw error;throw aiError("AI_ACCOUNTING_UNAVAILABLE");}
  let result;try{result=await provider.completePreparedJson(prepared);}catch{result={error:"AI provider completion unavailable.",observation:{outcome:"TRANSPORT_UNCONFIRMED",usage:null,elapsed_ms:null}};}
  try{await invocationService.observe({organization_id:context.organization_id,...permit,observation:result.observation});}catch{throw aiError("AI_ACCOUNTING_UNAVAILABLE");}
  if(result.error)throw new Error(result.error);return result.value;
 }});
 return {provider:metered,invocationService,generationDescriptor};
}
