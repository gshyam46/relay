import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { safeTestEnvironment, verifyE2eHandshake } from "./helpers/testSafety.js";
import { startEmailVerificationFixture } from "./helpers/emailVerificationFixture.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--playwright-module" || !path.isAbsolute(args[1]) || path.basename(args[1]) !== "index.mjs") throw new Error("Supply an absolute installed Playwright index.mjs path.");
const fixture = await startEmailVerificationFixture(), base = fixture.base, build = await readFile("client/dist/index.html", "utf8");
let browser, page, artifacts, checks = 0;
const errors = [], writes = [], verificationCommands = [], assets = new Set();
const endpoint = "/api/channels/email/verification", connectionEndpoint = "/api/settings/channels/email/connection";
const pass = label => { checks++; console.log("PASS " + label); };
const shown = locator => locator.waitFor({ state: "visible", timeout: 20000 });
async function until(read, accepts, label) {
  const deadline = Date.now() + 20000;
  do { const value = await read(); if (accepts(value)) return value; await new Promise(resolve => setTimeout(resolve, 75)); } while (Date.now() < deadline);
  throw new Error("Observation did not arrive: " + label);
}
try {
  await verifyE2eHandshake(base);
  const { chromium } = await import(pathToFileURL(args[1]).href);
  browser = await chromium.launch({ headless: true, env: safeTestEnvironment(), args: ["--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(20000);
  await context.route("**/*", route => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
  artifacts = await mkdtemp(path.join(tmpdir(), "relay-email-verification-ui-"));
  async function request(method, route, data, expected = 200) {
    const response = await context.request[method](base + route, data === undefined ? {} : { data });
    assert.equal(response.status(), expected, route + ": " + (await response.text()).slice(0, 1000));
    return response.json();
  }
  const registration = await request("post", "/api/auth/register", { organization_name: "Synthetic verification browser", name: "Verification owner", email: "verification-owner@test.relay.local", password: "synthetic-verification-password" }, 201), org = registration.organization.id;
  const scope = { organization_id: org, actor: registration.user };
  await fixture.saveSetup(scope, fixture.settings, "browser-synthetic-setup");
  await fixture.provision(scope);
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => {
    const uri = new URL(req.url());
    if (uri.pathname.startsWith("/assets/")) assets.add(uri.pathname);
    if (["POST", "PUT", "DELETE"].includes(req.method())) writes.push(uri.pathname);
    if (uri.pathname.startsWith(endpoint) && req.method() === "POST") verificationCommands.push({ path: uri.pathname, body: req.postDataJSON() });
  });
  const region = () => page.getByRole("region", { name: "Verify the email journey", exact: true });
  const retry = () => region().getByRole("button", { name: "Retry same verification request", exact: true });
  const current = () => request("get", endpoint);
  const before = await fixture.counts(org);
  await page.goto(base + "/developer-tools?tab=email");
  await shown(region().getByRole("button", { name: "Create verification record", exact: true }));
  await shown(region().getByText("Normal live sends held", { exact: true }));
  await region().getByRole("button", { name: "Refresh verification evidence", exact: true }).click();
  await shown(region().getByRole("button", { name: "Create verification record", exact: true }));
  assert.deepEqual(await fixture.counts(org), before); assert.equal(writes.length, 0); assert.equal(fixture.checkCalls.length, 0);
  pass("opening and refreshing verification performs reads only and keeps normal live sends held");
  await shown(region().getByText(fixture.controlledRecipients.delivery, { exact: true }));
  await shown(region().getByText(fixture.controlledRecipients.failure, { exact: true }));
  assert.equal(await region().locator("input").count(), 0);
  assert.equal((await page.locator("body").innerText()).includes(fixture.settings.api_key), false);
  pass("deployment-controlled destinations are visible without an editable recipient or exposed API key");

  let originalCreate;
  await page.route("**" + endpoint, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 200); originalCreate = await response.json();
    await route.abort("failed");
  });
  await region().getByLabel("Reason for verification", { exact: true }).fill("Verify the synthetic controlled email journey");
  await region().getByRole("button", { name: "Create verification record", exact: true }).click();
  await shown(retry()); await until(() => retry().isEnabled(), Boolean, "lost create response settled");
  assert.equal((await fixture.counts(org)).email_verification_runs, 1);
  assert.equal(fixture.checkCalls.length, 0);
  assert.equal((await fixture.counts(org)).actions, 0);
  assert.equal(await region().getByRole("button", { name: "Create verification record", exact: true }).isDisabled(), true);
  await page.unroute("**" + endpoint);
  pass("a lost accepted create response retains a locked exact request without checking a provider or creating a probe");
  await retry().click();
  await retry().waitFor({ state: "hidden" });
  await shown(region().getByRole("button", { name: "Check current provider configuration", exact: true }));
  const run = (await current()).verification;
  assert.equal(run.id, originalCreate.verification.id);
  assert.deepEqual(verificationCommands[0], verificationCommands[1]);
  assert.equal((await fixture.counts(org)).email_verification_runs, 1);
  assert.equal((await request("get", endpoint + "/requests/" + verificationCommands[0].body.request_key)).verification.id, run.id);
  assert.equal(fixture.checkCalls.length, 0);
  pass("same-key create retry and read-only request lookup recover one original immutable run");

  assert.equal(await region().getByRole("button", { name: "Prepare delivery probe for review", exact: true }).isDisabled(), true);
  assert.equal(await region().getByRole("button", { name: "Prepare rejection probe for review", exact: true }).isDisabled(), true);
  await region().getByRole("button", { name: "Check current provider configuration", exact: true }).click();
  await shown(region().getByText(/Configuration check 1: passed/));
  let view = await current();
  assert.equal(fixture.checkCalls.length, 1);
  assert.equal(view.verification.check.checks.length, 5);
  assert.ok(view.verification.check.checks.every(check => check.status === "PASS"));
  assert.equal(view.live_send_available, false);
  assert.ok(view.verification.milestones.every(item => item.status !== "RECORDED"));
  assert.equal((await fixture.counts(org)).action_executions, 0);
  pass("only the explicit check invokes the injected adapter; five synthetic results alone cannot verify the live journey");

  for (const purpose of ["DELIVERY", "FAILURE"]) {
    await region().getByRole("button", { name: "Prepare " + (purpose === "DELIVERY" ? "delivery" : "rejection") + " probe for review", exact: true }).click();
    await shown(region().getByRole("button", { name: "Review " + (purpose === "DELIVERY" ? "delivery" : "rejection") + " probe", exact: true }));
  }
  view = await current();
  assert.equal(view.verification.probes.length, 2);
  assert.equal((await fixture.counts(org)).actions, 2);
  assert.equal((await fixture.counts(org)).action_executions, 0);
  assert.equal((await fixture.counts(org)).action_revision_decisions, 0);
  assert.equal(fixture.sends.length, 0);
  for (const probe of view.verification.probes) {
    const action = await fixture.services.actionsRepository.getAction(probe.action_id);
    assert.equal(action.status, "AWAITING_APPROVAL"); assert.equal(action.approval_requirement, "REQUIRED");
  }
  pass("two explicit prepares create exactly two fixed, approval-required probe actions and send nothing");

  const probe = view.verification.probes.find(item => item.purpose === "DELIVERY");
  const expected = await request("get", "/api/actions/" + probe.action_id + "/approval");
  await region().getByRole("button", { name: "Review delivery probe", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review outbound action", exact: true });
  await shown(dialog.getByRole("textbox", { name: "Message", exact: true }));
  assert.equal(await dialog.getByLabel("Subject", { exact: true }).inputValue(), expected.prepared_revision.envelope.subject);
  assert.equal(await dialog.getByRole("textbox", { name: "Message", exact: true }).inputValue(), expected.prepared_revision.envelope.body);
  await shown(dialog.getByText(fixture.controlledRecipients.delivery, { exact: true }));
  await shown(dialog.getByText(fixture.settings.from_email, { exact: true }));
  await shown(dialog.getByText(fixture.settings.reply_to, { exact: true }));
  await page.screenshot({ path: path.join(artifacts, "email-probe-exact-review.png"), fullPage: false });
  pass("the real exact-approval dialog displays the persisted fixed recipient, sender, Reply-To, subject and body");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(artifacts, "email-probe-review-mobile.png"), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1100 });
  pass("the exact probe review remains readable without horizontal overflow at 390 CSS pixels");
  await dialog.getByRole("button", { name: "Approve this revision", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await fixture.services.actionsRepository.getAction(probe.action_id)).status, "APPROVED");
  assert.equal((await fixture.counts(org)).action_revision_decisions, 1);
  assert.equal((await fixture.counts(org)).action_executions, 0);
  assert.equal(fixture.sends.length, 0);
  pass("explicit approval records only the displayed revision and does not dispatch a probe");

  await region().getByText("Instructions for the authorized delivery mailbox owner", { exact: true }).click();
  await shown(region().getByText(view.verification.instructions.reply, { exact: true }));
  await shown(region().getByText(view.verification.instructions.stop, { exact: true }));
  await shown(region().getByText(/stop request permanently restricts this contact/));
  assert.equal((await current()).live_send_available, false);
  await page.screenshot({ path: path.join(artifacts, "email-verification-evidence.png"), fullPage: true });
  pass("nonce-bound reply and stop instructions remain distinct from unrecorded delivery, rejection and reply evidence");

  await fixture.saveSetup(scope, { ...fixture.settings, from_email: "changed-sender@test.relay.local" }, "browser-synthetic-sender-change");
  await region().getByRole("button", { name: "Refresh verification evidence", exact: true }).click();
  await shown(region().getByRole("button", { name: "Create verification record", exact: true }));
  view = await current();
  assert.equal(view.verification, null); assert.equal(view.live_send_available, false);
  assert.equal((await request("get", endpoint + "/requests/" + verificationCommands[0].body.request_key)).verification.current, false);
  assert.equal((await fixture.counts(org)).email_verification_runs, 1);
  assert.equal((await fixture.counts(org)).email_verification_probes, 2);
  assert.equal(fixture.checkCalls.length, 1);
  pass("changing the saved sender requires a new current run while preserving the old run and probes as history");

  assert.deepEqual(errors, []); assert.deepEqual(fixture.pumpErrors, []); assert.equal(fixture.calls.length, 0); assert.equal(fixture.sends.length, 0);
  assert.equal((await fixture.counts(org)).ai_provider_attempts, 0);
  assert.equal((await fixture.counts(org)).action_executions, 0);
  assert.ok(writes.every(value => value === endpoint || new RegExp("^" + endpoint + "/[^/]+/(check|probes)$").test(value) || /^\/api\/actions\/[^/]+\/approval\/approve$/.test(value)), JSON.stringify(writes));
  assert.equal(await readFile("client/dist/index.html", "utf8"), build);
  pass("stable-build browser checks have no script errors, model calls, transport invocations or unexpected writes");
  console.log("Browser " + browser.version()); console.log("Built assets " + JSON.stringify([...assets].sort()));
  console.log("Email verification browser checks: " + checks + " passed"); console.log("Synthetic artifacts " + artifacts);
  console.log("Fixture seam: synthetic HTTPS service runtime over a loopback HTTP application; no TLS or provider acceptance claimed.");
} catch (error) {
  if (page && artifacts) await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  console.error("FAILED after " + checks + " checks; artifacts " + artifacts); throw error;
} finally { await browser?.close(); await fixture.close(); }
