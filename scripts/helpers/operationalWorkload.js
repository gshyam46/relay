import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {createDatabase} from "../../src/database/database.js";
import {loadConfig} from "../../src/config.js";
import {createServices} from "../../src/api/app.js";
import {createNullLogger} from "../../src/shared/logger.js";
import {safeTestEnvironment,assertNoLiveProviders} from "./testSafety.js";
import {readIntelligenceView} from "../../src/modules/lead-intelligence/intelligenceReadView.js";
import {OperationalMetricsService,evaluateOperationalAlerts} from "../../src/modules/operations/operationalMetrics.js";
import {DispatchControlsService} from "../../src/modules/outbound-automation/dispatchControlsService.js";
import {ActionExecutor} from "../../src/modules/handlers/actionExecutor.js";
import {EventsRepository} from "../../src/modules/events/eventsRepository.js";
import {ContactPolicyService} from "../../src/modules/contact-policy/contactPolicyService.js";
export const OPERATIONAL_WORKLOAD_VERSION="l5.03-local-100-v1";
export const WORKLOAD_THRESHOLDS=Object.freeze({total_ms:120000,read_p95_ms:1000,tick_p95_ms:5000,max_ticks:400});
export function timingSummary(samples){const values=[...samples].sort((a,b)=>a-b),p=n=>values.length?values[Math.max(0,Math.ceil(values.length*n)-1)]:0;return {count:values.length,p50_ms:round(p(.5)),p95_ms:round(p(.95)),max_ms:round(values.at(-1)||0)};}
const round=n=>Math.round(n*100)/100;
const assert=(value,code)=>{if(!value)throw Object.assign(new Error("Synthetic operational acceptance failed."),{code});};
export async function runOperationalWorkload(){
 assertNoLiveProviders();
 if(process.env.DATABASE_URL||process.env.NODE_OPTIONS)throw Object.assign(new Error("Operational workload requires the sanitized launcher."),{code:"OPERATIONS_UNSAFE_ENVIRONMENT"});
 const parent=path.resolve(tmpdir()),directory=await mkdtemp(path.join(parent,"l503-workload-")),file=path.join(directory,"workload.sqlite");
 let db,services,networkAttempts=0;const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{networkAttempts++;throw new Error("External network is forbidden in this workload.");};
 try{
  db=await createDatabase(file);
  const config=loadConfig({...safeTestEnvironment(),DATABASE_FILE:file,OUTBOUND_DISPATCH_ENABLED:"false",WORKER_ENABLED:"false"});
  services=createServices(db,createNullLogger(),config,{aiProvider:null});
  const metricsService=new OperationalMetricsService(db,{dispatchControlsService:services.dispatchControlsService});
  const timings={import:[],tick:[],read:[]},started=performance.now(),tenants=[],allLeads=[];
  const measured=async(kind,work)=>{const at=performance.now();try{return await work();}finally{timings[kind].push(performance.now()-at);}};
  for(const [label,size]of [["NOISY",90],["SMALL",10]]){
   const org=await services.leadsRepository.createOrganization({name:"Synthetic "+label}),actor={id:"ops-owner-"+org.id,role:"OWNER"};
   await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Synthetic owner",actor.id+"@example.test","synthetic-never-authenticate",new Date().toISOString()]);
   const csv="Name,Email,Company\n"+Array.from({length:size},(_,i)=>"Synthetic "+label+" "+i+","+label.toLowerCase()+i+"@example.test,Company "+label+" "+i).join("\n");
   let batch=await measured("import",()=>services.importsService.previewCsv({organization_id:org.id,actor,filename:label+".csv",csv_text:csv,default_phone_region:"INTERNATIONAL_ONLY",mapping:{name:0,email:1,company:2},options:{date_format:"DMY",default_currency:"INR",assertion:"OPERATOR_OBSERVED"}}));
   const selected=batch.rows.filter(r=>r.can_commit).map(r=>r.id);assert(selected.length===size,"WORKLOAD_IMPORT_SELECTION");
   while(batch.state!=="COMMITTED")batch=await measured("import",()=>services.importsService.commitImport({organization_id:org.id,actor,import_id:batch.import_id,expected_revision:batch.review_revision,selected_row_ids:selected}));
   const leads=await db.all("SELECT * FROM leads WHERE organization_id=? ORDER BY id",[org.id]);
   assert(leads.length===size,"WORKLOAD_IMPORT_COUNT");
   const tenant={label,size,org,actor,leads,jobs:[],first_visit_tick:null,completed_tick:null};
   for(let start=0;start<leads.length;start+=50){
    const {job}=await services.analysisJobsService.enqueue({organization_id:org.id,actor,request_key:"workload-"+start,lead_ids:leads.slice(start,start+50).map(l=>l.id),mode:"ANALYSIS_ONLY",target_stage:"PLAN"});tenant.jobs.push(job.id);
   }
   const {campaign}=await services.workflowsService.createCampaign({organization_id:org.id,name:"Synthetic internal workflow"});
   const {sequence}=await services.workflowsService.createSequence({organization_id:org.id,campaign_id:campaign.id,name:"Review imported enquiry",steps:[{type:"CREATE_HUMAN_TASK",title:"Review this synthetic enquiry",delay_hours:0}]});
   await services.workflowsService.enrollLeads({organization_id:org.id,sequence_id:sequence.id,lead_ids:leads.slice(0,5).map(l=>l.id)});
   for(const lead of leads.slice(0,5)){
    const scope={organization_id:org.id,actor,lead_id:lead.id},view=await services.customerWorkflowService.listFollowUps(scope);
    await services.customerWorkflowService.createFollowUp({...scope,request_key:"due-"+lead.id,review_token:view.review_token,due_at:new Date(Date.now()+1000).toISOString(),reason:"Synthetic due reminder",reply_to_message_id:null});
   }
   tenants.push(tenant);allLeads.push(...leads);
  }
  const backlog=[],first=await Promise.all(tenants.map(t=>metricsService.get({organization_id:t.org.id,actor:t.actor})));
  let ticks=0,noisyRemainingWhenSmallCompleted=null;
  for(;ticks<WORKLOAD_THRESHOLDS.max_ticks;ticks++){
   assert(performance.now()-started<WORKLOAD_THRESHOLDS.total_ms,"WORKLOAD_DURATION_LIMIT");
   const result=await measured("tick",()=>services.worker.runOnce());
   assert(!result.visits.some(v=>v.phases.some(p=>p.error_code)),"WORKLOAD_PHASE_FAILED");
   for(const tenant of tenants){
    if(tenant.first_visit_tick===null&&result.visits.some(v=>v.organization_id===tenant.org.id))tenant.first_visit_tick=ticks+1;
    const pending=Number((await db.get("SELECT count(*) n FROM analysis_job_items i JOIN domain_events e ON e.organization_id=i.organization_id AND e.id=i.event_id WHERE i.organization_id=? AND e.status<>'PROCESSED'",[tenant.org.id])).n);
    if(pending===0&&tenant.completed_tick===null){tenant.completed_tick=ticks+1;if(tenant.label==="SMALL")noisyRemainingWhenSmallCompleted=Number((await db.get("SELECT count(*) n FROM domain_events WHERE organization_id=? AND status IN ('PENDING','PROCESSING','RETRY_PENDING')",[tenants[0].org.id])).n);}
   }
   const pending=Number((await db.get("SELECT count(*) n FROM domain_events WHERE status IN ('PENDING','PROCESSING','RETRY_PENDING')")).n);
   if((ticks+1)%10===0||pending===0)backlog.push({tick:ticks+1,pending_events:pending});
   if(pending===0){ticks++;break;}
  }
  const jobCounts={completed:0,failed:0,reused_items:0};
  for(const tenant of tenants)for(const id of tenant.jobs){const {job}=await services.analysisJobsService.get({organization_id:tenant.org.id,job_id:id});jobCounts.completed+=job.counts.completed;jobCounts.failed+=job.counts.failed;jobCounts.reused_items+=job.items.filter(i=>i.reused).length;}
  let current=0;
  for(const lead of allLeads){const view=await measured("read",()=>readIntelligenceView(db,lead));if(view.currentness.state==="CURRENT"&&view.synthesis&&view.recommendation&&view.next_best_action)current++;}
  const status=await Promise.all(tenants.map(t=>metricsService.get({organization_id:t.org.id,actor:t.actor})));
  const summary=async table=>Number((await db.get("SELECT count(*) n FROM "+table)).n);
  const rowCounts={leads:await summary("leads"),snapshots:await summary("intelligence_snapshots"),syntheses:await summary("intelligence_synthesis_runs"),recommendations:await summary("intelligence_recommendation_runs"),plans:await summary("next_best_action_plans"),analysis_items:await summary("analysis_job_items"),workflow_runs:await summary("workflow_runs"),workflow_actions:Number((await db.get("SELECT count(*) n FROM actions WHERE workflow_run_id IS NOT NULL")).n),due_manual_reminders:Number((await db.get("SELECT count(*) n FROM follow_up_tasks WHERE idempotency_key LIKE 'manual-reminder:%' AND status='DUE'")).n),ai_attempts:await summary("ai_provider_attempts"),send_attempts:Number((await db.get("SELECT count(*) n FROM action_executions e JOIN actions a ON a.id=e.action_id WHERE a.type LIKE 'SEND_%'")).n),human_task_executions:Number((await db.get("SELECT count(*) n FROM action_executions e JOIN actions a ON a.id=e.action_id WHERE a.type='CREATE_HUMAN_TASK'")).n)};
  const mainTotal=performance.now()-started;
  const drill=await verifyControls(db,services,tenants[0]);
  const injection=structuredClone(status[0]);Object.assign(injection.counts,{mandatory_policy_pending:1,uncertain_sends:1,webhooks_review:1,events_retrying:1,analysis_unfinished:1,overdue_follow_ups:1,workflow_blocked:1});Object.assign(injection.oldest_age_seconds,{analysis:61,mandatory_policy:61,follow_up:86401});injection.sending.usage.attempts_used=injection.sending.controls.daily_attempt_limit;injection.ai.admitted_attempts=injection.ai.limits.max_daily_attempts;
  const alertInjection=evaluateOperationalAlerts(injection),timing=Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,timingSummary(v)]));
  const checks={
   exact_import_and_analysis:rowCounts.leads===100&&jobCounts.completed===100&&jobCounts.failed===0&&current===100,
   main_backlog_drained:status.every(s=>s.counts.analysis_unfinished===0&&s.counts.events_pending===0&&s.counts.events_retrying===0),
   bounded_duration:mainTotal<=WORKLOAD_THRESHOLDS.total_ms,
   bounded_reads:timing.read.p95_ms<=WORKLOAD_THRESHOLDS.read_p95_ms,
   bounded_ticks:timing.tick.p95_ms<=WORKLOAD_THRESHOLDS.tick_p95_ms&&ticks<=WORKLOAD_THRESHOLDS.max_ticks,
   tenant_fairness:tenants.every(t=>t.first_visit_tick!==null&&t.first_visit_tick<=2)&&noisyRemainingWhenSmallCompleted>0,
   internal_workflows_and_due_tasks:rowCounts.workflow_runs===10&&rowCounts.workflow_actions===10&&rowCounts.due_manual_reminders===10,
   no_external_work:rowCounts.send_attempts===0&&rowCounts.ai_attempts===0&&networkAttempts===0,
   controls_held:drill.global_hold&&drill.workspace_hold&&drill.ai_pause_hold&&drill.created_send_attempts===0,
   alerts_detected:alertInjection.length===9&&alertInjection.every(a=>a.runbook&&a.severity)
  };
  return {version:OPERATIONAL_WORKLOAD_VERSION,generated_at:new Date().toISOString(),status:Object.values(checks).every(Boolean)?"PASS":"FAIL",scope:{database:"OWNED_TEMPORARY_SQLITE",enquiries:100,tenant_sizes:[90,10],intelligence:"DETERMINISTIC",network:"FORBIDDEN",application_http:false,production_capacity_claim:false},node_version:process.version,thresholds:WORKLOAD_THRESHOLDS,timing:{...timing,total_ms:round(mainTotal)},ticks,checks,row_counts:rowCounts,jobs:jobCounts,current_reads:current,backlog,tenants:tenants.map((t,i)=>({label:t.label,rows:t.size,first_visit_tick:t.first_visit_tick,completed_tick:t.completed_tick,initial_backlog:first[i].counts.analysis_unfinished,final_backlog:status[i].counts.analysis_unfinished,ai:status[i].ai,sending:status[i].sending})),noisy_remaining_when_small_completed:noisyRemainingWhenSmallCompleted,control_drill:drill,alert_injection:alertInjection,network_attempts:networkAttempts};
 }finally{
  globalThis.fetch=originalFetch;services?.worker.stop();await services?.worker.drain();services?.actionExecutor.stopAccepting();await services?.actionExecutor.drain();await db?.close();
  assert(path.dirname(path.resolve(directory))===parent&&path.basename(directory).startsWith("l503-workload-"),"WORKLOAD_CLEANUP_SCOPE");await rm(directory,{recursive:true,force:true});
 }
}
async function verifyControls(db,services,tenant){
 const {org,actor,leads}=tenant,lead=leads[0],scope={organization_id:org.id,actor,lead_id:lead.id};
 const view=await services.composerService.get(scope),draft=await services.composerService.create({...scope,request_key:"workload-held-draft",review_token:view.review_token,acknowledge_pending:true,reason:"Synthetic kill-switch drill",kind:"NEW_MESSAGE",reply_to_message_id:null,subject:"Synthetic hold check",body:"This controlled fixture must never leave the process.",scheduled_at:null});
 const action=await services.actionsRepository.getAction(draft.command.action_id);
 await services.approvalsService.approveAction({organization_id:org.id,action_id:action.id,expected_revision_id:draft.prepared_revision.id,reviewer_user_id:actor.id,reviewer_note:"Synthetic exact review"});
 const global=await services.actionExecutor.execute(action);
 await services.dispatchControlsService.update({organization_id:org.id,actor:actor.id,expected_revision:0,paused:true,daily_attempt_limit:100,unresolved_limit:2,reason:"Synthetic incident pause"});
 const localControls=new DispatchControlsService({db,globalEnabled:true}),executor=new ActionExecutor({actionsRepository:services.actionsRepository,executionsRepository:services.executionsRepository,auditRepository:services.auditRepository,contactPolicyService:services.contactPolicyService,dispatchControlsService:localControls,adapter:{execute:async()=>{throw new Error("A held send reached its adapter.");}}});
 const workspace=await executor.execute(action);
 const controls=await services.aiInvocationService.getControls({organization_id:org.id});
 await services.aiInvocationService.updateControls({organization_id:org.id,actor,expected_revision:controls.controls.revision,paused:true,max_daily_attempts:controls.controls.max_daily_attempts,max_in_flight:controls.controls.max_in_flight,pricing:controls.controls.pricing,reason:"Synthetic AI incident pause"});
 const event=await new EventsRepository(db).publish({organization_id:org.id,lead_id:lead.id,type:"LeadImported",payload:{synthetic_operational_drill:true}});
 const claim=await new ContactPolicyService(db).withWorkspacePolicyTransaction(org.id,tx=>new EventsRepository(tx).claimInTransaction({organization_id:org.id,event_id:event.id,owner:"workload-budget-fixture",now:Date.now()}));
 let aiHeld=false;try{await services.aiInvocationService.admit({organization_id:org.id,lead_id:lead.id,purpose:"SYNTHESIS",origin:{kind:"DOMAIN_EVENT",id:event.id,fence:claim.processing_fence},provider:"synthetic",requested_model:"workload-only",pipeline_version:"workload",prompt_version:"workload",schema_version:"workload",request_fingerprint:"a".repeat(64),input_fingerprint:"b".repeat(64)});}catch(e){aiHeld=e.code==="AI_PAUSED";}
 return {global_hold:global.operations_hold==="GLOBAL_DISPATCH_PAUSED",workspace_hold:workspace.operations_hold==="WORKSPACE_DISPATCH_PAUSED",ai_pause_hold:aiHeld,created_send_attempts:Number((await db.get("SELECT count(*) n FROM action_executions WHERE action_id=?",[action.id])).n),phase:"SEPARATE_SYNTHETIC_CONTROL_DRILL"};
}
