// Actual production React with persisted synthetic adapter results. No live model claims.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { safeTestEnvironment, verifyE2eHandshake } from "./helpers/testSafety.js";
import { startIntelligenceTrustFixture } from "./helpers/intelligenceTrustFixture.js";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") throw new Error("Supply an absolute installed Playwright index.mjs path.");
const builtIndex = await readFile(path.resolve("client/dist/index.html"), "utf8");
const builtAssets = [...builtIndex.matchAll(new RegExp('(?:src|href)="(/assets/[^"]+)"', "g"))].map(match => match[1]);
assert.ok(builtAssets.some(asset => asset.endsWith(".js")), "A production client build is required.");
const requestedAssets = new Set();
const fixture = await startIntelligenceTrustFixture(), base = fixture.base;
let browser, page, artifacts, count = 0;
const errors = [], posts = [];
function pass(label) { count++; console.log("PASS " + label); }
async function shown(locator) { await locator.waitFor({ state: "visible", timeout: 15000 }); }
try {
  await verifyE2eHandshake(base);
  const { chromium } = await import(pathToFileURL(args[1]).href);
  browser = await chromium.launch({ headless: true, env: safeTestEnvironment(), args: ["--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  context.setDefaultTimeout(15000);
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  context.on("page", tab => { tab.on("pageerror", error => errors.push(error.name + ": " + error.message)); tab.on("request", request => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith("/assets/")) requestedAssets.add(pathname); if (request.method() === "POST") posts.push(pathname); }); });
  artifacts = await mkdtemp(path.join(tmpdir(), "relay-intelligence-trust-ui-"));
  async function request(method, route, data, status = 200) { const response = await context.request[method](base + route, data === undefined ? {} : { data }); assert.equal(response.status(), status, route + ": " + (await response.text()).slice(0, 1500)); return response.json(); }
  const stamp = Date.now();
  const registration = await request("post", "/api/auth/register", { organization_name: "Synthetic interpretation QA " + stamp, name: "Trust reviewer", email: "trust-" + stamp + "@test.relay.local", password: "trust-ui-test-password-only" }, 201), org = registration.organization.id;
  let serial = 0;
  const create = async name => (await request("post", "/api/leads", { organization_id: org, name, email: "trust-" + stamp + "-" + ++serial + "@test.relay.local", company: "Synthetic studio" }, 201)).lead;
  const leads = {};
  for (const key of ["local", "model", "empty", "rejected", "unavailable", "historical", "research"]) leads[key] = await create("Trust " + key + " extraction");
  await request("post", "/api/leads/" + leads.research.id + "/research-evidence", { organization_id: org, provider_key: "APPROVED_MANUAL_RESEARCH", idempotency_key: "trust-source-" + stamp, evidence_items: [{ source_type: "MANUAL", title: "Synthetic source record", source_reference: "Synthetic research account", claim_field: "COMPANY_NAME", claim_value: "Synthetic studio", confidence: "HIGH", evidence_timestamp: new Date(Date.now() - 86400000).toISOString() }] }, 201);
  const result = await request("post", "/api/intelligence/bulk-run", { organization_id: org, lead_ids: Object.values(leads).map(lead => lead.id) });
  assert.ok(result.results.every(item => item.status === "COMPLETED"), JSON.stringify(result));
  const intel = async lead => request("get", "/api/leads/" + lead.id + "/intelligence?organization_id=" + org);
  const replies = {};
  for (const [key, name, text] of [
    ["local", "Trust local reply", "Yes, I am interested."],
    ["unknown", "Trust unclear reply", "The brass door quietly remembers."],
    ["candidate", "Trust model candidate", "A seat at the table suits us."],
    ["fallback", "Trust reply fallback", "Can you share details?"],
    ["stop", "Trust explicit stop", "Please do not contact me again."],
    ["possibleStop", "Trust possible stop", "The signal should fade here."],
    ["historical", "Trust historical reply", "Historical reply fixture."],
  ]) {
    const lead = await create(name);
    const received = await request("post", "/api/inbound-events/mock", { organization_id: org, lead_id: lead.id, channel: "EMAIL", provider_event_id: "trust-" + stamp + "-" + key, payload: { text } }, 202);
    replies[key] = { lead, text, received };
  }
  const typedLead = await create("Trust typed event without original");
  await request("post", "/api/inbound-events/mock", { organization_id: org, lead_id: typedLead.id, channel: "EMAIL", provider_event_id: "trust-" + stamp + "-typed", event_type: "QUESTION", payload: {} }, 202);
  assert.equal(replies.candidate.received.classification.event_type, "UNKNOWN");
  assert.equal(replies.candidate.received.classification.candidate?.event_type, "POSITIVE_REPLY");
  assert.equal(replies.possibleStop.received.classification.event_type, "OPT_OUT");
  assert.equal(replies.possibleStop.received.classification.confidence, "LOW");
  for (let index = 0; index < 22; index++) await create("Trust paging fixture " + index);
  const usage = await request("get", "/api/ai/usage?organization_id=" + org);
  assert.equal(usage.summary.admitted_attempts, 7, "Only the four synthesis and three reply model fixtures acquire permits.");
  assert.equal(usage.items.filter(item => item.purpose === "SYNTHESIS").length, 4);
  assert.equal(usage.items.filter(item => item.purpose === "REPLY_CLASSIFICATION").length, 3);
  assert.ok(usage.items.every(item => item.request_state === "OBSERVED"));
  page = await context.newPage();
  const source = () => page.getByRole("region", { name: "Source extraction method", exact: true });
  async function detail(lead) { await page.goto(base + "/leads/" + lead.id + "?tab=intelligence"); await shown(page.getByRole("button", { name: "Intelligence", exact: true })); }
  await detail(leads.local); await shown(source().getByText("Application extraction", { exact: true }));
  await shown(source().getByText(/No model interpretation is claimed/));
  pass("persisted application extraction is visible and is not presented as model interpretation");
  const localIntel = await intel(leads.local), claim = localIntel.synthesis.summary.claims[0];
  await source().getByText(/Exact recorded claims and support/).click();
  const claimCard = source().getByRole("article").filter({ has: page.getByText(claim.value, { exact: true }) }).first();
  await shown(claimCard.getByRole("blockquote").filter({ hasText: claim.value })); await claimCard.getByText("Exact supporting record", { exact: true }).first().click();
  await shown(claimCard.getByText(claim.evidence_refs[0], { exact: true }));
  await page.screenshot({ path: path.join(artifacts, "exact-source-support.png") });
  pass("an exact recorded claim expands to its matching persisted source record and reference");
  await detail(leads.model); await shown(source().getByText("Model selected recorded facts", { exact: true })); await shown(source().getByText(/The model did not establish those facts as true/));
  pass("injected valid model selection is distinguished from application extraction and source truth");
  for (const [key, expected] of [["empty", "The model did not select a supported recorded fact."], ["rejected", "The model output did not satisfy the source-support checks"], ["unavailable", "The configured model could not complete this assessment."]]) {
    await detail(leads[key]); await shown(source().getByText("Fallback · review required", { exact: true })); await shown(source().getByText(expected, { exact: false }));
    assert.equal((await intel(leads[key])).synthesis.summary.claims.length, 0);
    assert.equal(await page.getByText("Unsupported guaranteed return", { exact: true }).count(), 0);
    pass(key + " model output stays visibly in review with no unsupported selected claim");
  }
  await detail(leads.historical); await shown(source().getByText("Method not recorded", { exact: true })); await shown(source().getByText(/cannot be inferred from today's model settings/));
  pass("historical synthesis without provenance does not acquire today's model attribution");
  await detail(leads.research); await shown(page.getByText(/Recorded source confidence: high/i)); await page.getByText("Supporting source records", { exact: true }).click(); await shown(page.getByText("Supporting source records", { exact: true }).locator("..").getByText("Synthetic research account", { exact: true }));
  pass("research findings expose their exact saved source and explain that source confidence does not prove truth");
  const directory = () => page.getByRole("region", { name: "Enquiry conversation directory", exact: true });
  async function waitDirectory() { const refresh = directory().getByRole("button", { name: "Refresh inbox", exact: true }); await shown(refresh); const deadline = Date.now() + 15000; while (!await refresh.isEnabled() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50)); assert.ok(await refresh.isEnabled(), "The bounded inbox request must settle."); await directory().getByText("Loading enquiries...", { exact: true }).waitFor({ state: "hidden" }); }
  async function openReplyLead(lead) {
    await page.goto(base + "/conversations"); await waitDirectory();
    for (let number = 0; number < 5; number++) {
      const row = directory().getByRole("button").filter({ has: page.getByText(lead.name, { exact: true }) });
      if (await row.count()) { await row.click(); await shown(page.getByRole("region", { name: "Conversation with " + lead.name, exact: true })); await shown(page.getByRole("region", { name: "Recorded reply interpretation", exact: true })); return row; }
      const next = directory().getByRole("button", { name: "Next enquiry page", exact: true }); assert.equal(await next.count(), 1, "The target enquiry must be available in the bounded directory pages."); const response = page.waitForResponse(result => new URL(result.url()).pathname === "/api/customer-workflow/conversations" && new URL(result.url()).searchParams.has("after_lead_id")); await next.click(); assert.equal((await response).status(), 200); await waitDirectory();
    }
    throw new Error("Synthetic enquiry was not found within the expected page bound.");
  }
  async function openReply(key) { await openReplyLead(replies[key].lead); await shown(page.getByRole("region", { name: "Conversation with " + replies[key].lead.name, exact: true }).getByText(replies[key].text, { exact: true }).first()); }
  const interpretation = () => page.getByRole("region", { name: "Recorded reply interpretation", exact: true });
  await openReply("local"); await shown(interpretation().getByText("Application reply rules", { exact: true })); await shown(interpretation().getByText(/not a measured probability/));
  pass("local reply method and limits of recorded confidence are visible beside the original message");
  await openReply("unknown"); await shown(interpretation().getByText("Interpretation unclear", { exact: true })); await shown(interpretation().getByText("Human review required", { exact: true })); await shown(page.getByRole("link", { name: "Reminders and outcomes", exact: true }));
  await page.getByRole("link", { name: "Reminders and outcomes", exact: true }).click(); await shown(page.getByRole("heading", { name: "Conversation ownership and attention", exact: true })); assert.equal(new URL(page.url()).pathname, "/leads/" + replies.unknown.lead.id); await page.getByRole("button", { name: "Intelligence", exact: true }).click(); await shown(interpretation().getByText("Human review required", { exact: true })); await shown(page.getByText(replies.unknown.text, { exact: true }).first());
  pass("unclear reply retains the original text and a usable existing lead-review path");
  await openReply("candidate"); await shown(interpretation().getByText("Model suggestion · human review required", { exact: true })); await shown(interpretation().getByText(/not confirmed customer intent/)); await shown(interpretation().getByRole("blockquote").filter({ hasText: replies.candidate.text }).first());
  await page.screenshot({ path: path.join(artifacts, "reply-candidate-review.png") });
  pass("a model candidate remains an unconfirmed suggestion while the recorded event stays unclear");
  await openReply("fallback"); await shown(interpretation().getByText("Fallback · human review", { exact: true })); await shown(interpretation().getByText("Human review required", { exact: true }));
  pass("provider failure is visibly a review fallback without an automatic retry action");
  await openReply("stop"); await shown(interpretation().getByText("Stop contact", { exact: true })); await shown(interpretation().getByText("Explicit stop rule", { exact: true }));
  const stopPanel = page.getByRole("region", { name: "Conversation with " + replies.stop.lead.name, exact: true }); assert.equal(await stopPanel.getByText(/^needs reply$/i).count(), 0); assert.doesNotMatch(await directory().getByRole("button").filter({ has: page.getByText(replies.stop.lead.name, { exact: true }) }).innerText(), /needs reply/i);
  pass("explicit stop remains visible and does not create a fabricated reply obligation");
  await openReply("possibleStop"); await shown(interpretation().getByText("Stop contact", { exact: true })); await shown(interpretation().getByText("Human review required", { exact: true })); await shown(interpretation().getByText(/A possible opt-out was identified by the model/));
  await page.screenshot({ path: path.join(artifacts, "possible-optout-review.png") });
  pass("LOW-confidence model opt-out preserves both conservative stop status and uncertainty");
  await openReply("historical"); await shown(interpretation().getByText("Method not recorded", { exact: true }));
  pass("historical reply method remains unavailable rather than inferred from current configuration");
  await detail(replies.candidate.lead); await shown(page.getByText("Original message", { exact: true })); await shown(interpretation().getByText("Model suggestion · human review required", { exact: true }));
  const timeline = await request("get", "/api/leads/" + replies.candidate.lead.id + "/timeline?organization_id=" + org);
  assert.equal(timeline.timeline.find(item => item.kind === "message").original_text, replies.candidate.text);
  pass("lead intelligence and conversations display the same persisted interpretation and original text");
  await detail(typedLead); await shown(page.getByText("Original message text is unavailable.", { exact: true })); await shown(interpretation().getByText("Method not recorded", { exact: true })); await shown(interpretation().getByText(/Confidence not recorded/));
  const typedRow = await openReplyLead(typedLead); assert.equal(await typedRow.getByText("Original message text is unavailable.", { exact: true }).count(), 0, "Directory rows are metadata-only, not an invented original-message preview."); const typedPanel = page.getByRole("region", { name: "Conversation with " + typedLead.name, exact: true }); await shown(typedPanel.getByText("Original message text is unavailable.", { exact: true })); await shown(interpretation().getByText("Method not recorded", { exact: true })); await shown(interpretation().getByText(/Confidence not recorded/));
  pass("typed event with no original body stays unavailable in detail and paged message panel, without an invented directory preview");
  await page.getByRole("link", { name: "Conversations", exact: true }).click(); await waitDirectory(); const firstPage = directory().getByRole("button", { name: "First enquiry page", exact: true }); if (await firstPage.count()) { await firstPage.click(); await waitDirectory(); } const nextPage = directory().getByRole("button", { name: "Next enquiry page", exact: true }); await shown(nextPage); await nextPage.click(); await shown(directory().getByRole("button", { name: "First enquiry page", exact: true })); await waitDirectory(); const pageResponse = page.waitForResponse(result => new URL(result.url()).pathname === "/api/customer-workflow/conversations" && new URL(result.url()).searchParams.has("after_lead_id")); await directory().getByRole("button", { name: "Refresh inbox", exact: true }).click(); assert.equal((await pageResponse).status(), 200); await directory().getByRole("combobox", { name: /^Attention on this page/ }).selectOption("UNREAD"); await directory().getByLabel("Find on this page", { exact: true }).fill("Trust"); await page.bringToFront();
  assert.deepEqual(posts, []); pass("viewing, navigating, filtering and focusing never POST analysis, sending or provider execution");
  assert.deepEqual(errors, []); pass("no browser runtime errors in the exercised interpretation journey");
  const otherContext = await browser.newContext(), otherEmail = "other-trust-" + stamp + "@test.relay.local", otherPassword = "other-trust-local-password";
  const otherRegistration = await otherContext.request.post(base + "/api/auth/register", { data: { organization_name: "Different owner workspace", name: "Different owner", email: otherEmail, password: otherPassword } }); assert.equal(otherRegistration.status(), 201); await otherContext.close();
  const sameDocument = "same-spa-" + stamp; await page.evaluate(value => { window.__trustSameDocument = value; }, sameDocument);
  await request("post", "/api/auth/logout", {}); await directory().getByRole("button", { name: "Refresh inbox", exact: true }).click(); await page.waitForURL(url => url.pathname === "/login");
  let releaseDirectory, directoryStarted; const blockedDirectory = new Promise(resolve => { releaseDirectory = resolve; }), sawDirectory = new Promise(resolve => { directoryStarted = resolve; });
  await page.route("**/api/customer-workflow/conversations*", async route => { directoryStarted(); await blockedDirectory; await route.continue(); });
  try {
    await page.getByLabel("Email", { exact: true }).fill(otherEmail); await page.locator('input[type="password"]').fill(otherPassword); await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(base + "/conversations"); await Promise.race([sawDirectory, new Promise((_, reject) => setTimeout(() => reject(new Error("New owner inbox was not requested")), 15000))]);
    assert.equal(await page.evaluate(() => window.__trustSameDocument), sameDocument, "Expiry and sign-in must reuse the same SPA document.");
    for (const value of Object.values(replies)) assert.equal(await page.getByText(value.lead.name, { exact: true }).count(), 0, "Prior owner enquiry must not flash while the new owner request is pending.");
  } finally { releaseDirectory(); }
  await waitDirectory(); await shown(directory().getByText("No enquiries match this page.", { exact: false })); await page.unroute("**/api/customer-workflow/conversations*");
  assert.deepEqual(posts, ["/api/auth/login"], "Only the explicit different-owner sign-in may POST after read-only interpretation checks."); assert.deepEqual(errors, []);
  pass("same-SPA session expiry and different-owner sign-in discard prior cached inbox metadata even while the new read is delayed");
  assert.equal(await readFile(path.resolve("client/dist/index.html"), "utf8"), builtIndex, "The production client must not change during verification.");
  for (const asset of builtAssets) assert.ok(requestedAssets.has(asset), "The browser must request the recorded build asset: " + asset);
  console.log("Verified production React assets: " + builtAssets.join(", "));
  console.log("Synthetic intelligence trust artifacts: " + artifacts);
  console.log("Intelligence trust React verification: " + count + " checks passed; Chromium " + browser.version() + ".");
  await context.close();
} catch (error) {
  console.error(error);
  if (page && artifacts) { await page.screenshot({ path: path.join(artifacts, "failure.png") }); console.error("Synthetic failure screenshot: " + path.join(artifacts, "failure.png")); console.error((await page.locator("body").innerText().catch(() => "Page unavailable")).slice(-6500)); }
  throw error;
} finally { if (browser) await browser.close(); await fixture.close(); }
