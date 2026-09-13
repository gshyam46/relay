import test from "node:test";
import assert from "node:assert/strict";
import {startClient} from "./helpers/testClient.js";
const pilot={request_key:"pilot-request-00000001",name:"Synthetic Owner",email:"owner@example.test",company:"Synthetic Studio",workflow:"Prioritize existing enquiries and answer their questions.",channel:"EMAIL",consent:true,website:""};
const post=(c,path,body)=>c.rawFetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
test("public pilot interest persists once without creating customer records or exposing request data",async t=>{
 const c=await startClient(t);let response=await post(c,"/api/public/pilot-requests",pilot);assert.equal(response.status,202);assert.deepEqual(await response.json(),{accepted:true});
 assert.equal((await post(c,"/api/public/pilot-requests",pilot)).status,202);
 assert.equal((await post(c,"/api/public/pilot-requests",{...pilot,name:"Changed"})).status,409);
 for(const body of [{...pilot,consent:false},{...pilot,actor:"forged"},{...pilot,request_key:"short"}])assert.equal((await post(c,"/api/public/pilot-requests",body)).status,400);
 assert.equal((await post(c,"/api/public/pilot-requests",{...pilot,request_key:"pilot-honeypot-0001",website:"bot.example.test"})).status,202);
 assert.equal(Number((await c.db.get("SELECT count(*) n FROM pilot_interest_requests")).n),1);
 for(const table of ["users","leads","action_executions"])assert.equal(Number((await c.db.get("SELECT count(*) n FROM "+table)).n),0);
 assert.equal((await fetch(c.baseUrl+"/api/public/pilot-requests",{method:"POST",headers:{origin:"https://untrusted.example.test","content-type":"application/json"},body:JSON.stringify(pilot)})).status,403);
});
test("pilot admission is durable and exact accepted retries survive the peer limit",async t=>{
 const c=await startClient(t);for(let n=0;n<5;n++)assert.equal((await post(c,"/api/public/pilot-requests",{...pilot,request_key:"pilot-limit-key-"+n})).status,202);
 const held=await post(c,"/api/public/pilot-requests",{...pilot,request_key:"pilot-limit-key-5"});assert.equal(held.status,429);assert.ok(Number(held.headers.get("retry-after"))>0);
 assert.equal((await post(c,"/api/public/pilot-requests",{...pilot,request_key:"pilot-limit-key-0"})).status,202);assert.equal(Number((await c.db.get("SELECT count(*) n FROM pilot_interest_requests")).n),5);
});
test("normal composer HTTP creates a genuine draft, recovers original intent and edits its exact schedule",async t=>{
 const c=await startClient(t),owner=await c.register("Composer HTTP");const lead=(await c.post("/api/leads",{name:"Synthetic Enquiry",email:"enquiry@example.test"})).lead;
 const path="/api/leads/"+lead.id+"/composer",view=await c.get(path);assert.equal(view.can_create,true);assert.equal(Number((await c.db.get("SELECT count(*) n FROM actions")).n),0);
 const input={request_key:"compose-request-1",review_token:view.review_token,acknowledge_pending:false,reason:"Answer the recorded enquiry",kind:"NEW_MESSAGE",reply_to_message_id:null,subject:"Your enquiry",body:"Which size would work for your room?",scheduled_at:null};
 const created=await c.post(path,input);assert.equal(created.prepared_revision.envelope.body,input.body);assert.equal((await c.post(path,input)).replayed,true);
 assert.equal((await c.get("/api/composer/requests/compose-request-1")).command.action_id,created.command.action_id);
 const actionId=created.command.action_id,edited=await c.put("/api/actions/"+actionId+"/composer",{request_key:"compose-edit-1",expected_revision_id:created.prepared_revision.id,reason:"Schedule an appropriate follow-up",subject:input.subject,body:input.body,scheduled_at:"2027-01-01T10:30:00+05:30"});assert.equal(edited.prepared_revision.envelope.scheduled_at,"2027-01-01T05:00:00.000Z");
 assert.equal((await c.get("/api/composer/requests/compose-request-1")).prepared_revision.id,created.prepared_revision.id);
 assert.equal((await post(c,path,{...input,request_key:"new-invalid",recipient:"foreign@example.test"})).status,400);
 const other=await c.register("Other Composer HTTP");assert.notEqual(other.organization.id,owner.organization.id);assert.equal((await c.rawFetch(path)).status,404);assert.equal((await c.get("/api/composer/requests/compose-request-1")).command,null);assert.equal(Number((await c.db.get("SELECT count(*) n FROM action_executions")).n),0);
});
test("account security HTTP hides session bearers and recovery consumes one code then requires fresh login",async t=>{
 const c=await startClient(t),email="security-http@example.test",password="original-password-for-test";await c.register("Security HTTP",{email,password});
 let state=await c.get("/api/auth/security");assert.equal(state.security_revision,0);assert.match(state.sessions[0].public_id,/^sref_/);assert.equal(state.sessions[0].id,undefined);
 const rotated=await c.post("/api/auth/security/recovery-codes",{expected_security_revision:0,current_password:password});assert.equal(rotated.recovery_codes.length,8);assert.equal(rotated.sign_in_required,false);
 state=await c.get("/api/auth/security");assert.equal(state.recovery.usable_count,8);assert.ok(!JSON.stringify(state).includes(rotated.recovery_codes[0]));
 const recovered=await post(c,"/api/auth/recover",{email,recovery_code:rotated.recovery_codes[0],new_password:"recovered-password-for-test"});assert.equal(recovered.status,200);assert.equal((await recovered.json()).sign_in_required,true);assert.equal((await c.rawFetch("/api/auth/security")).status,401);
 assert.equal((await post(c,"/api/auth/recover",{email,recovery_code:rotated.recovery_codes[0],new_password:"another-password-for-test"})).status,401);
 await c.login(email,"recovered-password-for-test");state=await c.get("/api/auth/security");assert.equal(state.recovery.usable_count,7);assert.equal(state.sessions.length,1);
 const revoked=await c.post("/api/auth/security/sessions/revoke-all",{expected_security_revision:state.security_revision,current_password:"recovered-password-for-test"});assert.equal(revoked.sign_in_required,true);assert.equal((await c.rawFetch("/api/auth/security")).status,401);
});

