// Drives production React identity review on an explicitly isolated E2E target.
// Requires an existing local Playwright package; no dependencies are installed.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { safeTestEnvironment, verifyE2eHandshake, workflowVerificationTarget } from "./helpers/testSafety.js";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") throw new Error("Supply --playwright-module with an absolute installed Playwright index.mjs path.");
const base = workflowVerificationTarget(process.env.VERIFY_BASE_URL);
await verifyE2eHandshake(base);
const { chromium } = await import(pathToFileURL(args[1]).href);
const browser = await chromium.launch({ headless: true, env: safeTestEnvironment(), args: ["--disable-background-networking"] });
let page, artifacts, count = 0;
const errors = [];
function pass(label) { count++; console.log("PASS " + label); }
async function shown(locator) { await locator.waitFor({ state: "visible", timeout: 15000 }); }
function csv(rows) { return [["Name", "Email", "Phone", "Interest", "Budget", "Currency", "Date"], ...rows].map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(",")).join("\n"); }
async function responseFor(tab, route, method, click, status = 200) { const pending = tab.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === method, { timeout: 15000 }); await click(); const response = await pending; assert.equal(response.status(), status); return response.json(); }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000); context.setDefaultNavigationTimeout(15000);
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  context.on("page", tab => tab.on("pageerror", error => errors.push(error.name + ": " + error.message)));
  artifacts = await mkdtemp(path.join(tmpdir(), "relay-identity-ui-"));
  const stamp = Date.now();
  const registration = await context.request.post(base + "/api/auth/register", { data: { organization_name: "Identity QA " + stamp, name: "Identity reviewer", email: "identity-owner-" + stamp + "@test.relay.local", password: "identity-test-password-only" } });
  assert.equal(registration.status(), 201); const org = (await registration.json()).organization.id;
  async function get(route) { const response = await context.request.get(base + route); assert.equal(response.status(), 200); return response.json(); }
  async function preview(filename, rows) { const response = await context.request.post(base + "/api/imports/csv/preview", { data: { filename, csv_text: csv(rows), default_phone_region: "INTERNATIONAL_ONLY", mapping: { name: 0, email: 1, phone: 2, interest: 3, budget_amount: 4, currency: 5, enquiry_date: 6 }, options: { date_format: "ISO", default_currency: "INR", assertion: "OPERATOR_OBSERVED" } } }); assert.equal(response.status(), 201); return response.json(); }
  async function createLead(name, email) { const response = await context.request.post(base + "/api/leads", { data: { organization_id: org, name, email } }); assert.equal(response.status(), 201); return (await response.json()).lead; }
  const email = "shared-" + stamp + "@test.relay.local";
  const original = await preview("primary-source.csv", [["Primary synthetic enquiry", email, "", "Desk restoration", "12500.10", "INR", "2026-09-01"]]);
  const committedResponse = await context.request.post(base + "/api/imports/" + original.import_id + "/commit", { data: { expected_revision: original.review_revision, selected_row_ids: [original.rows[0].id] } });
  assert.equal(committedResponse.status(), 200); const primary = (await committedResponse.json()).rows[0].created_lead_id;
  const initialContext = await get("/api/leads/" + primary + "/enquiry-context");
  const restriction = await context.request.post(base + "/api/leads/" + primary + "/contact-restrictions", { data: { channel: "ALL", reason: "OPT_OUT", idempotency_key: "identity-fixture-optout-" + stamp } }); assert.equal(restriction.status(), 200);
  const reviewed = await preview("duplicate-review.csv", [
    ["Attached source row", email, "", "Different source detail", "0.00", "INR", "2026-09-02"],
    ["Repeated enquiry row", email, "", "New shelves", "9007199254740993.10", "INR", "2026-09-03"],
    ["Shared address row", email, "+919876543210", "Another person's request", "850.00", "INR", "2026-09-04"]
  ]);
  page = await context.newPage(); await page.goto(base + "/imports/" + reviewed.import_id);
  async function open(rowNumber) { await page.getByRole("button", { name: "Review identity for row " + rowNumber, exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Review identity for row " + rowNumber, exact: true }); await shown(dialog.getByRole("heading", { name: "Existing enquiries", exact: true })); return dialog; }
  async function choose(dialog, decision, reason, classification = "") { await dialog.getByLabel(decision === "LINK_EXISTING" ? "Link to the same enquiry" : "Create a separate enquiry", { exact: true }).check(); if (classification) await dialog.getByLabel("Separate enquiry classification", { exact: true }).selectOption(classification); await dialog.getByLabel("Identity decision reason", { exact: true }).fill(reason); }
  async function confirm(dialog) { await dialog.getByLabel("I reviewed the source, candidates and decision", { exact: true }).check(); }
  const resolutionPath = row => "/api/imports/" + reviewed.import_id + "/rows/" + reviewed.rows[row].id + "/identity-resolution";
  let dialog = await open(2);
  assert.equal(await dialog.getByLabel("Link to the same enquiry", { exact: true }).isChecked(), false); assert.equal(await dialog.getByLabel("Create a separate enquiry", { exact: true }).isChecked(), false); assert.equal(await dialog.locator('input[name="identity-target"]:checked').count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "Save identity decision", exact: true }).isDisabled(), true);
  await shown(dialog.getByText(/This source contact has a recorded restriction/));
  await dialog.getByText("Compare current facts - revision 1", { exact: true }).click(); await shown(dialog.getByText("Desk restoration", { exact: true })); await shown(dialog.locator("p").filter({ hasText: /^Different source detail$/ }));
  pass("comparison shows source versus current facts and restriction, with no decision or target preselected");
  await choose(dialog, "LINK_EXISTING", "Same enquiry; retain source differences for review"); await dialog.getByLabel("Link target Primary synthetic enquiry", { exact: true }).check(); await confirm(dialog);
  await page.screenshot({ path: path.join(artifacts, "identity-decision.png") });
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(artifacts, "identity-comparison.png") });
  const linked = await responseFor(page, resolutionPath(0), "POST", () => dialog.getByRole("button", { name: "Link source to enquiry", exact: true }).click());
  assert.equal(linked.resolution.decision, "LINK_EXISTING"); assert.equal(linked.resolution.lead_id, primary); assert.equal((await get("/api/leads")).leads.length, 1);
  assert.deepEqual(await get("/api/leads/" + primary + "/enquiry-context"), initialContext);
  await shown(dialog.getByRole("region", { name: "Saved identity decision", exact: true }));
  pass("link adds source history without creating a lead or replacing current enquiry facts");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click(); await page.goto(base + "/leads/" + primary + "?tab=enquiry");
  const sources = page.getByRole("region", { name: "Enquiry import sources", exact: true });
  await shown(sources.getByText("primary-source.csv - row 2 - Original imported source", { exact: true }));
  await sources.getByText("duplicate-review.csv - row 2 - Attached source", { exact: true }).click(); await shown(sources.locator("p").filter({ hasText: /^Different source detail$/ })); await shown(sources.getByText(/Recorded source only/));
  assert.equal(await page.getByRole("group", { name: "Product or service interest recorded fact", exact: true }).getByLabel("Interest description", { exact: true }).inputValue(), "Desk restoration");
  await sources.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(artifacts, "linked-source-history.png") });
  await sources.getByRole("link", { name: "Open import row and review history", exact: true }).click(); await shown(page.getByText("Source link opened row 2; inspect its source or recorded identity decision below.", { exact: true }));
  pass("lead source history distinguishes original and attached facts and deep-links back to the source row");
  dialog = await open(3); await choose(dialog, "CREATE_SEPARATE", "A new need using the same contact", "REPEATED_ENQUIRY"); await confirm(dialog);
  let savedCalls = 0;
  await page.route("**" + resolutionPath(1), async route => { savedCalls++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed"); });
  await dialog.getByRole("button", { name: "Create separate enquiry", exact: true }).click(); await shown(dialog.getByRole("heading", { name: "Recorded identity decision", exact: true })); await page.unroute("**" + resolutionPath(1));
  const afterLost = await get("/api/imports/" + reviewed.import_id); const repeated = afterLost.rows[1].identity_resolution.lead_id;
  assert.equal(savedCalls, 1); assert.equal((await get("/api/leads")).leads.length, 2); assert.equal((await get("/api/leads/" + repeated + "/enquiry-context")).enquiry.budget.value.minimum_minor, "900719925474099310");
  assert.equal((await get("/api/leads/" + repeated + "/contact-policy")).restricted, true);
  pass("lost saved response recovers the one separate enquiry from history with exact budget and retained suppression");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click(); dialog = await open(4);
  assert.equal(await dialog.getByLabel("Link target Primary synthetic enquiry", { exact: true }).isDisabled(), true);
  await choose(dialog, "CREATE_SEPARATE", "Different people share this address"); assert.equal(await dialog.getByLabel("Separate enquiry classification", { exact: true }).inputValue(), "");
  await dialog.getByLabel("Separate enquiry classification", { exact: true }).selectOption("SHARED_CONTACT"); await confirm(dialog);
  let interruptedPayload;
  await page.route("**" + resolutionPath(2), async route => { interruptedPayload = route.request().postDataJSON(); await route.abort("failed"); });
  await dialog.getByRole("button", { name: "Create separate enquiry", exact: true }).click(); await shown(dialog.getByRole("button", { name: "Retry same decision", exact: true })); await page.unroute("**" + resolutionPath(2));
  assert.equal((await get("/api/leads")).leads.length, 2);
  let retriedPayload;
  const retryCapture = request => { if (new URL(request.url()).pathname === resolutionPath(2) && request.method() === "POST") retriedPayload = request.postDataJSON(); }; page.on("request", retryCapture);
  const retried = await responseFor(page, resolutionPath(2), "POST", () => dialog.getByRole("button", { name: "Retry same decision", exact: true }).click()); page.off("request", retryCapture);
  assert.deepEqual(retriedPayload, interruptedPayload); assert.equal(retried.resolution.classification, "SHARED_CONTACT"); assert.equal((await get("/api/leads")).leads.length, 3);
  pass("conflicting phone prevents linking; unsaved response failure requires history check and exact explicit retry");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click();
  await page.getByText("Identity decision history (3)", { exact: true }).click(); await shown(page.getByText("Same enquiry; retain source differences for review", { exact: true }).last());
  assert.equal((await get("/api/imports/" + reviewed.import_id)).resolution_summary.unresolved_duplicate_rows, 0);
  pass("recorded decisions and separate resolution counts survive refresh without changing original selection");
  const staleImport = await preview("stale-identity.csv", [["Stale review source", email, "", "Needs fresh comparison", "15.00", "INR", "2026-09-05"]]);
  await page.goto(base + "/imports/" + staleImport.import_id); dialog = await open(2); await choose(dialog, "LINK_EXISTING", "Preserve this draft through target changes"); await dialog.getByLabel("Link target Primary synthetic enquiry", { exact: true }).check(); await confirm(dialog);
  const latest = await get("/api/leads/" + primary + "/enquiry-context");
  latest.enquiry.interest = { state: "KNOWN", value: "Updated active requirement", provenance: { assertion: "OPERATOR_OBSERVED", source_type: "MANUAL", source_reference: "Synthetic owner correction", observed_at: null } };
  const changed = await context.request.put(base + "/api/leads/" + primary + "/enquiry-context", { data: { expected_revision: latest.revision, enquiry: latest.enquiry, reason: "Force fresh identity comparison" } }); assert.equal(changed.status(), 200);
  const stalePath = "/api/imports/" + staleImport.import_id + "/rows/" + staleImport.rows[0].id + "/identity-resolution";
  await responseFor(page, stalePath, "POST", () => dialog.getByRole("button", { name: "Link source to enquiry", exact: true }).click(), 409);
  await shown(dialog.getByText(/A fresh comparison and renewed confirmation are required/)); assert.equal(await dialog.getByLabel("Identity decision reason", { exact: true }).inputValue(), "Preserve this draft through target changes");
  await dialog.getByRole("button", { name: "Refresh comparison", exact: true }).click(); await shown(dialog.getByText("Compare current facts - revision 2", { exact: true })); assert.equal(await dialog.getByLabel("I reviewed the source, candidates and decision", { exact: true }).isChecked(), false);
  await confirm(dialog); await responseFor(page, stalePath, "POST", () => dialog.getByRole("button", { name: "Link source to enquiry", exact: true }).click());
  pass("stale target revision preserves draft and requires refreshed comparison plus renewed confirmation");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click();
  const lateEmail = "late-identity-" + stamp + "@test.relay.local";
  const late = await preview("late-held.csv", [["Late source", lateEmail, "", "Late source need", "20.00", "INR", "2026-09-06"]]); await createLead("Late candidate", lateEmail);
  await page.goto(base + "/imports/" + late.import_id); await page.getByLabel("Select row 2", { exact: true }).check();
  const held = await responseFor(page, "/api/imports/" + late.import_id + "/commit", "POST", () => page.getByRole("button", { name: "Import selected rows", exact: true }).click()); assert.equal(held.progress.held_rows, 1);
  dialog = await open(2); await choose(dialog, "CREATE_SEPARATE", "Explicitly preserve this separate late-held enquiry", "DISTINCT_ENQUIRY"); await confirm(dialog);
  const resolvedHeld = await responseFor(page, "/api/imports/" + late.import_id + "/rows/" + late.rows[0].id + "/identity-resolution", "POST", () => dialog.getByRole("button", { name: "Create separate enquiry", exact: true }).click());
  assert.equal(resolvedHeld.import.progress.held_rows, 1); assert.equal(resolvedHeld.import.rows[0].commit_state, "HELD"); assert.equal(resolvedHeld.import.resolution_summary.resolved_held_rows, 1); assert.deepEqual(resolvedHeld.import.frozen_selection, held.frozen_selection);
  await dialog.getByRole("button", { name: "Close review", exact: true }).click(); await page.reload(); await shown(page.getByRole("region", { name: "Identity resolution progress", exact: true }));
  pass("late held row resolves separately while original held outcome and frozen selection remain intact");
  const fileEmail = "infile-identity-" + stamp + "@test.relay.local";
  const infile = await preview("infile-group.csv", [["Group first source", fileEmail, "", "Shared initial need", "30.00", "INR", "2026-09-07"], ["Group second source", fileEmail, "", "Recorded follow-up detail", "40.00", "INR", "2026-09-08"]]);
  await page.goto(base + "/imports/" + infile.import_id); dialog = await open(2); await shown(dialog.getByText(/No existing enquiry candidate/)); await choose(dialog, "CREATE_SEPARATE", "Establish first enquiry from this file group", "DISTINCT_ENQUIRY"); await confirm(dialog);
  const first = await responseFor(page, "/api/imports/" + infile.import_id + "/rows/" + infile.rows[0].id + "/identity-resolution", "POST", () => dialog.getByRole("button", { name: "Create separate enquiry", exact: true }).click()); await dialog.getByRole("button", { name: "Close review", exact: true }).click();
  dialog = await open(3); await choose(dialog, "LINK_EXISTING", "The second source belongs to the first enquiry"); await dialog.getByLabel("Link target Group first source", { exact: true }).check(); await confirm(dialog);
  const second = await responseFor(page, "/api/imports/" + infile.import_id + "/rows/" + infile.rows[1].id + "/identity-resolution", "POST", () => dialog.getByRole("button", { name: "Link source to enquiry", exact: true }).click()); assert.equal(second.resolution.lead_id, first.resolution.lead_id);
  pass("within-file duplicate group can create its first enquiry then link another source without deadlock");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click();
  const boundedEmail = "bounded-identity-" + stamp + "@test.relay.local";
  for (let index = 0; index < 51; index++) await createLead("Bounded candidate " + index, boundedEmail);
  const bounded = await preview("bounded-candidates.csv", [["Bounded source", boundedEmail, "", "Distinct need", "50.00", "INR", "2026-09-09"]]);
  await page.goto(base + "/imports/" + bounded.import_id); dialog = await open(2); await shown(dialog.getByText(/Showing 50 of 51 matching enquiries/)); assert.equal(await dialog.getByRole("article").count(), 10); await dialog.getByRole("button", { name: "Next candidates", exact: true }).click(); await shown(dialog.getByText("Page 2 of 5", { exact: true }));
  pass("candidate display discloses truncation and pages the bounded review without claiming unique identity");
  await dialog.getByRole("button", { name: "Close review", exact: true }).click();
  assert.deepEqual(errors, []); pass("no browser runtime errors in the exercised identity journey");
  console.log("Synthetic identity screenshots: " + artifacts); console.log("Identity React verification: " + count + " checks passed; Chromium " + browser.version() + ".");
  await context.close();
} catch (error) {
  if (page && artifacts) { await page.screenshot({ path: path.join(artifacts, "failure.png") }); console.error("Synthetic failure screenshot: " + path.join(artifacts, "failure.png")); console.error((await page.locator("dialog[open]").innerText().catch(() => "Dialog unavailable")).slice(0, 4500)); }
  throw error;
} finally { await browser.close(); }
