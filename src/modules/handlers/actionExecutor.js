import { ACTION_STATUS, EXECUTION_STATUS, EXECUTABLE_ACTION_STATUSES } from "../outbound-automation/actionContract.js";

export class ActionExecutor {
  constructor({ actionsRepository, executionsRepository, auditRepository, adapter, channelWorkflowService = null }) {
    this.actionsRepository = actionsRepository;
    this.executionsRepository = executionsRepository;
    this.auditRepository = auditRepository;
    this.adapter = adapter;
    this.channelWorkflowService = channelWorkflowService;
  }

  async execute(action) {
    if (!EXECUTABLE_ACTION_STATUSES.has(action.status)) {
      const latestExecution = await this.executionsRepository.latestForAction(action.id);
      return {
        action_id: action.id,
        status: action.status,
        execution: latestExecution,
        executable: false,
        reason: `Action is ${action.status}.`
      };
    }

    const attempt = await this.executionsRepository.nextAttempt(action.id);
    const payload = this.actionsRepository.actionPayload(action);
    const executionKey = `${action.idempotency_key}:attempt:${attempt}`;
    const result = await this.adapter.invoke(action, payload, attempt);

    if (!result.ok) {
      const status = result.retryable ? ACTION_STATUS.RETRYING : ACTION_STATUS.BLOCKED;
      const execution = await this.executionsRepository.createExecution({
        action_id: action.id,
        status: EXECUTION_STATUS.FAILED,
        attempt,
        provider: "channel-router",
        idempotency_key: executionKey,
        error: result.error
      });
      await this.actionsRepository.updateStatus(action.id, status, { last_error: result.error });
      await this.auditRepository.record({
        organization_id: action.organization_id,
        lead_id: action.lead_id,
        action_id: action.id,
        event_type: "ActionExecutionFailed",
        message: result.error,
        metadata: { retryable: result.retryable, attempt }
      });
      await this.channelWorkflowService?.recordOutboundExecutionAttempt({ action, payload, attempt, result, execution });
      return { action_id: action.id, status, execution, retryable: result.retryable };
    }

    const execution = await this.executionsRepository.createExecution({
      action_id: action.id,
      status: EXECUTION_STATUS.STARTED,
      attempt,
      provider: result.provider,
      provider_reference: result.provider_reference,
      idempotency_key: executionKey
    });
    await this.actionsRepository.updateStatus(action.id, ACTION_STATUS.EXECUTING);
    await this.auditRepository.record({
      organization_id: action.organization_id,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "ActionStarted",
      message: "Action passed through the handler and mock n8n adapter boundary.",
      metadata: { attempt, provider_reference: result.provider_reference }
    });
    await this.channelWorkflowService?.recordOutboundExecutionAttempt({ action, payload, attempt, result, execution });
    return { action_id: action.id, status: ACTION_STATUS.EXECUTING, execution };
  }
}
