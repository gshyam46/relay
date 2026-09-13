import { randomBytes } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { LeadsRepository } from "../data-foundation/leadsRepository.js";
import { ActionsRepository } from "../outbound-automation/actionsRepository.js";
import { PreparedActionService } from "../outbound-automation/preparedActionService.js";
import { fingerprint } from "../outbound-automation/preparedActionContract.js";
import { EmailConnectionService } from "./emailConnectionService.js";
import { emailConnectionHash, requireEmailConnectionOwner } from "./emailConnectionContract.js";
import { EmailVerificationRepository, publicProbe, publicVerificationCheck } from "./emailVerificationRepository.js";
import { SendgridVerificationAdapter } from "./sendgridVerificationAdapter.js";
import { CHECK_LEASE_MS, CHECK_TTL_MS, emptyChecks, parseChecks, probeCopy, runtimeConfigured, verificationError, verificationObject, verificationRuntime, verificationText } from "./emailVerificationContract.js";

const SCOPE = ["organization_id", "actor"];
export class EmailVerificationService {
  constructor(db, { publicOrigin, controlledRecipients, adapter = new SendgridVerificationAdapter(), now = Date.now } = {}) {
    this.db = db.rootDatabase || db; this.policy = new ContactPolicyService(this.db); this.runtime = verificationRuntime({ publicOrigin, controlledRecipients }); this.adapter = adapter; this.now = now;
  }
  async gate(input, work) {
    const org = verificationText(input.organization_id);
    return this.policy.withWorkspacePolicyTransaction(org, async tx => {
      await requireEmailConnectionOwner(tx, org, input.actor);
      const repository = new EmailVerificationRepository(tx), now = await repository.time(org, this.now());
      return work(tx, org, repository, now);
    });
  }
  async state(tx, org, now, run = null) {
    const connection = new EmailConnectionService(tx, { publicOrigin: this.runtime.publicOrigin || "http://localhost", now: () => now });
    const state = await connection.state(tx, org);
    return { connection: state, verification: await currentEmailVerificationInTransaction(tx, { organization_id: org, configuration: state.config, runtime: this.runtime, now: () => now, run }) };
  }
  async get(input) {
    verificationObject(input, SCOPE);
    return this.gate(input, async (tx, org, repository, now) => {
      const state = await this.state(tx, org, now), current = state.verification;
      const runCount = Number((await tx.get("SELECT count(*) AS n FROM email_verification_runs WHERE organization_id=?", [org])).n);
      return { connection_revision: state.connection.snapshot.revision, review_token: state.connection.view.review_token, controlled_recipients: this.runtime.controlledRecipients,
        can_create: runCount < 100 && !current.verification && runtimeConfigured(this.runtime) && state.connection.snapshot.management === "MANAGED" && state.connection.snapshot.configuration.complete && state.connection.snapshot.routing.provisioned && !state.connection.routeProblem,
        verification: current.verification, live_send_available: current.available, hold_reasons: runCount >= 100 && !current.verification ? [...current.hold_reasons, "EMAIL_VERIFICATION_LIMIT"] : current.hold_reasons };
    });
  }
  async byRequestKey(input) {
    verificationObject(input, [...SCOPE, "request_key"]); const key = verificationText(input.request_key, 200);
    return this.gate(input, async (tx, org, repository, now) => {
      const run = await repository.byRequest(org, key);
      if (!run) return { verification: null };
      await repository.assertRun(run);
      try { return { verification: (await this.state(tx, org, now, run)).verification.verification }; }
      catch (error) {
        if (!error.code?.startsWith("EMAIL_CONNECTION_") || error.statusCode !== 503) throw error;
        return { verification: (await describeRun(repository, run, now, false)).verification };
      }
    });
  }
  async create(input) {
    verificationObject(input, [...SCOPE, "expected_connection_revision", "review_token", "request_key", "reason"]);
    const key = verificationText(input.request_key, 200), reason = verificationText(input.reason, 2000);
    if (!Number.isInteger(input.expected_connection_revision) || input.expected_connection_revision < 1 || input.expected_connection_revision > 100 || typeof input.review_token !== "string" || !/^[a-f0-9]{64}$/.test(input.review_token)) throw verificationError("EMAIL_VERIFICATION_INVALID_INPUT", "Provide the current managed email connection revision and review token.", 400);
    const requestHash = fingerprint({ actor: input.actor?.id, revision: input.expected_connection_revision, review_token: input.review_token, reason });
    return this.gate(input, async (tx, org, repository, now) => {
      let run = await repository.byRequest(org, key);
      if (run) { sameIntent(run, requestHash); return { verification: (await this.state(tx, org, now, run)).verification.verification, replayed: true }; }
      const { connection } = await this.state(tx, org, now);
      if (!runtimeConfigured(this.runtime)) throw verificationError("EMAIL_VERIFICATION_RECIPIENTS_REQUIRED", "The deployment operator must configure both authorized controlled mailboxes and a public HTTPS origin.");
      if (connection.snapshot.revision !== input.expected_connection_revision || connection.view.review_token !== input.review_token) throw verificationError("EMAIL_VERIFICATION_CONFIG_STALE", "Email setup changed. Review its current revision.");
      if (connection.snapshot.management !== "MANAGED" || connection.config.provider !== "sendgrid" || !connection.snapshot.configuration.complete || !connection.snapshot.routing.provisioned || connection.routeProblem) throw verificationError("EMAIL_VERIFICATION_SETUP_REQUIRED", "Complete managed SendGrid setup and provision its unique route first.");
      run = await repository.current(org, connection.config, this.runtime);
      if (run) throw verificationError("EMAIL_VERIFICATION_EXISTS", "This exact configuration already has a verification run. Continue that run.");
      const count = await tx.get("SELECT count(*) AS n FROM email_verification_runs WHERE organization_id=?", [org]);
      if (Number(count.n) >= 100) throw verificationError("EMAIL_VERIFICATION_LIMIT", "Verification reached its supported run limit.");
      run = { id: createId("email_verification"), organization_id: org, request_key: key, request_hash: requestHash, connection_revision: connection.snapshot.revision,
        config_fingerprint: emailConnectionHash(connection.config), runtime_fingerprint: fingerprint(this.runtime), delivery_recipient: this.runtime.controlledRecipients.delivery,
        failure_recipient: this.runtime.controlledRecipients.failure, reply_to: connection.config.reply_to, nonce: randomBytes(32).toString("base64url"), created_at: new Date(now).toISOString(), created_by: input.actor.id, reason };
      await insert(tx, "email_verification_runs", run);
      await audit(tx, org, run.id, "EmailVerificationCreated", "Owner created a current-configuration verification run without sending a message.");
      return { verification: (await this.state(tx, org, now, run)).verification.verification, replayed: false };
    });
  }
  async check(input) {
    verificationObject(input, [...SCOPE, "verification_id", "request_key"]);
    const id = verificationText(input.verification_id), key = verificationText(input.request_key, 200), requestHash = fingerprint({ actor: input.actor?.id, verification_id: id });
    const admission = await this.gate(input, async (tx, org, repository, now) => {
      const prior = await tx.get("SELECT * FROM email_verification_checks WHERE organization_id=? AND request_key=?", [org, key]);
      if (prior) { sameIntent(prior, requestHash); return { replayed: true, check: publicVerificationCheck(prior, now) }; }
      const run = await requireRun(repository, org, id), state = await this.state(tx, org, now, run);
      requireCurrent(state.verification);
      const active = await tx.get("SELECT id FROM email_verification_checks WHERE organization_id=? AND state='RUNNING' AND lease_expires_at>? LIMIT 1", [org, new Date(now).toISOString()]);
      if (active) throw verificationError("EMAIL_VERIFICATION_CHECK_RUNNING", "A bounded provider configuration check is already running.");
      const count = await tx.get("SELECT count(*) AS n FROM email_verification_checks WHERE organization_id=? AND verification_id=?", [org, id]);
      if (Number(count.n) >= 100) throw verificationError("EMAIL_VERIFICATION_LIMIT", "This verification run reached its supported check limit.");
      const row = { id: createId("email_check"), organization_id: org, verification_id: id, check_number: Number(count.n) + 1, request_key: key, request_hash: requestHash,
        state: "RUNNING", started_at: new Date(now).toISOString(), lease_expires_at: new Date(now + CHECK_LEASE_MS).toISOString(), finished_at: null, expires_at: null, checks_json: JSON.stringify(emptyChecks()) };
      await insert(tx, "email_verification_checks", row);
      await audit(tx, org, id, "EmailVerificationCheckStarted", "Owner requested a bounded read-only provider configuration check.");
      return { row, configuration: state.connection.config, events_url: state.connection.snapshot.routing.events_url, inbound_url: state.connection.snapshot.routing.inbound_url };
    });
    if (admission.replayed) return admission;
    let result;
    try { result = parseChecks(JSON.stringify(await this.adapter.check({ configuration: admission.configuration, events_url: admission.events_url, inbound_url: admission.inbound_url }))); }
    catch { result = emptyChecks("PROVIDER_READ_UNAVAILABLE"); }
    // Settle the already admitted read even if its initiating browser/session was revoked.
    // It cannot grant authority after configuration changes or lease loss.
    return this.policy.withWorkspacePolicyTransaction(input.organization_id, async tx => {
      const repository = new EmailVerificationRepository(tx), now = await repository.time(input.organization_id, this.now());
      const row = await tx.get("SELECT * FROM email_verification_checks WHERE organization_id=? AND id=?", [input.organization_id, admission.row.id]);
      const run = await requireRun(repository, input.organization_id, id), current = await this.state(tx, input.organization_id, now, run);
      if (row.state !== "RUNNING") return { check: publicVerificationCheck(row, now), replayed: true };
      if (!current.verification.current || now >= Date.parse(row.lease_expires_at)) result = emptyChecks(!current.verification.current ? "CONFIGURATION_CHANGED" : "CHECK_LEASE_EXPIRED");
      const state = result.checks.every(check => check.status === "PASS") ? "PASSED" : result.checks.some(check => check.status === "FAIL") ? "FAILED" : "UNKNOWN";
      await tx.run("UPDATE email_verification_checks SET state=?,finished_at=?,expires_at=?,checks_json=? WHERE organization_id=? AND id=? AND state='RUNNING'", [state, new Date(now).toISOString(), state === "PASSED" ? new Date(now + CHECK_TTL_MS).toISOString() : null, JSON.stringify(result), input.organization_id, row.id]);
      await audit(tx, input.organization_id, id, "EmailVerificationCheckFinished", "Provider configuration inspection completed with a bounded recorded result.");
      return { check: publicVerificationCheck(await tx.get("SELECT * FROM email_verification_checks WHERE id=?", [row.id]), now), replayed: false };
    });
  }
  async createProbe(input) {
    verificationObject(input, [...SCOPE, "verification_id", "purpose", "request_key"]);
    const id = verificationText(input.verification_id), key = verificationText(input.request_key, 200);
    if (!["DELIVERY", "FAILURE"].includes(input.purpose)) throw verificationError("EMAIL_VERIFICATION_INVALID_INPUT", "Choose a supported controlled probe purpose.", 400);
    const requestHash = fingerprint({ actor: input.actor?.id, verification_id: id, purpose: input.purpose });
    return this.gate(input, async (tx, org, repository, now) => {
      const prior = await tx.get("SELECT * FROM email_verification_probes WHERE organization_id=? AND request_key=?", [org, key]);
      if (prior) { sameIntent(prior, requestHash); return { probe: publicProbe(prior), replayed: true }; }
      const run = await requireRun(repository, org, id);
      const existing = await tx.get("SELECT * FROM email_verification_probes WHERE organization_id=? AND verification_id=? AND purpose=?", [org, id, input.purpose]);
      if (existing) return { probe: publicProbe(existing), replayed: true };
      const state = await this.state(tx, org, now, run); requireCurrent(state.verification);
      if (state.verification.verification.check?.state !== "PASSED") throw verificationError("EMAIL_VERIFICATION_CHECK_REQUIRED", "Complete the current provider configuration check before preparing a controlled probe.");
      const recipient = input.purpose === "DELIVERY" ? run.delivery_recipient : run.failure_recipient;
      await assertNoUnresolvedProbe(tx, org, recipient);
      const lead = await new LeadsRepository(tx).createLead({ organization_id: org, name: "Controlled email verification: " + input.purpose, email: recipient, source: "SYSTEM_VERIFICATION", source_metadata: { verification_id: id, purpose: input.purpose } });
      const copy = probeCopy(run, input.purpose);
      const action = await new ActionsRepository(tx).createAction({ organization_id: org, lead_id: lead.id, type: "SEND_EMAIL", payload: { subject: copy.subject, message: copy.body }, idempotency_key: "email-verification:" + id + ":" + input.purpose,
        status: "AWAITING_APPROVAL", approval_requirement: "REQUIRED", execution_mode: "LIVE", provider: "sendgrid" });
      const revision = await new PreparedActionService(tx, { now: () => now }).prepare(action);
      const probe = { id: createId("email_probe"), organization_id: org, verification_id: id, purpose: input.purpose, request_key: key, request_hash: requestHash, lead_id: lead.id, action_id: action.id, revision_id: revision.id, content_hash: revision.content_hash, created_at: new Date(now).toISOString(), created_by: input.actor.id };
      await insert(tx, "email_verification_probes", probe);
      await audit(tx, org, id, "EmailVerificationProbePrepared", "A fixed controlled probe is awaiting ordinary exact review and approval.");
      return { probe: publicProbe(probe), replayed: false };
    });
  }
}

