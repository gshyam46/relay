import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { ComposerService } from "../src/modules/outbound-automation/composerService.js";
import { ComposerRepository } from "../src/modules/outbound-automation/composerRepository.js";
import { ActionsRepository } from "../src/modules/outbound-automation/actionsRepository.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { createApprovalUnitOfWork } from "../src/modules/outbound-automation/approvalUnitOfWork.js";
import { ApprovalsService } from "../src/modules/outbound-automation/approvalsService.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { SettingsRepository } from "../src/modules/settings/settingsRepository.js";
import { InboundEventsRepository } from "../src/modules/channels/inboundEventsRepository.js";
import { ChannelMessagesRepository } from "../src/modules/channels/channelMessagesRepository.js";

async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());
 const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Synthetic composer"}),actor={id:"owner-"+org.id,role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Owner",actor.id+"@example.test","synthetic-only",new Date().toISOString()]);
 const lead=await leads.createLead({organization_id:org.id,name:"Synthetic customer",email:"customer@example.test",source:"MANUAL"});
 const service=new ComposerService(db),scope={organization_id:org.id,lead_id:lead.id,actor},approvals=new ApprovalsService({unitOfWork:createApprovalUnitOfWork(db),actionsRepository:new ActionsRepository(db)});
 const command=async(extra={})=>({...scope,request_key:"draft-1",review_token:(await service.get({...scope,reply_to_message_id:extra.reply_to_message_id})).review_token,acknowledge_pending:false,kind:"NEW_MESSAGE",reply_to_message_id:null,reason:"Owner composed a new message.",subject:"A useful question",body:"Can we discuss your requirements?",scheduled_at:null,...extra});
 const count=async(table)=>Number((await db.get("SELECT count(*) n FROM "+table)).n);
 return {db,leads,org,actor,lead,service,scope,command,count,approvals};
}
async function incoming(f,extra={}){
 const canonical=await new InboundEventsRepository(f.db).create({organization_id:f.org.id,lead_id:f.lead.id,channel:"EMAIL",provider:"sandbox",provider_event_id:"incoming-1",event_type:"QUESTION",payload:{text:"What times are available?"},...extra});
 return new ChannelMessagesRepository(f.db).create({organization_id:f.org.id,lead_id:f.lead.id,inbound_event_id:canonical.inbound_event.id,direction:"INBOUND",channel:"EMAIL",status:"RECEIVED",subject:"Question",body:"What times are available?",idempotency_key:"incoming-message-1"});
}
test("composer reads are read-only and a real draft is exact, approval-required and never dispatched",async t=>{
 const f=await fixture(t),before=await f.count("audit_logs"),view=await f.service.get(f.scope);
 assert.equal(view.can_create,true);assert.equal(view.recipient,"customer@example.test");assert.equal(view.pending_total,0);
 assert.equal(await f.count("actions"),0);assert.equal(await f.count("action_revisions"),0);assert.equal(await f.count("audit_logs"),before);
 const saved=await f.service.create(await f.command({body:"Human authored\nexact content."}));
 assert.equal(saved.prepared_revision.envelope.body,"Human authored\nexact content.");assert.equal(saved.prepared_revision.envelope.subject,"A useful question");
 const action=await new ActionsRepository(f.db).getAction(saved.command.action_id);
 assert.equal(action.status,"AWAITING_APPROVAL");assert.equal(action.approval_requirement,"REQUIRED");
 assert.equal(await f.count("action_composer_commands"),1);assert.equal(await f.count("action_approvals"),1);assert.equal(await f.count("action_revision_decisions"),0);assert.equal(await f.count("action_executions"),0);assert.equal(await f.count("channel_messages"),0);
});
test("same request races create one action; new message requires fresh pending acknowledgement and a distinct identity",async t=>{
 const f=await fixture(t),cmd=await f.command(),results=await Promise.all([f.service.create(cmd),f.service.create(cmd)]);
 assert.equal(results[0].command.action_id,results[1].command.action_id);assert.equal(results.filter(x=>x.replayed).length,1);assert.equal(await f.count("actions"),1);
 await assert.rejects(f.service.create({...cmd,body:"Different intent"}),{code:"COMPOSER_REQUEST_CONFLICT"});
 await assert.rejects(f.service.create({...cmd,request_key:"new",acknowledge_pending:true}),{code:"COMPOSER_REVIEW_STALE"});
 const second=await f.command({request_key:"new"});
 await assert.rejects(f.service.create(second),{code:"COMPOSER_PENDING_ACK_REQUIRED"});
 const accepted=await f.service.create({...second,acknowledge_pending:true});assert.notEqual(accepted.command.action_id,results[0].command.action_id);assert.equal(await f.count("actions"),2);
});
test("lead and private sender changes invalidate composer review without creating work",async t=>{
 const f=await fixture(t),cmd=await f.command();
 await f.db.run("UPDATE leads SET company=? WHERE id=?",["Changed business",f.lead.id]);
 await assert.rejects(f.service.create(cmd),{code:"COMPOSER_REVIEW_STALE"});
 const changed=await f.command();
 await new SettingsRepository(f.db).setBulk(f.org.id,"channel_email",{provider:"sandbox",api_key:"synthetic-change"});
 await assert.rejects(f.service.create(changed),{code:"COMPOSER_REVIEW_STALE"});assert.equal(await f.count("actions"),0);
});
test("owner and tenant authority are rechecked for reads, edits and original-request recovery",async t=>{
 const f=await fixture(t),cmd=await f.command(),saved=await f.service.create(cmd),foreign=await f.leads.createOrganization({name:"Foreign"});
 await assert.rejects(f.service.get({...f.scope,organization_id:foreign.id}),{code:"COMPOSER_OWNER_REQUIRED"});
 await assert.rejects(f.service.create({...cmd,actor:{...f.actor,role:"MEMBER"}}),{code:"COMPOSER_OWNER_REQUIRED"});
 await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.actor.id]);
 await assert.rejects(f.service.byRequestKey({...f.scope,request_key:cmd.request_key}),{code:"COMPOSER_OWNER_REQUIRED"});
 assert.equal(await f.count("action_composer_commands"),1);assert.ok(saved.command.action_id);
});
test("scheduled edits invalidate approval atomically and exact retry recovers the original revision after later edits",async t=>{
 const f=await fixture(t),firstCmd=await f.command(),first=await f.service.create(firstCmd),actionId=first.command.action_id;
 await f.approvals.approveAction({organization_id:f.org.id,action_id:actionId,expected_revision_id:first.prepared_revision.id,reviewer_user_id:f.actor.id});
 const edit={organization_id:f.org.id,actor:f.actor,action_id:actionId,request_key:"edit-1",expected_revision_id:first.prepared_revision.id,reason:"Schedule the reviewed message.",subject:"Edited subject",body:"Edited exact body",scheduled_at:"2026-09-15T10:30:00+05:30"};
 const second=await f.service.edit(edit);
 assert.equal(second.prepared_revision.envelope.scheduled_at,"2026-09-15T05:00:00.000Z");
 const current=await f.approvals.currentForAction({organization_id:f.org.id,action_id:actionId});
 assert.equal(current.action.status,"AWAITING_APPROVAL");assert.equal(current.approval.status,"PENDING");assert.equal(current.prepared_revision.id,second.prepared_revision.id);
 await assert.rejects(f.approvals.approveAction({organization_id:f.org.id,action_id:actionId,expected_revision_id:first.prepared_revision.id,reviewer_user_id:f.actor.id}),{code:"APPROVAL_REVISION_STALE"});
 await f.service.edit({...edit,request_key:"edit-2",expected_revision_id:second.prepared_revision.id,body:"Latest body",scheduled_at:null});
 const replay=await f.service.edit(edit);assert.equal(replay.replayed,true);assert.equal(replay.prepared_revision.id,second.prepared_revision.id);assert.equal(replay.prepared_revision.envelope.body,"Edited exact body");
 const recovered=await f.service.byRequestKey({...f.scope,request_key:"draft-1"});assert.deepEqual(recovered.prepared_revision,first.prepared_revision);
 assert.equal((await f.service.create(firstCmd)).prepared_revision.id,first.prepared_revision.id);
 assert.equal(await f.count("actions"),1);assert.equal(await f.count("action_revision_decisions"),1);
});
test("invalid schedules and failed edit audit preserve action schedule, exact approval and complete history",async t=>{
 const f=await fixture(t),first=await f.service.create(await f.command()),id=first.command.action_id;
 await f.approvals.approveAction({organization_id:f.org.id,action_id:id,expected_revision_id:first.prepared_revision.id,reviewer_user_id:f.actor.id});
 const edit={organization_id:f.org.id,actor:f.actor,action_id:id,request_key:"change",expected_revision_id:first.prepared_revision.id,reason:"Move planned due time.",subject:"Changed",body:"Changed body",scheduled_at:"2026-09-15T10:00:00Z"};
 for(const value of ["2026-02-30T10:00:00Z","2026-09-15T10:00","2026-09-15T10:00:00",10])await assert.rejects(f.service.edit({...edit,scheduled_at:value}),{code:"INVALID_SCHEDULE_TIME"});
 const before=await new ActionsRepository(f.db).getAction(id),audits=await f.count("audit_logs"),record=AuditRepository.prototype.record;
 AuditRepository.prototype.record=async function(input){const result=await record.call(this,input);if(input.event_type==="ActionComposed")throw new Error("Injected composer audit failure");return result;};
 try{await assert.rejects(f.service.edit(edit),/Injected composer audit failure/);}finally{AuditRepository.prototype.record=record;}
 assert.deepEqual(await new ActionsRepository(f.db).getAction(id),before);assert.equal(await f.count("action_revisions"),1);assert.equal(await f.count("action_composer_commands"),1);assert.equal(await f.count("audit_logs"),audits);assert.equal((await f.service.byRequestKey({...f.scope,request_key:"change"})).command,null);
});
test("failed first draft audit rolls back action, revision, pending approval and request identity",async t=>{
 const f=await fixture(t),cmd=await f.command(),record=AuditRepository.prototype.record;
 AuditRepository.prototype.record=async function(input){const result=await record.call(this,input);if(input.event_type==="ActionComposed")throw new Error("Injected first draft failure");return result;};
 try{await assert.rejects(f.service.create(cmd),/Injected first draft failure/);}finally{AuditRepository.prototype.record=record;}
 for(const table of ["actions","action_revisions","action_approvals","action_composer_commands"])assert.equal(await f.count(table),0);
 assert.equal((await f.service.byRequestKey({...f.scope,request_key:cmd.request_key})).command,null);
 assert.equal((await f.service.create(cmd)).replayed,false);
});
test("a contextual reply requires the selected owned canonical inbound email and does not resolve response work",async t=>{
 const f=await fixture(t),message=await incoming(f);
 const reply=await f.command({kind:"REPLY",reply_to_message_id:message.id});
 const countBefore=await f.count("follow_up_tasks"),saved=await f.service.create(reply);
 assert.equal(saved.command.message_kind,"REPLY");assert.equal(saved.command.reply_to_message_id,message.id);
 assert.equal(await f.count("follow_up_tasks"),countBefore);assert.equal(await f.count("channel_messages"),1);
 const other=await f.leads.createLead({organization_id:f.org.id,name:"Other enquiry",email:"other@example.test",source:"MANUAL"});
 await assert.rejects(f.service.get({...f.scope,lead_id:other.id,reply_to_message_id:message.id}),{code:"COMPOSER_REPLY_UNAVAILABLE"});
 await f.db.run("UPDATE channel_messages SET direction='OUTBOUND' WHERE id=?",[message.id]);
 await assert.rejects(f.service.get({...f.scope,reply_to_message_id:message.id}),{code:"COMPOSER_REPLY_UNAVAILABLE"});
});
test("reply-source change invalidates an unaccepted draft token",async t=>{
 const f=await fixture(t),message=await incoming(f),cmd=await f.command({kind:"REPLY",reply_to_message_id:message.id});
 await f.db.run("UPDATE channel_messages SET body=? WHERE id=?",["Changed recorded reply",message.id]);
 await assert.rejects(f.service.create(cmd),{code:"COMPOSER_REVIEW_STALE"});assert.equal(await f.count("actions"),0);
});
test("restricted and archived enquiries cannot create a reply or use a new key to bypass policy",async t=>{
 const f=await fixture(t),cmd=await f.command();
 await new ContactPolicyService(f.db).restrictLead({organization_id:f.org.id,lead_id:f.lead.id,channel:"ALL",reason:"OPT_OUT",source:"MANUAL",source_event_id:"composer-optout"});
 assert.equal((await f.service.get(f.scope)).can_create,false);await assert.rejects(f.service.create(cmd),{code:"CONTACT_RESTRICTED"});assert.equal(await f.count("actions"),0);
 const second=await f.leads.createLead({organization_id:f.org.id,name:"Archived enquiry",email:"archive@example.test",source:"MANUAL"});
 await f.db.run("UPDATE leads SET archived_at=? WHERE id=?",[new Date().toISOString(),second.id]);
 const archived=await f.service.get({...f.scope,lead_id:second.id});assert.equal(archived.can_create,false);assert.equal(archived.unavailable_reason,"LEAD_ARCHIVED");assert.equal(archived.review_token,null);
});
test("an action that has attempted dispatch cannot be edited even if its coarse status is restored",async t=>{
 const f=await fixture(t),first=await f.service.create(await f.command()),id=first.command.action_id;
 await f.db.run("UPDATE actions SET first_dispatch_at=?,status='AWAITING_APPROVAL' WHERE id=?",["2026-09-13T01:00:00.000Z",id]);
 await assert.rejects(f.service.edit({organization_id:f.org.id,actor:f.actor,action_id:id,request_key:"edit",expected_revision_id:first.prepared_revision.id,reason:"Do not restart attempted work.",subject:"Subject",body:"Changed",scheduled_at:null}),{code:"COMPOSER_ACTION_STARTED"});
 assert.equal(await f.count("action_composer_commands"),1);
});
test("generated draft content uses the same review and schedule path without cloning an action",async t=>{
 const f=await fixture(t),actions=new ActionsRepository(f.db);
 const action=await actions.createAction({organization_id:f.org.id,lead_id:f.lead.id,type:"SEND_EMAIL",idempotency_key:"existing-plan",approval_requirement:"REQUIRED",status:"AWAITING_APPROVAL",payload:{source:"NEXT_BEST_ACTION_PLAN",subject:"Generated",message:"Generated body"}});
 const old=await f.approvals.currentForAction({organization_id:f.org.id,action_id:action.id});
 const saved=await f.service.edit({organization_id:f.org.id,actor:f.actor,action_id:action.id,request_key:"edit-existing",expected_revision_id:old.prepared_revision.id,reason:"Owner edited the recommendation.",subject:"Human title",body:"Human copy",scheduled_at:null});
 assert.equal(saved.command.action_id,action.id);assert.equal(saved.prepared_revision.envelope.body,"Human copy");assert.equal(await f.count("actions"),1);
 const legacy=await f.approvals.previewAction({organization_id:f.org.id,action_id:action.id,expected_revision_id:saved.prepared_revision.id,edited_payload:{body:"Legacy caller remains supported"}});
 assert.equal(legacy.prepared_revision.envelope.body,"Legacy caller remains supported");
});
test("complete-looking SendGrid stays held for live dispatch while offering a reviewable draft",async t=>{
 const f=await fixture(t),key=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({type:"spki",format:"pem"});
 await new SettingsRepository(f.db).setBulk(f.org.id,"channel_email",{provider:"sendgrid",from_email:"owner@example.test",reply_to:"reply@example.test",api_key:"synthetic-key",sendgrid_events_public_key:key,sendgrid_inbound_public_key:key});
 const view=await f.service.get(f.scope);assert.equal(view.can_create,true);assert.equal(view.configuration.can_dispatch,false);assert.equal(view.configuration.hold_code,"CHANNEL_VERIFICATION_REQUIRED");
 const saved=await f.service.create(await f.command());assert.equal(saved.prepared_revision.envelope.sender.reply_to,"reply@example.test");assert.equal(await f.count("action_executions"),0);
 assert.equal(JSON.stringify(view).includes("synthetic-key"),false);
});
test("oversized stored source is refused before full lead materialization",async t=>{
 const f=await fixture(t);await f.db.run("UPDATE leads SET source_metadata_json=? WHERE id=?",["x".repeat(1048577),f.lead.id]);
 let materialized=false;const get=f.db.get.bind(f.db);f.db.get=async(sql,...args)=>{if(/SELECT \* FROM leads/.test(sql))materialized=true;return get(sql,...args);};
 await assert.rejects(new ComposerRepository(f.db).lead(f.org.id,f.lead.id),{code:"COMPOSER_SOURCE_LIMIT"});assert.equal(materialized,false);
});

