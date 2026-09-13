// Drives reviewed import controls only against an explicitly isolated E2E server.
// Supply an existing local Playwright package; this script never installs dependencies.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { safeTestEnvironment, verifyE2eHandshake, workflowVerificationTarget } from "./helpers/testSafety.js";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") throw new Error("Supply --playwright-module with an absolute local Playwright index.mjs path.");
const base = workflowVerificationTarget(process.env.VERIFY_BASE_URL);
await verifyE2eHandshake(base);
const { chromium } = await import(pathToFileURL(args[1]).href);
const browser = await chromium.launch({ headless: true, env: safeTestEnvironment(), args: ["--disable-background-networking"] });
let page, artifacts, count = 0;
const errors = [];
function pass(label) { count++; console.log("PASS " + label); }
async function shown(locator) { await locator.waitFor({ state: "visible", timeout: 15000 }); }
function cell(value) { return '"' + String(value).replaceAll('"', '""') + '"'; }
function csv(headers, rows) { return [headers, ...rows].map(row => row.map(cell).join(",")).join("\n"); }
async function responseFor(page, route, method, click, status = 200) {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === route && item.request().method() === method, { timeout: 15000 });
  await click(); const result = await response; assert.equal(result.status(), status); return result.json();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000); context.setDefaultNavigationTimeout(15000);
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  context.on("page", tab => tab.on("pageerror", error => errors.push(error.name + ": " + error.message)));
  artifacts = await mkdtemp(path.join(tmpdir(), "relay-import-ui-"));
  const stamp = Date.now();
  const registration = await context.request.post(base + "/api/auth/register", { data: { organization_name: "Import QA " + stamp, name: "Import reviewer", email: "import-owner-" + stamp + "@test.relay.local", password: "import-test-password-only" } });
  assert.equal(registration.status(), 201);
  const org = (await registration.json()).organization.id;
  const duplicateEmail = "existing-" + stamp + "@test.relay.local";
  const created = await context.request.post(base + "/api/leads", { data: { organization_id: org, name: "Existing synthetic contact", email: duplicateEmail } });
  assert.equal(created.status(), 201);
  const countLeads = async () => (await (await context.request.get(base + "/api/leads")).json()).leads.length;
  page = await context.newPage();
  await page.goto(base + "/leads");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await shown(page.getByRole("heading", { name: "Import existing leads and enquiries", exact: true }));
  pass("Leads import entry opens the reviewed import journey");
  const filename = "reviewed-" + stamp + ".csv";
  const headers = ["Customer", "Email", "Phone", "Budget", "Budget", "Interest", "Date", "Location", "Country", "When", "Observed", "Currency", "Notes"];
  const rows = [
    ["Alpha synthetic", "alpha-" + stamp + "@test.relay.local", "9876543210", "9007199254740993.10", "KEEP-SECOND-BUDGET", "Custom desk", "01/09/2026", "Pune", "IN", "Before festival", "2026-09-01T10:30:00+05:30", "INR", "<script>window.importInjected=true</script>"],
    ["Needs correction", "bad-email", "9876543211", "10.123", "Other raw budget", "Desk repair", "02/09/2026", "Pune", "IN", "Next month", "", "INR", "Correction fixture"],
    ["Duplicate synthetic", duplicateEmail, "9876543212", "0", "Original secondary value", "Desk", "03/09/2026", "Pune", "IN", "Unknown", "", "INR", "Existing contact must wait"],
    ...Array.from({ length: 24 }, (_, index) => ["Synthetic row " + index, "row-" + index + "-" + stamp + "@test.relay.local", String(9000000000 + index), "10.00", "Unmapped " + index, "Repair", "04/09/2026", "Pune", "IN", "Later", "", "INR", "Synthetic only"])
  ];
  await page.getByLabel("CSV file", { exact: true }).setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(csv(headers, rows)) });
  const inspection = await responseFor(page, "/api/imports/csv/inspect", "POST", () => page.getByRole("button", { name: "Inspect columns", exact: true }).click());
  assert.equal(inspection.headers.length, 13); assert.equal(inspection.row_count, 27);
  assert.equal(await countLeads(), 1);
  pass("file inspection creates no leads and preserves duplicate column indexes");
  const assignments = { 0: "name", 1: "email", 2: "phone", 3: "budget_amount", 4: "", 5: "interest", 6: "enquiry_date", 7: "location", 8: "country_code", 9: "timeline", 10: "observed_at", 11: "currency", 12: "" };
  for (const [index, target] of Object.entries(assignments)) await page.getByLabel("Map column " + (Number(index) + 1) + " " + headers[Number(index)], { exact: true }).selectOption(target);
  assert.equal(await page.getByLabel("Phone region", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Date format", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Budget currency when the row is blank", { exact: true }).inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Preview rows", exact: true }).isDisabled(), true);
  await page.getByLabel("Phone region", { exact: true }).selectOption("IN");
  await page.getByLabel("Date format", { exact: true }).selectOption("DMY");
  await page.getByLabel("Budget currency when the row is blank", { exact: true }).selectOption("INR");
  await page.getByLabel("I reviewed the mapping and interpretation", { exact: true }).check();
  await page.screenshot({ path: path.join(artifacts, "import-mapping.png") });
  const preview = await responseFor(page, "/api/imports/csv/preview", "POST", () => page.getByRole("button", { name: "Preview rows", exact: true }).click(), 201);
  await shown(page.getByRole("heading", { name: filename, exact: true }));
  assert.equal(preview.contract_version, 2); assert.equal(await countLeads(), 1);
  const initial = preview.rows.find(row => row.row_number === 2);
  assert.equal(initial.raw_cells[3], "9007199254740993.10"); assert.equal(initial.raw_cells[4], "KEEP-SECOND-BUDGET");
  assert.equal(initial.normalized_values.normalized_phone, "+919876543210");
  assert.equal(initial.normalized_values.enquiry.budget.value.minimum_minor, "900719925474099310");
  assert.equal(initial.normalized_values.enquiry.enquiry_date.value, "2026-09-01");
  assert.equal(await page.getByRole("button", { name: "Import selected rows", exact: true }).isDisabled(), true);
  pass("explicit interpretation produces exact typed preview without automatic commit or selection");
  assert.equal(await page.getByLabel("Select row 3", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Select row 4", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Select row 4", { exact: true }).locator("xpath=ancestor::tr").getByText("Duplicate candidate: matching email with existing lead.", { exact: true }).count(), 1);
  pass("invalid and duplicate rows cannot be selected");
  const other = await context.newPage();
  await other.goto(base + "/imports/" + preview.import_id);
  await other.getByRole("button", { name: "Edit row 3", exact: true }).click();
  const staleDialog = other.getByRole("dialog", { name: "Correct row 3", exact: true });
  await staleDialog.getByLabel("Correct Email", { exact: true }).fill("stale-" + stamp + "@test.relay.local");
  await staleDialog.getByLabel("Correct Exact budget", { exact: true }).fill("12.00");
  await staleDialog.getByLabel("Correction reason", { exact: true }).fill("Stale draft must not overwrite");
  await page.getByLabel("Select row 2", { exact: true }).check();
  await page.getByRole("button", { name: "Edit row 3", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Correct row 3", exact: true });
  await dialog.getByLabel("Correct Email", { exact: true }).fill("corrected-" + stamp + "@test.relay.local");
  await dialog.getByLabel("Correct Exact budget", { exact: true }).fill("10.12");
  await dialog.getByLabel("Correction reason", { exact: true }).fill("Correct email and original precision transcription");
  const corrected = await responseFor(page, "/api/imports/" + preview.import_id + "/rows/" + preview.rows.find(row => row.row_number === 3).id, "PUT", () => dialog.getByRole("button", { name: "Save row correction", exact: true }).click());
  assert.equal(corrected.review_revision, preview.review_revision + 1);
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByLabel("Select row 2", { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel("Select row 3", { exact: true }).isDisabled(), false);
  await responseFor(other, "/api/imports/" + preview.import_id + "/rows/" + preview.rows.find(row => row.row_number === 3).id, "PUT", () => staleDialog.getByRole("button", { name: "Save row correction", exact: true }).click(), 409);
  assert.equal(await staleDialog.getByLabel("Correct Email", { exact: true }).inputValue(), "stale-" + stamp + "@test.relay.local");
  await other.close();
  pass("row correction revalidates and clears selection; a stale correction retains its draft");
  await page.getByText(/^Correction history \(/).click();
  await shown(page.getByText("Correct email and original precision transcription", { exact: true }));
  pass("correction reason and prior interpreted values are visible in history");
  await page.getByRole("button", { name: "Select all 26 eligible rows", exact: true }).click();
  let commitCalls = 0, frozenPayload;
  const commitRoute = "**/api/imports/" + preview.import_id + "/commit";
  await page.route(commitRoute, async route => { commitCalls++; frozenPayload = route.request().postDataJSON(); const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed"); });
  await page.getByRole("button", { name: "Import selected rows", exact: true }).click();
  await shown(page.getByRole("alert").filter({ hasText: "last import step could not be confirmed" }));
  const interrupted = await (await context.request.get(base + "/api/imports/" + preview.import_id)).json();
  assert.equal(interrupted.state, "COMMITTING"); assert.equal(interrupted.progress.committed_rows, 25); assert.equal(interrupted.progress.remaining_rows, 1);
  assert.equal(commitCalls, 1); assert.equal(frozenPayload.selected_row_ids.length, 26);
  assert.equal(await page.getByRole("button", { name: "Resume import", exact: true }).isEnabled(), true);
  pass("lost commit response loads durable 25-row progress without automatically retrying");
  await page.screenshot({ path: path.join(artifacts, "import-resume.png") });
  await page.unroute(commitRoute);
  await page.reload();
  await shown(page.getByRole("button", { name: "Resume import", exact: true }));
  const finished = await responseFor(page, "/api/imports/" + preview.import_id + "/commit", "POST", () => page.getByRole("button", { name: "Resume import", exact: true }).click());
  assert.equal(finished.state, "COMMITTED"); assert.equal(finished.progress.committed_rows, 26); assert.equal(finished.progress.remaining_rows, 0);
  assert.deepEqual([...finished.frozen_selection].sort(), [...frozenPayload.selected_row_ids].sort());
  assert.equal(await countLeads(), 27);
  pass("refresh and explicit resume finish the same selection once");
  await page.getByRole("link", { name: "All imports / new file", exact: true }).click();
  await page.getByRole("link", { name: filename, exact: true }).click();
  await shown(page.getByText("Selected rows processed", { exact: true }));
  pass("import history reopens the persisted completed selection");
  const importedLeadId = finished.rows.find(row => row.row_number === 2).created_lead_id;
  await page.goto(base + "/leads/" + importedLeadId + "?tab=enquiry");
  const interest = page.getByRole("group", { name: "Product or service interest recorded fact", exact: true });
  const budget = page.getByRole("group", { name: "Stated budget recorded fact", exact: true });
  await shown(interest.getByText("Recorded from an imported CSV row", { exact: true }));
  assert.equal(await interest.getByLabel("Interest description", { exact: true }).isDisabled(), true);
  assert.equal(await budget.getByLabel("Minimum budget", { exact: true }).inputValue(), "9007199254740993.10");
  assert.equal(await page.evaluate(() => window.importInjected), undefined);
  pass("imported enquiry displays its exact money and immutable CSV provenance");
  await page.getByLabel("Enquiry location status", { exact: true }).selectOption("UNKNOWN");
  await page.getByLabel("Reason for this change", { exact: true }).fill("Location needs confirmation");
  const enquiryRoute = "/api/leads/" + importedLeadId + "/enquiry-context";
  const unchanged = await responseFor(page, enquiryRoute, "PUT", () => page.getByRole("button", { name: "Save enquiry context", exact: true }).click());
  assert.equal(unchanged.enquiry.budget.provenance.source_type, "IMPORT_ROW"); assert.equal(unchanged.enquiry.location.state, "UNKNOWN");
  await interest.getByRole("button", { name: "Correct this imported fact", exact: true }).click();
  await interest.getByLabel("Interest description", { exact: true }).fill("Desk refinishing");
  await interest.getByLabel("Source reference", { exact: true }).fill("Operator correction after reviewing the original enquiry");
  await page.getByLabel("Reason for this change", { exact: true }).fill("Clarify the requested work");
  const manual = await responseFor(page, enquiryRoute, "PUT", () => page.getByRole("button", { name: "Save enquiry context", exact: true }).click());
  assert.equal(manual.enquiry.interest.provenance.source_type, "MANUAL"); assert.equal(Object.hasOwn(manual.enquiry.interest.provenance, "import_row_id"), false);
  assert.equal(manual.enquiry.budget.provenance.source_type, "IMPORT_ROW");
  pass("edited imported fact explicitly becomes manual; unchanged imported facts retain exact linkage");
  await page.getByRole("button", { name: "View revision history", exact: true }).click();
  const original = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Revision 1 -/ }) });
  await original.locator("summary").click(); await shown(original.getByText("Custom desk", { exact: true }));
  pass("manual correction preserves the original imported enquiry in revision history");
  await page.screenshot({ path: path.join(artifacts, "imported-enquiry.png") });
  await page.goto(base + "/imports");
  const lateEmail = "late-" + stamp + "@test.relay.local";
  const lateName = "late-duplicate-" + stamp + ".csv";
  await page.getByLabel("CSV file", { exact: true }).setInputFiles({ name: lateName, mimeType: "text/csv", buffer: Buffer.from(csv(["Name", "Email"], [["Late synthetic", lateEmail]])) });
  await responseFor(page, "/api/imports/csv/inspect", "POST", () => page.getByRole("button", { name: "Inspect columns", exact: true }).click());
  await page.getByLabel("Phone region", { exact: true }).selectOption("INTERNATIONAL_ONLY"); await page.getByLabel("Date format", { exact: true }).selectOption("ISO"); await page.getByLabel("Budget currency when the row is blank", { exact: true }).selectOption("ROW_ONLY"); await page.getByLabel("I reviewed the mapping and interpretation", { exact: true }).check();
  const latePreview = await responseFor(page, "/api/imports/csv/preview", "POST", () => page.getByRole("button", { name: "Preview rows", exact: true }).click(), 201);
  await page.getByLabel("Select row 2", { exact: true }).check();
  const newMatch = await context.request.post(base + "/api/leads", { data: { organization_id: org, name: "Contact appeared after preview", email: lateEmail } }); assert.equal(newMatch.status(), 201);
  const held = await responseFor(page, "/api/imports/" + latePreview.import_id + "/commit", "POST", () => page.getByRole("button", { name: "Import selected rows", exact: true }).click());
  assert.equal(held.state, "COMMITTED"); assert.equal(held.progress.held_rows, 1); assert.equal(held.progress.committed_rows, 0); assert.equal(await countLeads(), 28);
  await shown(page.getByText("Held for review", { exact: true }));
  pass("a new duplicate after preview is visibly held without another lead");
  assert.deepEqual(errors, []); pass("no browser runtime errors in the exercised import journey");
  console.log("Synthetic import screenshots: " + artifacts);
  console.log("Reviewed import React verification: " + count + " checks passed; Chromium " + browser.version() + ".");
  await context.close();
} catch (error) {
  if (page && artifacts) { await page.screenshot({ path: path.join(artifacts, "failure.png") }); console.error("Synthetic failure screenshot: " + path.join(artifacts, "failure.png")); console.error((await page.locator("main").innerText().catch(() => "Main unavailable")).slice(0, 3000)); }
  throw error;
} finally { await browser.close(); }
