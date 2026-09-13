import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
const feedbackPath="/api/intelligence-feedback",evaluationPath="/api/intelligence-evaluation";
const labels={correctness:"CORRECT",usefulness:"USEFUL",expected_category:null,eval_use:"OPERATIONAL_ONLY"};
async function fixture(t){
  const client=await startClient(t),{organization,user}=await client.register("Synthetic feedback HTTP");
  const lead=await client.services.leadsRepository.createLead({organization_id:organization.id,name:"Synthetic lead",email:"review@example.test"});
  const snapshot=await client.services.intelligenceRepository.createSnapshot({organization_id:organization.id,lead_id:lead.id,summary:"Saved assessment",score:50,next_best_action:"CREATE_HUMAN_TASK",evidence:[]});
  const scope={lead_id:lead.id,target_kind:"SNAPSHOT",target_id:snapshot.id};
  const review=scope=>client.get(feedbackPath+"/target?"+new URLSearchParams(scope));
  const command=async(overrides={})=>({...scope,expected_feedback_revision:0,review_token:(await review(scope)).review_token,request_key:"review-request",operation:"RECORD",labels,reason:"Owner reviewed the saved assessment.",...overrides});
  const raw=(path,body)=>client.rawFetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  return {client,organization,user,lead,snapshot,scope,review,command,raw};
}
async function nominated(f){
  const text="Please do not email me again";
  const received=await f.client.services.inboundMessageService.receiveInboundEvent({organization_id:f.organization.id,lead_id:f.lead.id,channel:"EMAIL",provider:"synthetic-feedback",provider_event_id:"http-reply",payload:{text}});
  const scope={lead_id:f.lead.id,target_kind:"REPLY",target_id:received.message.id},review=await f.review(scope);
  const command={...scope,expected_feedback_revision:0,review_token:review.review_token,request_key:"reply-review",operation:"RECORD",labels:{...labels,expected_category:"OPT_OUT",eval_use:"SYNTHETIC"},reason:"Synthetic original reply classification checked."};
  const saved=await f.client.post(feedbackPath,command);
  const datasetCommand={name:"Reviewed synthetic replies",split:"HOLDOUT",expected_version:0,request_key:"frozen-request",feedback_revisions:[{feedback_id:saved.feedback.id,revision:1}]};
  return {scope,command,saved,datasetCommand,text};
}
test("feedback HTTP preserves exact reviews across retry, later edits and readonly recovery",async t=>{
  const f=await fixture(t),command=await f.command();
  assert.equal(Number((await f.client.db.get("SELECT count(*) n FROM intelligence_feedback_targets")).n),0);
  const first=await f.client.post(feedbackPath,command),review=await f.review(f.scope);
  const changed=await f.client.post(feedbackPath,{...command,expected_feedback_revision:1,review_token:review.review_token,request_key:"changed",labels:{...labels,correctness:"INCORRECT"},reason:"Reconsidered the assessment."});
  assert.equal(changed.feedback.revision,2);
  assert.deepEqual((await f.client.get(feedbackPath+"/requests/review-request")).feedback,first.feedback);
  assert.deepEqual((await f.client.post(feedbackPath,command)).feedback,first.feedback);
  const history=await f.client.get(feedbackPath+"/history?"+new URLSearchParams({...f.scope,limit:"1"}));
  assert.equal(history.history.changes[0].revision,2);assert.equal(history.history.next_before_revision,2);
  assert.equal((await f.raw(feedbackPath,{...command,request_key:"stale"})).status,409);
  assert.equal(Number((await f.client.db.get("SELECT count(*) n FROM intelligence_feedback_revisions")).n),2);
});
test("feedback HTTP enforces owner, session, exact target, authenticated actor and strict pagination",async t=>{
  const f=await fixture(t),command=await f.command(),url=feedbackPath+"/target?"+new URLSearchParams(f.scope);
  assert.equal((await fetch(f.client.baseUrl+url)).status,401);
  assert.equal((await f.raw(feedbackPath,{...command,actor:{id:"forged",role:"OWNER"}})).status,400);
  for(const query of ["limit=1e1","limit=01","limit=0","limit=51","before_revision=0"])assert.equal((await f.client.rawFetch(feedbackPath+"/history?"+new URLSearchParams(f.scope)+"&"+query)).status,400);
  const second=await f.client.services.leadsRepository.createLead({organization_id:f.organization.id,name:"Another lead"});
  assert.equal((await f.client.rawFetch(feedbackPath+"/target?"+new URLSearchParams({...f.scope,lead_id:second.id}))).status,404);
  await f.client.db.run("UPDATE users SET role='VIEWER' WHERE id=?",[f.user.id]);
  for(const path of [url,feedbackPath+"/candidates",feedbackPath+"/requests/missing",evaluationPath+"/datasets",evaluationPath+"/requests/missing"])assert.equal((await f.client.rawFetch(path)).status,403);
  assert.equal((await f.raw(feedbackPath,command)).status,403);
});
test("feedback and evaluation HTTP derive workspace from session for reads and writes",async t=>{
  const f=await fixture(t),n=await nominated(f),dataset=await f.client.post(evaluationPath+"/datasets",n.datasetCommand);
  await f.client.register("Other feedback workspace");
  assert.equal((await f.client.rawFetch(feedbackPath+"/target?"+new URLSearchParams({...n.scope,organization_id:f.organization.id}))).status,404);
  assert.deepEqual((await f.client.get(feedbackPath+"/candidates?organization_id="+f.organization.id)).items,[]);
  assert.equal((await f.client.get(feedbackPath+"/requests/reply-review")).feedback,null);
  assert.equal((await f.client.get(evaluationPath+"/requests/frozen-request")).dataset,null);
  assert.equal((await f.client.rawFetch(evaluationPath+"/datasets/"+dataset.id)).status,404);
  assert.equal((await f.raw(evaluationPath+"/datasets",{...n.datasetCommand,organization_id:f.organization.id})).status,404);
  assert.equal((await f.raw(evaluationPath+"/datasets/"+dataset.id+"/evaluate",{})).status,404);
});
test("evaluation HTTP freezes explicit reviews, rejects forged metrics, protects replay and returns aggregates",async t=>{
  const f=await fixture(t),n=await nominated(f),candidate=await f.client.get(feedbackPath+"/candidates?limit=1");
  assert.equal(candidate.items[0].id,n.saved.feedback.id);assert.equal(JSON.stringify(candidate).includes(n.text),false);
  const dataset=await f.client.post(evaluationPath+"/datasets",n.datasetCommand);
  assert.equal(dataset.split,"HOLDOUT");assert.equal(dataset.case_count,1);assert.equal(dataset.can_evaluate,true);
  assert.equal((await f.client.get(evaluationPath+"/requests/frozen-request")).dataset.id,dataset.id);
  assert.equal((await f.client.post(evaluationPath+"/datasets",n.datasetCommand)).id,dataset.id);
  assert.equal((await f.raw(evaluationPath+"/datasets",{...n.datasetCommand,name:"Changed intent"})).status,409);
  const path=evaluationPath+"/datasets/"+dataset.id+"/evaluate";
  for(const body of [{metrics:{accuracy:1}},{candidate_source_sha256:"a".repeat(64)},{text:n.text},{actor:f.user}])assert.equal((await f.raw(path,body)).status,400);
  const result=await f.client.post(path,{});
  assert.equal(result.metrics.case_count,1);assert.equal(result.metrics.provider_calls,0);assert.equal(result.metrics.release_decision,"NOT_AUTHORIZED");
  assert.equal(result.metrics.baseline.correct,1);assert.equal(result.metrics.candidate.correct,1);
  assert.equal((await f.client.post(path,{})).id,result.id);
  const history=await f.client.get(evaluationPath+"/datasets/"+dataset.id+"/evaluations?limit=1");assert.equal(history.items.length,1);
  const newer=await f.client.post(evaluationPath+"/datasets",{...n.datasetCommand,expected_version:1,request_key:"second-version"});
  assert.equal(newer.can_evaluate,false);assert.equal(newer.hold_reason,"EVALUATION_HOLDOUT_CONSUMED");
  assert.equal((await f.raw(evaluationPath+"/datasets/"+newer.id+"/evaluate",{})).status,409);
  assert.equal((await f.raw(evaluationPath+"/datasets",{...n.datasetCommand,name:"Other split",request_key:"split",split:"DEV"})).status,409);
  for(const value of [dataset,result,history,newer])for(const privateValue of [n.text,n.saved.feedback.id,f.lead.id,"feedback_revisions","expected_category","case_sha256","reply_text_sha256"])assert.equal(JSON.stringify(value).includes(privateValue),false,privateValue);
  const review=await f.review(n.scope);
  await f.client.post(feedbackPath,{...n.command,request_key:"withdraw-reply",expected_feedback_revision:1,review_token:review.review_token,operation:"WITHDRAW",labels:null,reason:"Withdraw the synthetic nomination."});
  assert.equal((await f.client.get(evaluationPath+"/datasets/"+dataset.id)).labels_current,false);
  assert.equal((await f.client.get(evaluationPath+"/datasets/"+dataset.id+"/evaluations")).items[0].labels_current,false);
  assert.equal(Number((await f.client.db.get("SELECT count(*) n FROM ai_provider_attempts")).n),0);
});
