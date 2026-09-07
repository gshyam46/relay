import { ACTION_STATUS } from "./actionContract.js";

export class CallbacksService {
  constructor({
    callbacksRepository,
    actionsRepository,
    executionsRepository,
    leadsRepository,
    eventsRepository,
    auditRepository,
    channelWorkflowService = null
  }) {
    this.callbacksRepository = callbacksRepository;
    this.actionsRepository = actionsRepository;
    this.executionsRepository = executionsRepository;
    this.leadsRepository = leadsRepository;
    this.eventsRepository = eventsRepository;
    this.auditRepository = auditRepository;
    this.channelWorkflowService = channelWorkflowService;
  }

  receiveExecutionCallback({ action_id, provider_event_id, status = "COMPLETED", provider_reference = null, details = {} }) {
    const action = this.actionsRepository.getAction(action_id);
    if (!action) {
      const error = new Error("Action not found.");
      error.statusCode = 404;
      throw error;
    }

    const latestExecution = this.executionsRepository.latestForAction(action.id);
    const { callback, duplicate } = this.callbacksRepository.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id,
      action_execution_id: latestExecution?.id || null,
      provider_event_id,
      status,
      provider_reference,
      payload: { status, provider_reference, details }
    });

    if (duplicate) {
      return { duplicate: true, callback, action };
    }

    if (status === "COMPLETED") {
      const execution = this.executionsRepository.markCompleted(action.id, provider_reference);
      const updatedAction = this.actionsRepository.updateStatus(action.id, ACTION_STATUS.COMPLETED);
      this.leadsRepository.updateLeadStatus(action.lead_id, "ACTIVE");
      this.eventsRepository.publish({
        organization_id: action.organization_id,
        lead_id: action.lead_id,
        type: "ActionCompleted",
        payload: { action_id: action.id, provider_event_id }
      });
      this.auditRepository.record({
        organization_id: action.organization_id,
        lead_id: action.lead_id,
        action_id: action.id,
        event_type: "ActionCompleted",
        message: "Execution callback completed the action.",
        metadata: { provider_event_id, provider_reference }
      });
      const channel_result = this.channelWorkflowService?.recordExecutionCallback({
        action: updatedAction,
        callback,
        execution,
        status,
        provider_reference
      });
      return { duplicate: false, callback, action: updatedAction, execution, channel_result };
    }

    const updatedAction = this.actionsRepository.updateStatus(action.id, ACTION_STATUS.FAILED, {
      last_error: details.reason || "Execution callback reported failure."
    });
    const execution = this.executionsRepository.markFailed(action.id, {
      providerReference: provider_reference,
      error: details.reason || "Execution callback reported failure."
    });
    this.auditRepository.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "ActionFailed",
      message: "Execution callback reported failure.",
      metadata: { provider_event_id, details }
    });
    const channel_result = this.channelWorkflowService?.recordExecutionCallback({
      action: updatedAction,
      callback,
      execution,
      status,
      provider_reference
    });
    return { duplicate: false, callback, action: updatedAction, execution, channel_result };
  }
}
