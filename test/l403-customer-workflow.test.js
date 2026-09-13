import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase} from "../src/database/database.js";
import {LeadsRepository} from "../src/modules/data-foundation/leadsRepository.js";
import {InboundEventsRepository} from "../src/modules/channels/inboundEventsRepository.js";
import {ChannelMessagesRepository} from "../src/modules/channels/channelMessagesRepository.js";
import {FollowUpsRepository} from "../src/modules/channels/followUpsRepository.js";
import {FollowUpDueService} from "../src/modules/channels/followUpDueService.js";
import {ActionsRepository} from "../src/modules/outbound-automation/actionsRepository.js";
import {AuditRepository} from "../src/modules/events/auditRepository.js";
import {ContactPolicyService} from "../src/modules/contact-policy/contactPolicyService.js";
import {CustomerWorkflowService} from "../src/modules/customer-workflow/customerWorkflowService.js";

async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Synthetic customer workflow"}),actor={id:"owner-"+org.id,role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Owner",actor.id+"@example.test","synthetic-only","2026-09-13T10:00:00.000Z"]);
 const lead=await leads.createLead({organization_id:org.id,name:"Customer",email:"customer@example.test",source:"MANUAL"}),now={value:Date.parse("2026-09-13T10:00:00.000Z")},service=new CustomerWorkflowService(db,{now:()=>now.value}),scope={organization_id:org.id,lead_id:lead.id,actor};
 const conversation=async(extra={})=>{const v=await service.getConversation(scope);return {...scope,expected_revision:v.conversation.revision,review_token:v.conversation.review_token,request_key:"conversation-1",status:"OPEN",read_state:"KEEP",assigned_owner_id:null,reason:"Owner reviewed this conversation.",...extra};};
 const reminder=async(extra={})=>({...scope,request_key:"reminder-1",review_token:(await service.listFollowUps(scope)).review_token,due_at:"2026-09-14T10:00:00+05:30",reason:"Review the customer's requirements.",reply_to_message_id:null,...extra});
 const outcome=async(extra={})=>({...scope,outcome_id:null,expected_revision:0,review_token:(await service.listOutcomes(scope)).review_token,request_key:"outcome-1",status:"RECORDED",reason:"Owner reported the milestone.",values:{kind:"QUALIFIED_CONVERSATION",occurred_at:"2026-09-12T12:00:00+05:30",summary:"Customer confirmed a relevant requirement.",source_reference:null,evidence_message_id:null,attributed_action_id:null,attribution_note:null,amount:null},...extra});
 let seq=0;const incoming=async({type="QUESTION",created_at=null}={})=>{const event=await new InboundEventsRepository(db).create({organization_id:org.id,lead_id:lead.id,channel:"EMAIL",provider:"sandbox",provider_event_id:"event-"+ ++seq,event_type:type,payload:{text:"A new customer reply."}});const m=await new ChannelMessagesRepository(db).create({organization_id:org.id,lead_id:lead.id,inbound_event_id:event.inbound_event.id,direction:"INBOUND",channel:"EMAIL",status:"RECEIVED",subject:type,body:"A new customer reply.",idempotency_key:"message-"+seq});if(created_at)await db.run("UPDATE channel_messages SET created_at=? WHERE id=?",[created_at,m.id]);return m;};
 const count=async table=>Number((await db.get("SELECT count(*) n FROM "+table)).n);
 return {db,leads,org,actor,lead,now,service,scope,conversation,reminder,outcome,incoming,count};
}
test("conversation read creates no state; explicit READ and KEEP preserve independent attention",async t=>{
 const f=await fixture(t),initial=await f.service.getConversation(f.scope);assert.equal(initial.conversation.revision,0);assert.equal(initial.conversation.read_state,"READ");assert.equal(await f.count("conversation_revisions"),0);
 await f.incoming();const unread=await f.service.getConversation(f.scope);assert.equal(unread.conversation.read_state,"UNREAD");assert.equal(unread.conversation.attention,"NEEDS_REPLY");
 await f.service.saveConversation(await f.conversation({read_state:"READ",assigned_owner_id:f.actor.id}));assert.equal((await f.service.getConversation(f.scope)).conversation.read_state,"READ");
 await f.service.saveConversation(await f.conversation({request_key:"keep",status:"ESCALATED",read_state:"KEEP"}));const kept=await f.service.getConversation(f.scope);assert.equal(kept.conversation.read_state,"READ");assert.equal(kept.conversation.attention,"ESCALATED");
 await f.service.saveConversation(await f.conversation({request_key:"unread",read_state:"UNREAD"}));assert.equal((await f.service.getConversation(f.scope)).conversation.read_state,"UNREAD");
});
test("new and backdated canonical inbound reopens effective attention without rewriting prior resolution",async t=>{
 const f=await fixture(t);await f.incoming();const cmd=await f.conversation({status:"RESOLVED",read_state:"READ"}),saved=await f.service.saveConversation(cmd);
 assert.equal((await f.service.getConversation(f.scope)).conversation.effective_status,"RESOLVED");
 const latest=(await f.service.getConversation(f.scope)).conversation.last_inbound_message_id;await f.incoming({created_at:"2020-01-01T00:00:00.000Z"});
 const after=await f.service.getConversation(f.scope);assert.equal(after.conversation.last_inbound_message_id,latest);assert.equal(after.conversation.status,"RESOLVED");assert.equal(after.conversation.effective_status,"OPEN");assert.equal(after.conversation.read_state,"UNREAD");assert.equal(after.conversation.inbound_count,2);assert.equal(await f.count("conversation_revisions"),1);
 assert.deepEqual((await f.service.saveConversation(cmd)).change,saved.change);assert.equal((await f.service.saveConversation(cmd)).replayed,true);
});
test("conversation stale tokens, revision races and explicit assignment are guarded",async t=>{
 const f=await fixture(t),cmd=await f.conversation();await f.incoming();await assert.rejects(f.service.saveConversation(cmd),{code:"CUSTOMER_WORKFLOW_REVIEW_STALE"});
 const current=await f.conversation();const race=await Promise.allSettled([f.service.saveConversation(current),f.service.saveConversation({...current,request_key:"other",status:"ESCALATED"})]);assert.equal(race.filter(r=>r.status==="fulfilled").length,1);assert.equal(race.filter(r=>r.status==="rejected").length,1);
 await assert.rejects(f.service.saveConversation(await f.conversation({request_key:"foreign-owner",assigned_owner_id:"another-owner"})),{code:"CUSTOMER_WORKFLOW_ASSIGNMENT_INVALID"});
 assert.equal(await f.count("conversation_revisions"),1);
});
test("opt-out remains restricted attention rather than ordinary reply work or restored contact permission",async t=>{
 const f=await fixture(t);await f.incoming({type:"OPT_OUT"});await new ContactPolicyService(f.db).restrictLead({organization_id:f.org.id,lead_id:f.lead.id,channel:"ALL",reason:"OPT_OUT",source:"MANUAL",source_event_id:"stop"});
 await f.service.saveConversation(await f.conversation({status:"OPEN",read_state:"READ"}));
 const state=await f.service.getConversation(f.scope);assert.equal(state.conversation.attention,"CONTACT_RESTRICTED");assert.equal(state.conversation.read_state,"READ");assert.equal((await new LeadsRepository(f.db).getLead(f.lead.id)).status,"OPTED_OUT");
 const reminder=await f.service.createFollowUp(await f.reminder());assert.equal(reminder.change.after.channel,"HUMAN_TASK");assert.equal(await f.count("actions"),0);
});
test("manual reminder persists its explicit due time and the normal due worker changes its stale state token",async t=>{
 const f=await fixture(t),saved=await f.service.createFollowUp(await f.reminder()),task=saved.change.after;assert.equal(task.status,"PLANNED");assert.equal(task.due_at,"2026-09-14T04:30:00.000Z");assert.equal(task.origin,"MANUAL_REMINDER");
 f.now.value=Date.parse("2026-09-14T05:00:00.000Z");await new FollowUpDueService({db:f.db,now:()=>f.now.value}).processDue({organization_id:f.org.id});
 await assert.rejects(f.service.changeFollowUp({organization_id:f.org.id,actor:f.actor,follow_up_id:task.id,request_key:"complete",expected_task_token:task.state_token,operation:"COMPLETE",due_at:null,reason:"Finished review."}),{code:"CUSTOMER_WORKFLOW_TASK_STALE"});
 const current=(await f.service.listFollowUps(f.scope)).follow_ups[0];assert.equal(current.status,"DUE");
 const completed=await f.service.changeFollowUp({organization_id:f.org.id,actor:f.actor,follow_up_id:task.id,request_key:"complete",expected_task_token:current.state_token,operation:"COMPLETE",due_at:null,reason:"Finished review."});assert.equal(completed.change.after.status,"COMPLETED");assert.ok(completed.change.after.completed_at);assert.equal(await f.count("actions"),0);assert.equal(await f.count("channel_messages"),0);assert.equal(await f.count("business_outcomes"),0);
});
test("reminder rescheduling and terminal transitions preserve original recovery and cannot reopen completion",async t=>{
 const f=await fixture(t),cmd=await f.reminder(),created=await f.service.createFollowUp(cmd),row=created.change.after;
 const reschedule={organization_id:f.org.id,actor:f.actor,follow_up_id:row.id,request_key:"reschedule",expected_task_token:row.state_token,operation:"RESCHEDULE",due_at:"2026-09-13T01:00:00Z",reason:"This review is due now."},changed=await f.service.changeFollowUp(reschedule);assert.equal(changed.change.after.status,"DUE");
 const complete={...reschedule,request_key:"completed",expected_task_token:changed.change.after.state_token,operation:"COMPLETE",due_at:null},completed=await f.service.changeFollowUp(complete);
 await assert.rejects(f.service.changeFollowUp({...reschedule,request_key:"reopen",expected_task_token:completed.change.after.state_token}),{code:"FOLLOW_UP_STATE_CONFLICT"});
 assert.deepEqual((await f.service.createFollowUp(cmd)).change,created.change);assert.deepEqual((await f.service.changeFollowUp(reschedule)).change,changed.change);assert.equal(await f.count("follow_up_tasks"),1);
});
test("automatic no-response timing cannot be rescheduled through manual reminder controls",async t=>{
 const f=await fixture(t),action=await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:f.lead.id,type:"SEND_EMAIL",idempotency_key:"previous-send"});
 await new FollowUpsRepository(f.db).create({organization_id:f.org.id,lead_id:f.lead.id,action_id:action.id,channel:"EMAIL",status:"PLANNED",due_at:"2026-09-15T10:00:00.000Z",reason:"No response after delivery.",idempotency_key:"action:"+action.id+":no-response-follow-up:v1"});
 const task=(await f.service.listFollowUps(f.scope)).follow_ups[0];assert.equal(task.can_reschedule,false);assert.equal(task.origin,"AUTOMATIC_NO_RESPONSE");
 await assert.rejects(f.service.changeFollowUp({organization_id:f.org.id,actor:f.actor,follow_up_id:task.id,request_key:"move-auto",expected_task_token:task.state_token,operation:"RESCHEDULE",due_at:"2026-09-20T10:00:00Z",reason:"Cannot rewrite the delivery basis."}),{code:"FOLLOW_UP_STATE_CONFLICT"});
 assert.equal(await f.count("follow_up_commands"),0);
});
test("outcome slots deduplicate milestones and WON to LOST correction retains exact monetary history",async t=>{
 const f=await fixture(t),base=await f.outcome(),cmd={...base,values:{...base.values,kind:"WON",amount:{currency:"INR",value:"9007199254740993.01"}}},first=await f.service.saveOutcome(cmd);
 assert.deepEqual(first.change.values.amount,{currency:"INR",scale:2,minor_units:"900719925474099301"});assert.equal(first.change.slot,"RESULT");
 await assert.rejects(f.service.saveOutcome({...cmd,request_key:"duplicate-result"}),{code:"OUTCOME_SLOT_CONFLICT"});
 const lost=await f.service.saveOutcome({...cmd,outcome_id:first.change.id,expected_revision:1,request_key:"correct-result",values:{...base.values,kind:"LOST",amount:null},reason:"Owner corrected the outcome report."});
 assert.equal(lost.change.revision,2);assert.equal(lost.change.values.kind,"LOST");assert.equal(lost.change.values.amount,null);
 const history=await f.service.getOutcome({organization_id:f.org.id,actor:f.actor,outcome_id:first.change.id});assert.equal(history.history.changes.length,2);assert.equal(history.history.changes[1].values.amount.minor_units,"900719925474099301");assert.equal(await f.count("business_outcomes"),1);
 assert.deepEqual((await f.service.saveOutcome(cmd)).change,first.change);
});
test("outcome withdrawal, restoration and clock rollback preserve exact original-request recovery",async t=>{
 const f=await fixture(t),cmd=await f.outcome(),first=await f.service.saveOutcome(cmd);
 const withdrawn=await f.service.saveOutcome({...cmd,outcome_id:first.change.id,expected_revision:1,status:"WITHDRAWN",request_key:"withdraw"});assert.equal(withdrawn.change.status,"WITHDRAWN");
 const restored=await f.service.saveOutcome({...cmd,outcome_id:first.change.id,expected_revision:2,status:"RECORDED",request_key:"restore"});assert.equal(restored.change.revision,3);
 f.now.value=Date.parse("2026-01-01T00:00:00Z");assert.deepEqual((await f.service.saveOutcome(cmd)).change,first.change);
 assert.deepEqual((await f.service.byRequestKey({...f.scope,kind:"OUTCOME",request_key:"withdraw"})).change,withdrawn.change);
});
test("future outcomes, imprecise money and attribution without evidence are rejected before persistence",async t=>{
 const f=await fixture(t),base=await f.outcome();
 for(const values of [{...base.values,occurred_at:"2027-01-01T00:00:00Z"},{...base.values,amount:{currency:"INR",value:"10"}},{...base.values,kind:"WON",amount:{currency:"INR",value:10}},{...base.values,kind:"WON",amount:{currency:"JPY",value:"10.01"}},{...base.values,attributed_action_id:"anything",attribution_note:null}])await assert.rejects(f.service.saveOutcome({...base,values}),{code:"CUSTOMER_WORKFLOW_INVALID_INPUT"});
 assert.equal(await f.count("business_outcomes"),0);assert.equal(await f.count("business_outcome_revisions"),0);
});
test("canonical evidence and action attribution are scoped to the exact enquiry",async t=>{
 const f=await fixture(t),other=await f.leads.createLead({organization_id:f.org.id,name:"Other",email:"other@example.test",source:"MANUAL"}),message=await f.incoming(),action=await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:other.id,type:"CREATE_HUMAN_TASK",idempotency_key:"other-task"});
 const cmd=await f.outcome();await assert.rejects(f.service.saveOutcome({...cmd,values:{...cmd.values,attributed_action_id:action.id,attribution_note:"Owner asserted linkage."}}),{code:"CUSTOMER_WORKFLOW_ACTION_UNAVAILABLE"});
 await assert.rejects(f.service.createFollowUp({...await f.reminder(),lead_id:other.id,review_token:(await f.service.listFollowUps({...f.scope,lead_id:other.id})).review_token,reply_to_message_id:message.id}),{code:"CUSTOMER_WORKFLOW_MESSAGE_UNAVAILABLE"});
 assert.equal(await f.count("business_outcomes"),0);assert.equal(await f.count("follow_up_tasks"),0);
});
test("audit failure rolls back conversation, reminder and outcome records with their request keys",async t=>{
 const f=await fixture(t),conversation=await f.conversation(),reminder=await f.reminder(),outcome=await f.outcome(),record=AuditRepository.prototype.record;
 AuditRepository.prototype.record=async function(input){const result=await record.call(this,input);if(["ConversationReviewed","HumanFollowUpChanged","BusinessOutcomeRecorded"].includes(input.event_type))throw new Error("Injected workflow audit failure");return result;};
 try{await assert.rejects(f.service.saveConversation(conversation),/Injected workflow audit failure/);await assert.rejects(f.service.createFollowUp(reminder),/Injected workflow audit failure/);await assert.rejects(f.service.saveOutcome(outcome),/Injected workflow audit failure/);}finally{AuditRepository.prototype.record=record;}
 for(const table of ["conversation_revisions","follow_up_tasks","follow_up_commands","business_outcomes","business_outcome_revisions"])assert.equal(await f.count(table),0);
 for(const [kind,key]of [["CONVERSATION","conversation-1"],["FOLLOW_UP","reminder-1"],["OUTCOME","outcome-1"]])assert.equal((await f.service.byRequestKey({...f.scope,kind,request_key:key})).change,null);
});
test("owner scope and changed role protect every workflow read/recovery without leaking foreign state",async t=>{
 const f=await fixture(t),other=await f.leads.createOrganization({name:"Foreign"}),saved=await f.service.saveOutcome(await f.outcome());
 await assert.rejects(f.service.getOutcome({...f.scope,organization_id:other.id,outcome_id:saved.change.id}),{code:"CUSTOMER_WORKFLOW_OWNER_REQUIRED"});
 await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.actor.id]);
 for(const action of [()=>f.service.getConversation(f.scope),()=>f.service.listFollowUps(f.scope),()=>f.service.listOutcomes(f.scope),()=>f.service.byRequestKey({...f.scope,kind:"OUTCOME",request_key:"outcome-1"})])await assert.rejects(action(),{code:"CUSTOMER_WORKFLOW_OWNER_REQUIRED"});
});
test("scoped formula-safe export retains exact amount JSON and never infers revenue from actions",async t=>{
 const f=await fixture(t),cmd=await f.outcome(),saved=await f.service.saveOutcome({...cmd,values:{...cmd.values,kind:"WON",summary:"=HYPERLINK(\"unsafe\")",amount:{currency:"USD",value:"9007199254740993.01"}}});
 const result=await f.service.exportOutcomes({organization_id:f.org.id,actor:f.actor,outcome_ids:[saved.change.id]});
 assert.equal(result.row_count,1);assert.match(result.csv_text,/text: =HYPERLINK/);assert.match(result.csv_text,/900719925474099301/);assert.match(result.csv_text,/REPORTED_DEAL_VALUE_NOT_REVENUE/);assert.match(result.csv_text,/OWNER_REPORTED/);assert.equal(await f.count("action_executions"),0);
 await assert.rejects(f.service.exportOutcomes({organization_id:f.org.id,actor:f.actor,outcome_ids:[saved.change.id,"foreign"]}),{code:"OUTCOME_NOT_FOUND"});
 assert.equal(Number((await f.db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessOutcomesExported'")).n),1);
});
test("bounded conversation history and directory paging expose explicit continuation",async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.service.saveConversation(await f.conversation({request_key:"revision-"+i}));
 const page=await f.service.getConversation({...f.scope,limit:"2"});assert.equal(page.history.changes.length,2);assert.equal(page.history.has_more,true);assert.equal(page.history.next_before_revision,2);
 assert.equal((await f.service.getConversation({...f.scope,before_revision:2,limit:2})).history.changes[0].revision,1);
 await f.leads.createLead({organization_id:f.org.id,name:"Second",email:"second@example.test",source:"MANUAL"});
 const directory=await f.service.listConversations({organization_id:f.org.id,actor:f.actor,limit:1});assert.equal(directory.conversations.length,1);assert.equal(directory.has_more,true);assert.ok(directory.next_after_lead_id);
});

test("missing email is unresolved contact rather than an opt-out restriction",async t=>{
 const f=await fixture(t);await f.db.run("UPDATE leads SET email=NULL,normalized_email=NULL WHERE id=?",[f.lead.id]);
 assert.equal((await f.service.getConversation(f.scope)).conversation.attention,"CONTACT_UNRESOLVED");
});
test("outcome export preflights the complete selected byte budget before materializing any revision",async t=>{
 const f=await fixture(t),ids=[],large=String.fromCharCode(0x6f22).repeat(2000),reference=String.fromCharCode(0x6f22).repeat(500);
 for(let i=0;i<650;i++){
  const lead=await f.leads.createLead({organization_id:f.org.id,name:"Export boundary "+i,email:"export-"+i+"@example.test",source:"MANUAL"}),scope={...f.scope,lead_id:lead.id};
  const saved=await f.service.saveOutcome({...scope,outcome_id:null,expected_revision:0,review_token:(await f.service.listOutcomes(scope)).review_token,request_key:"large-"+i,status:"RECORDED",reason:large,values:{kind:"QUALIFIED_CONVERSATION",occurred_at:"2026-09-12T00:00:00Z",summary:large,source_reference:reference,evidence_message_id:null,attributed_action_id:null,attribution_note:null,amount:null}});
  ids.push(saved.change.id);
 }
 const {CustomerWorkflowRepository}=await import("../src/modules/customer-workflow/customerWorkflowRepository.js"),original=CustomerWorkflowRepository.prototype.headOutcome;let reads=0;
 CustomerWorkflowRepository.prototype.headOutcome=async function(...args){reads++;return original.apply(this,args);};
 try{await assert.rejects(f.service.exportOutcomes({organization_id:f.org.id,actor:f.actor,outcome_ids:ids}),{code:"CUSTOMER_WORKFLOW_LIMIT",statusCode:413});assert.equal(reads,0);}finally{CustomerWorkflowRepository.prototype.headOutcome=original;}
 assert.equal(Number((await f.db.get("SELECT count(*) n FROM audit_logs WHERE event_type='BusinessOutcomesExported'")).n),0);
 assert.equal((await f.service.exportOutcomes({organization_id:f.org.id,actor:f.actor,outcome_ids:ids.slice(0,2)})).row_count,2);
});
test("database restart preserves original reminder due time and owner command recovery without external actions",async t=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),path=await import("node:path"),{tmpdir}=await import("node:os"),parent=path.resolve(tmpdir()),dir=await mkdtemp(path.join(parent,"l403-workflow-")),file=path.join(dir,"owned.sqlite");
 let db=null;t.after(async()=>{if(db)await db.close();assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith("l403-workflow-"));await rm(dir,{recursive:true,force:true});});
 db=await createDatabase(file);const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Restart customer workflow"}),actor={id:"restart-workflow-owner",role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Owner","restart-workflow@example.test","synthetic","2026-09-13T00:00:00.000Z"]);
 const lead=await leads.createLead({organization_id:org.id,name:"Restart enquiry",email:"restart-workflow-lead@example.test",source:"MANUAL"}),scope={organization_id:org.id,lead_id:lead.id,actor},first=new CustomerWorkflowService(db,{now:()=>Date.parse("2026-09-13T00:00:00Z")}),cmd={...scope,request_key:"restart-reminder",review_token:(await first.listFollowUps(scope)).review_token,due_at:"2026-09-14T10:00:00+05:30",reason:"Persisted future reminder.",reply_to_message_id:null},saved=await first.createFollowUp(cmd);
 await db.close();db=null;db=await createDatabase(file);const resumed=new CustomerWorkflowService(db,{now:()=>Date.parse("2026-09-14T06:00:00Z")});
 assert.deepEqual((await resumed.byRequestKey({...scope,kind:"FOLLOW_UP",request_key:cmd.request_key})).change,saved.change);
 await new FollowUpDueService({db,now:()=>Date.parse("2026-09-14T06:00:00Z")}).processDue({organization_id:org.id});
 const tasks=await resumed.listFollowUps(scope);assert.equal(tasks.follow_ups.length,1);assert.equal(tasks.follow_ups[0].due_at,"2026-09-14T04:30:00.000Z");assert.equal(tasks.follow_ups[0].status,"DUE");
 assert.equal((await resumed.createFollowUp(cmd)).replayed,true);assert.equal(Number((await db.get("SELECT count(*) n FROM actions")).n),0);assert.equal(Number((await db.get("SELECT count(*) n FROM action_executions")).n),0);
});

