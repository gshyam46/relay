import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { FreshnessRepository } from "../lead-intelligence/freshnessRepository.js";
import { canonicalJson } from "../webhook-inbox/webhookInboxService.js";
import { emailConnectionHash } from "./emailConnectionContract.js";
import { fingerprint } from "../outbound-automation/preparedActionContract.js";
import { CHECK_TTL_MS, CHECK_LEASE_MS, PROOF_KINDS, canonicalTime, invalidVerificationState, keyFingerprint, parseChecks, probeCopy, sha } from "./emailVerificationContract.js";

export class EmailVerificationRepository {
  constructor(db) { this.db = db; }
  time(org, now) { return new FreshnessRepository(this.db).effectiveTime(org, now); }
  run(org, id) { return this.db.get("SELECT * FROM email_verification_runs WHERE organization_id=? AND id=?", [org, id]); }
  byRequest(org, key) { return this.db.get("SELECT * FROM email_verification_runs WHERE organization_id=? AND request_key=?", [org, key]); }
  current(org, configuration, runtime) { return this.db.get("SELECT * FROM email_verification_runs WHERE organization_id=? AND config_fingerprint=? AND runtime_fingerprint=?", [org, emailConnectionHash(configuration), fingerprint(runtime)]); }
  latestCheck(org, id) { return this.db.get("SELECT * FROM email_verification_checks WHERE organization_id=? AND verification_id=? ORDER BY check_number DESC LIMIT 1", [org, id]); }
  probes(org, id) { return this.db.all("SELECT p.*,a.status,a.current_revision_id FROM email_verification_probes p JOIN actions a ON a.organization_id=p.organization_id AND a.id=p.action_id WHERE p.organization_id=? AND p.verification_id=? ORDER BY p.purpose", [org, id]); }
  async assertRun(run) {
    if (!run || !Number.isInteger(run.connection_revision) || run.connection_revision < 1 || run.connection_revision > 100 || !/^[0-9a-f]{64}$/.test(run.config_fingerprint) || !/^[0-9a-f]{64}$/.test(run.runtime_fingerprint) || !/^[A-Za-z0-9_-]{43}$/.test(run.nonce)) throw invalidVerificationState();
    canonicalTime(run.created_at);
    return run;
  }
  async milestones(run) {
    const rows = await this.db.all("SELECT p.*,w.processing_state,w.mandatory_policy_status,w.verification_kind,w.payload_hash AS receipt_payload_hash,w.received_at FROM email_verification_receipts p JOIN webhook_receipts w ON w.organization_id=p.organization_id AND w.id=p.receipt_id WHERE p.organization_id=? AND p.verification_id=? ORDER BY p.recorded_at,p.receipt_id LIMIT 21", [run.organization_id, run.id]);
    if (rows.length > 20) throw invalidVerificationState();
    const milestones = PROOF_KINDS.map(kind => ({ kind, status: "PENDING", receipt_id: null, recorded_at: null }));
    for (const row of rows) {
      if (row.processing_state !== "PROCESSED" || row.mandatory_policy_status !== "DONE" || row.verification_kind !== "SIGNED_PROVIDER" || row.config_fingerprint !== run.config_fingerprint || row.payload_hash !== row.receipt_payload_hash) continue;
      let proof; try { if (Buffer.byteLength(row.proof_json) > 8192) throw new Error(); proof = JSON.parse(row.proof_json); } catch { throw invalidVerificationState(); }
      const probe = await this.db.get("SELECT * FROM email_verification_probes WHERE organization_id=? AND verification_id=? AND id=?", [run.organization_id, run.id, row.probe_id]);
      if (!probe || proof.version !== 1 || proof.kind !== row.kind || proof.recipient !== (probe.purpose === "DELIVERY" ? run.delivery_recipient : run.failure_recipient)) throw invalidVerificationState();
      const execution = await executionProof(this.db, run, probe, proof.execution_id, proof.revision_id, proof.recipient);
      if (!execution || canonicalTime(row.received_at) < canonicalTime(execution.dispatch_authorized_at)) continue;
      if (["DELIVERY", "FAILURE"].includes(row.kind)) {
        if (probe.purpose !== row.kind || execution.outcome_class !== (row.kind === "DELIVERY" ? "DELIVERED" : "DELIVERY_FAILED")) continue;
        const callback = await this.db.get("SELECT id FROM callbacks WHERE organization_id=? AND webhook_receipt_id=? AND action_id=? AND action_execution_id=? AND status=? AND core_applied=1", [run.organization_id, row.receipt_id, probe.action_id, execution.id, row.kind === "DELIVERY" ? "COMPLETED" : "FAILED"]);
        if (!callback) continue;
      } else {
        if (probe.purpose !== "DELIVERY" || execution.outcome_class !== "DELIVERED") continue;
        const inbound = await this.db.get("SELECT id,event_type,effects_status FROM inbound_events WHERE organization_id=? AND webhook_receipt_id=? AND lead_id=? AND provider='sendgrid' AND channel='EMAIL'", [run.organization_id, row.receipt_id, probe.lead_id]);
        if (!inbound || inbound.effects_status !== "DONE" || (row.kind === "STOP" && inbound.event_type !== "OPT_OUT")) continue;
        const message = await this.db.get("SELECT id,body FROM channel_messages WHERE organization_id=? AND inbound_event_id=? AND lead_id=? AND direction='INBOUND'", [run.organization_id, inbound.id, probe.lead_id]);
        const expected = probeCopy(run, "DELIVERY")[row.kind === "STOP" ? "stop" : "reply"];
        if (!message || message.body?.trim() !== expected) continue;
        if (row.kind === "STOP") {
          const restriction = await this.db.get("SELECT id FROM contact_restrictions WHERE organization_id=? AND contact_kind='EMAIL' AND contact_value=? AND channel IN ('ALL','EMAIL') AND reason='OPT_OUT' AND source='INBOUND_EVENT' AND source_event_id=?", [run.organization_id, run.delivery_recipient, "inbound:" + sha(JSON.stringify(["sendgrid", proof.provider_event_id]))]);
          if (!restriction) continue;
        }
      }
      const target = milestones.find(item => item.kind === row.kind);
      if (target && target.status === "PENDING") Object.assign(target, { status: "RECORDED", receipt_id: row.receipt_id, recorded_at: row.recorded_at });
    }
    return milestones;
  }
}
export function publicVerificationCheck(row, now) {
  if (!row) return null;
  const result = parseChecks(row.checks_json), started = canonicalTime(row.started_at), lease = canonicalTime(row.lease_expires_at);
  if (lease !== started + CHECK_LEASE_MS || !Number.isInteger(row.check_number) || row.check_number < 1 || row.check_number > 100) throw invalidVerificationState();
  let status = row.state;
  if (status === "RUNNING") { if (row.finished_at || row.expires_at) throw invalidVerificationState(); if (now >= lease) status = "INTERRUPTED"; }
  else {
    const finished = canonicalTime(row.finished_at);
    if (finished < started) throw invalidVerificationState();
    if (status === "PASSED") {
      if (result.checks.some(check => check.status !== "PASS") || canonicalTime(row.expires_at) !== finished + CHECK_TTL_MS) throw invalidVerificationState();
      if (now >= Date.parse(row.expires_at)) status = "EXPIRED";
    } else if (!["FAILED", "UNKNOWN"].includes(status) || row.expires_at !== null) throw invalidVerificationState();
  }
  return { id: row.id, number: row.check_number, state: status, started_at: row.started_at, finished_at: row.finished_at, expires_at: row.expires_at, checks: result.checks };
}
export function publicProbe(row) { return row ? { id: row.id, purpose: row.purpose, lead_id: row.lead_id, action_id: row.action_id, revision_id: row.revision_id, current_revision_id: row.current_revision_id || row.revision_id, status: row.status || "AWAITING_APPROVAL", created_at: row.created_at } : null; }