export async function currentEmailVerificationInTransaction(tx, { organization_id: org, configuration, runtime, now = Date.now, run = null }) {
  assertWorkspaceTransaction(tx, org);
  const repository = new EmailVerificationRepository(tx), time = await repository.time(org, now());
  const configured = runtimeConfigured(runtime), configHash = emailConnectionHash(configuration), runtimeHash = fingerprint(runtime);
  run ||= configured ? await repository.current(org, configuration, runtime) : null;
  if (!run) return { current: false, available: false, verification: null, hold_reasons: [configured ? "EMAIL_VERIFICATION_REQUIRED" : "EMAIL_VERIFICATION_RECIPIENTS_REQUIRED"] };
  const connection = await new EmailConnectionService(tx, { publicOrigin: runtime?.publicOrigin || "http://localhost", now: () => time }).state(tx, org);
  const managed = connection.snapshot.management === "MANAGED" && connection.snapshot.configuration.complete && connection.snapshot.routing.provisioned && !connection.routeProblem && emailConnectionHash(connection.config) === configHash;
  await repository.assertRun(run);
  const current = configured && managed && run.organization_id === org && run.config_fingerprint === configHash && run.runtime_fingerprint === runtimeHash && run.connection_revision === configuration.connection_revision;
  return describeRun(repository, run, time, current);
}
async function describeRun(repository, run, time, current) {
  const org = run.organization_id;
  const check = publicVerificationCheck(await repository.latestCheck(org, run.id), time), probes = await repository.probes(org, run.id), milestones = await repository.milestones(run);
  const available = current && check?.state === "PASSED" && milestones.every(m => m.status === "RECORDED");
  const status = !current ? "STALE" : available ? "VERIFIED" : !check ? "UNVERIFIED" : check.state === "RUNNING" ? "CHECKING" : check.state !== "PASSED" ? "CHECK_" + check.state : probes.length < 2 ? "AWAITING_PROBES" : "AWAITING_EVIDENCE";
  const verification = { id: run.id, connection_revision: run.connection_revision, created_at: run.created_at, reason: run.reason, status, current, live_send_available: available,
    check, probes: probes.map(publicProbe), milestones, can_check: current && check?.state !== "RUNNING" && (!check || check.number < 100), can_probe: { DELIVERY: current && check?.state === "PASSED" && !probes.some(p => p.purpose === "DELIVERY"), FAILURE: current && check?.state === "PASSED" && !probes.some(p => p.purpose === "FAILURE") },
    instructions: { reply: probeCopy(run, "DELIVERY").reply, stop: probeCopy(run, "DELIVERY").stop, recipient: run.delivery_recipient, reply_to: run.reply_to } };
  return { current, available, verification, run, hold_reasons: available ? [] : [!current ? "EMAIL_VERIFICATION_CONFIG_STALE" : check?.state !== "PASSED" ? "EMAIL_VERIFICATION_CHECK_REQUIRED" : "EMAIL_VERIFICATION_EVIDENCE_REQUIRED"] };
}
export async function assertNoUnresolvedProbe(tx, org, recipient, excludeAction = null) {
  const row = await tx.get("SELECT p.id FROM email_verification_probes p JOIN email_verification_runs r ON r.organization_id=p.organization_id AND r.id=p.verification_id JOIN action_executions e ON e.action_id=p.action_id WHERE p.organization_id=? AND (CASE WHEN p.purpose='DELIVERY' THEN r.delivery_recipient ELSE r.failure_recipient END)=? AND (? IS NULL OR p.action_id<>?) AND (e.outcome_class IS NULL OR e.outcome_class NOT IN ('RETRYABLE_FAILURE','PERMANENT_FAILURE','DELIVERED','DELIVERY_FAILED')) LIMIT 1", [org, recipient, excludeAction, excludeAction]);
  if (row) throw verificationError("EMAIL_VERIFICATION_PRIOR_UNRESOLVED", "A prior controlled probe to this mailbox has unresolved send authority. Reconcile it before preparing another.");
}
async function requireRun(repository, org, id) { const run = await repository.run(org, id); if (!run) throw verificationError("EMAIL_VERIFICATION_NOT_FOUND", "Verification run not found.", 404); return repository.assertRun(run); }
function requireCurrent(state) { if (!state.current) throw verificationError("EMAIL_VERIFICATION_CONFIG_STALE", "This verification run belongs to earlier email configuration or controlled recipients."); }
function sameIntent(row, hash) { if (row.request_hash !== hash) throw verificationError("EMAIL_VERIFICATION_REQUEST_CONFLICT", "This request key records a different verification command."); }
async function insert(tx, table, row) { const keys = Object.keys(row); await tx.run("INSERT INTO " + table + "(" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(row)); }
async function audit(tx, org, id, type, message) { await new AuditRepository(tx).record({ organization_id: org, event_type: type, message, metadata: { verification_id: id } }); }
