export const LEAD_SOURCES = new Set([
  "MANUAL", "CSV", "GOOGLE_SHEETS", "CRM", "WEBSITE", "FORM",
  "DATABASE", "DISCOVERY", "EXTERNAL_PROVIDER"
]);

// Enquiry capture belongs to Lead Intelligence. Contact eligibility is checked
// independently when a particular outbound action is prepared and dispatched.
export function validateLeadInput({ name, email, phone, company, source }) {
  const errors = [];
  const controls = /[\u0000-\u001f\u007f-\u009f]/u;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 200 || controls.test(name)) {
    errors.push("name requires 1 to 200 characters without control characters.");
  }
  if (company != null && (typeof company !== "string" || company.trim().length > 200 || controls.test(company))) {
    errors.push("company requires at most 200 characters without control characters.");
  }
  if (email != null && email !== "" && (typeof email !== "string" || email.trim().length > 320 || controls.test(email) || (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))) {
    errors.push("email must be a valid email address of at most 320 characters.");
  }
  if (phone != null && (typeof phone !== "string" || phone.length > 80 || controls.test(phone))) {
    errors.push("phone requires at most 80 characters without control characters.");
  }
  if (source && !LEAD_SOURCES.has(source)) {
    errors.push("source must be one of: " + Array.from(LEAD_SOURCES).join(", ") + ".");
  }
  return errors;
}
