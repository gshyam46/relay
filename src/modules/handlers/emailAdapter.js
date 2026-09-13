import { preparedProvider, providerRequest, providerReference } from "./providerRequest.js";

export class EmailAdapter {
  async send(organizationId, { to, subject, body, replyTo, idempotencyKey = null, metadata = {} },
    { configuration, sender } = {}) {
    const invalid = preparedProvider(configuration, sender, ["resend", "sendgrid"]);
    if (invalid) return invalid;
    if (!configuration.api_key) return { ok: false, retryable: false, error: "The captured email credential is unavailable." };
    const provider = sender.provider;
    if (provider === "sendgrid" && (!metadata.action_id || !metadata.revision_id || !metadata.execution_id)) {
      return { ok: false, retryable: false, error: "SendGrid requires an exact persisted execution and reviewed revision." };
    }
    const payload = provider === "resend"
      ? { from: sender.from, to: [to], subject, text: body, html: textToHtml(body), ...(replyTo ? { reply_to: replyTo } : {}) }
      : {
          personalizations: [{ to: [{ email: to }] }], from: { email: sender.from }, subject,
          content: [{ type: "text/plain", value: body }, { type: "text/html", value: textToHtml(body) }],
          ...(replyTo ? { reply_to: { email: replyTo } } : {}),
          custom_args: {
            relay_org_id: organizationId, relay_action_id: metadata.action_id, relay_execution_id: metadata.execution_id,
            ...(metadata.revision_id ? { relay_revision_id: metadata.revision_id } : {})
          }
        };
    const result = await providerRequest(provider === "resend" ? "https://api.resend.com/emails" : "https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "Authorization": "Bearer " + configuration.api_key,
        ...(provider === "resend" && idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: JSON.stringify(payload)
    }, provider === "resend" ? "Resend" : "SendGrid", { responseMode: provider === "sendgrid" ? "headers" : "json" });
    if (!result.ok) return result;
    const reference = providerReference(provider === "sendgrid" ? result.response.headers?.get("x-message-id") : result.data?.id);
    return { ok: true, provider, provider_reference: reference, response_issue: result.response_issue || (reference ? null : "MISSING_PROVIDER_REFERENCE") };
  }
}

function textToHtml(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", "<br />");
}
