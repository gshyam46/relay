// Production React data-management journey against an explicitly isolated owned target.
// Uses an already installed Playwright package; never installs dependencies or contacts providers.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseCsv } from "../src/modules/data-foundation/csvParser.js";
import { safeTestEnvironment, verifyE2eHandshake, workflowVerificationTarget } from "./helpers/testSafety.js";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") throw new Error("Supply --playwright-module with an absolute installed Playwright index.mjs path.");
const base = workflowVerificationTarget(process.env.VERIFY_BASE_URL); await verifyE2eHandshake(base);
const { chromium } = await import(pathToFileURL(args[1]).href);
const browser = await chromium.launch({ headless: true, env: safeTestEnvironment(), args: ["--disable-background-networking"] });
let page, artifacts, count = 0; const errors = [];
function pass(label) { count++; console.log("PASS " + label); }
async function shown(locator) { await locator.waitFor({ state: "visible", timeout: 15000 }); }
async function responseFor(route, method, click, status = 200) { const pending = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === method, { timeout: 15000 }); await click(); const response = await pending; assert.equal(response.status(), status, await response.text()); return response.json(); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  context.setDefaultTimeout(10000); context.setDefaultNavigationTimeout(15000);
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  context.on("page", tab => tab.on("pageerror", error => errors.push(error.name + ": " + error.message)));
  artifacts = await mkdtemp(path.join(tmpdir(), "relay-lead-data-ui-")); const stamp = Date.now();
  const registration = await context.request.post(base + "/api/auth/register", { data: { organization_name: "Data QA " + stamp, name: "Data reviewer", email: "data-owner-" + stamp + "@test.relay.local", password: "data-test-password-only" } });
  assert.equal(registration.status(), 201); const org = (await registration.json()).organization.id;
  async function request(method, route, data, status = 200) { const result = await context.request[method](base + route, data ? { data } : {}); assert.equal(result.status(), status, await result.text()); return result.json(); }
  async function get(route) { return request("get", route); }
  async function create(name, email, company = "Directory fixture") { return (await request("post", "/api/leads", { organization_id: org, name, email, company }, 201)).lead; }
  const primaryEmail = "primary-" + stamp + "@test.relay.local", targetEmail = "corrected-" + stamp + "@test.relay.local";
  const initial = await request("post", "/api/imports/csv/preview", { filename: "data-original.csv", csv_text: 'Name,Email,Interest,Budget,Currency\nOriginal imported enquiry,' + primaryEmail + ',Cabinet restoration,9007199254740993.10,INR', default_phone_region: "INTERNATIONAL_ONLY", mapping: { name: 0, email: 1, interest: 2, budget_amount: 3, currency: 4 }, options: { date_format: "ISO", default_currency: "INR", assertion: "OPERATOR_OBSERVED" } }, 201);
  const committed = await request("post", "/api/imports/" + initial.import_id + "/commit", { expected_revision: initial.review_revision, selected_row_ids: [initial.rows[0].id] }); const id = committed.rows[0].created_lead_id;
  const dataPath = "/api/leads/" + id + "/data", archivePath = "/api/leads/" + id + "/archive";
  const originalSources = await get("/api/leads/" + id + "/import-sources"), originalContext = await get("/api/leads/" + id + "/enquiry-context");
  const candidate = await create("Matching enquiry candidate", targetEmail);
  await request("post", "/api/leads/" + id + "/contact-restrictions", { channel: "ALL", reason: "OPT_OUT", idempotency_key: "data-fixture-" + stamp });
  page = await context.newPage(); await page.goto(base + "/leads/" + id + "?tab=data");
  const current = () => page.getByRole("region", { name: "Current saved lead data", exact: true });
  await shown(current().getByRole("heading", { name: "Current saved data - revision 0", exact: true }));
  assert.equal(await page.getByLabel("Corrected name", { exact: true }).inputValue(), "Original imported enquiry");
  assert.equal(await page.getByRole("button", { name: "Save contact correction", exact: true }).count(), 0);
  pass("imported record opens current contact data with revision and requires preview before correction");
  await page.getByLabel("Corrected phone", { exact: true }).fill("invalid123");
  await responseFor(dataPath + "/preview", "POST", () => page.getByRole("button", { name: "Preview contact correction", exact: true }).click(), 400);
  assert.equal(await page.getByLabel("Corrected phone", { exact: true }).inputValue(), "invalid123");
  pass("invalid phone interpretation is rejected without losing the draft");
  const formulaName = '=HYPERLINK("synthetic-only")';
  async function fillCorrection(name = formulaName, company = "01234567890123456789") { await page.getByLabel("Corrected name", { exact: true }).fill(name); await page.getByLabel("Corrected email", { exact: true }).fill(targetEmail); await page.getByLabel("Corrected phone", { exact: true }).fill("9876543210"); await page.getByLabel("Correction phone interpretation", { exact: true }).selectOption("IN"); await page.getByLabel("Corrected company", { exact: true }).fill(company); }
  async function review(reason) { const result = await responseFor(dataPath + "/preview", "POST", () => page.getByRole("button", { name: "Preview contact correction", exact: true }).click()); await page.getByLabel("Correction reason", { exact: true }).fill(reason); await page.getByLabel("I reviewed the normalized contact, matching enquiries and affected work.", { exact: true }).check(); return result; }
  await fillCorrection(); let comparison = await review("Confirmed revised contact with the customer"); assert.equal(comparison.proposed.normalized_values.normalized_phone, "+919876543210"); assert.equal(comparison.duplicate_total, 1); assert.equal(comparison.current_policy.restricted, true); assert.equal(comparison.proposed_policy.restricted, true); assert.equal(comparison.duplicate_candidates[0].lead.id, candidate.id);
  await shown(page.getByRole("link", { name: "Matching enquiry candidate", exact: true })); assert.equal(await page.getByText("All channels: Opt-out", { exact: true }).count(), 2);
  await page.getByRole("region", { name: "Contact correction preview", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" })); await page.screenshot({ path: path.join(artifacts, "contact-correction-review.png") });
  pass("preview compares normalized phone, duplicate enquiry and retained contact restrictions before confirmation");
  async function apiCorrect(company) { const saved = await get(dataPath); const input = { expected_revision: saved.current.data_revision, values: { ...saved.current.values, company }, default_phone_region: "IN" }; const preview = await request("post", dataPath + "/preview", input); return request("put", dataPath, { ...input, review_token: preview.review_token, reason: "Synthetic concurrent owner correction " + company }); }
  await apiCorrect("Concurrent owner value");
  await responseFor(dataPath, "PUT", () => page.getByRole("button", { name: "Save contact correction", exact: true }).click(), 409);
  await shown(page.getByText("This record or its review changed. Your draft is preserved. Load the latest saved data before reviewing another correction.", { exact: true }));
  assert.equal(await page.getByLabel("Corrected name", { exact: true }).inputValue(), formulaName); assert.equal(await page.getByLabel("Correction reason", { exact: true }).inputValue(), "Confirmed revised contact with the customer");
  assert.equal(await page.getByRole("button", { name: "Save contact correction", exact: true }).isDisabled(), true);
  async function latest() { await page.getByRole("button", { name: "Load latest saved data", exact: true }).click(); await page.getByRole("button", { name: "Replace draft with latest", exact: true }).click(); await shown(current().getByRole("heading", { name: "Current saved data - revision 1", exact: true })); }
  await latest(); await fillCorrection(); await review("Customer confirmed contact, preserve original source");
  const saved = await responseFor(dataPath, "PUT", () => page.getByRole("button", { name: "Save contact correction", exact: true }).click()); assert.equal(saved.current.data_revision, 2);
  await shown(current().getByRole("heading", { name: "Current saved data - revision 2", exact: true }));
  assert.equal(saved.current.field_provenance.email.source_type, "LEAD_DATA_CHANGE"); assert.equal((await get("/api/leads/" + id + "/contact-policy")).restricted, true);
  assert.deepEqual(await get("/api/leads/" + id + "/import-sources"), originalSources); assert.deepEqual(await get("/api/leads/" + id + "/enquiry-context"), originalContext);
  pass("stale correction preserves draft, requires explicit latest load and saves a fresh reviewed revision with original sources intact");
  const history = page.getByRole("region", { name: "Lead data history", exact: true }); await history.locator("summary").filter({ hasText: "Revision 2 - Contact corrected" }).click();
  await shown(history.getByText("Customer confirmed contact, preserve original source", { exact: true })); await shown(history.locator("dd").filter({ hasText: primaryEmail }).first());
  pass("contact history exposes before/after values, reason and reviewer for the accepted correction");
  await page.getByLabel("Corrected company", { exact: true }).fill("Lost saved response"); await page.getByLabel("Correction phone interpretation", { exact: true }).selectOption("IN"); await review("Save then lose the browser response"); let savedRequests = 0;
  await page.route("**" + dataPath, async route => { if (route.request().method() !== "PUT") return route.continue(); savedRequests++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed"); });
  await page.getByRole("button", { name: "Save contact correction", exact: true }).click(); await shown(page.getByText(/A saved change exists after this request's revision/)); await page.unroute("**" + dataPath); assert.equal(savedRequests, 1); assert.equal((await get(dataPath)).current.data_revision, 3); assert.equal(await page.getByRole("button", { name: "Retry same request", exact: true }).count(), 0);
  pass("lost accepted save reads current history instead of automatically repeating or inventing success");
  await page.getByRole("button", { name: "Load latest saved data", exact: true }).click(); await page.getByRole("button", { name: "Replace draft with latest", exact: true }).click(); await shown(current().getByRole("heading", { name: "Current saved data - revision 3", exact: true }));
  await page.getByLabel("Corrected company", { exact: true }).fill("01234567890123456789"); await page.getByLabel("Correction phone interpretation", { exact: true }).selectOption("IN"); await review("Restore precision fixture after interrupted request"); let interrupted;
  await page.route("**" + dataPath, route => { if (route.request().method() !== "PUT") return route.continue(); interrupted = route.request().postDataJSON(); return route.abort("failed"); });
  await page.getByRole("button", { name: "Save contact correction", exact: true }).click(); await shown(page.getByRole("button", { name: "Retry same request", exact: true })); await page.unroute("**" + dataPath);
  let retried; const capture = request => { if (new URL(request.url()).pathname === dataPath && request.method() === "PUT") retried = request.postDataJSON(); }; page.on("request", capture);
  await responseFor(dataPath, "PUT", () => page.getByRole("button", { name: "Retry same request", exact: true }).click()); page.off("request", capture); assert.deepEqual(retried, interrupted); assert.equal((await get(dataPath)).current.data_revision, 4);
  pass("unadmitted save checks history and offers only an explicit identical-command retry");
  await page.getByLabel("Corrected company", { exact: true }).fill("Policy changed during retry"); await page.getByLabel("Correction phone interpretation", { exact: true }).selectOption("IN"); await review("Keep this draft when a retried review becomes stale");
  await page.route("**" + dataPath, route => route.request().method() === "PUT" ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "Save contact correction", exact: true }).click(); await shown(page.getByRole("button", { name: "Retry same request", exact: true })); await page.unroute("**" + dataPath);
  await request("post", "/api/leads/" + id + "/contact-restrictions", { channel: "EMAIL", reason: "SUPPRESSED", idempotency_key: "data-retry-policy-" + stamp });
  await responseFor(dataPath, "PUT", () => page.getByRole("button", { name: "Retry same request", exact: true }).click(), 409);
  await shown(page.getByText("This record or its review changed. Your draft is preserved. Load the latest saved data before reviewing another correction.", { exact: true })); assert.equal(await page.getByRole("button", { name: "Retry same request", exact: true }).count(), 0); assert.equal(await page.getByLabel("Corrected company", { exact: true }).inputValue(), "Policy changed during retry"); assert.equal((await get(dataPath)).current.data_revision, 4);
  await page.getByRole("button", { name: "Load latest saved data", exact: true }).click(); await page.getByRole("button", { name: "Replace draft with latest", exact: true }).click(); await shown(current().getByRole("heading", { name: "Current saved data - revision 4", exact: true }));
  pass("definitive stale review during an explicit retry exits uncertain mode and permits fresh review without discarding the draft");
  await page.getByRole("button", { name: "Archive this lead", exact: true }).click(); let dialog = page.getByRole("dialog"); await shown(dialog.getByRole("heading", { name: "Archive " + formulaName + "?", exact: true })); assert.equal(await dialog.getByRole("button", { name: "Confirm archive", exact: true }).isDisabled(), true);
  await shown(dialog.getByText(/all open follow-ups cancelled, including human tasks/)); await dialog.getByLabel("Archive or restore reason", { exact: true }).fill("Enquiry closed for this synthetic review"); await apiCorrect("Concurrent change before archive");
  await responseFor(archivePath, "POST", () => dialog.getByRole("button", { name: "Confirm archive", exact: true }).click(), 409); await shown(page.getByRole("alert").filter({ hasText: "Your draft is preserved" }).first());
  await page.getByRole("button", { name: "Load latest saved data", exact: true }).click(); await page.getByRole("button", { name: "Replace draft with latest", exact: true }).click(); await shown(current().getByRole("heading", { name: "Current saved data - revision 5", exact: true }));
  await page.getByRole("button", { name: "Archive this lead", exact: true }).click(); dialog = page.getByRole("dialog"); assert.equal(await dialog.getByLabel("Archive or restore reason", { exact: true }).inputValue(), "Enquiry closed for this synthetic review");
  pass("stale archive preserves its reason and requires an explicit latest-data review before resubmission");
  await page.screenshot({ path: path.join(artifacts, "archive-confirmation.png") });
  const archived = await responseFor(archivePath, "POST", () => dialog.getByRole("button", { name: "Confirm archive", exact: true }).click()); assert.ok(archived.current.archived_at); await shown(page.getByRole("button", { name: "Restore this lead", exact: true }));
  assert.equal(await page.getByRole("button", { name: "Preview contact correction", exact: true }).count(), 0); await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Message" && button.disabled));
  const analyse = page.getByRole("button", { name: /^(Analyze lead|Refresh intelligence)$/ }); assert.equal(await analyse.isDisabled(), true);
  await page.getByRole("button", { name: "Enquiry", exact: true }).click(); await shown(page.getByText("Restore this archived lead before editing enquiry context. Saved facts and history remain readable.", { exact: true })); assert.equal(await page.getByLabel("Interest description", { exact: true }).count(), 0); await shown(page.getByRole("region", { name: "Enquiry import sources", exact: true }));
  await page.getByRole("button", { name: /Outbound & Activity/ }).click(); assert.equal(await page.getByRole("button", { name: "+ Schedule", exact: true }).isDisabled(), true);
  pass("named archive requires a reason and disables correction, context, analysis, messaging and new follow-up controls while retaining history");
  await page.getByRole("button", { name: "Back", exact: true }).click(); await shown(page.getByRole("region", { name: "Lead directory", exact: true })); await page.getByLabel("Search leads", { exact: true }).fill("synthetic-only"); await shown(page.getByText("No records match these filters. Choose another archive view or clear the search.", { exact: true })); await page.getByRole("button", { name: "Archived", exact: true }).click(); await shown(page.getByRole("link", { name: formulaName, exact: true })); await shown(page.getByText("OPTED OUT", { exact: true }));
  pass("current directory excludes archived records; archived filter retains separate opt-out status and opens the record");
  await page.getByRole("link", { name: formulaName, exact: true }).click(); await page.getByRole("button", { name: "Restore this lead", exact: true }).click(); dialog = page.getByRole("dialog"); await shown(dialog.getByText(/No cancelled follow-up, stopped workflow, old analysis approval or queued action restarts/)); await dialog.getByLabel("Archive or restore reason", { exact: true }).fill("Ready for fresh owner review"); const restored = await responseFor(archivePath, "POST", () => dialog.getByRole("button", { name: "Confirm restore", exact: true }).click()); assert.equal(restored.current.archived_at, null); assert.deepEqual(restored.effects, { carried_restriction_ids: [], blocked_actions: 0, cancelled_follow_ups: 0, stopped_workflows: 0, carried_restriction_count: 0, carried_restrictions_truncated: false }); assert.equal((await get("/api/leads/" + id)).lead.status, "OPTED_OUT"); await shown(page.getByRole("button", { name: "Preview contact correction", exact: true }));
  pass("restore remains reasoned and audited without clearing opt-out or restarting work");
  for (let index = 0; index < 16; index++) await apiCorrect("History fixture " + index);
  await page.reload(); await shown(current().getByRole("heading", { name: "Current saved data - revision 23", exact: true })); await page.getByRole("button", { name: "Older changes", exact: true }).click(); await shown(page.getByText("History page 2", { exact: true })); await shown(history.locator("summary").filter({ hasText: "Revision 2 - Contact corrected" })); await page.getByRole("button", { name: "Newer changes", exact: true }).click(); await shown(page.getByText("History page 1", { exact: true }));
  pass("saved change history pages older revisions without treating the limited first page as complete");
  await apiCorrect("01234567890123456789");
  for (let index = 0; index < 51; index++) await create("Directory fixture " + String(index).padStart(2, "0"), "directory-" + stamp + "-" + index + "@test.relay.local");
  await page.getByRole("button", { name: "Back", exact: true }).click(); await page.getByRole("button", { name: "Current", exact: true }).click(); await page.getByLabel("Search leads", { exact: true }).fill(""); await shown(page.getByText("53 matching records; 50 shown on page 1. Archived is separate from recorded contact status.", { exact: true })); assert.equal(await page.getByRole("button", { name: "Export selected CSV (0)", exact: true }).isDisabled(), true);
  await page.getByLabel("Select Directory fixture 50 for export", { exact: true }).check(); await page.getByRole("button", { name: "Next page", exact: true }).click(); await shown(page.getByText("Page 2", { exact: true })); await page.getByLabel("Select " + formulaName + " for export", { exact: true }).check(); await shown(page.getByText("2 selected for export; 1 not on this page.", { exact: true }));
  await page.getByLabel("Search leads", { exact: true }).fill("synthetic-only"); await shown(page.getByRole("link", { name: formulaName, exact: true })); await shown(page.getByText("2 selected for export; 1 not on this page.", { exact: true })); await page.getByRole("link", { name: formulaName, exact: true }).click(); await shown(current()); await page.getByRole("button", { name: "Back", exact: true }).click(); assert.equal(await page.getByLabel("Search leads", { exact: true }).inputValue(), "synthetic-only"); await shown(page.getByText("2 selected for export; 1 not on this page.", { exact: true }));
  pass("explicit selection survives pagination, filters and detail navigation with hidden selected count");
  await page.getByLabel("Filter source", { exact: true }).selectOption("CSV"); await shown(page.getByText("1 matching records; 1 shown on page 1. Archived is separate from recorded contact status.", { exact: true }));
  await page.getByLabel("Filter source", { exact: true }).selectOption("MANUAL"); await shown(page.getByText("No records match these filters. Choose another archive view or clear the search.", { exact: true })); await shown(page.getByText("2 selected for export; 2 not on this page.", { exact: true }));
  await page.getByLabel("Filter source", { exact: true }).selectOption(""); await shown(page.getByRole("link", { name: formulaName, exact: true }));
  pass("human source options apply valid server filters without clearing hidden export selection");
  let downloads = 0; page.on("download", () => downloads++); await page.route("**/api/leads/export", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic export failure" }) }));
  await page.getByRole("button", { name: "Export selected CSV (2)", exact: true }).click(); await shown(page.getByRole("alert").filter({ hasText: "The request could not be confirmed" })); assert.equal(downloads, 0); await shown(page.getByText("2 selected for export; 1 not on this page.", { exact: true })); await page.unroute("**/api/leads/export");
  pass("failed export creates no file and preserves explicit selection for retry");
  let selectedIds; const captureExport = request => { if (new URL(request.url()).pathname === "/api/leads/export") selectedIds = request.postDataJSON().lead_ids; }; page.on("request", captureExport);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export selected CSV (2)", exact: true }).click(); const download = await downloadPromise; page.off("request", captureExport); assert.equal(download.suggestedFilename(), "leads-export.csv"); assert.equal(await download.failure(), null); const file = path.join(artifacts, "selected-leads.csv"); await download.saveAs(file);
  const csv = await readFile(file, "utf8"), parsed = parseCsv(csv); assert.equal(parsed.issues.length, 0); assert.equal(parsed.records.length, 2); assert.deepEqual(parsed.records.map(row => row.rawRow.lead_id).sort(), selectedIds.sort()); assert.ok(selectedIds.includes(id)); assert.ok(!selectedIds.includes(candidate.id)); const exported = parsed.records.find(row => row.rawRow.lead_id === id).rawRow;
  assert.equal(exported.name, "text: " + formulaName); assert.equal(exported.company, "text: 01234567890123456789"); assert.equal(exported.normalized_phone, "text: +919876543210"); assert.equal(JSON.parse(exported.contact_json).name, formulaName); assert.equal(JSON.parse(exported.enquiry_json).budget.value.minimum_minor, "900719925474099310"); assert.equal(exported.budget_minimum_exact, "text: 9007199254740993.10"); assert.ok(csv.endsWith("\r\n")); assert.equal((await get(dataPath)).current.archived_at, null);
  await shown(page.getByText("Downloaded 2 selected records. Your selection is retained.", { exact: true })); await page.screenshot({ path: path.join(artifacts, "selected-directory-export.png") });
  pass("actual selected CSV download contains exact IDs, guarded formula/phone/precision display and canonical contact/enquiry JSON without archiving");
  await page.getByRole("button", { name: "Clear export selection", exact: true }).click(); assert.equal(await page.getByRole("button", { name: "Export selected CSV (0)", exact: true }).isDisabled(), true);
  pass("clearing selection disables export instead of silently selecting all records");
  assert.deepEqual(errors, []); pass("no browser runtime errors in the exercised data-management journey");
  console.log("Synthetic data-management artifacts: " + artifacts); console.log("Lead data React verification: " + count + " checks passed; Chromium " + browser.version() + "."); await context.close();
} catch (error) { if (page && artifacts) { await page.screenshot({ path: path.join(artifacts, "failure.png") }); console.error("Synthetic failure screenshot: " + path.join(artifacts, "failure.png")); console.error((await page.locator("body").innerText().catch(() => "Page unavailable")).slice(-6500)); } throw error; } finally { await browser.close(); }
