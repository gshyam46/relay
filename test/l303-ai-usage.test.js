import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { AiInvocationService, configureAiRuntime } from "../src/modules/ai-usage/aiInvocationService.js";
import { withAiInvocationContext, currentAiInvocationContext } from "../src/modules/ai-usage/aiInvocationContext.js";
import { hash, parseProviderUsage, normalizeControls } from "../src/modules/ai-usage/aiUsageContract.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { OpenAICompatibleProvider } from "../src/modules/ai/providers/openaiCompatible.js";
import { LlmSynthesisAgent } from "../src/modules/ai/llmSynthesisAgent.js";
import { LlmReplyClassifier } from "../src/modules/ai/llmReplyClassifier.js";
import { createCurrentIntelligenceServices } from "../src/modules/lead-intelligence/currentIntelligence.js";
import { InboundMessageService } from "../src/modules/channels/inboundMessageService.js";
import { SynthesisRepository } from "../src/modules/lead-intelligence/synthesisRepository.js";

async function fixture(t) {
 const client=await startClient(t),who=await client.register("Synthetic AI ledger"),org=who.organization.id;
 const lead=await client.services.leadsRepository.createLead({organization_id:org,name:"Recorded person",company:"Recorded firm",email:"recorded@example.test",source:"MANUAL"});
 const f={client,db:client.db,org,lead,actor:{id:who.user.id,role:"OWNER"},ms:Date.now()};f.now=()=>f.ms;f.service=new AiInvocationService(f.db,{now:f.now});return f;
}
async function origin(f) {
 const event=await new EventsRepository(f.db).publish({organization_id:f.org,lead_id:f.lead.id,type:"LeadImported"});
 const claim=await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org,tx=>new EventsRepository(tx).claimInTransaction({organization_id:f.org,event_id:event.id,owner:"synthetic-owner",now:f.ms}));
 assert.ok(claim);return {kind:"DOMAIN_EVENT",id:claim.id,fence:claim.processing_fence};
}
async function admission(f,overrides={}) { return {organization_id:f.org,lead_id:f.lead.id,purpose:"SYNTHESIS",origin:await origin(f),provider:"synthetic",requested_model:"fixture-v1",pipeline_version:"synthetic-pipeline-v1",prompt_version:"synthetic-prompt-v1",schema_version:"synthetic-schema-v1",request_fingerprint:hash("synthetic request"),input_fingerprint:hash("synthetic input"),...overrides}; }
const reported=(input=10,output=2)=>({outcome:"COMPLETED",http_status:200,response_model:"fixture-v1",provider_response_id:"synthetic-response",usage:parseProviderUsage({prompt_tokens:input,completion_tokens:output,total_tokens:input+output}),elapsed_ms:1});
async function observe(f,permit,observation=reported()) { return f.service.observe({organization_id:f.org,...permit,observation}); }
async function controls(f,changes={}) { const current=(await f.service.getControls({organization_id:f.org})).controls;return f.service.updateControls({organization_id:f.org,actor:f.actor,expected_revision:current.revision,reason:"Synthetic owner decision",paused:current.paused,max_daily_attempts:current.max_daily_attempts,max_in_flight:current.max_in_flight,pricing:current.pricing,...changes}); }
function block(){let release;const promise=new Promise(resolve=>{release=resolve;});return {release,promise};}
function envelope(content='{"selected_claims":[]}',usage={prompt_tokens:10,completion_tokens:2,total_tokens:12},extra={}){return {id:"synthetic-response",model:"fixture-v1",usage,choices:[{finish_reason:"stop",message:{role:"assistant",content}}],...extra};}
function provider(){return new OpenAICompatibleProvider({baseUrl:"https://synthetic.invalid",apiKey:"synthetic-secret",model:"fixture-v1",providerName:"synthetic"});}
function context(f,input){return {organization_id:f.org,lead_id:f.lead.id,purpose:"SYNTHESIS",origin:input.origin,input_fingerprint:input.input_fingerprint};}
const request={messages:[{role:"user",content:"Synthetic input"}],maxTokens:100};

