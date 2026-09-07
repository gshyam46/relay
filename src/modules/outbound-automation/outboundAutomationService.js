import { actionTypeForPlan, ACTION_STATUS, EXECUTABLE_ACTION_STATUSES } from "./actionContract.js";

export class OutboundAutomationService {
  constructor({
    actionsRepository,
    executionsRepository,
    callbacksRepository,
    approvalsRepository,
    approvalsService,
    nextBestActionRepository,
    actionExecutor,
    auditRepository
  }) {
    this.actionsRepository = actionsRepository;
    this.executionsRepository = executionsRepository;
    this.callbacksRepository = callbacksRepository;
    this.approvalsRepository = approvalsRepository;
    this.approvalsService = approvalsService;
    this.nextBestActionRepository = nextBestActionRepository;
    this.actionExecutor = actionExecutor;
    this.auditRepository = auditRepository;
  }

  createActionFromPlan({ organization_id, plan_id }) {
    const plan = this.nextBestActionRepository.planDetail(this.nextBestActionRepository.getPlan(plan_id), organization_id);
    if (!plan) {
      throw httpError(404, "Next-best-action plan not found.");
    }
    if (plan.status === "BLOCKED") {
      throw httpError(409, "Blocked next-best-action plans cannot become outbound actions.");
    }
    if (plan.status !== "PLANNED") {
      throw httpError(409, "Only planned next-best-action records can become outbound actions.");
    }

    const existing = this.actionsRepository.getByPlanId(plan.id, organization_id);
    if (existing) {
      this.approvalsService?.requestForAction(existing, { requested_reason: plan.approval?.reason || "Human approval is required." });
      return this.actionDetail(existing);
    }

    const approvalRequirement = plan.approval?.requirement || "NOT_REQUIRED";
    const status = approvalRequirement === "REQUIRED" ? ACTION_STATUS.AWAITING_APPROVAL : ACTION_STATUS.PLANNED;
    const action = this.actionsRepository.createAction({
      organization_id,
      lead_id: plan.lead_id,
      type: actionTypeForPlan(plan),
      status,
      next_best_action_plan_id: plan.id,
      approval_requirement: approvalRequirement,
      idempotency_key: `next-best-action-plan:${plan.id}:outbound-action:v1`,
      payload: {
        source: "NEXT_BEST_ACTION_PLAN",
        plan_id: plan.id,
        title: plan.title,
        rationale: plan.rationale,
        policy_decision: plan.policy_decision,
        approval: plan.approval,
        evidence_refs: plan.decision_evidence_refs,
        mock_behavior: "SUCCESS"
      }
    });
    this.auditRepository?.record({
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
    this.approvalsService?.requestForAction(action, {
      requested_reason: plan.approval?.reason || "Human approval is required."
    });
    return this.actionDetail(action);
  }

  executeAction({ organization_id, action_id }) {
    const action = this.actionsRepository.getActionForOrganization(action_id, organization_id);
    if (!action) {
      throw httpError(404, "Action not found.");
    }
    if (action.status === ACTION_STATUS.AWAITING_APPROVAL) {
      throw httpError(409, "This action requires approval before execution. M5 will add approval workflow.");
    }
    if (!EXECUTABLE_ACTION_STATUSES.has(action.status)) {
      return {
        action: this.actionDetail(action),
        execution_result: {
          action_id: action.id,
          status: action.status,
          execution: this.executionsRepository.latestForAction(action.id),
          executable: false
        }
      };
    }
    const executionResult = this.actionExecutor.execute(action);
    return {
      action: this.actionDetail(this.actionsRepository.getAction(action.id)),
      execution_result: executionResult
    };
  }

  listForLead({ organization_id, lead_id }) {
    return this.actionsRepository.listForLeadScoped(lead_id, organization_id).map((action) => this.actionDetail(action));
  }

  actionDetail(action) {
    if (!action) {
      return null;
    }
    return {
      ...action,
      payload: this.actionsRepository.actionPayload(action),
      approval: this.approvalsRepository?.getByActionId(action.id, action.organization_id) || null,
      executions: this.executionsRepository.listForAction(action.id),
      callbacks: this.callbacksRepository.listForAction(action.id)
    };
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
