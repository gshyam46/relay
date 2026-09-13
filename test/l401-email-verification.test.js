import { assessCurrentChannelCapability } from "../src/modules/channels/channelCapability.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createDatabase } from "../src/database/database.js";
import { createServices } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { EmailVerificationService } from "../src/modules/channels/emailVerificationService.js";
import { CHECK_TTL_MS, CHECK_LEASE_MS, CHECK_IDS, probeCopy } from "../src/modules/channels/emailVerificationContract.js";
import { recordEmailVerificationReceipt } from "../src/modules/channels/emailVerificationRepository.js";
import { normalizeSendgridEventReceipt, normalizeSendgridInbound } from "../src/modules/channels/sendgridEvents.js";
import { ChannelRouter } from "../src/modules/handlers/channelRouter.js";
import { approveStoredAction } from "./helpers/review.js";
const key = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
const settings = { provider: "sendgrid", from_email: "sender@example.test", reply_to: "reply@parse.example.test", api_key: "synthetic-not-a-real-credential", sendgrid_events_public_key: key(), sendgrid_inbound_public_key: key() };
const passed = () => ({ version: 1, checks: CHECK_IDS.map(id => ({ id, status: "PASS", code: "SYNTHETIC_CONFIRMED", http_status: 200 })) });
function barrier() { let enter, release; return { entered: new Promise(r => { enter = r; }), waiting: new Promise(r => { release = r; }), enter: () => enter(), release: () => release() }; }
async function fixture(t, { adapter = null, recipients = true } = {}) {
  const db = await createDatabase(":memory:"); t.after(() => db.close());
  const config = loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: "false", WORKER_ENABLED: "false", PUBLIC_APP_ORIGIN: "https://verification.example.test",
    ...(recipients ? { EMAIL_VERIFICATION_DELIVERY_MAILBOX: "controlled@example.test", EMAIL_VERIFICATION_FAILURE_MAILBOX: "reject@example.test" } : {}) });
  const services = createServices(db, undefined, config);
  const registered = await services.authService.register({ organization_name: "Synthetic email verification", name: "Synthetic owner", email: "owner@example.test", password: "synthetic-test-password" });
  const scope = { organization_id: registered.organization.id, actor: registered.user };
  let clock = Date.now(), checks = 0, sends = 0;
  const verify = new EmailVerificationService(db, { publicOrigin: config.security.publicAppOrigin, controlledRecipients: config.emailVerification?.controlledRecipients,
    now: () => clock, adapter: adapter || { async check() { checks++; assert.ok(await db.get("SELECT id FROM organizations WHERE id=?", [scope.organization_id])); return passed(); } } });
  let connection = await services.emailConnectionService.get(scope);
  await services.emailConnectionService.save({ ...scope, expected_revision: connection.revision, review_token: connection.review_token, request_key: "connection-save", reason: "Synthetic controlled setup", values: settings });
  connection = await services.emailConnectionService.get(scope);
  await services.emailConnectionService.provisionRoute({ ...scope, expected_revision: connection.revision, review_token: connection.review_token, request_key: "route", reason: "Synthetic route" });
  clock = Date.now();
  services.actionExecutor.adapter = new ChannelRouter({ emailAdapter: { async send() { sends++; return { ok: true, provider: "sendgrid", provider_reference: "synthetic-http-reference" }; } } });
  const create = async (key = "verification") => { const view = await verify.get(scope); return verify.create({ ...scope, expected_connection_revision: view.connection_revision, review_token: view.review_token, request_key: key, reason: "Authorized synthetic local verification" }); };
  const f = { db, services, verify, scope, config, create, checks: () => checks, sends: () => sends, now: () => clock, at: n => { clock = n; services.actionExecutor.now = () => clock; services.webhookInbox.now = () => clock; } };
  return f;
}
async function ready(f) { const run = (await f.create()).verification; await f.verify.check({ ...f.scope, verification_id: run.id, request_key: "check" }); return run; }
async function probe(f, run, purpose) { return (await f.verify.createProbe({ ...f.scope, verification_id: run.id, purpose, request_key: "probe-" + purpose })).probe; }
async function send(f, probe) { const action = await f.services.actionsRepository.getAction(probe.action_id); await approveStoredAction(f.services, action); const result = await f.services.actionExecutor.execute(action); assert.notEqual(result.executable, false); return f.db.get("SELECT * FROM action_executions WHERE action_id=? ORDER BY attempt DESC LIMIT 1", [probe.action_id]); }
async function receive(f, input, kind, { verification = "SIGNED_PROVIDER", configuration = null, route = null, hook = true, process = true } = {}) {
  const config = configuration || await f.services.settingsRepository.getCategory(f.scope.organization_id, "channel_email");
  const event = kind === "SENDGRID_EVENT" ? normalizeSendgridEventReceipt(input) : { provider_event_id: input.provider_event_id, payload: input };
  const result = await f.services.webhookInbox.receive({ organization_id: f.scope.organization_id, provider: "sendgrid", connection_key: "channel_email", event_kind: kind,
    provider_event_id: event.provider_event_id, verification_kind: verification, input: event.payload }, hook ? { onInsertedInTransaction: (tx, receipt) => recordEmailVerificationReceipt(tx, { receipt, configuration: config, route_token: route || config.webhook_token, input: event.payload }) } : {});
  if (process) await f.services.webhookInbox.processReceipt({ organization_id: f.scope.organization_id, receipt_id: result.row.id });
  return result;
}
async function event(f, probe, execution, type, options = {}) { const recipient = probe.purpose === "DELIVERY" ? "controlled@example.test" : "reject@example.test";
  return receive(f, { event: type, ...(type === "bounce" ? { type: "bounce" } : {}), email: recipient, sg_event_id: randomUUID(), relay_action_id: probe.action_id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id, sg_message_id: "synthetic-mail-id", ...options.patch }, "SENDGRID_EVENT", options); }
