import { ISSUE_SEVERITIES } from "./ingestionContract.js";

export function validateImportedLead(normalizedValues) {
  const issues = [];
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
