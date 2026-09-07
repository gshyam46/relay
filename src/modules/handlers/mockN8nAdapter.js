export class MockN8nAdapter {
  invoke(action, payload, attempt) {
    if (payload.mock_behavior === "TRANSIENT_FAIL_ONCE" && attempt === 1) {
      return {
        ok: false,
        retryable: true,
        error: "Mock n8n transient provider failure."
      };
    }

    if (payload.mock_behavior === "PERMANENT_FAILURE") {
      return {
        ok: false,
        retryable: false,
        error: "Mock n8n permanent provider rejection."
      };
    }

    return {
      ok: true,
      provider: "mock-n8n",
      provider_reference: `mock-n8n:${action.id}:${attempt}`
    };
  }
}
