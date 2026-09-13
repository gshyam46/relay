import { createHash, randomUUID } from "node:crypto";
import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { createId } from "../../shared/ids.js";

const KINDS = new Set(["EXECUTION_CALLBACK", "SENDGRID_EVENT", "INBOUND_MESSAGE"]);
const VERIFICATIONS = new Set(["SIGNED_PROVIDER", "TRUSTED_INTERNAL", "LOCAL_TEST"]);
const TERMINAL = new Set(["PROCESSED", "DISMISSED"]);
const OWNERS = new WeakMap();
const DEFAULTS = Object.freeze({ maxAttempts: 5, retryWindowMs: 86400000, leaseMs: 60000, baseRetryMs: 5000, maxRetryMs: 300000 });
const SAFE_ERRORS = new Set(["AMBIGUOUS_REPLY_LIMIT", "AMBIGUOUS_REPLY_STATE_INVALID", "POLICY_EFFECT_PENDING", "CALLBACK_INPUT_INVALID", "CALLBACK_IDENTITY_CONFLICT", "CALLBACK_EXECUTION_NOT_FOUND", "CALLBACK_IMMUTABLE_COPY_UNAVAILABLE", "CALLBACK_IMMUTABLE_COPY_INVALID", "CALLBACK_MESSAGE_IDENTITY_CONFLICT", "CALLBACK_TIMING_INVALID", "INBOUND_CLASSIFICATION_REQUIRED", "INBOUND_EVENT_TYPE_INVALID", "INBOUND_IDENTITY_CONFLICT", "INBOUND_IDENTITY_AMBIGUOUS", "INBOUND_IDENTITY_INVALID", "INBOUND_IDENTITY_MISSING", "INBOUND_INPUT_INVALID", "INBOUND_SENDER_INVALID", "INBOUND_SENDER_CONFLICT", "INBOUND_ENVELOPE_INVALID", "INBOUND_CONTENT_TOO_LARGE", "INBOUND_LEAD_NOT_FOUND", "SENDGRID_EVENT_INVALID", "SENDGRID_EVENT_ID_INVALID", "LEGACY_REVIEW_REQUIRED", "MISSING_IMMUTABLE_TASK_COPY", "MISSING_MESSAGE_ID", "AMBIGUOUS_MESSAGE_ID",
  "AMBIGUOUS_CONTACT", "CORRELATION_REVIEW_REQUIRED", "INVALID_EVENT", "INVALID_INBOUND_IDENTITY", "RECEIPT_IDENTITY_CONFLICT",
  "INBOX_CLAIM_LOST", "UNSUPPORTED_EVENT", "MISSING_IMMUTABLE_REVISION", "CHANNEL_MESSAGE_CONFLICT",
  "INVALID_RECEIPT_PAYLOAD", "MISSING_SENDER", "AMBIGUOUS_SENDER", "INVALID_MESSAGE_ID", "INVALID_RECIPIENT"]);

export class WebhookInboxService {
  constructor({ db, contactPolicyService = null, handlers = {}, policyHandlers = {}, now = Date.now, random = Math.random, policy = {} }) {
    this.db = db;
    this.contactPolicyService = contactPolicyService || new ContactPolicyService(db);
    this.handlers = handlers;
    this.policyHandlers = policyHandlers;
    this.now = now;
    this.random = random;
    this.owner = randomUUID();
    this.policy = { ...DEFAULTS, ...policy };
    for (const key of Object.keys(DEFAULTS)) if (!Number.isSafeInteger(this.policy[key]) || this.policy[key] < 1) throw new TypeError("Invalid inbox policy.");
    if (this.policy.maxAttempts > 100 || this.policy.baseRetryMs > this.policy.maxRetryMs) throw new TypeError("Invalid inbox policy.");
    this.accepting = true;
    this.operations = new Set();
  }

