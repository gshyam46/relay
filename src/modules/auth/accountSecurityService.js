import { randomBytes } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { AuthRepository } from "./authRepository.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { AccountSecurityRepository } from "./accountSecurityRepository.js";
import { authRevision, canonicalInstant, invalidSecurityInput, MAX_ACCOUNT_SESSIONS, MAX_SECURITY_CHANGES, nextAuthRevision, publicSecurityChange, RECOVERY_CODE_COUNT, RECOVERY_CODE_TTL_MS, recoveryHash, recoveryRejected, securityError, securityInteger, securityNow, securityObject, securityPassword, securityText } from "./accountSecurityContract.js";
const SCOPE = ["organization_id", "actor", "session_id"];
const PASSWORD_COMMAND = [...SCOPE, "expected_security_revision", "current_password"];
export class AccountSecurityService {
  constructor(db, { passwords = { hashPassword, verifyPassword }, now = Date.now } = {}) {
    this.db = db.rootDatabase || db; this.passwords = passwords; this.now = now; this.policy = new ContactPolicyService(this.db);
  }
  async get(input) {
    this.validateScope(input, SCOPE);
    return this.policy.withWorkspacePolicyTransaction(input.organization_id, async tx => {
      const time = securityNow(this.now), { user } = await this.authenticated(tx, input, time), repo = new AccountSecurityRepository(tx);
      const state = await repo.state(input.organization_id, user.id);
      return { security_revision: state.revision, auth_revision: authRevision(user),
        recovery: await repo.recovery(input.organization_id, user.id, state.recovery_generation, time),
        sessions: await repo.sessions(input.organization_id, user.id, authRevision(user), time, input.session_id),
        session_limit: MAX_ACCOUNT_SESSIONS, history: await repo.history(input.organization_id, user.id) };
    });
  }
  async history(input) {
    this.validateScope(input, [...SCOPE, "before_revision", "limit"], SCOPE);
    const before = input.before_revision == null ? null : securityInteger(input.before_revision, { min: 1 });
    const limit = securityInteger(input.limit, { min: 1, max: 50, fallback: 20 });
    return this.policy.withWorkspacePolicyTransaction(input.organization_id, async tx => {
      const { user } = await this.authenticated(tx, input, securityNow(this.now));
      return { history: await new AccountSecurityRepository(tx).history(input.organization_id, user.id, before, limit) };
    });
  }
  changePassword(input) { return this.passwordCommand(input, "CHANGE_PASSWORD", ["new_password"]); }
  rotateRecoveryCodes(input) { return this.passwordCommand(input, "ROTATE_RECOVERY_CODES"); }
  revokeSession(input) { return this.passwordCommand(input, "REVOKE_SESSION", ["session_public_id"]); }
  revokeOtherSessions(input) { return this.passwordCommand(input, "REVOKE_OTHER_SESSIONS"); }
  revokeAllSessions(input) { return this.passwordCommand(input, "REVOKE_ALL_SESSIONS"); }
  validateScope(input, allowed, required = allowed) {
    securityObject(input, allowed, required); securityText(input.organization_id);
    securityText(input.session_id, 128);
    if (!input.actor || typeof input.actor !== "object" || typeof input.actor.id !== "string" || !input.actor.id) throw invalidSecurityInput();
  }
  async authenticated(db, input, time) {
    const repository = new AuthRepository(db, { now: () => time });
    const session = await repository.getValidSession(input.session_id);
    const user = session ? await repository.getUserById(session.user_id) : null;
    if (!session || !user || user.id !== input.actor.id || user.organization_id !== input.organization_id || session.organization_id !== input.organization_id || authRevision(session) !== authRevision(user) || user.role !== input.actor.role) {
      throw securityError("AUTH_SESSION_INVALID", "This account session is no longer authorized. Sign in again.", 401);
    }
    return { user, session };
  }
  async passwordCommand(input, operation, extra = []) {
    this.validateScope(input, [...PASSWORD_COMMAND, ...extra]);
    securityInteger(input.expected_security_revision); securityPassword(input.current_password);
    if (operation === "CHANGE_PASSWORD") securityPassword(input.new_password, { next: true });
    if (operation === "REVOKE_SESSION" && (typeof input.session_public_id !== "string" || !/^sref_[0-9a-f]{64}$/.test(input.session_public_id))) throw invalidSecurityInput();
    const captured = await this.authenticated(this.db, input, securityNow(this.now));
    if (!await this.passwords.verifyPassword(input.current_password, captured.user.password_hash)) throw securityError("AUTH_PASSWORD_REJECTED", "The current password could not be verified.", 403);
    const passwordHash = operation === "CHANGE_PASSWORD" ? await this.passwords.hashPassword(input.new_password) : null;
    const codes = operation === "ROTATE_RECOVERY_CODES" ? Array.from({ length: RECOVERY_CODE_COUNT }, () => "rcv_" + randomBytes(32).toString("base64url")) : null;
    return this.policy.withWorkspacePolicyTransaction(input.organization_id, async tx => {
      const time = securityNow(this.now), timestamp = new Date(time).toISOString(), { user } = await this.authenticated(tx, input, time), repo = new AccountSecurityRepository(tx);
      if (user.password_hash !== captured.user.password_hash || authRevision(user) !== authRevision(captured.user)) throw securityError("AUTH_CONTEXT_CHANGED", "Account authentication changed. Sign in again.", 401);
      const state = await repo.state(input.organization_id, user.id);
      if (state.revision !== Number(input.expected_security_revision)) throw securityError("AUTH_SECURITY_REVISION_STALE", "Account security changed. Review its latest state before trying again.");
      if (state.revision >= MAX_SECURITY_CHANGES) throw securityError("AUTH_SECURITY_LIMIT", "Account security history reached its supported limit. Operational inspection is required.");
      const recovery = await repo.recovery(input.organization_id, user.id, state.recovery_generation, time);
      let target = null;
      if (operation === "REVOKE_SESSION") {
        target = await tx.get("SELECT id FROM sessions WHERE organization_id=? AND user_id=? AND public_id=?", [input.organization_id, user.id, input.session_public_id]);
        if (!target) throw securityError("AUTH_SESSION_NOT_FOUND", "The selected session is unavailable for this account.", 404);
      }
      const next = { ...state, revision: state.revision + 1, recovery_generation: state.recovery_generation + (codes ? 1 : 0), updated_at: timestamp };
      const expiresAt = codes ? new Date(time + RECOVERY_CODE_TTL_MS).toISOString() : recovery.expires_at;
      await repo.setState(next);
      let revoked = 0, signIn = false;
      if (codes) {
        await tx.run("UPDATE account_recovery_codes SET revoked_at=? WHERE organization_id=? AND user_id=? AND consumed_at IS NULL AND revoked_at IS NULL", [timestamp, input.organization_id, user.id]);
        for (const code of codes) await tx.run("INSERT INTO account_recovery_codes(id,organization_id,user_id,generation,code_hash,created_at,expires_at,consumed_at,revoked_at) VALUES (?,?,?,?,?,?,?,NULL,NULL)", [createId("recovery"), input.organization_id, user.id, next.recovery_generation, recoveryHash(code), timestamp, expiresAt]);
      } else if (operation === "REVOKE_SESSION") {
        revoked = Number((await tx.run("DELETE FROM sessions WHERE organization_id=? AND user_id=? AND id=?", [input.organization_id, user.id, target.id])).changes);
        signIn = target.id === input.session_id;
      } else {
        const revision = nextAuthRevision(user);
        await tx.run("UPDATE users SET auth_revision=?" + (passwordHash ? ",password_hash=?" : "") + " WHERE organization_id=? AND id=?", [revision, ...(passwordHash ? [passwordHash] : []), input.organization_id, user.id]);
        if (operation === "REVOKE_OTHER_SESSIONS") {
          revoked = Number((await tx.run("DELETE FROM sessions WHERE organization_id=? AND user_id=? AND id<>?", [input.organization_id, user.id, input.session_id])).changes);
          await tx.run("UPDATE sessions SET auth_revision=? WHERE organization_id=? AND user_id=? AND id=?", [revision, input.organization_id, user.id, input.session_id]);
        } else {
          revoked = Number((await tx.run("DELETE FROM sessions WHERE organization_id=? AND user_id=?", [input.organization_id, user.id])).changes); signIn = true;
        }
      }
      const change = await this.record(tx, user, state, next, operation, "PASSWORD", { revoked_session_count: revoked, recovery_generation: next.recovery_generation,
        recovery_codes_issued: codes ? RECOVERY_CODE_COUNT : 0, recovery_expires_at: expiresAt, session_public_id: input.session_public_id || null }, timestamp);
      return { change, sign_in_required: signIn, ...(codes ? { recovery_codes: codes } : {}) };
    });
  }
  async recover(input) {
    securityObject(input, ["email", "recovery_code", "new_password"]);
    securityPassword(input.new_password, { next: true });
    if (typeof input.email !== "string" || !input.email.trim() || input.email.trim().length > 254 || typeof input.recovery_code !== "string" || !/^rcv_[A-Za-z0-9_-]{43}$/.test(input.recovery_code.trim())) throw recoveryRejected();
    const codeHash = recoveryHash(input.recovery_code.trim()), user = await new AuthRepository(this.db).getUserByEmail(input.email.trim());
    // Every well-formed recovery attempt performs one bounded hash. Admission is
    // owned by the public API; no account existence or code text enters errors.
    const passwordHash = await this.passwords.hashPassword(input.new_password);
    if (!user) throw recoveryRejected();
    return this.policy.withWorkspacePolicyTransaction(user.organization_id, async tx => {
      const time = securityNow(this.now), timestamp = new Date(time).toISOString(), current = await new AuthRepository(tx).getUserById(user.id), repo = new AccountSecurityRepository(tx);
      if (!current || current.organization_id !== user.organization_id || current.password_hash !== user.password_hash || authRevision(current) !== authRevision(user)) throw recoveryRejected();
      const state = await repo.state(user.organization_id, user.id);
      if (state.revision >= MAX_SECURITY_CHANGES) throw recoveryRejected();
      const code = await tx.get("SELECT id,created_at,expires_at,consumed_at,revoked_at FROM account_recovery_codes WHERE organization_id=? AND user_id=? AND generation=? AND code_hash=?", [user.organization_id, user.id, state.recovery_generation, codeHash]);
      if (!code || code.consumed_at || code.revoked_at || canonicalInstant(code.created_at) === null || canonicalInstant(code.expires_at) === null || Date.parse(code.created_at) > time || Date.parse(code.expires_at) <= time) throw recoveryRejected();
      const next = { ...state, revision: state.revision + 1, updated_at: timestamp };
      await repo.setState(next);
      const used = await tx.run("UPDATE account_recovery_codes SET consumed_at=? WHERE id=? AND organization_id=? AND user_id=? AND consumed_at IS NULL AND revoked_at IS NULL", [timestamp, code.id, user.organization_id, user.id]);
      if (Number(used.changes) !== 1) throw recoveryRejected();
      await tx.run("UPDATE users SET password_hash=?,auth_revision=? WHERE id=? AND organization_id=?", [passwordHash, nextAuthRevision(current), user.id, user.organization_id]);
      const revoked = Number((await tx.run("DELETE FROM sessions WHERE user_id=? AND organization_id=?", [user.id, user.organization_id])).changes);
      const change = await this.record(tx, current, state, next, "RECOVER", "RECOVERY_CODE", { revoked_session_count: revoked, recovery_generation: state.recovery_generation,
        recovery_codes_issued: 0, recovery_expires_at: code.expires_at, session_public_id: null }, timestamp);
      return { change, sign_in_required: true };
    });
  }
  async record(tx, user, previous, next, operation, method, summary, timestamp) {
    const row = { id: createId("security"), organization_id: user.organization_id, user_id: user.id, revision: next.revision, expected_revision: previous.revision,
      operation, authentication_method: method, summary_json: JSON.stringify(summary), created_at: timestamp, actor_user_id: user.id };
    publicSecurityChange(row);
    await new AccountSecurityRepository(tx).append(row);
    await new AuditRepository(tx).record({ organization_id: user.organization_id, event_type: "AccountSecurityChanged", message: "Account security updated with an exact recorded revision.",
      metadata: { change_id: row.id, user_id: user.id, revision: next.revision, operation, authentication_method: method, revoked_session_count: summary.revoked_session_count } });
    return publicSecurityChange(row);
  }
}