test("default controls and empty usage do not invent provider spend; revisions are scoped owner decisions",async t=>{
 const f=await fixture(t),empty=await f.service.getControls({organization_id:f.org});
 assert.equal(empty.controls.revision,0);assert.equal(empty.usage.admitted_attempts,0);assert.equal(empty.usage.input_tokens_known_total,null);assert.equal(empty.usage.cost.estimated_usd,null);
 const saved=await controls(f,{max_daily_attempts:3,pricing:[{provider:"synthetic",model:"fixture-v1",input_usd_per_million:"2.5",output_usd_per_million:"10"}]});
 assert.equal(saved.controls.revision,1);assert.equal(saved.controls.pricing[0].input_usd_per_million,"2.500000");assert.equal(saved.history.items[0].created_by,f.actor.id);
 await assert.rejects(controls(f,{expected_revision:0}),{code:"AI_CONTROLS_STALE"});
 await assert.rejects(controls(f,{actor:{...f.actor,role:"MEMBER"}}),{code:"AI_OWNER_REQUIRED"});
 const other=await f.client.register("Other synthetic workspace");await assert.rejects(controls(f,{actor:{id:other.user.id,role:"OWNER"}}),{code:"AI_OWNER_REQUIRED"});
 await assert.rejects(f.service.getControls({organization_id:f.org,limit:51}),{code:"AI_REQUEST_INVALID"});
 assert.throws(()=>normalizeControls({paused:false,max_daily_attempts:1,max_in_flight:1,pricing:[{provider:"synthetic",model:"fixture-v1",input_usd_per_million:"0.0000001",output_usd_per_million:"0"}]}),{code:"AI_REQUEST_INVALID"});
});

test("concurrent admission reserves one logical slot; a duplicate permit and stale/cross-scope claims never authorize I/O",async t=>{
 const f=await fixture(t);await controls(f,{max_in_flight:1});const inputs=await Promise.all([admission(f),admission(f)]);
 const results=await Promise.allSettled(inputs.map(input=>f.service.admit(input)));
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.find(r=>r.status==="rejected").reason.code,"AI_IN_FLIGHT_LIMIT");
 const index=results.findIndex(r=>r.status==="fulfilled"),permit=results[index].value;
 await assert.rejects(f.service.admit(inputs[index]),{code:"AI_INVOCATION_REPLAYED"});
 await observe(f,permit);await f.service.admit(inputs[1-index]);
 const stale=await admission(f);stale.origin.fence++;await assert.rejects(f.service.admit(stale),{code:"AI_ORIGIN_STALE"});
 const other=await f.client.register("Other claim scope");await assert.rejects(f.service.admit({...stale,organization_id:other.organization.id}),{code:"AI_ORIGIN_STALE"});
 assert.equal((await f.service.usage({organization_id:f.org})).summary.admitted_attempts,2);
});

test("unknown/crashed admission keeps its daily charge, expired logical slot releases, exact late observation settles after fence loss",async t=>{
 const f=await fixture(t);await controls(f,{max_daily_attempts:2,max_in_flight:1});const first=await admission(f),permit=await f.service.admit(first);
 f.ms+=15000;const next=await f.service.admit(await admission(f));
 let old=await f.db.get("SELECT * FROM ai_provider_attempts WHERE id=?",[permit.attempt_id]);assert.equal(old.request_state,"UNCONFIRMED");assert.equal(old.outcome,"RECOVERY_UNKNOWN");assert.equal(old.input_tokens,null);
 await f.db.run("UPDATE domain_events SET status='DISMISSED',processing_fence=processing_fence+1 WHERE id=?",[first.origin.id]);
 const settled=await observe(f,permit);assert.equal(settled.request_state,"OBSERVED");assert.equal(settled.input_tokens,10);
 assert.deepEqual(await observe(f,permit),settled);await assert.rejects(observe(f,permit,reported(11)),{code:"AI_OBSERVATION_CONFLICT"});
 await assert.rejects(observe(f,{...permit,authorization_token:"0".repeat(64)}),{code:"AI_USAGE_INVALID"});
 await observe(f,next,{outcome:"TRANSPORT_UNCONFIRMED",usage:null,elapsed_ms:15});
 await assert.rejects(f.service.admit(await admission(f)),{code:"AI_DAILY_LIMIT"});
 const usage=await f.service.usage({organization_id:f.org});assert.equal(usage.summary.admitted_attempts,2);assert.equal(usage.summary.unknown_usage_attempts,1);assert.equal(usage.summary.cost.unknown_attempts,2);
});

