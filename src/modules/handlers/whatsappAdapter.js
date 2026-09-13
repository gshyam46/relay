import { preparedProvider, providerRequest, providerReference } from "./providerRequest.js";

export class WhatsAppAdapter {
  async send(_organizationId, { to, body }, { configuration, sender } = {}) {
    const invalid = preparedProvider(configuration, sender, ["meta"]);
    if (invalid) return invalid;
    if (!configuration.api_key) return { ok: false, retryable: false, error: "The captured WhatsApp credential is unavailable." };
    const result = await providerRequest("https://graph.facebook.com/v20.0/" + sender.account_id + "/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + configuration.api_key },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
    }, "Meta WhatsApp");
    if (!result.ok) return result;
    const reference = providerReference(result.data?.messages?.[0]?.id);
    return { ok: true, provider: sender.provider, provider_reference: reference,
      response_issue: result.response_issue || (reference ? null : "MISSING_PROVIDER_REFERENCE") };
  }
}
