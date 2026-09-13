import {ContactPolicyService} from "../contact-policy/contactPolicyService.js";
import {AiInvocationService} from "../ai-usage/aiInvocationService.js";
const error=(code,statusCode)=>Object.assign(new Error("Operational status requires the current workspace owner and valid saved state."),{code,statusCode});
const rules=[
 ["POLICY_BACKLOG","CRITICAL","Mandatory contact policy is waiting","policy-backlog",m=>m.counts.mandatory_policy_pending>0&&m.oldest_age_seconds.mandatory_policy>=60],
 ["UNCERTAIN_SEND","CRITICAL","Provider outcomes need reconciliation","uncertain-send",m=>m.counts.uncertain_sends>0],
 ["RECEIPT_REVIEW","WARNING","Webhook receipts need review","policy-backlog",m=>m.counts.webhooks_review>0],
 ["EVENT_RECOVERY","WARNING","Background events need recovery","event-recovery",m=>m.counts.events_held+m.counts.events_retrying>0],
 ["ANALYSIS_BACKLOG","WARNING","Analysis work is waiting","analysis-backlog",m=>m.counts.analysis_unfinished>0&&m.oldest_age_seconds.analysis>=60],
 ["FOLLOW_UP_OVERDUE","WARNING","Human follow-ups are overdue","human-work",m=>m.counts.overdue_follow_ups>0&&m.oldest_age_seconds.follow_up>=86400],
 ["WORKFLOW_BLOCKED","WARNING","A workflow needs review","human-work",m=>m.counts.workflow_blocked>0],
 ["SEND_BUDGET_NEAR_LIMIT","WARNING","Daily sending allowance is nearly used","quota-review",m=>Number.isFinite(m.sending.controls.daily_attempt_limit)&&m.sending.controls.daily_attempt_limit>0&&m.sending.usage.attempts_used>=m.sending.controls.daily_attempt_limit*0.9],
 ["AI_BUDGET_NEAR_LIMIT","WARNING","Daily AI allowance is nearly used","quota-review",m=>m.ai.admitted_attempts>=m.ai.limits.max_daily_attempts*0.9]
];
export function evaluateOperationalAlerts(metrics){
 const result=rules.filter(r=>r[4](metrics)).map(([code,severity,title,runbook])=>({code,severity,title,runbook}));
 if([["analysis_unfinished","analysis"],["mandatory_policy_pending","mandatory_policy"],["overdue_follow_ups","follow_up"]].some(([count,age])=>metrics.counts[count]>0&&metrics.oldest_age_seconds[age]===null))result.push({code:"OPERATIONAL_TIME_UNKNOWN",severity:"WARNING",title:"A backlog has an unavailable timestamp",runbook:"event-recovery"});
 if(!metrics.sending.policy_valid)result.push({code:"SEND_CONTROLS_INVALID",severity:"CRITICAL",title:"Sending controls require review",runbook:"quota-review"});
 return result;
}
export class OperationalMetricsService{
 constructor(db,{dispatchControlsService,now=Date.now}={}){if(!dispatchControlsService)throw new TypeError("Operational metrics require current dispatch controls.");this.db=db;this.dispatchControlsService=dispatchControlsService;this.now=now;}
 async get({organization_id,actor}){
  if(typeof organization_id!=="string"||!organization_id.trim()||organization_id.length>256)throw error("OPERATIONS_SCOPE_INVALID",400);
  return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(organization_id,async tx=>{
   if(actor?.role!=="OWNER"||typeof actor.id!=="string"||!actor.id||actor.id.length>256||!(await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'",[organization_id,actor.id])))throw error("OPERATIONS_OWNER_REQUIRED",403);
   const time=this.now();if(!Number.isSafeInteger(time)||!Number.isFinite(new Date(time).getTime()))throw error("OPERATIONS_STATE_INVALID",409);
   const as_of=new Date(time).toISOString(),org=organization_id;
   const count=async(sql,params=[org])=>{const n=Number((await tx.get(sql,params)).n);if(!Number.isSafeInteger(n)||n<0)throw error("OPERATIONS_STATE_INVALID",409);return n;};
   const specs={
    leads:["SELECT count(*) n FROM leads WHERE organization_id=?"],
    events_pending:["SELECT count(*) n FROM domain_events WHERE organization_id=? AND status IN ('PENDING','PROCESSING')"],
    events_retrying:["SELECT count(*) n FROM domain_events WHERE organization_id=? AND status='RETRY_PENDING'"],
    events_held:["SELECT count(*) n FROM domain_events WHERE organization_id=? AND status NOT IN ('PROCESSED','DISMISSED') AND processing_hold_reason IS NOT NULL"],
    analysis_unfinished:["SELECT count(*) n FROM analysis_job_items i JOIN domain_events e ON e.organization_id=i.organization_id AND e.id=i.event_id WHERE i.organization_id=? AND e.status IN ('PENDING','PROCESSING','RETRY_PENDING')"],
    webhooks_pending:["SELECT count(*) n FROM webhook_receipts WHERE organization_id=? AND processing_state IN ('RECEIVED','PROCESSING','RETRY_PENDING')"],
    webhooks_review:["SELECT count(*) n FROM webhook_receipts WHERE organization_id=? AND processing_state='QUARANTINED'"],
    mandatory_policy_pending:["SELECT count(*) n FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING'"],
    uncertain_sends:["SELECT count(*) n FROM action_executions e JOIN actions a ON a.id=e.action_id WHERE a.organization_id=? AND a.type IN ('SEND_EMAIL','SEND_SMS','SEND_WHATSAPP','SEND_VOICE_CALL') AND (e.outcome_class IS NULL OR e.outcome_class IN ('UNCERTAIN','LEGACY_UNKNOWN','CLOSED_UNRESOLVED'))"],
    overdue_follow_ups:["SELECT count(*) n FROM follow_up_tasks WHERE organization_id=? AND status IN ('PLANNED','DUE','BLOCKED') AND (due_at IS NULL OR due_at<=?)",[org,as_of]],
    workflow_waiting:["SELECT count(*) n FROM workflow_runs WHERE organization_id=? AND status IN ('WAITING','WAITING_APPROVAL','WAITING_EXECUTION')"],
    workflow_blocked:["SELECT count(*) n FROM workflow_runs WHERE organization_id=? AND status='BLOCKED'"]
   },counts={};
   for(const [name,[sql,params]]of Object.entries(specs))counts[name]=await count(sql,params||[org]);
   const oldest=async(sql,params=[org])=>{const value=(await tx.get(sql,params)).at;if(value===null||value===undefined)return null;const ms=Date.parse(value);return typeof value==="string"&&Number.isFinite(ms)&&new Date(ms).toISOString()===value?Math.max(0,Math.floor((time-ms)/1000)):null;};
   const oldest_age_seconds={
    analysis:await oldest("SELECT min(j.created_at) at FROM analysis_job_items i JOIN analysis_jobs j ON j.organization_id=i.organization_id AND j.id=i.job_id JOIN domain_events e ON e.organization_id=i.organization_id AND e.id=i.event_id WHERE i.organization_id=? AND e.status IN ('PENDING','PROCESSING','RETRY_PENDING')"),
    mandatory_policy:await oldest("SELECT min(received_at) at FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING'"),
    follow_up:await oldest("SELECT min(due_at) at FROM follow_up_tasks WHERE organization_id=? AND status IN ('PLANNED','DUE','BLOCKED') AND (due_at IS NULL OR due_at<=?)",[org,as_of])
   };
   const sending=await this.dispatchControlsService.inspectInTransaction(tx,{organization_id:org,action_type:"SEND_EMAIL",authorized_at:as_of});
   const ai=await new AiInvocationService(this.db,{now:()=>time}).summary(tx,org,await tx.get("SELECT * FROM workspace_ai_controls WHERE organization_id=?",[org]));
   const result={version:1,as_of,scope:"WORKSPACE",counts,oldest_age_seconds,sending,ai,alert_delivery:"IN_APP_ONLY"};
   return {...result,alerts:evaluateOperationalAlerts(result)};
  });
 }
}