  stopAccepting() { this.accepting = false; }
  async drain() { while (this.operations.size) await Promise.allSettled([...this.operations]); }
  async tracked(work) {
    if (!this.accepting) throw inboxError("INBOX_DRAINING", "Event processing is stopping.", 503);
    const operation = work();
    this.operations.add(operation);
    try { return await operation; } finally { this.operations.delete(operation); }
  }

  async receiveAndProcess(command, { throwOnProcessingError = true, onInsertedInTransaction } = {}) {
    return this.tracked(async () => {
      const received = await this.receive(command, { onInsertedInTransaction });
      const processed = await this.processOne(received.row.organization_id, received.row.id);
      if (processed.error && throwOnProcessingError) throw processed.error;
      if (received.conflict && throwOnProcessingError) throw inboxError("RECEIPT_IDENTITY_CONFLICT", "Event identity conflicts with its original content.", 409);
      return { receipt: this.summary(processed.row), duplicate: received.duplicate, result: processed.result || null };
    });
  }

  async receive(command, { onInsertedInTransaction } = {}) {
    for (const [key, max] of [["organization_id", 256], ["provider", 80], ["connection_key", 200], ["provider_event_id", 4096]]) textField(command[key], key, max);
    if (!KINDS.has(command.event_kind) || !VERIFICATIONS.has(command.verification_kind)) throw inboxError("INVALID_RECEIPT_INPUT", "Invalid event source.", 400);
    const normalized = canonicalJson(command.input);
    if (Buffer.byteLength(normalized, "utf8") > 256 * 1024) throw inboxError("RECEIPT_TOO_LARGE", "Normalized event exceeds the supported size.", 413);
    const payloadHash = digest(normalized);
    const tuple = [command.organization_id, command.provider, command.connection_key, command.event_kind, command.provider_event_id];
    const identityHash = digest(JSON.stringify(tuple));
    return this.contactPolicyService.withWorkspacePolicyTransaction(command.organization_id, async (tx) => {
      const existing = await tx.get("SELECT * FROM webhook_receipts WHERE identity_hash = ?", [identityHash]);
      if (existing) {
        const sameTuple = JSON.stringify(identityTuple(existing)) === JSON.stringify(tuple);
        if (sameTuple && existing.payload_hash === payloadHash && existing.normalization_version === 1) {
          return { row: existing, duplicate: true, conflict: false };
        }
        const conflictId = "conflict:" + digest(JSON.stringify([identityHash, payloadHash]));
        const conflictTuple = [...tuple.slice(0, 4), conflictId];
        const conflictHash = digest(JSON.stringify(conflictTuple));
        let conflict = await tx.get("SELECT * FROM webhook_receipts WHERE identity_hash = ?", [conflictHash]);
        if (!conflict) {
          conflict = await this.insert(tx, { ...command, provider_event_id: conflictId }, normalized, payloadHash, conflictHash);
          await tx.run("UPDATE webhook_receipts SET processing_state = 'QUARANTINED', mandatory_policy_status = 'PENDING', quarantined_reason = 'RECEIPT_IDENTITY_CONFLICT', last_error_code = 'RECEIPT_IDENTITY_CONFLICT' WHERE id = ?", [conflict.id]);
          conflict = await tx.get("SELECT * FROM webhook_receipts WHERE id = ?", [conflict.id]);
          await new AuditRepository(tx).record({ organization_id: command.organization_id, event_type: "WebhookReceiptConflict",
            message: "A provider event identity was reused with different content; the original input was preserved.",
            metadata: { receipt_id: existing.id, conflict_receipt_id: conflict.id } });
        }
        return { row: conflict, duplicate: true, conflict: true };
      }
      const row = await this.insert(tx, command, normalized, payloadHash, identityHash);
      if (onInsertedInTransaction) await onInsertedInTransaction(tx, row);
      return { row, duplicate: false, conflict: false };
    });
  }

