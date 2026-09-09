export class VoiceAdapter {
  constructor({ settingsRepository }) {
    this.settingsRepository = settingsRepository;
  }

  async send(organizationId, { to, message }) {
    const config = await this.settingsRepository.getCategory(organizationId, "channel_call");
    const provider = config.provider || "sandbox";

    if (provider === "sandbox") {
      return this.#sandboxSend({ to, message });
    }
    if (provider === "twilio_voice") {
      return await this.#twilioSend(config, { to, message });
    }
    if (provider === "livekit") {
      // LiveKit is a real-time media SFU, not a simple outbound-call REST API — placing an actual
      // call through it needs a running LiveKit agent worker, not just an HTTP request. That's a
      // materially different (and larger) integration than the other channels here, so it's left
      // as a documented gap rather than a fake "ok: true" response.
      return { ok: false, retryable: false, error: "LiveKit voice calling requires a running LiveKit agent worker — not yet wired." };
    }
    throw new Error(`Unknown voice provider: ${provider}`);
  }

  #sandboxSend({ to, message }) {
    const ref = `sandbox-voice-${Date.now()}`;
    console.log(`[VOICE:SANDBOX] To: ${to} | Message: ${message?.slice(0, 140)}`);
    return { ok: true, provider: "sandbox", provider_reference: ref };
  }

  async #twilioSend(config, { to, message }) {
    const accountSid = config.account_sid;
    const authToken = config.auth_token;
    const from = config.from_number;
    if (!accountSid || !authToken || !from) {
      return { ok: false, retryable: false, error: "Twilio account SID, auth token, and from number are required." };
    }
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to call." };
    }

    // Inline TwiML avoids needing a public webhook URL just to say a message on the call.
    const twiml = `<Response><Say>${escapeXml(message || "Hello, this is an automated call.")}</Say></Response>`;
    const params = new URLSearchParams({ To: to, From: from, Twiml: twiml });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
      },
      body: params
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `Twilio Voice ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    return { ok: true, provider: "twilio_voice", provider_reference: data.sid };
  }
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
