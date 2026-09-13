export async function advanceToNextAttempt(services, actionId) {
  const action = await services.actionsRepository.getAction(actionId);
  const due = Date.parse(action.next_attempt_at);
  if (!Number.isFinite(due)) throw new Error("Fixture has no scheduled retry.");
  services.actionExecutor.now = () => due;
}

// Explicit simulated human review for positive fixtures. Nothing auto-approves
// an execution request; negative/stale tests call the real APIs directly.
export async function approveStoredAction(services, action, editedPayload = null) {
  const input = { organization_id: action.organization_id, action_id: action.id };
  let reviewed = await services.approvalsService.currentForAction(input);
  if (editedPayload) {
    reviewed = await services.approvalsService.previewAction({
      ...input, expected_revision_id: reviewed.prepared_revision.id, edited_payload: editedPayload
    });
  }
  return services.approvalsService.approveAction({
    ...input, expected_revision_id: reviewed.prepared_revision.id,
    reviewer_user_id: "fixture-reviewer", reviewer_name: "Fixture reviewer"
  });
}
