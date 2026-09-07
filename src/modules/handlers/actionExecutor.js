import { ACTION_STATUS, EXECUTION_STATUS, EXECUTABLE_ACTION_STATUSES } from "../outbound-automation/actionContract.js";

export class ActionExecutor {
  constructor({ actionsRepository, executionsRepository, auditRepository, adapter, channelWorkflowService = null }) {
    this.actionsRepository = actionsRepository;
    this.executionsRepository = executionsRepository;
    this.auditRepository = auditRepository;
    this.adapter = adapter;
    this.channelWorkflowService = channelWorkflowService;
  }

  execute(action) {
    if (!EXECUTABLE_ACTION_STATUSES.has(action.status)) {
      const latestExecution = this.executionsRepository.latestForAction(action.id);
      return {
        action_id: action.id,
        status: action.status,
        execution: latestExecution,
        executable: false,
        reason: `Action is ${action.status}.`
      };
    }

    const attempt = this.executionsRepository.nextAttempt(action.id);
    const payload = this.actionsRepository.actionPayload(action);
    const executionKey = `${action.idempotency_key}:attempt:${attempt}`;
    const result = this.adapter.invoke(action, payload, attempt);

    if (!result.ok) {
      const status = result.retryable ? ACTION_STATUS.RETRYING : ACTION_STATUS.BLOCKED;
      const execution = this.executionsRepository.createExecution({
        action_id: action.id,
        status: EXECUTION_STATUS.FAILED,
        attempt,
        provider: "mock-n8n",
        idempotency_key: executionKey,
        error: result.error
      });
      this.actionsRepository.updateStatus(action.id, status, { last_error: result.error });
      this.auditRepository.record({
        organization_id: action.organization_id,
        lead_id: action.lead_id,
        action_id: action.id,
        event_type: "ActionExecutionFailed",
        message: result.error,
        metadata: { retryable: result.retryable, attempt }
      });
      this.channelWorkflowService?.recordOutboundExecutionAttempt({ action, payload, attempt, result, execution });
      return { action_id: action.id, status, execution, retryable: result.retryable };
    }

    const execution = this.executionsRepository.createExecution({
      action_id: action.id,
      status: EXECUTION_STATUS.STARTED,
      attempt,
      provider: result.provider,
      provider_reference: result.provider_reference,
      idempotency_key: executionKey
    });
    this.actionsRepository.updateStatus(action.id, ACTION_STATUS.EXECUTING);
    this.auditRepository.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "ActionStarted",
      message: "Action passed through the handler and mock n8n adapter boundary.",
      metadata: { attempt, provider_reference: result.provider_reference }
    });
    this.channelWorkflowService?.recordOutboundExecutionAttempt({ action, payload, attempt, result, execution });
    return { action_id: action.id, status: ACTION_STATUS.EXECUTING, execution };
  }
}
