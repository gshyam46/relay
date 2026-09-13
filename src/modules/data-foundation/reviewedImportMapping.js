import { parseCsv, CSV_LIMITS, csvError } from "./csvParser.js";
import { PHONE_REGIONS } from "./ingestionContract.js";
import { normalizeImportedValues } from "./normalization.js";
import { validateImportedLead } from "./importValidation.js";
import { CURRENCY_SCALES, emptyEnquiry, exactObject, normalizeEnquiry, dateValue, instant, normalizeMoney } from "../business-context/businessContextContract.js";

export const IMPORT_MAPPING_TARGETS = Object.freeze(["name", "email", "phone", "company", "source", "interest", "location", "country_code", "budget_amount", "budget_minimum", "budget_maximum", "currency", "timeline", "target_date", "enquiry_date", "last_interaction", "observed_at"]);
const ALIASES = {
  name: ["name", "fullname", "contactperson", "customername"], email: ["email", "emailid", "emailaddress"], phone: ["mobile", "phoneno", "whatsapp", "phone"],
  company: ["company", "businessname", "organization"], source: ["source", "leadsource"], interest: ["interest", "productinterest", "serviceinterest", "product", "service"],
  location: ["location", "locality", "city"], country_code: ["countrycode"], budget_amount: ["budget", "budgetamount"], budget_minimum: ["budgetminimum", "minbudget"], budget_maximum: ["budgetmaximum", "maxbudget"],
  currency: ["currency", "budgetcurrency"], timeline: ["timeline", "timing"], target_date: ["targetdate"], enquiry_date: ["enquirydate", "inquirydate"], last_interaction: ["lastinteraction"], observed_at: ["observedat"]
};
export function inspectCsv(csv_text) {
  const parsed = checkedCsv(csv_text);
  const suggested_mapping = {};
  for (const [target, aliases] of Object.entries(ALIASES)) {
    const candidates = parsed.headers.map((label, index) => ({ index, key: label.trim().toLowerCase().replace(/[^a-z0-9]/g, "") })).filter(item => aliases.includes(item.key));
    if (candidates.length === 1) suggested_mapping[target] = candidates[0].index;
  }
  if (Object.hasOwn(suggested_mapping, "budget_amount") && (Object.hasOwn(suggested_mapping, "budget_minimum") || Object.hasOwn(suggested_mapping, "budget_maximum"))) {
    delete suggested_mapping.budget_amount; delete suggested_mapping.budget_minimum; delete suggested_mapping.budget_maximum;
  }
  if (Object.hasOwn(suggested_mapping, "budget_minimum") !== Object.hasOwn(suggested_mapping, "budget_maximum")) { delete suggested_mapping.budget_minimum; delete suggested_mapping.budget_maximum; }
  return { headers: parsed.headers.map((label, index) => ({ index, label, samples: parsed.records.map(row => row.rawCells[index] || "").filter(value => value.trim()).slice(0, 3).map(value => value.slice(0, 160)) })),
    suggested_mapping, row_count: parsed.records.length, limits: CSV_LIMITS };
}
export function buildReviewedCsvPreview({ csv_text, default_phone_region, mapping, options }) {
  const parsed = checkedCsv(csv_text);
  validateMapping(mapping, parsed.headers.length); validateOptions(options, default_phone_region);
  const rows = parsed.records.map(record => {
    const mappedValues = Object.fromEntries(Object.entries(mapping).map(([target, index]) => [target, record.rawCells[index] ?? null]));
    const normalized = normalizeReviewedImportRow(mappedValues, { mapping, options, default_phone_region });
    if (record.rawCells.length !== parsed.headers.length) {
      normalized.validationIssues.push(issue("CSV_COLUMN_COUNT", null, "Row column count differs from the header. Review and correct the mapped values."));
      normalized.validationState = "INVALID";
    }
    return { rowNumber: record.rowNumber, rawRow: record.rawRow, rawCells: record.rawCells, ...normalized };
  });
  return { headers: parsed.headers, headerMap: mapping, rows, parserIssues: [] };
}
export function normalizeReviewedImportRow(mappedValues, { mapping, options, default_phone_region }) {
  validateMapping(mapping); validateOptions(options, default_phone_region);
  exactObject(mappedValues, Object.keys(mapping), "values");
  for (const [field, value] of Object.entries(mappedValues)) if (value !== null && (typeof value !== "string" || value.length > CSV_LIMITS.cell_characters)) throw csvError("INVALID_IMPORT_VALUES", "values." + field + " must be text up to 4096 characters or null.");
  const normalized = normalizeImportedValues(mappedValues, default_phone_region);
  const validationIssues = validateImportedLead(normalized), enquiry = emptyEnquiry();
  const value = key => typeof mappedValues[key] === "string" ? mappedValues[key].trim() : null;
  let observedAt = null;
  if (value("observed_at")) {
    try { observedAt = instant(value("observed_at"), "observed_at"); }
    catch (error) { validationIssues.push(issue("INVALID_ENQUIRY_FACT", "observed_at", error.message)); }
  }
  const source = { assertion: options.assertion, source_type: "MANUAL", source_reference: "Reviewed CSV row", observed_at: observedAt };
  function capture(field, read) {
    try {
      const typed = read();
      if (typed !== null) enquiry[field] = normalizeEnquiry({ ...emptyEnquiry(), [field]: { state: "KNOWN", value: typed, provenance: source } })[field];
    } catch (error) { validationIssues.push(issue("INVALID_ENQUIRY_FACT", field, error.message)); }
  }
  capture("interest", () => value("interest") || null);
  capture("location", () => value("location") || value("country_code") ? { locality: value("location"), country_code: value("country_code") || null } : null);
  capture("timeline", () => value("timeline") || value("target_date") ? { description: value("timeline"), target_date: value("target_date") ? mappedDate(value("target_date"), options.date_format, "target_date") : null } : null);
  capture("enquiry_date", () => value("enquiry_date") ? mappedDate(value("enquiry_date"), options.date_format, "enquiry_date") : null);
  capture("last_interaction", () => value("last_interaction") ? instant(value("last_interaction"), "last_interaction") : null);
  capture("budget", () => {
    const amount = value("budget_amount"), minimum = value("budget_minimum"), maximum = value("budget_maximum"), rowCurrency = value("currency");
    if (!amount && !minimum && !maximum && !rowCurrency) return null;
    return normalizeMoney({ currency: rowCurrency || options.default_currency, minimum: Object.hasOwn(mapping, "budget_amount") ? amount : minimum,
      maximum: Object.hasOwn(mapping, "budget_amount") ? amount : maximum });
  });
  const { _valid_email, _valid_phone, _phone_message, ...identity } = normalized;
  return { mappedValues: { ...mappedValues }, normalizedValues: { ...identity, enquiry }, validationIssues,
    validationState: validationIssues.some(item => item.severity === "ERROR") ? "INVALID" : "VALID" };
}
export function validateMapping(mapping, columnCount = CSV_LIMITS.columns) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) || ![Object.prototype, null].includes(Object.getPrototypeOf(mapping))) throw csvError("INVALID_IMPORT_MAPPING", "mapping must be an object of target fields and column indexes.");
  const used = new Set();
  for (const [field, index] of Object.entries(mapping)) {
    if (!IMPORT_MAPPING_TARGETS.includes(field) || !Number.isInteger(index) || index < 0 || index >= columnCount || used.has(index)) throw csvError("INVALID_IMPORT_MAPPING", "Map each supported target to a distinct existing column index.");
    used.add(index);
  }
  if (!["name", "email", "phone", "company"].some(field => Object.hasOwn(mapping, field))) throw csvError("INVALID_IMPORT_MAPPING", "Map at least one identity or contact field.");
  if ((Object.hasOwn(mapping, "budget_amount") && (Object.hasOwn(mapping, "budget_minimum") || Object.hasOwn(mapping, "budget_maximum"))) || Object.hasOwn(mapping, "budget_minimum") !== Object.hasOwn(mapping, "budget_maximum")) throw csvError("INVALID_IMPORT_MAPPING", "Map either one budget amount or both minimum and maximum.");
  return mapping;
}
export function validateOptions(options, region) {
  exactObject(options, ["date_format", "default_currency", "assertion"], "options");
  if (!["ISO", "DMY", "MDY"].includes(options.date_format) || !["OPERATOR_OBSERVED", "CUSTOMER_STATED", "INFERRED"].includes(options.assertion) || (options.default_currency !== null && !Object.hasOwn(CURRENCY_SCALES, options.default_currency)) || !PHONE_REGIONS.has(region)) throw csvError("INVALID_IMPORT_OPTIONS", "Select a supported date format, currency, source assertion and phone region.");
  return options;
}
function mappedDate(value, format, path) {
  if (format === "ISO") return dateValue(value, path);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw csvError("INVALID_IMPORT_DATE", path + " must follow the selected " + format + " date format with a four-digit year.");
  return dateValue(match[3] + "-" + match[format === "DMY" ? 2 : 1] + "-" + match[format === "DMY" ? 1 : 2], path);
}
function checkedCsv(text) {
  const parsed = parseCsv(text);
  if (parsed.issues.some(item => item.severity === "ERROR")) throw csvError("CSV_MALFORMED", "CSV has a file or quoting error. Correct the file before previewing.");
  return parsed;
}
function issue(issue_type, field, message) { return { issue_type, field, message, severity: "ERROR" }; }
