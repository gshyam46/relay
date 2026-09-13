import { activeLeadSql } from "../data-foundation/leadDataSafety.js";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { validInstantSql } from "../outbound-automation/actionsRepository.js";
import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { CAMPAIGN_STATUS, SEQUENCE_STATUS, WORKFLOW_RUN_STATUS, workflowError } from "./workflowContract.js";

export class WorkflowsRepository {
  constructor(db) {
    this.db = db;
  }

  async createCampaign({ organization_id, name, objective = null, status = CAMPAIGN_STATUS.ACTIVE }) {
    const timestamp = nowIso();
    const campaign = {
      id: createId("camp"),
      organization_id,
      name: name.trim(),
      objective,
      status,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.run(
      `INSERT INTO campaigns (id, organization_id, name, objective, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [campaign.id, campaign.organization_id, campaign.name, campaign.objective, campaign.status, campaign.created_at, campaign.updated_at]
    );
    return campaign;
  }

  async listCampaigns(organizationId) {
    return await this.db.all("SELECT * FROM campaigns WHERE organization_id = ? ORDER BY created_at DESC", [organizationId]);
  }

  async getCampaignForOrganization(id, organizationId) {
    return await this.db.get("SELECT * FROM campaigns WHERE id = ? AND organization_id = ?", [id, organizationId]);
  }

  async createSequence({ organization_id, campaign_id, name, status = SEQUENCE_STATUS.ACTIVE, stop_on_reply = true, steps }) {
    const timestamp = nowIso();
    const sequence = {
      id: createId("seq"),
      organization_id,
      campaign_id,
      name: name.trim(),
      status,
      stop_on_reply: stop_on_reply ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.run(
      `INSERT INTO sequences
          (id, organization_id, campaign_id, name, status, stop_on_reply, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sequence.id,
        sequence.organization_id,
        sequence.campaign_id,
        sequence.name,
        sequence.status,
        sequence.stop_on_reply,
        sequence.created_at,
        sequence.updated_at
      ]
    );
    for (const [index, step] of steps.entries()) {
      await this.createSequenceStep(sequence, step, index + 1);
    }
    return await this.sequenceDetail(sequence);
  }

  async createSequenceStep(sequence, step, stepOrder) {
    const timestamp = nowIso();
    const row = {
      id: createId("step"),
      organization_id: sequence.organization_id,
      sequence_id: sequence.id,
      step_order: stepOrder,
      type: step.type,
      channel: step.channel || null,
      title: step.title || step.type,
      body: step.body || null,
      delay_hours: Number(step.delay_hours || 0),
      requires_approval: step.requires_approval ? 1 : 0,
      stop_on_reply: step.stop_on_reply === false ? 0 : 1,
      payload_json: stringifyJson(step.payload || {}),
      created_at: timestamp,
      updated_at: timestamp
    };
    await this.db.run(
      `INSERT INTO sequence_steps
          (id, organization_id, sequence_id, step_order, type, channel, title, body, delay_hours,
           requires_approval, stop_on_reply, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.organization_id,
        row.sequence_id,
        row.step_order,
        row.type,
        row.channel,
        row.title,
        row.body,
        row.delay_hours,
        row.requires_approval,
        row.stop_on_reply,
        row.payload_json,
        row.created_at,
        row.updated_at
      ]
    );
    return this.stepDetail(row);
  }

  async listSequences(organizationId) {
    const sequences = await this.db.all("SELECT * FROM sequences WHERE organization_id = ? ORDER BY created_at DESC", [
      organizationId
    ]);
    return Promise.all(sequences.map((sequence) => this.sequenceDetail(sequence)));
  }

  async getSequenceForOrganization(id, organizationId) {
    const sequence = await this.db.get("SELECT * FROM sequences WHERE id = ? AND organization_id = ?", [id, organizationId]);
    return sequence ? await this.sequenceDetail(sequence) : null;
  }

  async listSteps(sequenceId, organizationId) {
    const steps = await this.db.all(
      "SELECT * FROM sequence_steps WHERE sequence_id = ? AND organization_id = ? ORDER BY step_order ASC",
      [sequenceId, organizationId]
    );
    return steps.map((step) => this.stepDetail(step));
  }

  async getStepByOrder(sequenceId, organizationId, stepOrder) {
    const step = await this.db.get(
      "SELECT * FROM sequence_steps WHERE sequence_id = ? AND organization_id = ? AND step_order = ?",
      [sequenceId, organizationId, stepOrder]
    );
    return step ? this.stepDetail(step) : null;
  }

  async enrollLead({ organization_id, campaign_id, sequence_id, lead_id, idempotency_key, next_run_at = nowIso(), timestamp = nowIso() }) {
    const existing = await this.getRunByIdempotencyKey(organization_id, idempotency_key);
    if (existing) {
      return existing;
    }
    const run = {
      id: createId("run"),
      organization_id,
      campaign_id,
      sequence_id,
      lead_id,
      status: WORKFLOW_RUN_STATUS.ACTIVE,
      current_step_order: 1,
      next_run_at,
      last_action_id: null,
      stop_reason: null,
      idempotency_key,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null, revision: 0, processing_version: 1, paused_at: null, pause_reason: null,
      step_anchor_at: next_run_at, scheduler_hold_reason: null
    };
    await this.db.run(
      `INSERT INTO workflow_runs
          (id, organization_id, campaign_id, sequence_id, lead_id, status, current_step_order, next_run_at,
           last_action_id, stop_reason, idempotency_key, created_at, updated_at, completed_at, processing_version, step_anchor_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        run.id,
        run.organization_id,
        run.campaign_id,
        run.sequence_id,
        run.lead_id,
        run.status,
        run.current_step_order,
        run.next_run_at,
        run.last_action_id,
        run.stop_reason,
        run.idempotency_key,
        run.created_at,
        run.updated_at,
        run.completed_at,
        next_run_at
      ]
    );
    return run;
  }

  async getRunByIdempotencyKey(organizationId, idempotencyKey) {
    return await this.db.get("SELECT * FROM workflow_runs WHERE organization_id = ? AND idempotency_key = ?", [
      organizationId,
      idempotencyKey
    ]);
  }

  async getRunForOrganization(id, organizationId) {
    return await this.db.get("SELECT * FROM workflow_runs WHERE id = ? AND organization_id = ?", [id, organizationId]);
  }

  async listRuns(organizationId, { status = null } = {}) {
    const params = [organizationId];
    const statusClause = status ? "AND wr.status = ?" : "";
    if (status) {
      params.push(status);
    }
    return await this.db.all(
      `SELECT wr.*, l.name AS lead_name, l.company AS lead_company, c.name AS campaign_name, s.name AS sequence_name, a.status AS action_status, a.type AS action_type
       FROM workflow_runs wr
       LEFT JOIN leads l ON l.id = wr.lead_id AND l.organization_id = wr.organization_id
       LEFT JOIN campaigns c ON c.id = wr.campaign_id AND c.organization_id = wr.organization_id
       LEFT JOIN sequences s ON s.id = wr.sequence_id AND s.organization_id = wr.organization_id
       LEFT JOIN actions a ON a.id = wr.last_action_id AND a.organization_id = wr.organization_id AND a.workflow_run_id = wr.id AND a.lead_id = wr.lead_id
       WHERE wr.organization_id = ? ${statusClause}
       ORDER BY wr.updated_at DESC`,
      params
    );
  }

  async dueRuns(organizationId, dueAt, limit = 25) {
    const eligible = workflowEligibility("wr", dueAt, this.db.kind);
    return this.db.all(`SELECT wr.* FROM workflow_runs wr WHERE wr.organization_id = ? AND ${eligible.sql}
      ORDER BY COALESCE(wr.next_run_at, wr.updated_at), wr.id LIMIT ?`, [organizationId, ...eligible.params, limit]);
  }

  async advanceRun(run, patch, timestamp = nowIso()) {
    assertWorkspaceTransaction(this.db, run.organization_id);
    const next = { ...run, ...patch };
    const terminal = ["COMPLETED", "STOPPED", "BLOCKED"].includes(next.status);
    const result = await this.db.run(`UPDATE workflow_runs SET status = ?, current_step_order = ?, next_run_at = ?,
      last_action_id = ?, stop_reason = ?, step_anchor_at = ?, paused_at = ?, pause_reason = ?, scheduler_hold_reason = ?,
      revision = revision + 1, updated_at = ?, completed_at = ? WHERE id = ? AND organization_id = ? AND revision = ?`,
      [next.status, next.current_step_order, next.next_run_at, next.last_action_id, next.stop_reason, next.step_anchor_at,
        next.paused_at, next.pause_reason, next.scheduler_hold_reason, timestamp, terminal ? timestamp : run.completed_at,
        run.id, run.organization_id, run.revision]);
    if (result.changes !== 1) throw workflowError("WORKFLOW_REVISION_STALE", "This run changed. Refresh before applying a decision.");
    return this.getRunForOrganization(run.id, run.organization_id);
  }

  async cancelQueuedActions(run, timestamp = nowIso()) {
    assertWorkspaceTransaction(this.db, run.organization_id);
    await this.db.run(`UPDATE actions SET status = 'BLOCKED', execution_hold_reason = 'WORKFLOW_STOPPED',
      next_attempt_at = NULL, last_error = 'Workflow stopped before dispatch.', updated_at = ?
      WHERE organization_id = ? AND workflow_run_id = ? AND lead_id = ?
      AND status IN ('PLANNED', 'AWAITING_APPROVAL', 'APPROVED', 'RETRYING')`,
      [timestamp, run.organization_id, run.id, run.lead_id]);
  }

  async stopOpenForLead(organizationId, leadId, reason) {
    if (!this.db.transactionBound) return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(organizationId,
      tx => new WorkflowsRepository(tx).stopOpenForLead(organizationId, leadId, reason));
    assertWorkspaceTransaction(this.db, organizationId);
    const rows = await this.db.all(`SELECT * FROM workflow_runs WHERE organization_id = ? AND lead_id = ?
      AND status IN ('ACTIVE', 'WAITING', 'WAITING_APPROVAL', 'WAITING_EXECUTION')`, [organizationId, leadId]);
    const timestamp = nowIso();
    for (const run of rows) {
      await this.advanceRun(run, { status: "STOPPED", next_run_at: null, stop_reason: reason }, timestamp);
      await this.cancelQueuedActions(run, timestamp);
    }
  }

  async sequenceDetail(sequence) {
    const steps = await this.listSteps(sequence.id, sequence.organization_id);
    return {
      ...sequence,
      stop_on_reply: Boolean(sequence.stop_on_reply),
      steps
    };
  }

  stepDetail(step) {
    return {
      ...step,
      delay_hours: Number(step.delay_hours),
      requires_approval: Boolean(step.requires_approval),
      stop_on_reply: Boolean(step.stop_on_reply),
      payload: parseJson(step.payload_json) || {}
    };
  }
}

// Shared with the fair scheduler: unchanged approval/accepted/uncertain waits do not consume turns.
export function workflowEligibility(alias, dueAt, kind) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new TypeError("Invalid workflow query alias.");
  const w = alias;
  const validParents = `EXISTS (SELECT 1 FROM sequences s JOIN campaigns c ON c.id = s.campaign_id
    AND c.organization_id = s.organization_id WHERE s.id = ${w}.sequence_id AND s.organization_id = ${w}.organization_id
    AND s.campaign_id = ${w}.campaign_id AND s.status = 'ACTIVE' AND c.status = 'ACTIVE')`;
  const missingParents = `NOT EXISTS (SELECT 1 FROM sequences s JOIN campaigns c ON c.id = s.campaign_id
    AND c.organization_id = s.organization_id WHERE s.id = ${w}.sequence_id AND s.organization_id = ${w}.organization_id
    AND s.campaign_id = ${w}.campaign_id)`;
  const linked = `SELECT 1 FROM actions a JOIN sequence_steps ss ON ss.id = a.sequence_step_id
    AND ss.sequence_id = ${w}.sequence_id AND ss.organization_id = ${w}.organization_id
    AND ss.step_order = ${w}.current_step_order AND ss.type = a.type
    WHERE a.id = ${w}.last_action_id AND a.workflow_run_id = ${w}.id AND a.organization_id = ${w}.organization_id AND a.lead_id = ${w}.lead_id`;
  return { sql: `(${w}.processing_version = 1 AND ${w}.paused_at IS NULL AND ${w}.scheduler_hold_reason IS NULL
    AND ${activeLeadSql(w)} AND (${validParents} OR ${missingParents}) AND (
      (${w}.status IN ('ACTIVE','WAITING') AND (${w}.next_run_at IS NULL OR ${w}.next_run_at <= ? OR NOT (${validInstantSql(w + '.next_run_at', kind)})))
      OR (${w}.status IN ('WAITING_APPROVAL','WAITING_EXECUTION') AND (NOT EXISTS (${linked})
        OR EXISTS (${linked} AND (a.status IN ('COMPLETED','BLOCKED','FAILED')
          OR (${w}.status = 'WAITING_APPROVAL' AND a.status <> 'AWAITING_APPROVAL')
          OR (${w}.status = 'WAITING_EXECUTION' AND a.status = 'AWAITING_APPROVAL')
          OR a.status NOT IN ('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING','EXECUTING','COMPLETED','BLOCKED','FAILED')
          OR (a.status = 'EXECUTING' AND NOT EXISTS (SELECT 1 FROM action_executions e WHERE e.id = a.active_execution_id
            AND e.action_id = a.id AND e.fence_token = a.execution_fence))))))
    ))`, params: [dueAt] };
}

