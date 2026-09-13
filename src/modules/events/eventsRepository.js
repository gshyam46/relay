import { createHash } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { stringifyJson } from "../../database/database.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

const claims = new WeakMap();
const ACTIVE = new Set(["PENDING", "RETRY_PENDING", "PROCESSING"]);
const HEX = /^[a-f0-9]{64}$/;

export class EventsRepository {
  constructor(db) { this.db = db; }

  async publish({ organization_id, lead_id = null, type, payload = {} }) {
    requireText(organization_id, 256); requireText(type, 100);
    if (lead_id !== null) requireText(lead_id, 256);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw eventError("INVALID_EVENT_PAYLOAD", 400);
    const payloadJson = stringifyJson(payload);
    if (Buffer.byteLength(payloadJson, "utf8") > 256 * 1024) throw eventError("INVALID_EVENT_PAYLOAD", 400);
    const timestamp = nowIso();
    const event = { id: createId("evt"), organization_id, lead_id, type, payload_json: payloadJson,
      status: "PENDING", attempts: 0, created_at: timestamp, updated_at: timestamp, processing_version: 1,
      payload_hash: digest(payloadJson), max_attempts: 5, processing_fence: 0 };
    await this.db.run(
      "INSERT INTO domain_events (id,organization_id,lead_id,type,payload_json,status,attempts,created_at,updated_at,processing_version,payload_hash,max_attempts,processing_fence) VALUES (?,?,?,?,?,'PENDING',0,?,?,1,?,5,0)",
      [event.id, organization_id, lead_id, type, payloadJson, timestamp, timestamp, event.payload_hash]
    );
    return event;
  }

  getForOrganization(organizationId, eventId) {
    return this.db.get("SELECT * FROM domain_events WHERE organization_id=? AND id=?", [organizationId, eventId]);
  }

  async listDue({ organization_id, now, limit = 1 }) {
    requireText(organization_id, 256); bounded(limit, 100);
    const stamp = timestamp(now);
    const invalid = (column) => "(" + column + " IS NOT NULL AND NOT (" + validInstantSql(column, this.db.kind) + "))";
    return this.db.all(
      "SELECT * FROM domain_events WHERE organization_id=? AND processing_version=1 AND processing_hold_reason IS NULL AND (" +
      "(status IN ('PENDING','RETRY_PENDING') AND (next_attempt_at IS NULL OR next_attempt_at<=? OR " + invalid("next_attempt_at") +
      " OR (retry_deadline_at IS NOT NULL AND retry_deadline_at<=?) OR " + invalid("retry_deadline_at") + " OR " + invalid("first_processing_at") + "))" +
      " OR (status='PROCESSING' AND (lease_expires_at IS NULL OR lease_expires_at<=? OR " + invalid("lease_expires_at") + "))) ORDER BY created_at,id LIMIT ?",
      [organization_id, stamp, stamp, stamp, limit]
    );
  }

  // Read-only compatibility inspection. Consumers must claim before any work.
  nextPending(limit = 25, organizationId = null) {
    bounded(limit, 100);
    const scope = organizationId === null ? "" : " AND organization_id=?";
    return this.db.all("SELECT * FROM domain_events WHERE status='PENDING' AND processing_version=1 AND processing_hold_reason IS NULL" + scope + " ORDER BY created_at,id LIMIT ?",
      [...(organizationId === null ? [] : [organizationId]), limit]);
  }

