import { preparedProvider, providerRequest, providerReference } from "./providerRequest.js";

export class SmsAdapter {
  async send(_organizationId, { to, body }, { configuration, sender } = {}) {
    const invalid = preparedProvider(configuration, sender, ["twilio"]);
    if (invalid) return invalid;
    if (!configuration.account_sid || !configuration.auth_token) {
      return { ok: false, retryable: false, error: "The captured SMS account credential is unavailable." };
    }
    const result = await providerRequest(
      "https://api.twilio.com/2010-04-01/Accounts/" + sender.account_id + "/Messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + Buffer.from(sender.account_id + ":" + configuration.auth_token).toString("base64") },
        body: new URLSearchParams({ To: to, From: sender.from, Body: body })
      }, "Twilio SMS");
    if (!result.ok) return result;
    const reference = providerReference(result.data?.sid);
    return { ok: true, provider: sender.provider, provider_reference: reference,
      response_issue: result.response_issue || (reference ? null : "MISSING_PROVIDER_REFERENCE") };
  }
}
