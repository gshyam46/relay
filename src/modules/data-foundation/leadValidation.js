export const LEAD_SOURCES = new Set([
  "MANUAL",
  "CSV",
  "GOOGLE_SHEETS",
  "CRM",
  "WEBSITE",
  "FORM",
  "DATABASE",
  "DISCOVERY",
  "EXTERNAL_PROVIDER"
]);

export function validateLeadInput({ name, email, phone, source }) {
  const errors = [];
  const hasValidEmail = Boolean(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push("name is required.");
  }
  if (email && !hasValidEmail) {
    errors.push("email must be a valid email address.");
  }
  if (!hasValidEmail && !phone) {
    errors.push("either email or phone is required for the M0 outbound skeleton.");
  }
  if (source && !LEAD_SOURCES.has(source)) {
    errors.push(`source must be one of: ${Array.from(LEAD_SOURCES).join(", ")}.`);
  }
  return errors;
}
