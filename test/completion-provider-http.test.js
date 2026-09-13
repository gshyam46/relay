import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {startClient} from "./helpers/testClient.js";
import {loadConfig} from "../src/config.js";
import {CHECK_IDS} from "../src/modules/channels/emailVerificationContract.js";
import {ChannelRouter} from "../src/modules/handlers/channelRouter.js";
test("actual signed HTTP receipts prove the current controlled email journey and invalidate on configuration edit",async t=>{
 const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),publicKey=keys.publicKey.export({type:"spki",format:"pem"});
 const config=loadConfig({NODE_ENV:"test",ENABLE_TEST_CONTROLS:"false",WORKER_ENABLED:"false",PUBLIC_APP_ORIGIN:"https://verification.example.test",EMAIL_VERIFICATION_DELIVERY_MAILBOX:"controlled@example.test",EMAIL_VERIFICATION_FAILURE_MAILBOX:"reject@example.test"});
 const c=await startClient(t,":memory:",{config}),owner=await c.register("Signed verification HTTP"),scope={organization_id:owner.organization.id,actor:owner.user};
 let checks=0,sends=0;
 c.services.emailVerificationService.adapter={async check(){checks++;return {version:1,checks:CHECK_IDS.map(id=>({id,status:"PASS",code:"SYNTHETIC_CONFIRMED",http_status:200}))};}};
 c.services.actionExecutor.adapter=new ChannelRouter({emailAdapter:{async send(){sends++;return {ok:true,provider:"sendgrid",provider_reference:"synthetic-reference"};}}});
 let state=await c.get("/api/settings/channels/email/connection");
 const settings={provider:"sendgrid",from_email:"sender@example.test",reply_to:"reply@parse.example.test",api_key:"synthetic-not-a-real-credential",sendgrid_events_public_key:publicKey,sendgrid_inbound_public_key:publicKey};
 await c.put("/api/settings/channels/email/connection",{expected_revision:state.revision,review_token:state.review_token,request_key:"signed-setup",reason:"Synthetic controlled setup",values:settings});
 state=await c.get("/api/settings/channels/email/connection");await c.post("/api/settings/channels/email/connection/provision",{expected_revision:state.revision,review_token:state.review_token,request_key:"signed-route",reason:"Synthetic route"});
 let view=await c.get("/api/channels/email/verification");const run=(await c.post("/api/channels/email/verification",{expected_connection_revision:view.connection_revision,review_token:view.review_token,request_key:"signed-run",reason:"Exercise authorized synthetic sinks"})).verification;
 const check={request_key:"signed-check"};await c.post("/api/channels/email/verification/"+run.id+"/check",check);assert.equal((await c.post("/api/channels/email/verification/"+run.id+"/check",check)).replayed,true);assert.equal(checks,1);
 const probes=[];
 for(const purpose of ["DELIVERY","FAILURE"]){
  const probe=(await c.post("/api/channels/email/verification/"+run.id+"/probes",{purpose,request_key:"signed-probe-"+purpose})).probe;
  const review=await c.get("/api/actions/"+probe.action_id+"/approval");await c.post("/api/actions/"+probe.action_id+"/approval/approve",{expected_revision_id:review.prepared_revision.id});
  await c.services.actionExecutor.execute(await c.services.actionsRepository.getAction(probe.action_id));const execution=await c.db.get("SELECT * FROM action_executions WHERE action_id=?",[probe.action_id]);probes.push({probe,execution});
 }
 assert.equal(sends,2);assert.equal(Number((await c.db.get("SELECT count(*) n FROM domain_events WHERE type IN ('LeadCreated','LeadReplyReceived')")).n),0);
 const connection=await c.services.settingsRepository.getCategory(scope.organization_id,"channel_email"),routeToken=connection.webhook_token;
 async function signed(path,body,type="application/json",tamper=false){
  const bytes=Buffer.from(body),timestamp=String(Math.floor(Date.now()/1000)),signature=sign("sha256",Buffer.concat([Buffer.from(timestamp),bytes]),keys.privateKey).toString("base64");
  return c.rawFetch(path,{method:"POST",headers:{"content-type":type,"x-twilio-email-event-webhook-timestamp":timestamp,"x-twilio-email-event-webhook-signature":signature},body:tamper?Buffer.concat([bytes,Buffer.from(" ")]):bytes});
 }
 for(const {probe,execution}of probes){
  const event={event:probe.purpose==="DELIVERY"?"delivered":"bounce",...(probe.purpose==="FAILURE"?{type:"bounce"}:{}),email:probe.purpose==="DELIVERY"?"controlled@example.test":"reject@example.test",sg_event_id:randomUUID(),relay_action_id:probe.action_id,relay_execution_id:execution.id,relay_revision_id:execution.action_revision_id,sg_message_id:"synthetic-mail-id"};
  const body=JSON.stringify([event]),path="/api/webhooks/sendgrid/events/"+routeToken;
  assert.equal((await signed(path,body,"application/json",true)).status,401);
  assert.equal((await signed(path,body)).status,200);assert.equal((await signed(path,body)).status,200);
 }
 view=await c.get("/api/channels/email/verification");assert.equal(view.live_send_available,false);assert.equal(view.verification.milestones.filter(item=>item.status==="RECORDED").length,2);
 async function inbound(text){
  const fields={from:"controlled@example.test",to:"reply@parse.example.test",envelope:JSON.stringify({from:"controlled@example.test",to:["reply@parse.example.test"]}),text,subject:"Re: controlled verification",headers:"Message-ID: <"+randomUUID()+"@example.test>"},boundary="synthetic-verification-"+randomUUID();
  const body=Object.entries(fields).map(([name,value])=>"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").join("")+"--"+boundary+"--\r\n";
  const response=await signed("/api/webhooks/sendgrid/inbound/"+routeToken,body,"multipart/form-data; boundary="+boundary);assert.equal(response.status,202,await response.text());
 }
 await inbound(view.verification.instructions.reply);assert.equal((await c.get("/api/channels/email/verification")).live_send_available,false);
 await inbound(view.verification.instructions.stop);view=await c.get("/api/channels/email/verification");assert.equal(view.live_send_available,true);assert.equal(view.verification.status,"VERIFIED");
 const proofs=await c.db.all("SELECT r.verification_kind,r.processing_state,r.mandatory_policy_status,p.kind FROM email_verification_receipts p JOIN webhook_receipts r ON r.id=p.receipt_id");
 assert.equal(proofs.length,4);assert.ok(proofs.every(row=>row.verification_kind==="SIGNED_PROVIDER"&&row.processing_state==="PROCESSED"&&row.mandatory_policy_status==="DONE"));
 assert.equal(Number((await c.db.get("SELECT count(*) n FROM domain_events WHERE type='LeadReplyReceived'")).n),0);assert.equal(Number((await c.db.get("SELECT count(*) n FROM ai_provider_attempts")).n),0);
 state=await c.get("/api/settings/channels/email/connection");assert.equal(state.live_send_available,true);assert.equal(state.verification.status,"VERIFIED");assert.equal((await c.get("/api/settings/channels/test?channel=email")).status,"verified");
 const lead=(await c.post("/api/leads",{name:"Synthetic normal enquiry",email:"normal@example.test"})).lead;assert.equal((await c.get("/api/leads/"+lead.id+"/composer")).configuration.can_dispatch,true);
 await c.put("/api/settings/channels/email/connection",{expected_revision:state.revision,review_token:state.review_token,request_key:"signed-setup-change",reason:"Change the synthetic sender",values:{...settings,from_email:"changed@example.test"}});
 assert.equal((await c.get("/api/channels/email/verification")).live_send_available,false);assert.equal((await c.get("/api/leads/"+lead.id+"/composer")).configuration.can_dispatch,false);assert.equal(sends,2);
});


