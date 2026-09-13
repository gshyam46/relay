import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { EmailConnectionRepository } from "../channels/emailConnectionRepository.js";
import { assessCurrentChannelCapability } from "../channels/channelCapability.js";
import { PreparedActionService } from "./preparedActionService.js";
import { ActionsRepository } from "./actionsRepository.js";
import { ApprovalsRepository } from "./approvalsRepository.js";
import { ApprovalsService } from "./approvalsService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ComposerRepository } from "./composerRepository.js";
import { COMPOSER_VERSION,composerError,composerHash,composerText,normalizeComposerCommand,publicComposerCommand } from "./composerContract.js";

export class ComposerService{
 constructor(db,{now=Date.now}={}){this.db=db;this.now=now;this.policy=new ContactPolicyService(db);}
 gate(input,work){
  const org=composerText(input.organization_id,"organization_id");
  return this.policy.withWorkspacePolicyTransaction(org,async tx=>{
   const actor=input.actor;
   if(!actor||actor.role!=="OWNER"||typeof actor.id!=="string")throw composerError("COMPOSER_OWNER_REQUIRED","A current workspace owner is required.",403);
   const user=await tx.get("SELECT id,role FROM users WHERE organization_id=? AND id=?",[org,actor.id]);
   if(!user||user.role!=="OWNER")throw composerError("COMPOSER_OWNER_REQUIRED","A current workspace owner is required.",403);
   return work(tx,org,user);
  });
 }
 get(input){return this.gate(input,(tx,org)=>this.inspect(tx,org,composerText(input.lead_id,"lead_id"),input.reply_to_message_id==null?null:composerText(input.reply_to_message_id,"reply_to_message_id")));}
 async inspect(tx,org,leadId,replyId){
  const repo=new ComposerRepository(tx),lead=await repo.lead(org,leadId);
  if(!lead)throw composerError("LEAD_NOT_FOUND","Lead not found.",404);
  if(Buffer.byteLength(JSON.stringify(lead),"utf8")>1048576)throw composerError("COMPOSER_SOURCE_LIMIT","This enquiry exceeds the supported composer inspection limit.",413);
  const config=await new EmailConnectionRepository(tx).settings(org);
  const capability=await assessCurrentChannelCapability(tx,{organization_id:org,action_type:"SEND_EMAIL",now:this.now});
  const policy=await this.policy.inspectLeadInTransaction(tx,{organization_id:org,lead_id:leadId,channel:"EMAIL"});
  const reply=await repo.reply(org,leadId,replyId),pending=await repo.pending(org,leadId);
  const prepared=new PreparedActionService(tx,{now:this.now}),draft={id:"composer-preview",organization_id:org,lead_id:leadId,type:"SEND_EMAIL",payload_json:JSON.stringify({subject:"Draft preview",message:"Draft preview"}),scheduled_at:null};
  let envelope=null,context=null,unavailable=lead.archived_at?"LEAD_ARCHIVED":capability.review_hold_code;
  if(!unavailable){
   try{const inputs=await prepared.inputs(draft);context=prepared.contextFingerprint(draft,inputs.lead,inputs.businessContextRevisions,inputs.freshness);envelope=prepared.buildEnvelope(draft,inputs.lead,inputs.channelConfig);}
   catch(error){if(!["RECIPIENT_UNAVAILABLE","SENDER_UNAVAILABLE"].includes(error.code))throw error;unavailable=error.code;}
  }
  if(!unavailable&&pending.total>=1000)unavailable="COMPOSER_PENDING_LIMIT";
  if(!unavailable&&policy.restricted)unavailable=policy.reason||"CONTACT_RESTRICTED";
  if(!unavailable&&policy.policy_pending)unavailable="CONTACT_POLICY_PENDING";
  const token=unavailable?null:composerHash({version:COMPOSER_VERSION,organization_id:org,lead_id:leadId,lead,config,context,reply,pending:pending.rows,policy});
  return {lead:{id:lead.id,name:String(lead.name||"").slice(0,200)},channel:"EMAIL",review_token:token,recipient:envelope?.recipient||null,sender:envelope?.sender||null,
   configuration:{can_review:capability.can_review,can_dispatch:capability.can_dispatch,hold_code:capability.dispatch_hold_code,reason:capability.dispatch_hold_code?"Saved channel setup does not authorize live delivery.":null},
   contact_policy:{restricted:policy.restricted,policy_pending:policy.policy_pending,reason:policy.reason},
   reply_to_message:reply?{id:reply.id,subject:reply.subject,body:reply.body,occurred_at:reply.occurred_at}:null,
   pending_actions:pending.publicRows,pending_total:pending.total,pending_truncated:pending.total>20,can_create:!unavailable,unavailable_reason:unavailable};
 }
 async create(input){
  const command=normalizeComposerCommand(input,"CREATE");
  return this.gate(input,async(tx,org,actor)=>{
   const repo=new ComposerRepository(tx),hash=composerHash(command),existing=await repo.byRequest(org,command.request_key);
   if(existing)return this.replay(tx,existing,hash);
   const view=await this.inspect(tx,org,command.lead_id,command.reply_to_message_id);
   if(!view.can_create)throw composerError(view.unavailable_reason,"This enquiry is currently unavailable for a new message.");
   if(command.review_token!==view.review_token)throw composerError("COMPOSER_REVIEW_STALE","Recipient, sender, context or pending messages changed. Review the current composer.");
   if(view.pending_total&&!command.acknowledge_pending)throw composerError("COMPOSER_PENDING_ACK_REQUIRED","Review and acknowledge the existing email actions before creating another message.");
   const actions=new ActionsRepository(tx),action=await actions.createAction({organization_id:org,lead_id:command.lead_id,type:"SEND_EMAIL",status:"AWAITING_APPROVAL",approval_requirement:"REQUIRED",scheduled_at:command.scheduled_at,
    idempotency_key:"composer:"+org+":"+composerHash(command.request_key),payload:{source:"MANUAL_COMPOSER",message_kind:command.kind,reply_to_message_id:command.reply_to_message_id,subject:command.subject,message:command.body}});
   const detail=await this.approvals(tx).currentForAction({organization_id:org,action_id:action.id});
   return this.record(tx,org,actor,command,hash,action,detail.prepared_revision.id,command.kind,command.reply_to_message_id);
  });
 }
 async edit(input){
  const command=normalizeComposerCommand(input,"EDIT");
  return this.gate(input,async(tx,org,actor)=>{
   const repo=new ComposerRepository(tx),hash=composerHash(command),existing=await repo.byRequest(org,command.request_key);
   if(existing)return this.replay(tx,existing,hash);
   await repo.assertActionSize(org,command.action_id);
   const action=await new ActionsRepository(tx).getActionForUpdate(command.action_id,org);
   if(!action)throw composerError("ACTION_NOT_FOUND","Action not found.",404);
   if(action.type!=="SEND_EMAIL")throw composerError("COMPOSER_UNSUPPORTED_ACTION","The shared composer currently supports email.",400);
   if(!["PLANNED","AWAITING_APPROVAL","APPROVED"].includes(action.status)||action.first_dispatch_at||await tx.get("SELECT id FROM action_executions WHERE action_id=? LIMIT 1",[action.id]))throw composerError("COMPOSER_ACTION_STARTED","Use execution recovery for attempted or terminal work.");
   await repo.lead(org,action.lead_id);
   if(action.current_revision_id)await repo.revision(org,action.id,action.current_revision_id);
   const policy=await this.policy.inspectLeadInTransaction(tx,{organization_id:org,lead_id:action.lead_id,channel:"EMAIL"});
   if(policy.restricted||policy.policy_pending)throw composerError(policy.reason||"CONTACT_RESTRICTED","Current contact policy holds this draft.");
   const detail=await this.approvals(tx).previewAction({organization_id:org,action_id:action.id,expected_revision_id:command.expected_revision_id,edited_payload:{subject:command.subject,body:command.body},scheduled_at:command.scheduled_at});
   const origin=await repo.origin(org,action.id);
   return this.record(tx,org,actor,command,hash,action,detail.prepared_revision.id,origin?.message_kind||"NEW_MESSAGE",origin?.reply_to_message_id||null);
  });
 }
 approvals(tx){return new ApprovalsService({actionsRepository:new ActionsRepository(tx),approvalsRepository:new ApprovalsRepository(tx),auditRepository:new AuditRepository(tx)});}
 async record(tx,org,actor,command,hash,action,revisionId,kind,replyId){
  const row={id:createId("cmp"),organization_id:org,lead_id:action.lead_id,action_id:action.id,operation:command.operation,request_key:command.request_key,request_hash:hash,expected_revision_id:command.expected_revision_id||null,resulting_revision_id:revisionId,message_kind:kind,reply_to_message_id:replyId,reason:command.reason,created_at:new Date(this.now()).toISOString(),created_by:actor.id};
  await new ComposerRepository(tx).append(row);
  await new AuditRepository(tx).record({organization_id:org,lead_id:action.lead_id,action_id:action.id,event_type:"ActionComposed",message:"Owner saved an exact message draft for separate approval.",metadata:{command_id:row.id,operation:row.operation,revision_id:revisionId,actor_id:actor.id}});
  return {...await this.result(tx,row),replayed:false};
 }
 async result(tx,row){
  const raw=await new ComposerRepository(tx).revision(row.organization_id,row.action_id,row.resulting_revision_id);
  let revision;try{revision=new PreparedActionService(tx).publicRevision(raw);}catch{throw composerError("COMPOSER_STATE_INVALID","The recorded draft requires operational review.",503);}
  if(composerHash(revision.envelope)!==revision.content_hash||revision.envelope.action_id!==row.action_id||revision.envelope.organization_id!==row.organization_id)throw composerError("COMPOSER_STATE_INVALID","The recorded draft cannot be verified.",503);
  return {command:publicComposerCommand(row),prepared_revision:revision};
 }
 async replay(tx,row,hash){if(row.request_hash!==hash)throw composerError("COMPOSER_REQUEST_CONFLICT","That request key already identifies different composer work.");return {...await this.result(tx,row),replayed:true};}
 byRequestKey(input){const key=composerText(input.request_key,"request_key");return this.gate(input,async(tx,org)=>{const row=await new ComposerRepository(tx).byRequest(org,key);return row?this.result(tx,row):{command:null,prepared_revision:null};});}
}
