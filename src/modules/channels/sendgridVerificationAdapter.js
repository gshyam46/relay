import { assessEmailConfiguration } from "./emailConnectionContract.js";
import { providerRequest } from "../handlers/providerRequest.js";
import { CHECK_IDS, emptyChecks, keyFingerprint, parseChecks } from "./emailVerificationContract.js";

// Read-only, fixed-host inspection. No provider-controlled URLs are fetched.
export class SendgridVerificationAdapter {
  constructor({ request = providerRequest } = {}) { this.request = request; }
  async check({ configuration, events_url, inbound_url }) {
    const result = emptyChecks(), config = configuration;
    if (config?.provider !== "sendgrid" || !assessEmailConfiguration(config).complete) return emptyChecks("CONFIGURATION_INVALID");
    const request = async path => {
      try { return await this.request("https://api.sendgrid.com/v3" + path, { method: "GET", headers: { Authorization: "Bearer " + config.api_key, Accept: "application/json" } }, "SendGrid verification"); }
      catch { return { ok: false, uncertain: true }; }
    };
    const set = (id, status, code, response) => { result.checks[CHECK_IDS.indexOf(id)] = { id, status, code, http_status: response?.response?.status || response?.http_status || null }; };
    const readable = (id, response) => {
      if (!response?.ok || response.response_issue || response.data == null) {
        set(id, response?.http_status === 401 ? "FAIL" : "UNKNOWN", response?.http_status === 401 ? "CREDENTIAL_REJECTED" : response?.http_status === 403 ? "READ_PERMISSION_UNAVAILABLE" : "PROVIDER_READ_UNAVAILABLE", response); return false;
      }
      return true;
    };
    let response = await request("/scopes");
    if (readable("credential", response)) {
      const scopes = response.data?.scopes;
      if (!Array.isArray(scopes) || scopes.length > 2000 || scopes.some(v => typeof v !== "string" || v.length > 200)) set("credential", "UNKNOWN", "PROVIDER_RESPONSE_INVALID", response);
      else set("credential", scopes.includes("mail.send") ? "PASS" : "FAIL", scopes.includes("mail.send") ? "MAIL_SEND_SCOPE_PRESENT" : "MAIL_SEND_SCOPE_MISSING", response);
    }
    // A rejected credential is not a reason to make four more requests.
    if (result.checks[0].status !== "PASS") return result;
    const senderDomain = config.from_email.toLowerCase().split("@")[1], replyDomain = config.reply_to.toLowerCase().split("@")[1];
    response = await request("/whitelabel/domains?domain=" + encodeURIComponent(senderDomain) + "&limit=100&offset=0&exclude_subusers=true");
    if (readable("sender_domain", response)) {
      const rows = response.data;
      if (!Array.isArray(rows) || rows.length >= 100) set("sender_domain", "UNKNOWN", "DOMAIN_RESULT_UNBOUNDED", response);
      else { const exact = rows.filter(row => row?.domain === senderDomain); const valid = exact.length === 1 && exact[0].valid === true;
        set("sender_domain", valid ? "PASS" : "FAIL", valid ? "AUTHENTICATED_SENDER_DOMAIN" : "SENDER_DOMAIN_NOT_CONFIRMED", response); }
    }
    response = await request("/user/webhooks/event/settings/all");
    if (readable("event_webhook", response)) {
      const rows = response.data?.webhooks;
      if (!Array.isArray(rows) || rows.length > 100) set("event_webhook", "UNKNOWN", "WEBHOOK_RESULT_UNBOUNDED", response);
      else { const exact = rows.filter(row => row?.url === events_url); const row = exact[0];
        const valid = exact.length === 1 && row.enabled === true && ["delivered", "bounce", "dropped", "spam_report", "unsubscribe", "group_unsubscribe"].every(key => row[key] === true) && keyFingerprint(row.public_key) === keyFingerprint(config.sendgrid_events_public_key);
        set("event_webhook", valid ? "PASS" : "FAIL", valid ? "SIGNED_EVENT_ROUTE_MATCHES" : "SIGNED_EVENT_ROUTE_MISMATCH", response); }
    }
    response = await request("/user/webhooks/parse/settings/" + encodeURIComponent(replyDomain));
    let policy = null;
    if (readable("inbound_parse", response)) {
      const row = response.data;
      const valid = row?.hostname === replyDomain && row.url === inbound_url && row.send_raw === false && typeof row.security_policy === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(row.security_policy);
      set("inbound_parse", valid ? "PASS" : "FAIL", valid ? "SIGNED_PARSE_ROUTE_MATCHES" : "SIGNED_PARSE_ROUTE_MISMATCH", response);
      if (valid) policy = row.security_policy;
    }
    if (policy) {
      response = await request("/user/webhooks/security/policies/" + encodeURIComponent(policy));
      if (readable("inbound_signature", response)) { const row = response.data?.policy; const valid = row?.id === policy && keyFingerprint(row.signature?.public_key) === keyFingerprint(config.sendgrid_inbound_public_key);
        set("inbound_signature", valid ? "PASS" : "FAIL", valid ? "PARSE_SIGNING_KEY_MATCHES" : "PARSE_SIGNING_KEY_MISMATCH", response); }
    }
    return parseChecks(JSON.stringify(result));
  }
}
