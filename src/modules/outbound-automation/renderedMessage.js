// Resolve customer-facing copy once by the same rules at dispatch and in the
// conversation record. Internal planning reasons are never message fallbacks.
// Immutable approval revisions remain separate L1-08 work.
export function subjectFor(payload = {}) {
  const explicit = firstText([
    payload.human_review?.edited_payload?.subject, payload.subject, payload.email_subject
  ]);
  return explicit ? explicit.trim().slice(0, 200) : "A quick question";
}

export function bodyFor(payload = {}) {
  return firstText([
    payload.human_review?.edited_payload?.instruction,
    payload.human_review?.edited_payload?.message,
    payload.message
  ]) || "Would you be open to a conversation?";
}

function firstText(values) {
  return values.find((value) => typeof value === "string" && value.trim());
}
