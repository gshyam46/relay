import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { emptyProfile, emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";
const profile = () => ({...emptyProfile(),business_name:"Synthetic workshop",offerings:["Desks"]});
const criteria = () => ({version:1,interest:{requirement:"REQUIRED",accepted_aliases:["desk"],excluded_aliases:["sofa"]},location:null,budget:null,timeline:null});
const fact = value => ({state:"KNOWN",value,provenance:{assertion:"CUSTOMER_STATED",source_type:"MANUAL",source_reference:"Synthetic exact enquiry",observed_at:new Date(Date.now()-60000).toISOString()}});
const rawPut = (c,path,body) => c.rawFetch(path,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const setup = (c,fit_criteria=criteria()) => c.put("/api/business-profile",{expected_revision:0,reason:"Explicit synthetic rules",profile:profile(),fit_criteria});
const run = (c,lead_ids) => c.post("/api/intelligence/bulk-run",{lead_ids});
async function fixture(t) {const client=await startClient(t);return {client,...await client.register("Business fit HTTP")};}
async function lead(c,name,interest,extra={}) {
  const {lead}=await c.post("/api/leads",{name,email:name.toLowerCase().replace(/[^a-z]/g,"")+"@example.test",...extra});
  await c.put("/api/leads/"+lead.id+"/enquiry-context",{expected_revision:0,reason:"Record synthetic customer wording",enquiry:{...emptyEnquiry(),interest:fact(interest)}});
  return lead;
}
test("HTTP criteria share profile revision with preserved omission, explicit disable, canonical no-op and immutable history",async t=>{
  const {client:c}=await fixture(t);
  assert.equal((await c.get("/api/business-profile")).fit_criteria,null);
  const first=await setup(c);
  assert.equal(first.revision,1);
  const canonical=await c.put("/api/business-profile",{expected_revision:1,reason:"Equivalent aliases",profile:profile(),fit_criteria:{...criteria(),interest:{...criteria().interest,accepted_aliases:["  DESK "]}}});
  assert.equal(canonical.revision,1);
  const preserved=await c.put("/api/business-profile",{expected_revision:1,reason:"Descriptive edit",profile:{...profile(),language:"English"}});
  assert.equal(preserved.revision,2);assert.deepEqual(preserved.fit_criteria,first.fit_criteria);
  const stale=await rawPut(c,"/api/business-profile",{expected_revision:1,reason:"Stale criteria tab",profile:profile(),fit_criteria:null});
  assert.equal(stale.status,409);
  const disabled=await c.put("/api/business-profile",{expected_revision:2,reason:"Disable explicit rules",profile:preserved.profile,fit_criteria:null});
  assert.equal(disabled.revision,3);assert.equal(disabled.fit_criteria,null);
  const history=await c.get("/api/business-profile/history");
  assert.deepEqual(history.items.map(r=>r.revision),[3,2,1]);
  assert.deepEqual(history.items[2].fit_criteria,first.fit_criteria);
});
test("HTTP criteria reject unsupported commands and members cannot change them",async t=>{
  const {client:c,user}=await fixture(t);
  for(const fit_criteria of [{...criteria(),script:"return true"},{...criteria(),interest:{...criteria().interest,requirement:"PREFERRED"}},{...criteria(),interest:{...criteria().interest,excluded_aliases:["DESK"]}}]) {
    assert.equal((await rawPut(c,"/api/business-profile",{expected_revision:0,reason:"Invalid rule",profile:profile(),fit_criteria})).status,400);
  }
  assert.equal((await rawPut(c,"/api/business-profile",{expected_revision:0,reason:"Forged tenant",profile:profile(),fit_criteria:criteria(),organization_id:"other"})).status,400);
  await c.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[user.id]);
  assert.equal((await rawPut(c,"/api/business-profile",{expected_revision:0,reason:"No authority",profile:profile(),fit_criteria:criteria()})).status,403);
  assert.equal((await c.get("/api/business-profile")).revision,0);
});
test("HTTP current criteria rank an older incomplete matching lead above a newer complete mismatch and preserve source citations",async t=>{
  const {client:c}=await fixture(t);await setup(c);
  const good=await lead(c,"Older matching enquiry","desk");
  const wrong=await lead(c,"Recent complete mismatch","sofa",{email:"complete@example.test",phone:"+14155552671",company:"Synthetic complete company"});
  await c.db.run("UPDATE leads SET created_at='2025-01-01T00:00:00.000Z' WHERE id=?",[good.id]);
  assert.equal((await run(c,[wrong.id,good.id])).succeeded,2);
  const goodView=await c.get("/api/leads/"+good.id+"/intelligence"),wrongView=await c.get("/api/leads/"+wrong.id+"/intelligence");
  assert.equal(goodView.business_fit.status,"MATCHES_CRITERIA");
  assert.equal(wrongView.business_fit.status,"DOES_NOT_MATCH");
  assert.ok(goodView.readiness.score<wrongView.readiness.score);
  assert.equal(goodView.business_fit.criterion_results[0].evidence.fact.value,"desk");
  assert.equal(goodView.business_fit.criterion_results[0].evidence.fact.provenance.source_reference,"Synthetic exact enquiry");
  const summary=await c.get("/api/intelligence/summary");
  assert.deepEqual(summary.leads.map(r=>r.lead_id),[good.id,wrong.id]);
  assert.equal(summary.ranking.scope,"RETURNED_LEADS");assert.equal(summary.ranking.workspace_active_count,2);
  const executions=await c.db.get("SELECT COUNT(*) AS n FROM action_executions");
  assert.equal(Number(executions.n),0);
});
test("HTTP criteria edits remove current fit until explicit analysis without rewriting old assessment or dispatching",async t=>{
  const {client:c}=await fixture(t);const saved=await setup(c),record=await lead(c,"Current criteria","desk");
  await run(c,[record.id]);const path="/api/leads/"+record.id+"/intelligence",before=await c.get(path);
  const stored=await c.db.get("SELECT business_fit_json FROM intelligence_snapshots WHERE id=?",[before.snapshot.id]);
  const actionCount=await c.db.get("SELECT COUNT(*) AS n FROM actions");
  await c.put("/api/business-profile",{expected_revision:1,reason:"Owner changes allowed offering",profile:saved.profile,fit_criteria:{...criteria(),interest:{...criteria().interest,accepted_aliases:["table"],excluded_aliases:["desk"]}}});
  const outdated=await c.get(path);assert.equal(outdated.currentness.state,"OUTDATED");assert.equal(outdated.business_fit,null);assert.equal(outdated.attention_priority,null);
  const summary=await c.get("/api/intelligence/summary");assert.equal(summary.leads[0].business_fit,null);
  assert.deepEqual(await c.db.get("SELECT COUNT(*) AS n FROM actions"),actionCount);
  assert.deepEqual(await c.db.get("SELECT business_fit_json FROM intelligence_snapshots WHERE id=?",[before.snapshot.id]),stored);
  assert.equal((await run(c,[record.id])).succeeded,1);
  const current=await c.get(path);assert.equal(current.business_fit.criteria_revision,2);assert.equal(current.business_fit.status,"DOES_NOT_MATCH");
  assert.equal((await run(c,[record.id])).results[0].reused,true);
  assert.equal(Number((await c.db.get("SELECT COUNT(*) AS n FROM action_executions")).n),0);
});
test("HTTP descriptive requirements remain unassessed and do not silently become fit rules",async t=>{
  const {client:c}=await fixture(t);
  await c.put("/api/business-profile",{expected_revision:0,reason:"Descriptive requirement",profile:{...profile(),required_criteria:["Must have a verified purchase order"]},fit_criteria:criteria()});
  const record=await lead(c,"Descriptive requirement","desk");await run(c,[record.id]);
  const view=await c.get("/api/leads/"+record.id+"/intelligence");
  assert.equal(view.business_fit.status,"NEEDS_REVIEW");assert.equal(view.business_fit.unassessed_profile_criteria,true);
  assert.equal(view.business_fit.criterion_results[0].outcome,"MATCH");
});
test("HTTP intelligence page is bounded, tenant-scoped and navigable without duplicate IDs or hidden analysis",async t=>{
  const {client:c,organization}=await fixture(t);
  const stamp=new Date().toISOString();
  await c.db.transaction(async tx=>{
    for(let i=0;i<101;i++) await tx.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','NEW',?,?)",["page-"+String(i).padStart(3,"0"),organization.id,"Synthetic page "+i,stamp,stamp]);
  });
  const first=await c.get("/api/intelligence/summary");
  assert.equal(first.leads.length,100);assert.equal(first.ranking.has_more,true);assert.equal(first.ranking.workspace_active_count,101);
  assert.equal(first.ranking.next_after_lead_id,"page-099");assert.equal(first.totals.total,100);assert.equal(first.eligible_lead_ids.length,100);
  const last=await c.get("/api/intelligence/summary?after_lead_id="+first.ranking.next_after_lead_id);
  assert.deepEqual(last.leads.map(r=>r.lead_id),["page-100"]);assert.equal(last.ranking.has_more,false);assert.equal(last.ranking.next_after_lead_id,null);
  assert.equal(Number((await c.db.get("SELECT COUNT(*) AS n FROM intelligence_snapshots")).n),0);
  assert.equal((await c.rawFetch("/api/intelligence/summary?after_lead_id="+encodeURIComponent(" "))).status,400);
  assert.equal((await c.rawFetch("/api/intelligence/summary?after_lead_id="+"a".repeat(201))).status,400);

  // Sorting a matching result ahead of the ID cursor must not change page membership.
  await setup(c);
  await c.put("/api/leads/page-099/enquiry-context",{expected_revision:0,reason:"Configured pagination source",enquiry:{...emptyEnquiry(),interest:fact("desk")}});
  assert.equal((await run(c,["page-099"])).succeeded,1);
  const ranked=await c.get("/api/intelligence/summary");
  assert.equal(ranked.leads[0].lead_id,"page-099");assert.equal(ranked.ranking.next_after_lead_id,"page-099");
  assert.equal(ranked.leads.at(-1).lead_id,"page-098");
  assert.deepEqual((await c.get("/api/intelligence/summary?after_lead_id="+ranked.ranking.next_after_lead_id)).leads.map(r=>r.lead_id),["page-100"]);
  await c.post("/api/leads/page-099/archive",{expected_revision:0,archived:true,reason:"Close matching synthetic enquiry"});
  const archived=await c.get("/api/intelligence/summary");
  assert.equal(archived.ranking.workspace_active_count,100);assert.equal(archived.ranking.has_more,false);
  assert.ok(!archived.leads.some(r=>r.lead_id==="page-099"));assert.ok(!archived.eligible_lead_ids.includes("page-099"));
  await c.register("Other fit workspace");
  const foreign=await c.get("/api/intelligence/summary?after_lead_id=page-050");assert.equal(foreign.leads.length,0);assert.equal(foreign.ranking.workspace_active_count,0);
});
test("HTTP rejects inconsistent stored fit instead of publishing an optimistic rank",async t=>{
  const {client:c}=await fixture(t);await setup(c);const record=await lead(c,"Corrupt stored result","sofa");await run(c,[record.id]);
  const path="/api/leads/"+record.id+"/intelligence",before=await c.get(path);
  const corrupt=structuredClone(before.business_fit);corrupt.status="MATCHES_CRITERIA";corrupt.attention_priority.band="MATCHING";
  await c.db.run("UPDATE intelligence_snapshots SET business_fit_json=? WHERE id=?",[JSON.stringify(corrupt),before.snapshot.id]);
  assert.equal((await c.rawFetch(path)).status,503);assert.equal((await c.rawFetch("/api/intelligence/summary")).status,503);
});

test("HTTP queue preflights historical UTF8 and aggregate bytes without publishing a partial ranking",async t=>{
  const {client:c,organization}=await fixture(t),stamp=new Date().toISOString();
  await c.db.transaction(async tx=>{
    for(let i=0;i<9;i++)await tx.run("INSERT INTO leads(id,organization_id,name,source,status,created_at,updated_at) VALUES (?,?,?,'MANUAL','NEW',?,?)",["bounded-"+i,organization.id,"Synthetic bounded "+i,stamp,stamp]);
  });
  await c.db.run("UPDATE leads SET name=? WHERE id='bounded-0'",[String.fromCodePoint(0x20AC).repeat(700)]);
  let response=await c.rawFetch("/api/intelligence/summary");assert.equal(response.status,409);assert.equal((await response.json()).code,"INTELLIGENCE_SUMMARY_LIMIT");
  await c.db.run("UPDATE leads SET name='Synthetic bounded' WHERE id='bounded-0'");
  await c.db.run("UPDATE leads SET source_metadata_json=? WHERE id='bounded-0'",[JSON.stringify({note:"x".repeat(1048576)})]);
  response=await c.rawFetch("/api/intelligence/summary");assert.equal(response.status,409);assert.equal((await response.json()).code,"INTELLIGENCE_SUMMARY_LIMIT");
  await c.db.run("UPDATE leads SET source_metadata_json=?",[JSON.stringify({note:"x".repeat(950000)})]);
  response=await c.rawFetch("/api/intelligence/summary");assert.equal(response.status,409);assert.equal((await response.json()).code,"INTELLIGENCE_SUMMARY_LIMIT");
  assert.equal(Number((await c.db.get("SELECT COUNT(*) AS n FROM intelligence_snapshots")).n),0);
  assert.equal(Number((await c.db.get("SELECT COUNT(*) AS n FROM action_executions")).n),0);
  await c.db.run("UPDATE leads SET source_metadata_json='{}'");
  assert.equal((await c.get("/api/intelligence/summary")).ranking.returned_count,9);
});