test("held admission commits its observed UTC day and clock rollback cannot create a fresh prior-day allowance",async t=>{
 const f=await fixture(t);f.ms=Date.parse("2026-09-12T23:59:50.000Z");await controls(f,{max_daily_attempts:1});
 await observe(f,await f.service.admit(await admission(f)));
 await controls(f,{paused:true});f.ms=Date.parse("2026-09-13T00:00:01.000Z");await assert.rejects(f.service.admit(await admission(f)),{code:"AI_PAUSED"});
 f.ms=Date.parse("2026-09-12T23:59:55.000Z");await controls(f,{paused:false});assert.equal((await f.service.usage({organization_id:f.org})).summary.budget_day,"2026-09-13");
 const permitted=await f.service.admit(await admission(f));assert.equal(permitted.admitted_at,"2026-09-13T00:00:01.000Z");await observe(f,permitted);
 await assert.rejects(f.service.admit(await admission(f)),{code:"AI_DAILY_LIMIT"});
});

test("captured owner prices use exact microUSD arithmetic; later rates do not reprice historical usage and unknown is separate",async t=>{
 const f=await fixture(t);await controls(f,{pricing:[{provider:"synthetic",model:"fixture-v1",input_usd_per_million:"2.5",output_usd_per_million:"10"}]});
 const first=await f.service.admit(await admission(f));await controls(f,{pricing:[]});const settled=await observe(f,first);
 assert.equal(settled.pricing_revision,1);assert.equal(settled.cost_estimate_microusd,"45");assert.equal(settled.cost_estimate_usd,"0.000045");
 await observe(f,await f.service.admit(await admission(f)),reported(0,0));
 await controls(f,{pricing:[{provider:"synthetic",model:"fixture-v1",input_usd_per_million:"0.000001",output_usd_per_million:"0"}]});
 const tiny=await observe(f,await f.service.admit(await admission(f)),reported(1,0));assert.equal(tiny.cost_estimate_microusd,"1");
 await controls(f,{pricing:[{provider:"synthetic",model:"fixture-v1",input_usd_per_million:"0",output_usd_per_million:"0"}]});
 assert.equal((await observe(f,await f.service.admit(await admission(f)),reported(0,0))).cost_estimate_microusd,"0");
 const usage=await f.service.usage({organization_id:f.org,limit:2});assert.equal(usage.summary.cost.estimated_microusd,"46");assert.equal(usage.summary.cost.estimated_attempts,3);assert.equal(usage.summary.cost.unknown_attempts,1);assert.equal(usage.summary.cost.is_invoice,false);
 assert.equal(usage.items.length,2);assert.equal(usage.has_more,true);const second=await f.service.usage({organization_id:f.org,before_attempt_id:usage.next_before_attempt_id,limit:2});assert.equal(second.items.length,2);assert.equal(new Set([...usage.items,...second.items].map(i=>i.id)).size,4);
 assert.ok(usage.items.every(i=>i.pipeline_version&&i.prompt_version&&i.schema_version));assert.ok(!JSON.stringify(usage).includes("authorization_hash"));
});

test("gateway persists provider usage before invalid completion JSON and never stores prompt/secret/provider body",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),input=await admission(f);let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response(JSON.stringify(envelope("{broken private-output",{prompt_tokens:30,completion_tokens:4,total_tokens:34})),{status:200,headers:{"content-type":"application/json"}});});
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion(request)),/JSON completion rejected/);
 const usage=await runtime.invocationService.usage({organization_id:f.org});assert.equal(calls,1);assert.equal(usage.items[0].outcome,"INVALID_RESPONSE");assert.equal(usage.items[0].usage_status,"PROVIDER_REPORTED");assert.equal(usage.items[0].total_tokens,34);
 const raw=await f.db.get("SELECT * FROM ai_provider_attempts WHERE id=?",[usage.items[0].id]);for(const value of ["Synthetic input","synthetic-secret","private-output","synthetic.invalid"])assert.ok(!JSON.stringify(raw).includes(value));
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion(request)),{code:"AI_INVOCATION_REPLAYED"});assert.equal(calls,1);
});

