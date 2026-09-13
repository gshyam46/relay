import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { WorkspaceDataLifecycleService } from "../src/modules/data-lifecycle/workspaceDataLifecycleService.js";
import { ERASURE_CONFIRMATION,MAX_WORKSPACE_BYTES } from "../src/modules/data-lifecycle/workspaceDataContract.js";
import { CUSTOMER_TABLES,scopeSql,identifier } from "../src/modules/data-lifecycle/workspaceDataInventory.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { ContactPolicyRepository } from "../src/modules/contact-policy/contactPolicyRepository.js";
import { canonicalContactsForLead } from "../src/modules/contact-policy/contactPolicyContract.js";
import { IntelligenceEvaluationService } from "../src/modules/intelligence-evaluation/evaluationService.js";
import { IntelligenceFeedbackService } from "../src/modules/intelligence-feedback/intelligenceFeedbackService.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { ExecutionsRepository } from "../src/modules/outbound-automation/executionsRepository.js";
import { WorkflowsRepository } from "../src/modules/workflows/workflowsRepository.js";
import { approveStoredAction } from "./helpers/review.js";
import { verifyPassword } from "../src/modules/auth/passwords.js";
const PASSWORD="synthetic-lifecycle-passphrase";
async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());const config=loadConfig({NODE_ENV:"test",ENABLE_TEST_CONTROLS:"false",WORKER_ENABLED:"false"}),services=createServices(db,undefined,config);
 const registered=await services.authService.register({organization_name:"Synthetic lifecycle",name:"Synthetic owner",email:randomUUID()+"@example.test",password:PASSWORD}),scope={organization_id:registered.organization.id,actor:registered.user,session_token:registered.session.id};
 const service=new WorkspaceDataLifecycleService(db),lead=await services.leadsRepository.createLead({organization_id:scope.organization_id,name:"Private customer",email:"customer@example.test",phone:"+14155552671",company:"Private Company"});
 const command=async(patch={})=>({...scope,request_key:randomUUID(),plan_token:(await service.previewErasure(scope)).plan_token,confirmation:ERASURE_CONFIRMATION,current_password:PASSWORD,...patch});
 const count=async table=>Number((await db.get("SELECT COUNT(*) n FROM "+identifier(table)+" WHERE "+scopeSql(table),[scope.organization_id])).n);
 return {db,services,service,scope,lead,command,count,registered};
}
async function snapshot(f){return Object.fromEntries(await Promise.all(["leads","organization_settings","contact_restrictions","workspace_dispatch_controls","workspace_data_erasures","audit_logs"].map(async t=>[t,await f.db.all("SELECT * FROM "+t+" WHERE organization_id=? ORDER BY 1",[f.scope.organization_id])])));}
async function draft(f){const scope={organization_id:f.scope.organization_id,actor:f.scope.actor,lead_id:f.lead.id},view=await f.services.composerService.get(scope);return f.services.composerService.create({...scope,request_key:randomUUID(),review_token:view.review_token,acknowledge_pending:false,kind:"NEW_MESSAGE",reply_to_message_id:null,reason:"Synthetic draft review",subject:"A private subject",body:"A private exact message",scheduled_at:null});}
async function feedbackDataset(f){
 const inbound=await new InboundMessageService({db:f.db,replyClassifier:new LocalReplyClassifier()}).receiveInboundEvent({organization_id:f.scope.organization_id,lead_id:f.lead.id,channel:"EMAIL",provider:"sandbox",provider_event_id:randomUUID(),payload:{text:"What is the price for private project REF-42?"}});
 const feedback=new IntelligenceFeedbackService(f.db),scope={organization_id:f.scope.organization_id,actor:f.scope.actor,lead_id:f.lead.id,target_kind:"REPLY",target_id:inbound.message.id},review=await feedback.review(scope),saved=await feedback.record({...scope,review_token:review.review_token,expected_feedback_revision:0,request_key:randomUUID(),operation:"RECORD",labels:{correctness:"CORRECT",usefulness:"USEFUL",expected_category:"QUESTION",eval_use:"SYNTHETIC"},reason:"Synthetic expected reply"});
 const evaluation=new IntelligenceEvaluationService(f.db),dataset=await evaluation.createDataset({organization_id:f.scope.organization_id,actor:f.scope.actor,name:"Protected test",split:"HOLDOUT",expected_version:0,request_key:randomUUID(),feedback_revisions:[{feedback_id:saved.feedback.id,revision:saved.feedback.revision}]});
 await evaluation.evaluate({organization_id:f.scope.organization_id,actor:f.scope.actor,dataset_id:dataset.id});return {dataset,inbound};
}
test("workspace export is scoped, omits operational secrets and protected membership, and keeps original canonical data",async t=>{
 const f=await fixture(t),protectedSet=await feedbackDataset(f),other=await f.services.leadsRepository.createOrganization({name:"Another tenant"});await f.services.leadsRepository.createLead({organization_id:other.id,name:"FOREIGN-UNIQUE",email:"foreign@example.test"});
 await f.services.settingsRepository.set(f.scope.organization_id,"channel_email","api_key","SECRET-PROVIDER-VALUE");
 await f.db.run("INSERT INTO audit_logs(id,organization_id,event_type,message,metadata_json,created_at) VALUES(?,?,'Synthetic','SECRET-AUDIT',?,?)",[randomUUID(),f.scope.organization_id,JSON.stringify({body:"SECRET-RAW-AUDIT"}),new Date().toISOString()]);
 const before=await snapshot(f),view=await f.service.export(f.scope),encoded=JSON.stringify(view),storedUser=await f.db.get("SELECT password_hash FROM users WHERE id=?",[f.scope.actor.id]);
 for(const secret of ["FOREIGN-UNIQUE","SECRET-PROVIDER-VALUE","SECRET-RAW-AUDIT","SECRET-AUDIT",storedUser.password_hash,f.scope.session_token,protectedSet.dataset.id])assert.equal(encoded.includes(secret),false,secret);
 assert.equal(view.records.leads[0].name,"Private customer");assert.ok(view.records.channel_messages.some(m=>m.body.includes("REF-42")));assert.equal(Object.hasOwn(view.records,"intelligence_evaluation_members"),false);assert.equal(Object.hasOwn(view.records,"intelligence_evaluation_datasets"),false);
 assert.ok(view.manifest.inventory.tables.find(x=>x.table==='intelligence_evaluation_members').export_omissions.length);assert.deepEqual(await snapshot(f),before);
});
test("complete customer erasure removes derived and protected records, preserves account, and pauses/reset setup",async t=>{
 const f=await fixture(t);await feedbackDataset(f);await f.services.intelligenceService.runForLead(f.lead);await f.services.synthesisService.runForLead(f.lead);await f.services.intelligenceRecommendationService.runForLead(f.lead);await f.services.nextBestActionService.planForLead(f.lead);await draft(f);
 const account=await f.db.get("SELECT * FROM users WHERE id=?",[f.scope.actor.id]),result=await f.service.erase(await f.command());
 for(const table of CUSTOMER_TABLES)assert.equal(await f.count(table),table==='audit_logs'?1:0,table);
 assert.deepEqual(await f.db.get("SELECT * FROM users WHERE id=?",[f.scope.actor.id]),account);assert.ok(await f.db.get("SELECT id FROM sessions WHERE id=?",[f.scope.session_token]));
 assert.equal((await f.db.get("SELECT paused FROM workspace_dispatch_controls WHERE organization_id=?",[f.scope.organization_id])).paused,1);assert.equal(result.replayed,false);assert.equal(result.erasure.erased_counts.leads,1);assert.ok(result.erasure.erased_counts.intelligence_snapshots>0);
 assert.equal((await f.service.history(f.scope)).erasures.length,1);assert.ok((await f.service.export(f.scope)).manifest.restore_activation.includes("Independent"));
});
test("accepted same-key replay preserves newly created customer data and rejects changed intent",async t=>{
 const f=await fixture(t),command=await f.command(),first=await f.service.erase(command),newLead=await f.services.leadsRepository.createLead({organization_id:f.scope.organization_id,name:"New after erasure",email:"new@example.test"});
 const replay=await f.service.erase(command);assert.equal(replay.replayed,true);assert.deepEqual(replay.erasure,first.erasure);assert.ok(await f.services.leadsRepository.getLead(newLead.id,f.scope.organization_id));assert.equal(await f.count("workspace_data_erasures"),1);
 assert.equal((await f.service.byRequestKey({...f.scope,request_key:command.request_key})).erasure.id,first.erasure.id);
 await assert.rejects(f.service.erase({...command,plan_token:"f".repeat(64)}),{code:"WORKSPACE_DATA_REQUEST_CONFLICT"});assert.equal(await f.count("leads"),1);
});
test("stale customer changes and sender changes invalidate exact plans",async t=>{
 const f=await fixture(t),original=await f.command();await f.db.run("UPDATE leads SET company='Changed' WHERE id=?",[f.lead.id]);await assert.rejects(f.service.erase(original),{code:"WORKSPACE_DATA_PLAN_STALE"});
 const changed=await f.command();await f.services.settingsRepository.set(f.scope.organization_id,"channel_email","api_key","new-synthetic-secret");await assert.rejects(f.service.erase(changed),{code:"WORKSPACE_DATA_PLAN_STALE"});assert.equal(await f.count("leads"),1);assert.equal(await f.count("workspace_data_erasures"),0);
});
test("wrong password preserves account session, and foreign/stale authority cannot erase",async t=>{
 const f=await fixture(t),command=await f.command(),before=await snapshot(f);await assert.rejects(f.service.erase({...command,current_password:"incorrect"}),{statusCode:403,code:"AUTH_PASSWORD_REJECTED"});assert.ok(await f.db.get("SELECT id FROM sessions WHERE id=?",[f.scope.session_token]));assert.deepEqual(await snapshot(f),before);
 const other=await f.services.leadsRepository.createOrganization({name:"Other"});await assert.rejects(f.service.export({...f.scope,organization_id:other.id}),{statusCode:401});
 await f.db.run("UPDATE users SET auth_revision=auth_revision+1 WHERE id=?",[f.scope.actor.id]);await assert.rejects(f.service.erase(command),{statusCode:401});assert.equal(await f.count("leads"),1);
});
test("authentication changed during password work cannot commit an old erasure",async t=>{
 const f=await fixture(t),command=await f.command();let release,enter;const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);const service=new WorkspaceDataLifecycleService(f.db,{passwords:{async verifyPassword(value,hash){enter();await waiting;return verifyPassword(value,hash);}}});
 const pending=service.erase(command);await entered;await f.db.run("UPDATE users SET auth_revision=auth_revision+1 WHERE id=?",[f.scope.actor.id]);release();await assert.rejects(pending,{statusCode:401});assert.equal(await f.count("workspace_data_erasures"),0);
});
test("atomic failure after cycle detachment restores customer records, restrictions and controls",async t=>{
 const f=await fixture(t);await draft(f);const command=await f.command(),before=await snapshot(f),revisions=await f.db.all("SELECT * FROM action_revisions");
 await f.db.exec("CREATE TRIGGER synthetic_lifecycle_failure BEFORE DELETE ON leads BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");await assert.rejects(f.service.erase(command),/synthetic rollback/);assert.deepEqual(await snapshot(f),before);assert.deepEqual(await f.db.all("SELECT * FROM action_revisions"),revisions);assert.equal(await f.count("workspace_data_erasures"),0);
 await f.db.exec("DROP TRIGGER synthetic_lifecycle_failure");assert.equal((await f.service.erase(command)).replayed,false);
});
test("retained direct and lead-scoped restrictions survive reimport without original customer references",async t=>{
 const f=await fixture(t),policy=new ContactPolicyService(f.db);await policy.restrictContact({organization_id:f.scope.organization_id,contact:{kind:"EMAIL",value:"old@example.test"},channel:"EMAIL",reason:"UNSUBSCRIBE",source:"MANUAL",source_event_id:"PRIVATE-OLD-SOURCE"});
 await policy.restrictLead({organization_id:f.scope.organization_id,lead_id:f.lead.id,channel:"ALL",reason:"OPT_OUT",source:"MANUAL",source_event_id:"PRIVATE-LEAD-SOURCE"});
 const result=await f.service.erase(await f.command()),saved=await f.db.all("SELECT * FROM contact_restrictions WHERE organization_id=?",[f.scope.organization_id]);assert.ok(result.erasure.retained_suppression_count>=3);assert.equal(JSON.stringify(saved).includes("PRIVATE-"),false);assert.ok(saved.every(r=>r.lead_id===null&&r.actor_id===null&&r.source==='MANUAL'&&r.contact_kind!=='LEAD'));
 const recreated=await f.services.leadsRepository.createLead({organization_id:f.scope.organization_id,name:"Reimport",email:f.lead.email,phone:f.lead.phone});const restrictions=await new ContactPolicyRepository(f.db).restrictionsFor(f.scope.organization_id,canonicalContactsForLead(recreated),"EMAIL");assert.ok(restrictions.some(r=>r.reason==='OPT_OUT'));
 const other=await f.services.leadsRepository.createOrganization({name:"Foreign suppression"});assert.deepEqual(await new ContactPolicyRepository(f.db).restrictionsFor(other.id,canonicalContactsForLead(recreated),"EMAIL"),[]);
});
test("metadata bounds reject oversized legacy fields before loading them",async t=>{
 const f=await fixture(t);await f.db.run("UPDATE leads SET source_metadata_json=? WHERE id=?",['x'.repeat(MAX_WORKSPACE_BYTES+1),f.lead.id]);const view=await f.service.inspect(f.scope);assert.equal(view.can_export,false);assert.equal(view.can_erase,false);
 const original=f.db.transaction.bind(f.db);let loaded=false;f.db.transaction=(work,opts)=>original(async tx=>{const all=tx.all.bind(tx);tx.all=(sql,args)=>{if(/^SELECT \"/.test(sql)&&sql.includes('FROM "leads"'))loaded=true;return all(sql,args);};return work(tx);},opts);
 await assert.rejects(f.service.export(f.scope),{code:"WORKSPACE_DATA_LIMIT"});await assert.rejects(f.service.previewErasure(f.scope),{code:"WORKSPACE_DATA_LIMIT"});assert.equal(loaded,false);assert.equal(await f.count("workspace_data_erasures"),0);
});
test("unreviewed new schema columns refuse export and erasure",async t=>{
 const f=await fixture(t);await f.db.exec("ALTER TABLE leads ADD COLUMN synthetic_unreviewed_secret TEXT");await assert.rejects(f.service.export(f.scope),{code:"WORKSPACE_DATA_INVENTORY_CHANGED"});await assert.rejects(f.service.previewErasure(f.scope),{code:"WORKSPACE_DATA_INVENTORY_CHANGED"});
});

async function insert(db,table,row){const keys=Object.keys(row);await db.run('INSERT INTO '+identifier(table)+'('+keys.map(identifier).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',Object.values(row));}
async function execution(f,{outcome_class='DELIVERED',status='COMPLETED'}={}){const saved=await draft(f),action=await f.services.actionsRepository.getAction(saved.command.action_id),row=await new ExecutionsRepository(f.db).createExecution({action_id:action.id,status,attempt:1,provider:'sandbox',idempotency_key:randomUUID(),action_revision_id:saved.prepared_revision.id,envelope_hash:saved.prepared_revision.content_hash,outcome_class,dispatch_authorized_at:new Date().toISOString()});await f.db.run("UPDATE actions SET active_execution_id=?,status=? WHERE id=?",[row.id,status==='COMPLETED'?'COMPLETED':'EXECUTING',action.id]);return {action,row};}
test("indirect executions and all action/workflow pointer cycles erase without touching another tenant",async t=>{
 const f=await fixture(t),own=await execution(f),repo=new WorkflowsRepository(f.db),org=f.scope.organization_id,campaign=await repo.createCampaign({organization_id:org,name:'Campaign'}),sequence=await repo.createSequence({organization_id:org,campaign_id:campaign.id,name:'Sequence',steps:[{type:'SEND_EMAIL',title:'Message'}]});
 const run=await repo.enrollLead({organization_id:org,campaign_id:campaign.id,sequence_id:sequence.id,lead_id:f.lead.id,idempotency_key:randomUUID(),next_run_at:new Date().toISOString()});
 await f.db.run('UPDATE actions SET workflow_run_id=?,sequence_step_id=? WHERE id=?',[run.id,sequence.steps[0].id,own.action.id]);await f.db.run('UPDATE workflow_runs SET last_action_id=? WHERE id=?',[own.action.id,run.id]);
 const other=await f.services.leadsRepository.createOrganization({name:'Foreign'}),lead=await f.services.leadsRepository.createLead({organization_id:other.id,name:'Foreign customer'}),action=await f.services.actionsRepository.createAction({organization_id:other.id,lead_id:lead.id,type:'CREATE_TASK',idempotency_key:randomUUID()});
 const foreign=await new ExecutionsRepository(f.db).createExecution({action_id:action.id,status:'COMPLETED',attempt:1,provider:'sandbox',idempotency_key:randomUUID(),outcome_class:'DELIVERED'});
 const exported=await f.service.export(f.scope);assert.equal(exported.records.action_executions.length,1);assert.equal(exported.records.action_executions[0].id,own.row.id);
 const result=await f.service.erase(await f.command());assert.equal(result.erasure.erased_counts.action_executions,1);assert.equal(result.erasure.erased_counts.workflow_runs,1);assert.ok(await f.db.get('SELECT id FROM action_executions WHERE id=?',[foreign.id]));assert.ok(await f.db.get('SELECT id FROM leads WHERE id=?',[lead.id]));assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'),[]);
});
test("uncertain and legacy provider attempts remain erasure holds even after their leases expire",async t=>{
 const f=await fixture(t),{action,row}=await execution(f,{outcome_class:'DISPATCHING',status:'STARTED'});
 for(const outcome of ['DISPATCHING','UNCERTAIN','LEGACY_UNKNOWN']){await f.db.run("UPDATE action_executions SET outcome_class=?,status='STARTED',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",[outcome,row.id]);await f.db.run("UPDATE actions SET status='BLOCKED' WHERE id=?",[action.id]);const view=await f.service.previewErasure(f.scope);assert.equal(view.can_erase,false);assert.ok(view.holds.some(h=>h.code==='WORKSPACE_DATA_PROVIDER_ACTIVE'));await assert.rejects(f.service.erase({...await f.command(),plan_token:view.plan_token}),{code:'WORKSPACE_DATA_PROVIDER_ACTIVE'});assert.equal(await f.count('leads'),1);}
});
test("actual delayed Sandbox execution cannot race erasure and its settled outcome remains recorded",async t=>{
 const f=await fixture(t),saved=await draft(f),action=await f.services.actionsRepository.getAction(saved.command.action_id);await approveStoredAction(f.services,action);
 let enter,release;const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r),original=f.services.actionExecutor.adapter;
 f.services.actionExecutor.adapter={async invoke(...args){enter();await waiting;return original.invoke(...args);}};
 const running=f.services.actionExecutor.execute(action);await Promise.race([entered,running.then(()=>{throw new Error("Synthetic provider was not invoked");})]);const preview=await f.service.previewErasure(f.scope);assert.equal(preview.can_erase,false);await assert.rejects(f.service.erase({...await f.command(),plan_token:preview.plan_token}),{code:'WORKSPACE_DATA_PROVIDER_ACTIVE'});assert.equal(await f.count('leads'),1);release();await running;assert.equal((await new ExecutionsRepository(f.db).latestForAction(action.id)).outcome_class,'ACCEPTED');
});
test("processing events, receipts, pending policy and scheduler claims hold erasure even at expired timestamps",async t=>{
 const f=await fixture(t),org=f.scope.organization_id,event=await f.services.eventsRepository.publish({organization_id:org,lead_id:f.lead.id,type:'Synthetic',payload:{}}),base=await f.command();
 await f.db.run("UPDATE domain_events SET status='PROCESSING',lease_owner='synthetic',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",[event.id]);await assert.rejects(f.service.erase(base),{code:'WORKSPACE_DATA_EVENT_ACTIVE'});await f.db.run("UPDATE domain_events SET status='DISMISSED',lease_owner=NULL WHERE id=?",[event.id]);
 const receipt=await f.services.webhookInbox.receive({organization_id:org,provider:'sandbox',connection_key:'internal',event_kind:'INBOUND_MESSAGE',provider_event_id:randomUUID(),verification_kind:'TRUSTED_INTERNAL',input:{organization_id:org,lead_id:f.lead.id,channel:'EMAIL',provider:'sandbox',provider_event_id:randomUUID(),payload:{text:'Question?'}}});
 await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_POLICY_PENDING'});await f.db.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE',processing_state='PROCESSING',lease_owner='synthetic',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",[receipt.row.id]);await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_RECEIPT_ACTIVE'});
 await f.db.run("UPDATE webhook_receipts SET processing_state='DISMISSED',lease_owner=NULL WHERE id=?",[receipt.row.id]);await f.db.run("INSERT INTO scheduler_workspaces(organization_id,next_phase,visit_fence,lease_owner,lease_expires_at) VALUES (?,0,1,'synthetic','2000-01-01T00:00:00.000Z')",[org]);await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_SCHEDULER_ACTIVE'});assert.equal(await f.count('workspace_data_erasures'),0);
});
test("AI admission and interrupted verification checks never become erasable solely through elapsed time",async t=>{
 const f=await fixture(t),org=f.scope.organization_id,at='2000-01-01T00:00:00.000Z',event=await f.services.eventsRepository.publish({organization_id:org,lead_id:f.lead.id,type:'AnalysisRequested',payload:{}}),id=randomUUID();
 await insert(f.db,'ai_provider_attempts',{id,organization_id:org,lead_id:f.lead.id,purpose:'SYNTHESIS',domain_event_id:event.id,origin_fence:1,invocation_key:'1'.repeat(64),authorization_hash:'2'.repeat(64),request_fingerprint:'3'.repeat(64),input_fingerprint:'4'.repeat(64),pipeline_version:'synthetic',prompt_version:'synthetic',schema_version:'synthetic',provider:'synthetic',requested_model:'synthetic',authorized_at:at,budget_day:'2000-01-01',deadline_at:at,request_state:'ADMITTED',pricing_revision:0});
 for(const state of ['ADMITTED','UNCONFIRMED']){await f.db.run('UPDATE ai_provider_attempts SET request_state=? WHERE id=?',[state,id]);await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_AI_ACTIVE'});}
 await f.db.run("UPDATE ai_provider_attempts SET request_state='OBSERVED' WHERE id=?",[id]);const run=randomUUID();await insert(f.db,'email_verification_runs',{id:run,organization_id:org,request_key:randomUUID(),request_hash:'1'.repeat(64),connection_revision:1,config_fingerprint:'2'.repeat(64),runtime_fingerprint:'3'.repeat(64),delivery_recipient:'control@example.test',failure_recipient:'failure@example.test',reply_to:'reply@example.test',nonce:'x'.repeat(43),created_at:at,created_by:f.scope.actor.id,reason:'Synthetic run'});
 await insert(f.db,'email_verification_checks',{id:randomUUID(),organization_id:org,verification_id:run,check_number:1,request_key:randomUUID(),request_hash:'4'.repeat(64),state:'RUNNING',started_at:at,lease_expires_at:at,checks_json:'[]'});await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_CHECK_ACTIVE'});assert.equal(await f.count('workspace_data_erasures'),0);
});
test("reviewed import source rows, outcome links and routing credentials are erased together",async t=>{
 const f=await fixture(t),org=f.scope.organization_id,preview=await f.services.importsService.previewCsv({organization_id:org,actor:f.scope.actor,filename:'synthetic.csv',csv_text:'name,email,company\nImported,imported@example.test,Private Source',default_phone_region:'INTERNATIONAL_ONLY'});
 await f.services.importsService.commitImport({organization_id:org,actor:f.scope.actor,import_id:preview.import_id,selected_row_ids:preview.rows.map(r=>r.id),expected_revision:preview.review_revision});
 const scope={organization_id:org,actor:f.scope.actor},before=await f.services.emailConnectionService.get(scope);await f.services.emailConnectionService.provisionRoute({...scope,expected_revision:before.revision,review_token:before.review_token,request_key:randomUUID(),reason:'Synthetic route'});
 const exported=await f.service.export(f.scope);assert.ok(exported.records.import_rows[0].raw_row_json.includes('Private Source'));assert.equal(Object.hasOwn(exported.records,'email_webhook_routes'),false);const result=await f.service.erase(await f.command());assert.equal(result.erasure.erased_counts.import_row_outcomes,1);assert.ok(result.erasure.erased_counts.email_webhook_routes>0);assert.equal(await f.count('organization_settings'),0);assert.equal(await f.count('email_connection_revisions'),0);
});
test("history cursors are scoped and exact accepted requests remain recoverable",async t=>{
 const f=await fixture(t),one=await f.service.erase(await f.command()),two=await f.service.erase(await f.command()),page=await f.service.history({...f.scope,limit:1});assert.equal(page.erasures[0].id,two.erasure.id);assert.ok(page.next_cursor);const next=await f.service.history({...f.scope,limit:1,cursor:page.next_cursor});assert.equal(next.erasures[0].id,one.erasure.id);assert.equal(next.next_cursor,null);await assert.rejects(f.service.history({...f.scope,cursor:'invalid'}),{code:'WORKSPACE_DATA_INPUT_INVALID'});
 await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.scope.actor.id]);await assert.rejects(f.service.inspect({...f.scope,actor:{...f.scope.actor,role:'MEMBER'}}),{statusCode:403,code:'WORKSPACE_DATA_OWNER_REQUIRED'});
});

test("legacy retry flags without an execution row still preserve the unknown-outcome hold",async t=>{
 const f=await fixture(t),saved=await draft(f);await f.db.run("UPDATE actions SET status='RETRYING',execution_hold_reason='LEGACY_OUTCOME_REVIEW_REQUIRED' WHERE id=?",[saved.command.action_id]);assert.equal(await f.count('action_executions'),0);await assert.rejects(f.service.erase(await f.command()),{code:'WORKSPACE_DATA_PROVIDER_ACTIVE'});assert.equal(await f.count('leads'),1);
});
test("row-count preflight and immutable erasure metadata fail closed",async t=>{
 const f=await fixture(t),org=f.scope.organization_id;await f.db.run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50000) INSERT INTO audit_logs(id,organization_id,event_type,message,metadata_json,created_at) SELECT 'synthetic-limit-'||i,?,'Synthetic','Synthetic','{}','2026-09-13T00:00:00.000Z' FROM n",[org]);
 const view=await f.service.inspect(f.scope);assert.equal(view.inventory.total_rows>50000,true);assert.equal(view.can_export,false);await assert.rejects(f.service.export(f.scope),{code:'WORKSPACE_DATA_LIMIT'});
 await f.db.run("DELETE FROM audit_logs WHERE organization_id=?",[org]);const saved=await f.service.erase(await f.command());await f.db.run("UPDATE workspace_data_erasures SET erased_counts_json=? WHERE id=?",[JSON.stringify({users:1}),saved.erasure.id]);await assert.rejects(f.service.history(f.scope),{code:'WORKSPACE_DATA_STATE_INVALID'});
});
test("completed erasure history remains ordered across clock rollback without expiring exact-state review",async t=>{
 const f=await fixture(t);let clock=Date.now();const service=new WorkspaceDataLifecycleService(f.db,{now:()=>clock});const firstCommand=await f.command(),first=await service.erase(firstCommand);clock-=1000;const preview=await service.previewErasure(f.scope),second=await service.erase({...firstCommand,request_key:randomUUID(),plan_token:preview.plan_token});assert.ok(second.erasure.completed_at>first.erasure.completed_at);assert.equal((await service.history(f.scope)).erasures[0].id,second.erasure.id);
});

test("closing future retry permission does not prove original provider finalization ended",async t=>{
 const f=await fixture(t),{action}=await execution(f,{outcome_class:'CLOSED_UNRESOLVED',status:'FAILED'});await f.db.run("UPDATE actions SET status='BLOCKED',execution_hold_reason='CLOSED_WITHOUT_RETRY' WHERE id=?",[action.id]);const preview=await f.service.previewErasure(f.scope);assert.equal(preview.can_erase,false);await assert.rejects(f.service.erase({...await f.command(),plan_token:preview.plan_token}),{code:'WORKSPACE_DATA_PROVIDER_ACTIVE'});assert.equal(await f.count('action_executions'),1);assert.equal(await f.count('workspace_data_erasures'),0);
});
