import { LEAD_SOURCES } from "./leadValidation.js";
import { createHash } from "node:crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNATIONAL_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeEmail(value) {
  const normalized = normalizeString(value)?.toLowerCase() || null;
  return {
    value: normalized,
    valid: !normalized || EMAIL_PATTERN.test(normalized)
  };
}

export function normalizePhone(rawPhone, defaultPhoneRegion) {
  const raw = normalizeString(rawPhone);
  if (!raw) {
    return {
      raw_phone: null,
      normalized_phone: null,
      valid: true,
      message: null
    };
  }

  if (raw.length > 100 || !/^\+?[0-9 ()\t.-]+$/.test(raw) || /[\r\n]/.test(raw)) {
    return { raw_phone: raw, normalized_phone: null, valid: false, message: "phone must contain one number without letters, extensions or multiple contacts." };
  }
  const compact = raw.replace(/[\s().-]/g, "");
  if (compact.startsWith("+")) {
    return {
      raw_phone: raw,
      normalized_phone: INTERNATIONAL_PHONE_PATTERN.test(compact) ? compact : null,
      valid: INTERNATIONAL_PHONE_PATTERN.test(compact),
      message: INTERNATIONAL_PHONE_PATTERN.test(compact) ? null : "phone must be a valid international number."
    };
  }

  if (defaultPhoneRegion === "INTERNATIONAL_ONLY") {
    return {
      raw_phone: raw,
      normalized_phone: null,
      valid: false,
      message: "phone must include an explicit country code."
    };
  }

  const digits = compact;
  if (defaultPhoneRegion === "IN") {
    const local = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
    const valid = /^\d{10}$/.test(local);
    return {
      raw_phone: raw,
      normalized_phone: valid ? `+91${local}` : null,
      valid,
      message: valid ? null : "phone must be a 10 digit India number or valid international number."
    };
  }

  if (defaultPhoneRegion === "US") {
    const valid = /^\d{10}$/.test(digits);
    return {
      raw_phone: raw,
      normalized_phone: valid ? `+1${digits}` : null,
      valid,
      message: valid ? null : "phone must be a 10 digit US number or valid international number."
    };
  }

  return {
    raw_phone: raw,
    normalized_phone: null,
    valid: false,
    message: "default phone region is not supported."
  };
}

export function normalizeSource(value) {
  const normalized = normalizeString(value)?.toUpperCase().replaceAll(" ", "_").replaceAll("-", "_") || null;
  if (!normalized) {
    return "CSV";
  }
  return LEAD_SOURCES.has(normalized) ? normalized : "EXTERNAL_PROVIDER";
}

export function normalizeImportedValues(mappedValues, defaultPhoneRegion) {
  const email = normalizeEmail(mappedValues.email);
  const phone = normalizePhone(mappedValues.phone, defaultPhoneRegion);
  return {
    name: normalizeString(mappedValues.name),
    company: normalizeString(mappedValues.company),
    email: email.value,
    raw_phone: phone.raw_phone,
    normalized_phone: phone.normalized_phone,
    source: normalizeSource(mappedValues.source || "CSV"),
    _valid_email: email.valid,
    _valid_phone: phone.valid,
    _phone_message: phone.message
  };
}

export function buildNameCompanyKey(name, company) {
  const normalizedName = normalizeString(name)?.toLowerCase() || null;
  const normalizedCompany = normalizeString(company)?.toLowerCase() || null;
  if (!normalizedName || !normalizedCompany) {
    return null;
  }
  return `${normalizedName}|${normalizedCompany}`;
}

// Bounded candidate lookup shared by SQLite/PostgreSQL; not a person identity.
export function buildNameCompanyLookupKey(name, company) {
  const key = buildNameCompanyKey(name, company);
  return key === null ? null : createHash("sha256").update(key).digest("hex");
}
