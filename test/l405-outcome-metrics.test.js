import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { CustomerWorkflowService } from "../src/modules/customer-workflow/customerWorkflowService.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
import { loadOutcomeMetrics } from "../src/modules/customer-workflow/outcomeMetrics.js";

async function fixture(t) {
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const leads = new LeadsRepository(db);
  const org = await leads.createOrganization({ name: "Synthetic outcome metrics" });
  const actor = { id: "metrics-owner-" + org.id, role: "OWNER" };
  await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",
    [actor.id,org.id,"Owner",actor.id+"@example.test","synthetic-only","2026-09-13T10:00:00.000Z"]);
  const service = new CustomerWorkflowService(db, { now: () => Date.parse("2026-09-13T10:00:00.000Z") });
  let sequence = 0;
  const lead = () => leads.createLead({ organization_id:org.id,name:"Synthetic enquiry "+ ++sequence,source:"MANUAL" });
  async function record(leadId, kind, previous = null, status = "RECORDED") {
    const scope = { organization_id:org.id,lead_id:leadId,actor };
    const input = { ...scope,outcome_id:previous?.id??null,expected_revision:previous?.revision??0,
      review_token:(await service.listOutcomes(scope)).review_token,request_key:"metrics-command-"+ ++sequence,status,
      reason:"Owner reviewed the milestone.",values:{kind,occurred_at:"2026-09-12T10:00:00.000Z",summary:"Private customer outcome note.",
        source_reference:"Private customer source",evidence_message_id:null,attributed_action_id:null,attribution_note:null,
        amount:kind==="WON"?{currency:"INR",value:"9007199254740993.01"}:null}};
    return (await service.saveOutcome(input)).change;
  }
  return {db,org,actor,leads,lead,record,read:()=>loadOutcomeMetrics(db,{organization_id:org.id})};
}

test("empty active-enquiry metrics have fixed zero keys and no domain writes", async t => {
  const f = await fixture(t);
  const before = await f.db.get("SELECT count(*) n FROM audit_logs");
  assert.deepEqual(await f.read(), {
    scope:"ACTIVE_ENQUIRIES",recorded_outcomes:0,withdrawn_outcomes:0,enquiries_with_recorded_outcome:0,
    by_kind:{QUALIFIED_CONVERSATION:{outcomes:0,enquiries:0},MEETING_BOOKED:{outcomes:0,enquiries:0},QUOTE_REQUESTED:{outcomes:0,enquiries:0},WON:{outcomes:0,enquiries:0},LOST:{outcomes:0,enquiries:0}}
  });
  assert.deepEqual(await f.db.get("SELECT count(*) n FROM audit_logs"),before);
  await assert.rejects(loadOutcomeMetrics(f.db,{organization_id:""}),{code:"OUTCOME_METRICS_SCOPE_INVALID"});
});

test("current milestones overlap by enquiry while corrected and withdrawn results replace earlier wins", async t => {
  const f = await fixture(t),first = await f.lead(),second = await f.lead();
  for (const kind of ["QUALIFIED_CONVERSATION","MEETING_BOOKED","QUOTE_REQUESTED"]) await f.record(first.id,kind);
  let firstResult = await f.record(first.id,"WON"), secondResult = await f.record(second.id,"WON");
  let m = await f.read();
  assert.equal(m.recorded_outcomes,5);
  assert.equal(m.enquiries_with_recorded_outcome,2);
  assert.deepEqual(m.by_kind.WON,{outcomes:2,enquiries:2});
  assert.equal(Object.values(m.by_kind).reduce((n,v)=>n+v.enquiries,0),5);
  firstResult = await f.record(first.id,"LOST",firstResult);
  secondResult = await f.record(second.id,"WON",secondResult,"WITHDRAWN");
  m = await f.read();
  assert.equal(m.recorded_outcomes,4);
  assert.equal(m.withdrawn_outcomes,1);
  assert.equal(m.enquiries_with_recorded_outcome,1);
  assert.deepEqual(m.by_kind.WON,{outcomes:0,enquiries:0});
  assert.deepEqual(m.by_kind.LOST,{outcomes:1,enquiries:1});
  await f.record(second.id,"WON",secondResult);
  assert.equal((await f.read()).by_kind.WON.enquiries,1);
  const history = await f.db.all("SELECT amount_json FROM business_outcome_revisions WHERE outcome_id=? ORDER BY revision",[firstResult.id]);
  assert.equal(JSON.parse(history[0].amount_json).minor_units,"900719925474099301");
  assert.equal(history[1].amount_json,null);
  assert.equal((await f.db.get("SELECT status FROM leads WHERE id=?",[first.id])).status,"NEW");
  for (const privateValue of ["Private customer","900719925474099301","INR"]) assert.equal(JSON.stringify(m).includes(privateValue),false);
});

