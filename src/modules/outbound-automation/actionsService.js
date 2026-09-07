export class ActionsService {
  constructor({ actionsRepository, intelligenceRepository, auditRepository }) {
    this.actionsRepository = actionsRepository;
    this.intelligenceRepository = intelligenceRepository;
    this.auditRepository = auditRepository;
  }

  planInitialAction(lead) {
    const snapshot = this.intelligenceRepository.latestForLead(lead.id);
    const type = snapshot?.next_best_action || "CREATE_HUMAN_TASK";
    const action = this.actionsRepository.createAction({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      type,
      idempotency_key: `lead:${lead.id}:initial-next-best-action`,
      payload: {
        reason: "Initial next best action from Lead Intelligence snapshot.",
        intelligence_snapshot_id: snapshot?.id || null,
        message: `Follow up with ${lead.name} based on the current lead intelligence.`
      }
    });

    this.auditRepository.record({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      action_id: action.id,
      event_type: "ActionPlanned",
      message: "Initial outbound action planned from Lead Intelligence.",
      metadata: { action_type: action.type }
    });

    return action;
  }

  createManualAction(lead, { type = "SEND_EMAIL", mock_behavior = "SUCCESS" } = {}) {
    return this.actionsRepository.createAction({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      type,
      idempotency_key: `lead:${lead.id}:manual:${type}:${mock_behavior}`,
      payload: {
        reason: "Manual M0 test action.",
        mock_behavior,
        message: `Manual test action for ${lead.name}.`
      }
    });
  }
}
