import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { AuthService } from "../src/modules/auth/authService.js";
import { AuthRepository } from "../src/modules/auth/authRepository.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { AccountSecurityService } from "../src/modules/auth/accountSecurityService.js";
import { RECOVERY_CODE_TTL_MS, sessionPublicId } from "../src/modules/auth/accountSecurityContract.js";
import { hashPassword, verifyPassword } from "../src/modules/auth/passwords.js";
const PASSWORD = "synthetic-original-passphrase", NEXT = "synthetic-new-passphrase";
const registration = { organization_name: "Synthetic security workspace", name: "Synthetic owner", email: "security@example.test", password: PASSWORD };
async function fixture(t) {
  const db = await createDatabase(":memory:"); t.after(() => db.close());
  const authRepository = new AuthRepository(db), leadsRepository = new LeadsRepository(db), auth = new AuthService({ authRepository, leadsRepository });
  const registered = await auth.register(registration);
  let clock = Date.now();
  const security = new AccountSecurityService(db, { now: () => clock, passwords: {
    hashPassword: async value => { assert.ok(await db.get("SELECT id FROM auth_admission_state")); return hashPassword(value); },
    verifyPassword: async (value, hash) => { assert.ok(await db.get("SELECT id FROM auth_admission_state")); return verifyPassword(value, hash); }
  } });
  const scope = { organization_id: registered.organization.id, actor: registered.user, session_id: registered.session.id };
  const command = (patch = {}) => ({ ...scope, expected_security_revision: 0, current_password: PASSWORD, ...patch });
  const count = async table => Number((await db.get("SELECT COUNT(*) n FROM " + table)).n);
  const login = async (password = PASSWORD) => auth.login({ email: registration.email, password });
  const recovery = (code, password = NEXT) => security.recover({ email: registration.email, recovery_code: code, new_password: password });
  return { db, auth, security, authRepository, registered, scope, command, count, login, recovery, time: () => clock, at: value => { clock = value; } };
}
async function capture(f) {
  return { user: await f.db.get("SELECT password_hash,auth_revision FROM users WHERE id=?", [f.scope.actor.id]),
    sessions: await f.db.all("SELECT * FROM sessions ORDER BY id"), state: await f.db.all("SELECT * FROM account_security_state"),
    codes: await f.db.all("SELECT * FROM account_recovery_codes ORDER BY id"), changes: await f.db.all("SELECT * FROM account_security_changes ORDER BY revision") };
}
async function refreshScope(f, password = PASSWORD) { const logged = await f.login(password); f.scope.actor = logged.user; f.scope.session_id = logged.session.id; f.at(Date.now()); return logged; }
function barrier() { let release, entered; const waiting = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; }); return { release, entered, waiting, ready }; }

test("initial security inspection is read-only and exposes references rather than bearer sessions", async t => {
  const f = await fixture(t), before = await capture(f), view = await f.security.get(f.scope);
  assert.equal(view.security_revision, 0); assert.equal(view.auth_revision, 0); assert.equal(view.session_limit, 100);
  assert.deepEqual(view.recovery, { generation: 0, usable_count: 0, expires_at: null });
  assert.equal(view.sessions.length, 1); assert.equal(view.sessions[0].current, true);
  assert.equal(view.sessions[0].public_id, sessionPublicId(f.scope.session_id));
  assert.equal(JSON.stringify(view).includes(f.scope.session_id), false); assert.equal(JSON.stringify(view).includes(PASSWORD), false);
  assert.deepEqual(await capture(f), before);
});