async function executionProof(tx, run, probe, executionId, revisionId, recipient) {
  const row = await tx.get("SELECT e.*,r.envelope_json,r.content_hash,r.sender_config_fingerprint FROM action_executions e JOIN actions a ON a.id=e.action_id JOIN action_revisions r ON r.organization_id=a.organization_id AND r.action_id=a.id AND r.id=e.action_revision_id WHERE a.organization_id=? AND a.lead_id=? AND a.id=? AND e.id=? AND r.id=? AND e.provider IN ('sendgrid','email-sendgrid')", [run.organization_id, probe.lead_id, probe.action_id, executionId, revisionId]);
  if (!row || !row.dispatch_authorized_at || row.envelope_hash !== probe.content_hash || row.content_hash !== probe.content_hash || row.sender_config_fingerprint !== run.config_fingerprint) return null;
  let envelope; try { if (Buffer.byteLength(row.envelope_json) > 65536) return null; envelope = JSON.parse(row.envelope_json); } catch { return null; }
  const copy = probeCopy(run, probe.purpose);
  if (fingerprint(envelope) !== probe.content_hash || envelope.organization_id !== run.organization_id || envelope.action_id !== probe.action_id || envelope.recipient !== recipient || envelope.sender?.provider !== "sendgrid" || envelope.sender.reply_to !== run.reply_to || envelope.subject !== copy.subject || envelope.body !== copy.body || envelope.scheduled_at !== null) return null;
  return row;
}
function reference(input, key) { const a = input[key], b = input.custom_args?.[key]; if (a && b && a !== b) return null; const v = a || b; return typeof v === "string" && v.length <= 200 ? v : null; }

