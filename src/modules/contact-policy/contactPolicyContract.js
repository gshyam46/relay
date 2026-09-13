const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
export const CONTACT_CHANNELS = Object.freeze(["EMAIL", "WHATSAPP", "SMS", "VOICE"]);
export const RESTRICTION_REASONS = Object.freeze(["OPT_OUT", "SUPPRESSED", "UNSUBSCRIBE", "COMPLAINT", "HARD_BOUNCE", "DELIVERY_REVIEW"]);
export const RESTRICTION_SOURCES = Object.freeze(["INBOUND_EVENT", "PROVIDER_EVENT", "MANUAL", "LEGACY_STATUS", "LEGACY_INBOUND", "LEGACY_PROVIDER"]);
export const ACTION_FOR_CHANNEL = Object.freeze({ EMAIL: "SEND_EMAIL", WHATSAPP: "SEND_WHATSAPP", SMS: "SEND_SMS", VOICE: "SEND_VOICE_CALL" });

export function canonicalContact(kind, raw) {
  if (typeof raw !== "string") return null;
  const value = kind === "EMAIL" ? raw.trim().toLowerCase()
    : kind === "PHONE" ? raw.trim().replace(/[\s().-]/g, "") : raw.trim();
  if (kind === "EMAIL" && EMAIL.test(value)) return { kind, value };
  if (kind === "PHONE" && PHONE.test(value)) return { kind, value };
  if (kind === "LEAD" && value) return { kind, value };
  return null;
}

export function canonicalContactsForLead(lead) {
  if (!lead) return [];
  const values = [
    canonicalContact("LEAD", lead.id),
    canonicalContact("EMAIL", lead.normalized_email),
    canonicalContact("EMAIL", lead.email),
    canonicalContact("PHONE", lead.normalized_phone),
    canonicalContact("PHONE", lead.phone)
  ].filter(Boolean);
  return values.filter((contact, index) => values.findIndex((other) =>
    other.kind === contact.kind && other.value === contact.value) === index);
}

export function recipientForLead(lead, channel) {
  const kind = channel === "EMAIL" ? "EMAIL" : ["WHATSAPP", "SMS", "VOICE"].includes(channel) ? "PHONE" : null;
  return kind ? canonicalContactsForLead(lead).find((contact) => contact.kind === kind) || null : null;
}

export function channelsForRestriction(restriction) {
  const possible = restriction.contact_kind === "EMAIL" ? ["EMAIL"]
    : restriction.contact_kind === "PHONE" ? ["WHATSAPP", "SMS", "VOICE"] : CONTACT_CHANNELS;
  return restriction.channel === "ALL" ? [...CONTACT_CHANNELS] : possible.filter((channel) => channel === restriction.channel);
}

export function policyError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