test("invalid/absent usage stays unknown, explicit zero is recorded, incomplete token sums are never fabricated",()=>{
 for(const usage of [null,{}, {prompt_tokens:1,completion_tokens:2}, {prompt_tokens:1,completion_tokens:2,total_tokens:4}, {prompt_tokens:"1",completion_tokens:2,total_tokens:3}, {prompt_tokens:-1,completion_tokens:2,total_tokens:1}]){const value=parseProviderUsage(usage);assert.equal(value.usage_status,"UNKNOWN");assert.equal(value.input_tokens,null);assert.equal(value.output_tokens,null);assert.equal(value.total_tokens,null);}
 assert.equal(parseProviderUsage({prompt_tokens:0,completion_tokens:0,total_tokens:0}).usage_status,"PROVIDER_REPORTED");
});

test("request validation and missing invocation context cause no provider admission; provider failure still occupies daily allowance",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),input=await admission(f);let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response("private error",{status:429});});
 await assert.rejects(runtime.provider.jsonCompletion(request),{code:"AI_CONTEXT_REQUIRED"});
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion({...request,maxTokens:999999})),{code:"AI_REQUEST_INVALID"});assert.equal((await runtime.invocationService.usage({organization_id:f.org})).items.length,0);
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion(request)),/unavailable/);const usage=await runtime.invocationService.usage({organization_id:f.org});assert.equal(calls,1);assert.equal(usage.summary.admitted_attempts,1);assert.equal(usage.items[0].outcome,"HTTP_REJECTED");assert.equal(usage.items[0].usage_status,"UNKNOWN");
});

test("immutable async contexts do not leak between concurrent invocations",async()=>{
 const release=block(),make=id=>({organization_id:"org",lead_id:id,purpose:"SYNTHESIS",origin:{kind:"DOMAIN_EVENT",id:"event-"+id,fence:1},input_fingerprint:hash(id)});
 const a=withAiInvocationContext(make("a"),async()=>{await release.promise;assert.equal(currentAiInvocationContext().lead_id,"a");assert.ok(Object.isFrozen(currentAiInvocationContext().origin));});
 await withAiInvocationContext(make("b"),async()=>{assert.equal(currentAiInvocationContext().lead_id,"b");release.release();});await a;assert.equal(currentAiInvocationContext(),null);
});

test("configured synthesis remains current through scoped readers, reuse spends nothing, and changed model makes it outdated",async t=>{
 const f=await fixture(t);let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response(JSON.stringify(envelope()),{status:200,headers:{"content-type":"application/json"}});});
 const runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),s=f.client.services.synthesisService;s.generationDescriptor=runtime.generationDescriptor;s.synthesisAgent=new LlmSynthesisAgent(runtime.provider);
 await f.client.services.intelligenceService.runForLead(f.lead);const input=await admission(f),run=await withAiInvocationContext(context(f,input),()=>s.runForLead(f.lead));
 assert.equal(calls,1);assert.equal((await createCurrentIntelligenceServices(f.db).synthesisService.currentForLead(f.lead)).synthesis.id,run.id);
 assert.equal((await s.runForLead(f.lead)).id,run.id);assert.equal(calls,1);assert.equal((await runtime.invocationService.usage({organization_id:f.org})).summary.admitted_attempts,1);
 configureAiRuntime(f.db,{provider:new OpenAICompatibleProvider({baseUrl:"https://synthetic.invalid",apiKey:"synthetic",model:"fixture-v2",providerName:"synthetic"}),now:f.now});
 assert.equal((await createCurrentIntelligenceServices(f.db).synthesisService.currentForLead(f.lead)).synthesis,null);
});

