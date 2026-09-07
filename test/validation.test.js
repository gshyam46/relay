import test from "node:test";
import assert from "node:assert/strict";
import { validateLeadInput } from "../src/modules/data-foundation/leadValidation.js";
import { validateActionInput } from "../src/modules/outbound-automation/actionContract.js";

test("lead validation accepts an M0-ready lead", () => {
  assert.deepEqual(
    validateLeadInput({
      name: "Ananya Kapoor",
      email: "ananya@example.com",
      phone: "",
      source: "MANUAL"
    }),
    []
  );
});

test("lead validation rejects missing contact, malformed email, and unsupported source", () => {
  const errors = validateLeadInput({
    name: "No Contact",
    email: "bad-email",
    phone: "",
    source: "PRIVATE_DATABASE_EXPORT"
  });

  assert.match(errors.join(" "), /valid email/);
  assert.match(errors.join(" "), /either email or phone/);
  assert.match(errors.join(" "), /source must be one of/);
});

test("action validation accepts supported mock execution inputs", () => {
  assert.deepEqual(validateActionInput({ type: "SEND_EMAIL", mock_behavior: "TRANSIENT_FAIL_ONCE" }), []);
});

test("action validation rejects unsupported action contracts", () => {
  const errors = validateActionInput({ type: "CALL_PHONE", mock_behavior: "DOUBLE_SEND" });

  assert.match(errors.join(" "), /type must be one of/);
  assert.match(errors.join(" "), /mock_behavior must be one of/);
});