async function inbound(f, run, kind, options = {}) { const row = await f.db.get("SELECT * FROM email_verification_runs WHERE id=?", [run.id]), copy = probeCopy(row, "DELIVERY");
  const input = normalizeSendgridInbound({ from: "controlled@example.test", to: row.reply_to, envelope: JSON.stringify({ from: "controlled@example.test", to: [row.reply_to] }), text: copy[kind], subject: "Re: controlled verification", headers: "Message-ID: <" + randomUUID() + "@example.test>" }, { organization_id: f.scope.organization_id });
  return receive(f, input, "INBOUND_MESSAGE", options);
}

test("verification creation and request recovery are exact, scoped and provider-free", async t => {
  const f = await fixture(t), view = await f.verify.get(f.scope); assert.equal(view.can_create, true); assert.equal(view.live_send_available, false);
  const command = { ...f.scope, expected_connection_revision: view.connection_revision, review_token: view.review_token, request_key: "exact", reason: "Synthetic controlled proof" };
  const created = await f.verify.create(command), again = await f.verify.create(command);
  assert.equal(again.verification.id, created.verification.id); assert.equal(again.replayed, true); assert.equal((await f.verify.byRequestKey({ ...f.scope, request_key: "exact" })).verification.id, created.verification.id);
  await assert.rejects(f.verify.create({ ...command, reason: "Different reason" }), { code: "EMAIL_VERIFICATION_REQUEST_CONFLICT" });
  await assert.rejects(f.verify.create({ ...command, recipient: "victim@example.test" }), { code: "EMAIL_VERIFICATION_INVALID_INPUT" });
  await assert.rejects(f.verify.get({ ...f.scope, actor: { ...f.scope.actor, role: "MEMBER" } }), { statusCode: 403 });
  assert.equal(f.checks(), 0); assert.equal(f.sends(), 0); assert.equal(JSON.stringify(created).includes(settings.api_key), false);
});
test("missing deployment authorization cannot create probes or live verification", async t => {
  const f = await fixture(t, { recipients: false }); assert.equal((await f.verify.get(f.scope)).can_create, false);
  await assert.rejects(f.create(), { code: "EMAIL_VERIFICATION_RECIPIENTS_REQUIRED" });
});
test("check admission is single-flight and lost responses replay without another provider request", async t => {
  const b = barrier(); let calls = 0;
  const f = await fixture(t, { adapter: { async check() { calls++; b.enter(); await b.waiting; return passed(); } } }), run = (await f.create()).verification;
  const command = { ...f.scope, verification_id: run.id, request_key: "slow" }, operation = f.verify.check(command); await b.entered;
  const replay = await f.verify.check(command); assert.equal(replay.check.state, "RUNNING"); assert.equal(replay.replayed, true);
  await assert.rejects(f.verify.check({ ...command, request_key: "competing" }), { code: "EMAIL_VERIFICATION_CHECK_RUNNING" });
  b.release(); assert.equal((await operation).check.state, "PASSED"); assert.equal((await f.verify.check(command)).check.state, "PASSED"); assert.equal(calls, 1);
});
test("newer same-clock failure controls currentness and exact expiry survives clock rollback", async t => {
  const f = await fixture(t), run = await ready(f);
  const first = (await f.verify.get(f.scope)).verification.check; f.verify.adapter = { async check() { const result = passed(); result.checks[0] = { ...result.checks[0], status: "FAIL", code: "MAIL_SEND_SCOPE_MISSING" }; return result; } };
  await f.verify.check({ ...f.scope, verification_id: run.id, request_key: "second" }); assert.equal((await f.verify.get(f.scope)).verification.check.state, "FAILED");
  f.verify.adapter = { async check() { return passed(); } }; await f.verify.check({ ...f.scope, verification_id: run.id, request_key: "third" });
  f.at(Date.parse(first.expires_at)); assert.equal((await f.verify.get(f.scope)).verification.check.state, "EXPIRED");
  f.at(Date.parse(first.started_at)); assert.equal((await f.verify.get(f.scope)).verification.check.state, "EXPIRED");
});
test("an interrupted old check cannot supersede a new admitted check", async t => {
  const b = barrier(); let calls = 0; const f = await fixture(t, { adapter: { async check() { calls++; if (calls === 1) { b.enter(); await b.waiting; } return passed(); } } });
  const run = (await f.create()).verification, operation = f.verify.check({ ...f.scope, verification_id: run.id, request_key: "old" }); await b.entered;
  f.at(f.now() + CHECK_LEASE_MS); assert.equal((await f.verify.get(f.scope)).verification.check.state, "INTERRUPTED");
  await f.verify.check({ ...f.scope, verification_id: run.id, request_key: "new" }); b.release(); assert.equal((await operation).check.state, "UNKNOWN");
  assert.equal((await f.verify.get(f.scope)).verification.check.number, 2); assert.equal((await f.verify.get(f.scope)).verification.check.state, "PASSED");
});
test("configuration changed during a provider check cannot adopt its result", async t => {
  const b = barrier(); const f = await fixture(t, { adapter: { async check() { b.enter(); await b.waiting; return passed(); } } }); const run = (await f.create()).verification;
  const operation = f.verify.check({ ...f.scope, verification_id: run.id, request_key: "checking" }); await b.entered;
  const view = await f.services.emailConnectionService.get(f.scope); await f.services.emailConnectionService.save({ ...f.scope, expected_revision: view.revision, review_token: view.review_token, request_key: "changed", reason: "Synthetic sender change", values: { ...settings, from_email: "changed@example.test" } });
  b.release(); assert.equal((await operation).check.state, "UNKNOWN"); assert.equal((await f.verify.byRequestKey({ ...f.scope, request_key: "verification" })).verification.status, "STALE");
});
test("probes are fixed, explicitly approved, idempotent and cannot authorize ordinary copied actions", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY");
  assert.equal((await probe(f, run, "DELIVERY")).id, p.id); assert.equal(f.sends(), 0);
  const action = await f.services.actionsRepository.getAction(p.action_id), draft = await f.services.approvalsService.currentForAction({ organization_id: f.scope.organization_id, action_id: action.id });
  await assert.rejects(f.services.approvalsService.previewAction({ organization_id: f.scope.organization_id, action_id: action.id, expected_revision_id: draft.prepared_revision.id, edited_payload: { body: "Edited customer content" } }), { code: "EMAIL_VERIFICATION_PROBE_IMMUTABLE" });
  const copied = await f.services.actionsRepository.createAction({ organization_id: f.scope.organization_id, lead_id: action.lead_id, type: "SEND_EMAIL", payload: JSON.parse(action.payload_json), approval_requirement: "REQUIRED", status: "AWAITING_APPROVAL", idempotency_key: "not-a-probe" });
  await approveStoredAction(f.services, copied); assert.equal((await f.services.actionExecutor.execute(copied)).hold_code, "CHANNEL_VERIFICATION_REQUIRED");
  await send(f, p); assert.equal(f.sends(), 1); await f.services.actionExecutor.execute(action); assert.equal(f.sends(), 1);
});
test("only all four signed processed exact proofs unlock ordinary live capability", async t => {
  const f = await fixture(t), run = await ready(f), delivery = await probe(f, run, "DELIVERY"), failure = await probe(f, run, "FAILURE");
  const deliveredExecution = await send(f, delivery), failedExecution = await send(f, failure);
  await event(f, delivery, deliveredExecution, "delivered"); await event(f, failure, failedExecution, "bounce");
  let view = await f.verify.get(f.scope); assert.equal(view.live_send_available, false); assert.equal(view.verification.milestones.filter(m => m.status === "RECORDED").length, 2);
  await inbound(f, run, "reply"); view = await f.verify.get(f.scope); assert.equal(view.live_send_available, false);
  await inbound(f, run, "stop"); view = await f.verify.get(f.scope); assert.equal(view.live_send_available, true); assert.equal(view.verification.status, "VERIFIED");
  const capability = await assessCurrentChannelCapability(f.db, { organization_id: f.scope.organization_id, action_type: "SEND_EMAIL", strict: true }); assert.equal(capability.can_dispatch, true); assert.equal(capability.verification, "VERIFIED");
  assert.ok(await f.db.get("SELECT id FROM contact_restrictions WHERE organization_id=? AND contact_value='controlled@example.test' AND reason='OPT_OUT'", [f.scope.organization_id]));
  const lead = await f.services.leadsRepository.createLead({ organization_id: f.scope.organization_id, name: "Synthetic ordinary customer", email: "ordinary@example.test" });
  const action = await f.services.actionsRepository.createAction({ organization_id: f.scope.organization_id, lead_id: lead.id, type: "SEND_EMAIL", payload: { subject: "Reviewed ordinary message", message: "Synthetic approved ordinary body." }, approval_requirement: "REQUIRED", status: "AWAITING_APPROVAL", idempotency_key: "ordinary-approved" });
  await approveStoredAction(f.services, action); assert.notEqual((await f.services.actionExecutor.execute(action)).executable, false); assert.equal(f.sends(), 3);
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts")).n, 4);
});
test("unsigned/internal receipts and late replay without original proof cannot verify", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), execution = await send(f, p);
  const first = await event(f, p, execution, "delivered", { verification: "TRUSTED_INTERNAL" });
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts")).n, 0);
  assert.equal((await f.verify.get(f.scope)).verification.milestones[0].status, "PENDING");
  const replay = await f.services.webhookInbox.receive({ organization_id: f.scope.organization_id, provider: "sendgrid", connection_key: "channel_email", event_kind: "SENDGRID_EVENT", provider_event_id: first.row.provider_event_id, verification_kind: "SIGNED_PROVIDER", input: JSON.parse(first.row.normalized_input_json) }, { onInsertedInTransaction() { throw new Error("Dedupe must not acquire new evidence"); } });
  assert.equal(replay.duplicate, true);
});
test("wrong recipient, wrong signature configuration and retired route never credit delivery", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), execution = await send(f, p);
  await event(f, p, execution, "delivered", { patch: { email: "wrong@example.test" } });
  await event(f, p, execution, "delivered", { route: "retired-unrelated-route" });
  const configuration = await f.services.settingsRepository.getCategory(f.scope.organization_id, "channel_email");
  await event(f, p, execution, "delivered", { configuration: { ...configuration, sendgrid_events_public_key: key() } });
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts")).n, 0); assert.equal((await f.verify.get(f.scope)).live_send_available, false);
});
test("proof insertion and normal receipt commit roll back together and retry remains possible", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), execution = await send(f, p);
  const config = await f.services.settingsRepository.getCategory(f.scope.organization_id, "channel_email"), input = normalizeSendgridEventReceipt({ event: "delivered", email: "controlled@example.test", sg_event_id: "rollback-proof", relay_action_id: p.action_id, relay_execution_id: execution.id, relay_revision_id: execution.action_revision_id });
  const command = { organization_id: f.scope.organization_id, provider: "sendgrid", connection_key: "channel_email", event_kind: "SENDGRID_EVENT", provider_event_id: input.provider_event_id, verification_kind: "SIGNED_PROVIDER", input: input.payload };
  await assert.rejects(f.services.webhookInbox.receive(command, { onInsertedInTransaction: async (tx, receipt) => { await recordEmailVerificationReceipt(tx, { receipt, configuration: config, route_token: config.webhook_token, input: input.payload }); throw new Error("Synthetic rollback"); } }), /Synthetic rollback/);
  assert.equal((await f.db.get("SELECT count(*) AS n FROM webhook_receipts")).n, 0); assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts")).n, 0);
  const received = await f.services.webhookInbox.receive(command, { onInsertedInTransaction: (tx, receipt) => recordEmailVerificationReceipt(tx, { receipt, configuration: config, route_token: config.webhook_token, input: input.payload }) });
  assert.equal((await f.verify.get(f.scope)).verification.milestones[0].status, "PENDING");
  await f.services.webhookInbox.processReceipt({ organization_id: f.scope.organization_id, receipt_id: received.row.id });
  assert.equal((await f.verify.get(f.scope)).verification.milestones[0].status, "RECORDED");
});

