import { DomainEventProcessor } from "./domainEventProcessor.js";
import { createLeadEventHandlers } from "./leadEventHandlers.js";
import { SchedulerService } from "./schedulerService.js";
import { FollowUpDueService } from "../channels/followUpDueService.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";

const MOCK_PROVIDER_PATTERN = /^(?:email-sandbox|sms-sandbox|whatsapp-sandbox|voice-sandbox|human-task)$/;

export class Worker {
  constructor({
    eventsRepository, leadsRepository, intelligenceService, actionsService, actionsRepository, actionExecutor, auditRepository,
    executionsRepository = null, callbacksService = null, synthesisService = null, intelligenceRecommendationService = null,
    nextBestActionService = null, webhookInbox = null, dispatchRecoveryService = null, workflowsService = null,
    contactPolicyService = null, analysisJobsService = null, domainEventProcessor = null, scheduler = null, followUpDueService = null, dispatchControlsService = null
  }) {
    Object.assign(this, { eventsRepository, leadsRepository, intelligenceService, actionsService, actionsRepository, actionExecutor,
      auditRepository, executionsRepository, callbacksService, synthesisService, intelligenceRecommendationService,
      nextBestActionService, webhookInbox, dispatchRecoveryService, workflowsService, dispatchControlsService, analysisJobsService });
    const db = eventsRepository.db;
    this.contactPolicyService = contactPolicyService || new ContactPolicyService(db);
    this.accepting = true;
    this.operations = new Set();
    this.domainEventProcessor = domainEventProcessor || new DomainEventProcessor({
      db, contactPolicyService: this.contactPolicyService, now: () => this.actionExecutor.now(),
      handlers: createLeadEventHandlers({ getServices: () => this })
    });
    this.followUpDueService = followUpDueService || new FollowUpDueService({ db, contactPolicyService: this.contactPolicyService, now: () => this.actionExecutor.now() });
    this.scheduler = scheduler || new SchedulerService({
      db, now: () => this.actionExecutor.now(), dispatchControlsService,
      handlers: {
        RECEIPTS: (command) => this.webhookInbox?.processDue(command) || { items: [] },
        EVENTS: (command) => this.domainEventProcessor.processDue(command),
        WORKFLOWS: (command) => this.workflowsService?.runDue(command) || { processed_runs: [] },
        FOLLOW_UPS: (command) => this.followUpDueService.processDue(command),
        DISPATCH: (command) => this.dispatchDue(command),
        EXPIRY: (command) => this.dispatchRecoveryService?.expireLeases(command) || { items: [] }
      }
    });
  }

  stop() {
    this.accepting = false;
    this.scheduler.stopAccepting();
    this.domainEventProcessor.stopAccepting();
  }
  async drain() {
    await Promise.allSettled([...this.operations]);
    await Promise.all([this.scheduler.drain(), this.domainEventProcessor.drain()]);
  }
  async runOnce(options = {}) {
    if (!this.accepting) return { processed_events: [], executed_actions: [], processed_runs: [], due_follow_ups: [], draining: true };
    const operation = this.#runOnce(options);
    this.operations.add(operation);
    try { return await operation; } finally { this.operations.delete(operation); }
  }
  async #runOnce(options) {
    const result = await this.scheduler.runOnce(options);
    if (this.accepting && !options.organization_id) await this.webhookInbox?.purgeProcessedPayloads({ limit: 25 });
    return result;
  }
  async dispatchDue({ organization_id, limit }) {
    const at = new Date(this.actionExecutor.now()).toISOString();
    const operations = this.dispatchControlsService?.candidatePredicate({ actionAlias: "actions", kind: this.actionsRepository.db.kind, at });
    const actions = await this.actionsRepository.nextExecutable(limit, organization_id, at, operations);
    const executed_actions = [];
    for (const action of actions) {
      if (!this.accepting) break;
      executed_actions.push(await this.actionExecutor.execute(action));
    }
    return { executed_actions };
  }

  // Sandbox/mock channels have no real provider to send a delivery webhook, so nothing would
  // ever move an EXECUTING action to COMPLETED. Simulate that callback here so outbound
  // activity actually reaches a terminal "Sent" state without a manual dev-tools trigger.
  async autoCompleteMockExecutions() {
    if (!this.accepting) return [];
    if (!this.executionsRepository || !this.callbacksService) {
      return [];
    }
    const completed = [];
    for (const action of await this.actionsRepository.listByStatus("EXECUTING")) {
      const execution = await this.executionsRepository.latestForAction(action.id);
      if (!this.accepting) break;
      if (!execution || execution.status !== "STARTED" || execution.outcome_class !== "ACCEPTED"
        || execution.id !== action.active_execution_id || execution.fence_token !== action.execution_fence
        || !MOCK_PROVIDER_PATTERN.test(execution.provider || "")) {
        continue;
      }
      try {
        const result = await this.callbacksService.receiveExecutionCallback({
          organization_id: action.organization_id,
          action_id: action.id,
          action_execution_id: execution.id, revision_id: execution.action_revision_id,
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