test("recovery rotation exposes eight independent codes once and stores no plaintext in state or history", async t => {
  const f = await fixture(t), result = await f.security.rotateRecoveryCodes(f.command());
  assert.equal(result.sign_in_required, false); assert.equal(result.recovery_codes.length, 8); assert.equal(new Set(result.recovery_codes).size, 8);
  assert.equal(result.change.authentication_method, "PASSWORD"); assert.equal(result.change.recovery_codes_issued, 8);
  for (const code of result.recovery_codes) assert.match(code, /^rcv_[A-Za-z0-9_-]{43}$/);
  const view = await f.security.get(f.scope); assert.equal(view.recovery.usable_count, 8); assert.equal(view.recovery.generation, 1);
  assert.equal(Date.parse(view.recovery.expires_at), f.time() + RECOVERY_CODE_TTL_MS);
  const persisted = JSON.stringify(await capture(f)) + JSON.stringify(await f.db.all("SELECT metadata_json FROM audit_logs"));
  const publicHistory = JSON.stringify(view) + JSON.stringify(await f.security.history(f.scope));
  for (const secret of [PASSWORD, ...result.recovery_codes]) { assert.equal(persisted.includes(secret), false); assert.equal(publicHistory.includes(secret), false); }
  assert.equal(publicHistory.includes(f.scope.session_id), false);
  await assert.rejects(f.security.rotateRecoveryCodes(f.command()), { code: "AUTH_SECURITY_REVISION_STALE" });
  assert.equal(await f.count("account_recovery_codes"), 8);
});

test("wrong password, strict client fields and account/session/tenant mismatches cannot change security", async t => {
  const f = await fixture(t), before = await capture(f);
  await assert.rejects(f.security.rotateRecoveryCodes(f.command({ current_password: "wrong-synthetic" })), { code: "AUTH_PASSWORD_REJECTED", statusCode: 403 });
  assert.ok(await f.auth.requireSession(f.scope.session_id), "A mistyped current password must retain the valid signed-in session.");
  await assert.rejects(f.security.changePassword(f.command({ new_password: "short" })), { code: "AUTH_SECURITY_INPUT_INVALID" });
  await assert.rejects(f.security.rotateRecoveryCodes(f.command({ request_key: "unsupported-secret-intent" })), { code: "AUTH_SECURITY_INPUT_INVALID" });
  await assert.rejects(f.security.get({ ...f.scope, session_id: "fake-session" }), { code: "AUTH_SESSION_INVALID" });
  await assert.rejects(f.security.get({ ...f.scope, actor: { ...f.scope.actor, id: "another-user" } }), { code: "AUTH_SESSION_INVALID" });
  const foreign = await f.auth.register({ ...registration, email: "foreign@example.test", organization_name: "Other synthetic workspace" });
  await assert.rejects(f.security.get({ ...f.scope, organization_id: foreign.organization.id }), { code: "AUTH_SESSION_INVALID" });
  await assert.rejects(f.security.revokeSession(f.command({ session_public_id: foreign.session.public_id })), { code: "AUTH_SESSION_NOT_FOUND" });
  assert.deepEqual((await capture(f)).user, before.user);
  assert.equal(await f.count("account_security_changes"), 0);
});

test("password change atomically revokes every session and preserves the owner's existing role", async t => {
  const f = await fixture(t), second = await f.login(); f.at(Date.now());
  const rotated = await f.security.rotateRecoveryCodes(f.command());
  const result = await f.security.changePassword(f.command({ expected_security_revision: 1, new_password: NEXT }));
  assert.equal(result.sign_in_required, true); assert.equal(result.change.revoked_session_count, 2);
  assert.equal(await f.count("sessions"), 0);
  for (const token of [f.scope.session_id, second.session.id]) await assert.rejects(f.auth.requireSession(token), { statusCode: 401 });
  await assert.rejects(f.login(PASSWORD), { statusCode: 401 });
  const logged = await refreshScope(f, NEXT); assert.equal(logged.user.role, "OWNER"); assert.equal(logged.session.auth_revision, 1);
  assert.equal((await f.security.get(f.scope)).recovery.usable_count, rotated.recovery_codes.length);
});

test("offline recovery consumes one code, revokes all sessions and requires fresh login", async t => {
  const f = await fixture(t), issued = await f.security.rotateRecoveryCodes(f.command());
  await f.login();
  const result = await f.recovery(issued.recovery_codes[0]);
  assert.equal(result.sign_in_required, true); assert.equal(result.change.authentication_method, "RECOVERY_CODE");
  assert.equal(result.change.revoked_session_count, 2); assert.equal(Object.hasOwn(result, "session"), false);
  assert.equal(await f.count("sessions"), 0); await assert.rejects(f.login(PASSWORD), { statusCode: 401 });
  await refreshScope(f, NEXT);
  assert.equal((await f.security.get(f.scope)).recovery.usable_count, 7);
  await assert.rejects(f.recovery(issued.recovery_codes[0], "another-synthetic-password"), { code: "AUTH_RECOVERY_REJECTED" });
  assert.equal(await f.count("account_security_changes"), 2);
});