test("a changed configuration cannot wrap an uncertain prior probe in a new send", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY");
  f.services.actionExecutor.adapter = { async invoke() { return { ok: false, uncertain: true, retryable: false }; } };
  const execution = await send(f, p); assert.equal(execution.outcome_class, "UNCERTAIN");
  const connection = await f.services.emailConnectionService.get(f.scope);
  await f.services.emailConnectionService.save({ ...f.scope, expected_revision: connection.revision, review_token: connection.review_token, request_key: "new-sender", reason: "Synthetic changed configuration", values: { ...settings, from_email: "other@example.test" } });
  const next = (await f.create("next-run")).verification;
  await f.verify.check({ ...f.scope, verification_id: next.id, request_key: "next-check" });
  await assert.rejects(probe(f, next, "DELIVERY"), { code: "EMAIL_VERIFICATION_REQUEST_CONFLICT" });
  await assert.rejects(f.verify.createProbe({ ...f.scope, verification_id: next.id, purpose: "DELIVERY", request_key: "new-delivery" }), { code: "EMAIL_VERIFICATION_PRIOR_UNRESOLVED" });
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_probes")).n, 1);
});
test("first expiry observed on rejected dispatch remains expired after physical clock rollback", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), view = await f.verify.get(f.scope);
  const action = await f.services.actionsRepository.getAction(p.action_id); await approveStoredAction(f.services, action);
  f.at(Date.parse(view.verification.check.expires_at));
  assert.equal((await f.services.actionExecutor.execute(action)).hold_code, "CHANNEL_VERIFICATION_REQUIRED");
  f.at(Date.parse(view.verification.check.started_at));
  assert.equal((await f.services.actionExecutor.execute(action)).hold_code, "CHANNEL_VERIFICATION_REQUIRED");
  assert.equal(f.sends(), 0); assert.equal((await f.db.get("SELECT count(*) AS n FROM action_executions")).n, 0);
});
test("a fresh review of identical fixed probe content handles a real profile revision without accepting old approval", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), action = await f.services.actionsRepository.getAction(p.action_id);
  await approveStoredAction(f.services, action);
  await new BusinessContextService(f.db).updateProfile({ ...f.scope, actor: { id: f.scope.actor.id, role: f.scope.actor.role }, expected_revision: 0, reason: "Synthetic new business context", profile: { business_name: "Synthetic offering", offerings: ["A service"], service_areas: [], target_customers: [], exclusions: [], required_criteria: [], preferred_criteria: [], preferred_next_step: null, timezone: null, language: null } });
  assert.equal((await f.services.actionExecutor.execute(action)).executable, false); assert.equal(f.sends(), 0);
  const fresh = await approveStoredAction(f.services, action); assert.notEqual(fresh.prepared_revision.id, p.revision_id);
  const original = await f.db.get("SELECT content_hash FROM action_revisions WHERE id=?", [p.revision_id]); assert.equal(fresh.prepared_revision.content_hash, original.content_hash);
  assert.notEqual((await f.services.actionExecutor.execute(action)).executable, false); assert.equal(f.sends(), 1);
});
test("bounded duplicate delivery proofs cannot consume the slots needed for a real stop", async t => {
  const f = await fixture(t), run = await ready(f), p = await probe(f, run, "DELIVERY"), execution = await send(f, p);
  for (let i = 0; i < 7; i++) await event(f, p, execution, "delivered");
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts WHERE kind='DELIVERY'")).n, 5);
  await inbound(f, run, "stop");
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_receipts WHERE kind='STOP'")).n, 1);
  assert.ok(await f.db.get("SELECT id FROM contact_restrictions WHERE contact_value='controlled@example.test' AND reason='OPT_OUT'"));
  assert.equal((await f.verify.get(f.scope)).live_send_available, false);
});

