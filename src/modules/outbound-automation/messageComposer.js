/**
 * Composes the customer-facing copy for an outbound message.
 *
 * Why this exists: an outbound action's payload carried only `title` and
 * `rationale`, which are internal — "Prepare outbound review", "Use the
 * evidence-backed intelligence to prepare the next outbound review". The channel
 * router falls back to `rationale` for the message body, so the sandbox
 * conversation thread read like an audit log and, once a real email provider was
 * configured, that internal reasoning is what would have been emailed to the
 * lead.
 *
 * Grounding rule, same as the intelligence agents: this only ever states things
 * that are in the lead's own record. It personalises with the name and company we
 * were given and names the channel they came in through. It never invents a
 * product, a price, a timeline, a mutual contact, or a claim about the lead's
 * intent. Anything it cannot ground, it leaves out — a shorter message is
 * correct, an invented one is not.
 *
 * This is deliberately deterministic, matching `localSynthesisAgent` and
 * `localRecommendationAgent`: the product must produce a sane, sendable message
 * with no LLM configured. An LLM-backed composer can implement the same
 * signature later.
 */

const CHANNEL_SOURCE_PHRASE = {
  WEB_FORM: "your enquiry through our website",
  CSV_IMPORT: "your enquiry",
  MANUAL: "your enquiry",
  EMAIL: "your email",
  WHATSAPP: "your message",
  SMS: "your message",
  PHONE: "your call",
  EXTERNAL_PROVIDER: "your enquiry"
};

/**
 * @returns {{subject: string, message: string}}
 */
export function composeOutboundMessage({ lead, actionType, organizationName = null, replyContext = null }) {
  const firstName = firstNameOf(lead?.name);
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const signOff = organizationName ? `Thanks,\n${organizationName}` : "Thanks";
  const source = CHANNEL_SOURCE_PHRASE[lead?.source] || "your enquiry";

  // A reply changes what the right thing to say is, so the composer reads the
  // classified intent rather than sending the same opener regardless.
  if (replyContext?.event_type === "QUESTION") {
    return {
      subject: subjectFor(lead, "Re: your question"),
      message: [
        greeting,
        "",
        "Thanks for getting back to us — happy to answer that.",
        "",
        "One of our team will come back to you shortly with the specifics you asked about. If it is easier to talk it through, let us know a time that suits you and we will call.",
        "",
        signOff
      ].join("\n")
    };
  }

  if (replyContext?.event_type === "POSITIVE_REPLY") {
    return {
      subject: subjectFor(lead, "Next steps"),
      message: [
        greeting,
        "",
        "Great to hear from you. Let us get the next step booked in.",
        "",
        "Reply with a couple of times that suit you this week and we will confirm one.",
        "",
        signOff
      ].join("\n")
    };
  }

  if (actionType === "SEND_SMS" || actionType === "SEND_WHATSAPP") {
    // Short-form channels get one line, not a letter.
    return {
      subject: subjectFor(lead, "Following up"),
      message: firstName
        ? `Hi ${firstName}, following up on ${source}. Is there a good time this week for a quick chat? — ${organizationName || "our team"}`
        : `Hello, following up on ${source}. Is there a good time this week for a quick chat? — ${organizationName || "our team"}`
    };
  }

  if (actionType === "SEND_VOICE_CALL") {
    return {
      subject: subjectFor(lead, "Call"),
      message: firstName
        ? `Hello ${firstName}, this is a call from ${organizationName || "our team"} following up on ${source}. We wanted to check what you are looking for and whether now is a good time to talk.`
        : `Hello, this is a call from ${organizationName || "our team"} following up on ${source}.`
    };
  }

  return {
    subject: subjectFor(lead, "Following up on your enquiry"),
    message: [
      greeting,
      "",
      `Thanks for ${source}${lead?.company ? ` on behalf of ${lead.company}` : ""}.`,
      "",
      "I wanted to check in and understand what you are looking for, so we can point you at the right options rather than sending you a generic brochure.",
      "",
      "What would be most useful to you first? Replying to this email reaches us directly.",
      "",
      signOff
    ].join("\n")
  };
}

function subjectFor(lead, fallback) {
  return lead?.company ? `${fallback} — ${lead.company}` : fallback;
}

function firstNameOf(name) {
  if (typeof name !== "string") {
    return null;
  }
  const first = name.trim().split(/\s+/)[0];
  if (!first) {
    return null;
  }
  // Avoid greeting someone by an email address or a placeholder that came in
  // through an import.
  if (first.includes("@") || /^(unknown|n\/a|na|lead|customer|new)$/i.test(first)) {
    return null;
  }
  return first;
}
