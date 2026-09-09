export class WhatsAppAdapter {
  constructor({ settingsRepository }) {
    this.settingsRepository = settingsRepository;
  }

  async send(organizationId, { to, body }) {
    const config = await this.settingsRepository.getCategory(organizationId, "channel_whatsapp");
    const provider = config.provider || "sandbox";

    if (provider === "sandbox") {
      return this.#sandboxSend({ to, body });
    }
    if (provider === "meta") {
      return await this.#metaSend(config, { to, body });
    }
    throw new Error(`Unknown WhatsApp provider: ${provider}`);
  }

  #sandboxSend({ to, body }) {
    const ref = `sandbox-whatsapp-${Date.now()}`;
    console.log(`[WHATSAPP:SANDBOX] To: ${to} | Body: ${body?.slice(0, 140)}`);
    return { ok: true, provider: "sandbox", provider_reference: ref };
  }

  async #metaSend(config, { to, body }) {
    const accessToken = config.api_key;
    const phoneNumberId = config.phone_number_id;
    if (!accessToken || !phoneNumberId) {
      return { ok: false, retryable: false, error: "Meta WhatsApp access token and phone number ID are required." };
    }
    if (!to) {
      return { ok: false, retryable: false, error: "Lead has no phone number to send WhatsApp to." };
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body || "" }
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `Meta WhatsApp ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    return { ok: true, provider: "meta", provider_reference: data.messages?.[0]?.id };
  }
}
