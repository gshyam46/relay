import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  normalizeImportedValues,
  normalizePhone,
  normalizeSource
} from "../src/modules/data-foundation/normalization.js";

test("email normalization trims and lowercases addresses", () => {
  assert.deepEqual(normalizeEmail(" Priya@Example.COM "), {
    value: "priya@example.com",
    valid: true
  });
});

test("phone normalization handles India local and leading-zero values", () => {
  assert.equal(normalizePhone("9876543210", "IN").normalized_phone, "+919876543210");
  assert.equal(normalizePhone("09876543210", "IN").normalized_phone, "+919876543210");
});

test("phone normalization handles US local values", () => {
  assert.equal(normalizePhone("4155551234", "US").normalized_phone, "+14155551234");
});

test("international-only phone normalization requires explicit country code", () => {
  assert.equal(normalizePhone("+91 98765 43210", "INTERNATIONAL_ONLY").normalized_phone, "+919876543210");

  const local = normalizePhone("9876543210", "INTERNATIONAL_ONLY");
  assert.equal(local.valid, false);
  assert.equal(local.normalized_phone, null);
});

test("invalid phone values are rejected during normalization", () => {
  const result = normalizePhone("1234", "IN");

  assert.equal(result.valid, false);
  assert.equal(result.normalized_phone, null);
});

test("source normalization preserves known sources and normalizes unsupported sources", () => {
  assert.equal(normalizeSource("csv"), "CSV");
  assert.equal(normalizeSource("private export"), "EXTERNAL_PROVIDER");
});

test("import normalization preserves raw phone and normalized contact fields", () => {
  const normalized = normalizeImportedValues(
    {
      name: " Priya Sharma ",
      company: " Northstar Interiors ",
      email: " Priya@Example.COM ",
      phone: "09876543210"
    },
    "IN"
  );

  assert.equal(normalized.name, "Priya Sharma");
  assert.equal(normalized.company, "Northstar Interiors");
  assert.equal(normalized.email, "priya@example.com");
  assert.equal(normalized.raw_phone, "09876543210");
  assert.equal(normalized.normalized_phone, "+919876543210");
});
