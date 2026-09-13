import { assertLeadActive } from "../data-foundation/leadDataSafety.js";
import { channelForActionType } from "../channels/channelContract.js";
import { SEND_ACTION_TYPES } from "../outbound-automation/preparedActionContract.js";
import { ActionsRepository } from "../outbound-automation/actionsRepository.js";
import { ApprovalsRepository } from "../outbound-automation/approvalsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { WorkflowsRepository } from "./workflowsRepository.js";
import { OPEN_RUN_STATUSES, validateCampaignInput, validateSequenceInput, scheduleInstant, workflowError } from "./workflowContract.js";
import { instantMs } from "../outbound-automation/dispatchPolicy.js";

export class WorkflowsService {
  constructor({ workflowsRepository, contactPolicyService = null, now = Date.now }) {
    this.workflowsRepository = workflowsRepository;
    this.db = workflowsRepository.db;
    this.contactPolicyService = contactPolicyService || new ContactPolicyService(this.db);
    this.now = now;
  }
  timestamp() { return new Date(this.now()).toISOString(); }
  transaction(org, work) { return this.contactPolicyService.withWorkspacePolicyTransaction(org, work); }

  async createCampaign({ organization_id, name, objective = null }) {
    requireNoErrors(validateCampaignInput({ name, objective }));
    return this.transaction(organization_id, async tx => {
      const campaign = await new WorkflowsRepository(tx).createCampaign({ organization_id, name, objective });
      await new AuditRepository(tx).record({ organization_id, event_type: "CampaignCreated", message: "Campaign created.", metadata: { campaign_id: campaign.id } });
      return { campaign };
    });
  }
  async listCampaigns({ organization_id }) { return { campaigns: await this.workflowsRepository.listCampaigns(organization_id) }; }
  async createSequence({ organization_id, campaign_id, name, stop_on_reply = true, steps }) {
    requireNoErrors(validateSequenceInput({ name, stop_on_reply, steps }));
    return this.transaction(organization_id, async tx => {
      const repo = new WorkflowsRepository(tx);
      const campaign = await repo.getCampaignForOrganization(campaign_id, organization_id);
      if (!campaign) throw workflowError("CAMPAIGN_NOT_FOUND", "Campaign not found for workspace.", 404);
      if (campaign.status !== "ACTIVE") throw workflowError("CAMPAIGN_INACTIVE", "Only active campaigns can create sequences.");
      const sequence = await repo.createSequence({ organization_id, campaign_id, name, stop_on_reply,
        steps: steps.map(step => ({ ...step, requires_approval: SEND_ACTION_TYPES.has(step.type),
          channel: step.channel || channelForActionType(step.type) })) });
      await new AuditRepository(tx).record({ organization_id, event_type: "SequenceCreated", message: "Sequence created.", metadata: { campaign_id, sequence_id: sequence.id, step_count: steps.length } });
      return { sequence };
    });
  }
  async listSequences({ organization_id }) { return { sequences: await this.workflowsRepository.listSequences(organization_id) }; }
  async enrollLeads({ organization_id, sequence_id, lead_ids, scheduled_at = null }) {
    if (!Array.isArray(lead_ids) || !lead_ids.length || lead_ids.length > 200 || lead_ids.some(id => typeof id !== "string" || !id || id.length > 256)) {
      throw workflowError("INVALID_ENROLLMENT", "Select 1 to 200 valid leads.", 400);
    }
    const timestamp = this.timestamp();
    const nextRunAt = scheduled_at === null ? timestamp : scheduleInstant(scheduled_at);
    return this.transaction(organization_id, async tx => {
      const repo = new WorkflowsRepository(tx);
      const sequence = await repo.getSequenceForOrganization(sequence_id, organization_id);
      if (!sequence) throw workflowError("SEQUENCE_NOT_FOUND", "Sequence not found for workspace.", 404);
      const campaign = await repo.getCampaignForOrganization(sequence.campaign_id, organization_id);
      if (sequence.status !== "ACTIVE" || campaign?.status !== "ACTIVE") throw workflowError("SEQUENCE_INACTIVE", "Only active sequences and campaigns can enroll leads.");
      const leads = [];
      for (const id of new Set(lead_ids)) {
        const lead = await tx.get("SELECT * FROM leads WHERE id = ? AND organization_id = ?", [id, organization_id]);
        if (!lead) throw workflowError("LEAD_NOT_FOUND", "Lead not found for workspace.", 404);
        assertLeadActive(lead);
        leads.push(lead);
      }
      const workflow_runs = [];
      for (const lead of leads) {
        const key = "sequence:" + sequence.id + ":lead:" + lead.id + ":v1";
        const existing = await repo.getRunByIdempotencyKey(organization_id, key);
        if (existing) { workflow_runs.push(existing); continue; }
        const run = await repo.enrollLead({ organization_id, campaign_id: sequence.campaign_id, sequence_id, lead_id: lead.id,
          idempotency_key: key, next_run_at: nextRunAt, timestamp });
        await new AuditRepository(tx).record({ organization_id, lead_id: lead.id, event_type: "WorkflowEnrolled",
          message: "Lead enrolled with a persisted schedule.", metadata: { workflow_run_id: run.id, scheduled_at: nextRunAt } });
        workflow_runs.push(run);
      }
      return { workflow_runs };
    });
  }
  async listRuns({ organization_id, status = null }) {
    return { workflow_runs: await this.workflowsRepository.listRuns(organization_id, { status }) };
  }
  async runDue({ organization_id, due_at = this.timestamp(), limit = 25 }) {
    const dueAt = scheduleInstant(due_at);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw workflowError("INVALID_WORKFLOW_LIMIT", "limit must be between 1 and 100.", 400);
    const due = await this.workflowsRepository.dueRuns(organization_id, dueAt, limit);
    const processed_runs = [];
    for (const run of due) processed_runs.push(await this.processRun(run, dueAt));
    return { processed_runs };
  }
  async stopOpenRunsForLead({ organization_id, lead_id, reason }) {
    return this.transaction(organization_id, tx => new WorkflowsRepository(tx).stopOpenForLead(organization_id, lead_id, reason));
  }

