import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { IntelligenceRepository } from "../src/modules/lead-intelligence/intelligenceRepository.js";
import { createCurrentIntelligenceServices } from "../src/modules/lead-intelligence/currentIntelligence.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { LocalReplyClassifier } from "../src/modules/channels/replyClassifier.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { IntelligenceFeedbackService } from "../src/modules/intelligence-feedback/intelligenceFeedbackService.js";
import { loadEvaluationFeedback } from "../src/modules/intelligence-feedback/intelligenceFeedbackRepository.js";
const LABELS={correctness:"CORRECT",usefulness:"USEFUL",expected_category:null,eval_use:"OPERATIONAL_ONLY"};
async function fixture(t) {
  const db=await createDatabase(":memory:");t.after(()=>db.close());
  const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Synthetic feedback"}),actor={id:"owner-"+org.id,role:"OWNER"};
  await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Synthetic owner",actor.id+"@example.test","synthetic-only",new Date().toISOString()]);
  const lead=await leads.createLead({organization_id:org.id,name:"Synthetic enquiry",email:"synthetic@example.test",company:"Synthetic Company"});
  const snapshot=await new IntelligenceRepository(db).createSnapshot({organization_id:org.id,lead_id:lead.id,summary:"Recorded assessment",score:50,next_best_action:"CREATE_HUMAN_TASK",evidence:[]});
  const service=new IntelligenceFeedbackService(db),scope={organization_id:org.id,lead_id:lead.id,target_kind:"SNAPSHOT",target_id:snapshot.id,actor};
  const command=async(overrides={})=>{const target={...scope,...overrides};const review=await service.review(Object.fromEntries(Object.entries(target).filter(([key])=>Object.hasOwn(scope,key))));return {...scope,expected_feedback_revision:review.feedback?.revision||0,review_token:review.review_token,request_key:"review-1",operation:"RECORD",labels:{...LABELS},reason:"Owner inspected the recorded assessment.",...overrides};};
  const receive=async(text,extra={})=>new InboundMessageService({db,replyClassifier:new LocalReplyClassifier()}).receiveInboundEvent({organization_id:org.id,lead_id:lead.id,channel:"EMAIL",provider:"synthetic-feedback",provider_event_id:"reply-1",payload:{text},...extra});
  const count=async table=>Number((await db.get("SELECT count(*) n FROM "+table)).n);
  return {db,org,actor,lead,leads,snapshot,service,scope,command,receive,count};
}
test("feedback review is read-only and first target, revision and audit are atomic",async t=>{
  const f=await fixture(t),cmd=await f.command();
  assert.equal(await f.count("intelligence_feedback_targets"),0);assert.equal(await f.count("intelligence_feedback_revisions"),0);
  await f.db.exec("CREATE TRIGGER feedback_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.event_type='IntelligenceFeedbackRecorded' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");
  await assert.rejects(f.service.record(cmd));assert.equal(await f.count("intelligence_feedback_targets"),0);assert.equal(await f.count("intelligence_feedback_revisions"),0);
  await f.db.exec("DROP TRIGGER feedback_audit_failure");const saved=await f.service.record(cmd);assert.equal(saved.feedback.revision,1);assert.equal(saved.replayed,false);
  assert.equal(await f.count("intelligence_feedback_targets"),1);assert.equal(await f.count("intelligence_feedback_revisions"),1);
});
test("exact request replay returns original review after correction, withdrawal and restore",async t=>{
  const f=await fixture(t),firstCmd=await f.command(),first=await f.service.record(firstCmd);
  const corrected=await f.service.record(await f.command({request_key:"review-2",labels:{...LABELS,correctness:"INCORRECT"},reason:"The supporting rationale is misleading."}));assert.equal(corrected.feedback.revision,2);
  const withdrawn=await f.service.record(await f.command({request_key:"withdraw",operation:"WITHDRAW",labels:null,reason:"The reviewer needs more evidence."}));assert.equal(withdrawn.feedback.status,"WITHDRAWN");
  const restored=await f.service.record(await f.command({request_key:"restore"}));assert.equal(restored.feedback.revision,4);
  assert.deepEqual((await f.service.record(firstCmd)).feedback,first.feedback);
  assert.deepEqual((await f.service.byRequestKey({organization_id:f.org.id,actor:f.actor,request_key:"review-1"})).feedback,first.feedback);
  assert.equal((await f.service.byRequestKey({organization_id:f.org.id,actor:f.actor,request_key:"missing"})).feedback,null);
  await assert.rejects(f.service.record({...firstCmd,reason:"Different intent."}),{code:"FEEDBACK_REQUEST_CONFLICT"});
  const page=await f.service.history({...f.scope,limit:"2"});assert.deepEqual(page.history.changes.map(x=>x.revision),[4,3]);assert.equal(page.history.next_before_revision,3);
  const older=await f.service.history({...f.scope,before_revision:"3",limit:2});assert.deepEqual(older.history.changes.map(x=>x.revision),[2,1]);assert.equal(older.history.has_more,false);
});
test("workspace, actor, lead and typed artifact boundaries reject without recording",async t=>{
  const f=await fixture(t),foreign=await f.leads.createOrganization({name:"Foreign"}),other=await f.leads.createLead({organization_id:f.org.id,name:"Other enquiry",email:"other@example.test"});
  await assert.rejects(f.service.review({...f.scope,lead_id:other.id}),{code:"FEEDBACK_TARGET_NOT_FOUND"});
  await assert.rejects(f.service.review({...f.scope,organization_id:foreign.id}),{code:"FEEDBACK_OWNER_REQUIRED"});
  await assert.rejects(f.service.review({...f.scope,actor:{...f.actor,role:"MEMBER"}}),{code:"FEEDBACK_OWNER_REQUIRED"});
  await assert.rejects(f.service.review({...f.scope,target_kind:"PLAN"}),{code:"FEEDBACK_TARGET_NOT_FOUND"});
  await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.actor.id]);
  await assert.rejects(f.service.review(f.scope),{code:"FEEDBACK_OWNER_REQUIRED"});assert.equal(await f.count("intelligence_feedback_targets"),0);
});
test("open review distinguishes changed feedback from changed saved artifact",async t=>{
  const f=await fixture(t),a=await f.command(),b={...a,request_key:"concurrent"};
  const results=await Promise.allSettled([f.service.record(a),f.service.record(b)]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(results.find(x=>x.status==="rejected").reason.code,"FEEDBACK_REVISION_STALE");
  const current=await f.command({request_key:"mutated"});await f.db.run("UPDATE intelligence_snapshots SET summary='Tampered saved content' WHERE id=?",[f.snapshot.id]);
  await assert.rejects(f.service.record(current),{code:"FEEDBACK_REVIEW_STALE"});assert.equal(await f.count("intelligence_feedback_revisions"),1);
});
test("supersession, current input correction and archive do not move a historical review",async t=>{
  const f=await fixture(t),cmd=await f.command();
  await f.db.run("UPDATE intelligence_snapshots SET status='SUPERSEDED' WHERE id=?",[f.snapshot.id]);
  await f.db.run("UPDATE leads SET company='New current company',data_revision=1,archived_at=? WHERE id=?",[new Date().toISOString(),f.lead.id]);
  const saved=await f.service.record(cmd);assert.equal(saved.feedback.revision,1);
  const review=await f.service.review(f.scope);assert.equal(review.target.id,f.snapshot.id);assert.equal(review.target.status,"SUPERSEDED");assert.equal(review.can_record,true);
});
test("all four completed analysis stages support independent exact artifact feedback",async t=>{
  const f=await fixture(t),services=createCurrentIntelligenceServices(f.db);
  const snapshot=await services.intelligenceService.runForLead(f.lead);
  const synthesis=await services.synthesisService.runForLead(f.lead);
  const recommendation=await services.intelligenceRecommendationService.runForLead(f.lead);
  const plan=await services.nextBestActionService.planForLead(f.lead);
  for(const [kind,artifact] of [["SNAPSHOT",snapshot],["SYNTHESIS",synthesis],["RECOMMENDATION",recommendation],["PLAN",plan]]) {
    const scope={...f.scope,target_kind:kind,target_id:artifact.id},review=await f.service.review(scope);assert.equal(review.can_record,true,kind);
    const saved=await f.service.record({...scope,expected_feedback_revision:0,review_token:review.review_token,request_key:kind,operation:"RECORD",labels:LABELS,reason:"Checked this saved stage."});assert.equal(saved.feedback.revision,1);
  }
  assert.equal(await f.count("intelligence_feedback_targets"),4);assert.equal(await f.count("ai_provider_attempts"),0);
});
test("reply category feedback retains canonical opt-out, original input and all operational state",async t=>{
  const f=await fixture(t),text="Please do not email me again",received=await f.receive(text);
  const before=await f.db.get("SELECT * FROM inbound_events WHERE id=?",[received.inbound_event.id]),restrictions=await f.db.all("SELECT * FROM contact_restrictions"),tasks=await f.db.all("SELECT * FROM follow_up_tasks"),events=await f.count("domain_events");
  const scope={...f.scope,target_kind:"REPLY",target_id:received.message.id},review=await f.service.review(scope);
  assert.equal(review.target.evaluation_input_available,true);assert.equal(JSON.stringify(review).includes(text),false);
  const labels={...LABELS,correctness:"INCORRECT",expected_category:"QUESTION",eval_use:"SYNTHETIC"};
  const saved=await f.service.record({...scope,expected_feedback_revision:0,review_token:review.review_token,request_key:"reply-label",operation:"RECORD",labels,reason:"Synthetic owner label for evaluation; operational stop stays in force."});
  assert.deepEqual(await f.db.get("SELECT * FROM inbound_events WHERE id=?",[before.id]),before);assert.deepEqual(await f.db.all("SELECT * FROM contact_restrictions"),restrictions);assert.deepEqual(await f.db.all("SELECT * FROM follow_up_tasks"),tasks);assert.equal(await f.count("domain_events"),events);
  const privateData=await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org.id,tx=>loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1}));
  assert.equal(privateData.reply.text,text);assert.equal(privateData.reply.recorded_category,"OPT_OUT");assert.equal(privateData.labels.expected_category,"QUESTION");
  const candidates=await f.service.listCandidates({organization_id:f.org.id,actor:f.actor});assert.equal(candidates.items.length,1);assert.equal(candidates.items[0].lead_name,f.lead.name);assert.equal(JSON.stringify(candidates).includes(text),false);
  const withdraw=await f.service.review(scope);await f.service.record({...scope,expected_feedback_revision:1,review_token:withdraw.review_token,request_key:"reply-withdraw",operation:"WITHDRAW",labels:null,reason:"Withdraw this evaluation nomination."});
  assert.equal((await f.service.listCandidates({organization_id:f.org.id,actor:f.actor})).items.length,0);
  const historical=await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org.id,tx=>loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1}));
  assert.equal(historical.status,"RECORDED");assert.equal(historical.latest_status,"WITHDRAWN");assert.equal(historical.latest_revision,2);assert.equal(historical.reply.text,text);
});
test("unknown original reply input permits operational review but refuses evaluation nomination",async t=>{
  const f=await fixture(t),received=await f.receive("",{event_type:"UNKNOWN",payload:{summary:"This summary is not original input."}});
  const scope={...f.scope,target_kind:"REPLY",target_id:received.message.id},review=await f.service.review(scope);assert.equal(review.target.evaluation_input_available,false);
  const cmd={...scope,expected_feedback_revision:0,review_token:review.review_token,request_key:"no-original",operation:"RECORD",labels:{...LABELS,expected_category:"UNKNOWN",eval_use:"SYNTHETIC"},reason:"Synthetic summary-only fixture."};
  await assert.rejects(f.service.record(cmd),{code:"FEEDBACK_EVALUATION_INPUT_REQUIRED"});assert.equal(await f.count("intelligence_feedback_targets"),0);
  assert.equal((await f.service.record({...cmd,labels:{...cmd.labels,eval_use:"OPERATIONAL_ONLY"}})).feedback.revision,1);
});
test("target size, child count and corrupt JSON refuse complete review without writes",async t=>{
  const f=await fixture(t);
  await f.db.run("UPDATE intelligence_snapshots SET summary=? WHERE id=?",["x".repeat(1048577),f.snapshot.id]);
  const originalTransaction=f.db.transaction.bind(f.db);let materialized=false,preflighted=false;f.db.transaction=(work,options)=>originalTransaction(async tx=>{const get=tx.get.bind(tx);tx.get=(sql,params)=>{if(sql.startsWith("SELECT id,organization_id,lead_id,version,pipeline_version"))materialized=true;if(sql.includes(" AS source_bytes FROM intelligence_snapshots"))preflighted=true;return get(sql,params);};return work(tx);},options);
  const large=await f.service.review(f.scope);assert.equal(large.unavailable_reason,"FEEDBACK_TARGET_TOO_LARGE");assert.equal(materialized,false);assert.equal(preflighted,true);
  f.db.transaction=originalTransaction;await f.db.run("UPDATE intelligence_snapshots SET summary='Small',evidence_json='{' WHERE id=?",[f.snapshot.id]);
  assert.equal((await f.service.review(f.scope)).unavailable_reason,"FEEDBACK_TARGET_INVALID");
  await f.db.run("UPDATE intelligence_snapshots SET evidence_json='[]' WHERE id=?",[f.snapshot.id]);
  await f.db.transaction(async tx=>{for(let i=0;i<1001;i++)await tx.run("INSERT INTO intelligence_claims(id,organization_id,lead_id,snapshot_id,field,value_json,confidence,evidence_ids_json,created_at) VALUES(?,?,?,?,?,'1','HIGH','[]',?)",["claim-"+i,f.org.id,f.lead.id,f.snapshot.id,"synthetic",new Date().toISOString()]);});
  assert.equal((await f.service.review(f.scope)).unavailable_reason,"FEEDBACK_TARGET_TOO_LARGE");assert.equal(await f.count("intelligence_feedback_targets"),0);
});
test("private helper requires the workspace gate and metadata reads omit snapshot and reply",async t=>{
  const f=await fixture(t),received=await f.receive("What is the price?"),scope={...f.scope,target_kind:"REPLY",target_id:received.message.id},view=await f.service.review(scope);
  const saved=await f.service.record({...scope,expected_feedback_revision:0,review_token:view.review_token,request_key:"helper",operation:"RECORD",labels:{...LABELS,expected_category:"QUESTION",eval_use:"SYNTHETIC"},reason:"Synthetic replay input."});
  await assert.rejects(loadEvaluationFeedback(f.db,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1}),/workspace transaction gate/);
  await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org.id,async tx=>{
    const original=tx.get.bind(tx),queries=[];tx.get=(sql,args)=>{queries.push(sql);return original(sql,args);};
    const meta=await loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1,metadataOnly:true});assert.ok(meta.snapshot_bytes>0);assert.equal(Object.hasOwn(meta,"reply"),false);assert.equal(Object.hasOwn(meta,"labels"),false);assert.equal(queries.some(sql=>sql.includes(",t.snapshot_json")),false);
    await assert.rejects(loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:"foreign",revision:1}),{code:"FEEDBACK_TARGET_NOT_FOUND"});
  });
});