async function signedRaceFixture(t) {
 const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),publicKey=keys.publicKey.export({type:"spki",format:"pem"});
 const config=loadConfig({NODE_ENV:"test",ENABLE_TEST_CONTROLS:"false",WORKER_ENABLED:"false",PUBLIC_APP_ORIGIN:"https://verification.example.test"});
 const c=await startClient(t,":memory:",{config}),owner=await c.register("Signed admission race"),org=owner.organization.id;
 const settings={provider:"sendgrid",from_email:"sender@example.test",reply_to:"reply@parse.example.test",api_key:"synthetic-never-used",sendgrid_events_public_key:publicKey,sendgrid_inbound_public_key:publicKey};
 let state=await c.get("/api/settings/channels/email/connection");
 await c.put("/api/settings/channels/email/connection",{expected_revision:state.revision,review_token:state.review_token,request_key:randomUUID(),reason:"Synthetic local configuration",values:settings});
 state=await c.get("/api/settings/channels/email/connection");await c.post("/api/settings/channels/email/connection/provision",{expected_revision:state.revision,review_token:state.review_token,request_key:randomUUID(),reason:"Synthetic local route"});
 const connection=await c.services.settingsRepository.getCategory(org,"channel_email");
 const signed=(path,body,type="application/json",tamper=false)=>{
  const bytes=Buffer.from(body),timestamp=String(Math.floor(Date.now()/1000)),signature=sign("sha256",Buffer.concat([Buffer.from(timestamp),bytes]),keys.privateKey).toString("base64");
  return c.rawFetch(path,{method:"POST",headers:{"content-type":type,"x-twilio-email-event-webhook-timestamp":timestamp,"x-twilio-email-event-webhook-signature":signature},body:tamper?Buffer.concat([bytes,Buffer.from(" ")]):bytes});
 };
 const count=async table=>Number((await c.db.get("SELECT COUNT(*) n FROM "+table+" WHERE organization_id=?",[org])).n);
 return {c,org,settings,token:connection.webhook_token,signed,count};
}
function holdSignedAdmission(t,c){
 const original=c.services.webhookInbox.receive.bind(c.services.webhookInbox);let enter,release,admissions=0,captured;
 const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);
 c.services.webhookInbox.receive=async(command,options)=>{
  admissions++;assert.equal(command.verification_kind,"SIGNED_PROVIDER");assert.equal(typeof options?.onInsertedInTransaction,"function");captured=command;enter();await waiting;return original(command,options);
 };
 t.after(()=>{release();c.services.webhookInbox.receive=original;});
 return {entered,release:()=>release(),admissions:()=>admissions,captured:()=>captured};
}
async function admissionReached(pending,hold){await Promise.race([hold.entered,pending.then(response=>{throw new Error("Expected signed admission barrier; received "+response.status);})]);}

