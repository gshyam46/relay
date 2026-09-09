import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { parseJson, stringifyJson } from "../../database/database.js";
import { CAMPAIGN_STATUS, SEQUENCE_STATUS, WORKFLOW_RUN_STATUS } from "./workflowContract.js";

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

  async enrollLead({ organization_id, campaign_id, sequence_id, lead_id, idempotency_key, next_run_at = nowIso() }) {
    const existing = await this.getRunByIdempotencyKey(organization_id, idempotency_key);
    if (existing) {
      return existing;
    }
    const timestamp = nowIso();
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
      completed_at: null
    };
    await this.db.run(
      `INSERT INTO workflow_runs
          (id, organization_id, campaign_id, sequence_id, lead_id, status, current_step_order, next_run_at,
           last_action_id, stop_reason, idempotency_key, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        run.completed_at
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
      `SELECT wr.*, l.name AS lead_name, l.company AS lead_company, c.name AS campaign_name, s.name AS sequence_name
       FROM workflow_runs wr
       JOIN leads l ON l.id = wr.lead_id
       JOIN campaigns c ON c.id = wr.campaign_id
       JOIN sequences s ON s.id = wr.sequence_id
       WHERE wr.organization_id = ? ${statusClause}
       ORDER BY wr.updated_at DESC`,
      params
    );
  }

  async dueRuns(organizationId, dueAt, limit = 25) {
    return await this.db.all(
      `SELECT * FROM workflow_runs
       WHERE organization_id = ?
         AND (
           (status IN ('ACTIVE', 'WAITING') AND next_run_at <= ?)
           OR status = 'WAITING_APPROVAL'
         )
       ORDER BY next_run_at ASC, created_at ASC
       LIMIT ?`,
      [organizationId, dueAt, limit]
    );
  }

  async advanceRun(run, { status, current_step_order, next_run_at = null, last_action_id = null, stop_reason = null }) {
    await this.db.run(
      `UPDATE workflow_runs
       SET status = ?, current_step_order = ?, next_run_at = ?, last_action_id = COALESCE(?, last_action_id),
           stop_reason = COALESCE(?, stop_reason), updated_at = ?, completed_at = CASE WHEN ? IN ('COMPLETED', 'STOPPED', 'BLOCKED') THEN ? ELSE completed_at END
       WHERE id = ?`,
      [
        status,
        current_step_order,
        next_run_at,
        last_action_id,
        stop_reason,
        nowIso(),
        status,
        nowIso(),
        run.id
      ]
    );
    return await this.getRunForOrganization(run.id, run.organization_id);
  }

  async stopOpenForLead(organizationId, leadId, reason) {
    await this.db.run(
      `UPDATE workflow_runs
       SET status = 'STOPPED', stop_reason = ?, updated_at = ?, completed_at = ?
       WHERE organization_id = ? AND lead_id = ? AND status IN ('ACTIVE', 'WAITING', 'WAITING_APPROVAL')`,
      [reason, nowIso(), nowIso(), organizationId, leadId]
    );
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
