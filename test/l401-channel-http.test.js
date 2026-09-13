import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync,sign } from "node:crypto";
import { startClient } from "./helpers/testClient.js";
import { loadConfig } from "../src/config.js";
const base="/api/settings/channels/email/connection";
const empty={provider:"sandbox",from_email:"",reply_to:"",api_key:"",sendgrid_events_public_key:"",sendgrid_inbound_public_key:""};
const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),publicKey=keys.publicKey.export({type:"spki",format:"pem"}).trim();
const configured={provider:"sendgrid",from_email:"owner@example.test",reply_to:"replies@parse.example.test",api_key:"synthetic-private-key",sendgrid_events_public_key:publicKey,sendgrid_inbound_public_key:publicKey};
async function fixture(t){
  const config=loadConfig({NODE_ENV:"test",ENABLE_TEST_CONTROLS:"false",WORKER_ENABLED:"false",PUBLIC_APP_ORIGIN:"https://canonical.example.test"});
  const client=await startClient(t,":memory:",{config}),{organization,user}=await client.register("Synthetic channel setup");
  const command=async(values=empty,key="setup-save")=>{const current=await client.get(base);return {expected_revision:current.revision,review_token:current.review_token,request_key:key,reason:"Owner reviewed synthetic channel setup.",values};};
  const routeCommand=async(key)=>{const {values,...value}=await command(empty,key);return value;};
  const raw=(path,body,method="PUT")=>client.rawFetch(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const count=async table=>Number((await client.db.get("SELECT count(*) n FROM "+table)).n);
  return {client,organization,user,command,routeCommand,raw,count};
}
function signature(body){const timestamp=String(Math.floor(Date.now()/1000));return {"x-twilio-email-event-webhook-timestamp":timestamp,"x-twilio-email-event-webhook-signature":sign("sha256",Buffer.concat([Buffer.from(timestamp),body]),keys.privateKey).toString("base64")};}
test("normal setup and compatibility GETs never provision, call providers or claim readiness",async t=>{
  const f=await fixture(t),before=await f.count("audit_logs");
  const current=await f.client.get(base);assert.equal(current.revision,0);assert.equal(current.routing.provisioned,false);assert.equal(current.live_send_available,false);
  assert.equal((await f.client.get("/api/settings/channels/email/webhooks")).inbound_path,null);
  assert.equal((await f.client.get("/api/settings/channels/test?channel=email")).status,"sandbox");
  await f.client.get("/api/settings");
  for(const table of ["email_connection_revisions","email_webhook_routes","action_executions","ai_provider_attempts"])assert.equal(await f.count(table),0);
  assert.equal(await f.count("audit_logs"),before);
  await f.client.services.settingsRepository.setBulk(f.organization.id,"channel_email",{provider:"sendgrid",api_key:"synthetic-only"});
  const check=await f.client.get("/api/settings/channels/test?channel=email");
  assert.equal(check.status,"unconfigured");assert.equal(check.verification,"NOT_VERIFIED");assert.equal(check.provider_calls,0);
});
test("normal owner saves strict full setup, keeps/clears secrets and never grants live verification",async t=>{
  const f=await fixture(t),first=await f.command(configured);
  assert.equal((await f.client.put(base,first)).change.revision,1);
  let current=await f.client.get(base);assert.equal(current.configuration.complete,true);assert.equal(current.verification.status,"UNVERIFIED");assert.equal(current.live_send_available,false);
  assert.equal(current.settings.api_key,"********");assert.equal(current.settings.api_key_configured,true);
  assert.ok(current.hold_reasons.includes("CHANNEL_VERIFICATION_REQUIRED"));
  const keep=await f.command({...configured,api_key:"********",reply_to:"reviewed@parse.example.test"},"keep");
  await f.client.put(base,keep);
  assert.equal(await f.client.services.settingsRepository.get(f.organization.id,"channel_email","api_key"),configured.api_key);
  const prior=await f.client.get(base+"/requests/setup-save");assert.equal(prior.change.revision,1);
  assert.deepEqual((await f.client.put(base,first)).change,prior.change);
  assert.equal((await f.raw(base,{...first,reason:"Different intent"})).status,409);
  current=await f.client.get(base);
  const history=await f.client.get(base+"/history?limit=1");assert.equal(history.history.changes[0].revision,2);assert.equal(history.history.next_before_revision,2);
  for(const result of [current,history,prior,await f.client.get("/api/settings")])assert.equal(JSON.stringify(result).includes(configured.api_key),false);
  await f.client.put(base,await f.command({...empty,provider:"sendgrid"},"clear"));
  current=await f.client.get(base);assert.equal(current.settings.api_key_configured,false);assert.equal(current.configuration.complete,false);
  assert.equal(await f.count("action_executions"),0);
});
test("normal setup rejects generic mutation, server-authored fields, malformed identities and key material",async t=>{
  const f=await fixture(t),command=await f.command();
  assert.equal((await f.raw("/api/settings",{category:"channel_email",values:configured})).status,409);
  for(const category of ["channel_sms","channel_whatsapp","channel_call","channel_telegram"]){
    assert.equal((await f.raw("/api/settings",{category,values:{provider:"unverified-live",api_key:"synthetic"}})).status,409);
    assert.equal((await f.raw("/api/settings",{category,values:{provider:"sandbox",webhook_token:"forged"}})).status,400);
  }
  for(const extra of [{actor:f.user},{verification:"VERIFIED"},{provider_calls:0}])assert.equal((await f.raw(base,{...command,...extra})).status,400);
  for(const values of [{...empty,webhook_token:"forged"},{...empty,provider:"resend"},{...empty,reply_to:"Name <reply@example.test>"},{...empty,from_email:"a@example.test\r\nBcc:x@example.test"},{...empty,sendgrid_events_public_key:"private-or-invalid-key"},{...empty,api_key:"secret with spaces"}])assert.equal((await f.raw(base,{...command,values})).status,400);
  for(const query of ["limit=01","limit=1e1","limit=51","before_revision=0"])assert.equal((await f.client.rawFetch(base+"/history?"+query)).status,400);
  assert.equal(await f.count("email_connection_revisions"),0);
});
test("normal connection writes are owner-only, stale-safe and workspace-derived",async t=>{
  const f=await fixture(t),first=await f.command();
  assert.equal((await fetch(f.client.baseUrl+base)).status,401);
  await f.client.put(base,first);
  assert.equal((await f.raw(base,{...first,request_key:"stale"})).status,409);
  await f.client.db.run("UPDATE users SET role='VIEWER' WHERE id=?",[f.user.id]);
  for(const path of [base,base+"/history",base+"/requests/setup-save"])assert.equal((await f.client.rawFetch(path)).status,403);
  assert.equal((await f.raw(base,first)).status,403);
  await f.client.register("Different setup workspace");
  assert.equal((await f.client.get(base+"?organization_id="+f.organization.id)).revision,0);
  assert.equal((await f.client.get(base+"/requests/setup-save")).change,null);
  const foreignBody={...await f.command(empty,"other"),organization_id:f.organization.id};
  await f.client.put(base,foreignBody);
  assert.equal(Number((await f.client.db.get("SELECT count(*) n FROM email_connection_revisions WHERE organization_id=?",[f.organization.id])).n),1);
});
test("provisioning and rotation use canonical origin, recover original changes and preserve signed late aliases",async t=>{
  const f=await fixture(t),lead=await f.client.services.leadsRepository.createLead({organization_id:f.organization.id,name:"Synthetic contact",email:"reply@example.test"});
  await f.client.put(base,await f.command({...empty,sendgrid_events_public_key:publicKey,sendgrid_inbound_public_key:publicKey}));
  await f.client.services.settingsRepository.set(f.organization.id,"channel_email","webhook_token","unique-legacy-route");
  const provision=await f.routeCommand("provision"),saved=await f.client.post(base+"/provision",provision),first=await f.client.get(base);
  assert.equal(saved.change.operation,"PROVISION_ROUTE");assert.equal(first.routing.generated_alias_count,1);assert.equal(first.routing.legacy_route_present,true);
  assert.ok(first.routing.inbound_url.startsWith("https://canonical.example.test/"));assert.equal(await f.count("email_webhook_routes"),2);
  const oldGenerated=new URL(first.routing.events_url).pathname;
  await f.client.post(base+"/rotate",await f.routeCommand("rotate"));
  const newer=await f.client.get(base);assert.equal(newer.routing.generated_alias_count,2);assert.notEqual(newer.routing.events_url,first.routing.events_url);
  assert.deepEqual((await f.client.post(base+"/provision",provision)).change,saved.change);
  assert.equal((await f.client.get(base+"/requests/provision")).change.revision,saved.change.revision);
  for(const [i,path]of [oldGenerated,"/api/webhooks/sendgrid/events/unique-legacy-route"].entries()){
    const body=Buffer.from(JSON.stringify([{sg_event_id:"late-"+i,event:"unsubscribe",email:lead.email}]));
    const response=await f.client.rawFetch(path,{method:"POST",headers:{"content-type":"application/json",...signature(body)},body});
    assert.equal(response.status,200,await response.clone().text());
  }
  assert.equal((await f.client.services.contactPolicyService.inspectLead({organization_id:f.organization.id,lead_id:lead.id,channel:"EMAIL"})).restricted,true);
  assert.equal(await f.count("action_executions"),0);
});
test("ambiguous legacy tokens refuse ingress and provisioning without transferring routing ownership",async t=>{
  const f=await fixture(t),other=await f.client.services.leadsRepository.createOrganization({name:"Other legacy workspace"});
  for(const org of [f.organization.id,other.id])await f.client.services.settingsRepository.setBulk(org,"channel_email",{webhook_token:"shared-legacy-route",sendgrid_events_public_key:publicKey});
  const current=await f.client.get(base);assert.equal(current.can_provision,false);assert.ok(current.hold_reasons.includes("CHANNEL_ROUTE_AMBIGUOUS"));
  assert.equal((await f.raw(base+"/provision",await f.routeCommand("ambiguous"),"POST")).status,409);
  const body=Buffer.from(JSON.stringify([{sg_event_id:"ambiguous",event:"unsubscribe",email:"test@example.test"}]));
  const response=await f.client.rawFetch("/api/webhooks/sendgrid/events/shared-legacy-route",{method:"POST",headers:{"content-type":"application/json",...signature(body)},body});
  assert.equal(response.status,409);assert.equal(await f.count("webhook_receipts"),0);assert.equal(await f.count("email_connection_revisions"),0);
  for(const org of [f.organization.id,other.id])assert.equal(await f.client.services.settingsRepository.get(org,"channel_email","webhook_token"),"shared-legacy-route");
});
test("normal public settings mask legacy bot credentials without enabling an unsupported channel",async t=>{
  const f=await fixture(t),secret="synthetic-bot-credential";
  await f.client.services.settingsRepository.setBulk(f.organization.id,"channel_telegram",{provider:"telegram",bot_token:secret});
  const settings=await f.client.get("/api/settings");assert.equal(settings.settings.channel_telegram.bot_token,"********");assert.equal(settings.settings.channel_telegram.bot_token_configured,true);assert.equal(JSON.stringify(settings).includes(secret),false);
  assert.equal((await f.raw("/api/settings",{category:"channel_telegram",values:{bot_token:"replacement"}})).status,409);
  await f.client.put("/api/settings",{category:"channel_telegram",values:{provider:"sandbox",bot_token:"********"}});
  assert.equal(await f.client.services.settingsRepository.get(f.organization.id,"channel_telegram","bot_token"),secret);
});

test("email readiness and signed ingress refuse oversized stored configuration before receipt effects",async t=>{
  const f=await fixture(t);
  await f.client.services.settingsRepository.setBulk(f.organization.id,"channel_email",{...configured,webhook_token:"bounded-legacy-route",legacy_metadata:"x".repeat(65537)});
  for(const path of [base,"/api/settings/channels/test?channel=email","/api/settings"]){
    const response=await f.client.rawFetch(path);assert.equal(response.status,413);assert.equal((await response.json()).code,"EMAIL_CONNECTION_SETTINGS_LIMIT");
  }
  const body=Buffer.from(JSON.stringify([{sg_event_id:"over-limit",event:"unsubscribe",email:"synthetic@example.test"}]));
  const response=await f.client.rawFetch("/api/webhooks/sendgrid/events/bounded-legacy-route",{method:"POST",headers:{"content-type":"application/json",...signature(body)},body});
  assert.equal(response.status,413);assert.equal(await f.count("webhook_receipts"),0);assert.equal(await f.count("email_connection_revisions"),0);
});
