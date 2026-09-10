export class ChannelRouter {
  constructor({ emailAdapter, smsAdapter, whatsappAdapter, voiceAdapter, settingsRepository, leadsRepository }) {
    this.emailAdapter = emailAdapter;
    this.smsAdapter = smsAdapter;
    this.whatsappAdapter = whatsappAdapter;
    this.voiceAdapter = voiceAdapter;
    this.settingsRepository = settingsRepository;
    this.leadsRepository = leadsRepository;
  }

  async invoke(action, payload, attempt) {
    const type = action.type;
    if (type === "SEND_EMAIL") {
      return await this.#routeEmail(action, payload, attempt);
    }
    if (type === "SEND_WHATSAPP") {
      return await this.#routeWhatsApp(action, payload, attempt);
    }
    if (type === "SEND_SMS") {
      return await this.#routeSms(action, payload, attempt);
    }
    if (type === "SEND_VOICE_CALL") {
      return await this.#routeVoice(action, payload, attempt);
    }
    if (type === "CREATE_HUMAN_TASK") {
      return this.#routeHumanTask(action, payload, attempt);
    }
    return {
      ok: true,
      provider: "channel-router",
      provider_reference: `routed:${action.id}:${attempt}`,
    };
  }

  async #routeEmail(action, payload, attempt) {
    const mockResult = mockBehaviorResult(payload, attempt, "email");
    if (mockResult) return mockResult;

    const emailConfig = await this.settingsRepository.getCategory(action.organization_id, "channel_email");
    const provider = emailConfig.provider || "sandbox";

    if (provider === "sandbox" || !this.emailAdapter) {
      console.log(`[CHANNEL:EMAIL:SANDBOX] action=${action.id} lead=${action.lead_id} attempt=${attempt}`);
      return {
        ok: true,
        provider: "email-sandbox",
        provider_reference: `email-sandbox:${action.id}:${attempt}`,
      };
    }

    const lead = await this.leadsRepository?.getLead(action.lead_id);
    const to = lead?.normalized_email || lead?.email;
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no email address to send to." };
    }
    const result = await this.emailAdapter.send(action.organization_id, {
      to,
      subject: subjectFor(payload, lead),
      body: bodyFor(payload),
      // The action id is stable across retries of the same action, so a provider
      // that honours an idempotency key will not deliver twice if we retry after
      // a timeout that actually succeeded.
      idempotencyKey: `relay-action-${action.id}`,
      metadata: { action_id: action.id },
    });
    return normalizeAdapterResult(result, `email-${provider}`, action, attempt);
  }

  async #routeWhatsApp(action, payload, attempt) {
    const mockResult = mockBehaviorResult(payload, attempt, "WhatsApp");
    if (mockResult) return mockResult;

    const waConfig = await this.settingsRepository.getCategory(action.organization_id, "channel_whatsapp");
    const provider = waConfig.provider || "sandbox";

    if (provider === "sandbox" || !this.whatsappAdapter) {
      console.log(`[CHANNEL:WHATSAPP:SANDBOX] action=${action.id} lead=${action.lead_id} attempt=${attempt}`);
      return {
        ok: true,
        provider: "whatsapp-sandbox",
        provider_reference: `whatsapp-sandbox:${action.id}:${attempt}`,
      };
    }

    const lead = await this.leadsRepository?.getLead(action.lead_id);
    const to = lead?.normalized_phone || lead?.phone;
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to send WhatsApp to." };
    }
    const result = await this.whatsappAdapter.send(action.organization_id, { to, body: bodyFor(payload) });
    return normalizeAdapterResult(result, `whatsapp-${provider}`, action, attempt);
  }

  async #routeSms(action, payload, attempt) {
    const mockResult = mockBehaviorResult(payload, attempt, "SMS");
    if (mockResult) return mockResult;

    const smsConfig = await this.settingsRepository.getCategory(action.organization_id, "channel_sms");
    const provider = smsConfig.provider || "sandbox";

    if (provider === "sandbox" || !this.smsAdapter) {
      console.log(`[CHANNEL:SMS:SANDBOX] action=${action.id} lead=${action.lead_id} attempt=${attempt}`);
      return {
        ok: true,
        provider: "sms-sandbox",
        provider_reference: `sms-sandbox:${action.id}:${attempt}`
      };
    }

    const lead = await this.leadsRepository?.getLead(action.lead_id);
    const to = lead?.normalized_phone || lead?.phone;
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to send SMS to." };
    }
    const result = await this.smsAdapter.send(action.organization_id, { to, body: bodyFor(payload) });
    return normalizeAdapterResult(result, `sms-${provider}`, action, attempt);
  }

  async #routeVoice(action, payload, attempt) {
    const mockResult = mockBehaviorResult(payload, attempt, "voice call");
    if (mockResult) return mockResult;

    const callConfig = await this.settingsRepository.getCategory(action.organization_id, "channel_call");
    const provider = callConfig.provider || "sandbox";
    const sandboxTranscript =
      "Sandbox voice agent: called lead, introduced Relay, and offered to schedule a follow-up. Lead acknowledged and call ended normally.";

    if (provider === "sandbox" || !this.voiceAdapter) {
      console.log(`[CHANNEL:VOICE:SANDBOX] action=${action.id} lead=${action.lead_id} attempt=${attempt}`);
      return {
        ok: true,
        provider: "voice-sandbox",
        provider_reference: `voice-sandbox:${action.id}:${attempt}`,
        summary: sandboxTranscript
      };
    }

    const lead = await this.leadsRepository?.getLead(action.lead_id);
    const to = lead?.normalized_phone || lead?.phone;
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to call." };
    }
    const message = bodyFor(payload);
    const result = await this.voiceAdapter.send(action.organization_id, { to, message });
    return normalizeAdapterResult(result, `voice-${provider}`, action, attempt, `Call placed. Said: ${message}`);
  }

  #routeHumanTask(action, payload, attempt) {
    console.log(`[CHANNEL:HUMAN_TASK] action=${action.id} lead=${action.lead_id} title=${payload.title || "N/A"}`);
    return {
      ok: true,
      provider: "human-task",
      provider_reference: `human-task:${action.id}:${attempt}`,
    };
  }
}