  async insert(tx, command, normalized, payloadHash, identityHash) {
    const now = iso(this.time()), id = createId("whr");
    await tx.run("INSERT INTO webhook_receipts (id,organization_id,provider,connection_key,provider_event_id,event_kind,normalization_version,normalized_input_json,payload_hash,identity_hash,verification_kind,received_at,updated_at,max_attempts) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?)",
      [id, command.organization_id, command.provider, command.connection_key, command.provider_event_id, command.event_kind,
        normalized, payloadHash, identityHash, command.verification_kind, now, now, this.policy.maxAttempts]);
    return tx.get("SELECT * FROM webhook_receipts WHERE id = ?", [id]);
  }

  async processReceipt({ organization_id, receipt_id }) {
    return this.tracked(async () => {
      const result = await this.processOne(organization_id, receipt_id);
      return { receipt: this.summary(result.row), result: result.result || null };
    });
  }

  async processOne(organizationId, receiptId) {
    const claim = await this.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
      const row = await this.get(tx, organizationId, receiptId);
      const pendingConflictPolicy = row.quarantined_reason === "RECEIPT_IDENTITY_CONFLICT" && row.mandatory_policy_status === "PENDING";
      if (!this.accepting || TERMINAL.has(row.processing_state) || (row.processing_state === "QUARANTINED" && !pendingConflictPolicy)) return { row };
      const now = this.time();
      const lease = instant(row.lease_expires_at);
      if (row.processing_state === "PROCESSING" && lease !== null && lease > now) return { row };
      const due = instant(row.next_attempt_at);
      if (row.next_attempt_at && due === null) return { row: await quarantine(tx, row, "INVALID_RECEIPT_TIME", now) };
      if (due !== null && due > now) return { row };
      const first = row.first_processing_at ? instant(row.first_processing_at) : now;
      const deadline = row.retry_deadline_at ? instant(row.retry_deadline_at) : now + this.policy.retryWindowMs;
      if (first === null || deadline === null || !row.normalized_input_json) return { row: await quarantine(tx, row, "INVALID_RECEIPT_PAYLOAD", now) };
      if (row.attempts >= row.max_attempts || now >= deadline) return { row: await quarantine(tx, row, "PROCESSING_BUDGET_EXHAUSTED", now) };
      if (digest(row.normalized_input_json) !== row.payload_hash) return { row: await quarantine(tx, row, "INVALID_RECEIPT_PAYLOAD", now) };
      await tx.run("UPDATE webhook_receipts SET processing_state='PROCESSING', attempts=attempts+1, first_processing_at=?, retry_deadline_at=?, next_attempt_at=NULL, lease_owner=?, lease_expires_at=?, processing_fence=processing_fence+1, updated_at=? WHERE id=?",
        [iso(first), iso(deadline), this.owner, iso(now + this.policy.leaseMs), iso(now), row.id]);
      const owned = await this.get(tx, organizationId, receiptId);
      return { row: owned, owned };
    });
    if (!claim.owned) return { row: claim.row };
    const receipt = claim.owned;
    OWNERS.set(receipt, { now: () => this.time() });
    try {
      if (receipt.quarantined_reason === "RECEIPT_IDENTITY_CONFLICT") {
        await this.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
          await assertReceiptOwnership(tx, receipt);
          const policyHandler = this.policyHandlers[receipt.event_kind];
          if (policyHandler) await policyHandler(tx, JSON.parse(receipt.normalized_input_json), { receipt });
          else if (receipt.event_kind !== "EXECUTION_CALLBACK") throw inboxError("POLICY_EFFECT_PENDING", "Contact policy processing is unavailable.", 503);
          await tx.run("UPDATE webhook_receipts SET mandatory_policy_status='DONE' WHERE id=?", [receipt.id]);
        });
        throw inboxError("RECEIPT_IDENTITY_CONFLICT", "Conflicting content was retained for review; only required contact policy was applied.", 409);
      }
      const handler = this.handlers instanceof Map ? this.handlers.get(receipt.event_kind) : this.handlers[receipt.event_kind];
      if (!handler) throw inboxError("UNSUPPORTED_EVENT", "No processor is configured for this event.", 400);
      const input = JSON.parse(receipt.normalized_input_json);
      const result = await handler(input, { receipt });
      const row = await this.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
        const current = await this.get(tx, organizationId, receiptId);
        if (current.processing_state === "PROCESSED" && current.processing_fence === receipt.processing_fence) return current;
        await markReceiptProcessedInTransaction(tx, receipt);
        return this.get(tx, organizationId, receiptId);
      });
      return { row, result };
    } catch (error) {
      const safe = processingError(error);
      const row = await this.contactPolicyService.withWorkspacePolicyTransaction(organizationId, async (tx) => {
        const current = await this.get(tx, organizationId, receiptId);
        const now = this.time();
        const leaseExpiry = instant(current.lease_expires_at);
        if (!sameOwner(current, receipt) || current.processing_state !== "PROCESSING" || leaseExpiry === null || leaseExpiry <= now) return current;
        const deadline = instant(current.retry_deadline_at);
        const draw = this.random();
        if (!Number.isFinite(draw) || draw < 0 || draw > 1) throw new TypeError("Invalid inbox jitter.");
        const retryDelay = Math.ceil(Math.min(this.policy.maxRetryMs, this.policy.baseRetryMs * 2 ** Math.min(current.attempts - 1, 30)) * (0.5 + draw / 2));
        const next = now + retryDelay;
        const exhausted = current.attempts >= current.max_attempts || deadline === null || next >= deadline;
        const review = safe.statusCode < 500 || exhausted;
        const code = exhausted ? "PROCESSING_BUDGET_EXHAUSTED" : safe.code;
        await tx.run("UPDATE webhook_receipts SET processing_state=?, next_attempt_at=?, lease_owner=NULL, lease_expires_at=NULL, last_error_code=?, quarantined_reason=?, updated_at=? WHERE id=?",
          [review ? "QUARANTINED" : "RETRY_PENDING", review ? null : iso(next), code, current.quarantined_reason === "RECEIPT_IDENTITY_CONFLICT" ? "RECEIPT_IDENTITY_CONFLICT" : review ? code : null, iso(now), receipt.id]);
        await new AuditRepository(tx).record({ organization_id: organizationId, event_type: "WebhookProcessingDeferred",
          message: review ? "Received event requires review." : "Received event is waiting for a bounded processing retry.",
          metadata: { receipt_id: receipt.id, code, attempt: current.attempts } });
        return this.get(tx, organizationId, receiptId);
      });
      return { row, error: safe };
    } finally { OWNERS.delete(receipt); }
  }

  async processDue({ organization_id = null, limit = 25 } = {}) {
    return this.tracked(async () => {
      const bound = bounded(limit, 100), now = iso(this.time());
      const scope = organization_id === null ? "" : " AND organization_id = ?";
      const params = [now, now, ...(organization_id === null ? [] : [organization_id]), bound];
      const rows = await this.db.all("SELECT id,organization_id FROM webhook_receipts WHERE (((processing_state IN ('RECEIVED','RETRY_PENDING') OR (processing_state='QUARANTINED' AND quarantined_reason='RECEIPT_IDENTITY_CONFLICT' AND mandatory_policy_status='PENDING')) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (processing_state='PROCESSING' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))" + scope + " ORDER BY received_at,id LIMIT ?", params);
      const items = [];
      for (const row of rows) {
        if (!this.accepting) break;
        const processed = await this.processOne(row.organization_id, row.id);
        items.push(this.summary(processed.row));
      }
      return { items };
    });
  }

  async inspect({ organization_id, receipt_id }) {
    const row = await this.get(this.db, organization_id, receipt_id);
    const reviews = await this.db.all("SELECT * FROM webhook_receipt_reviews WHERE organization_id=? AND receipt_id=? ORDER BY created_at,id", [organization_id, receipt_id]);
    return { ...this.summary(row), preview: preview(row), reviews };
  }

  async list({ organization_id, state = "ACTIVE", limit = 25, offset = 0 }) {
    textField(organization_id, "organization_id", 256);
    const states = ["ACTIVE","ALL","RECEIVED","PROCESSING","RETRY_PENDING","QUARANTINED","PROCESSED","DISMISSED"];
    if (!states.includes(state)) throw inboxError("INVALID_RECEIPT_FILTER", "Invalid event filter.", 400);
    bounded(limit, 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw inboxError("INVALID_RECEIPT_OFFSET", "Invalid event page.", 400);
    const filter = state === "ACTIVE" ? " AND processing_state NOT IN ('PROCESSED','DISMISSED')" : state === "ALL" ? "" : " AND processing_state=?";
    const parameters = [organization_id, ...(states.includes(state) && !["ACTIVE","ALL"].includes(state) ? [state] : [])];
    const count = await this.db.get("SELECT COUNT(*) AS total FROM webhook_receipts WHERE organization_id=?" + filter, parameters);
    const rows = await this.db.all("SELECT * FROM webhook_receipts WHERE organization_id=?" + filter + " ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?", [...parameters, limit, offset]);
    return { items: rows.map((row) => this.summary(row)), total: Number(count.total), offset, limit, has_more: offset + rows.length < Number(count.total) };
  }

  async review({ organization_id, receipt_id, expected_fence, decision, evidence_note, reviewer_user_id }) {
    textField(reviewer_user_id, "reviewer_user_id", 256);
    const evidence = textField(evidence_note, "evidence_note", 2000);
    if (!Number.isSafeInteger(expected_fence) || expected_fence < 0 || !["RETRY","CLOSE"].includes(decision)) throw inboxError("INVALID_RECEIPT_REVIEW", "Invalid event review.", 400);
    return this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async (tx) => {
      let row = await this.get(tx, organization_id, receipt_id);
      const existing = await tx.get("SELECT * FROM webhook_receipt_reviews WHERE receipt_id=? AND expected_fence=? AND organization_id=?", [receipt_id, expected_fence, organization_id]);
      if (existing) {
        if (existing.decision !== decision || existing.evidence_note !== evidence || existing.reviewer_user_id !== reviewer_user_id) throw inboxError("RECEIPT_REVIEW_CONFLICT", "This event already has a different review.", 409);
        return { ...this.summary(row), duplicate: true };
      }
      if (row.processing_fence !== expected_fence) throw inboxError("STALE_RECEIPT_REVIEW", "The event changed. Refresh before reviewing.", 409);
      if (!["QUARANTINED","RETRY_PENDING"].includes(row.processing_state)) throw inboxError("RECEIPT_NOT_REVIEWABLE", "This event cannot be reviewed in its current state.", 409);
      const now = this.time();
      const deadline = row.retry_deadline_at ? instant(row.retry_deadline_at) : now + this.policy.retryWindowMs;
      if (decision === "CLOSE" && row.mandatory_policy_status !== "DONE") throw inboxError("POLICY_EFFECT_PENDING", "Required contact restrictions must finish before closure.", 409);
      if (decision === "RETRY" && (!row.normalized_input_json || row.attempts >= row.max_attempts || deadline === null || deadline <= now || row.quarantined_reason === "RECEIPT_IDENTITY_CONFLICT")) throw inboxError("RECEIPT_RETRY_UNAVAILABLE", "This event cannot be retried without further investigation.", 409);
      const id = createId("whrev");
      await tx.run("INSERT INTO webhook_receipt_reviews (id,organization_id,receipt_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [id, organization_id, receipt_id, expected_fence, decision, evidence, reviewer_user_id, iso(now)]);
      await tx.run("UPDATE webhook_receipts SET processing_state=?, processing_fence=processing_fence+1, next_attempt_at=?, lease_owner=NULL, lease_expires_at=NULL, processed_at=?, updated_at=? WHERE id=?",
        [decision === "CLOSE" ? "DISMISSED" : "RETRY_PENDING", decision === "RETRY" ? iso(now) : null, decision === "CLOSE" ? iso(now) : null, iso(now), receipt_id]);
      await new AuditRepository(tx).record({ organization_id, event_type: "WebhookReceiptReviewed",
        message: decision === "CLOSE" ? "Owner closed event processing with recorded evidence." : "Owner queued the same event for a bounded processing retry.",
        metadata: { receipt_id, review_id: id, decision, reviewer_user_id } });
      row = await this.get(tx, organization_id, receipt_id);
      return { ...this.summary(row), duplicate: false };
    });
  }

  async purgeProcessedPayloads({ limit = 25 } = {}) {
    return this.tracked(async () => {
      const cutoff = iso(this.time() - 30 * 86400000);
      const rows = await this.db.all("SELECT id,organization_id FROM webhook_receipts WHERE processing_state IN ('PROCESSED','DISMISSED') AND normalized_input_json IS NOT NULL AND processed_at <= ? ORDER BY processed_at,id LIMIT ?", [cutoff, bounded(limit, 100)]);
      let purged = 0;
      for (const candidate of rows) {
        if (!this.accepting) break;
        purged += await this.contactPolicyService.withWorkspacePolicyTransaction(candidate.organization_id, async (tx) => {
          const result = await tx.run("UPDATE webhook_receipts SET normalized_input_json=NULL,payload_purged_at=?,updated_at=? WHERE id=? AND processing_state IN ('PROCESSED','DISMISSED') AND normalized_input_json IS NOT NULL AND processed_at <= ?", [iso(this.time()), iso(this.time()), candidate.id, cutoff]);
          return result.changes;
        });
      }
      return { purged };
    });
  }

  async get(db, organizationId, receiptId) {
    const row = await db.get("SELECT * FROM webhook_receipts WHERE id=? AND organization_id=?", [receiptId, organizationId]);
    if (!row) throw inboxError("RECEIPT_NOT_FOUND", "Received event not found.", 404);
    return row;
  }
  time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) throw new TypeError("Invalid inbox clock.");
    return value;
  }
  summary(row) {
    const now = this.time(), deadline = instant(row.retry_deadline_at);
    return { id: row.id, organization_id: row.organization_id, provider: row.provider, connection_key: row.connection_key,
      provider_event_id: row.provider_event_id, event_kind: row.event_kind, verification_kind: row.verification_kind,
      received_at: row.received_at, updated_at: row.updated_at, processing_state: row.processing_state,
      mandatory_policy_status: row.mandatory_policy_status, attempts: row.attempts, max_attempts: row.max_attempts,
      processing_fence: row.processing_fence, first_processing_at: row.first_processing_at, retry_deadline_at: row.retry_deadline_at,
      next_attempt_at: row.next_attempt_at, last_error_code: row.last_error_code, quarantined_reason: row.quarantined_reason,
      processed_at: row.processed_at, payload_purged_at: row.payload_purged_at,
      can_retry: ["QUARANTINED","RETRY_PENDING"].includes(row.processing_state) && !!row.normalized_input_json && row.attempts < row.max_attempts
        && (!row.retry_deadline_at || (deadline !== null && deadline > now)) && row.quarantined_reason !== "RECEIPT_IDENTITY_CONFLICT",
      can_close: ["QUARANTINED","RETRY_PENDING"].includes(row.processing_state) && row.mandatory_policy_status === "DONE" };
  }
}

