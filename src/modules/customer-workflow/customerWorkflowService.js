import { publicReplyInterpretation } from "../channels/replyInterpretationView.js";
import { createId } from "../../shared/ids.js";
import { csvCell,serializeCsv } from "../../shared/csv.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { FollowUpsRepository } from "../channels/followUpsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { CustomerWorkflowRepository,sqlBytes } from "./customerWorkflowRepository.js";
import { workflowError,workflowHash,text,optionalText,exact,integer,paging,time,command,normalizeOutcome,outcomeSlot,encode,publicTask,publicConversationRevision,publicFollowUpCommand,publicOutcome } from "./customerWorkflowContract.js";
const SCOPE=["organization_id","lead_id","actor"];
export class CustomerWorkflowService{
 constructor(db,{now=Date.now}={}){this.db=db;this.now=now;this.policy=new ContactPolicyService(db);}
 timestamp(){return new Date(this.now()).toISOString();}
 async workspace(input,work){
  const org=text(input.organization_id,"organization_id");
  return this.policy.withWorkspacePolicyTransaction(org,async tx=>{
   const actor=input.actor;
   if(!actor||actor.role!=="OWNER"||!await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'",[org,actor.id]))throw workflowError("CUSTOMER_WORKFLOW_OWNER_REQUIRED","A current workspace owner is required.",403);
   return work(tx,org,actor,new CustomerWorkflowRepository(tx));
  });
 }
 async state(tx,org,lead,repo){
  const head=await repo.headConversation(org,lead.id),inbound=await repo.inbound(org,lead.id),policy=await this.policy.inspectLeadInTransaction(tx,{organization_id:org,lead_id:lead.id,channel:"EMAIL"});
  const status=head?.status||"OPEN",effective=status==="RESOLVED"&&head.resolved_inbound_token!==inbound.token?"OPEN":status;
  const unread=Boolean(head?.forced_unread)||(inbound.count>0&&head?.read_inbound_token!==inbound.token);
  const attention=lead.archived_at?"ARCHIVED":policy.reason==="CONTACT_UNRESOLVED"?"CONTACT_UNRESOLVED":policy.restricted?"CONTACT_RESTRICTED":policy.policy_pending?"CONTACT_POLICY_PENDING":effective==="ESCALATED"?"ESCALATED":effective==="RESOLVED"?"RESOLVED":!inbound.count?"OPEN":["QUESTION","POSITIVE_REPLY"].includes(inbound.last?.event_type)?"NEEDS_REPLY":"NEEDS_REVIEW";
  const review_token=workflowHash({version:"conversation-v1",lead,revision:head?.revision||0,inbound:inbound.token,policy});
  return {head,inbound,conversation:{revision:head?.revision||0,status,effective_status:effective,read_state:unread?"UNREAD":"READ",assigned_owner_id:head?.assigned_owner_id||null,last_inbound_message_id:inbound.last?.id||null,inbound_count:inbound.count,attention,review_token}};
 }
 async listConversationMessages(input){
  const page=paging(input),max=4194304;
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const lead=await repo.lead(org,text(input.lead_id,"lead_id")),rows=await repo.messagePage(org,lead.id,page.after,page.limit),messages=[];
   let bytes=2048,stopped=false;
   for(const meta of rows.slice(0,page.limit)){
    if(typeof meta.id!=="string"||meta.id.length>200||Number(meta.content_bytes)>262144)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","This message exceeds the supported original-content inspection limit.",413);
    const row=await repo.message(org,lead.id,meta.id);let payload=null,metadata_unavailable=row.payload_json===null;
    if(row.payload_json!==null){try{payload=JSON.parse(row.payload_json);if(!payload||typeof payload!=="object"||Array.isArray(payload))metadata_unavailable=true;}catch{metadata_unavailable=true;}}
    let interpretation;try{interpretation=publicReplyInterpretation({...row,payload:metadata_unavailable?null:payload});}catch{metadata_unavailable=true;interpretation=publicReplyInterpretation({...row,payload:null});}
    const item={...Object.fromEntries(["id","lead_id","action_id","inbound_event_id","direction","channel","status","subject","body","occurred_at","created_at"].map(key=>[key,row[key]])),classification_event_type:interpretation?.event_type||null,classification_confidence:interpretation?.confidence||null,interpretation,metadata_unavailable};
    const size=Buffer.byteLength(JSON.stringify(item),"utf8")+1;
    if(bytes+size>max){stopped=true;break;}bytes+=size;messages.push(item);
   }
   const has_more=stopped||rows.length>page.limit;
   return {messages,has_more,next_after_id:has_more?messages.at(-1)?.id||null:null,limit:page.limit,byte_limit:max};
  });
 }
 async getConversation(input){
  const page=paging(input);return this.workspace(input,async(tx,org,actor,repo)=>{
   const lead=await repo.lead(org,text(input.lead_id,"lead_id")),state=await this.state(tx,org,lead,repo),rows=await repo.historyConversation(org,lead.id,page.before,page.limit);
   return {conversation:state.conversation,history:history(rows,page.limit,publicConversationRevision)};
  });
 }
 async saveConversation(input){
  exact(input,[...SCOPE,"request_key","expected_revision","review_token","status","read_state","assigned_owner_id","reason"]);
  const cmd={...command(input,"SAVE"),lead_id:text(input.lead_id,"lead_id"),expected_revision:integer(input.expected_revision,"expected_revision"),review_token:text(input.review_token,"review_token",64),status:input.status,read_state:input.read_state,assigned_owner_id:optionalText(input.assigned_owner_id,"assigned_owner_id")};
  if(!["OPEN","RESOLVED","ESCALATED"].includes(cmd.status)||!["KEEP","READ","UNREAD"].includes(cmd.read_state))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Choose a supported conversation state and explicit read operation.",400);
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const hash=workflowHash(cmd),prior=await repo.byRequest("CONVERSATION",org,cmd.request_key);
   if(prior)return this.replay(tx,repo,"CONVERSATION",prior,hash);
   if(cmd.assigned_owner_id!==null&&cmd.assigned_owner_id!==actor.id)throw workflowError("CUSTOMER_WORKFLOW_ASSIGNMENT_INVALID","Assign to the current owner or leave unassigned.",400);
   const lead=await repo.lead(org,cmd.lead_id),state=await this.state(tx,org,lead,repo);
   if(cmd.expected_revision!==state.conversation.revision)throw workflowError("CUSTOMER_WORKFLOW_REVISION_STALE","Conversation state changed. Review its latest state.");
   if(cmd.review_token!==state.conversation.review_token)throw workflowError("CUSTOMER_WORKFLOW_REVIEW_STALE","Inbound messages or enquiry state changed. Review the latest conversation.");
   const row={id:createId("conv"),organization_id:org,lead_id:lead.id,revision:cmd.expected_revision+1,expected_revision:cmd.expected_revision,status:cmd.status,assigned_owner_id:cmd.assigned_owner_id,
    read_inbound_token:cmd.read_state==="READ"?state.inbound.token:state.head?.read_inbound_token||null,resolved_inbound_token:cmd.status==="RESOLVED"?state.inbound.token:null,
    forced_unread:cmd.read_state==="UNREAD"?1:cmd.read_state==="READ"?0:state.head?.forced_unread||0,observed_inbound_token:state.inbound.token,inbound_count:state.inbound.count,last_inbound_message_id:state.inbound.last?.id||null,
    request_key:cmd.request_key,request_hash:hash,reason:cmd.reason,created_at:this.timestamp(),created_by:actor.id};
   await repo.append("conversation_revisions",row);await this.audit(tx,org,lead.id,"ConversationReviewed",actor,cmd,{revision:row.revision,change_id:row.id});
   return {change:publicConversationRevision(row),replayed:false};
  });
 }
 async listConversations(input){
  const page=paging(input),after=input.after_lead_id==null?null:text(input.after_lead_id,"after_lead_id");
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const rows=await tx.all("SELECT id FROM leads WHERE organization_id=? AND archived_at IS NULL"+(after===null?"":" AND id>?")+" ORDER BY id LIMIT ?",[org,...(after===null?[]:[after]),page.limit+1]),conversations=[];
   for(const row of rows.slice(0,page.limit)){const lead=await repo.lead(org,row.id);conversations.push({lead:{id:lead.id,name:lead.name},conversation:(await this.state(tx,org,lead,repo)).conversation});}
   return {conversations,has_more:rows.length>page.limit,next_after_lead_id:rows.length>page.limit?conversations.at(-1).lead.id:null,limit:page.limit};
  });
 }
 async listFollowUps(input){
  const page=paging(input);return this.workspace(input,async(tx,org,actor,repo)=>{
   const lead=await repo.lead(org,text(input.lead_id,"lead_id")),rows=await tx.all("SELECT id FROM follow_up_tasks WHERE organization_id=? AND lead_id=?"+(page.after===null?"":" AND id>?")+" ORDER BY id LIMIT ?",[org,lead.id,...(page.after===null?[]:[page.after]),page.limit+1]),follow_ups=[];
   for(const row of rows.slice(0,page.limit))follow_ups.push(publicTask(await repo.task(org,row.id)));
   return {follow_ups,review_token:repo.leadToken(lead),has_more:rows.length>page.limit,next_after_id:rows.length>page.limit?follow_ups.at(-1).id:null,limit:page.limit};
  });
 }
 async createFollowUp(input){
  exact(input,[...SCOPE,"request_key","review_token","due_at","reason","reply_to_message_id"]);
  const cmd={...command(input,"CREATE"),lead_id:text(input.lead_id,"lead_id"),review_token:text(input.review_token,"review_token",64),due_at:time(input.due_at),reply_to_message_id:optionalText(input.reply_to_message_id,"reply_to_message_id")};
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const hash=workflowHash(cmd),prior=await repo.byRequest("FOLLOW_UP",org,cmd.request_key);if(prior)return this.replay(tx,repo,"FOLLOW_UP",prior,hash);
   const lead=await repo.lead(org,cmd.lead_id);assertActive(lead);this.requireLeadToken(repo,lead,cmd.review_token);
   const message=await repo.canonicalMessage(org,lead.id,cmd.reply_to_message_id),task=await new FollowUpsRepository(tx).create({organization_id:org,lead_id:lead.id,inbound_event_id:message?.inbound_event_id||null,channel:"HUMAN_TASK",status:cmd.due_at<=this.timestamp()?"DUE":"PLANNED",due_at:cmd.due_at,reason:cmd.reason,idempotency_key:"manual-reminder:"+org+":"+workflowHash(cmd.request_key)});
   return this.recordFollowUp(tx,org,actor,repo,cmd,hash,null,task);
  });
 }
 async changeFollowUp(input){
  exact(input,["organization_id","actor","follow_up_id","request_key","expected_task_token","operation","due_at","reason"]);
  const cmd={...command(input,input.operation),follow_up_id:text(input.follow_up_id,"follow_up_id"),expected_task_token:text(input.expected_task_token,"expected_task_token",64),due_at:input.operation==="RESCHEDULE"?time(input.due_at):null};
  if(!["RESCHEDULE","COMPLETE","CANCEL"].includes(cmd.operation)||(cmd.operation!=="RESCHEDULE"&&input.due_at!==null))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Choose a supported follow-up operation.",400);
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const hash=workflowHash(cmd),prior=await repo.byRequest("FOLLOW_UP",org,cmd.request_key);if(prior)return this.replay(tx,repo,"FOLLOW_UP",prior,hash);
   const before=await repo.task(org,cmd.follow_up_id),lead=await repo.lead(org,before.lead_id);
   if(workflowHash(before)!==cmd.expected_task_token)throw workflowError("CUSTOMER_WORKFLOW_TASK_STALE","The follow-up changed. Review its latest state.");
   let after;
   if(cmd.operation==="RESCHEDULE"){
    assertActive(lead);if(!publicTask(before).can_reschedule)throw workflowError("FOLLOW_UP_STATE_CONFLICT","This task cannot be rescheduled; automatic timers and terminal history keep their original basis.");
    await tx.run("UPDATE follow_up_tasks SET due_at=?,status=?,updated_at=? WHERE organization_id=? AND id=?",[cmd.due_at,cmd.due_at<=this.timestamp()?"DUE":"PLANNED",this.timestamp(),org,before.id]);after=await repo.task(org,before.id);
   }else after=await new FollowUpsRepository(tx)[cmd.operation==="COMPLETE"?"complete":"cancel"](before.id,org);
   return this.recordFollowUp(tx,org,actor,repo,cmd,hash,before,after);
  });
 }
 async recordFollowUp(tx,org,actor,repo,cmd,hash,before,after){
  const row={id:createId("fuc"),organization_id:org,lead_id:after.lead_id,follow_up_id:after.id,operation:cmd.operation,expected_task_token:cmd.expected_task_token||null,request_key:cmd.request_key,request_hash:hash,before_json:before?encode(before):null,after_json:encode(after),reason:cmd.reason,created_at:this.timestamp(),created_by:actor.id};
  await repo.append("follow_up_commands",row);await this.audit(tx,org,after.lead_id,"HumanFollowUpChanged",actor,cmd,{change_id:row.id,follow_up_id:after.id,operation:cmd.operation});
  return {change:publicFollowUpCommand(row),replayed:false};
 }
 async listOutcomes(input){
  const page=paging(input);return this.workspace(input,async(tx,org,actor,repo)=>{
   const lead=await repo.lead(org,text(input.lead_id,"lead_id")),rows=await tx.all("SELECT id,slot FROM business_outcomes WHERE organization_id=? AND lead_id=?"+(page.after===null?"":" AND id>?")+" ORDER BY id LIMIT ?",[org,lead.id,...(page.after===null?[]:[page.after]),page.limit+1]),outcomes=[];
   for(const row of rows.slice(0,page.limit))outcomes.push(publicOutcome(await repo.headOutcome(org,row.id),row.slot));
   return {outcomes,review_token:repo.leadToken(lead),has_more:rows.length>page.limit,next_after_id:rows.length>page.limit?outcomes.at(-1).id:null,limit:page.limit};
  });
 }
 async getOutcome(input){
  const page=paging(input);return this.workspace(input,async(tx,org,actor,repo)=>{
   const parent=await repo.outcome(org,text(input.outcome_id,"outcome_id"));if(!parent||(input.lead_id&&parent.lead_id!==input.lead_id))throw workflowError("OUTCOME_NOT_FOUND","Outcome not found.",404);
   const lead=await repo.lead(org,parent.lead_id),head=await repo.headOutcome(org,parent.id),rows=await repo.historyOutcome(org,parent.id,page.before,page.limit);
   return {outcome:publicOutcome(head,parent.slot),review_token:repo.leadToken(lead),history:history(rows,page.limit,row=>publicOutcome(row,parent.slot))};
  });
 }
 async saveOutcome(input){
  exact(input,[...SCOPE,"outcome_id","expected_revision","review_token","request_key","status","values","reason"]);
  const cmd={...command(input,"SAVE"),lead_id:text(input.lead_id,"lead_id"),outcome_id:optionalText(input.outcome_id,"outcome_id"),expected_revision:integer(input.expected_revision,"expected_revision"),review_token:text(input.review_token,"review_token",64),status:input.status,values:normalizeOutcome(input.values,this.now())};
  if(!["RECORDED","WITHDRAWN"].includes(cmd.status))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Choose recorded or withdrawn.",400);
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const hash=workflowHash(cmd),prior=await repo.byRequest("OUTCOME",org,cmd.request_key);if(prior)return this.replay(tx,repo,"OUTCOME",prior,hash);
   if(cmd.values.occurred_at>this.timestamp())throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","The outcome occurrence cannot be in the future.",400);
   const lead=await repo.lead(org,cmd.lead_id);this.requireLeadToken(repo,lead,cmd.review_token);
   const slot=outcomeSlot(cmd.values.kind);let parent=cmd.outcome_id?await repo.outcome(org,cmd.outcome_id):null;
   if(cmd.outcome_id&&(!parent||parent.lead_id!==lead.id))throw workflowError("OUTCOME_NOT_FOUND","Outcome not found.",404);
   if(parent&&parent.slot!==slot)throw workflowError("OUTCOME_SLOT_CONFLICT","Correct the matching milestone rather than changing its identity.");
   if(!parent&&await repo.outcomeSlot(org,lead.id,slot))throw workflowError("OUTCOME_SLOT_CONFLICT","This enquiry already has that milestone. Correct or restore its existing record.");
   const head=parent?await repo.headOutcome(org,parent.id):null;
   if((head?.revision||0)!==cmd.expected_revision)throw workflowError("CUSTOMER_WORKFLOW_REVISION_STALE","The outcome changed. Review its latest revision.");
   if(!parent&&cmd.status!=="RECORDED")throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Record an outcome before withdrawing it.",400);
   await repo.canonicalMessage(org,lead.id,cmd.values.evidence_message_id);
   if(cmd.values.attributed_action_id&&!await tx.get("SELECT id FROM actions WHERE organization_id=? AND lead_id=? AND id=?",[org,lead.id,cmd.values.attributed_action_id]))throw workflowError("CUSTOMER_WORKFLOW_ACTION_UNAVAILABLE","Attribute only an action belonging to this enquiry.",404);
   if(!parent){parent={id:createId("out"),organization_id:org,lead_id:lead.id,slot,created_at:this.timestamp(),created_by:actor.id};await repo.append("business_outcomes",parent);}
   const row={id:createId("outr"),organization_id:org,lead_id:lead.id,outcome_id:parent.id,revision:cmd.expected_revision+1,expected_revision:cmd.expected_revision,status:cmd.status,...Object.fromEntries(Object.entries(cmd.values).filter(([key])=>key!=="amount")),amount_json:cmd.values.amount?encode(cmd.values.amount,1024):null,request_key:cmd.request_key,request_hash:hash,reason:cmd.reason,created_at:this.timestamp(),created_by:actor.id};
   await repo.append("business_outcome_revisions",row);await this.audit(tx,org,lead.id,"BusinessOutcomeRecorded",actor,cmd,{change_id:row.id,outcome_id:parent.id,revision:row.revision,slot,kind:row.kind,status:row.status,attribution:"OWNER_REPORTED"});
   return {change:publicOutcome(row,slot),replayed:false};
  });
 }
 requireLeadToken(repo,lead,token){if(repo.leadToken(lead)!==token)throw workflowError("CUSTOMER_WORKFLOW_REVIEW_STALE","The enquiry changed. Review its current state.");}
 async audit(tx,org,lead,event,actor,cmd,metadata){await new AuditRepository(tx).record({organization_id:org,lead_id:lead,event_type:event,message:"Owner recorded a customer workflow decision.",metadata:{...metadata,actor_id:actor.id,reason:cmd.reason}});}
 async replay(tx,repo,kind,row,hash){if(row.request_hash!==hash)throw workflowError("CUSTOMER_WORKFLOW_REQUEST_CONFLICT","This request key already identifies different work.");return {change:await this.change(repo,kind,row),replayed:true};}
 async change(repo,kind,row){return kind==="CONVERSATION"?publicConversationRevision(row):kind==="FOLLOW_UP"?publicFollowUpCommand(row):publicOutcome(row,(await repo.outcome(row.organization_id,row.outcome_id)).slot);}
 async byRequestKey(input){const key=text(input.request_key,"request_key");return this.workspace(input,async(tx,org,actor,repo)=>{const row=await repo.byRequest(input.kind,org,key);return {change:row?await this.change(repo,input.kind,row):null};});}
 async exportOutcomes(input){
  exact(input,["organization_id","actor","outcome_ids"]);
  if(!Array.isArray(input.outcome_ids)||!input.outcome_ids.length||input.outcome_ids.length>1000||new Set(input.outcome_ids).size!==input.outcome_ids.length)throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Select 1 to 1000 distinct outcomes explicitly.",400);
  const ids=input.outcome_ids.map(id=>text(id,"outcome_id")).sort(),max=8388608;
  return this.workspace(input,async(tx,org,actor,repo)=>{
   const rows=await tx.all("SELECT p.id,p.lead_id,p.slot,r.id revision_id,"+["r.summary","r.source_reference","r.attribution_note","r.reason","r.amount_json"].map(c=>sqlBytes(tx,c)).join("+")+" bytes FROM business_outcomes p JOIN business_outcome_revisions r ON r.organization_id=p.organization_id AND r.outcome_id=p.id AND r.revision=(SELECT MAX(rr.revision) FROM business_outcome_revisions rr WHERE rr.organization_id=p.organization_id AND rr.outcome_id=p.id) WHERE p.organization_id=? AND p.id IN("+ids.map(()=>"?").join(",")+")",[org,...ids]);
   if(rows.length!==ids.length)throw workflowError("OUTCOME_NOT_FOUND","Every selected outcome must belong to this workspace.",404);
   if(rows.reduce((sum,row)=>sum+Number(row.bytes),0)>max)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","Selected outcome export exceeds 8 MiB. Select fewer records.",413);
   const headers=["outcome_id","lead_id","slot","revision","status","kind","occurred_at","summary","source_reference","evidence_message_id","attributed_action_id","attribution_note","amount_currency","amount_minor_units_exact","amount_json","outcome_json","recorded_by","recorded_at"],generated_at=this.timestamp();
   let csv=serializeCsv(headers,[]),bytes=Buffer.byteLength(csv,"utf8");
   for(const id of ids){
    const row=rows.find(item=>item.id===id),result=publicOutcome(await repo.headOutcome(org,id),row.slot),v=result.values,amount=v.amount;
    const cells=[id,result.lead_id,result.slot,String(result.revision),result.status,v.kind,v.occurred_at,v.summary,v.source_reference,v.evidence_message_id,v.attributed_action_id,v.attribution_note,amount?.currency||"",amount?.minor_units||"",JSON.stringify(amount?{...amount}:{amount:null}),JSON.stringify({source:"OWNER_REPORTED",amount_meaning:"REPORTED_DEAL_VALUE_NOT_REVENUE",...result}),result.created_by,result.created_at],line=cells.map(csvCell).join(",")+"\r\n";
    bytes+=Buffer.byteLength(line,"utf8");if(bytes>max)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","Selected outcome export exceeds 8 MiB. Select fewer records.",413);csv+=line;
   }
   await new AuditRepository(tx).record({organization_id:org,event_type:"BusinessOutcomesExported",message:"Owner exported explicit recorded business outcome facts.",metadata:{actor_id:actor.id,row_count:ids.length,selection_fingerprint:workflowHash(rows.map(row=>[row.id,row.revision_id])),generated_at}});
   return {csv_text:csv,filename:"business-outcomes.csv",row_count:ids.length,generated_at};
  });
 }
}
function assertActive(lead){if(lead.archived_at)throw workflowError("LEAD_ARCHIVED","Restore this enquiry before creating or rescheduling work.");}
function history(rows,limit,project){const changes=rows.slice(0,limit).map(project),has_more=rows.length>limit;return {changes,has_more,next_before_revision:has_more?changes.at(-1).revision:null};}