function mockBehaviorResult(payload, attempt, label) {
  if (payload.mock_behavior === "TRANSIENT_FAIL_ONCE" && attempt === 1) {
    return { ok: false, retryable: true, error: `Transient ${label} failure (mock)` };
  }
  if (payload.mock_behavior === "PERMANENT_FAILURE") {
    return { ok: false, retryable: false, error: `Permanent ${label} failure (mock)` };
  }
  return null;
}

/**
 * A real subject line.
 *
 * This used to be `bodyFor(payload)` — the same text as the body — so a real
 * email went out with its entire message as the subject. An explicit subject on
 * the payload wins; otherwise fall back to something short and human that names
 * the company when we know it.
 */
function subjectFor(payload, lead) {
  const explicit =
    payload.human_review?.edited_payload?.subject || payload.subject || payload.email_subject;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().slice(0, 200);
  }
  return lead?.company ? `Following up with ${lead.company}` : "Following up on your enquiry";
}

function bodyFor(payload, fallback = "Outbound activity prepared from the recommended next step.") {
  return payload.human_review?.edited_payload?.instruction || payload.message || payload.rationale || payload.reason || fallback;
}

function normalizeAdapterResult(result, providerLabel, action, attempt, summary = null) {
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    provider: result.provider ? `${providerLabel.split("-")[0]}-${result.provider}` : providerLabel,
    provider_reference: result.provider_reference || `${providerLabel}:${action.id}:${attempt}`,
    ...(summary ? { summary } : {})
  };
}
