export class ActionsService {
  constructor({ actionsRepository, intelligenceRepository, auditRepository }) {
    this.actionsRepository = actionsRepository;
    this.intelligenceRepository = intelligenceRepository;
    this.auditRepository = auditRepository;
  }

  async planInitialAction(lead) {
    const snapshot = await this.intelligenceRepository.latestForLead(lead.id);
    const type = snapshot?.next_best_action || "CREATE_HUMAN_TASK";
    const action = await this.actionsRepository.createAction({
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

    await this.auditRepository.record({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      action_id: action.id,
      event_type: "ActionPlanned",
      message: "Initial outbound action planned from Lead Intelligence.",
      metadata: { action_type: action.type }
    });

    return action;
  }

  async createManualAction(lead, { type = "SEND_EMAIL", mock_behavior = "SUCCESS" } = {}) {
    return await this.actionsRepository.createAction({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      type,
      idempotency_key: `lead:${lead.id}:manual:${type}:${mock_behavior}`,
      payload: {
        reason: "Manually sent from the lead page.",
        mock_behavior,
        message: `Outreach message to ${lead.name || "the lead"}.`
      }
    });
  }
}