// Only the trusted ingress closure invokes this during ORIGINAL receipt insertion.
// No client capability flag, source label, or later replay may manufacture proof.
export async function recordEmailVerificationReceipt(tx, { receipt, configuration, route_token, input }) {
  const org = receipt.organization_id;
  assertWorkspaceTransaction(tx, org);
  const stored = await tx.get("SELECT * FROM webhook_receipts WHERE organization_id=? AND id=?", [org, receipt.id]);
  if (!stored) return false;
  receipt = stored;
  if (receipt.provider !== "sendgrid" || receipt.verification_kind !== "SIGNED_PROVIDER" || receipt.processing_state !== "RECEIVED" || receipt.attempts !== 0 || sha(canonicalJson(input)) !== receipt.payload_hash || typeof route_token !== "string" || route_token !== configuration.webhook_token) return false;
  const hash = emailConnectionHash(configuration), key = keyFingerprint(receipt.event_kind === "SENDGRID_EVENT" ? configuration.sendgrid_events_public_key : configuration.sendgrid_inbound_public_key);
  if (!key) return false;
  let candidates = [];
  if (receipt.event_kind === "SENDGRID_EVENT") {
    const action = reference(input, "relay_action_id");
    if (action) candidates = await tx.all("SELECT p.*,r.nonce,r.delivery_recipient,r.failure_recipient,r.reply_to,r.config_fingerprint,r.runtime_fingerprint FROM email_verification_probes p JOIN email_verification_runs r ON r.organization_id=p.organization_id AND r.id=p.verification_id WHERE p.organization_id=? AND p.action_id=? AND r.config_fingerprint=?", [org, action, hash]);
  } else if (receipt.event_kind === "INBOUND_MESSAGE" && !input.identity_error && input.provider === "sendgrid" && input.channel === "EMAIL") {
    candidates = await tx.all("SELECT p.*,r.nonce,r.delivery_recipient,r.failure_recipient,r.reply_to,r.config_fingerprint,r.runtime_fingerprint FROM email_verification_probes p JOIN email_verification_runs r ON r.organization_id=p.organization_id AND r.id=p.verification_id WHERE p.organization_id=? AND p.purpose='DELIVERY' AND r.config_fingerprint=? AND r.delivery_recipient=? LIMIT 101", [org, hash, input.contact?.email || ""]);
  }
  if (candidates.length > 100) return false;
  for (const probe of candidates) {
    const run = { ...probe, id: probe.verification_id }, recipient = probe.purpose === "DELIVERY" ? run.delivery_recipient : run.failure_recipient;
    let kind, executionId, revisionId;
    if (receipt.event_kind === "SENDGRID_EVENT") {
      kind = input.event === "delivered" ? "DELIVERY" : ["bounce", "dropped"].includes(input.event) ? "FAILURE" : null;
      if (!kind || kind !== probe.purpose || input.email?.toLowerCase() !== recipient) continue;
      executionId = reference(input, "relay_execution_id"); revisionId = reference(input, "relay_revision_id");
    } else {
      const copy = probeCopy(run, "DELIVERY"), text = input.payload?.text?.trim(), envelope = input.identity_context?.envelope;
      kind = text === copy.reply ? "REPLY" : text === copy.stop ? "STOP" : null;
      if (!kind || envelope?.from !== recipient || envelope.to?.length !== 1 || envelope.to[0] !== run.reply_to || input.contact?.email !== recipient) continue;
      const executions = await tx.all("SELECT e.id,e.action_revision_id FROM action_executions e JOIN actions a ON a.id=e.action_id WHERE a.organization_id=? AND a.id=? AND e.dispatch_authorized_at IS NOT NULL AND e.outcome_class IN ('DISPATCHING','ACCEPTED','UNCERTAIN','DELIVERED','DELIVERY_FAILED') LIMIT 2", [org, probe.action_id]);
      if (executions.length !== 1) continue;
      executionId = executions[0].id; revisionId = executions[0].action_revision_id;
    }
    const execution = await executionProof(tx, run, probe, executionId, revisionId, recipient);
    if (!execution || canonicalTime(receipt.received_at) < canonicalTime(execution.dispatch_authorized_at)) continue;
    const count = await tx.get("SELECT count(*) AS n FROM email_verification_receipts WHERE organization_id=? AND verification_id=?", [org, run.id]);
    if (Number(count.n) >= 20) return false;
    const kindCount = await tx.get("SELECT count(*) AS n FROM email_verification_receipts WHERE organization_id=? AND verification_id=? AND kind=?", [org, run.id, kind]);
    if (Number(kindCount.n) >= 5) return false;
    const proof = { version: 1, kind, recipient, execution_id: execution.id, revision_id: revisionId, provider_event_id: receipt.provider_event_id };
    await tx.run("INSERT INTO email_verification_receipts(receipt_id,organization_id,verification_id,probe_id,kind,config_fingerprint,route_token_hash,signing_key_fingerprint,payload_hash,proof_json,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt_id) DO NOTHING", [receipt.id, org, run.id, probe.id, kind, hash, sha(route_token), key, receipt.payload_hash, JSON.stringify(proof), receipt.received_at]);
    return true;
  }
  return false;
}