test("synthesis quota hold propagates without READY fallback, while reply quota hold is explicit UNKNOWN and direct optout stays local",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now});await controls(f,{paused:true});let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw Error("No synthetic call expected");});
 const s=f.client.services.synthesisService;s.generationDescriptor=runtime.generationDescriptor;s.synthesisAgent=new LlmSynthesisAgent(runtime.provider);await f.client.services.intelligenceService.runForLead(f.lead);const input=await admission(f);
 await assert.rejects(withAiInvocationContext(context(f,input),()=>s.runForLead(f.lead)),{code:"AI_PAUSED"});assert.equal((await s.currentForLead(f.lead)).synthesis,null);
 const classifier=new LlmReplyClassifier(runtime.provider);const reply=await classifier.classify("Could you explain the available options?");assert.equal(reply.event_type,"UNKNOWN");assert.equal(reply.generation.reason,"AI_ADMISSION_UNAVAILABLE");assert.equal(reply.review_required,true);
 assert.equal((await classifier.classify("Stop emailing me")).event_type,"OPT_OUT");assert.equal(calls,0);assert.equal((await runtime.invocationService.usage({organization_id:f.org})).items.length,0);
});

test("a competing failed generator cannot downgrade an already ready synthesis",async t=>{
 const f=await fixture(t);await f.client.services.intelligenceService.runForLead(f.lead);const ready=await f.client.services.synthesisService.runForLead(f.lead),repo=new SynthesisRepository(f.db);
 await repo.markFailed(ready.id,new Error("Late synthetic failure"));const row=await repo.getRun(ready.id);assert.equal(row.status,"READY");assert.equal(row.last_error,null);
});


test("receipt-bound reply admission records a measured attempt, duplicate replay does not repeat it and paused replies preserve mandatory stop policy",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),classifier=new LlmReplyClassifier(runtime.provider),service=new InboundMessageService({db:f.db,replyClassifier:classifier});let calls=0;
 const text="What is the price?";t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response(JSON.stringify(envelope(JSON.stringify({event_type:"QUESTION",confidence:"HIGH",evidence_quote:text}))),{status:200,headers:{"content-type":"application/json"}});});
 const receive=(id,text)=>service.receiveInboundEvent({organization_id:f.org,lead_id:f.lead.id,channel:"EMAIL",provider:"synthetic",provider_event_id:id,payload:{text}});
 const first=await receive("reply-one",text);assert.equal(first.inbound_event.event_type,"QUESTION");assert.equal(calls,1);
 const attempt=(await runtime.invocationService.usage({organization_id:f.org})).items[0];assert.equal(attempt.purpose,"REPLY_CLASSIFICATION");assert.equal(attempt.usage_status,"PROVIDER_REPORTED");
 const raw=await f.db.get("SELECT webhook_receipt_id,domain_event_id FROM ai_provider_attempts WHERE id=?",[attempt.id]);assert.equal(raw.webhook_receipt_id,first.receipt.id);assert.equal(raw.domain_event_id,null);
 await receive("reply-one",text);assert.equal(calls,1);await controls(f,{paused:true});const held=await receive("reply-two",text);assert.equal(held.classification.generation.reason,"AI_ADMISSION_UNAVAILABLE");assert.equal(held.inbound_event.event_type,"UNKNOWN");
 const stopped=await receive("reply-three","Stop emailing me");assert.equal(stopped.inbound_event.event_type,"OPT_OUT");assert.equal((await new ContactPolicyService(f.db).inspectLead({organization_id:f.org,lead_id:f.lead.id,channel:"EMAIL"})).restricted,true);assert.equal(calls,1);
});

test("accounting failure after a provider response retains the admission and fails closed without another provider attempt",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),input=await admission(f);let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response(JSON.stringify(envelope()),{status:200,headers:{"content-type":"application/json"}});});
 t.mock.method(runtime.invocationService,"observe",async()=>{throw new Error("Synthetic storage outage");});
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion(request)),{code:"AI_ACCOUNTING_UNAVAILABLE"});
 const usage=await runtime.invocationService.usage({organization_id:f.org});assert.equal(usage.items[0].request_state,"ADMITTED");assert.equal(usage.items[0].usage_status,"UNKNOWN");assert.equal(usage.summary.admitted_attempts,1);
 await assert.rejects(withAiInvocationContext(context(f,input),()=>runtime.provider.jsonCompletion(request)),{code:"AI_INVOCATION_REPLAYED"});assert.equal(calls,1);
});


