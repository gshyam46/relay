import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, serializeCsv } from "../src/shared/csv.js";
import { csvCell as browserCell, serializeCsv as browserCsv } from "../client/src/lib/csv.ts";

test("server and browser CSV display guards cover formula prefixes, controls, Unicode and numeric coercion", () => {
  const dangerous = ["=1+1", "+SUM(A1:A2)", "-1+2", "@SUM(1)", "\t=1", "\r=1", "\n=1", "  =1", "\u200b=1", "\uff1d1", "\uff0b1", "\uff0d1", "\uff20x", "00123", "999999999999999999", "1E12", "0.0100", "\tordinary"];
  for (const value of dangerous) {
    const expected = '"text: ' + value.replace(/"/g, '""') + '"';
    assert.equal(csvCell(value), expected, JSON.stringify(value));
    assert.equal(browserCell(value), expected);
  }
  for (const [value, expected] of [[null, '""'], [undefined, '""'], ["", '""'], ["Customer", '"Customer"'], [42, '"42"'], [-10, '"-10"'], ["{\"phone\":\"+919999999999\"}", '"{""phone"":""+919999999999""}"']]) {
    assert.equal(csvCell(value), expected);
    assert.equal(browserCell(value), expected);
  }
});

test("CSV quotes every field and escapes delimiters, CR/LF and quotes without changing row width", () => {
  const headers = ["Name", "Source"];
  const rows = [['Doe, "Asha"', 'first\rsecond\nthird\r\nfourth'], ['safe",=1', "last"]];
  const expected = '"Name","Source"\r\n"Doe, ""Asha""","first\rsecond\nthird\r\nfourth"\r\n"safe"",=1","last"\r\n';
  assert.equal(serializeCsv(headers, rows), expected);
  assert.equal(browserCsv(headers, rows), expected);
  assert.throws(() => serializeCsv(headers, [["one"]]), /width/);
  assert.throws(() => browserCsv(headers, [["one"]]), /width/);
});