test("review revision cap freezes new commands while original request replay and history remain available",async t=>{
  const f=await fixture(t),firstCmd=await f.command(),first=await f.service.record(firstCmd);
  for(let revision=2;revision<=100;revision++) await f.service.record(await f.command({request_key:"revision-"+revision,reason:"Synthetic review revision "+revision+"."}));
  const frozen=await f.service.review(f.scope);assert.equal(frozen.feedback.revision,100);assert.equal(frozen.can_record,false);assert.equal(frozen.review_token,null);assert.equal(frozen.unavailable_reason,"FEEDBACK_REVISION_LIMIT");
  assert.equal((await f.service.record(firstCmd)).feedback.revision,first.feedback.revision);
  const last=await f.service.history({...f.scope,limit:50});assert.equal(last.history.changes.length,50);assert.equal(last.history.has_more,true);
  assert.equal(await f.count("intelligence_feedback_revisions"),100);
  await assert.rejects(f.service.history({...f.scope,limit:"1e2"}),{code:"FEEDBACK_INVALID_INPUT"});
});
test("snapshot child evidence is part of exact reviewed content, without parent status invalidation",async t=>{
  const f=await fixture(t);
  await f.db.run("INSERT INTO intelligence_claims(id,organization_id,lead_id,snapshot_id,field,value_json,confidence,evidence_ids_json,created_at) VALUES('claim-reviewed',?,?,?,'company','\"Original\"','HIGH','[]',?)",[f.org.id,f.lead.id,f.snapshot.id,new Date().toISOString()]);
  const cmd=await f.command();
  await f.db.run("UPDATE intelligence_claims SET value_json='\"Corrected\"' WHERE id='claim-reviewed'");
  await assert.rejects(f.service.record(cmd),{code:"FEEDBACK_REVIEW_STALE"});assert.equal(await f.count("intelligence_feedback_targets"),0);
  const fresh=await f.command();assert.notEqual(fresh.review_token,cmd.review_token);
  const saved=await f.service.record(fresh);
  const captured=await f.db.get("SELECT snapshot_json FROM intelligence_feedback_targets WHERE id=?",[saved.feedback.id]);
  assert.equal(JSON.parse(captured.snapshot_json).children.intelligence_claims[0].value,"Corrected");
});
test("private frozen input digest fails closed after storage mutation and metadata never exposes input",async t=>{
  const f=await fixture(t),received=await f.receive("A private synthetic question?"),scope={...f.scope,target_kind:"REPLY",target_id:received.message.id},view=await f.service.review(scope);
  const saved=await f.service.record({...scope,expected_feedback_revision:0,review_token:view.review_token,request_key:"integrity",operation:"RECORD",labels:{...LABELS,expected_category:"QUESTION",eval_use:"PERMISSION_REVIEWED"},reason:"Synthetic permission-reviewed attestation fixture."});
  const stored=await f.db.get("SELECT snapshot_json FROM intelligence_feedback_targets WHERE id=?",[saved.feedback.id]),snapshot=JSON.parse(stored.snapshot_json);
  snapshot.reply.text="Rewritten private input";await f.db.run("UPDATE intelligence_feedback_targets SET snapshot_json=? WHERE id=?",[JSON.stringify(snapshot),saved.feedback.id]);
  await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org.id,async tx=>{
    const meta=await loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1,metadataOnly:true});assert.equal(Object.hasOwn(meta,"reply"),false);
    await assert.rejects(loadEvaluationFeedback(tx,{organization_id:f.org.id,feedback_id:saved.feedback.id,revision:1}),{code:"FEEDBACK_TARGET_INVALID"});
  });
});
