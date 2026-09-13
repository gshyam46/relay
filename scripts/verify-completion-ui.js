import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {safeTestEnvironment,verifyE2eHandshake} from "./helpers/testSafety.js";
import {startLandingFixture} from "./helpers/landingFixture.js";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--playwright-module"||!path.isAbsolute(args[1])||path.basename(args[1])!=="index.mjs")throw new Error("Supply an absolute installed Playwright index.mjs path.");
const fixture=await startLandingFixture(),base=fixture.base,initialBuild=await readFile("client/dist/index.html","utf8");
let browser,page,artifacts,count=0;const errors=[];
function pass(label){count++;console.log("PASS "+label);}
async function shown(locator){await locator.waitFor({state:"visible",timeout:20000});}
async function until(read,accept,label){const deadline=Date.now()+20000;let value;do{value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,80));}while(Date.now()<deadline);throw new Error(label+": "+JSON.stringify(value));}
try{
 await verifyE2eHandshake(base);const {chromium}=await import(pathToFileURL(args[1]).href);
 browser=await chromium.launch({headless:true,env:safeTestEnvironment(),args:["--disable-background-networking"]});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});context.setDefaultTimeout(20000);
 await context.route("**/*",route=>route.request().url().startsWith(base+"/")?route.continue():route.abort());
 page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));artifacts=await mkdtemp(path.join(tmpdir(),"relay-completion-ui-"));
 async function request(method,route,data,status=200){const response=await context.request[method](base+route,data===undefined?{}:{data});assert.equal(response.status(),status,route+": "+(await response.text()).slice(0,1000));return response.json();}
 const credentials={organization_name:"Synthetic full workflow",name:"Synthetic owner",email:"completion-ui@example.test",password:"original-completion-password"};
 const registered=await request("post","/api/auth/register",credentials,201),org=registered.organization.id;
 const lead=(await request("post","/api/leads",{name:"Synthetic completion enquiry",email:"enquiry@example.test"},201)).lead;
 await page.goto(base+"/leads/"+lead.id+"?tab=customer-workflow");
 await shown(page.getByRole("heading",{name:"Conversation ownership and attention",exact:true}));
 pass("current owner opens real conversation, reminder and outcome controls");
 await page.getByRole("button",{name:"Message",exact:true}).click();
 await page.getByRole("button",{name:"Email",exact:true}).click();
 await shown(page.getByRole("heading",{name:"Write a new message",exact:true}));
 await page.getByLabel("Composer subject").fill("Your room enquiry");await page.getByLabel("Composer message").fill("Which room dimensions should we use for your quote?");await page.getByLabel("Composer reason").fill("Ask for the missing dimensions");
 let original;
 await page.route("**/api/leads/"+lead.id+"/composer",async route=>{if(route.request().method()!=="POST")return route.continue();original=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Synthetic response loss"})});});
 await page.getByRole("button",{name:"Save draft for review",exact:true}).click();await shown(page.getByRole("button",{name:"Retry exact draft request",exact:true}));
 assert.equal(Number((await fixture.db.get("SELECT count(*) n FROM action_composer_commands")).n),1);assert.equal(await page.getByLabel("Composer message").isDisabled(),true);
 await page.unroute("**/api/leads/"+lead.id+"/composer");await page.getByRole("button",{name:"Check saved draft request",exact:true}).click();await shown(page.getByText("Draft saved as revision 1. Approval is still required.",{exact:true}));
 assert.equal(Number((await fixture.db.get("SELECT count(*) n FROM action_composer_commands")).n),1);assert.equal((await fixture.db.get("SELECT request_key FROM action_composer_commands")).request_key,original.request_key);
 pass("accepted draft response loss recovers one original draft without duplicate action");
 await page.getByRole("button",{name:"Review saved draft",exact:true}).click();await shown(page.getByRole("button",{name:"Approve this revision",exact:true}));
 await page.getByRole("button",{name:"Approve this revision",exact:true}).click();await until(()=>fixture.db.get("SELECT status FROM actions WHERE id=(SELECT action_id FROM action_composer_commands LIMIT 1)"),row=>row?.status==="APPROVED","Current revision approved");
 await page.getByRole("button",{name:"Outbound & Activity",exact:true}).click();
 await shown(page.getByRole("button",{name:"Send now",exact:true}));await page.getByRole("button",{name:"Send now",exact:true}).click();
 await until(()=>fixture.db.get("SELECT count(*) n FROM action_executions"),row=>Number(row.n)===1,"Sandbox send execution");
 pass("first exact message is approved and sent through normal Sandbox action controls");
 await page.getByRole("button",{name:"Conversation & Outcomes",exact:true}).click();
 await page.getByLabel("Conversation status",{exact:true}).selectOption("RESOLVED");await page.getByLabel("Read state",{exact:true}).selectOption("READ");await page.getByLabel("Assign to me",{exact:true}).check();await page.getByLabel("Reason for conversation change",{exact:true}).fill("Owner answered the first enquiry");
 await page.getByRole("button",{name:"Save conversation state",exact:true}).click();
 await until(()=>request("get","/api/leads/"+lead.id+"/conversation"),value=>value.conversation.revision===1,"Resolved conversation persisted");
 await request("post","/api/inbound-events/mock",{organization_id:org,lead_id:lead.id,channel:"EMAIL",provider_event_id:"completion-inbound-1",payload:{text:"Can you send a quote for a four metre room?"}},202);
 await page.goto(base+"/conversations");await page.getByRole("button").filter({has:page.getByText(lead.name,{exact:true})}).click();
 await shown(page.getByRole("paragraph").filter({hasText:"Can you send a quote for a four metre room?"}));await shown(page.getByRole("region",{name:"Recorded reply interpretation",exact:true}));
 const reopened=await request("get","/api/leads/"+lead.id+"/conversation");assert.equal(reopened.conversation.effective_status,"OPEN");assert.equal(reopened.conversation.read_state,"UNREAD");
 pass("new canonical inbound reopens resolved work and preserves original message plus interpretation");
 await page.getByRole("button",{name:"Write reviewed reply",exact:true}).click();await shown(page.getByRole("heading",{name:"Reply to this enquiry",exact:true}));
 await page.getByLabel("Composer subject").fill("Room quote follow-up");await page.getByLabel("Composer message").fill("Thank you. What ceiling height should the quote assume?");await page.getByLabel("Composer reason").fill("Reply to the newly received dimensions");
 if(await page.getByLabel("Acknowledge existing pending messages").count())await page.getByLabel("Acknowledge existing pending messages").check();
 await page.getByRole("button",{name:"Save draft for review",exact:true}).click();await shown(page.getByText("Draft saved as revision 1. Approval is still required.",{exact:true}));
 const commands=await fixture.db.all("SELECT message_kind,reply_to_message_id FROM action_composer_commands ORDER BY created_at,id");assert.equal(commands.length,2);assert.ok(commands.some(item=>item.message_kind==="REPLY"&&item.reply_to_message_id));assert.equal((await request("get","/api/leads/"+lead.id+"/conversation")).conversation.effective_status,"OPEN");
 await page.getByRole("button",{name:"Close composer",exact:true}).click();pass("a genuine second reply has separate action identity and does not resolve the conversation");
 await page.getByRole("link",{name:"Reminders and outcomes",exact:true}).click();
 await page.getByLabel("Reminder due time",{exact:true}).fill("2027-01-01T10:30");await page.getByLabel("Reminder and reason",{exact:true}).fill("Call the customer after the requested date");await page.getByRole("button",{name:"Create reminder",exact:true}).click();await shown(page.getByText("Call the customer after the requested date",{exact:true}));
 const taskCard=page.locator("article").filter({has:page.getByText("Call the customer after the requested date",{exact:true})});await taskCard.getByText("Update reminder",{exact:true}).click();await taskCard.getByLabel("Reminder operation",{exact:true}).selectOption("COMPLETE");await taskCard.getByLabel("Reason for reminder change",{exact:true}).fill("Owner completed the call");await taskCard.getByRole("button",{name:"Save reminder change",exact:true}).click();
 await until(()=>request("get","/api/leads/"+lead.id+"/follow-ups"),value=>value.follow_ups.some(item=>item.reason==="Call the customer after the requested date"&&item.status==="COMPLETED"),"Manual reminder completed");pass("real due-time reminder is created and completed without an outbound send");
 await page.getByRole("button",{name:"Record outcome",exact:true}).click();await page.getByLabel("Outcome kind",{exact:true}).selectOption("WON");await page.getByLabel("When the milestone happened",{exact:true}).fill("2026-01-01T10:30");await page.getByLabel("Summary",{exact:true}).fill("Customer confirmed the room design");await page.getByLabel("Reported won deal value (optional)",{exact:true}).fill("100000.10");await page.getByLabel("Currency for deal value",{exact:true}).fill("INR");await page.getByLabel("Reason for recording or correcting",{exact:true}).fill("Owner received the confirmation");await page.getByRole("button",{name:"Save outcome",exact:true}).click();await shown(page.getByText("Reported deal value: INR 100000.10",{exact:true}));
 const outcomePath=new URL(page.url()).pathname+new URL(page.url()).search;await page.goto(base+"/app");await shown(page.getByText("Reported wins",{exact:true}));const wonCard=page.getByText("Reported wins",{exact:true}).locator("../..");await shown(wonCard.getByText("1",{exact:true}));assert.equal((await request("get","/api/dashboard/metrics?organization_id="+org)).business_outcomes.by_kind.WON.enquiries,1);pass("dashboard reports the recorded win without a conversion-rate inference");await page.goto(base+outcomePath);await shown(page.getByText("Reported deal value: INR 100000.10",{exact:true}));
 await page.getByRole("button",{name:"Correct or withdraw outcome",exact:true}).click();await page.getByLabel("Record status",{exact:true}).selectOption("WITHDRAWN");await page.getByLabel("Reason for recording or correcting",{exact:true}).fill("The confirmation was entered in error");await page.getByRole("button",{name:"Save outcome",exact:true}).click();await page.getByRole("button",{name:"View outcome history",exact:true}).click();await shown(page.getByText(/Revision 1 \/ recorded \/ won/));
 const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export these outcomes",exact:true}).click();const exported=await download;assert.equal(exported.suggestedFilename(),"enquiry-outcomes.csv");await exported.saveAs(path.join(artifacts,"synthetic-outcomes.csv"));pass("exact deal value and withdrawal history are visible and selected outcomes download as CSV");
 await page.goto(base+"/app");await shown(page.getByText("Reported wins",{exact:true}));await shown(page.getByText("Reported wins",{exact:true}).locator("../..").getByText("0",{exact:true}));assert.equal((await request("get","/api/dashboard/metrics?organization_id="+org)).business_outcomes.withdrawn_outcomes,1);pass("withdrawing an outcome updates reported wins while preserving the original fact history");await page.goto(base+outcomePath);await shown(page.getByRole("heading",{name:"Conversation ownership and attention",exact:true}));
 await page.screenshot({path:path.join(artifacts,"workflow-desktop.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await page.screenshot({path:path.join(artifacts,"workflow-mobile.png"),fullPage:false});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);pass("customer workflow fits a 390px reduced-motion viewport");
 await page.setViewportSize({width:1440,height:1050});await page.goto(base+"/settings?tab=security");await shown(page.getByRole("heading",{name:"Account security",exact:true}));
 await page.getByLabel("Security current password").fill("incorrect-test-password");await page.getByRole("button",{name:"Replace recovery codes",exact:true}).click();await shown(page.getByRole("alert"));assert.equal(new URL(page.url()).pathname,"/settings");assert.equal((await context.request.get(base+"/api/auth/me")).status(),200);
 await page.getByRole("button",{name:"Refresh security and history",exact:true}).click();await page.getByLabel("Security current password").fill(credentials.password);await page.getByRole("button",{name:"Replace recovery codes",exact:true}).click();await shown(page.getByLabel("New recovery codes"));const codes=(await page.getByLabel("New recovery codes").inputValue()).split("\n");assert.equal(codes.length,8);await page.getByRole("button",{name:"I saved my codes; hide them",exact:true}).click();assert.equal(await page.getByLabel("New recovery codes").count(),0);pass("password typo keeps the session valid; recovery codes display once and can be hidden");
 await request("post","/api/auth/logout",{});await page.goto(base+"/recover");await page.getByLabel("Recovery email").fill(credentials.email);await page.getByLabel("Recovery code",{exact:true}).fill(codes[0]);await page.getByLabel("Recovery new password").fill("new-completion-password");await page.getByRole("button",{name:"Recover and reset password",exact:true}).click();await shown(page.getByRole("status"));await request("post","/api/auth/login",{email:credentials.email,password:"new-completion-password"});const security=await request("get","/api/auth/security");assert.equal(security.recovery.usable_count,7);pass("public offline-code recovery resets password and consumes exactly one code");
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.pumpErrors,[]);assert.equal(fixture.calls.length,0);assert.equal(await readFile("client/dist/index.html","utf8"),initialBuild);pass("unchanged built assets run without browser errors or live model/provider calls");
 console.log("Completion browser checks: "+count+" passed");console.log("Browser "+browser.version());console.log("Synthetic artifacts "+artifacts);
}catch(error){if(page&&artifacts)await page.screenshot({path:path.join(artifacts,"failure.png"),fullPage:true}).catch(()=>{});console.error("FAILED after "+count+" checks; artifacts "+artifacts);throw error;}
finally{await browser?.close();await fixture.close();}
