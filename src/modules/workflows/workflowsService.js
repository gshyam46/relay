import { ACTION_STATUS } from "../outbound-automation/actionContract.js";
import { channelForActionType } from "../channels/channelContract.js";
import {
  CAMPAIGN_STATUS,
  SEQUENCE_STATUS,
  WORKFLOW_RUN_STATUS,
  validateCampaignInput,
  validateSequenceInput
} from "./workflowContract.js";
import { nowIso } from "../../shared/time.js";

export class WorkflowsService {
  constructor({ workflowsRepository, leadsRepository, actionsRepository, approvalsService, actionExecutor, auditRepository }) {
    this.workflowsRepository = workflowsRepository;
    this.leadsRepository = leadsRepository;
    this.actionsRepository = actionsRepository;
    this.approvalsService = approvalsService;
    this.actionExecutor = actionExecutor;
    this.auditRepository = auditRepository;
  }

  createCampaign({ organization_id, name, objective = null }) {
    requireNoErrors(validateCampaignInput({ name }));
    const campaign = this.workflowsRepository.createCampaign({
      organization_id,
      name,
      objective,
      status: CAMPAIGN_STATUS.ACTIVE
    });
    this.auditRepository?.record({
      organization_id,
      event_type: "CampaignCreated",
      message: "Campaign created.",
      metadata: { campaign_id: campaign.id }
    });
    return { campaign };
  }

  listCampaigns({ organization_id }) {
    return { campaigns: this.workflowsRepository.listCampaigns(organization_id) };
  }

  createSequence({ organization_id, campaign_id, name, stop_on_reply = true, steps }) {
    requireNoErrors(validateSequenceInput({ name, steps }));
    const campaign = this.workflowsRepository.getCampaignForOrganization(campaign_id, organization_id);
    if (!campaign) {
      throw notFoundError("Campaign not found for workspace.");
    }
    const sequence = this.workflowsRepository.createSequence({
      organization_id,
      campaign_id,
      name,
      status: SEQUENCE_STATUS.ACTIVE,
      stop_on_reply,
      steps: steps.map(normalizeStep)
    });
    this.auditRepository?.record({
      organization_id,
      event_type: "SequenceCreated",
      message: "Sequence created.",
      metadata: { campaign_id, sequence_id: sequence.id, step_count: sequence.steps.length }
    });
    return { sequence };
  }

  listSequences({ organization_id }) {
    return { sequences: this.workflowsRepository.listSequences(organization_id) };
  }