test("scoped conversation message pages preserve exact content and never expose private payloads",async t=>{
 const f=await fixture(t),ids=[];
 for(let i=0;i<5;i++){const m=await f.incoming();ids.push(m.id);await f.db.run("UPDATE channel_messages SET body=?,subject=?,created_at=?,payload_json=? WHERE id=?",["Exact original body "+i,"Original subject "+i,"2026-09-13T01:00:00.000Z",JSON.stringify({api_key:"never-public-secret",payload:{provider_secret:"also-private"}}),m.id]);}
 const expected=[...ids].sort().reverse(),seen=[];let after=null;
 do{const page=await f.service.listConversationMessages({...f.scope,limit:"2",after_id:after});seen.push(...page.messages.map(m=>m.id));assert.ok(page.messages.every(m=>m.body.startsWith("Exact original body ")&&m.subject.startsWith("Original subject ")));assert.equal(JSON.stringify(page).includes("never-public-secret"),false);assert.equal(JSON.stringify(page).includes("provider_secret"),false);assert.ok(page.messages.every(m=>!Object.hasOwn(m,"payload")&&!Object.hasOwn(m,"payload_json")));after=page.next_after_id;if(!page.has_more)break;}while(after);
 assert.deepEqual(seen,expected);
 const other=await f.leads.createLead({organization_id:f.org.id,name:"Other history",email:"history@example.test",source:"MANUAL"});
 await assert.rejects(f.service.listConversationMessages({...f.scope,lead_id:other.id,after_id:ids[0]}),{code:"CUSTOMER_WORKFLOW_MESSAGE_UNAVAILABLE"});
});
test("malformed or oversized interpretation metadata does not hide valid original message content",async t=>{
 const f=await fixture(t),m=await f.incoming();
 for(const value of ["not-json",JSON.stringify({private:"x".repeat(262145)})]){
  await f.db.run("UPDATE channel_messages SET payload_json=? WHERE id=?",[value,m.id]);
  const page=await f.service.listConversationMessages(f.scope);assert.equal(page.messages[0].body,"A new customer reply.");assert.equal(page.messages[0].metadata_unavailable,true);assert.equal(page.messages[0].interpretation.review_required,true);assert.equal(Object.hasOwn(page.messages[0],"payload_json"),false);
 }
});