export async function assertReceiptOwnership(tx, receipt) {
  if (!receipt || !OWNERS.has(receipt)) throw inboxError("INBOX_CLAIM_LOST", "Event processing ownership is no longer valid.", 503);
  assertWorkspaceTransaction(tx, receipt.organization_id);
  const row = await tx.get("SELECT * FROM webhook_receipts WHERE id=? AND organization_id=?", [receipt.id, receipt.organization_id]);
  const now = OWNERS.get(receipt).now(), expiry = instant(row?.lease_expires_at);
  if (!row || !sameOwner(row, receipt) || row.processing_state !== "PROCESSING" || expiry === null || expiry <= now) {
    throw inboxError("INBOX_CLAIM_LOST", "Event processing ownership changed or expired.", 503);
  }
  return row;
}
export async function markReceiptProcessedInTransaction(tx, receipt) {
  const row = await assertReceiptOwnership(tx, receipt);
  if (row.mandatory_policy_status !== "DONE") throw inboxError("POLICY_EFFECT_PENDING", "Required contact policy processing is incomplete.", 503);
  const now = iso(OWNERS.get(receipt).now());
  await tx.run("UPDATE webhook_receipts SET processing_state='PROCESSED',processed_at=?,updated_at=?,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,quarantined_reason=NULL WHERE id=?", [now, now, row.id]);
}