test("customer workflow HTTP preserves owner decisions, reminder identity and corrected outcomes",async t=>{
 const c=await startClient(t),owner=await c.register("Customer workflow HTTP"),lead=(await c.post("/api/leads",{name:"Synthetic workflow enquiry",email:"workflow@example.test"})).lead,base="/api/leads/"+lead.id;
 const initial=await c.get(base+"/conversation");assert.equal(initial.conversation.revision,0);
 const decision={request_key:"conversation-http-1",expected_revision:0,review_token:initial.conversation.review_token,status:"RESOLVED",read_state:"READ",assigned_owner_id:owner.user.id,reason:"Owner has answered the recorded request"};
 const saved=await c.post(base+"/conversation",decision);assert.equal(saved.change.revision,1);assert.equal((await c.post(base+"/conversation",decision)).replayed,true);
 assert.equal((await c.get("/api/customer-workflow/requests/CONVERSATION/conversation-http-1")).change.id,saved.change.id);
 assert.equal((await post(c,base+"/conversation",{...decision,request_key:"forged-assignment",actor:{id:owner.user.id}})).status,400);
 const list=await c.get("/api/customer-workflow/conversations");assert.ok(list.conversations.some(item=>item.lead.id===lead.id));
 const reminderView=await c.get(base+"/follow-ups"),reminder={request_key:"reminder-http-1",review_token:reminderView.review_token,due_at:"2027-01-01T12:30:00+05:30",reason:"Call after the requested date",reply_to_message_id:null};
 await c.post(base+"/follow-ups",reminder);assert.equal((await c.post(base+"/follow-ups",reminder)).replayed,true);
 const task=(await c.get(base+"/follow-ups")).follow_ups[0];assert.equal(task.due_at,"2027-01-01T07:00:00.000Z");assert.equal(task.origin,"MANUAL_REMINDER");
 await c.post("/api/follow-ups/"+task.id+"/change",{request_key:"reminder-http-complete",expected_task_token:task.state_token,operation:"COMPLETE",due_at:null,reason:"Owner completed the internal reminder"});
 assert.equal((await c.get(base+"/follow-ups")).follow_ups[0].status,"COMPLETED");
 const outcomeView=await c.get(base+"/outcomes"),outcome={outcome_id:null,expected_revision:0,review_token:outcomeView.review_token,request_key:"outcome-http-1",status:"RECORDED",reason:"Record the owner-confirmed result",values:{kind:"WON",occurred_at:"2026-01-01T10:00:00Z",summary:"=Synthetic customer confirmed",source_reference:"Recorded owner note",evidence_message_id:null,attributed_action_id:null,attribution_note:null,amount:{currency:"INR",value:"100000.10"}}};
 const recorded=await c.post(base+"/outcomes",outcome);assert.equal(recorded.change.values.amount.minor_units,"10000010");
 const current=(await c.get(base+"/outcomes")).outcomes[0];assert.equal(current.slot,"RESULT");
 const revision=await c.post(base+"/outcomes",{...outcome,outcome_id:current.id,expected_revision:current.revision,review_token:(await c.get(base+"/outcomes")).review_token,request_key:"outcome-http-correction",reason:"Correct the final customer decision",values:{...outcome.values,kind:"LOST",amount:null,summary:"Customer chose another option"}});
 assert.equal(revision.change.revision,2);assert.equal((await c.get("/api/customer-workflow/requests/OUTCOME/outcome-http-1")).change.values.kind,"WON");
 const history=await c.get("/api/outcomes/"+current.id);assert.equal(history.history.changes.length,2);
 const exported=await post(c,"/api/outcomes/export",{outcome_ids:[current.id]});assert.equal(exported.status,200);assert.match(exported.headers.get("content-type"),/^text\/csv/);assert.match(await exported.text(),/LOST/);
 await c.register("Other workflow HTTP");assert.equal((await c.rawFetch(base+"/conversation")).status,404);assert.equal((await c.rawFetch("/api/outcomes/"+current.id)).status,404);assert.equal((await c.get("/api/customer-workflow/requests/OUTCOME/outcome-http-1")).change,null);
 assert.equal(Number((await c.db.get("SELECT count(*) n FROM action_executions")).n),0);
});