test("racing redemption of the same code can change credentials only once", async t => {
  const f = await fixture(t), issued = await f.security.rotateRecoveryCodes(f.command());
  const passwords = ["winning-candidate-one", "winning-candidate-two"];
  const results = await Promise.allSettled(passwords.map(password => f.recovery(issued.recovery_codes[0], password)));
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "AUTH_RECOVERY_REJECTED");
  assert.equal(await f.count("account_security_changes"), 2); assert.equal(await f.count("sessions"), 0);
  const winner = results.findIndex(item => item.status === "fulfilled"); await f.login(passwords[winner]);
  await assert.rejects(f.login(passwords[1 - winner]), { statusCode: 401 });
});

test("rotation and exact expiry reject old codes with the same generic recovery response", async t => {
  const f = await fixture(t), old = await f.security.rotateRecoveryCodes(f.command());
  const current = await f.security.rotateRecoveryCodes(f.command({ expected_security_revision: 1 }));
  const failures = [];
  for (const input of [
    { email: registration.email, recovery_code: old.recovery_codes[0] },
    { email: "absent@example.test", recovery_code: current.recovery_codes[0] },
    { email: registration.email, recovery_code: "rcv_" + "a".repeat(43) }
  ]) { try { await f.security.recover({ ...input, new_password: NEXT }); assert.fail("Recovery unexpectedly succeeded"); } catch (error) { failures.push({ code: error.code, message: error.message, status: error.statusCode }); } }
  f.at(Date.parse(current.change.recovery_expires_at));
  try { await f.recovery(current.recovery_codes[0]); assert.fail("Expired recovery unexpectedly succeeded"); } catch (error) { failures.push({ code: error.code, message: error.message, status: error.statusCode }); }
  for (const failure of failures) assert.deepEqual(failure, failures[0]);
  assert.equal(failures[0].code, "AUTH_RECOVERY_REJECTED"); assert.equal(await f.count("account_security_changes"), 2);
  assert.equal(await verifyPassword(PASSWORD, (await capture(f)).user.password_hash), true);
});

test("security audit failure rolls back password, revision and session revocation", async t => {
  const f = await fixture(t), before = await capture(f);
  await f.db.exec("CREATE TRIGGER fail_security_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='AccountSecurityChanged' BEGIN SELECT RAISE(ABORT,'synthetic account audit failure'); END");
  await assert.rejects(f.security.changePassword(f.command({ new_password: NEXT })));
  assert.deepEqual(await capture(f), before); assert.ok(await f.auth.requireSession(f.scope.session_id));
  await f.db.exec("DROP TRIGGER fail_security_audit");
  await f.security.changePassword(f.command({ new_password: NEXT })); assert.equal(await f.count("sessions"), 0);
});

test("failed recovery does not spend the code or detach sessions and can retry after repair", async t => {
  const f = await fixture(t), issued = await f.security.rotateRecoveryCodes(f.command()), before = await capture(f);
  await f.db.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='AccountSecurityChanged' BEGIN SELECT RAISE(ABORT,'synthetic recovery audit failure'); END");
  await assert.rejects(f.recovery(issued.recovery_codes[0])); assert.deepEqual(await capture(f), before);
  await f.db.exec("DROP TRIGGER fail_recovery_audit");
  await f.recovery(issued.recovery_codes[0]);
  assert.equal(Number((await f.db.get("SELECT COUNT(*) n FROM account_recovery_codes WHERE consumed_at IS NOT NULL")).n), 1);
});

test("concurrent code rotations use one expected security revision and publish only one set", async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.security.rotateRecoveryCodes(f.command()), f.security.rotateRecoveryCodes(f.command())]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "AUTH_SECURITY_REVISION_STALE");
  assert.equal(await f.count("account_recovery_codes"), 8); assert.equal(await f.count("account_security_changes"), 1);
});