  async claimInTransaction({ organization_id, event_id, owner, now, leaseMs = 120000, maxAttempts = 5, retryWindowMs = 86400000 }) {
    assertWorkspaceTransaction(this.db, organization_id);
    requireText(owner, 256); bounded(maxAttempts, 100); positiveDuration(leaseMs); positiveDuration(retryWindowMs);
    const at = instant(timestamp(now)), stamp = timestamp(now);
    const row = await this.getForOrganization(organization_id, event_id);
    if (!row || row.processing_version !== 1 || row.processing_hold_reason || !ACTIVE.has(row.status)) return null;
    const lease = instant(row.lease_expires_at);
    if (row.status === "PROCESSING" && lease !== null && lease > at) return null;
    for (const field of ["first_processing_at", "retry_deadline_at", "next_attempt_at", "lease_expires_at"]) {
      if (row[field] !== null && instant(row[field]) === null) return this.#quarantine(row, "INVALID_EVENT_TIME", stamp);
    }
    if (!Number.isSafeInteger(row.attempts) || row.attempts < 0 || !Number.isSafeInteger(row.max_attempts) || row.max_attempts < 1 || row.max_attempts > 100
      || !Number.isSafeInteger(row.processing_fence) || row.processing_fence < 0 || row.processing_fence >= Number.MAX_SAFE_INTEGER) {
      return this.#quarantine(row, "INVALID_EVENT_POLICY", stamp);
    }
    if (!validPayload(row)) return this.#quarantine(row, "INVALID_EVENT_PAYLOAD", stamp);
    const started = row.first_processing_at !== null;
    if ((row.retry_deadline_at !== null) !== started || (!started && row.attempts > 0)) return this.#quarantine(row, "INVALID_EVENT_POLICY", stamp);
    const first = started ? instant(row.first_processing_at) : at;
    const deadline = started ? instant(row.retry_deadline_at) : at + retryWindowMs;
    const maximum = started ? row.max_attempts : Math.min(row.max_attempts, maxAttempts);
    if (first > at || deadline <= first || !Number.isFinite(new Date(deadline).getTime())) return this.#quarantine(row, "INVALID_EVENT_TIME", stamp);
    if (row.attempts >= maximum || at >= deadline) return this.#quarantine(row, "EVENT_BUDGET_EXHAUSTED", stamp);
    if (row.next_attempt_at !== null && instant(row.next_attempt_at) > at) return null;
    const expiry = timestamp(at + leaseMs);
    await this.db.run("UPDATE domain_events SET status='PROCESSING',attempts=attempts+1,max_attempts=?,first_processing_at=?,retry_deadline_at=?,next_attempt_at=NULL,lease_owner=?,lease_expires_at=?,processing_fence=processing_fence+1,updated_at=? WHERE id=? AND organization_id=?",
      [maximum, timestamp(first), timestamp(deadline), owner, expiry, stamp, event_id, organization_id]);
    const claim = Object.freeze(await this.getForOrganization(organization_id, event_id));
    claims.set(claim, Object.freeze({ organization_id, event_id, owner, fence: claim.processing_fence }));
    return claim;
  }

  async assertOwnership(claim, now) {
    const identity = claims.get(claim);
    if (!identity) throw eventError("EVENT_CLAIM_REQUIRED");
    assertWorkspaceTransaction(this.db, identity.organization_id);
    const row = await this.getForOrganization(identity.organization_id, identity.event_id);
    const expiry = instant(row?.lease_expires_at), at = instant(timestamp(now));
    if (!row || row.processing_version !== 1 || row.status !== "PROCESSING" || row.processing_hold_reason
      || row.lease_owner !== identity.owner || row.processing_fence !== identity.fence || expiry === null || expiry <= at) {
      throw eventError("EVENT_CLAIM_LOST", 503);
    }
    if (!validPayload(row) || row.payload_hash !== claim.payload_hash || row.type !== claim.type || row.lead_id !== claim.lead_id) {
      throw eventError("INVALID_EVENT_PAYLOAD");
    }
    return row;
  }

  listStages(organizationId, eventId) {
    return this.db.all("SELECT * FROM domain_event_stages WHERE organization_id=? AND event_id=? ORDER BY prepared_at,id", [organizationId, eventId]);
  }