test("pending acknowledgement binds unseen rows and the 1000-action inspection boundary",async t=>{
 const f=await fixture(t);
 for(let i=0;i<21;i++)await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:f.lead.id,type:"SEND_EMAIL",idempotency_key:"pending:"+i,status:"AWAITING_APPROVAL",approval_requirement:"REQUIRED",payload:{message:"Pending "+i}});
 const view=await f.service.get(f.scope);assert.equal(view.pending_total,21);assert.equal(view.pending_actions.length,20);assert.equal(view.pending_truncated,true);
 const unseen=await f.db.get("SELECT id FROM actions ORDER BY id DESC LIMIT 1");
 await f.db.run("UPDATE actions SET status='APPROVED' WHERE id=?",[unseen.id]);
 await assert.rejects(f.service.create({...await f.command({request_key:"ack",acknowledge_pending:true}),review_token:view.review_token}),{code:"COMPOSER_REVIEW_STALE"});
 for(let i=21;i<1000;i++)await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:f.lead.id,type:"SEND_EMAIL",idempotency_key:"pending:"+i,status:"AWAITING_APPROVAL",payload:{message:"Pending"}});
 const capped=await f.service.get(f.scope);assert.equal(capped.pending_total,1000);assert.equal(capped.can_create,false);assert.equal(capped.unavailable_reason,"COMPOSER_PENDING_LIMIT");
 await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:f.lead.id,type:"SEND_EMAIL",idempotency_key:"over-limit",status:"AWAITING_APPROVAL",payload:{message:"Historical excess"}});
 await assert.rejects(f.service.get(f.scope),{code:"COMPOSER_PENDING_LIMIT",statusCode:413});
});
test("strict copy and scope fields reject before any action is created",async t=>{
 const f=await fixture(t),cmd=await f.command();
 for(const patch of [{subject:"Subject\r\nBcc: hidden@example.test"},{body:""},{body:"x".repeat(10001)},{recipient:"other@example.test"},{provider:"sendgrid"},{mock_behavior:"SUCCESS"},{kind:"REPLY",reply_to_message_id:null},{acknowledge_pending:"yes"}])await assert.rejects(f.service.create({...cmd,...patch}),{code:"COMPOSER_INVALID_INPUT"});
 assert.equal(await f.count("actions"),0);assert.equal(await f.count("action_composer_commands"),0);
});
test("a real materialized sequence step keeps its workflow identity and waits after composer rescheduling",async t=>{
 const f=await fixture(t);
 const {WorkflowsRepository}=await import("../src/modules/workflows/workflowsRepository.js");
 const {WorkflowsService}=await import("../src/modules/workflows/workflowsService.js");
 const workflows=new WorkflowsService({workflowsRepository:new WorkflowsRepository(f.db)});
 const {campaign}=await workflows.createCampaign({organization_id:f.org.id,name:"Synthetic sequence"});
 const {sequence}=await workflows.createSequence({organization_id:f.org.id,campaign_id:campaign.id,name:"One reviewed step",steps:[{type:"SEND_EMAIL",title:"Initial title",body:"Initial sequence content",delay_hours:0}]});
 const {workflow_runs}=await workflows.enrollLeads({organization_id:f.org.id,sequence_id:sequence.id,lead_ids:[f.lead.id]});
 const run=await workflows.processRun(workflow_runs[0]),before=await new ActionsRepository(f.db).getAction(run.last_action_id);
 const revision=await f.approvals.currentForAction({organization_id:f.org.id,action_id:before.id});
 const saved=await f.service.edit({organization_id:f.org.id,actor:f.actor,action_id:before.id,request_key:"sequence-edit",expected_revision_id:revision.prepared_revision.id,reason:"Tailor and schedule this specific step.",subject:"Tailored",body:"Human sequence copy",scheduled_at:"2026-09-20T12:00:00+05:30"});
 const after=await new ActionsRepository(f.db).getAction(before.id);
 assert.equal(after.workflow_run_id,before.workflow_run_id);assert.equal(after.sequence_step_id,before.sequence_step_id);assert.equal(after.id,before.id);
 assert.equal(saved.prepared_revision.envelope.scheduled_at,"2026-09-20T06:30:00.000Z");assert.equal((await workflows.processRun(run)).status,"WAITING_APPROVAL");assert.equal(await f.count("actions"),1);assert.equal(await f.count("action_executions"),0);
});
test("a persisted composer request survives database restart without creating or approving more work",async t=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),path=await import("node:path"),{tmpdir}=await import("node:os");
 const parent=path.resolve(tmpdir()),dir=await mkdtemp(path.join(parent,"l402-composer-")),filename=path.join(dir,"owned.sqlite");
 let db=null;
 t.after(async()=>{if(db)await db.close();assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith("l402-composer-"));await rm(dir,{recursive:true,force:true});});
 db=await createDatabase(filename);const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Restart fixture"}),actor={id:"restart-owner",role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Owner","restart@example.test","synthetic",new Date().toISOString()]);
 const lead=await leads.createLead({organization_id:org.id,name:"Restart enquiry",email:"restart-lead@example.test",source:"MANUAL"}),scope={organization_id:org.id,lead_id:lead.id,actor},service=new ComposerService(db);
 const cmd={...scope,request_key:"persistent",review_token:(await service.get(scope)).review_token,acknowledge_pending:false,reason:"Durable owner draft",kind:"NEW_MESSAGE",reply_to_message_id:null,subject:"Persistent subject",body:"Persistent content",scheduled_at:null},saved=await service.create(cmd);
 await db.close();db=null;db=await createDatabase(filename);const resumed=new ComposerService(db),lookup=await resumed.byRequestKey({...scope,request_key:"persistent"});
 assert.deepEqual(lookup.prepared_revision,saved.prepared_revision);assert.equal((await resumed.create(cmd)).replayed,true);await resumed.get(scope);
 assert.equal(Number((await db.get("SELECT count(*) n FROM actions")).n),1);assert.equal(Number((await db.get("SELECT count(*) n FROM action_revision_decisions")).n),0);assert.equal(Number((await db.get("SELECT count(*) n FROM action_executions")).n),0);
});

test("terminal coarse status cannot hide uncertain or legacy execution history from pending acknowledgement",async t=>{
 const f=await fixture(t),saved=await f.service.create(await f.command()),id=saved.command.action_id;
 const {ExecutionsRepository}=await import("../src/modules/outbound-automation/executionsRepository.js");
 await new ExecutionsRepository(f.db).createExecution({action_id:id,status:"FAILED",attempt:1,provider:"sandbox",idempotency_key:"uncertain-history",outcome_class:"UNCERTAIN"});
 await f.db.run("UPDATE actions SET status='FAILED' WHERE id=?",[id]);
 assert.equal((await f.service.get(f.scope)).pending_total,1);
 await f.db.run("UPDATE action_executions SET outcome_class='LEGACY_UNKNOWN' WHERE action_id=?",[id]);
 assert.equal((await f.service.get(f.scope)).pending_total,1);
 await f.db.run("UPDATE action_executions SET outcome_class='PERMANENT_FAILURE' WHERE action_id=?",[id]);
 assert.equal((await f.service.get(f.scope)).pending_total,0);
});