// Called only inside the authoritative dispatch workspace transaction, before an attempt exists.
export async function inspectWorkflowDispatch(tx, action, payload) {
  assertWorkspaceTransaction(tx, action.organization_id);
  const hinted = payload?.source === "SEQUENCE" || payload?.workflow_run_id || payload?.sequence_step_id;
  if (!action.workflow_run_id && !action.sequence_step_id && !hinted) return null;
  const invalid = { code: "WORKFLOW_LINK_INVALID", reason: "Workflow linkage requires review." };
  if (!action.workflow_run_id || !action.sequence_step_id) return { ...invalid, code: "LEGACY_WORKFLOW_REVIEW_REQUIRED" };
  const run = await new WorkflowsRepository(tx).getRunForOrganization(action.workflow_run_id, action.organization_id);
  if (!run || run.lead_id !== action.lead_id || run.last_action_id !== action.id || Number(run.processing_version) !== 1) return invalid;
  if (run.scheduler_hold_reason) return { code: "WORKFLOW_HELD", reason: "Workflow scheduling is held for review." };
  if (!["WAITING_APPROVAL", "WAITING_EXECUTION"].includes(run.status)) return { code: "WORKFLOW_STOPPED", reason: "Workflow is no longer waiting for this action." };
  const parent = await tx.get(`SELECT s.status AS sequence_status, c.status AS campaign_status FROM sequences s
    JOIN campaigns c ON c.id = s.campaign_id AND c.organization_id = s.organization_id
    JOIN sequence_steps ss ON ss.sequence_id = s.id AND ss.organization_id = s.organization_id
    WHERE s.id = ? AND s.organization_id = ? AND s.campaign_id = ? AND ss.id = ? AND ss.step_order = ? AND ss.type = ?`,
    [run.sequence_id, action.organization_id, run.campaign_id, action.sequence_step_id, run.current_step_order, action.type]);
  if (!parent) return invalid;
  if ([parent.sequence_status, parent.campaign_status].some(status => ["ARCHIVED", "DRAFT"].includes(status))) {
    return { code: "WORKFLOW_INACTIVE", reason: "The sequence or campaign is inactive." };
  }
  if (run.paused_at || parent.sequence_status === "PAUSED" || parent.campaign_status === "PAUSED") {
    return { deferred: true, code: "WORKFLOW_PAUSED", reason: "Workflow is paused." };
  }
  if (parent.sequence_status !== "ACTIVE" || parent.campaign_status !== "ACTIVE") return invalid;
  if ((payload.workflow_run_id && payload.workflow_run_id !== run.id) || (payload.sequence_step_id && payload.sequence_step_id !== action.sequence_step_id)
    || (payload.sequence_id && payload.sequence_id !== run.sequence_id) || (payload.campaign_id && payload.campaign_id !== run.campaign_id)) return invalid;
  return null;
}
