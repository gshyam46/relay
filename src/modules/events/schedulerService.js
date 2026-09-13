import { activeLeadSql } from "../data-foundation/leadDataSafety.js";
import { performance } from "node:perf_hooks";
import { createId } from "../../shared/ids.js";
import { validInstantSql, workflowDispatchCandidateSql } from "../outbound-automation/actionsRepository.js";
import { workflowEligibility } from "../workflows/workflowsRepository.js";

export const SCHEDULER_PHASES = Object.freeze([
  Object.freeze({ phase: "RECEIPTS", limit: 2 }),
  Object.freeze({ phase: "EVENTS", limit: 1 }),
  Object.freeze({ phase: "WORKFLOWS", limit: 2 }),
  Object.freeze({ phase: "FOLLOW_UPS", limit: 5 }),
  Object.freeze({ phase: "DISPATCH", limit: 2 }),
  Object.freeze({ phase: "EXPIRY", limit: 2 })
]);
const RESULT_KEYS = ["processed_events", "executed_actions", "processed_runs", "due_follow_ups"];

// The scheduler owns admission only. Each phase retains its own authoritative job claims.
export class SchedulerService {
  constructor({ db, now = Date.now, monotonicNow = () => performance.now(), handlers = {}, policy = {}, dispatchControlsService = null }) {
    this.db = db;
    this.now = now;
    this.monotonicNow = monotonicNow;
    this.handlers = handlers;
    this.dispatchControlsService = dispatchControlsService;
    this.policy = {
      maxVisits: policy.maxVisits ?? 4,
      admissionBudgetMs: policy.admissionBudgetMs ?? 10000,
      leaseMs: policy.leaseMs ?? 120000
    };
    for (const [key, maximum] of [["maxVisits", 4], ["admissionBudgetMs", 10000], ["leaseMs", 120000]]) {
      if (!Number.isSafeInteger(this.policy[key]) || this.policy[key] < 1 || this.policy[key] > maximum) {
        throw new TypeError("Invalid scheduler policy.");
      }
    }
    this.accepting = true;
    this.inFlight = new Set();
  }

  runOnce({ organization_id = null } = {}) {
    if (organization_id !== null && (typeof organization_id !== "string" || !organization_id.trim() || organization_id.length > 256)) {
      return Promise.reject(new TypeError("A valid workspace is required."));
    }
    const running = this.runTick(organization_id);
    this.inFlight.add(running);
    running.then(() => this.inFlight.delete(running), () => this.inFlight.delete(running));
    return running;
  }

  stopAccepting() { this.accepting = false; }
  stop() { this.stopAccepting(); }
  async drain() { await Promise.allSettled([...this.inFlight]); }

  async runTick(organizationId) {
    const started = this.monotonicNow();
    const allowed = () => this.accepting && this.monotonicNow() - started < this.policy.admissionBudgetMs;
    const result = { visits: [], processed_events: [], executed_actions: [], processed_runs: [], due_follow_ups: [], elapsed_ms: 0, draining: !this.accepting };
    const visited = [];
    const maximum = organizationId === null ? this.policy.maxVisits : 1;
    while (visited.length < maximum && allowed()) {
      const visit = await this.reserveVisit({ organizationId, visited, allowed });
      if (!visit) break;
      visited.push(visit.organization_id);
      const outcome = { organization_id: visit.organization_id, visit_fence: visit.visit_fence, phases: [] };
      result.visits.push(outcome);
      try {
        for (let count = 0; count < SCHEDULER_PHASES.length && allowed(); count += 1) {
          const index = (visit.next_phase + count) % SCHEDULER_PHASES.length;
          if (!await this.advancePhase(visit, index, allowed)) break;
          const { phase, limit } = SCHEDULER_PHASES[index];
          const handler = this.handlers[phase];
          if (typeof handler !== "function") {
            outcome.phases.push({ phase, result: null, error_code: "SCHEDULER_HANDLER_MISSING" });
            continue;
          }
          try {
            const phaseResult = await handler({ organization_id: visit.organization_id, limit, due_at: stamp(this.now()) });
            outcome.phases.push({ phase, result: phaseResult ?? null, error_code: null });
            for (const key of RESULT_KEYS) {
              if (Array.isArray(phaseResult?.[key])) result[key].push(...phaseResult[key]);
            }
          } catch {
            // No raw exception, SQL, model response or provider credentials enter tick results.
            outcome.phases.push({ phase, result: null, error_code: "SCHEDULER_PHASE_FAILED" });
          }
        }
      } finally {
        await this.releaseVisit(visit);
      }
    }
    result.elapsed_ms = Math.max(0, Math.round(this.monotonicNow() - started));
    result.draining = !this.accepting;
    return result;
  }