test("raw signed event authenticated before a connection change cannot persist with its stale configuration",{timeout:15000},async t=>{
 const f=await signedRaceFixture(t),hold=holdSignedAdmission(t,f.c),path="/api/webhooks/sendgrid/events/"+f.token;
 const body=JSON.stringify([{event:"unsubscribe",email:"stale-customer@example.test",sg_event_id:randomUUID(),sg_message_id:"STALE-RAW-EVENT-CONTENT"}]);
 assert.equal((await f.signed(path,body,"application/json",true)).status,401);assert.equal(hold.admissions(),0,"Invalid raw signature never reaches receipt admission");
 const pending=f.signed(path,body);await admissionReached(pending,hold);assert.equal(hold.admissions(),1);assert.equal(await f.count("webhook_receipts"),0);
 try {
  const state=await f.c.get("/api/settings/channels/email/connection");
  await f.c.put("/api/settings/channels/email/connection",{expected_revision:state.revision,review_token:state.review_token,request_key:randomUUID(),reason:"Changed after original signature validation",values:{...f.settings,from_email:"changed@example.test"}});
 } finally {hold.release();}
 const response=await pending;assert.equal(response.status,409,await response.text());
 for(const table of ["webhook_receipts","callbacks","contact_restrictions","inbound_events","channel_messages","email_verification_receipts"])assert.equal(await f.count(table),0,table);
 assert.equal((await f.c.services.settingsRepository.getCategory(f.org,"channel_email")).from_email,"changed@example.test");assert.equal(await f.count("ai_provider_attempts"),0);
});

test("raw signed inbound authenticated before workspace erasure cannot reinsert its deleted customer payload",{timeout:15000},async t=>{
 const f=await signedRaceFixture(t);await f.c.post("/api/leads",{name:"Old customer",email:"old-customer@example.test"});
 const hold=holdSignedAdmission(t,f.c),boundary="synthetic-erasure-"+randomUUID(),fields={from:"old-customer@example.test",to:"reply@parse.example.test",envelope:JSON.stringify({from:"old-customer@example.test",to:["reply@parse.example.test"]}),text:"Please send pricing for ERASED-PRIVATE-PAYLOAD",subject:"Old customer request",headers:"Message-ID: <"+randomUUID()+"@example.test>"};
 const body=Object.entries(fields).map(([name,value])=>"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").join("")+"--"+boundary+"--\r\n",path="/api/webhooks/sendgrid/inbound/"+f.token,type="multipart/form-data; boundary="+boundary;
 const pending=f.signed(path,body,type);await admissionReached(pending,hold);assert.equal(await f.count("webhook_receipts"),0);assert.equal(hold.captured().event_kind,"INBOUND_MESSAGE");
 try {
  const preview=await f.c.post("/api/workspace-data/erasure-preview",{});assert.equal(preview.can_erase,true);
  const erased=await f.c.post("/api/workspace-data/erase",{request_key:randomUUID(),plan_token:preview.plan_token,confirmation:"ERASE WORKSPACE CUSTOMER DATA",current_password:"correct-horse-battery-staple"});assert.equal(erased.replayed,false);assert.equal(erased.erasure.erased_counts.leads,1);
 } finally {hold.release();}
 const response=await pending;assert.equal(response.status,409,await response.text());
 for(const table of ["leads","webhook_receipts","inbound_events","channel_messages","domain_events","contact_restrictions","email_webhook_routes","email_connection_revisions","email_verification_receipts","ai_provider_attempts"])assert.equal(await f.count(table),0,table);
 assert.equal((await f.c.get("/api/workspace-data/history")).erasures.length,1);assert.equal((await f.c.get("/api/workspace-data")).can_erase,true);
 assert.equal((await f.signed(path,body,type)).status,404,"A later request cannot resolve the erased route alias");assert.equal(hold.admissions(),1);assert.equal(await f.count("webhook_receipts"),0);
});
