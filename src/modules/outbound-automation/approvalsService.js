import { normalizeComposerSchedule } from "./composerContract.js";
import { ACTION_STATUS } from "./actionContract.js";
import { validateApprovalDecisionInput } from "./approvalContract.js";
import { PreparedActionService } from "./preparedActionService.js";
import { PreparedActionRepository } from "./preparedActionRepository.js";
import { SEND_ACTION_TYPES, reviewError } from "./preparedActionContract.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

const REVIEWABLE = new Set(["PLANNED", "AWAITING_APPROVAL", "APPROVED", "RETRYING"]);

export class ApprovalsService {
  constructor({ approvalsRepository, actionsRepository, auditRepository, unitOfWork = null }) {
    if (!unitOfWork && (!actionsRepository.db?.transactionBound ||
        approvalsRepository.db !== actionsRepository.db || auditRepository.db !== actionsRepository.db)) {
      throw new Error("Approval operations require repositories bound to one transaction.");
    }
    this.unitOfWork = unitOfWork;
    this.approvalsRepository = approvalsRepository;
    this.actionsRepository = actionsRepository;
    this.auditRepository = auditRepository;
    this.db = actionsRepository.db;
    this.prepared = new PreparedActionService(this.db);
    this.revisions = new PreparedActionRepository(this.db);
  }

  async requestForAction(action, { requested_reason }) {
    if (this.unitOfWork) {
      return this.unitOfWork.run(({ approvalsService }) => approvalsService.requestForAction(action, { requested_reason }),
        { organization_id: action.organization_id });
    }
    action = await this.requireAction(action.organization_id, action.id);
    if (action.approval_requirement !== "REQUIRED" && !SEND_ACTION_TYPES.has(action.type)) return null;
    if (!REVIEWABLE.has(action.status)) return this.approvalsRepository.getByActionId(action.id, action.organization_id);
    await this.#prepare(action, { requested_reason });
    return this.approvalsRepository.getByActionId(action.id, action.organization_id);
  }

  async listForOrganization({ organization_id, status = null }) {
    return { approvals: await this.approvalsRepository.listForOrganization(organization_id, { status }) };
  }

  async currentForAction(input) {
    if (this.unitOfWork) return this.#delegate("currentForAction", input);
    const action = await this.requireAction(input.organization_id, input.action_id);
    const lead = await this.db.get("SELECT archived_at FROM leads WHERE organization_id=? AND id=?", [action.organization_id, action.lead_id]);
    if (REVIEWABLE.has(action.status) && !lead?.archived_at) await this.#prepare(action);
    return this.#detail(action);
  }

