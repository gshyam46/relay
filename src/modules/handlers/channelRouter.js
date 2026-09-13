import { CHANNEL_CONFIGURATION, SEND_ACTION_TYPES, fingerprint } from "../outbound-automation/preparedActionContract.js";

export class ChannelRouter {
  constructor({ emailAdapter, smsAdapter, whatsappAdapter, voiceAdapter }) {
    this.adapters = { SEND_EMAIL: emailAdapter, SEND_SMS: smsAdapter, SEND_WHATSAPP: whatsappAdapter, SEND_VOICE_CALL: voiceAdapter };
  }

  async invoke(action, payload, attempt, { approvedDispatch = null, execution_id = null, provider_intent_key = null } = {}) {
    if (action.type === "CREATE_HUMAN_TASK") {
      return { ok: true, provider: "human-task", provider_reference: `human-task:${action.id}:${attempt}` };
    }
    if (!SEND_ACTION_TYPES.has(action.type)) return failed("This action type has no implemented execution handler.");
    const envelope = approvedDispatch?.envelope;
    if (!envelope || !approvedDispatch.revision_id || fingerprint(envelope) !== approvedDispatch.envelope_hash
      || envelope.organization_id !== action.organization_id || envelope.action_id !== action.id || envelope.action_type !== action.type
      || envelope.channel !== CHANNEL_CONFIGURATION[action.type].channel || !envelope.recipient || !envelope.sender) {
      return failed("A verified prepared dispatch snapshot is required.");
    }
    const configuration = approvedDispatch.provider_config;
    if (!configuration || envelope.sender.provider !== (configuration.provider || "sandbox")
      || !CHANNEL_CONFIGURATION[action.type].providers.includes(envelope.sender.provider)) {
      return failed("The prepared sender configuration is invalid.");
    }
    if (payload.mock_behavior === "TRANSIENT_FAIL_ONCE" && attempt === 1) {
      return { ok: false, retryable: true, error: "Explicit synthetic transient failure." };
    }
    if (payload.mock_behavior === "PERMANENT_FAILURE") return failed("Explicit synthetic permanent failure.");
    const provider = envelope.sender.provider;
    const prefix = envelope.channel.toLowerCase();
    if (provider === "sandbox") {
      return { ok: true, provider: prefix + "-sandbox", provider_reference: `${prefix}-sandbox:${action.id}:${attempt}`,
        ...(action.type === "SEND_VOICE_CALL" ? { summary: "Sandbox simulation only. No call was placed." } : {}) };
    }
    if (typeof execution_id !== "string" || !execution_id || typeof provider_intent_key !== "string" || !provider_intent_key) {
      return failed("A persisted execution and provider intent key are required.");
    }
    const adapter = this.adapters[action.type];
    if (!adapter) return failed("The prepared channel adapter is unavailable.");
    const result = await adapter.send(action.organization_id, {
      to: envelope.recipient, subject: envelope.subject, body: envelope.body, message: envelope.body,
      replyTo: envelope.sender.reply_to,
      idempotencyKey: provider_intent_key,
      metadata: { action_id: action.id, revision_id: approvedDispatch.revision_id, execution_id }
    }, { configuration, sender: envelope.sender });
    if (!result.ok) return result;
    return { ...result, provider: prefix + "-" + result.provider,
      ...(action.type === "SEND_VOICE_CALL" ? { summary: "Voice request accepted; connection and spoken content are unconfirmed." } : {}) };
  }
}
function failed(error) { return { ok: false, retryable: false, error }; }