  async reserveVisit({ organizationId, visited, allowed }) {
    return this.db.transaction(async (tx) => {
      const state = await tx.get("SELECT * FROM scheduler_state WHERE id='default'" + (tx.kind === "postgres" ? " FOR UPDATE" : ""));
      if (!state) throw new Error("Scheduler state is unavailable.");
      if (!allowed()) return null;
      const dueAt = stamp(this.now());
      let candidate = await eligibleWorkspace(tx, { organizationId, visited, after: state.last_organization_id, dueAt, dispatchControlsService: this.dispatchControlsService });
      if (!candidate && state.last_organization_id !== null) {
        candidate = await eligibleWorkspace(tx, { organizationId, visited, after: null, dueAt, dispatchControlsService: this.dispatchControlsService });
      }
      if (!candidate || !allowed()) return null;
      const owner = createId("visit");
      await tx.run("INSERT INTO scheduler_workspaces (organization_id) VALUES (?) ON CONFLICT (organization_id) DO NOTHING", [candidate.organization_id]);
      const previous = await tx.get("SELECT * FROM scheduler_workspaces WHERE organization_id=?", [candidate.organization_id]);
      if (!Number.isSafeInteger(previous.visit_fence) || previous.visit_fence < 0 || previous.visit_fence >= Number.MAX_SAFE_INTEGER
        || !Number.isInteger(previous.next_phase) || previous.next_phase < 0 || previous.next_phase >= SCHEDULER_PHASES.length) {
        throw new Error("Scheduler state needs operator review.");
      }
      const now = stamp(this.now());
      if (!allowed()) return null;
      await tx.run("UPDATE scheduler_workspaces SET lease_owner=?,lease_expires_at=?,visit_fence=visit_fence+1,last_served_at=? WHERE organization_id=?",
        [owner, stamp(Date.parse(now) + this.policy.leaseMs), now, candidate.organization_id]);
      await tx.run("UPDATE scheduler_state SET last_organization_id=?,updated_at=? WHERE id='default'", [candidate.organization_id, now]);
      return { organization_id: candidate.organization_id, lease_owner: owner, visit_fence: previous.visit_fence + 1, next_phase: previous.next_phase };
    }, { lockTimeoutMs: 5000 });
  }

  async advancePhase(visit, phaseIndex, allowed) {
    return this.db.transaction(async (tx) => {
      const row = await tx.get("SELECT * FROM scheduler_workspaces WHERE organization_id=?" + (tx.kind === "postgres" ? " FOR UPDATE" : ""), [visit.organization_id]);
      if (!allowed() || !owns(row, visit, this.now()) || row.next_phase !== phaseIndex) return false;
      await tx.run("UPDATE scheduler_workspaces SET next_phase=? WHERE organization_id=? AND lease_owner=? AND visit_fence=?",
        [(phaseIndex + 1) % SCHEDULER_PHASES.length, visit.organization_id, visit.lease_owner, visit.visit_fence]);
      return true;
    }, { lockTimeoutMs: 5000 });
  }

  async releaseVisit(visit) {
    await this.db.run("UPDATE scheduler_workspaces SET lease_owner=NULL,lease_expires_at=NULL WHERE organization_id=? AND lease_owner=? AND visit_fence=?",
      [visit.organization_id, visit.lease_owner, visit.visit_fence]);
  }
}

