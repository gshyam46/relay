import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase} from "../src/database/database.js";
import {PilotInterestService} from "../src/modules/public-interest/pilotInterestService.js";
import {PilotInterestOperations} from "../src/modules/public-interest/pilotInterestOperations.js";
async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());let clock=Date.parse("2026-01-01T00:00:00Z");
 const intake=new PilotInterestService(db,{secret:"synthetic-pilot-secret-over-32-characters",now:()=>clock}),ops=new PilotInterestOperations(db,{now:()=>clock});
 async function create(n){await intake.submit({request_key:"synthetic-pilot-request-"+n,name:"Synthetic person "+n,email:"person"+n+"@example.test",company:"Synthetic Studio",workflow:"Prioritize existing enquiries",channel:"EMAIL",consent:true,website:""},"192.0.2."+(n+1));return db.get("SELECT * FROM pilot_interest_requests WHERE request_key=?",["synthetic-pilot-request-"+n]);}
 return {db,intake,ops,create,at:value=>clock=value};
}
test("pilot operator review has exact status/replay authority and retains no submission text in ledger",async t=>{
 const f=await fixture(t),row=await f.create(1),command={request_key:"operator-review",operator_reference:"operator-001",record_id:row.id,expected_status:"NEW",status:"REVIEWED"};
 const original=await f.ops.mark(command);await f.ops.mark({...command,request_key:"operator-close",expected_status:"REVIEWED",status:"CLOSED"});
 assert.equal((await f.ops.mark(command)).operation_id,original.operation_id);assert.equal((await f.ops.mark(command)).replayed,true);
 await assert.rejects(f.ops.mark({...command,request_key:"stale"}),{code:"PILOT_OPERATION_STALE"});
 await assert.rejects(f.ops.mark({...command,status:"CLOSED"}),{code:"PILOT_OPERATION_REQUEST_CONFLICT"});
 const ledger=JSON.stringify(await f.db.all("SELECT * FROM pilot_interest_operations"));for(const value of [row.email,row.name,row.workflow,row.company])assert.equal(ledger.includes(value),false);
});
test("retention purges exactly reviewed expired records and replay preserves later intake",async t=>{
 const f=await fixture(t),first=await f.create(1);f.at(Date.parse(first.expires_at));const preview=await f.ops.previewPurge();assert.deepEqual(preview.record_ids,[first.id]);
 const fresh=await f.create(2),command={...preview,request_key:"purge-1",operator_reference:"operator-001"};const result=await f.ops.purge(command);assert.equal(result.count,1);assert.ok(await f.db.get("SELECT id FROM pilot_interest_requests WHERE id=?",[fresh.id]));
 const again=await f.ops.purge(command);assert.equal(again.operation_id,result.operation_id);assert.equal(again.replayed,true);assert.equal(Number((await f.db.get("SELECT count(*) n FROM pilot_interest_requests")).n),1);
});
test("a changed retention selection is rejected and fresh contacts cannot be purged",async t=>{
 const f=await fixture(t),row=await f.create(1);f.at(Date.parse(row.expires_at));const preview=await f.ops.previewPurge();await f.ops.mark({request_key:"review-after-preview",operator_reference:"operator-001",record_id:row.id,expected_status:"NEW",status:"REVIEWED"});
 await assert.rejects(f.ops.purge({...preview,request_key:"stale-purge",operator_reference:"operator-001"}),{code:"PILOT_OPERATION_STALE"});assert.ok(await f.db.get("SELECT id FROM pilot_interest_requests WHERE id=?",[row.id]));
 const fresh=await f.create(2);await assert.rejects(f.ops.purge({...preview,record_ids:[fresh.id],request_key:"fresh-purge",operator_reference:"operator-001"}),{code:"PILOT_OPERATION_STALE"});
});
test("operator queue pages bound results and original commands do not create domain work",async t=>{
 const f=await fixture(t);for(let n=0;n<4;n++)await f.create(n);
 const first=await f.ops.list({limit:2}),next=await f.ops.list({limit:2,after_id:first.next_after_id});assert.equal(first.has_more,true);assert.equal(next.has_more,false);assert.equal(new Set([...first.requests,...next.requests].map(row=>row.id)).size,4);
 await assert.rejects(f.ops.list({limit:51}),{code:"PILOT_OPERATION_INVALID"});for(const table of ["leads","actions","action_executions","domain_events"])assert.equal(Number((await f.db.get("SELECT count(*) n FROM "+table)).n),0);
});
test("pilot operation and submitted status roll back together when its receipt cannot persist",async t=>{
 const f=await fixture(t),row=await f.create(1);
 await f.db.exec("CREATE TRIGGER fail_pilot_audit BEFORE INSERT ON pilot_interest_operations BEGIN SELECT RAISE(ABORT,'synthetic operator ledger failure'); END");
 await assert.rejects(f.ops.mark({request_key:"rollback",operator_reference:"operator-001",record_id:row.id,expected_status:"NEW",status:"REVIEWED"}));
 assert.equal((await f.db.get("SELECT status FROM pilot_interest_requests WHERE id=?",[row.id])).status,"NEW");assert.equal(Number((await f.db.get("SELECT count(*) n FROM pilot_interest_operations")).n),0);
});
