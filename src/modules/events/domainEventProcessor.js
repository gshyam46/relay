import { createHash, randomUUID } from "node:crypto";
import { EventsRepository } from "./eventsRepository.js";
import { AuditRepository } from "./auditRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { createId } from "../../shared/ids.js";

const DEFAULTS = Object.freeze({ maxAttempts: 5, retryWindowMs: 86400000, leaseMs: 120000, baseRetryMs: 5000, maxRetryMs: 300000 });
const FIXED_ERRORS = new Set(["EVENT_POLICY_PENDING", "EVENT_INPUT_CHANGED", "EVENT_PIPELINE_UNAVAILABLE", "EVENT_LEAD_NOT_FOUND", "EVENT_UNSUPPORTED_TYPE",
  "EVENT_INVALID_PAYLOAD", "EVENT_GENERATION_TIMEOUT", "EVENT_GENERATION_INVALID", "EVENT_CLAIM_LOST", "EVENT_BUDGET_EXHAUSTED",
  "LEGACY_EVENT_REVIEW_REQUIRED", "EVENT_PROCESSING_FAILED",
  "LEAD_ARCHIVED", "INTELLIGENCE_CONTEXT_CHANGED", "ANALYSIS_VERSION_CHANGED", "ANALYSIS_JOB_CANCELLED", "ANALYSIS_JOB_INVALID", "ANALYSIS_PRECONDITION", "ANALYSIS_STAGE_FAILED", "ANALYSIS_DRAFT_UNAVAILABLE", "AI_PAUSED", "AI_DAILY_LIMIT", "AI_IN_FLIGHT_LIMIT", "AI_ORIGIN_STALE", "AI_INVOCATION_REPLAYED", "AI_ACCOUNTING_UNAVAILABLE", "AI_CONTEXT_REQUIRED", "AI_REQUEST_INVALID", "AI_STATE_INVALID", "AI_USAGE_INVALID"]);
const STATES = ["PENDING", "PROCESSING", "RETRY_PENDING", "QUARANTINED", "FAILED", "PROCESSED", "DISMISSED"];

export class DomainEventProcessor {
  constructor({ db, contactPolicyService = new ContactPolicyService(db), handlers = {}, now = Date.now, random = Math.random, policy = {} }) {
    this.db = db;
    this.contactPolicyService = contactPolicyService;
    this.handlers = handlers;
    this.now = now;
    this.random = random;
    this.policy = { ...DEFAULTS, ...policy };
    for (const key of Object.keys(DEFAULTS)) if (!Number.isSafeInteger(this.policy[key]) || this.policy[key] < 1) throw new TypeError("Invalid event processing policy.");
    if (this.policy.maxAttempts > 100 || this.policy.baseRetryMs > this.policy.maxRetryMs) throw new TypeError("Invalid event processing policy.");
    this.owner = randomUUID();
    this.accepting = true;
    this.operations = new Set();
  }