test("single-session and revoke-others commands preserve only their declared session authority", async t => {
  const f = await fixture(t), second = await f.login(), third = await f.login(); f.at(Date.now());
  const first = await f.security.revokeSession(f.command({ session_public_id: second.session.public_id }));
  assert.equal(first.sign_in_required, false); assert.equal(first.change.revoked_session_count, 1);
  await assert.rejects(f.auth.requireSession(second.session.id), { statusCode: 401 }); assert.ok(await f.auth.requireSession(third.session.id));
  const others = await f.security.revokeOtherSessions(f.command({ expected_security_revision: 1 }));
  assert.equal(others.sign_in_required, false); assert.equal(others.change.revoked_session_count, 1);
  assert.equal(await f.count("sessions"), 1); assert.ok(await f.auth.requireSession(f.scope.session_id));
  assert.equal((await f.security.get(f.scope)).auth_revision, 1);
  await assert.rejects(f.auth.requireSession(third.session.id), { statusCode: 401 });
  const all = await f.security.revokeAllSessions(f.command({ expected_security_revision: 2 }));
  assert.equal(all.sign_in_required, true); assert.equal(await f.count("sessions"), 0);
});

test("revoking the current public session reference signs that session out", async t => {
  const f = await fixture(t), result = await f.security.revokeSession(f.command({ session_public_id: f.registered.session.public_id }));
  assert.equal(result.sign_in_required, true); await assert.rejects(f.auth.requireSession(f.scope.session_id), { statusCode: 401 });
  assert.equal(await f.count("account_security_changes"), 1);
});

test("login verified before a password reset cannot issue a session after the reset commits", async t => {
  const f = await fixture(t), blocked = barrier();
  const racing = new AuthService({ authRepository: f.authRepository, leadsRepository: new LeadsRepository(f.db), passwords: {
    hashPassword, verifyPassword: async (password, hash) => { const result = await verifyPassword(password, hash); blocked.entered(); await blocked.waiting; return result; }
  } });
  const pending = racing.login({ email: registration.email, password: PASSWORD });
  await blocked.ready;
  await f.security.changePassword(f.command({ new_password: NEXT }));
  blocked.release(); await assert.rejects(pending, { code: "AUTH_CONTEXT_CHANGED" });
  assert.equal(await f.count("sessions"), 0); assert.ok(await f.login(NEXT));
});

test("revoke-others fences a previously verified concurrent login without invalidating the retained session", async t => {
  const f = await fixture(t), blocked = barrier();
  const racing = new AuthService({ authRepository: f.authRepository, leadsRepository: new LeadsRepository(f.db), passwords: {
    hashPassword, verifyPassword: async (password, hash) => { const result = await verifyPassword(password, hash); blocked.entered(); await blocked.waiting; return result; }
  } });
  const pending = racing.login({ email: registration.email, password: PASSWORD }); await blocked.ready;
  await f.security.revokeOtherSessions(f.command()); blocked.release();
  await assert.rejects(pending, { code: "AUTH_CONTEXT_CHANGED" }); assert.ok(await f.auth.requireSession(f.scope.session_id));
  assert.equal(await f.count("sessions"), 1);
});

test("an old authentication revision cannot be restored by re-inserting only a stale session row", async t => {
  const f = await fixture(t), saved = f.registered.session;
  await f.security.revokeAllSessions(f.command());
  await f.db.run("INSERT INTO sessions(id,public_id,user_id,organization_id,created_at,expires_at,auth_revision) VALUES(?,?,?,?,?,?,?)", [saved.id,saved.public_id,saved.user_id,saved.organization_id,saved.created_at,saved.expires_at,0]);
  await assert.rejects(f.auth.requireSession(saved.id), { statusCode: 401 });
  assert.ok(await f.login());
});

test("active session capacity stays bounded and an existing session can release it", async t => {
  const f = await fixture(t);
  for (let index = 1; index < 100; index++) await f.authRepository.createSession({ user_id: f.scope.actor.id, organization_id: f.scope.organization_id });
  f.at(Date.now());
  assert.equal((await f.security.get(f.scope)).sessions.length, 100);
  await assert.rejects(f.login(), { code: "AUTH_SESSION_LIMIT" });
  await f.security.revokeOtherSessions(f.command()); assert.equal(await f.count("sessions"), 1); assert.ok(await f.login());
});

