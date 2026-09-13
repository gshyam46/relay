import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase} from "../src/database/database.js";
import {LeadsRepository} from "../src/modules/data-foundation/leadsRepository.js";
import {DispatchControlsService} from "../src/modules/outbound-automation/dispatchControlsService.js";
import {OperationalMetricsService,evaluateOperationalAlerts} from "../src/modules/operations/operationalMetrics.js";
import {runOperationalWorkload,timingSummary} from "../scripts/helpers/operationalWorkload.js";
async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Operational fixtures"}),actor={id:"ops-owner",role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Owner","ops-owner@example.test","synthetic","2026-09-13T00:00:00.000Z"]);
 const controls=new DispatchControlsService({db,globalEnabled:false,now:()=>Date.parse("2026-09-13T10:00:00Z")});
 return {db,org,actor,leads,service:new OperationalMetricsService(db,{dispatchControlsService:controls,now:()=>Date.parse("2026-09-13T10:00:00Z")})};
}
test("owner operational view is scoped, read-only and reuses truthful empty budget summaries",async t=>{
 const f=await fixture(t);await f.leads.createLead({organization_id:f.org.id,name:"Private visible only in domain",email:"private@example.test"});const foreign=await f.leads.createOrganization({name:"Foreign"});await f.leads.createLead({organization_id:foreign.id,name:"Foreign private"});
 const before=await f.db.get("SELECT count(*) n FROM audit_logs"),view=await f.service.get({organization_id:f.org.id,actor:f.actor});
 assert.equal(view.counts.leads,1);assert.equal(view.sending.hold_reason,"GLOBAL_DISPATCH_PAUSED");assert.equal(view.ai.admitted_attempts,0);assert.equal(view.ai.cost.estimated_usd,null);assert.deepEqual(view.alerts,[]);assert.equal(view.alert_delivery,"IN_APP_ONLY");assert.doesNotMatch(JSON.stringify(view),/private@example|Foreign private/);assert.deepEqual(await f.db.get("SELECT count(*) n FROM audit_logs"),before);
 await assert.rejects(f.service.get({organization_id:foreign.id,actor:f.actor}),{code:"OPERATIONS_OWNER_REQUIRED"});
 await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.actor.id]);await assert.rejects(f.service.get({organization_id:f.org.id,actor:f.actor}),{code:"OPERATIONS_OWNER_REQUIRED"});
});
test("fixed alert thresholds expose uncertainty, backlog and quota runbooks without authorizing work",async t=>{
 const f=await fixture(t),m=await f.service.get({organization_id:f.org.id,actor:f.actor});
 Object.assign(m.counts,{mandatory_policy_pending:1,uncertain_sends:1,webhooks_review:1,events_retrying:1,analysis_unfinished:1,overdue_follow_ups:1,workflow_blocked:1});Object.assign(m.oldest_age_seconds,{analysis:61,mandatory_policy:61,follow_up:86401});m.sending.usage.attempts_used=90;m.ai.admitted_attempts=90;
 const alerts=evaluateOperationalAlerts(m);assert.deepEqual(alerts.map(a=>a.code),["POLICY_BACKLOG","UNCERTAIN_SEND","RECEIPT_REVIEW","EVENT_RECOVERY","ANALYSIS_BACKLOG","FOLLOW_UP_OVERDUE","WORKFLOW_BLOCKED","SEND_BUDGET_NEAR_LIMIT","AI_BUDGET_NEAR_LIMIT"]);assert.ok(alerts.every(a=>/^[a-z-]+$/.test(a.runbook)&&["WARNING","CRITICAL"].includes(a.severity)));
 m.oldest_age_seconds.analysis=null;assert.ok(evaluateOperationalAlerts(m).some(a=>a.code==="OPERATIONAL_TIME_UNKNOWN"));assert.equal((await f.db.get("SELECT count(*) n FROM action_executions")).n,0);
});
test("latency summaries use explicit nearest-rank percentile and retain maximum",()=>{
 assert.deepEqual(timingSummary([10,1,2,5]),{count:4,p50_ms:2,p95_ms:10,max_ms:10});assert.equal(timingSummary([]).p95_ms,0);
});
test("isolated100-enquiry workload meets versioned local thresholds and proves bounded controls",{timeout:180000},async()=>{
 const report=await runOperationalWorkload();
 assert.equal(report.status,"PASS",JSON.stringify({checks:report.checks,counts:report.row_counts,current:report.current_reads,timing:report.timing}));
 assert.equal(report.scope.enquiries,100);assert.deepEqual(report.scope.tenant_sizes,[90,10]);assert.equal(report.scope.production_capacity_claim,false);
 assert.equal(report.network_attempts,0);assert.equal(report.row_counts.send_attempts,0);assert.equal(report.row_counts.ai_attempts,0);assert.ok(report.noisy_remaining_when_small_completed>0);assert.ok(Object.values(report.checks).every(Boolean));
});

test("persisted uncertain sends, retry holds and overdue reminders produce scoped alerts",async t=>{
 const f=await fixture(t),lead=await f.leads.createLead({organization_id:f.org.id,name:"Synthetic operational source",email:"ops-source@example.test"});
 const {ActionsRepository}=await import("../src/modules/outbound-automation/actionsRepository.js"),{EventsRepository}=await import("../src/modules/events/eventsRepository.js");
 const action=await new ActionsRepository(f.db).createAction({organization_id:f.org.id,lead_id:lead.id,type:"SEND_EMAIL",payload:{subject:"Private body",message:"Not public operational metadata"},idempotency_key:"ops-uncertain",status:"FAILED",approval_requirement:"REQUIRED",provider:"sandbox"});
 await f.db.run("INSERT INTO action_executions(id,action_id,status,attempt,provider,idempotency_key,started_at,outcome_class) VALUES(?,?,'FAILED',1,'sandbox',?,?,'UNCERTAIN')",["ops-execution",action.id,"ops-attempt","2026-09-11T00:00:00.000Z"]);
 const event=await new EventsRepository(f.db).publish({organization_id:f.org.id,lead_id:lead.id,type:"LeadCreated"});
 await f.db.run("UPDATE domain_events SET status='RETRY_PENDING',processing_hold_reason='SYNTHETIC_REVIEW' WHERE id=?",[event.id]);
 await f.db.run("INSERT INTO follow_up_tasks(id,organization_id,lead_id,channel,status,due_at,reason,idempotency_key,created_at,updated_at) VALUES(?,?,?,'HUMAN_TASK','DUE',?,?,?,?,?)",["ops-follow",f.org.id,lead.id,"2026-09-11T00:00:00.000Z","Synthetic overdue task","ops-follow","2026-09-11T00:00:00.000Z","2026-09-11T00:00:00.000Z"]);
 const result=await f.service.get({organization_id:f.org.id,actor:f.actor});
 assert.equal(result.counts.uncertain_sends,1);assert.equal(result.counts.events_retrying,1);assert.equal(result.counts.events_held,1);assert.equal(result.counts.overdue_follow_ups,1);assert.equal(result.oldest_age_seconds.follow_up,208800);
 for(const code of ["UNCERTAIN_SEND","EVENT_RECOVERY","FOLLOW_UP_OVERDUE"])assert.ok(result.alerts.some(a=>a.code===code));
 assert.doesNotMatch(JSON.stringify(result),/Private body|Not public|ops-source@example/);
 await assert.rejects(f.service.get({organization_id:f.org.id,actor:{role:"OWNER"}}),{code:"OPERATIONS_OWNER_REQUIRED"});
});