  enrollLeads({ organization_id, sequence_id, lead_ids }) {
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      throw validationError("lead_ids must include at least one lead.");
    }
    const sequence = this.workflowsRepository.getSequenceForOrganization(sequence_id, organization_id);
    if (!sequence) {
      throw notFoundError("Sequence not found for workspace.");
    }
    if (sequence.status !== SEQUENCE_STATUS.ACTIVE) {
      throw validationError("Only active sequences can enroll leads.");
    }
    const uniqueLeadIds = Array.from(new Set(lead_ids));
    const runs = uniqueLeadIds.map((leadId) => {
      const lead = this.leadsRepository.getLead(leadId);
      if (!lead || lead.organization_id !== organization_id) {
        throw notFoundError("Lead not found for workspace.");
      }
      if (lead.status === "OPTED_OUT" || lead.status === "SUPPRESSED") {
        return this.workflowsRepository.enrollLead({
          organization_id,
          campaign_id: sequence.campaign_id,
          sequence_id: sequence.id,
          lead_id: lead.id,
          idempotency_key: `sequence:${sequence.id}:lead:${lead.id}:v1`,
          next_run_at: nowIso()
        });
      }
      return this.workflowsRepository.enrollLead({
        organization_id,
        campaign_id: sequence.campaign_id,
        sequence_id: sequence.id,
        lead_id: lead.id,
        idempotency_key: `sequence:${sequence.id}:lead:${lead.id}:v1`,
        next_run_at: nowIso()
      });
    });
    return { workflow_runs: runs };
  }

  listRuns({ organization_id, status = null }) {
    return { workflow_runs: this.workflowsRepository.listRuns(organization_id, { status }) };
  }

  runDue({ organization_id, due_at = nowIso(), limit = 25 }) {
    const dueRuns = this.workflowsRepository.dueRuns(organization_id, due_at, limit);
    const processed = dueRuns.map((run) => this.processRun(run, due_at));
    return { processed_runs: processed };
  }

  stopOpenRunsForLead({ organization_id, lead_id, reason }) {
    this.workflowsRepository.stopOpenForLead(organization_id, lead_id, reason);
  }

  processRun(run, dueAt) {
    const lead = this.leadsRepository.getLead(run.lead_id);
    if (!lead || lead.organization_id !== run.organization_id) {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.BLOCKED,
        current_step_order: run.current_step_order,
        stop_reason: "Lead is no longer available for this workspace."
      });
    }
    if (lead.status === "OPTED_OUT" || lead.status === "SUPPRESSED") {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.STOPPED,
        current_step_order: run.current_step_order,
        stop_reason: `Lead is ${lead.status}.`
      });
    }

    if (run.status === WORKFLOW_RUN_STATUS.WAITING_APPROVAL) {
      return this.processApprovalWait(run, dueAt);
    }

    const step = this.workflowsRepository.getStepByOrder(run.sequence_id, run.organization_id, run.current_step_order);
    if (!step) {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.COMPLETED,
        current_step_order: run.current_step_order,
        stop_reason: "Sequence completed."
      });
    }
    if (step.type === "WAIT") {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.WAITING,
        current_step_order: run.current_step_order + 1,
        next_run_at: plusHoursFrom(dueAt, step.delay_hours)
      });
    }

    const approvalRequirement = step.requires_approval ? "REQUIRED" : "NOT_REQUIRED";
    const actionStatus = step.requires_approval ? ACTION_STATUS.AWAITING_APPROVAL : ACTION_STATUS.PLANNED;
    const action = this.actionsRepository.createAction({
      organization_id: run.organization_id,
      lead_id: run.lead_id,
      type: step.type,
      status: actionStatus,
      approval_requirement: approvalRequirement,
      idempotency_key: `workflow-run:${run.id}:step:${step.id}:action:v1`,
      payload: {
        source: "SEQUENCE",
        campaign_id: run.campaign_id,
        sequence_id: run.sequence_id,
        workflow_run_id: run.id,
        sequence_step_id: step.id,
        title: step.title,
        message: step.body || step.title,
        channel: step.channel || channelForActionType(step.type),
        mock_behavior: step.payload.mock_behavior || "SUCCESS"
      }
    });
    if (step.requires_approval) {
      this.approvalsService?.requestForAction(action, {
        requested_reason: "Review this sequence step before it can proceed."
      });
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.WAITING_APPROVAL,
        current_step_order: run.current_step_order,
        next_run_at: null,
        last_action_id: action.id
      });
    }

    const execution = this.actionExecutor.execute(action);
    const nextStatus = execution.status === ACTION_STATUS.BLOCKED ? WORKFLOW_RUN_STATUS.BLOCKED : WORKFLOW_RUN_STATUS.WAITING;
    return this.workflowsRepository.advanceRun(run, {
      status: nextStatus,
      current_step_order: run.current_step_order + 1,
      next_run_at: nextStatus === WORKFLOW_RUN_STATUS.BLOCKED ? null : plusHoursFrom(dueAt, step.delay_hours),
      last_action_id: action.id,
      stop_reason: nextStatus === WORKFLOW_RUN_STATUS.BLOCKED ? "Sequence step execution failed." : null
    });
  }

  processApprovalWait(run, dueAt) {
    const action = run.last_action_id ? this.actionsRepository.getActionForOrganization(run.last_action_id, run.organization_id) : null;
    if (!action) {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.BLOCKED,
        current_step_order: run.current_step_order,
        stop_reason: "Approval action is no longer available."
      });
    }
    if (action.status === ACTION_STATUS.AWAITING_APPROVAL) {
      return run;
    }
    if (action.status === ACTION_STATUS.BLOCKED || action.status === ACTION_STATUS.FAILED) {
      return this.workflowsRepository.advanceRun(run, {
        status: WORKFLOW_RUN_STATUS.BLOCKED,
        current_step_order: run.current_step_order,
        stop_reason: "Sequence step was rejected or failed."
      });
    }
    if (action.status === ACTION_STATUS.APPROVED) {
      const execution = this.actionExecutor.execute(action);
      if (execution.status === ACTION_STATUS.BLOCKED) {
        return this.workflowsRepository.advanceRun(run, {
          status: WORKFLOW_RUN_STATUS.BLOCKED,
          current_step_order: run.current_step_order,
          stop_reason: "Approved sequence step execution failed."
        });
      }
    }
    return this.workflowsRepository.advanceRun(run, {
      status: WORKFLOW_RUN_STATUS.WAITING,
      current_step_order: run.current_step_order + 1,
      next_run_at: dueAt
    });
  }
}

function normalizeStep(step) {
  return {
    type: step.type,
    channel: step.channel || null,
    title: step.title || step.type,
    body: step.body || null,
    delay_hours: Number(step.delay_hours || 0),
    requires_approval: Boolean(step.requires_approval),
    stop_on_reply: step.stop_on_reply !== false,
    payload: step.payload || {}
  };
}

function plusHoursFrom(iso, hours) {
  return new Date(new Date(iso).getTime() + Number(hours || 0) * 60 * 60 * 1000).toISOString();
}

function requireNoErrors(errors) {
  if (errors.length > 0) {
    throw validationError(errors.join(" "));
  }
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}