test("archived and foreign enquiries are excluded and legacy converted status cannot create a reported win", async t => {
  const f = await fixture(t),archived = await f.lead(),active = await f.lead(),legacy = await f.lead();
  await f.record(archived.id,"WON");
  await f.record(archived.id,"MEETING_BOOKED");
  await f.record(active.id,"LOST");
  await f.db.run("UPDATE leads SET archived_at=? WHERE id=?",["2026-09-13T10:00:00.000Z",archived.id]);
  await f.db.run("UPDATE leads SET status='CONVERTED' WHERE id=?",[legacy.id]);
  const other = await f.leads.createOrganization({name:"Another workspace"});
  const otherLead = await f.leads.createLead({organization_id:other.id,name:"Other customer",source:"MANUAL"});
  const m = await f.read();
  assert.equal(m.recorded_outcomes,1);
  assert.equal(m.enquiries_with_recorded_outcome,1);
  assert.equal(m.by_kind.WON.enquiries,0);
  assert.equal(m.by_kind.MEETING_BOOKED.enquiries,0);
  assert.equal(m.by_kind.LOST.enquiries,1);
  assert.equal((await loadOutcomeMetrics(f.db,{organization_id:other.id})).recorded_outcomes,0);
  assert.ok(otherLead);
  const policy = new ContactPolicyService(f.db);
  assert.deepEqual(await policy.withWorkspacePolicyTransaction(f.org.id,tx=>loadOutcomeMetrics(tx,{organization_id:f.org.id})),m);
  await assert.rejects(policy.withWorkspacePolicyTransaction(f.org.id,tx=>loadOutcomeMetrics(tx,{organization_id:other.id})),/matching workspace transaction/);
});

test("an active parent without a current revision fails closed instead of silently disappearing", async t => {
  const f = await fixture(t),lead = await f.lead();
  await f.db.run("INSERT INTO business_outcomes(id,organization_id,lead_id,slot,created_at,created_by) VALUES(?,?,?,'RESULT',?,?)",
    ["orphan-outcome",f.org.id,lead.id,"2026-09-13T10:00:00.000Z",f.actor.id]);
  await assert.rejects(f.read(),{code:"OUTCOME_METRICS_STATE_INVALID"});
});

test("inconsistent slot/kind and unsafe aggregate counters are unavailable without source materialization", async t => {
  const f = await fixture(t),lead = await f.lead(),outcome = await f.record(lead.id,"MEETING_BOOKED");
  await f.db.run("UPDATE business_outcome_revisions SET kind='WON' WHERE outcome_id=?",[outcome.id]);
  await assert.rejects(f.read(),{code:"OUTCOME_METRICS_STATE_INVALID"});
  await f.db.run("UPDATE business_outcome_revisions SET kind='MEETING_BOOKED' WHERE outcome_id=?",[outcome.id]);
  const policy = new ContactPolicyService(f.db);
  await policy.withWorkspacePolicyTransaction(f.org.id,async tx=>{
    const original = tx.all.bind(tx);
    tx.all = async(sql,params)=>{
      assert.equal(sql.includes("amount_json"),false);
      assert.equal(sql.includes("summary"),false);
      assert.equal(sql.includes("source_reference"),false);
      const rows = await original(sql,params);
      return rows.map(row=>row.category==="TOTAL"?{...row,outcomes:"9007199254740992"}:row);
    };
    await assert.rejects(loadOutcomeMetrics(tx,{organization_id:f.org.id}),{code:"OUTCOME_METRICS_STATE_INVALID"});
  });
});