  async controlRun({ organization_id, run_id, expected_revision, command, reason, actor }) {
    if (!Number.isSafeInteger(expected_revision) || expected_revision < 0 || !["PAUSE", "RESUME", "STOP"].includes(command)
      || typeof reason !== "string" || !reason.trim() || reason.trim().length > 2000
      || typeof actor !== "string" || !actor.trim() || actor.length > 256) {
      throw workflowError("INVALID_WORKFLOW_CONTROL", "A valid revision, command, actor and reason (1 to 2000 characters) are required.", 400);
    }
    return this.transaction(organization_id, async tx => {
      const repo = new WorkflowsRepository(tx);
      const run = await repo.getRunForOrganization(run_id, organization_id);
      if (!run) throw workflowError("WORKFLOW_NOT_FOUND", "Workflow run not found.", 404);
      if (Number(run.revision) !== expected_revision) throw workflowError("WORKFLOW_REVISION_STALE", "This run changed. Refresh before applying a decision.");
      if (!OPEN_RUN_STATUSES.has(run.status)) throw workflowError("WORKFLOW_TERMINAL", "Completed, stopped or blocked runs cannot be reopened.");
      if (command !== "STOP" && (Number(run.processing_version) !== 1 || run.scheduler_hold_reason)) {
        throw workflowError("WORKFLOW_HELD", "This run needs operational review; controls cannot clear its hold.");
      }
      if ((command === "PAUSE" && run.paused_at) || (command === "RESUME" && !run.paused_at)) {
        throw workflowError("WORKFLOW_CONTROL_STALE", "This run is already in the requested state.");
      }
      if (command !== "STOP") assertLeadActive(await tx.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [organization_id, run.lead_id]));
      const timestamp = this.timestamp();
      const patch = command === "STOP" ? { status: "STOPPED", stop_reason: reason.trim(), next_run_at: null }
        : command === "PAUSE" ? { paused_at: timestamp, pause_reason: reason.trim() } : { paused_at: null, pause_reason: null };
      const workflow_run = await repo.advanceRun(run, patch, timestamp);
      if (command === "STOP") await repo.cancelQueuedActions(run, timestamp);
      await new AuditRepository(tx).record({ organization_id, lead_id: run.lead_id, event_type: "WorkflowControlled",
        message: "Owner changed workflow scheduling state.", metadata: { workflow_run_id: run.id, command, reason: reason.trim(), actor,
          expected_revision, revision: workflow_run.revision } });
      return { workflow_run };
    });
  }

  async processRun(candidate, dueAt = this.timestamp()) {
    dueAt = scheduleInstant(dueAt);
    return this.transaction(candidate.organization_id, async tx => {
      const repo = new WorkflowsRepository(tx), actions = new ActionsRepository(tx), audit = new AuditRepository(tx);
      const run = await repo.getRunForOrganization(candidate.id, candidate.organization_id);
      if (!run) throw workflowError("WORKFLOW_NOT_FOUND", "Workflow run not found.", 404);
      if (!OPEN_RUN_STATUSES.has(run.status) || run.paused_at || run.scheduler_hold_reason || Number(run.processing_version) !== 1) return run;
      const transition = async patch => {
        const result = await repo.advanceRun(run, patch, dueAt);
        if (["STOPPED", "BLOCKED"].includes(patch.status)) await repo.cancelQueuedActions(run, dueAt);
        await audit.record({ organization_id: run.organization_id, lead_id: run.lead_id, action_id: result.last_action_id,
          event_type: "WorkflowAdvanced", message: "Workflow step state updated.", metadata: { workflow_run_id: run.id,
            previous_revision: run.revision, revision: result.revision, status: result.status, step_order: result.current_step_order,
            reason: result.stop_reason } });
        return result;
      };
      const block = reason => transition({ status: "BLOCKED", next_run_at: null, stop_reason: reason });
      const sequence = await repo.getSequenceForOrganization(run.sequence_id, run.organization_id);
      const campaign = await repo.getCampaignForOrganization(run.campaign_id, run.organization_id);
      if (!sequence || !campaign || sequence.campaign_id !== campaign.id) return block("INVALID_WORKFLOW_PARENT");
      if (sequence.status !== "ACTIVE" || campaign.status !== "ACTIVE") return run;
      const lead = await tx.get("SELECT * FROM leads WHERE id = ? AND organization_id = ?", [run.lead_id, run.organization_id]);
      if (!lead) return block("WORKFLOW_LEAD_MISSING");
      if (lead.archived_at) return transition({ status: "STOPPED", next_run_at: null, stop_reason: "LEAD_ARCHIVED" });
      if (["OPTED_OUT", "SUPPRESSED"].includes(lead.status)) return transition({ status: "STOPPED", next_run_at: null, stop_reason: "CONTACT_RESTRICTED" });
      const step = sequence.steps.find(item => item.step_order === run.current_step_order);
      if (["ACTIVE", "WAITING"].includes(run.status)) {
        if (instantMs(run.next_run_at) === null || instantMs(run.step_anchor_at) === null || run.next_run_at !== run.step_anchor_at) return block("INVALID_WORKFLOW_TIME");
        if (run.next_run_at > dueAt) return run;
        if (!step) return Number(run.current_step_order) === sequence.steps.length + 1
          ? transition({ status: "COMPLETED", next_run_at: null }) : block("WORKFLOW_STEP_MISSING");
        if (validateSequenceInput({ name: sequence.name, steps: [step] }).length) return block("INVALID_WORKFLOW_STEP");
        if (step.type === "WAIT") {
          const next = plusHours(run.step_anchor_at, step.delay_hours);
          return transition({ status: "WAITING", current_step_order: run.current_step_order + 1, next_run_at: next, step_anchor_at: next });
        }
        if (SEND_ACTION_TYPES.has(step.type)) {
          const policy = await this.contactPolicyService.inspectLeadInTransaction(tx, {
            organization_id: run.organization_id, lead_id: run.lead_id, channel: channelForActionType(step.type) });
          if (policy.restricted) return transition({ status: "STOPPED", next_run_at: null, stop_reason: "CONTACT_RESTRICTED" });
          if (policy.policy_pending) return run;
        }
        const send = SEND_ACTION_TYPES.has(step.type);
        const action = await actions.createAction({ organization_id: run.organization_id, lead_id: run.lead_id, type: step.type,
          workflow_run_id: run.id, sequence_step_id: step.id, status: send ? "AWAITING_APPROVAL" : "PLANNED",
          approval_requirement: send ? "REQUIRED" : "NOT_REQUIRED", scheduled_at: run.next_run_at,
          idempotency_key: "workflow-run:" + run.id + ":step:" + step.id + ":action:v1",
          payload: { source: "SEQUENCE", campaign_id: run.campaign_id, sequence_id: run.sequence_id, workflow_run_id: run.id,
            sequence_step_id: step.id, title: step.title, subject: step.title, message: step.body || step.title,
            channel: channelForActionType(step.type), mock_behavior: step.payload.mock_behavior || "SUCCESS" } });
        if (send) await new ApprovalsRepository(tx).createPendingForAction(action, { requested_reason: "Review this sequence step before dispatch." });
        return transition({ status: send ? "WAITING_APPROVAL" : "WAITING_EXECUTION", next_run_at: null, last_action_id: action.id });
      }
      if (step && validateSequenceInput({ name: sequence.name, steps: [step] }).length) return block("INVALID_WORKFLOW_STEP");
      const action = run.last_action_id && await actions.getActionForOrganization(run.last_action_id, run.organization_id);
      if (!step || !action || action.workflow_run_id !== run.id || action.sequence_step_id !== step.id
        || action.lead_id !== run.lead_id || action.type !== step.type) return block("WORKFLOW_ACTION_LINK_INVALID");
      if (["BLOCKED", "FAILED"].includes(action.status)) return block("WORKFLOW_ACTION_FAILED_OR_REJECTED");
      if (action.status === "AWAITING_APPROVAL") return run.status === "WAITING_APPROVAL" ? run : transition({ status: "WAITING_APPROVAL" });
      if (action.status === "EXECUTING") {
        const current = action.active_execution_id && await tx.get("SELECT id FROM action_executions WHERE id = ? AND action_id = ? AND fence_token = ?",
          [action.active_execution_id, action.id, action.execution_fence]);
        if (!current) return block("WORKFLOW_EXECUTION_LINK_INVALID");
      }
      if (action.status !== "COMPLETED") {
        if (!["PLANNED", "APPROVED", "RETRYING", "EXECUTING"].includes(action.status)) return block("WORKFLOW_ACTION_STATE_INVALID");
        return run.status === "WAITING_EXECUTION" ? run : transition({ status: "WAITING_EXECUTION" });
      }
      const execution = action.active_execution_id && await tx.get("SELECT * FROM action_executions WHERE id = ? AND action_id = ?",
        [action.active_execution_id, action.id]);
      if (!execution || execution.outcome_class !== "DELIVERED" || execution.status !== "COMPLETED"
        || Number(execution.fence_token) !== Number(action.execution_fence)
        || (SEND_ACTION_TYPES.has(action.type) && (!execution.action_revision_id || execution.action_revision_id !== action.current_revision_id))) {
        return block("WORKFLOW_COMPLETION_UNCONFIRMED");
      }
      const completedAt = execution.outcome_at || execution.completed_at;
      if (instantMs(completedAt) === null || completedAt > dueAt) return block("WORKFLOW_COMPLETION_TIME_INVALID");
      const next = plusHours(completedAt, step.delay_hours);
      return transition({ status: "WAITING", current_step_order: run.current_step_order + 1, next_run_at: next, step_anchor_at: next });
    });
  }
}
function requireNoErrors(errors) { if (errors.length) throw workflowError("INVALID_WORKFLOW_INPUT", errors.join(" "), 400); }
function plusHours(timestamp, hours) { return new Date(Date.parse(timestamp) + Number(hours || 0) * 3600000).toISOString(); }