test("cancelled analysis rejects publication but preserves measured late provider usage and completed snapshot",async t=>{
 const f=await fixture(t),runtime=configureAiRuntime(f.db,{provider:provider(),now:f.now}),service=f.client.services.synthesisService,jobs=f.client.services.analysisJobsService;
 service.generationDescriptor=runtime.generationDescriptor;service.synthesisAgent=new LlmSynthesisAgent(runtime.provider);
 const entered=block(),release=block();let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;entered.release();await release.promise;return new Response(JSON.stringify(envelope()),{status:200,headers:{"content-type":"application/json"}});});
 const {job}=await jobs.enqueue({organization_id:f.org,actor:f.actor,request_key:"synthetic-cancel",lead_ids:[f.lead.id],mode:"ANALYSIS_ONLY",target_stage:"PLAN"});
 const running=jobs.processOnce({organization_id:f.org,job_id:job.id});await entered.promise;
 try{assert.equal((await runtime.invocationService.usage({organization_id:f.org})).items[0].request_state,"ADMITTED");await jobs.cancel({organization_id:f.org,job_id:job.id,actor:f.actor,expected_revision:0,reason:"Cancel the synthetic request"});}finally{release.release();}
 const result=await running;assert.equal(result.job.status,"CANCELLED");assert.equal(calls,1);
 const usage=await runtime.invocationService.usage({organization_id:f.org});assert.equal(usage.items[0].request_state,"OBSERVED");assert.equal(usage.items[0].usage_status,"PROVIDER_REPORTED");assert.equal(usage.summary.admitted_attempts,1);
 assert.equal(Number((await f.db.get("SELECT COUNT(*) n FROM intelligence_snapshots")).n),1);assert.equal(Number((await f.db.get("SELECT COUNT(*) n FROM intelligence_synthesis_runs")).n),0);assert.equal(Number((await f.db.get("SELECT COUNT(*) n FROM actions")).n),0);
});

test("held or invalid-version events cannot acquire an AI permit even when their lease and fence still match",async t=>{
 const f=await fixture(t),held=await admission(f);await f.db.run("UPDATE domain_events SET processing_hold_reason='EVENT_BUDGET_EXHAUSTED' WHERE id=?",[held.origin.id]);await assert.rejects(f.service.admit(held),{code:"AI_ORIGIN_STALE"});
 const invalid=await admission(f);await f.db.run("UPDATE domain_events SET processing_version=0 WHERE id=?",[invalid.origin.id]);await assert.rejects(f.service.admit(invalid),{code:"AI_ORIGIN_STALE"});assert.equal((await f.service.usage({organization_id:f.org})).items.length,0);
});

test("truncated, refused or tool-bearing completions retain validated token observations while their content is rejected",async t=>{
 const raw=provider();for(const choice of [{finish_reason:"length",message:{role:"assistant",content:'{"selected_claims":[]}'}},{finish_reason:"stop",message:{role:"assistant",content:'{}',refusal:"Untrusted provider text"}},{finish_reason:"stop",message:{role:"assistant",content:'{}',tool_calls:[{id:"tool"}]}}]){
  const mock=t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify(envelope('{}',undefined,{choices:[choice]})),{status:200,headers:{"content-type":"application/json"}}));
  try{const result=await raw.completePreparedJson(raw.prepareJsonRequest(request));assert.equal(result.observation.outcome,"INVALID_RESPONSE");assert.equal(result.observation.usage.total_tokens,12);assert.equal(result.value,undefined);assert.match(result.error,/rejected/);}finally{mock.mock.restore();}
 }
});


test("admission origin key order cannot grant duplicate authority and extra origin fields are rejected",async t=>{
 const f=await fixture(t),input=await admission(f);await f.service.admit(input);
 await assert.rejects(f.service.admit({...input,origin:{fence:input.origin.fence,id:input.origin.id,kind:input.origin.kind}}),{code:"AI_INVOCATION_REPLAYED"});
 await assert.rejects(f.service.admit({...input,origin:{...input.origin,untrusted_extra:"different hash"}}),{code:"AI_REQUEST_INVALID"});
 assert.equal((await f.service.usage({organization_id:f.org})).summary.admitted_attempts,1);
});