test("readiness rejects a missing current authority table even when the migration ledger is current",async t=>{
 const c=await startClient(t);
 await c.db.exec("DROP TABLE action_composer_commands");
 const response=await c.rawFetch("/api/health/ready");assert.equal(response.status,503);
 const value=await response.json();assert.equal(value.status,"schema_incompatible");assert.equal(value.database.reachable,true);assert.equal(value.schema.compatible,false);assert.equal(value.migrations.pending.length,0);
 assert.equal(JSON.stringify(value).includes("action_composer_commands"),false);
});
test("routine logging masks offline recovery codes in scalar, array and nested forms",async()=>{
 const {createLogger}=await import("../src/shared/logger.js");const rows=[];const logger=createLogger({write:(_level,row)=>rows.push(row)});
 logger.info("security.local_check",{recovery_code:"synthetic-one-use-code",recoveryCodes:["synthetic-second-code"],metadata:{recovery_codes:["synthetic-third-code"]}});
 const result=JSON.stringify(rows);for(const text of ["synthetic-one-use-code","synthetic-second-code","synthetic-third-code"])assert.equal(result.includes(text),false);
 assert.match(result,/\[REDACTED\]/);
});

test("workspace export and password-confirmed erasure retain account access and replay without erasing newer data",async t=>{
 const c=await startClient(t),password="synthetic-lifecycle-password";await c.register("Lifecycle HTTP",{password});
 const lead=(await c.post("/api/leads",{name:"Synthetic customer for lifecycle",email:"lifecycle@example.test"})).lead;
 const status=await c.get("/api/workspace-data");assert.equal(status.inventory_version,1);assert.equal(status.can_export,true);assert.equal(status.can_erase,true);
 const exported=await post(c,"/api/workspace-data/export",{});assert.equal(exported.status,200);assert.match(exported.headers.get("content-disposition"),/attachment/);const data=await exported.json();assert.ok(data.records.leads.some(row=>row.id===lead.id));assert.equal(data.records.sessions,undefined);assert.ok(data.records.users.every(row=>row.password_hash===undefined));assert.equal(data.records.account_recovery_codes,undefined);assert.equal(JSON.stringify(data).includes(password),false);
 const preview=await c.post("/api/workspace-data/erasure-preview",{}),command={request_key:"lifecycle-http-erase",plan_token:preview.plan_token,confirmation:"ERASE WORKSPACE CUSTOMER DATA",current_password:password};
 const forged=await post(c,"/api/workspace-data/erase",{...command,session_token:"forged"});assert.equal(forged.status,400);
 const wrong=await post(c,"/api/workspace-data/erase",{...command,current_password:"incorrect"});assert.equal(wrong.status,403);assert.equal((await c.rawFetch("/api/auth/me")).status,200);
 const result=await c.post("/api/workspace-data/erase",command);assert.ok(result.erasure.id);assert.equal(Number((await c.db.get("SELECT count(*) n FROM leads")).n),0);assert.equal((await c.rawFetch("/api/auth/me")).status,200);
 assert.equal((await c.get("/api/workspace-data/requests/lifecycle-http-erase")).erasure.id,result.erasure.id);
 const fresh=(await c.post("/api/leads",{name:"New synthetic enquiry after erasure",email:"fresh@example.test"})).lead;
 const replay=await c.post("/api/workspace-data/erase",command);assert.equal(replay.replayed,true);assert.equal(replay.erasure.id,result.erasure.id);assert.ok(await c.db.get("SELECT id FROM leads WHERE id=?",[fresh.id]));
 const history=await c.get("/api/workspace-data/history");assert.equal(history.erasures.length,1);
});
test("operational status is owner-scoped metadata with in-app-only alert semantics",async t=>{
 const c=await startClient(t);assert.equal((await c.rawFetch("/api/operations/status")).status,401);await c.register("Operations HTTP");
 await c.post("/api/leads",{name:"Synthetic operational enquiry",email:"ops@example.test"});
 const value=await c.get("/api/operations/status");assert.equal(value.version,1);assert.equal(value.scope,"WORKSPACE");assert.equal(value.counts.leads,1);assert.equal(value.alert_delivery,"IN_APP_ONLY");assert.equal(JSON.stringify(value).includes("ops@example.test"),false);assert.equal(value.sending.policy_valid,true);
 await c.register("Other operations HTTP");assert.equal((await c.get("/api/operations/status")).counts.leads,0);
});
