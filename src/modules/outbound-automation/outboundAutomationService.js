import { actionTypeForPlan, ACTION_STATUS, EXECUTABLE_ACTION_STATUSES } from "./actionContract.js";
import { composeOutboundMessage } from "./messageComposer.js";

export class OutboundAutomationService {
  constructor({
    actionsRepository,
    executionsRepository,
    callbacksRepository,
    approvalsRepository,
    approvalsService,
    nextBestActionRepository,
    actionExecutor,
    auditRepository,
    leadsRepository = null,
    inboundEventsRepository = null
  }) {
    this.actionsRepository = actionsRepository;
    this.executionsRepository = executionsRepository;
    this.callbacksRepository = callbacksRepository;
    this.approvalsRepository = approvalsRepository;
    this.approvalsService = approvalsService;
    this.nextBestActionRepository = nextBestActionRepository;
    this.actionExecutor = actionExecutor;
    this.auditRepository = auditRepository;
    this.leadsRepository = leadsRepository;
    this.inboundEventsRepository = inboundEventsRepository;
  }

  async createActionFromPlan({ organization_id, plan_id }) {
    const plan = this.nextBestActionRepository.planDetail(await this.nextBestActionRepository.getPlan(plan_id), organization_id);
    if (!plan) {
      throw httpError(404, "Next-best-action plan not found.");
    }
    if (plan.status === "BLOCKED") {
      throw httpError(409, "Blocked next-best-action plans cannot become outbound actions.");
    }
    if (plan.status !== "PLANNED") {
      throw httpError(409, "Only planned next-best-action records can become outbound actions.");
    }

    const existing = await this.actionsRepository.getByPlanId(plan.id, organization_id);
    if (existing) {
      await this.approvalsService?.requestForAction(existing, { requested_reason: plan.approval?.reason || "Human approval is required." });
      return await this.actionDetail(existing);
    }

    const actionType = actionTypeForPlan(plan);
    const composedCopy = await this.#composeCopyFor(plan, actionType, organization_id);

    const approvalRequirement = plan.approval?.requirement || "NOT_REQUIRED";
    const status = approvalRequirement === "REQUIRED" ? ACTION_STATUS.AWAITING_APPROVAL : ACTION_STATUS.PLANNED;
    const action = await this.actionsRepository.createAction({
      organization_id,
      lead_id: plan.lead_id,
      type: actionType,
      status,
      next_best_action_plan_id: plan.id,
      approval_requirement: approvalRequirement,
      idempotency_key: `next-best-action-plan:${plan.id}:outbound-action:v1`,
      payload: {
        source: "NEXT_BEST_ACTION_PLAN",
        plan_id: plan.id,
        title: plan.title,
        rationale: plan.rationale,
        // `title` and `rationale` are internal. Without an explicit subject and
        // message, the channel router falls back to `rationale` for the body —
        // which meant the conversation thread read like an audit log and a real
        // email provider would have sent our own reasoning to the lead.
        ...composedCopy,
        policy_decision: plan.policy_decision,
        approval: plan.approval,
        evidence_refs: plan.decision_evidence_refs,
        mock_behavior: "SUCCESS"
      }
    });
    await this.auditRepository?.record({
      organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "OutboundActionPrepared",
      message: "Outbound action prepared from next-best-action plan.",
      metadata: {
        plan_id: plan.id,
        action_type: action.type,
        status: action.status,
        approval_requirement: approvalRequirement
      }
    });
    await this.approvalsService?.requestForAction(action, {
      requested_reason: plan.approval?.reason || "Human approval is required."
    });
    return await this.actionDetail(action);
  }

  async executeAction({ organization_id, action_id }) {
    const action = await this.actionsRepository.getActionForOrganization(action_id, organization_id);
    if (!action) {
      throw httpError(404, "Action not found.");
    }
    if (action.status === ACTION_STATUS.AWAITING_APPROVAL) {
      throw httpError(409, "This action requires approval before execution. M5 will add approval workflow.");
    }
    if (!EXECUTABLE_ACTION_STATUSES.has(action.status)) {
      return {
        action: await this.actionDetail(action),
        execution_result: {
          action_id: action.id,
          status: action.status,
          execution: await this.executionsRepository.latestForAction(action.id),
          executable: false
        }
      };
    }
    const executionResult = await this.actionExecutor.execute(action);
    return {
      action: await this.actionDetail(await this.actionsRepository.getAction(action.id)),
      execution_result: executionResult
    };
  }

  async listForLead({ organization_id, lead_id }) {
    const actions = await this.actionsRepository.listForLeadScoped(lead_id, organization_id);
    const details = [];
    for (const action of actions) {
      details.push(await this.actionDetail(action));
    }
    return details;
  }

  /**
   * Customer-facing copy for a message-bearing action.
   *
   * Human tasks are internal, so they keep `title`/`rationale` and get nothing
   * here. Composition is grounded in the lead's own record and in their latest
   * classified reply, so the message answers what they actually said rather than
   * repeating a generic opener.
   */
  async #composeCopyFor(plan, actionType, organizationId) {
    if (!String(actionType).startsWith("SEND_")) {
      return {};
    }
    const lead = await this.leadsRepository?.getLead(plan.lead_id);
    if (!lead) {
      return {};
    }
    const organization = await this.leadsRepository?.getOrganization(organizationId);
    const replies = (await this.inboundEventsRepository?.listForLead(organizationId, plan.lead_id)) || [];
    const { subject, message } = composeOutboundMessage({
      lead,
      actionType,
      organizationName: organization?.name || null,
      replyContext: replies[0] || null
    });
    return { subject, message };
  }

  async actionDetail(action) {
    if (!action) {
      return null;
    }
    return {
      ...action,
      payload: this.actionsRepository.actionPayload(action),
      approval: await this.approvalsRepository?.getByActionId(action.id, action.organization_id) || null,
      executions: await this.executionsRepository.listForAction(action.id),
      callbacks: await this.callbacksRepository.listForAction(action.id)
    };
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
