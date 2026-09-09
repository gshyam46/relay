export class EmailAdapter {
  constructor({ settingsRepository }) {
    this.settingsRepository = settingsRepository;
  }

  async send(organizationId, { to, subject, body, replyTo, metadata = {} }) {
    const config = await this.settingsRepository.getCategory(organizationId, "channel_email");
    const provider = config.provider || "sandbox";

    if (provider === "sandbox") {
      return this.#sandboxSend({ to, subject, body });
    }
    if (provider === "resend") {
      return await this.#resendSend(config, { to, subject, body, replyTo });
    }
    if (provider === "sendgrid") {
      return await this.#sendgridSend(config, { to, subject, body, replyTo, metadata: { ...metadata, organization_id: organizationId } });
    }
    throw new Error(`Unknown email provider: ${provider}`);
  }

  #sandboxSend({ to, subject, body }) {
    const ref = `sandbox-email-${Date.now()}`;
    console.log(`[EMAIL:SANDBOX] To: ${to} | Subject: ${subject} | Body: ${body?.slice(0, 100)}...`);
    return { ok: true, provider: "sandbox", provider_reference: ref };
  }

  async #resendSend(config, { to, subject, body, replyTo }) {
    const apiKey = config.api_key;
    if (!apiKey) {
      return { ok: false, retryable: false, error: "Resend API key not configured" };
    }
    const from = config.from_email || "onboarding@resend.dev";

    const payload = {
      from,
      to: [to],
      subject,
      html: body,
    };
    if (replyTo) payload.reply_to = replyTo;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `Resend ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = await res.json();
    return { ok: true, provider: "resend", provider_reference: data.id };
  }

  async #sendgridSend(config, { to, subject, body, replyTo, metadata = {} }) {
    const apiKey = config.api_key;
    if (!apiKey) {
      return { ok: false, retryable: false, error: "SendGrid API key not configured" };
    }
    const from = config.from_email || "noreply@example.com";

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: "text/html", value: body }],
    };
    if (replyTo) payload.reply_to = { email: replyTo };
    // SendGrid echoes custom_args back verbatim on every Event Webhook delivery/bounce
    // notification — this is how the webhook maps a delivery event back to our action
    // without trusting anything the caller of the webhook claims about itself.
    if (metadata.organization_id || metadata.action_id) {
      payload.custom_args = {
        ...(metadata.organization_id ? { relay_org_id: metadata.organization_id } : {}),
        ...(metadata.action_id ? { relay_action_id: metadata.action_id } : {}),
      };
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 429;
      return { ok: false, retryable, error: `SendGrid ${res.status}: ${text.slice(0, 300)}` };
    }

    const messageId = res.headers.get("x-message-id") || `sg-${Date.now()}`;
    return { ok: true, provider: "sendgrid", provider_reference: messageId };
  }
}
