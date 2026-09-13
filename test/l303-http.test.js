import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
async function fixture(t) {
  const client = await startClient(t), { organization, user } = await client.register("Analysis HTTP fixture");
  const { lead } = await client.post("/api/leads",{organization_id:organization.id,name:"Synthetic enquiry",email:"analysis@example.test"});
  const command = {organization_id:organization.id,request_key:"http-analysis",lead_ids:[lead.id],mode:"ANALYSIS_ONLY",target_stage:"PLAN"};
  return {client,organization,user,lead,command};
}
async function submit(client,command) {
  const response=await client.rawFetch("/api/intelligence/jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
  assert.equal(response.status,202,await response.clone().text());
  return response.json();
}
test("analysis HTTP acceptance is durable, replayable and GET-recoverable without running a model",async t=>{
  const {client,organization,lead,command}=await fixture(t);
  let calls=0;
  const original=client.services.synthesisService.synthesisAgent.synthesize.bind(client.services.synthesisService.synthesisAgent);
  client.services.synthesisService.synthesisAgent.synthesize=async input=>{calls++;return original(input);};
  const {job}=await submit(client,command);
  assert.equal(job.status,"QUEUED");assert.equal(job.counts.total,1);assert.equal(calls,0);
  assert.equal((await submit(client,command)).job.id,job.id);
  const lookup=await client.get("/api/intelligence/jobs?request_key=http-analysis");
  assert.equal(lookup.jobs.length,1);assert.equal(lookup.jobs[0].id,job.id);
  assert.equal((await client.get("/api/intelligence/jobs/"+job.id)).job.status,"QUEUED");
  assert.equal(calls,0);
  await client.services.analysisJobsService.processOnce({organization_id:organization.id,job_id:job.id});
  const done=(await client.get("/api/intelligence/jobs/"+job.id)).job;
  assert.equal(done.status,"COMPLETED");assert.equal(done.items[0].lead_id,lead.id);
  assert.ok(done.items[0].artifacts.plan_id);assert.equal(calls,1);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM ai_provider_attempts")).n),0);
  const current=await client.get("/api/leads/"+lead.id+"/intelligence");
  assert.equal(current.currentness.state,"CURRENT");
});
test("selection and request-key conflicts fail atomically and jobs stay tenant scoped",async t=>{
  const {client,organization,lead,command}=await fixture(t);
  const {job}=await submit(client,command);
  for(const ids of [[],[lead.id,lead.id],Array.from({length:51},(_,i)=>"synthetic-"+i),[lead.id,"foreign"]]) {
    const response=await client.rawFetch("/api/intelligence/jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...command,request_key:"invalid",lead_ids:ids})});
    assert.ok([400,404].includes(response.status));
  }
  const conflict=await client.rawFetch("/api/intelligence/jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...command,target_stage:"SNAPSHOT"})});
  assert.equal(conflict.status,409);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM analysis_jobs")).n),1);
  await client.register("Other analysis workspace");
  assert.equal((await client.rawFetch("/api/intelligence/jobs/"+job.id)).status,404);
  assert.deepEqual((await client.get("/api/intelligence/jobs?organization_id="+organization.id)).jobs,[]);
  const forged=await client.rawFetch("/api/intelligence/jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
  assert.equal(forged.status,404);
});
test("job cancellation is revisioned and generic event review cannot bypass its history",async t=>{
  const {client,organization,user,command}=await fixture(t),{job}=await submit(client,command);
  const event=await client.services.domainEventProcessor.inspect({organization_id:organization.id,event_id:job.items[0].event_id});
  assert.equal(event.can_close,false);assert.equal(event.can_retry,false);
  await assert.rejects(client.services.domainEventProcessor.review({organization_id:organization.id,event_id:event.id,expected_fence:event.processing_fence,decision:"CLOSE",evidence_note:"Use job controls",reviewer_user_id:user.id}),{code:"ANALYSIS_JOB_REQUIRED"});
  const decision={organization_id:organization.id,expected_revision:0,reason:"Operator no longer needs this work"};
  const cancelled=await client.post("/api/intelligence/jobs/"+job.id+"/cancel",decision);
  assert.equal(cancelled.job.status,"CANCELLED");assert.equal(cancelled.job.revision,1);
  assert.equal((await client.post("/api/intelligence/jobs/"+job.id+"/cancel",decision)).job.revision,1);
  const conflict=await client.rawFetch("/api/intelligence/jobs/"+job.id+"/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...decision,reason:"Different intent"})});
  assert.equal(conflict.status,409);
  await client.services.analysisJobsService.processOnce({organization_id:organization.id,job_id:job.id});
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM ai_provider_attempts")).n),0);
  assert.equal((await client.services.domainEventProcessor.list({organization_id:organization.id,state:"ALL"})).items.some(item=>item.id===event.id),false);
});
test("AI controls preserve exact optional rates, owner history and conflict drafts without inventing cost",async t=>{
  const {client,organization,user}=await fixture(t);
  const before=await client.get("/api/ai/controls");
  assert.equal(before.controls.max_daily_attempts,100);assert.equal(before.controls.max_in_flight,2);
  const change={organization_id:organization.id,expected_revision:0,reason:"Synthetic operating limits",paused:true,max_daily_attempts:12,max_in_flight:1,pricing:[{provider:"fixture",model:"fixed-model",input_usd_per_million:"0.123456",output_usd_per_million:"1.234567"}]};
  const saved=await client.put("/api/ai/controls",change);
  assert.equal(saved.controls.revision,1);assert.equal(saved.controls.pricing[0].input_usd_per_million,"0.123456");
  assert.equal(saved.history.items[0].created_by,user.id);
  const conflict=await client.rawFetch("/api/ai/controls",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({...change,reason:"Stale draft"})});
  assert.equal(conflict.status,409);
  const usage=await client.get("/api/ai/usage");
  assert.equal(usage.summary.admitted_attempts,0);
  assert.equal(usage.summary.cost.is_invoice,false);assert.equal(usage.summary.cost.is_monetary_cap,false);
  assert.equal(usage.summary.hold_code,"AI_PAUSED");
  await client.db.run("UPDATE users SET role='VIEWER' WHERE id=?",[user.id]);
  assert.equal((await client.rawFetch("/api/ai/controls")).status,403);
  assert.equal((await client.rawFetch("/api/ai/usage")).status,403);
});
test("legacy individual stages use durable jobs and preserve their response artifacts",async t=>{
  const {client,organization,lead}=await fixture(t),body={organization_id:organization.id};
  const snapshot=await client.post("/api/leads/"+lead.id+"/intelligence/run",body);
  assert.ok(snapshot.intelligence.id);assert.ok(snapshot.job_id);
  const synthesis=await client.post("/api/leads/"+lead.id+"/synthesis/run",body);
  assert.ok(synthesis.synthesis.id);assert.ok(synthesis.job_id);
  const recommendation=await client.post("/api/leads/"+lead.id+"/intelligence-recommendation/run",body);
  assert.ok(recommendation.intelligence_recommendation.id);assert.ok(recommendation.job_id);
  const plan=await client.post("/api/leads/"+lead.id+"/next-best-action/plan",body);
  assert.ok(plan.next_best_action_plan.id);assert.ok(plan.job_id);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM analysis_jobs")).n),4);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM ai_provider_attempts")).n),0);
});

test("job and AI pagination refuse noncanonical and out-of-range query numbers",async t=>{
  const {client}=await fixture(t);
  for(const path of ["/api/intelligence/jobs?offset=","/api/intelligence/jobs?offset=0x10","/api/intelligence/jobs?limit=1e1","/api/intelligence/jobs?limit=21","/api/ai/controls?before_revision=1e2","/api/ai/usage?limit=0x10","/api/ai/usage?limit=51"]) {
    const response=await client.rawFetch(path);
    assert.ok([400,422].includes(response.status),path+" status="+response.status);
  }
});