export function inboxError(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
export function canonicalJson(input) {
  function visit(value, depth = 0) {
    if (depth > 24) throw inboxError("INVALID_RECEIPT_INPUT", "Event nesting exceeds the supported limit.", 400);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, visit(value[key], depth + 1)]));
    }
    throw inboxError("INVALID_RECEIPT_INPUT", "Event input must be bounded JSON data.", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw inboxError("INVALID_RECEIPT_INPUT", "Event input must be an object.", 400);
  return JSON.stringify(visit(input));
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function identityTuple(row) { return [row.organization_id, row.provider, row.connection_key, row.event_kind, row.provider_event_id]; }
function sameOwner(a, b) { return a.processing_fence === b.processing_fence && a.lease_owner === b.lease_owner; }
function iso(value) { return new Date(value).toISOString(); }
function instant(value) { const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) && iso(parsed) === value ? parsed : null; }
function bounded(value, max) { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw inboxError("INVALID_RECEIPT_LIMIT", "Invalid event batch size.", 400); return value; }
function textField(value, label, max) { if (typeof value !== "string" || !value.trim() || value.length > max) throw inboxError("INVALID_RECEIPT_INPUT", label + " must contain bounded text.", 400); return value.trim(); }
async function quarantine(tx, row, code, now) {
  await tx.run("UPDATE webhook_receipts SET processing_state='QUARANTINED',quarantined_reason=?,last_error_code=?,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", [code, code, iso(now), row.id]);
  return tx.get("SELECT * FROM webhook_receipts WHERE id=?", [row.id]);
}
function processingError(error) {
  const status = Number(error?.statusCode);
  const permanent = status >= 400 && status < 500;
  const code = SAFE_ERRORS.has(error?.code) ? error.code : permanent ? (status === 404 ? "CORRELATION_REVIEW_REQUIRED" : status === 409 ? "EVENT_CONFLICT" : "EVENT_VALIDATION_FAILED") : "EVENT_PROCESSING_FAILED";
  return inboxError(code, permanent ? "Received event requires review before it can be processed." : "Received event processing is incomplete and will retry within its limits.", permanent ? status : 503);
}
function preview(row) {
  if (!row.normalized_input_json) return null;
  try {
    const input = JSON.parse(row.normalized_input_json), payload = input.payload || input;
    return { event: typeof input.event === "string" ? input.event.slice(0, 100) : null,
      action_id: typeof input.action_id === "string" ? input.action_id.slice(0, 200) : typeof input.relay_action_id === "string" ? input.relay_action_id.slice(0, 200) : null,
      subject: typeof payload.subject === "string" ? payload.subject.slice(0, 300) : null,
      text: typeof payload.text === "string" ? payload.text.slice(0, 1000) : null };
  } catch { return null; }
}
