import { parseJson } from "../../database/database.js";

export class Worker {
  constructor({ eventsRepository, leadsRepository, intelligenceService, actionsService, actionsRepository, actionExecutor, auditRepository }) {
    this.eventsRepository = eventsRepository;
    this.leadsRepository = leadsRepository;
    this.intelligenceService = intelligenceService;
    this.actionsService = actionsService;
    this.actionsRepository = actionsRepository;
    this.actionExecutor = actionExecutor;
    this.auditRepository = auditRepository;
  }

  runOnce() {
    const processedEvents = [];
    const executedActions = [];

    for (const event of this.eventsRepository.nextPending()) {
      try {
        if (event.type === "LeadCreated") {
          const lead = this.leadsRepository.getLead(event.lead_id);
          if (lead) {
            this.leadsRepository.updateLeadStatus(lead.id, "NORMALIZED");
            this.intelligenceService.createInitialSnapshot(lead);
            this.actionsService.planInitialAction(lead);
            this.auditRepository.record({
              organization_id: event.organization_id,
              lead_id: lead.id,
              event_type: "LeadIntelligenceUpdated",
              message: "Initial Lead Intelligence snapshot created.",
              metadata: parseJson(event.payload_json)
            });
          }
        }
        this.eventsRepository.markProcessed(event.id);
        processedEvents.push(event.id);
      } catch (error) {
        this.eventsRepository.markFailed(event.id, error);
      }
    }

    for (const action of this.actionsRepository.nextExecutable()) {
      executedActions.push(this.actionExecutor.execute(action));
    }

    return { processed_events: processedEvents, executed_actions: executedActions };
  }
}