  stopAccepting() { this.accepting = false; }
  async drain() { while (this.operations.size) await Promise.allSettled([...this.operations]); }
  async tracked(work) {
    if (!this.accepting) throw eventError("EVENT_PROCESSOR_DRAINING", "Lead processing is stopping.", 503);
    const operation = work();
    this.operations.add(operation);
    try { return await operation; } finally { this.operations.delete(operation); }
  }
  time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw new TypeError("Invalid event clock.");
    return value;
  }
  transaction(organizationId, work) { return this.contactPolicyService.withWorkspacePolicyTransaction(organizationId, work); }

  async processDue({ organization_id, limit = 1 }) {
    return this.tracked(async () => {
      textField(organization_id, "organization_id", 256);
      bound(limit, 25);
      const rows = await new EventsRepository(this.db).listDue({ organization_id, now: this.time(), limit });
      const items = [];
      for (const row of rows) {
        if (!this.accepting) break;
        items.push(await this.processOneInternal({ organization_id, event_id: row.id }));
      }
      return { items, processed_events: items.filter((item) => item.status === "PROCESSED").map((item) => item.id) };
    });
  }
  async processOne(command) { return this.tracked(() => this.processOneInternal(command)); }

  async processOneInternal({ organization_id, event_id }) {
    const claim = await this.transaction(organization_id, (tx) => new EventsRepository(tx).claimInTransaction({
      organization_id, event_id, owner: this.owner, now: this.time(), ...this.policy
    }));
    if (!claim) return this.summary(await this.get(organization_id, event_id));
    try {
      const handler = Object.hasOwn(this.handlers, claim.type) ? this.handlers[claim.type] : null;
      if (typeof handler !== "function") throw eventError("EVENT_UNSUPPORTED_TYPE", "This event has no supported processor.", 422);
      await handler(claim, {
        transaction: (work) => this.transaction(organization_id, async (tx) => {
          await new EventsRepository(tx).assertOwnership(claim, this.time());
          const result = await work(tx);
          await new EventsRepository(tx).assertOwnership(claim, this.time());
          return result;
        }),
        stage: (tx, data) => new EventsRepository(tx).upsertStage(claim, { ...data, now: this.time() }),
        now: () => this.time()
      });
      return this.summary(await this.transaction(organization_id, async (tx) => {
        const result = await new EventsRepository(tx).finish(claim, this.time());
        if (this.time() >= instant(claim.lease_expires_at)) throw eventError("EVENT_CLAIM_LOST", "Lead processing ownership expired.");
        return result;
      }));
    } catch (error) {
      const safe = safeFailure(error);
      const delay = this.retryDelay(claim.attempts);
      let row;
      try {
        row = await this.transaction(organization_id, async (tx) => {
          const repository = new EventsRepository(tx);
          const now = this.time();
          await repository.assertOwnership(claim, now);
          const deadline = instant(claim.retry_deadline_at);
          const exhausted = claim.attempts >= claim.max_attempts || deadline === null || now + delay >= deadline;
          const status = safe.statusCode < 500 || exhausted ? "QUARANTINED" : "RETRY_PENDING";
          const code = exhausted ? "EVENT_BUDGET_EXHAUSTED" : safe.code;
          await new AuditRepository(tx).record({ organization_id, lead_id: claim.lead_id,
            event_type: "LeadProcessingDeferred", message: status === "QUARANTINED" ? "Lead processing requires review." : "Lead processing is waiting for a bounded retry.",
            metadata: { domain_event_id: claim.id, code, attempt: claim.attempts } });
          const persistedAt = this.time();
          const result = await repository.fail(claim, {
            now: persistedAt, status, next_attempt_at: status === "RETRY_PENDING" ? iso(persistedAt + delay) : null,
            error_code: code, hold_reason: status === "QUARANTINED" ? code : null
          });
          if (this.time() >= instant(claim.lease_expires_at)) throw eventError("EVENT_CLAIM_LOST", "Lead processing ownership expired.");
          return result;
        });
      } catch (persistError) {
        if (!["EVENT_CLAIM_LOST", "EVENT_CLAIM_EXPIRED"].includes(persistError.code)) throw persistError;
        row = await this.get(organization_id, event_id);
      }
      return this.summary(row);
    }
  }
  retryDelay(attempts) {
    const draw = this.random();
    if (!Number.isFinite(draw) || draw < 0 || draw > 1) throw new TypeError("Invalid event jitter.");
    return Math.ceil(Math.min(this.policy.maxRetryMs, this.policy.baseRetryMs * 2 ** Math.min(Math.max(0, attempts - 1), 30)) * (0.5 + draw / 2));
  }
  async get(organizationId, eventId, db = this.db) {
    const row = await new EventsRepository(db).getForOrganization(organizationId, eventId);
    if (!row) throw eventError("EVENT_NOT_FOUND", "Lead processing event not found.", 404);
    return row;
  }
  summary(row) {
    const reviewable = ["RETRY_PENDING", "QUARANTINED", "FAILED", "PENDING"].includes(row.status) && row.status !== "PROCESSING";
    const deadline = row.retry_deadline_at ? instant(row.retry_deadline_at) : this.time() + this.policy.retryWindowMs;
    const canRetry = ["RETRY_PENDING", "QUARANTINED"].includes(row.status) && row.processing_version === 1 &&
      Object.hasOwn(this.handlers, row.type) && typeof this.handlers[row.type] === "function" && row.attempts < row.max_attempts && deadline !== null && deadline > this.time() &&
      typeof row.payload_json === "string" && hash(row.payload_json) === row.payload_hash &&
      !["EVENT_INVALID_PAYLOAD", "INVALID_EVENT_PAYLOAD", "INVALID_EVENT_TIME", "INVALID_EVENT_POLICY", "LEGACY_EVENT_REVIEW_REQUIRED"].includes(row.processing_hold_reason);
    const fields = ["id", "organization_id", "lead_id", "lead_name", "type", "status", "processing_version", "attempts", "max_attempts",
      "next_attempt_at", "first_processing_at", "retry_deadline_at", "last_error_code", "processing_hold_reason",
      "processing_fence", "created_at", "updated_at", "processed_at"];
    return { ...Object.fromEntries(fields.map((key) => [key, row[key] ?? null])), can_retry: row.type !== "AnalysisRequested" && canRetry, can_close: row.type !== "AnalysisRequested" && reviewable };
  }
  async list({ organization_id, state = "ACTIVE", limit = 25, offset = 0 }) {
    textField(organization_id, "organization_id", 256); bound(limit, 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !["ACTIVE", "ALL", ...STATES].includes(state)) throw eventError("EVENT_INVALID_FILTER", "Invalid lead processing filter.", 400);
    const filter = " AND e.type<>'AnalysisRequested'" + (state === "ACTIVE" ? " AND e.status NOT IN ('PROCESSED','DISMISSED')" : state === "ALL" ? "" : " AND e.status=?");
    const args = [organization_id, ...(!["ACTIVE", "ALL"].includes(state) ? [state] : [])];
    const count = await this.db.get("SELECT COUNT(*) AS total FROM domain_events e WHERE e.organization_id=?" + filter, args);
    const rows = await this.db.all("SELECT e.*,l.name AS lead_name FROM domain_events e LEFT JOIN leads l ON l.id=e.lead_id AND l.organization_id=e.organization_id WHERE e.organization_id=?" + filter + " ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?", [...args, limit, offset]);
    return { items: rows.map((row) => this.summary(row)), total: Number(count.total), offset, limit, has_more: offset + rows.length < Number(count.total) };
  }
  async inspect({ organization_id, event_id }) {
    const row = await this.get(organization_id, event_id);
    const lead = row.lead_id ? await this.db.get("SELECT name FROM leads WHERE id=? AND organization_id=?", [row.lead_id, organization_id]) : null;
    const stages = await new EventsRepository(this.db).listStages(organization_id, event_id);
    const reviews = await this.db.all("SELECT id,expected_fence,decision,evidence_note,reviewer_user_id,created_at FROM domain_event_reviews WHERE organization_id=? AND event_id=? ORDER BY created_at,id", [organization_id, event_id]);
    return { ...this.summary({ ...row, lead_name: lead?.name || null }), stages, reviews };
  }
  async review({ organization_id, event_id, expected_fence, decision, evidence_note, reviewer_user_id }) {
    const note = textField(evidence_note, "evidence_note", 2000);
    textField(reviewer_user_id, "reviewer_user_id", 256);
    if (!Number.isSafeInteger(expected_fence) || expected_fence < 0 || !["RETRY", "CLOSE"].includes(decision)) throw eventError("EVENT_INVALID_REVIEW", "Invalid lead processing decision.", 400);
    return this.transaction(organization_id, async (tx) => {
      const row = await this.get(organization_id, event_id, tx);
      if (row.type === "AnalysisRequested") throw eventError("ANALYSIS_JOB_REQUIRED", "Manage this analysis through its job controls.", 409);
      const old = await tx.get("SELECT * FROM domain_event_reviews WHERE organization_id=? AND event_id=? AND expected_fence=?", [organization_id, event_id, expected_fence]);
      if (old) {
        if (old.decision !== decision || old.evidence_note !== note || old.reviewer_user_id !== reviewer_user_id) throw eventError("EVENT_REVIEW_CONFLICT", "A different decision already exists.", 409);
        return { ...this.summary(row), duplicate: true };
      }
      if (row.processing_fence !== expected_fence) throw eventError("EVENT_STALE_REVIEW", "Lead processing changed. Refresh before reviewing.", 409);
      const view = this.summary(row);
      if ((decision === "RETRY" && !view.can_retry) || (decision === "CLOSE" && !view.can_close)) throw eventError("EVENT_REVIEW_UNAVAILABLE", "This decision is not available for the event.", 409);
      const now = iso(this.time());
      await tx.run("INSERT INTO domain_event_reviews (id,organization_id,event_id,expected_fence,decision,evidence_note,reviewer_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [createId("evrev"), organization_id, event_id, expected_fence, decision, note, reviewer_user_id, now]);
      await tx.run("UPDATE domain_events SET status=?,processing_fence=processing_fence+1,next_attempt_at=?,processing_hold_reason=?,lease_owner=NULL,lease_expires_at=NULL,processed_at=?,updated_at=? WHERE organization_id=? AND id=?",
        [decision === "RETRY" ? "RETRY_PENDING" : "DISMISSED", decision === "RETRY" ? now : null, decision === "RETRY" ? null : row.processing_hold_reason, decision === "CLOSE" ? now : row.processed_at, now, organization_id, event_id]);
      await new AuditRepository(tx).record({ organization_id, lead_id: row.lead_id, event_type: "LeadProcessingReviewed",
        message: decision === "RETRY" ? "Owner queued the same lead processing event for retry." : "Owner closed lead processing with evidence.",
        metadata: { domain_event_id: event_id, decision, reviewer_user_id, review_fence: expected_fence } });
      return { ...this.summary(await this.get(organization_id, event_id, tx)), duplicate: false };
    });
  }
}

