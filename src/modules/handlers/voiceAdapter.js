import { preparedProvider, providerRequest, providerReference } from "./providerRequest.js";

export class VoiceAdapter {
  async send(_organizationId, { to, message }, { configuration, sender } = {}) {
    const invalid = preparedProvider(configuration, sender, ["twilio_voice"]);
    if (invalid) return invalid;
    if (!configuration.account_sid || !configuration.auth_token) {
      return { ok: false, retryable: false, error: "The captured voice account credential is unavailable." };
    }
    const result = await providerRequest("https://api.twilio.com/2010-04-01/Accounts/" + sender.account_id + "/Calls.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(sender.account_id + ":" + configuration.auth_token).toString("base64") },
      body: new URLSearchParams({ To: to, From: sender.from, Twiml: "<Response><Say>" + escapeXml(message) + "</Say></Response>" })
    }, "Twilio Voice");
    if (!result.ok) return result;
    const reference = providerReference(result.data?.sid);
    return { ok: true, provider: sender.provider, provider_reference: reference,
      response_issue: result.response_issue || (reference ? null : "MISSING_PROVIDER_REFERENCE") };
  }
}
function escapeXml(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
