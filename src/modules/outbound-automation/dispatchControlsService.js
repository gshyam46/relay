import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { validInstantSql } from "./actionsRepository.js";
import { SEND_ACTION_TYPES } from "./preparedActionContract.js";
import { currentTime, instantMs, iso } from "./dispatchPolicy.js";

const SEND_SQL = "('SEND_EMAIL','SEND_SMS','SEND_WHATSAPP','SEND_VOICE_CALL')";
const DEFAULTS = Object.freeze({ schema_version: 1, revision: 0, paused: false, daily_attempt_limit: 100, unresolved_limit: 2,
  reason: null, updated_at: null, updated_by: null });
const REASONS = {
  GLOBAL_DISPATCH_PAUSED: "Sending is paused by the application operator.",
  WORKSPACE_DISPATCH_PAUSED: "Sending is paused for this workspace.",
  DISPATCH_CONTROLS_INVALID: "Saved sending controls require operational review.",
  DAILY_DISPATCH_LIMIT: "The workspace's UTC-day send attempt limit has been reached.",
  UNRESOLVED_DISPATCH_LIMIT: "Resolve outstanding provider outcomes before authorizing more sends."
};

export class DispatchControlsService {
  constructor({ db, contactPolicyService = new ContactPolicyService(db), now = Date.now, globalEnabled }) {
    if (typeof globalEnabled !== "boolean") throw new TypeError("Dispatch enablement must be explicit boolean configuration.");
    Object.assign(this, { db, contactPolicyService, now, globalEnabled });
  }
  async inspect({ organization_id }) {
    return this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, tx => this.#inspect(tx, organization_id));
  }
  async inspectInTransaction(tx, { organization_id, action_type, authorized_at }) {
    assertWorkspaceTransaction(tx, organization_id);
    if (!SEND_ACTION_TYPES.has(action_type)) return { allowed: true, can_dispatch: true, hold_reason: null, next_eligible_at: null };
    const at = instantMs(authorized_at);
    if (at === null) throw new TypeError("Dispatch quota inspection requires the captured authorization instant.");
    const result = await this.#inspect(tx, organization_id, at);
    return { ...result, allowed: result.can_dispatch, code: result.hold_reason, reason: REASONS[result.hold_reason] || null };
  }
  async #inspect(tx, organizationId, at = currentTime(this.now)) {
    assertWorkspaceTransaction(tx, organizationId);
    const period = utcPeriod(at);
    const row = await tx.get("SELECT * FROM workspace_dispatch_controls WHERE organization_id = ?", [organizationId]);
    const valid = !row || validControls(row);
    const controls = !row ? { ...DEFAULTS } : valid ? publicControls(row) : {
      schema_version: 1, revision: integer(row.revision, 1, Number.MAX_SAFE_INTEGER) ? row.revision : null,
      paused: null, daily_attempt_limit: null, unresolved_limit: null, reason: null, updated_at: null, updated_by: null
    };
    const usage = await usageFor(tx, organizationId, period);
    const hold_reason = !this.globalEnabled ? "GLOBAL_DISPATCH_PAUSED" : !valid ? "DISPATCH_CONTROLS_INVALID"
      : controls.paused ? "WORKSPACE_DISPATCH_PAUSED"
      : usage.attempts_used >= controls.daily_attempt_limit ? "DAILY_DISPATCH_LIMIT"
      : usage.unresolved_used >= controls.unresolved_limit ? "UNRESOLVED_DISPATCH_LIMIT" : null;
    return { controls, global_enabled: this.globalEnabled, policy_valid: valid,
      usage: { utc_day: period.start.slice(0, 10), resets_at: period.end, ...usage,
        attempts_remaining: valid ? Math.max(0, controls.daily_attempt_limit - usage.attempts_used) : 0,
        unresolved_remaining: valid ? Math.max(0, controls.unresolved_limit - usage.unresolved_used) : 0 },
      can_dispatch: !hold_reason, hold_reason, next_eligible_at: hold_reason === "DAILY_DISPATCH_LIMIT" ? period.end : null };
  }
  async update({ organization_id, expected_revision, paused, daily_attempt_limit, unresolved_limit, reason, actor }) {
    if (!integer(expected_revision, 0, Number.MAX_SAFE_INTEGER - 1) || typeof paused !== "boolean"
      || !integer(daily_attempt_limit, 1, 1000) || !integer(unresolved_limit, 1, 10)
      || !boundedText(reason, 2000) || !boundedText(actor, 256)) {
      throw controlsError("INVALID_DISPATCH_CONTROLS", "Supply the current revision, valid sending limits, pause choice and a reason (1 to 2000 characters).", 400);
    }
    return this.contactPolicyService.withWorkspacePolicyTransaction(organization_id, async tx => {
      const owner = await tx.get("SELECT id FROM users WHERE id = ? AND organization_id = ? AND role = 'OWNER'", [actor, organization_id]);
      if (!owner) throw controlsError("DISPATCH_CONTROL_OWNER_REQUIRED", "Only a current workspace owner may change sending controls.", 403);
      const before = await tx.get("SELECT * FROM workspace_dispatch_controls WHERE organization_id = ?", [organization_id]);
      const revision = before?.revision ?? 0;
      if (revision !== expected_revision) throw controlsError("DISPATCH_CONTROLS_STALE", "Sending controls changed. Refresh them before saving again.", 409);
      const timestamp = iso(currentTime(this.now));
      if (before) {
        const result = await tx.run(`UPDATE workspace_dispatch_controls SET revision = ?, paused = ?, daily_attempt_limit = ?,
          unresolved_limit = ?, reason = ?, updated_at = ?, updated_by = ? WHERE organization_id = ? AND revision = ?`,
          [revision + 1, paused ? 1 : 0, daily_attempt_limit, unresolved_limit, reason.trim(), timestamp, actor, organization_id, revision]);
        if (result.changes !== 1) throw controlsError("DISPATCH_CONTROLS_STALE", "Sending controls changed. Refresh before saving again.", 409);
      } else {
        await tx.run(`INSERT INTO workspace_dispatch_controls
          (organization_id, revision, paused, daily_attempt_limit, unresolved_limit, reason, updated_at, updated_by)
          VALUES (?, 1, ?, ?, ?, ?, ?, ?)`, [organization_id, paused ? 1 : 0, daily_attempt_limit, unresolved_limit, reason.trim(), timestamp, actor]);
      }
      await new AuditRepository(tx).record({ organization_id, event_type: "DispatchControlsUpdated", message: "Owner updated workspace sending controls.",
        metadata: { actor, expected_revision, revision: revision + 1, paused, daily_attempt_limit, unresolved_limit, reason: reason.trim() } });
      return this.#inspect(tx, organization_id);
    });
  }

  // Queue hints only; the executor repeats this policy while holding the same
  // workspace gate used for control changes and execution INSERT.
  candidatePredicate({ actionAlias, kind, at }) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(actionAlias)) throw new TypeError("Invalid action query alias.");
    if (instantMs(at) === null) throw new TypeError("Candidate time must be canonical UTC.");
    const a = actionAlias;
    if (!this.globalEnabled) return { sql: a + ".type NOT IN " + SEND_SQL, params: [] };
    const period = utcPeriod(Date.parse(at));
    return { sql: `(${a}.type NOT IN ${SEND_SQL} OR EXISTS (SELECT 1 FROM organizations ops_org
      LEFT JOIN workspace_dispatch_controls dc ON dc.organization_id = ops_org.id
      WHERE ops_org.id = ${a}.organization_id AND (dc.organization_id IS NULL OR (${validControlsSql("dc", kind)}))
      AND COALESCE(dc.paused, 0) = 0
      AND (${dailySql("ops_org.id")}) < COALESCE(dc.daily_attempt_limit, 100)
      AND ((${unresolvedSql("ops_org.id")}) + (${legacySql("ops_org.id")})) < COALESCE(dc.unresolved_limit, 2)))`,
      params: [period.start, period.end, period.start, period.end] };
  }
}

