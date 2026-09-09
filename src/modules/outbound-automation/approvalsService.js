import { ACTION_STATUS } from "./actionContract.js";
import { APPROVAL_STATUS, validateApprovalDecisionInput } from "./approvalContract.js";

export class ApprovalsService {
  constructor({ approvalsRepository, actionsRepository, auditRepository }) {
    this.approvalsRepository = approvalsRepository;
    this.actionsRepository = actionsRepository;
    this.auditRepository = auditRepository;
  }

  async requestForAction(action, { requested_reason }) {
    if (action.approval_requirement !== "REQUIRED") {
      return null;
    }
    return await this.approvalsRepository.createPendingForAction(action, { requested_reason });
  }

  async listForOrganization({ organization_id, status = null }) {
    return {
      approvals: await this.approvalsRepository.listForOrganization(organization_id, { status })
    };
  }

  async currentForAction({ organization_id, action_id }) {
    const action = await this.requireAction(organization_id, action_id);
    return {
      action: await this.actionDetail(action),
      approval: await this.ensureApprovalForAction(action)
    };
  }

  async approveAction({ organization_id, action_id, reviewer_name = null, reviewer_note = null, edited_payload = null }) {
    validateDecision({ reviewer_name, reviewer_note, edited_payload });
    const action = await this.requireAction(organization_id, action_id);
    const approval = await this.ensureApprovalForAction(action);
    if (approval.status === APPROVAL_STATUS.REJECTED) {
      throw httpError(409, "Rejected actions cannot be approved.");
    }
    if (approval.status === APPROVAL_STATUS.APPROVED) {
      return { action: await this.actionDetail(action), approval };
    }

    if (edited_payload) {
      await this.actionsRepository.mergePayload(action.id, {
        human_review: {
          edited: true,
          edited_payload
        }
      });
    }

    const approved = await this.approvalsRepository.approve(action.id, organization_id, {
      reviewer_name: normalizeOptionalText(reviewer_name),
      reviewer_note: normalizeOptionalText(reviewer_note),
      edited_payload
    });
    const updatedAction = await this.actionsRepository.updateStatus(action.id, ACTION_STATUS.APPROVED);
    await this.auditRepository.record({
      organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: edited_payload ? "ActionEditedAndApproved" : "ActionApproved",
      message: edited_payload ? "Action edited and approved by human review." : "Action approved by human review.",
      metadata: {
        approval_id: approved.id,
        edited: Boolean(edited_payload)
      }
    });
    return { action: await this.actionDetail(updatedAction), approval: approved };
  }

  async rejectAction({ organization_id, action_id, reviewer_name = null, reviewer_note = null }) {
    validateDecision({ reviewer_name, reviewer_note });
    const action = await this.requireAction(organization_id, action_id);
    const approval = await this.ensureApprovalForAction(action);
    if (approval.status === APPROVAL_STATUS.APPROVED) {
      throw httpError(409, "Approved actions cannot be rejected.");
    }
    if (approval.status === APPROVAL_STATUS.REJECTED) {
      return { action: await this.actionDetail(action), approval };
    }

    const rejected = await this.approvalsRepository.reject(action.id, organization_id, {
      reviewer_name: normalizeOptionalText(reviewer_name),
      reviewer_note: normalizeOptionalText(reviewer_note)
    });
    const updatedAction = await this.actionsRepository.updateStatus(action.id, ACTION_STATUS.BLOCKED, {
      last_error: "Rejected during human review."
    });
    await this.auditRepository.record({
      organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "ActionRejected",
      message: "Action rejected during human review.",
      metadata: {
        approval_id: rejected.id
      }
    });
    return { action: await this.actionDetail(updatedAction), approval: rejected };
  }

  async ensureApprovalForAction(action) {
    if (action.approval_requirement !== "REQUIRED") {
      throw httpError(409, "This action does not require approval.");
    }
    return (
      await this.approvalsRepository.getByActionId(action.id, action.organization_id) ||
      await this.approvalsRepository.createPendingForAction(action, {
        requested_reason: "Human approval is required before outbound execution."
      })
    );
  }

  async requireAction(organizationId, actionId) {
    const action = await this.actionsRepository.getActionForOrganization(actionId, organizationId);
    if (!action) {
      throw httpError(404, "Action not found.");
    }
    return action;
  }

  async actionDetail(action) {
    return {
      ...action,
      payload: this.actionsRepository.actionPayload(action)
    };
  }
}

function validateDecision(input) {
  const errors = validateApprovalDecisionInput(input);
  if (errors.length > 0) {
    throw httpError(400, errors.join(" "));
  }
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() || null;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
