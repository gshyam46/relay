import { ISSUE_SEVERITIES } from "./ingestionContract.js";

export function validateImportedLead(normalizedValues) {
  const issues = [];
  for (const [field, maximum] of [["name", 200], ["company", 200], ["email", 254], ["raw_phone", 100]]) {
    const value = normalizedValues[field];
    if (value !== null && value !== undefined && (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value))) issues.push(issue("INVALID_FIELD", field, field + " must be at most " + maximum + " characters without control characters."));
  }
  const hasName = Boolean(normalizedValues.name);
  const hasCompany = Boolean(normalizedValues.company);
  const hasEmail = Boolean(normalizedValues.email);
  const hasPhone = Boolean(normalizedValues.normalized_phone);

  if (!normalizedValues._valid_email) {
    issues.push(issue("INVALID_EMAIL", "email", "email must be a valid email address."));
  }

  if (!normalizedValues._valid_phone) {
    issues.push(issue("INVALID_PHONE", "phone", normalizedValues._phone_message || "phone is not valid."));
  }

  const usableIdentity =
    (hasName && hasEmail) || (hasName && hasPhone) || (hasCompany && hasEmail) || (hasCompany && hasPhone);

  if (!usableIdentity) {
    issues.push(
      issue(
        "INSUFFICIENT_IDENTITY",
        null,
        "row needs name + contact or company + contact before it can become a lead."
      )
    );
  }

  return issues;
}

function issue(issueType, field, message) {
  return {
    issue_type: issueType,
    field,
    message,
    severity: ISSUE_SEVERITIES.ERROR
  };
}