async function eligibleWorkspace(tx, { organizationId, visited, after, dueAt, dispatchControlsService }) {
  const invalid = (column) => "(" + column + " IS NOT NULL AND NOT (" + validInstantSql(column, tx.kind) + "))";
  const workflow = workflowEligibility("w", dueAt, tx.kind);
  const operations = dispatchControlsService?.candidatePredicate({ actionAlias: "a", kind: tx.kind, at: dueAt }) || { sql: "1=1", params: [] };
  const branches = [
    { from: "webhook_receipts r", org: "r.organization_id", where:
      "(((r.processing_state IN ('RECEIVED','RETRY_PENDING') OR (r.processing_state='QUARANTINED' AND r.quarantined_reason='RECEIPT_IDENTITY_CONFLICT' AND r.mandatory_policy_status='PENDING')) AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=?)) OR (r.processing_state='PROCESSING' AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=?)))", params: [dueAt, dueAt] },
    { from: "domain_events e", org: "e.organization_id", where:
      "e.processing_version=1 AND e.processing_hold_reason IS NULL AND ((e.status IN ('PENDING','RETRY_PENDING') AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=? OR " + invalid("e.next_attempt_at") + " OR (e.retry_deadline_at IS NOT NULL AND e.retry_deadline_at<=?) OR " + invalid("e.retry_deadline_at") + " OR " + invalid("e.first_processing_at") + ")) OR (e.status='PROCESSING' AND (e.lease_expires_at IS NULL OR e.lease_expires_at<=? OR " + invalid("e.lease_expires_at") + ")))", params: [dueAt, dueAt, dueAt] },
    { from: "workflow_runs w", org: "w.organization_id", where: workflow.sql, params: workflow.params },
    { from: "follow_up_tasks f", org: "f.organization_id", where: activeLeadSql("f") + " AND f.status='PLANNED' AND (f.due_at IS NULL OR f.due_at<=? OR " + invalid("f.due_at") + ")", params: [dueAt] },
    { from: "actions a", org: "a.organization_id", where:
      activeLeadSql("a") + " AND a.status IN ('PLANNED','APPROVED','RETRYING') AND a.execution_hold_reason IS NULL AND (a.scheduled_at IS NULL OR a.scheduled_at<=? OR " + invalid("a.scheduled_at") + ") AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=? OR " + invalid("a.next_attempt_at") + ")"
      + " AND NOT EXISTS (SELECT 1 FROM webhook_receipts policy WHERE policy.organization_id=a.organization_id AND policy.mandatory_policy_status='PENDING')"
      + " AND (" + workflowDispatchCandidateSql("a") + ") AND (" + operations.sql + ")", params: [dueAt, dueAt, ...operations.params] },
    { from: "action_executions x JOIN actions xa ON xa.id=x.action_id", org: "xa.organization_id", where:
      "x.outcome_class='DISPATCHING' AND (x.lease_expires_at IS NULL OR LENGTH(x.lease_expires_at)<>24 OR x.lease_expires_at<=?)", params: [dueAt] }
  ];
  const params = [], queries = [];
  for (const [index, branch] of branches.entries()) {
    let predicate = "(" + branch.where + ")";
    params.push(...branch.params);
    if (organizationId !== null) { predicate += " AND " + branch.org + "=?"; params.push(organizationId); }
    if (after !== null) { predicate += " AND " + branch.org + ">?"; params.push(after); }
    if (visited.length) { predicate += " AND " + branch.org + " NOT IN (" + visited.map(() => "?").join(",") + ")"; params.push(...visited); }
    predicate += " AND NOT EXISTS (SELECT 1 FROM scheduler_workspaces sw WHERE sw.organization_id=" + branch.org
      + " AND sw.lease_owner IS NOT NULL AND sw.lease_expires_at>? AND (" + validInstantSql("sw.lease_expires_at", tx.kind) + "))";
    params.push(dueAt);
    queries.push("candidate_" + index + " AS (SELECT " + branch.org + " AS organization_id FROM " + branch.from + " WHERE (" + predicate + ") ORDER BY " + branch.org + " LIMIT 1)");
  }
  return tx.get("WITH " + queries.join(", ") + " SELECT organization_id FROM (" + branches.map((_, index) => "SELECT organization_id FROM candidate_" + index).join(" UNION ALL ") + ") candidates ORDER BY organization_id LIMIT 1", params);
}

function stamp(value) {
  const millis = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(millis) || !Number.isSafeInteger(millis) || millis < 0) throw new TypeError("Invalid scheduler clock.");
  return new Date(millis).toISOString();
}
function owns(row, visit, now) {
  if (!row || row.lease_owner !== visit.lease_owner || row.visit_fence !== visit.visit_fence) return false;
  const expiry = Date.parse(row.lease_expires_at);
  return Number.isFinite(expiry) && new Date(expiry).toISOString() === row.lease_expires_at && expiry > Date.parse(stamp(now));
}