  async upsertStage(claim, { stage_key, input_fingerprint, status, artifact_type = null, artifact_id = null, now }) {
    const row = await this.assertOwnership(claim, now);
    requireText(stage_key, 100);
    if (!HEX.test(input_fingerprint) || !["PREPARED", "DONE", "SKIPPED"].includes(status)) throw eventError("INVALID_EVENT_STAGE", 400);
    if ((artifact_type === null) !== (artifact_id === null)) throw eventError("INVALID_EVENT_STAGE", 400);
    if (artifact_type !== null) { requireText(artifact_type, 100); requireText(artifact_id, 256); }
    const existing = await this.db.get("SELECT * FROM domain_event_stages WHERE event_id=? AND stage_key=?", [row.id, stage_key]);
    if (existing && existing.organization_id !== row.organization_id) throw eventError("EVENT_STAGE_CONFLICT");
    const sameInput = existing?.input_fingerprint === input_fingerprint;
    if (sameInput && existing.status !== "PREPARED") {
      if (status === "PREPARED" || (existing.status === status && existing.artifact_type === artifact_type && existing.artifact_id === artifact_id)) return existing;
      throw eventError("EVENT_STAGE_CONFLICT");
    }
    const stamp = timestamp(now), id = existing?.id || createId("evstage");
    const prepared = sameInput ? existing.prepared_at : stamp, completed = status === "PREPARED" ? null : stamp;
    if (existing) {
      await this.db.run("UPDATE domain_event_stages SET input_fingerprint=?,status=?,artifact_type=?,artifact_id=?,prepared_at=?,completed_at=? WHERE id=? AND organization_id=?",
        [input_fingerprint, status, artifact_type, artifact_id, prepared, completed, id, row.organization_id]);
    } else {
      await this.db.run("INSERT INTO domain_event_stages (id,organization_id,event_id,stage_key,input_fingerprint,status,artifact_type,artifact_id,prepared_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, row.organization_id, row.id, stage_key, input_fingerprint, status, artifact_type, artifact_id, prepared, completed]);
    }
    return this.db.get("SELECT * FROM domain_event_stages WHERE id=?", [id]);
  }

  async finish(claim, now) {
    const row = await this.assertOwnership(claim, now), stamp = timestamp(now);
    await this.db.run("UPDATE domain_events SET status='PROCESSED',processed_at=?,updated_at=?,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,processing_hold_reason=NULL WHERE id=? AND organization_id=?",
      [stamp, stamp, row.id, row.organization_id]);
    return this.getForOrganization(row.organization_id, row.id);
  }

  async fail(claim, { now, status = "RETRY_PENDING", next_attempt_at = null, error_code, hold_reason = null }) {
    const row = await this.assertOwnership(claim, now), stamp = timestamp(now), at = instant(stamp);
    safeCode(error_code); if (hold_reason !== null) safeCode(hold_reason);
    if (!["RETRY_PENDING", "QUARANTINED"].includes(status)) throw eventError("INVALID_EVENT_OUTCOME", 400);
    const deadline = instant(row.retry_deadline_at);
    if (status === "RETRY_PENDING") {
      const due = instant(timestamp(next_attempt_at));
      if (due <= at) throw eventError("INVALID_EVENT_TIME", 400);
      if (row.attempts >= row.max_attempts || deadline === null || due >= deadline) {
        status = "QUARANTINED"; error_code = "EVENT_BUDGET_EXHAUSTED"; hold_reason = error_code;
      } else { next_attempt_at = timestamp(due); }
    }
    if (status === "QUARANTINED") { next_attempt_at = null; hold_reason ||= error_code; }
    await this.db.run("UPDATE domain_events SET status=?,next_attempt_at=?,last_error_code=?,processing_hold_reason=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=?",
      [status, next_attempt_at, error_code, hold_reason, stamp, row.id, row.organization_id]);
    return this.getForOrganization(row.organization_id, row.id);
  }

  async markProcessed() { throw eventError("EVENT_CLAIM_REQUIRED"); }
  async markFailed() { throw eventError("EVENT_CLAIM_REQUIRED"); }

  async #quarantine(row, code, stamp) {
    await this.db.run("UPDATE domain_events SET status='QUARANTINED',processing_hold_reason=?,last_error_code=?,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=?",
      [code, code, stamp, row.id, row.organization_id]);
    return null;
  }
}

function eventError(code, statusCode = 409) { return Object.assign(new Error("Domain event processing requires valid scoped ownership and input."), { code, statusCode }); }
function requireText(value, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw eventError("INVALID_EVENT_INPUT", 400); }
function bounded(value, maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw eventError("INVALID_EVENT_INPUT", 400); }
function positiveDuration(value) { if (!Number.isSafeInteger(value) || value < 1) throw eventError("INVALID_EVENT_POLICY", 400); }
function safeCode(value) { if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value)) throw eventError("INVALID_EVENT_OUTCOME", 400); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function instant(value) { const time = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null; }
function timestamp(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())) return new Date(value).toISOString();
  if (instant(value) !== null) return value;
  throw eventError("INVALID_EVENT_TIME", 400);
}
function validPayload(row) {
  if (typeof row.payload_json !== "string" || !HEX.test(row.payload_hash) || digest(row.payload_json) !== row.payload_hash || Buffer.byteLength(row.payload_json, "utf8") > 256 * 1024) return false;
  try { const payload = JSON.parse(row.payload_json); return !!payload && typeof payload === "object" && !Array.isArray(payload); } catch { return false; }
}

// Literal internal column names only. CASE guards PostgreSQL casts on malformed input.
function validInstantSql(column, kind) {
  const digit = "[0-9]";
  const format = kind === "postgres" ? column + " ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'"
    : column + " GLOB '" + digit.repeat(4) + "-" + digit.repeat(2) + "-" + digit.repeat(2) + "T" + digit.repeat(2) + ":" + digit.repeat(2) + ":" + digit.repeat(2) + "." + digit.repeat(3) + "Z'";
  const part = (start, length) => "CAST(substr(" + column + "," + start + "," + length + ") AS INTEGER)";
  const year = part(1, 4), month = part(6, 2), day = part(9, 2);
  const leap = "(" + year + " % 4 = 0 AND (" + year + " % 100 <> 0 OR " + year + " % 400 = 0))";
  const days = "CASE WHEN " + month + "=2 THEN CASE WHEN " + leap + " THEN 29 ELSE 28 END WHEN " + month + " IN (4,6,9,11) THEN 30 ELSE 31 END";
  return "CASE WHEN " + format + " THEN (" + month + " BETWEEN 1 AND 12 AND " + day + " BETWEEN 1 AND (" + days + ") AND "
    + part(12, 2) + " BETWEEN 0 AND 23 AND " + part(15, 2) + " BETWEEN 0 AND 59 AND " + part(18, 2) + " BETWEEN 0 AND 59) ELSE FALSE END";
}
