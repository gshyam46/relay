import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { SettingsRepository } from "../src/modules/settings/settingsRepository.js";
import { EmailConnectionService } from "../src/modules/channels/emailConnectionService.js";
import { assessEmailConfiguration,isValidEmailMailbox,isValidSendgridPublicKey,EMAIL_SECRET_MASK } from "../src/modules/channels/emailConnectionContract.js";
const EMPTY={provider:"sandbox",from_email:"",reply_to:"",api_key:"",sendgrid_events_public_key:"",sendgrid_inbound_public_key:""};
const KEY=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({type:"spki",format:"pem"});
const SENDGRID={provider:"sendgrid",from_email:"owner@example.test",reply_to:"reply@parse.example.test",api_key:"synthetic-api-key",sendgrid_events_public_key:KEY,sendgrid_inbound_public_key:KEY};
async function fixture(t){
 const db=await createDatabase(":memory:");t.after(()=>db.close());const leads=new LeadsRepository(db),org=await leads.createOrganization({name:"Synthetic email setup"}),actor={id:"owner-"+org.id,role:"OWNER"};
 await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,'OWNER',?)",[actor.id,org.id,"Synthetic owner",actor.id+"@example.test","synthetic-only",new Date().toISOString()]);
 const settings=new SettingsRepository(db),service=new EmailConnectionService(db,{publicOrigin:"https://app.example.test"}),scope={organization_id:org.id,actor};
 const command=async(extra={})=>{const view=await service.get(scope);return {...scope,expected_revision:view.revision,review_token:view.review_token,request_key:"request-1",reason:"Owner reviewed synthetic email configuration.",...extra};};
 const count=async table=>Number((await db.get("SELECT count(*) n FROM "+table)).n);
 return {db,leads,org,actor,settings,service,scope,command,count};
}
test("empty and legacy setup reads create no settings, route or verification proof",async t=>{
 const f=await fixture(t),before=await f.count("organization_settings"),view=await f.service.get(f.scope);
 assert.equal(view.revision,0);assert.equal(view.management,"LEGACY");assert.equal(view.settings.provider,"sandbox");assert.equal(view.routing.provisioned,false);assert.equal(view.routing.inbound_url,null);assert.equal(view.verification.status,"UNVERIFIED");assert.equal(view.live_send_available,false);
 assert.ok(view.verification.checks.every(check=>check.status==="UNVERIFIED"));assert.equal(await f.count("organization_settings"),before);assert.equal(await f.count("email_connection_revisions"),0);assert.equal(await f.count("email_webhook_routes"),0);
 await f.settings.setBulk(f.org.id,"channel_email",{provider:"sendgrid",api_key:"synthetic-key-only"});
 const incomplete=await f.service.get(f.scope);assert.equal(incomplete.configuration.complete,false);assert.ok(incomplete.configuration.missing_fields.includes("reply_to"));assert.ok(incomplete.hold_reasons.includes("CHANNEL_SETUP_REQUIRED"));
});
test("full SendGrid structural validation remains unverified and secret history uses presence only",async t=>{
 const f=await fixture(t),saved=await f.service.save(await f.command({values:{...SENDGRID,from_email:"OWNER@EXAMPLE.TEST"}})),view=await f.service.get(f.scope);
 assert.equal(saved.change.revision,1);assert.equal(view.settings.from_email,"owner@example.test");assert.equal(view.configuration.complete,true);assert.equal(view.settings.api_key,EMAIL_SECRET_MASK);assert.equal(view.live_send_available,false);assert.ok(view.hold_reasons.includes("CHANNEL_VERIFICATION_REQUIRED"));assert.equal(view.management,"MANAGED");
 for(const publicResult of [saved,view,await f.service.history(f.scope)])assert.equal(JSON.stringify(publicResult).includes(SENDGRID.api_key),false);
 const stored=await f.settings.getCategory(f.org.id,"channel_email");assert.equal(stored.api_key,SENDGRID.api_key);assert.equal(stored.connection_revision,1);
 assert.equal(await f.count("ai_provider_attempts"),0);assert.equal(await f.count("action_executions"),0);
});
test("credential KEEP REPLACE CLEAR preserves exact original-request recovery after later writes",async t=>{
 const f=await fixture(t);await f.service.save(await f.command({values:SENDGRID}));
 const keepCmd=await f.command({request_key:"keep",values:{...SENDGRID,api_key:EMAIL_SECRET_MASK}}),keep=await f.service.save(keepCmd);
 await f.service.save(await f.command({request_key:"replace",values:{...SENDGRID,api_key:"second-synthetic-key"}}));
 assert.equal((await f.service.save(keepCmd)).change.revision,keep.change.revision);
 assert.equal((await f.service.byRequestKey({...f.scope,request_key:"keep"})).change.revision,2);
 assert.equal((await f.service.byRequestKey({...f.scope,request_key:"missing"})).change,null);
 assert.equal(await f.settings.get(f.org.id,"channel_email","api_key"),"second-synthetic-key");
 await f.service.save(await f.command({request_key:"clear",values:{...SENDGRID,api_key:""}}));
 assert.equal(await f.settings.get(f.org.id,"channel_email","api_key"),"");assert.equal((await f.service.get(f.scope)).settings.api_key_configured,false);
 await assert.rejects(f.service.save({...keepCmd,reason:"Different retry reason"}),{code:"EMAIL_CONNECTION_REQUEST_CONFLICT"});
});
test("strict owner values reject reserved flags, malformed mailboxes, unsupported curves and unsafe credentials",async t=>{
 const f=await fixture(t),base=await f.command({values:EMPTY});
 for(const values of [{...EMPTY,ready:true},{...EMPTY,webhook_token:"chosen"},{...EMPTY,provider:"resend"},{...EMPTY,reply_to:"A <reply@example.test>"},{...EMPTY,from_email:"a..b@example.test"},{...EMPTY,api_key:"credential\nheader"},{...EMPTY,sendgrid_events_public_key:generateKeyPairSync("ec",{namedCurve:"secp384r1"}).publicKey.export({type:"spki",format:"pem"})}])await assert.rejects(f.service.save({...base,values}),{code:"EMAIL_CONNECTION_INVALID_INPUT"});
 assert.equal(await f.count("email_connection_revisions"),0);assert.equal(isValidEmailMailbox("reply+tag@parse.example.test"),true);assert.equal(isValidEmailMailbox("reply@example.test\r\n"),false);assert.equal(isValidSendgridPublicKey(KEY),true);
 const der=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).publicKey.export({type:"spki",format:"der"}).toString("base64");assert.equal(isValidSendgridPublicKey(der),true);assert.equal(assessEmailConfiguration(SENDGRID).complete,true);
});
test("owner scope and current database role guard reads and writes",async t=>{
 const f=await fixture(t),foreign=await f.leads.createOrganization({name:"Other workspace"}),cmd=await f.command({values:EMPTY});
 await assert.rejects(f.service.get({...f.scope,organization_id:foreign.id}),{code:"EMAIL_CONNECTION_OWNER_REQUIRED"});
 await assert.rejects(f.service.save({...cmd,actor:{...f.actor,role:"MEMBER"}}),{code:"EMAIL_CONNECTION_OWNER_REQUIRED"});
 await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?",[f.actor.id]);await assert.rejects(f.service.save(cmd),{code:"EMAIL_CONNECTION_OWNER_REQUIRED"});
 assert.equal(await f.count("email_connection_revisions"),0);
});
test("concurrent expected revision and legacy editable drift require renewed exact review",async t=>{
 const f=await fixture(t),first=await f.command({values:EMPTY}),results=await Promise.allSettled([f.service.save(first),f.service.save({...first,request_key:"racing"})]);
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(results.find(result=>result.status==="rejected").reason.code,"EMAIL_CONNECTION_REVISION_STALE");
 const old=await f.command({request_key:"drift",values:{...EMPTY,api_key:EMAIL_SECRET_MASK}});
 await f.settings.setBulk(f.org.id,"channel_email",{api_key:"private-legacy-edit",legacy_private_metadata:{secret:"never-project"}});
 const drift=await f.service.get(f.scope);assert.equal(drift.management,"DRIFTED");assert.equal(JSON.stringify(drift).includes("never-project"),false);
 await assert.rejects(f.service.save(old),{code:"EMAIL_CONNECTION_REVIEW_STALE"});
 await f.service.save(await f.command({request_key:"adopt-drift",values:{...EMPTY,api_key:EMAIL_SECRET_MASK}}));assert.equal((await f.service.get(f.scope)).management,"MANAGED");
 assert.deepEqual(await f.settings.get(f.org.id,"channel_email","legacy_private_metadata"),{secret:"never-project"});
});
test("first routing provision, preserved legacy alias and audit commit atomically",async t=>{
 const f=await fixture(t);await f.settings.set(f.org.id,"channel_email","webhook_token","legacy-token");const cmd=await f.command();
 await f.db.exec("CREATE TRIGGER email_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.event_type='EmailConnectionChanged' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");
 await assert.rejects(f.service.provisionRoute(cmd));assert.equal(await f.count("email_webhook_routes"),0);assert.equal(await f.count("email_connection_revisions"),0);assert.equal(await f.settings.get(f.org.id,"channel_email","webhook_token"),"legacy-token");
 await f.db.exec("DROP TRIGGER email_audit_failure");const saved=await f.service.provisionRoute(cmd),view=await f.service.get(f.scope);
 assert.equal(saved.change.operation,"PROVISION_ROUTE");assert.equal(view.routing.generated_alias_count,1);assert.equal(view.routing.legacy_route_present,true);assert.equal(await f.count("email_webhook_routes"),2);
 assert.equal(await f.service.resolveWebhookToken("legacy-token"),f.org.id);assert.equal(await f.service.resolveWebhookToken(new URL(view.routing.events_url).pathname.split("/").at(-1)),f.org.id);
 assert.ok(view.routing.events_url.startsWith("https://app.example.test/"));assert.equal((await f.service.provisionRoute(cmd)).replayed,true);assert.equal(await f.count("email_webhook_routes"),2);
});
test("ten generated aliases preserve earlier signed-routing ownership while the eleventh is refused",async t=>{
 const f=await fixture(t),first=await f.service.provisionRoute(await f.command()),tokens=[new URL(first.change.after.routing.events_url).pathname.split("/").at(-1)];
 for(let i=2;i<=10;i++){const changed=await f.service.rotateRoute(await f.command({request_key:"rotate-"+i}));tokens.push(new URL(changed.change.after.routing.events_url).pathname.split("/").at(-1));}
 const view=await f.service.get(f.scope);assert.equal(view.routing.generated_alias_count,10);assert.equal(view.can_rotate,false);assert.equal(view.can_provision,false);
 for(const token of tokens)assert.equal(await f.service.resolveWebhookToken(token),f.org.id);
 await assert.rejects(f.service.rotateRoute(await f.command({request_key:"eleventh"})),{code:"EMAIL_CONNECTION_ROUTE_LIMIT"});assert.equal(await f.count("email_webhook_routes"),10);
 assert.equal(await f.service.resolveWebhookToken("unknown-route"),null);await assert.rejects(f.service.resolveWebhookToken("x".repeat(201)),{code:"CHANNEL_ROUTE_INVALID"});
});
test("legacy and generated token collisions refuse tenant selection and never silently drop an owner",async t=>{
 const f=await fixture(t),foreign=await f.leads.createOrganization({name:"Other workspace"});
 await f.settings.set(f.org.id,"channel_email","webhook_token","shared-token");await f.settings.set(foreign.id,"channel_email","webhook_token","shared-token");
 const view=await f.service.get(f.scope);assert.equal(view.can_provision,false);assert.ok(view.hold_reasons.includes("CHANNEL_ROUTE_AMBIGUOUS"));
 await assert.rejects(f.service.resolveWebhookToken("shared-token"),{code:"CHANNEL_ROUTE_AMBIGUOUS"});await assert.rejects(f.settings.findOrganizationIdByValue("channel_email","webhook_token","shared-token"),{code:"CHANNEL_ROUTE_AMBIGUOUS"});
 await assert.rejects(f.service.provisionRoute(await f.command()),{code:"CHANNEL_ROUTE_AMBIGUOUS"});assert.equal(await f.count("email_connection_revisions"),0);assert.equal(await f.settings.get(f.org.id,"channel_email","webhook_token"),"shared-token");
});
test("reserved route and revision drift cannot be repaired by an ordinary save",async t=>{
 const f=await fixture(t);await f.service.provisionRoute(await f.command());const fresh=await f.command({request_key:"save",values:EMPTY}),foreign=await f.leads.createOrganization({name:"Other workspace"});
 await f.settings.set(foreign.id,"channel_email","webhook_token","drift-collision");await f.settings.set(f.org.id,"channel_email","webhook_token","drift-collision");
 await assert.rejects(f.service.save(fresh),{code:"EMAIL_CONNECTION_STATE_INVALID"});await assert.rejects(f.service.resolveWebhookToken("drift-collision"),{code:"CHANNEL_ROUTE_AMBIGUOUS"});assert.equal(await f.count("email_connection_revisions"),1);assert.equal(await f.settings.get(f.org.id,"channel_email","webhook_token"),"drift-collision");
 const current=await f.db.get("SELECT token FROM email_webhook_routes WHERE organization_id=? AND route_kind='GENERATED'",[f.org.id]);await f.settings.set(f.org.id,"channel_email","webhook_token",current.token);await f.settings.set(f.org.id,"channel_email","connection_revision",99);
 await assert.rejects(f.service.get(f.scope),{code:"EMAIL_CONNECTION_STATE_INVALID"});assert.equal(await f.count("email_connection_revisions"),1);
});
test("oversized or corrupt settings fail before source materialization",async t=>{
 const f=await fixture(t);await f.settings.set(f.org.id,"channel_email","api_key","x".repeat(65537));
 const transaction=f.db.transaction.bind(f.db);let materialized=false,preflight=false;f.db.transaction=(work,options)=>transaction(async tx=>{const all=tx.all.bind(tx),get=tx.get.bind(tx);tx.all=(sql,args)=>{if(sql.startsWith("SELECT key,value"))materialized=true;return all(sql,args);};tx.get=(sql,args)=>{if(sql.includes("max_key FROM organization_settings"))preflight=true;return get(sql,args);};return work(tx);},options);
 await assert.rejects(f.service.get(f.scope),{code:"EMAIL_CONNECTION_SETTINGS_LIMIT"});assert.equal(preflight,true);assert.equal(materialized,false);f.db.transaction=transaction;
 await f.db.run("UPDATE organization_settings SET value='{' WHERE organization_id=? AND category='channel_email' AND key='api_key'",[f.org.id]);await assert.rejects(f.service.get(f.scope),{code:"EMAIL_CONNECTION_STATE_INVALID"});assert.equal(await f.count("email_connection_revisions"),0);
});
test("bounded revision history remains readable and exact accepted requests replay at the cap",async t=>{
 const f=await fixture(t),first=await f.command({values:EMPTY});await f.service.save(first);
 for(let i=2;i<=100;i++)await f.service.save(await f.command({request_key:"change-"+i,values:EMPTY}));
 const view=await f.service.get(f.scope);assert.equal(view.revision,100);assert.equal(view.can_save,false);assert.equal(view.review_token,null);assert.ok(view.hold_reasons.includes("EMAIL_CONNECTION_REVISION_LIMIT"));
 assert.equal((await f.service.save(first)).change.revision,1);
 const page=await f.service.history({...f.scope,limit:"50"});assert.equal(page.history.changes.length,50);assert.equal(page.history.next_before_revision,51);
 const older=await f.service.history({...f.scope,limit:50,before_revision:51});assert.equal(older.history.changes.at(-1).revision,1);assert.equal(older.history.has_more,false);
 await assert.rejects(f.service.history({...f.scope,limit:"1e2"}),{code:"EMAIL_CONNECTION_INVALID_INPUT"});
});