async function usageFor(tx, org, period) {
  const attempts = await tx.get(dailySql("?"), [org, period.start, period.end, period.start, period.end]);
  const unresolved = await tx.get(unresolvedSql("?"), [org]);
  const legacy = await tx.get(legacySql("?"), [org]);
  return { attempts_used: Number(attempts.count), unresolved_used: Number(unresolved.count) + Number(legacy.count),
    legacy_unresolved: Number(legacy.count) };
}
function dailySql(org) {
  return `SELECT COUNT(*) AS count FROM action_executions de JOIN actions da ON da.id = de.action_id
    WHERE da.organization_id = ${org} AND da.type IN ${SEND_SQL}
    AND ((de.dispatch_authorized_at >= ? AND de.dispatch_authorized_at < ?)
      OR (de.dispatch_authorized_at IS NULL AND de.started_at >= ? AND de.started_at < ?))`;
}
function unresolvedSql(org) {
  return `SELECT COUNT(*) AS count FROM action_executions ue JOIN actions ua ON ua.id = ue.action_id
    WHERE ua.organization_id = ${org} AND ua.type IN ${SEND_SQL} AND ue.outcome_class IN ('DISPATCHING','UNCERTAIN')`;
}
function legacySql(org) {
  return `SELECT COUNT(*) AS count FROM actions la WHERE la.organization_id = ${org} AND la.type IN ${SEND_SQL}
    AND (la.execution_hold_reason = 'LEGACY_OUTCOME_REVIEW_REQUIRED' OR la.status = 'EXECUTING')
    AND (NOT EXISTS (SELECT 1 FROM action_executions any_e WHERE any_e.action_id = la.id)
      OR EXISTS (SELECT 1 FROM action_executions unknown_e WHERE unknown_e.action_id = la.id
        AND unknown_e.outcome_class = 'LEGACY_UNKNOWN' AND unknown_e.status <> 'COMPLETED'))
    AND NOT EXISTS (SELECT 1 FROM action_executions le WHERE le.action_id = la.id AND le.outcome_class IN ('DISPATCHING','UNCERTAIN'))
    AND NOT EXISTS (SELECT 1 FROM action_executions current_e WHERE current_e.id = la.active_execution_id
      AND current_e.action_id = la.id AND current_e.fence_token = la.execution_fence AND current_e.outcome_class <> 'LEGACY_UNKNOWN')`;
}
function validControlsSql(alias, kind) {
  return `${alias}.revision BETWEEN 1 AND 9007199254740991 AND ${alias}.paused IN (0,1)
    AND ${alias}.daily_attempt_limit BETWEEN 1 AND 1000 AND ${alias}.unresolved_limit BETWEEN 1 AND 10
    AND length(trim(${alias}.reason)) BETWEEN 1 AND 2000 AND length(${alias}.updated_by) BETWEEN 1 AND 256
    AND (${validInstantSql(alias + ".updated_at", kind)})`;
}
function publicControls(row) {
  return { schema_version: 1, revision: row.revision, paused: Boolean(row.paused), daily_attempt_limit: row.daily_attempt_limit,
    unresolved_limit: row.unresolved_limit, reason: row.reason, updated_at: row.updated_at, updated_by: row.updated_by };
}
function validControls(row) {
  return integer(row.revision, 1, Number.MAX_SAFE_INTEGER) && [0, 1].includes(row.paused)
    && integer(row.daily_attempt_limit, 1, 1000) && integer(row.unresolved_limit, 1, 10)
    && boundedText(row.reason, 2000) && boundedText(row.updated_by, 256) && instantMs(row.updated_at) !== null;
}
function boundedText(value, maximum) { return typeof value === "string" && !!value.trim() && value.trim().length <= maximum && !value.includes("\0"); }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function utcPeriod(now) {
  const start = iso(now).slice(0, 10) + "T00:00:00.000Z";
  return { start, end: iso(Date.parse(start) + 86400000) };
}
function controlsError(code, message, statusCode) { return Object.assign(new Error(message), { code, statusCode }); }
