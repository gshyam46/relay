export const CONTEXT_SCHEMA_VERSION = 1;
export const MAX_CONTEXT_REVISION = 2147483647;
export const ENQUIRY_FIELDS = Object.freeze(["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"]);
export const CURRENCY_SCALES = Object.freeze({ INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, AED: 2, SAR: 2, JPY: 0, KWD: 3, BHD: 3 });
const PROFILE_ARRAYS = ["offerings", "service_areas", "target_customers", "exclusions", "required_criteria", "preferred_criteria"];
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;

export function contextError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function invalid(path, message) { throw contextError("INVALID_BUSINESS_CONTEXT", path + ": " + message); }
export function textValue(value, path, maximum) {
  if (typeof value !== "string" || CONTROLS.test(value) || !value.trim() || value.trim().length > maximum) invalid(path, "supply text of 1 to " + maximum + " characters without control characters.");
  return value.trim();
}
function nullableText(value, path, maximum) { return value === null ? null : textValue(value, path, maximum); }
export function exactObject(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, "supply an object.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(path, "supply exactly " + keys.join(", ") + ".");
  for (const key of actual) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) invalid(path, "accessors are not accepted.");
  return value;
}
export function boundedSnapshot(value, path) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 32768) invalid(path, "snapshot exceeds 32 KiB.");
  return value;
}
export function emptyProfile() {
  return { business_name: null, offerings: [], service_areas: [], target_customers: [], exclusions: [], required_criteria: [], preferred_criteria: [], preferred_next_step: null, timezone: null, language: null };
}
export function emptyEnquiry() { return Object.fromEntries(ENQUIRY_FIELDS.map(field => [field, { state: "UNKNOWN", value: null, provenance: null }])); }
export function normalizeProfile(input) {
  exactObject(input, Object.keys(emptyProfile()), "profile");
  const result = { business_name: textValue(input.business_name, "profile.business_name", 200) };
  for (const key of PROFILE_ARRAYS) {
    const items = input[key];
    if (!Array.isArray(items) || items.length > 20 || (key === "offerings" && !items.length)) invalid("profile." + key, "supply " + (key === "offerings" ? "1" : "0") + " to 20 entries.");
    result[key] = items.map((value, index) => textValue(value, "profile." + key + "[" + index + "]", 500));
    if (new Set(result[key]).size !== result[key].length) invalid("profile." + key, "duplicate entries are not accepted.");
  }
  result.preferred_next_step = nullableText(input.preferred_next_step, "profile.preferred_next_step", 500);
  result.timezone = nullableText(input.timezone, "profile.timezone", 100);
  if (result.timezone !== null) {
    if (/^[+-]/.test(result.timezone)) invalid("profile.timezone", "supply a supported IANA timezone.");
    try { result.timezone = new Intl.DateTimeFormat("en", { timeZone: result.timezone }).resolvedOptions().timeZone; }
    catch { invalid("profile.timezone", "supply a supported IANA timezone."); }
  }
  result.language = nullableText(input.language, "profile.language", 80);
  return boundedSnapshot(result, "profile");
}
export function normalizeEnquiry(input) {
  exactObject(input, ENQUIRY_FIELDS, "enquiry");
  return boundedSnapshot(Object.fromEntries(ENQUIRY_FIELDS.map(field => [field, fact(input[field], field)])), "enquiry");
}
function fact(input, field) {
  const path = "enquiry." + field;
  if (input?.state === "UNKNOWN") {
    exactObject(input, ["state", "value", "provenance"], path);
    if (input.value !== null || input.provenance !== null) invalid(path, "unknown facts have null value and provenance.");
    return { state: "UNKNOWN", value: null, provenance: null };
  }
  if (input?.state === "KNOWN") {
    exactObject(input, ["state", "value", "provenance"], path);
    return { state: "KNOWN", ...assertion(input, field, path) };
  }
  if (input?.state === "CONFLICTED") {
    exactObject(input, ["state", "alternatives"], path);
    if (!Array.isArray(input.alternatives) || input.alternatives.length < 2 || input.alternatives.length > 5) invalid(path, "supply 2 to 5 conflicting alternatives.");
    const alternatives = input.alternatives.map((item, index) => {
      exactObject(item, ["value", "provenance"], path + ".alternatives[" + index + "]");
      return assertion(item, field, path + ".alternatives[" + index + "]");
    });
    if (new Set(alternatives.map(item => JSON.stringify(item.value))).size !== alternatives.length) invalid(path, "conflicted alternatives must have distinct values.");
    return { state: "CONFLICTED", alternatives };
  }
  invalid(path, "state must be UNKNOWN, KNOWN or CONFLICTED.");
}
function assertion(input, field, path) {
  const source = provenance(input.provenance, path + ".provenance");
  if (source.source_type === "IMPORT_ROW" && source.field !== field) invalid(path + ".provenance.field", "source field must match this enquiry fact.");
  return { value: typedValue(input.value, field, path + ".value"), provenance: source };
}
function provenance(input, path) {
  const imported = input?.source_type === "IMPORT_ROW";
  exactObject(input, ["assertion", "source_type", "source_reference", "observed_at", ...(imported ? ["import_id", "import_row_id", "field"] : [])], path);
  if (!["CUSTOMER_STATED", "OPERATOR_OBSERVED", "INFERRED"].includes(input.assertion) || !["MANUAL", "IMPORT_ROW"].includes(input.source_type)) invalid(path, "use an explicit assertion and MANUAL or IMPORT_ROW source.");
  const result = { assertion: input.assertion, source_type: input.source_type, source_reference: textValue(input.source_reference, path + ".source_reference", 500), observed_at: input.observed_at === null ? null : instant(input.observed_at, path + ".observed_at") };
  if (imported) {
    result.import_id = textValue(input.import_id, path + ".import_id", 256);
    result.import_row_id = textValue(input.import_row_id, path + ".import_row_id", 256);
    if (!ENQUIRY_FIELDS.includes(input.field)) invalid(path + ".field", "use the exact enquiry field.");
    result.field = input.field;
    if (result.source_reference !== "import_row:" + result.import_row_id) invalid(path + ".source_reference", "use the exact import row reference.");
  }
  return result;
}
function typedValue(value, field, path) {
  if (field === "interest") return textValue(value, path, 500);
  if (field === "enquiry_date") return dateValue(value, path);
  if (field === "last_interaction") return instant(value, path);
  if (field === "budget") return normalizeMoney(value, path);
  if (field === "location") {
    exactObject(value, ["locality", "country_code"], path);
    if (value.country_code !== null && (typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code))) invalid(path + ".country_code", "use two uppercase letters or null.");
    return { locality: textValue(value.locality, path + ".locality", 200), country_code: value.country_code };
  }
  exactObject(value, ["description", "target_date"], path);
  return { description: textValue(value.description, path + ".description", 500), target_date: value.target_date === null ? null : dateValue(value.target_date, path + ".target_date") };
}
export function dateValue(value, path = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(Date.parse(value + "T00:00:00.000Z")) || new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) !== value) invalid(path, "supply a real Gregorian YYYY-MM-DD date.");
  return value;
}
export function instant(value, path = "instant", canonical = false) {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid(path, "supply an ISO instant with an explicit offset.");
  dateValue(match[1], path);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || (match[6] !== "Z" && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4)) > 59))) invalid(path, "invalid clock or offset.");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalid(path, "invalid instant.");
  const result = new Date(timestamp).toISOString();
  if (!/^\d{4}-/.test(result) || result.startsWith("0000") || (canonical && result !== value)) invalid(path, "supply canonical UTC with milliseconds.");
  return result;
}
export function normalizeMoney(input, path = "budget") {
  if (!input || typeof input !== "object") invalid(path, "supply a budget object.");
  const canonical = Object.hasOwn(input, "minimum_minor");
  exactObject(input, canonical ? ["currency", "scale", "minimum_minor", "maximum_minor"] : ["currency", "minimum", "maximum"], path);
  if (typeof input.currency !== "string" || !Object.hasOwn(CURRENCY_SCALES, input.currency)) invalid(path + ".currency", "unsupported currency.");
  const scale = CURRENCY_SCALES[input.currency];
  if (canonical && input.scale !== scale) invalid(path + ".scale", "currency scale does not match.");
  const endpoints = ["minimum", "maximum"].map(key => {
    const value = input[canonical ? key + "_minor" : key];
    if (typeof value !== "string" || value.length > 30 || !(canonical ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)(?:\.\d+)?$/).test(value)) invalid(path + "." + key, "use an unsigned exact decimal string.");
    const [whole, fraction = ""] = value.split(".");
    if (!canonical && fraction.length > scale) invalid(path + "." + key, "fractional precision exceeds currency scale.");
    const minor = canonical ? value : (whole + fraction.padEnd(scale, "0")).replace(/^0+(?=\d)/, "");
    if (minor.length > 24) invalid(path + "." + key, "amount exceeds 24 minor-unit digits.");
    return minor;
  });
  if (BigInt(endpoints[0]) > BigInt(endpoints[1])) invalid(path, "minimum exceeds maximum.");
  return { currency: input.currency, scale, minimum_minor: endpoints[0], maximum_minor: endpoints[1] };
}
export function expectedRevision(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CONTEXT_REVISION) invalid("expected_revision", "supply a current non-negative integer revision.");
  return value;
}
export function historyOptions({ before_revision = null, limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid("limit", "use an integer between 1 and 50.");
  if (before_revision !== null && (!Number.isInteger(before_revision) || before_revision < 1 || before_revision > MAX_CONTEXT_REVISION)) invalid("before_revision", "use a positive integer revision.");
  return { before_revision, limit };
}
