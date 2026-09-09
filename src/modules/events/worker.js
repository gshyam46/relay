import { parseJson } from "../../database/database.js";

const MOCK_PROVIDER_PATTERN = /sandbox|mock|human-task/;

export class Worker {
  constructor({
    eventsRepository,
    leadsRepository,
    intelligenceService,
    actionsService,
    actionsRepository,
    actionExecutor,
    auditRepository,
    executionsRepository = null,
    callbacksService = null
  }) {
    this.eventsRepository = eventsRepository;
    this.leadsRepository = leadsRepository;
    this.intelligenceService = intelligenceService;
    this.actionsService = actionsService;
    this.actionsRepository = actionsRepository;
    this.actionExecutor = actionExecutor;
    this.auditRepository = auditRepository;
    this.executionsRepository = executionsRepository;
    this.callbacksService = callbacksService;
  }

  async runOnce() {
    const processedEvents = [];
    const executedActions = [];

    for (const event of await this.eventsRepository.nextPending()) {
      try {
        if (event.type === "LeadCreated") {
          const lead = await this.leadsRepository.getLead(event.lead_id);
          if (lead) {
            await this.leadsRepository.updateLeadStatus(lead.id, "NORMALIZED");
            await this.intelligenceService.createInitialSnapshot(lead);
            await this.actionsService.planInitialAction(lead);
            await this.auditRepository.record({
              organization_id: event.organization_id,
              lead_id: lead.id,
              event_type: "LeadIntelligenceUpdated",
              message: "Initial Lead Intelligence snapshot created.",
              metadata: parseJson(event.payload_json)
            });
          }
        }
        await this.eventsRepository.markProcessed(event.id);
        processedEvents.push(event.id);
      } catch (error) {
        await this.eventsRepository.markFailed(event.id, error);
      }
    }

    for (const action of await this.actionsRepository.nextExecutable()) {
      executedActions.push(await this.actionExecutor.execute(action));
    }

    return { processed_events: processedEvents, executed_actions: executedActions };
  }

  // Sandbox/mock channels have no real provider to send a delivery webhook, so nothing would
  // ever move an EXECUTING action to COMPLETED. Simulate that callback here so outbound
  // activity actually reaches a terminal "Sent" state without a manual dev-tools trigger.
  async autoCompleteMockExecutions() {
    if (!this.executionsRepository || !this.callbacksService) {
      return [];
    }
    const completed = [];
    for (const action of await this.actionsRepository.listByStatus("EXECUTING")) {
      const execution = await this.executionsRepository.latestForAction(action.id);
      if (!execution || execution.status !== "STARTED" || !MOCK_PROVIDER_PATTERN.test(execution.provider || "")) {
        continue;
      }
      try {
        const result = await this.callbacksService.receiveExecutionCallback({
          action_id: action.id,
          provider_event_id: `auto-complete:${execution.id}`,
          status: "COMPLETED",
          provider_reference: execution.provider_reference
        });
        completed.push(result);
      } catch (error) {
        await this.auditRepository.record({
          organization_id: action.organization_id,
          lead_id: action.lead_id,
          action_id: action.id,
          event_type: "ActionAutoCompleteFailed",
          message: error.message || String(error)
        });
      }
    }
    return completed;
  }
}
