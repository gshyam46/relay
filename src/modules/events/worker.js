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
    callbacksService = null,
    synthesisService = null,
    intelligenceRecommendationService = null,
    nextBestActionService = null
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
    this.synthesisService = synthesisService;
    this.intelligenceRecommendationService = intelligenceRecommendationService;
    this.nextBestActionService = nextBestActionService;
  }

  async runOnce() {
    const processedEvents = [];
    const executedActions = [];

    for (const event of await this.eventsRepository.nextPending()) {
      try {
        if (event.type === "LeadCreated") {
          const lead = await this.leadsRepository.getLead(event.lead_id);
          if (lead) {
            // Only normalise a lead that is still untouched. This event can be
            // processed well after it was queued — a backed-up queue, a restart,
            // a worker that was disabled — and by then the lead may have replied
            // (ACTIVE), opted out, or converted. Writing NORMALIZED
            // unconditionally would resurrect an opted-out lead into the normal
            // outbound flow, which is the one status regression that actually
            // reaches a person.
            if (lead.status === "NEW") {
              await this.leadsRepository.updateLeadStatus(lead.id, "NORMALIZED");
            }
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
        if (event.type === "LeadReplyReceived") {
          await this.#refreshIntelligenceAfterReply(event);
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

  /**
   * Brings a lead's analysis back in line with what they just said.
   *
   * The inbound path already re-ran the readiness snapshot inline, which folds
   * the reply in as a signal and changes the snapshot's input fingerprint. That
   * alone only makes the existing synthesis and recommendation STALE — it does
   * not produce new ones, so without this the lead would sit showing a
   * recommendation that predates the reply.
   *
   * Deliberately stops at planning. A plan is an opinion; creating the outbound
   * action from it stays a human decision, so a reply can never cause the system
   * to queue a message on its own.
   */
  async #refreshIntelligenceAfterReply(event) {
    const lead = await this.leadsRepository.getLead(event.lead_id);
    if (!lead) {
      return;
    }

    // Someone who has opted out or been suppressed should not be re-analysed
    // into a fresh "next best action" to contact them.
    if (lead.status === "OPTED_OUT" || lead.status === "SUPPRESSED") {
      await this.auditRepository?.record({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        event_type: "LeadIntelligenceUpdated",
        message: "Skipped re-analysis after reply: lead is opted out.",
        metadata: { lead_status: lead.status }
      });
      return;
    }

    const stages = [
      ["synthesis", () => this.synthesisService?.runForLead(lead)],
      ["recommendation", () => this.intelligenceRecommendationService?.runForLead(lead)],
      ["next_best_action", () => this.nextBestActionService?.planForLead(lead)]
    ];

    const completed = [];
    for (const [name, run] of stages) {
      try {
        const result = await run();
        if (result === undefined) {
          // The stage is not wired in this composition — stop rather than
          // pretending later stages ran on fresh input.
          break;
        }
        completed.push(name);
      } catch (error) {
        // A stage can legitimately refuse (for example a lead without enough
        // data to synthesise). Record where it stopped instead of failing the
        // whole event and retrying forever.
        await this.auditRepository?.record({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          event_type: "LeadIntelligenceUpdated",
          message: `Re-analysis after reply stopped at ${name}.`,
          metadata: { stage: name, reason: error.message || String(error), completed }
        });
        return;
      }
    }

    await this.auditRepository?.record({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      event_type: "LeadIntelligenceUpdated",
      message: "Re-analysed lead after inbound reply.",
      metadata: {
        stages: completed,
        inbound_event_id: event.lead_id ? parseJson(event.payload_json)?.inbound_event_id || null : null,
        reply_type: parseJson(event.payload_json)?.event_type || null
      }
    });
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
