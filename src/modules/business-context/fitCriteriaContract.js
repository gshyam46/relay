import { boundedSnapshot, contextError, dateValue, exactObject, normalizeMoney, textValue } from "./businessContextContract.js";
export const FIT_CRITERIA_VERSION = 1;
export const FIT_FIELDS = Object.freeze(["interest", "location", "budget", "timeline"]);
export const fitTextKey = value => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase().normalize("NFC");
function invalid(path, message) { throw contextError("INVALID_BUSINESS_CONTEXT", path + ": " + message); }
function aliases(input, path, maximum, minimum = 0) {
  if (!Array.isArray(input) || input.length < minimum || input.length > 20) invalid(path, "supply " + minimum + " to20 entries.");
  const values = input.map((value, index) => fitTextKey(textValue(value, path + "[" + index + "]", maximum)));
  if (new Set(values).size !== values.length) invalid(path, "duplicate normalized aliases are not accepted.");
  return values.sort();
}
function requirement(value, path) { if (!["REQUIRED", "PREFERRED"].includes(value)) invalid(path, "use REQUIRED or PREFERRED."); return value; }
function areas(input, path, minimum = 0) {
  if (!Array.isArray(input) || input.length < minimum || input.length > 20) invalid(path, "supply " + minimum + " to20 areas.");
  return input.map((item, index) => {
    const at = path + "[" + index + "]"; exactObject(item, ["country_code", "locality", "aliases"], at);
    if (typeof item.country_code !== "string" || !/^[A-Z]{2}$/.test(item.country_code)) invalid(at + ".country_code", "use two uppercase letters.");
    const locality = item.locality === null ? null : fitTextKey(textValue(item.locality, at + ".locality", 200));
    const values = aliases(item.aliases, at + ".aliases", 200);
    if ((locality === null && values.length) || values.includes(locality)) invalid(at, "country-wide areas have no aliases; aliases must differ from locality.");
    return { country_code: item.country_code, locality, aliases: values };
  }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
}
function assertDistinctAreas(positive, negative) {
  const all = [...positive, ...negative];
  for (let index = 0; index < all.length; index++) for (let other = index + 1; other < all.length; other++) {
    const a = all[index], b = all[other]; if (a.country_code !== b.country_code) continue;
    if (a.locality === null || b.locality === null || [a.locality, ...a.aliases].some(value => [b.locality, ...b.aliases].includes(value))) invalid("fit_criteria.location", "overlapping geography rules are not accepted.");
  }
}
export function normalizeFitCriteria(input) {
  if (input === null) return null;
  exactObject(input, ["version", ...FIT_FIELDS], "fit_criteria");
  if (input.version !== FIT_CRITERIA_VERSION) invalid("fit_criteria.version", "unsupported criteria version.");
  const result = { version: FIT_CRITERIA_VERSION };
  for (const field of FIT_FIELDS) {
    const rule = input[field], path = "fit_criteria." + field; if (rule === null) { result[field] = null; continue; }
    const keys = { interest: ["accepted_aliases", "excluded_aliases"], location: ["areas", "excluded_areas"], budget: ["currency", "minimum"], timeline: ["earliest_date", "latest_date"] }[field];
    exactObject(rule, ["requirement", ...keys], path); const required = requirement(rule.requirement, path + ".requirement");
    if (field === "interest") {
      const accepted_aliases = aliases(rule.accepted_aliases, path + ".accepted_aliases", 500, 1), excluded_aliases = aliases(rule.excluded_aliases, path + ".excluded_aliases", 500);
      if (accepted_aliases.some(value => excluded_aliases.includes(value))) invalid(path, "positive and excluded aliases overlap.");
      result[field] = { requirement: required, accepted_aliases, excluded_aliases };
    } else if (field === "location") {
      const accepted = areas(rule.areas, path + ".areas", 1), excluded = areas(rule.excluded_areas, path + ".excluded_areas"); assertDistinctAreas(accepted, excluded);
      result[field] = { requirement: required, areas: accepted, excluded_areas: excluded };
    } else if (field === "budget") {
      const amount = normalizeMoney({ currency: rule.currency, minimum: rule.minimum, maximum: rule.minimum }, path), digits = amount.minimum_minor.padStart(amount.scale + 1, "0");
      result[field] = { requirement: required, currency: amount.currency, minimum: amount.scale ? digits.slice(0, -amount.scale) + "." + digits.slice(-amount.scale) : digits };
    } else {
      const earliest_date = rule.earliest_date === null ? null : dateValue(rule.earliest_date, path + ".earliest_date"), latest_date = rule.latest_date === null ? null : dateValue(rule.latest_date, path + ".latest_date");
      if ((!earliest_date && !latest_date) || (earliest_date && latest_date && earliest_date > latest_date)) invalid(path, "supply at least one bound in ascending order.");
      result[field] = { requirement: required, earliest_date, latest_date };
    }
  }
  if (!FIT_FIELDS.some(field => result[field]?.requirement === "REQUIRED")) invalid("fit_criteria", "configure at least one REQUIRED criterion or explicitly disable criteria with null.");
  return boundedSnapshot(result, "fit_criteria");
}
