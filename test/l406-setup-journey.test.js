import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { SetupJourneyService } from "../src/modules/onboarding/setupJourneyService.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyProfile } from "../src/modules/business-context/businessContextContract.js";
import { IntelligenceRepository } from "../src/modules/lead-intelligence/intelligenceRepository.js";
import { ComposerService } from "../src/modules/outbound-automation/composerService.js";
import { CustomerWorkflowService } from "../src/modules/customer-workflow/customerWorkflowService.js";
import { AccountSecurityService } from "../src/modules/auth/accountSecurityService.js";
import { EmailVerificationService } from "../src/modules/channels/emailVerificationService.js";
import { CHECK_IDS } from "../src/modules/channels/emailVerificationContract.js";

const PASSWORD = "synthetic-setup-password";
async function fixture(t) {
  const db = await createDatabase(":memory:"); t.after(() => db.close());
  const config = loadConfig({ NODE_ENV: "test", WORKER_ENABLED: "false", ENABLE_TEST_CONTROLS: "false", PUBLIC_APP_ORIGIN: "https://setup.example.test", EMAIL_VERIFICATION_DELIVERY_MAILBOX: "controlled@example.test", EMAIL_VERIFICATION_FAILURE_MAILBOX: "reject@example.test" });
  const services = createServices(db, undefined, config), registered = await services.authService.register({ organization_name: "Synthetic setup", name: "Owner", email: "setup-owner@example.test", password: PASSWORD });
  let clock = Date.now(); const scope = { organization_id: registered.organization.id, actor: { id: registered.user.id, role: registered.user.role } }, service = new SetupJourneyService(db, { now: () => clock });
  const lead = (patch = {}) => services.leadsRepository.createLead({ organization_id: scope.organization_id, name: "Synthetic enquiry", email: "enquiry@example.test", source: "MANUAL", ...patch });
  const get = async id => (await service.get(scope)).steps.find(row => row.id === id);
  const persisted = async () => { const rows = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"); const snapshot = {}; for (const row of rows) snapshot[row.name] = await db.all('SELECT * FROM "' + row.name.replaceAll('"', '""') + '"'); return snapshot; };
  return { db, config, services, registered, scope, service, lead, get, persisted, at: value => { clock = value; } };
}
test("empty setup is owner scoped and every observed table remains unchanged", async t => {
  const f = await fixture(t), before = await f.persisted(), view = await f.service.get(f.scope);
  assert.equal(view.lead, null); assert.equal(view.scope, "LATEST_ACTIVE_ENQUIRY"); assert.equal(view.steps.length, 7);
  assert.equal((await f.get("BUSINESS")).state, "NOT_STARTED"); assert.equal((await f.get("RECOVERY")).state, "NOT_STARTED");
  assert.equal((await f.get("CHANNEL")).reason_code, "SANDBOX_CHANNEL_ONLY"); assert.equal((await f.get("CHANNEL")).details.live_send_available, false);
  assert.deepEqual(await f.persisted(), before);
  await assert.rejects(f.service.get({ ...f.scope, actor: { ...f.scope.actor, role: "MEMBER" } }), { code: "SETUP_OWNER_REQUIRED" });
  const foreign = await f.services.leadsRepository.createOrganization({ name: "Foreign workspace" }); await assert.rejects(f.service.get({ ...f.scope, organization_id: foreign.id }), { code: "SETUP_OWNER_REQUIRED" });
  await assert.rejects(f.service.get({ ...f.scope, actor: { id: "other-owner", role: "OWNER" } }), { code: "SETUP_OWNER_REQUIRED" });
});
test("profile and explicit criteria remain independent saved observations", async t => {
  const f = await fixture(t), business = new BusinessContextService(f.db), profile = { ...emptyProfile(), business_name: "Example business", offerings: ["Workstations"] };
  await business.updateProfile({ ...f.scope, expected_revision: 0, profile, reason: "Owner setup" });
  assert.equal((await f.get("BUSINESS")).reason_code, "FIT_CRITERIA_MISSING");
  await business.updateProfile({ ...f.scope, expected_revision: 1, profile, reason: "Owner criteria", fit_criteria: { version: 1, interest: { requirement: "REQUIRED", accepted_aliases: ["workstations"], excluded_aliases: [] }, location: null, budget: null, timeline: null } });
  const result = await f.get("BUSINESS"); assert.equal(result.state, "RECORDED"); assert.equal(result.details.revision, 2);
});
test("invalid context stays unavailable and oversized context is rejected before persistence", async t => {
  const f = await fixture(t), business = new BusinessContextService(f.db);
  await business.updateProfile({ ...f.scope, expected_revision: 0, profile: { ...emptyProfile(), business_name: "Example", offerings: ["Desks"] }, reason: "Setup" });
  await f.db.run("UPDATE business_profile_revisions SET profile_json=? WHERE organization_id=?", ["{}", f.scope.organization_id]);
  assert.equal((await f.get("BUSINESS")).state, "UNAVAILABLE");
  await assert.rejects(f.db.run("UPDATE business_profile_revisions SET profile_json=? WHERE organization_id=?", ["x".repeat(524289), f.scope.organization_id]), /CHECK constraint/);
  assert.equal((await f.get("BUSINESS")).state, "UNAVAILABLE"); assert.equal((await f.get("RECOVERY")).state, "NOT_STARTED");
});
test("latest active enquiry is selected while archived records cannot complete the guide", async t => {
  const f = await fixture(t), older = await f.lead({ name: "Older active" }), archived = await f.lead({ name: "Newest archived" });
  await f.db.run("UPDATE leads SET created_at='2026-09-10T10:00:00.000Z' WHERE id=?", [older.id]);
  await f.db.run("UPDATE leads SET created_at='2026-09-12T10:00:00.000Z',archived_at='2026-09-13T10:00:00.000Z' WHERE id=?", [archived.id]);
  assert.equal((await f.service.get(f.scope)).lead.id, older.id);
  await f.db.run("UPDATE leads SET archived_at='2026-09-13T10:00:00.000Z' WHERE id=?", [older.id]); assert.equal((await f.service.get(f.scope)).lead, null);
});
test("saved assessment is not relabelled current and the guide never advances freshness state", async t => {
  const f = await fixture(t), lead = await f.lead();
  const saved = await new IntelligenceRepository(f.db).createDraftSnapshot({ organization_id: f.scope.organization_id, lead_id: lead.id, version: 1, pipeline_version: "historical-test", input_fingerprint: "saved-test" });
  await f.db.run("UPDATE intelligence_snapshots SET status='READY' WHERE id=?", [saved.id]);
  const before = await f.persisted(), result = await f.get("INTELLIGENCE"); assert.equal(result.details.snapshot.id, saved.id); assert.equal(result.details.currentness, "NOT_CHECKED"); assert.equal(result.state, "NEEDS_ATTENTION"); assert.deepEqual(await f.persisted(), before);
});
test("only the actual current message revision supplies its recorded decision", async t => {
  const f = await fixture(t), lead = await f.lead(), composer = new ComposerService(f.db), scope = { ...f.scope, lead_id: lead.id };
  const first = await composer.create({ ...scope, review_token: (await composer.get(scope)).review_token, request_key: "message-1", acknowledge_pending: false, kind: "NEW_MESSAGE", reply_to_message_id: null, reason: "Owner draft", subject: "Question", body: "What would be useful?", scheduled_at: null });
  await f.services.approvalsService.approveAction({ organization_id: f.scope.organization_id, action_id: first.command.action_id, expected_revision_id: first.prepared_revision.id, reviewer_user_id: f.scope.actor.id });
  assert.equal((await f.get("REVIEW")).details.action.decision, "APPROVED");
  await composer.edit({ ...f.scope, action_id: first.command.action_id, request_key: "edit-1", expected_revision_id: first.prepared_revision.id, reason: "Correct message", subject: "Revised question", body: "What date suits you?", scheduled_at: null });
  const result = await f.get("REVIEW"); assert.equal(result.state, "NEEDS_ATTENTION"); assert.equal(result.details.action.decision, null); assert.equal(result.details.dispatch_authorization, "NOT_CHECKED");
});
test("recovery count represents current usable codes and expiry remains visible", async t => {
  const f = await fixture(t), security = new AccountSecurityService(f.db);
  await security.rotateRecoveryCodes({ ...f.scope, session_id: f.registered.session.id, expected_security_revision: 0, current_password: PASSWORD });
  f.at(Date.now()); const result = await f.get("RECOVERY"); assert.equal(result.state, "RECORDED"); assert.equal(result.details.usable_count, 8); assert.ok(result.details.expires_at);
  f.at(Date.parse(result.details.expires_at) + 1); assert.equal((await f.get("RECOVERY")).state, "NOT_STARTED"); assert.equal((await f.get("RECOVERY")).details.usable_count, 0);
});
test("current outcomes and pending manual reminders preserve withdrawal rather than historical counts", async t => {
  const f = await fixture(t), lead = await f.lead(), service = new CustomerWorkflowService(f.db), scope = { ...f.scope, lead_id: lead.id };
  const current = await service.listOutcomes(scope), saved = await service.saveOutcome({ ...scope, outcome_id: null, expected_revision: 0, review_token: current.review_token, request_key: "outcome-1", status: "RECORDED", reason: "Owner observed milestone", values: { kind: "MEETING_BOOKED", occurred_at: "2026-09-12T10:00:00.000Z", summary: "Meeting recorded", source_reference: null, evidence_message_id: null, attributed_action_id: null, attribution_note: null, amount: null } });
  assert.equal((await f.get("WORKFLOW")).details.outcomes[0].kind, "MEETING_BOOKED");
  const review = await service.getOutcome({ ...scope, outcome_id: saved.change.id });
  await service.saveOutcome({ ...scope, outcome_id: saved.change.id, expected_revision: saved.change.revision, review_token: review.review_token, request_key: "withdraw-outcome", status: "WITHDRAWN", reason: "Prior record was incorrect", values: review.outcome.values });
  assert.deepEqual((await f.get("WORKFLOW")).details.outcomes, []);
  await service.createFollowUp({ ...scope, review_token: (await service.listFollowUps(scope)).review_token, request_key: "manual-reminder", reason: "Review enquiry", due_at: "2026-09-14T10:00:00.000Z", reply_to_message_id: null });
  assert.ok((await f.get("WORKFLOW")).details.pending_reminder.id);
});
test("actual synthetic verification probes are excluded without approval or dispatch", async t => {
  const f = await fixture(t), lead = await f.lead(); await f.db.run("UPDATE leads SET created_at='2026-09-10T10:00:00.000Z' WHERE id=?", [lead.id]);
  const key = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
  let connection = await f.services.emailConnectionService.get(f.scope);
  await f.services.emailConnectionService.save({ ...f.scope, expected_revision: connection.revision, review_token: connection.review_token, request_key: "synthetic-config", reason: "Controlled local fixture", values: { provider: "sendgrid", from_email: "sender@example.test", reply_to: "reply@parse.example.test", api_key: "synthetic-not-a-real-credential", sendgrid_events_public_key: key(), sendgrid_inbound_public_key: key() } });
  connection = await f.services.emailConnectionService.get(f.scope); await f.services.emailConnectionService.provisionRoute({ ...f.scope, expected_revision: connection.revision, review_token: connection.review_token, request_key: "route", reason: "Synthetic route" });
  let calls = 0; const verify = new EmailVerificationService(f.db, { publicOrigin: f.config.security.publicAppOrigin, controlledRecipients: f.config.emailVerification.controlledRecipients, adapter: { async check() { calls++; return { version: 1, checks: CHECK_IDS.map(id => ({ id, status: "PASS", code: "SYNTHETIC_CONFIRMED", http_status: 200 })) }; } } });
  const review = await verify.get(f.scope), run = (await verify.create({ ...f.scope, expected_connection_revision: review.connection_revision, review_token: review.review_token, request_key: "verify", reason: "Synthetic check" })).verification;
  await verify.check({ ...f.scope, verification_id: run.id, request_key: "synthetic-check" }); const probe = (await verify.createProbe({ ...f.scope, verification_id: run.id, purpose: "DELIVERY", request_key: "probe" })).probe;
  assert.notEqual(probe.lead_id, lead.id); const before = await f.persisted(); assert.equal((await f.service.get(f.scope)).lead.id, lead.id); assert.deepEqual(await f.persisted(), before); assert.equal(calls, 1); assert.equal(Number((await f.db.get("SELECT count(*) n FROM action_executions")).n), 0);
});