test("proposed configuration size refuses self-locking saves and preserves readable raw legacy data",async t=>{
 const f=await fixture(t);
 // Whitespace is preserved in the legacy SQL value; parsing and reserializing it
 // would undercount the bytes that an unrelated SAVE actually leaves stored.
 await f.settings.setBulk(f.org.id,"channel_email",{provider:"sandbox",legacy_private_metadata:"x"});
 const raw=" ".repeat(65000)+'"x"';
 await f.db.run("UPDATE organization_settings SET value=? WHERE organization_id=? AND category='channel_email' AND key='legacy_private_metadata'",[raw,f.org.id]);
 const before=await f.service.get(f.scope),auditCount=await f.count("audit_logs"),command=await f.command({values:{...EMPTY,api_key:"y".repeat(1000)}});
 await assert.rejects(f.service.save(command),{code:"EMAIL_CONNECTION_SETTINGS_LIMIT"});
 assert.equal(await f.count("email_connection_revisions"),0);assert.equal(await f.count("email_webhook_routes"),0);assert.equal(await f.count("audit_logs"),auditCount);
 assert.equal((await f.db.get("SELECT value FROM organization_settings WHERE organization_id=? AND category='channel_email' AND key='legacy_private_metadata'",[f.org.id])).value,raw);
 const after=await f.service.get(f.scope);assert.equal(after.revision,0);assert.equal(after.review_token,before.review_token);assert.equal(after.can_save,true);
 assert.equal((await f.service.byRequestKey({...f.scope,request_key:command.request_key})).change,null);
 const smaller=await f.service.save({...command,values:EMPTY});assert.equal(smaller.change.revision,1);assert.equal((await f.service.get(f.scope)).revision,1);
});
test("proposed key-count budget refuses save and first provisioning before any state or audit changes",async t=>{
 const f=await fixture(t),legacy=Object.fromEntries(Array.from({length:31},(_,index)=>["legacy_"+index,"retained"]));await f.settings.setBulk(f.org.id,"channel_email",legacy);
 const before=await f.service.get(f.scope),auditCount=await f.count("audit_logs"),command=await f.command();
 await assert.rejects(f.service.save({...command,values:EMPTY}),{code:"EMAIL_CONNECTION_SETTINGS_LIMIT"});
 await assert.rejects(f.service.provisionRoute({...command,request_key:"provision-over-limit"}),{code:"EMAIL_CONNECTION_SETTINGS_LIMIT"});
 assert.equal(await f.count("email_connection_revisions"),0);assert.equal(await f.count("email_webhook_routes"),0);assert.equal(await f.count("audit_logs"),auditCount);
 assert.deepEqual(await f.settings.getCategory(f.org.id,"channel_email"),legacy);assert.equal((await f.service.get(f.scope)).review_token,before.review_token);
});
