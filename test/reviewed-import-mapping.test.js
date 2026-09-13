import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, CSV_LIMITS } from "../src/modules/data-foundation/csvParser.js";
import { inspectCsv, buildReviewedCsvPreview, normalizeReviewedImportRow, validateMapping } from "../src/modules/data-foundation/reviewedImportMapping.js";
import { normalizePhone } from "../src/modules/data-foundation/normalization.js";
const options = { date_format: "ISO", default_currency: null, assertion: "OPERATOR_OBSERVED" };
function normalize(values, patch = {}) {
  return normalizeReviewedImportRow(values, { mapping: Object.fromEntries(Object.keys(values).map((key, index) => [key, index])), options: { ...options, ...patch }, default_phone_region: "IN" });
}
function valid(values, patch) { const row = normalize({ name: "Synthetic customer", email: "customer@example.test", ...values }, patch); assert.equal(row.validationState, "VALID", JSON.stringify(row.validationIssues)); return row.normalizedValues; }
function invalid(values, patch) { assert.equal(normalize({ name: "Synthetic customer", email: "customer@example.test", ...values }, patch).validationState, "INVALID"); }

test("positional mapping preserves duplicate, blank and reserved headers without overwriting raw source", () => {
  const csv_text = "__proto__,constructor,Name,Name,,Email\nrecord,constructor text,First,Second,unmapped,person@example.test";
  const inspected = inspectCsv(csv_text);
  assert.deepEqual(inspected.headers.map(item => item.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(Object.hasOwn(inspected.suggested_mapping, "name"), false);
  const preview = buildReviewedCsvPreview({ csv_text, mapping: { name: 3, email: 5 }, options, default_phone_region: "INTERNATIONAL_ONLY" });
  const row = preview.rows[0];
  assert.deepEqual(row.rawCells, ["record", "constructor text", "First", "Second", "unmapped", "person@example.test"]);
  assert.equal(row.rawRow.__proto__, "record"); assert.equal(Object.getPrototypeOf(row.rawRow), Object.prototype);
  assert.equal(row.rawRow.constructor, "constructor text"); assert.equal(Object.hasOwn(row.rawRow, "Name"), false);
  assert.deepEqual(row.mappedValues, { name: "Second", email: "person@example.test" });
  assert.equal(row.normalizedValues.name, "Second"); assert.equal(row.validationState, "VALID");
});

test("inspection suggests only unambiguous aliases and does not assign both budget modes", () => {
  const inspected = inspectCsv("Customer Name,Email,Email Address,Budget,Min Budget,Max Budget\nPerson,a@example.test,b@example.test,10,5,20");
  assert.deepEqual(inspected.suggested_mapping, { name: 0 });
  assert.equal(inspected.row_count, 1); assert.equal(inspected.limits.rows, 1000);
});

test("CSV preserves BOM, Unicode, escaped quotes and physical multiline row numbers", () => {
  const parsed = parseCsv('\uFEFFName,Email,Notes\r\n"Rao, Nisha",nisha@example.test,"Line one\r\nLine ""two"""\r\n\r\n\u0906\u0936\u093e,asha@example.test,record');
  assert.deepEqual(parsed.headers, ["Name", "Email", "Notes"]);
  assert.equal(parsed.records[0].rowNumber, 2); assert.equal(parsed.records[1].rowNumber, 5);
  assert.equal(parsed.records[0].rawCells[2], 'Line one\r\nLine "two"');
  assert.equal(parsed.records[1].rawCells[0], "\u0906\u0936\u093e");
});

test("fatal quoting errors cannot acquire reviewed preview or inspect authority", () => {
  for (const text of ['Name,Email\n"Unclosed,a@example.test', 'Name,Email\n"Name"trailing,a@example.test', 'Name,Email\nUnquoted"name,a@example.test']) {
    assert.throws(() => inspectCsv(text), { code: "CSV_MALFORMED" });
    assert.throws(() => buildReviewedCsvPreview({ csv_text: text, mapping: { name: 0, email: 1 }, options, default_phone_region: "IN" }), { code: "CSV_MALFORMED" });
  }
});

test("parser enforces bytes, cells, columns and data-row caps before materializing oversized data", () => {
  for (const text of ["x".repeat(CSV_LIMITS.bytes + 1), "Name\n" + "x".repeat(4097), Array(65).fill("header").join(","), "Name\n" + Array(1001).fill("Person").join("\n")]) assert.throws(() => parseCsv(text), { statusCode: 413 });
  assert.equal(parseCsv("Name\n" + Array(1000).fill("Person").join("\n")).records.length, 1000);
});

test("short and extra rows need explicit mapped-value correction with raw source preserved", () => {
  const mapping = { name: 0, email: 1 }, args = { mapping, options, default_phone_region: "IN" };
  const preview = buildReviewedCsvPreview({ ...args, csv_text: "Name,Email,Notes\nA,a@example.test\nB,b@example.test,note,extra" });
  assert.equal(preview.rows.every(row => row.validationState === "INVALID"), true);
  assert.equal(preview.rows.every(row => row.validationIssues.some(item => item.issue_type === "CSV_COLUMN_COUNT")), true);
  const corrected = normalizeReviewedImportRow({ name: "A", email: "a@example.test" }, args);
  assert.equal(corrected.validationState, "VALID"); assert.deepEqual(preview.rows[0].rawCells, ["A", "a@example.test"]);
});

test("mapping rejects duplicate indexes, unsupported keys, bounds and incomplete budget modes", () => {
  for (const mapping of [{ name: 0, email: 0 }, { password: 0 }, { name: -1 }, { name: 64 }, { name: 0.5 }, { name: 0, budget_minimum: 1 }, { name: 0, budget_amount: 1, budget_minimum: 2, budget_maximum: 3 }, { interest: 0 }]) assert.throws(() => validateMapping(mapping), { code: "INVALID_IMPORT_MAPPING" });
  assert.throws(() => buildReviewedCsvPreview({ csv_text: "Name\nPerson", mapping: { name: 1 }, options, default_phone_region: "IN" }), { code: "INVALID_IMPORT_MAPPING" });
  assert.throws(() => normalizeReviewedImportRow({ name: "Person", email: "extra@example.test" }, { mapping: { name: 0 }, options, default_phone_region: "IN" }), { code: "INVALID_BUSINESS_CONTEXT" });
});

test("options require explicit supported date, currency, assertion and phone interpretation", () => {
  for (const patch of [{ date_format: "AUTO" }, { default_currency: "ZZZ" }, { assertion: "VERIFIED" }, { unexpected: true }]) assert.throws(() => normalize({ name: "Person" }, patch));
  assert.throws(() => normalizeReviewedImportRow({ name: "Person" }, { mapping: { name: 0 }, options, default_phone_region: "AUTO" }), { code: "INVALID_IMPORT_OPTIONS" });
});

test("phone interpretation rejects letters, extensions, multiple numbers and implicit international-only values", () => {
  for (const text of ["abc9876543210", "9876543210 ext 1", "9876543210/9876543211", "+91 9876543210 +1 4155551234", "98765\n43210"]) assert.equal(normalizePhone(text, "IN").valid, false, text);
  assert.equal(normalizePhone("09876543210", "IN").normalized_phone, "+919876543210");
  assert.equal(normalizePhone("(415) 555-1234", "US").normalized_phone, "+14155551234");
  assert.equal(normalizePhone("9876543210", "INTERNATIONAL_ONLY").valid, false);
  assert.equal(normalizePhone("+91 (98765) 43210", "INTERNATIONAL_ONLY").normalized_phone, "+919876543210");
});

test("date formats are explicit and reject impossible, mixed and two-digit calendar values", () => {
  assert.equal(valid({ enquiry_date: "01/02/2024" }, { date_format: "DMY" }).enquiry.enquiry_date.value, "2024-02-01");
  assert.equal(valid({ enquiry_date: "01/02/2024" }, { date_format: "MDY" }).enquiry.enquiry_date.value, "2024-01-02");
  assert.equal(valid({ enquiry_date: "2024-02-29" }).enquiry.enquiry_date.value, "2024-02-29");
  for (const value of ["2023-02-29", "2024-04-31", "01/02/2024", "01/02/24", "45292"]) invalid({ enquiry_date: value });
  invalid({ enquiry_date: "2024-01-02" }, { date_format: "DMY" });
});

test("source time and last interaction need explicit offsets without copying upload or enquiry dates", () => {
  const result = valid({ interest: "Desk", enquiry_date: "2026-09-12", observed_at: "2026-09-12T12:30:00+05:30", last_interaction: "2026-09-12T12:30:00+05:30" });
  assert.equal(result.enquiry.interest.provenance.observed_at, "2026-09-12T07:00:00.000Z");
  assert.equal(result.enquiry.last_interaction.value, "2026-09-12T07:00:00.000Z");
  assert.equal(valid({ interest: "Desk", enquiry_date: "2026-09-12" }).enquiry.interest.provenance.observed_at, null);
  invalid({ observed_at: "2026-09-12T12:30:00" }); invalid({ last_interaction: "2026-09-12" });
});

test("money preserves 24 minor digits, zero and currency scales as strings", () => {
  const budget = valid({ budget_amount: "9999999999999999999999.99", currency: "INR" }).enquiry.budget;
  assert.equal(budget.value.minimum_minor, "999999999999999999999999"); assert.equal(budget.value.maximum_minor, budget.value.minimum_minor);
  assert.equal(valid({ budget_amount: "0" }, { default_currency: "USD" }).enquiry.budget.value.minimum_minor, "0");
  assert.equal(valid({ budget_amount: "1.234", currency: "KWD" }).enquiry.budget.value.scale, 3);
  assert.equal(valid({ budget_amount: "1", currency: "JPY" }, { default_currency: "USD" }).enquiry.budget.value.currency, "JPY");
  assert.equal(valid({ budget_minimum: "10.01", budget_maximum: "20.02", currency: "INR" }).enquiry.budget.value.maximum_minor, "2002");
});

test("money and partial facts never become invented values or implicit unknowns", () => {
  for (const amount of ["1,000", "$10", "1e3", "-1", "1.234", "99999999999999999999999.99"]) invalid({ budget_amount: amount, currency: "USD" });
  invalid({ budget_amount: "1" }); invalid({ budget_amount: "", currency: "INR" }); invalid({ budget_minimum: "10", budget_maximum: "", currency: "USD" });
  invalid({ budget_minimum: "20", budget_maximum: "10", currency: "USD" }); invalid({ country_code: "IN" }); invalid({ target_date: "2026-09-12" });
  const blank = valid({ interest: " ", budget_amount: "" }, { default_currency: "INR" });
  assert.deepEqual(blank.enquiry.budget, { state: "UNKNOWN", value: null, provenance: null });
  assert.equal(blank.enquiry.enquiry_date.state, "UNKNOWN");
  assert.equal(valid({ interest: "Potential desk" }, { assertion: "INFERRED" }).enquiry.interest.provenance.assertion, "INFERRED");
});

test("entirely blank positional headers are not silently replaced by the first customer row", () => {
  const preview = buildReviewedCsvPreview({ csv_text: ",,\nPerson,person@example.test,source", mapping: { name: 0, email: 1 }, options, default_phone_region: "INTERNATIONAL_ONLY" });
  assert.deepEqual(preview.headers, ["", "", ""]); assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].normalizedValues.name, "Person"); assert.equal(preview.rows[0].rowNumber, 2);
});
