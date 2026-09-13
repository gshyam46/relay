import { isUnsafeSourceText } from "../ai/grounding.js";

/**
 * Neutral draft only: source/company fields and a reply classification do not
 * establish an enquiry, representation, prior exchange or operating promise.
 * Rich replies require the reviewed conversation/business-context contract in L4.
 * Composition is not send authorization; dispatch policy must run separately.
 */
export function composeOutboundMessage({ lead, actionType, replyContext = null }) {
  if (["OPTED_OUT", "SUPPRESSED"].includes(lead?.status) || replyContext?.event_type === "OPT_OUT") {
    throw new Error("Contact is restricted; an outbound draft cannot be composed.");
  }
  const firstName = firstNameOf(lead?.name);
  const greeting = firstName ? "Hi " + firstName + "," : "Hello,";
  const signOff = "Thanks";
  const subject = "A quick question";
  const question = "Would you be open to a conversation?";

  if (actionType === "SEND_SMS" || actionType === "SEND_WHATSAPP") {
    return { subject, message: greeting + " " + question };
  }
  if (actionType === "SEND_VOICE_CALL") {
    return { subject: "Conversation", message: greeting + " Is now a suitable time to talk?" };
  }
  return { subject, message: [greeting, "", question, "", signOff].join("\n") };
}

function safeLabel(value) {
  if (isUnsafeSourceText(value) || value.length > 100 ||
      !/^[\p{L}\p{M}\p{N} '&().,-]+$/u.test(value)) return null;
  return value.trim();
}

function firstNameOf(name) {
  const label = safeLabel(name);
  if (!label) return null;
  const first = label.split(/\s+/)[0];
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'-]{0,39}$/u.test(first) ||
      /^(unknown|na|lead|customer|new|ignore|system|assistant|developer)$/i.test(first)) return null;
  return first;
}
