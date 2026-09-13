import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { AuthService } from "../src/modules/auth/authService.js";
import { AuthRepository } from "../src/modules/auth/authRepository.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../src/modules/auth/passwords.js";
import { getSessionCookie, setSessionCookie, clearSessionCookie } from "../src/shared/cookies.js";

const INPUT = { organization_name: "Synthetic workspace", name: "Synthetic owner", email: "synthetic@example.test", password: "safe-synthetic-passphrase" };
async function fixture(t) {
  const db = await createDatabase(":memory:"); t.after(() => db.close()); const counters = { hash: 0, verify: 0, dummy: 0 };
  const authRepository = new AuthRepository(db), leadsRepository = new LeadsRepository(db);
  const service = new AuthService({ authRepository, leadsRepository, auditRepository: new AuditRepository(db), passwords: {
    hashPassword: async (password) => { counters.hash++; assert.ok(await db.get("SELECT id FROM auth_admission_state")); return hashPassword(password); },
    verifyPassword: async (password, stored) => { counters.verify++; if (stored === DUMMY_PASSWORD_HASH) counters.dummy++; return verifyPassword(password, stored); }
  } });
  return { db, service, counters, authRepository, count: async (table) => Number((await db.get("SELECT COUNT(*) AS n FROM " + table)).n) };
}

test("auth field and UTF-8 password bounds reject before password work or writes", async (t) => {
  const f = await fixture(t);
  for (const patch of [{ organization_name: "x".repeat(201) }, { name: "x".repeat(121) }, { email: "x".repeat(255) + "@example.test" }, { password: String.fromCodePoint(0xe9).repeat(513) }]) {
    await assert.rejects(f.service.register({ ...INPUT, ...patch }), { statusCode: 400 });
  }
  await assert.rejects(f.service.login({ email: INPUT.email, password: "x".repeat(1025) }), { statusCode: 400 });
  assert.equal(f.counters.hash, 0); assert.equal(f.counters.verify, 0); assert.equal(await f.count("organizations"), 0);
});

test("registration session and audit failures roll back workspace, user and session together", async (t) => {
  for (const table of ["sessions", "audit_logs"]) await t.test(table, async (t) => {
    const f = await fixture(t);
    await f.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'synthetic registration failure'); END");
    await assert.rejects(f.service.register(INPUT));
    for (const table of ["organizations", "users", "sessions", "audit_logs"]) assert.equal(await f.count(table), 0, table);
    assert.equal(f.counters.hash, 1);
  });
});

test("simultaneous duplicate registration creates one complete workspace and no orphan", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.service.register(INPUT), f.service.register({ ...INPUT, email: "SYNTHETIC@EXAMPLE.TEST" })]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected" && item.reason.statusCode === 400).length, 1);
  for (const table of ["organizations", "users", "sessions", "audit_logs"]) assert.equal(await f.count(table), 1, table);
  const stored = await f.db.get("SELECT password_hash FROM users"); assert.equal(await verifyPassword(INPUT.password, stored.password_hash), true);
});

test("unknown user and wrong password both verify once and return the same public rejection", async (t) => {
  const f = await fixture(t); await f.service.register(INPUT);
  const outcomes = await Promise.allSettled([f.service.login({ email: INPUT.email, password: "wrong-passphrase" }), f.service.login({ email: "unknown@example.test", password: "wrong-passphrase" })]);
  assert.equal(f.counters.verify, 2); assert.equal(f.counters.dummy, 1);
  assert.equal(outcomes[0].reason.statusCode, 401); assert.equal(outcomes[1].reason.statusCode, 401);
  assert.equal(outcomes[0].reason.message, outcomes[1].reason.message);
  assert.equal(await f.count("sessions"), 1);
});

test("invalid stored password hashes and oversized passwords cannot authorize a session", async () => {
  for (const hash of [null, "salt:00", DUMMY_PASSWORD_HASH + ":extra", "x".repeat(20000)]) assert.equal(await verifyPassword(INPUT.password, hash), false);
  await assert.rejects(hashPassword("x".repeat(1025)), { statusCode: 400 });
  await assert.rejects(verifyPassword("x".repeat(1025), DUMMY_PASSWORD_HASH), { statusCode: 400 });
});

test("invalid, noncanonical and expired session timestamps fail closed", async () => {
  let calls = 0, expiry;
  const repo = new AuthRepository({ get: async () => { calls++; return { id: "synthetic", expires_at: expiry }; } });
  for (const value of [null, "not-a-date", "9999-99-99T00:00:00.000Z", "2999-01-01T00:00:00Z", "1970-01-01T00:00:00.000Z"]) {
    expiry = value; assert.equal(await repo.getValidSession("synthetic"), null);
  }
  expiry = "2999-01-01T00:00:00.000Z"; assert.ok(await repo.getValidSession("synthetic"));
  const before = calls; assert.equal(await repo.getValidSession("x".repeat(129)), null); assert.equal(calls, before);
});

test("malformed or duplicate session cookies are unauthenticated and secure attributes remain intact", () => {
  for (const cookie of ["relay_session=%GG", "relay_session=%00secret", "relay_session=", "relay_session=one; relay_session=two", "relay_session=" + "x".repeat(129)]) {
    assert.equal(getSessionCookie({ headers: { cookie } }), null);
  }
  assert.equal(getSessionCookie({ headers: { cookie: "unrelated=value; relay_session=synthetic" } }), "synthetic");
  const headers = new Map(), response = { getHeader: (key) => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
  setSessionCookie(response, "synthetic", { secure: true }); clearSessionCookie(response, { secure: true });
  for (const cookie of headers.get("Set-Cookie")) for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) assert.ok(cookie.includes(flag));
});
