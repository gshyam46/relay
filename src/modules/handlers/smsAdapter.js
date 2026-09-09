export class SmsAdapter {
  constructor({ settingsRepository }) {
    this.settingsRepository = settingsRepository;
  }

  async send(organizationId, { to, body }) {
    const config = await this.settingsRepository.getCategory(organizationId, "channel_sms");
    const provider = config.provider || "sandbox";

    if (provider === "sandbox") {
      return this.#sandboxSend({ to, body });
    }
    if (provider === "twilio") {
      return await this.#twilioSend(config, { to, body });
    }
    throw new Error(`Unknown SMS provider: ${provider}`);
  }

  #sandboxSend({ to, body }) {
    const ref = `sandbox-sms-${Date.now()}`;
    console.log(`[SMS:SANDBOX] To: ${to} | Body: ${body?.slice(0, 140)}`);
    return { ok: true, provider: "sandbox", provider_reference: ref };
  }

  async #twilioSend(config, { to, body }) {
    const accountSid = config.account_sid;
    const authToken = config.auth_token;
    const from = config.from_number;
    if (!accountSid || !authToken || !from) {
      return { ok: false, retryable: false, error: "Twilio account SID, auth token, and from number are required." };
    }
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to send SMS to." };
    }

    const params = new URLSearchParams({ To: to, From: from, Body: body || "" });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
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
      return { ok: false, retryable, error: `Twilio SMS ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    return { ok: true, provider: "twilio", provider_reference: data.sid };
  }
}