test("foreign verification runs and probe commands remain unavailable to another owner", async t => {
  const f = await fixture(t), run = await ready(f);
  const other = await f.services.authService.register({ organization_name: "Other synthetic workspace", name: "Other owner", email: "other-owner@example.test", password: "synthetic-other-password" });
  const foreign = { organization_id: other.organization.id, actor: other.user };
  assert.equal((await f.verify.byRequestKey({ ...foreign, request_key: "verification" })).verification, null);
  await assert.rejects(f.verify.check({ ...foreign, verification_id: run.id, request_key: "foreign-check" }), { statusCode: 404 });
  await assert.rejects(f.verify.createProbe({ ...foreign, verification_id: run.id, purpose: "DELIVERY", request_key: "foreign-probe" }), { statusCode: 404 });
  assert.equal((await f.db.get("SELECT count(*) AS n FROM email_verification_probes")).n, 0);
});

test("original request recovery stays readable when current reserved setup is corrupted", async t => {
  const f = await fixture(t), run = await ready(f);
  await f.services.settingsRepository.setBulk(f.scope.organization_id, "channel_email", { connection_revision: 99 });
  await assert.rejects(f.verify.get(f.scope), { code: "EMAIL_CONNECTION_STATE_INVALID" });
  const recovered = await f.verify.byRequestKey({ ...f.scope, request_key: "verification" });
  assert.equal(recovered.verification.id, run.id); assert.equal(recovered.verification.status, "STALE"); assert.equal(recovered.verification.live_send_available, false); assert.equal(recovered.verification.can_check, false);
});