export function eventError(code, message, statusCode = 503) { return Object.assign(new Error(message), { code, statusCode }); }
export function hash(value) { return createHash("sha256").update(value).digest("hex"); }
export function inputHash(value) { return hash(canonical(value)); }
export function canonical(value, depth = 0) {
  if (depth > 32) throw eventError("EVENT_GENERATION_INVALID", "Processing input is too deeply nested.", 422);
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => canonical(item, depth + 1)).join(",") + "]";
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw eventError("EVENT_GENERATION_INVALID", "Processing input is invalid.", 422);
  return "{" + Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => JSON.stringify(key) + ":" + canonical(value[key], depth + 1)).join(",") + "}";
}
function safeFailure(error) {
  const code = FIXED_ERRORS.has(error?.code) ? error.code : "EVENT_PROCESSING_FAILED";
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503;
  return { code, statusCode: status };
}
function iso(value) { return new Date(value).toISOString(); }
function instant(value) { const n = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(n) && iso(n) === value ? n : null; }
function textField(value, name, max) { if (typeof value !== "string" || !value.trim() || value.length > max) throw eventError("EVENT_INVALID_INPUT", "Invalid " + name + ".", 400); return value.trim(); }
function bound(value, max) { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw eventError("EVENT_INVALID_LIMIT", "Invalid processing limit.", 400); }
