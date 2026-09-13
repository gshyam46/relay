import { currentLeadData } from "../data-foundation/leadDataSafety.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { ActionsRepository } from "./actionsRepository.js";
import { IntelligenceRepository } from "../lead-intelligence/intelligenceRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { IntelligenceService } from "../lead-intelligence/intelligenceService.js";
import { InboundEventsRepository } from "../channels/inboundEventsRepository.js";

export class ActionsService {
  constructor({ actionsRepository, intelligenceRepository, auditRepository }) {
    this.actionsRepository = actionsRepository;
    this.intelligenceRepository = intelligenceRepository;
    this.auditRepository = auditRepository;
  }

  inTransaction(lead, work) {
    return new ContactPolicyService(this.actionsRepository.db).withWorkspacePolicyTransaction(lead.organization_id, tx => work(new ActionsService({ actionsRepository: new ActionsRepository(tx), intelligenceRepository: new IntelligenceRepository(tx), auditRepository: new AuditRepository(tx) })));
  }

  async planInitialAction(lead) {
    if (!this.actionsRepository.db.transactionBound) return this.inTransaction(lead, service => service.planInitialAction(lead));
    lead = await currentLeadData(this.actionsRepository.db, lead);
    const current = await new IntelligenceService({ intelligenceRepository: this.intelligenceRepository,
      inboundEventsRepository: new InboundEventsRepository(this.intelligenceRepository.db) }).assessLead(lead);
    const snapshot = current.snapshot?.status === "READY" ? current.snapshot : null;
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
    if (!this.actionsRepository.db.transactionBound) return this.inTransaction(lead, service => service.createManualAction(lead, { type, mock_behavior }));
    lead = await currentLeadData(this.actionsRepository.db, lead);
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
