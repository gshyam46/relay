import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/modules/data-foundation/csvParser.js";
import { parseCsvLeadRows } from "../src/modules/data-foundation/csvAdapter.js";

test("CSV adapter recognizes flexible lead headers and preserves extra columns", () => {
  const parsed = parseCsvLeadRows(
    "Contact Person,Phone No.,Business Name,E-mail ID,Notes\nPriya Sharma,9876543210,Northstar Interiors,Priya@Example.COM,Visited showroom"
  );

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].mappedValues.name, "Priya Sharma");
  assert.equal(parsed.rows[0].mappedValues.phone, "9876543210");
  assert.equal(parsed.rows[0].mappedValues.company, "Northstar Interiors");
  assert.equal(parsed.rows[0].mappedValues.email, "Priya@Example.COM");
  assert.equal(parsed.rows[0].rawRow.Notes, "Visited showroom");
});

test("CSV parser handles quoted fields and blank rows", () => {
  const parsed = parseCsv('Name,Company,Email\n"Rao, Nisha","Acme, India",nisha@example.com\n\nKabir,BuildCo,kabir@example.com');

  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].rawRow.Name, "Rao, Nisha");
  assert.equal(parsed.records[0].rawRow.Company, "Acme, India");
  assert.equal(parsed.records[1].rawRow.Name, "Kabir");
});

test("CSV parser records extra columns as warnings without discarding them", () => {
  const parsed = parseCsv("Name,Email\nAsha,asha@example.com,unexpected");

  assert.equal(parsed.records[0].rawRow._extra_1, "unexpected");
  assert.equal(parsed.issues[0].issue_type, "CSV_EXTRA_COLUMNS");
  assert.equal(parsed.issues[0].severity, "WARNING");
});

test("CSV parser reports malformed unterminated quotes", () => {
  const parsed = parseCsv('Name,Email\n"Asha,asha@example.com');

  assert.equal(parsed.issues.some((issue) => issue.issue_type === "CSV_MALFORMED"), true);
});