  async previewAction(input) {
    if (this.unitOfWork) return this.#delegate("previewAction", input);
    const action = await this.requireAction(input.organization_id, input.action_id);
    if (!REVIEWABLE.has(action.status)) throw reviewError("ACTION_NOT_REVIEWABLE", "This action can no longer be edited.");
    // Editing is tied to the preview the operator actually opened, even when
    // the underlying recipient/configuration has changed since that preview.
    await this.prepared.requireCurrent(action, input.expected_revision_id);
    if (Object.hasOwn(input, "scheduled_at")) {
      if (action.first_dispatch_at || await this.db.get("SELECT id FROM action_executions WHERE action_id = ? LIMIT 1", [action.id])) {
        throw reviewError("COMPOSER_ACTION_STARTED", "Attempted work must use its existing execution recovery.");
      }
      action.scheduled_at = normalizeComposerSchedule(input.scheduled_at);
      await this.db.run("UPDATE actions SET scheduled_at = ? WHERE id = ? AND organization_id = ?", [action.scheduled_at, action.id, action.organization_id]);
    }
    await this.#prepare(action, {
      expected_revision_id: input.expected_revision_id,
      edited_payload: input.edited_payload ?? {},
      forceNew: true
    });
    return this.#detail(action);
  }

  async approveAction(input) {
    if (this.unitOfWork) return this.#delegate("approveAction", input);
    if (input.edited_payload !== null && input.edited_payload !== undefined) {
      throw reviewError("EDIT_PREVIEW_REQUIRED", "Preview edited content first, then approve that exact revision.", 409);
    }
    return this.#decide(input, "APPROVED");
  }

  async rejectAction(input) {
    if (this.unitOfWork) return this.#delegate("rejectAction", input);
    return this.#decide(input, "REJECTED");
  }

  async revokeAction(input) {
    if (this.unitOfWork) return this.#delegate("revokeAction", input);
    validateActor(input);
    const action = await this.requireAction(input.organization_id, input.action_id);
    const revision = await this.revisions.current(action);
    if (!revision || revision.id !== input.expected_revision_id) {
      throw reviewError("APPROVAL_REVISION_STALE", "The reviewed draft changed. Open its current preview before revoking.");
    }
    const decision = await this.revisions.decision(revision);
    if (![ACTION_STATUS.APPROVED, ACTION_STATUS.RETRYING].includes(action.status) || decision?.decision !== "APPROVED") {
      throw reviewError("ACTION_NOT_REVOCABLE", "Only an approved action that has not started dispatch can be revoked.");
    }
    try {
      await this.#prepare(action, { expected_revision_id: revision.id, forceNew: true });
    } catch (error) {
      // Invalid current inputs must not prevent withdrawing authorization.
      // Storage/internal errors still fail the complete transaction.
      if (!["SENDER_UNAVAILABLE", "RECIPIENT_UNAVAILABLE", "INVALID_PREPARED_BODY", "INVALID_PREPARED_SUBJECT", "UNSUPPORTED_PROVIDER"].includes(error.code)) throw error;
      await this.approvalsRepository.bindPendingRevision(action, { id: null }, "Approval revoked; repair recipient or sender before a new preview.");
      await this.db.run("UPDATE actions SET current_revision_id = NULL, approval_requirement = 'REQUIRED', status = 'AWAITING_APPROVAL', last_error = ? WHERE id = ? AND organization_id = ?",
        ["Approval revoked. A new preview requires valid recipient, sender and content.", action.id, action.organization_id]);
    }
    await this.auditRepository.record({
      organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
      event_type: "ActionApprovalRevoked", message: "Approval revoked; a new exact review is required.",
      metadata: { revoked_revision_id: revision.id, reviewer_user_id: input.reviewer_user_id, reviewer_note: input.reviewer_note || null }
    });
    return this.#detail(action);
  }

  async #decide(input, decisionType) {
    validateActor(input);
    const action = await this.requireAction(input.organization_id, input.action_id);
    const revision = await this.prepared.requireCurrent(action, input.expected_revision_id);
    const existing = await this.revisions.decision(revision);
    if (existing) {
      if (existing.decision !== decisionType) throw reviewError("APPROVAL_ALREADY_DECIDED", "This revision already has a different review decision.");
      return this.#detail(action);
    }
    if (action.status !== ACTION_STATUS.AWAITING_APPROVAL) {
      throw reviewError("ACTION_NOT_REVIEWABLE", "Only a current action awaiting approval can receive a decision.");
    }
    const decision = await this.revisions.decide(revision, {
      decision: decisionType, reviewer_user_id: input.reviewer_user_id,
      reviewer_name: normalizeOptionalText(input.reviewer_name), reviewer_note: normalizeOptionalText(input.reviewer_note)
    });
    await this.approvalsRepository.projectRevisionDecision(action, revision, decision);
    await this.actionsRepository.updateStatus(action.id,
      decisionType === "APPROVED" ? ACTION_STATUS.APPROVED : ACTION_STATUS.BLOCKED,
      { last_error: decisionType === "REJECTED" ? "Rejected during human review." : null });
    await this.auditRepository.record({
      organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
      event_type: decisionType === "APPROVED" ? "ActionApproved" : "ActionRejected",
      message: decisionType === "APPROVED" ? "Exact prepared message approved by human review." : "Prepared revision rejected during human review.",
      metadata: { revision_id: revision.id, reviewed_hash: revision.content_hash, reviewer_user_id: input.reviewer_user_id }
    });
    return this.#detail(action);
  }

  async #prepare(action, options = {}) {
    const previous = await this.approvalsRepository.getByActionId(action.id, action.organization_id);
    const revision = await this.prepared.prepare(action, options);
    if (!revision) return null;
    if (previous?.action_revision_id !== revision.id) {
      if (previous && !previous.action_revision_id && previous.status !== "PENDING") {
        await this.auditRepository.record({
          organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
          event_type: "LegacyApprovalArchived", message: "Historical approval retained without inventing an approved envelope.",
          metadata: { legacy_approval: previous }
        });
      }
      await this.approvalsRepository.bindPendingRevision(action, revision, options.requested_reason);
      await this.db.run("UPDATE actions SET approval_requirement = 'REQUIRED', status = 'AWAITING_APPROVAL', last_error = NULL WHERE id = ? AND organization_id = ?",
        [action.id, action.organization_id]);
      await this.auditRepository.record({
        organization_id: action.organization_id, lead_id: action.lead_id, action_id: action.id,
        event_type: "ActionReviewPrepared", message: "An exact recipient, sender and content preview was prepared for review.",
        metadata: { revision_id: revision.id, content_hash: revision.content_hash }
      });
    }
    return revision;
  }

  async #detail(action) {
    action = await this.actionsRepository.getActionForOrganization(action.id, action.organization_id);
    const revision = await this.revisions.current(action);
    return {
      action: { ...action, payload: this.actionsRepository.actionPayload(action), prepared_revision: this.prepared.publicRevision(revision) },
      approval: await this.approvalsRepository.getByActionId(action.id, action.organization_id),
      prepared_revision: this.prepared.publicRevision(revision)
    };
  }

  #delegate(method, input) {
    return this.unitOfWork.run(({ approvalsService }) => approvalsService[method](input),
      { organization_id: input.organization_id });
  }

  async requireAction(organizationId, actionId) {
    assertWorkspaceTransaction(this.db, organizationId);
    const action = await this.actionsRepository.getActionForUpdate(actionId, organizationId);
    if (!action) throw reviewError("ACTION_NOT_FOUND", "Action not found.", 404);
    return action;
  }

  async actionDetail(action) {
    return (await this.#detail(action)).action;
  }
}

function validateActor(input) {
  const errors = validateApprovalDecisionInput(input);
  if (errors.length) throw reviewError("INVALID_REVIEW_DECISION", errors.join(" "), 400);
  if (typeof input.reviewer_user_id !== "string" || !input.reviewer_user_id.trim()) {
    throw reviewError("REVIEWER_REQUIRED", "A signed-in reviewer is required.", 400);
  }
}
function normalizeOptionalText(value) { return typeof value === "string" ? value.trim() || null : null; }