test("security history pagination and strict public projection preserve safe records", async t => {
  const f = await fixture(t);
  for (let revision = 0; revision < 3; revision++) await f.security.rotateRecoveryCodes(f.command({ expected_security_revision: revision }));
  const first = await f.security.history({ ...f.scope, limit: 2 });
  assert.deepEqual(first.history.changes.map(row => row.revision), [3, 2]); assert.equal(first.history.next_before_revision, 2);
  const second = await f.security.history({ ...f.scope, before_revision: 2, limit: 2 }); assert.deepEqual(second.history.changes.map(row => row.revision), [1]); assert.equal(second.history.has_more, false);
  await assert.rejects(f.security.history({ ...f.scope, limit: 100 }), { code: "AUTH_SECURITY_INPUT_INVALID" });
  await f.db.run("UPDATE account_security_changes SET summary_json=? WHERE revision=1", [JSON.stringify({ secret: "not-a-public-history-field" })]);
  await assert.rejects(f.security.history(f.scope), { code: "AUTH_SECURITY_STATE_INVALID" });
});

test("existing non-owner role behavior is preserved and stale actor roles do not authorize security commands", async t => {
  const f = await fixture(t); await f.db.run("UPDATE users SET role='MEMBER' WHERE id=?", [f.scope.actor.id]);
  assert.equal((await f.auth.requireSession(f.scope.session_id)).user.role, "MEMBER");
  assert.equal((await f.login()).user.role, "MEMBER");
  await assert.rejects(f.security.rotateRecoveryCodes(f.command()), { code: "AUTH_SESSION_INVALID" });
  assert.equal(await f.count("account_security_changes"), 0);
});

test("failed code rotation preserves the old usable set and publishes no replacement", async t => {
  const f = await fixture(t), old = await f.security.rotateRecoveryCodes(f.command()), before = await capture(f);
  await f.db.exec("CREATE TRIGGER fail_rotation BEFORE INSERT ON audit_logs WHEN NEW.event_type='AccountSecurityChanged' BEGIN SELECT RAISE(ABORT,'synthetic rotation audit failure'); END");
  await assert.rejects(f.security.rotateRecoveryCodes(f.command({ expected_security_revision: 1 })));
  assert.deepEqual(await capture(f), before);
  await f.db.exec("DROP TRIGGER fail_rotation");
  await f.recovery(old.recovery_codes[0]);
  assert.equal(await f.count("account_recovery_codes"), 8); assert.equal(await f.count("account_security_changes"), 2);
});

test("security history cap remains inspectable while new sensitive mutations are held", async t => {
  const f = await fixture(t), timestamp = new Date(f.time()).toISOString();
  const summary = JSON.stringify({ revoked_session_count: 0, recovery_generation: 0, recovery_codes_issued: 0, recovery_expires_at: null, session_public_id: null });
  // Synthetic populated-history boundary: immutable head and state agree at the cap.
  await f.db.run("INSERT INTO account_security_state(organization_id,user_id,revision,recovery_generation,updated_at) VALUES(?,?,1000,0,?)", [f.scope.organization_id,f.scope.actor.id,timestamp]);
  await f.db.run("INSERT INTO account_security_changes(id,organization_id,user_id,revision,expected_revision,operation,authentication_method,summary_json,created_at,actor_user_id) VALUES(?,?,?,1000,999,'REVOKE_SESSION','PASSWORD',?,?,?)", ["synthetic-cap",f.scope.organization_id,f.scope.actor.id,summary,timestamp,f.scope.actor.id]);
  assert.equal((await f.security.get(f.scope)).security_revision, 1000);
  const before = await capture(f);
  await assert.rejects(f.security.rotateRecoveryCodes(f.command({ expected_security_revision: 1000 })), { code: "AUTH_SECURITY_LIMIT" });
  await assert.rejects(f.security.changePassword(f.command({ expected_security_revision: 1000, new_password: NEXT })), { code: "AUTH_SECURITY_LIMIT" });
  assert.deepEqual(await capture(f), before);
  assert.equal((await f.security.history(f.scope)).history.changes[0].revision, 1000);
});
