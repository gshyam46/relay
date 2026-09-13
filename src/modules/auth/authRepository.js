import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { authRevision, MAX_ACCOUNT_SESSIONS, securityError, securityNow, sessionPublicId } from "./accountSecurityContract.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class AuthRepository {
  constructor(db, { now = Date.now } = {}) {
    this.db = db; this.now = now;
  }

  async createUser({ organization_id, name, email, password_hash, role = "OWNER" }) {
    const user = {
      id: createId("user"),
      organization_id,
      name,
      email: email.toLowerCase(),
      password_hash,
      role,
      created_at: nowIso()
    };
    await this.db.run(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.id, user.organization_id, user.name, user.email, user.password_hash, user.role, user.created_at]
    );
    return user;
  }

  async getUserByEmail(email) {
    return await this.db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  }

  async getUserById(id) {
    return await this.db.get("SELECT * FROM users WHERE id = ?", [id]);
  }

  async createSession({ user_id, organization_id, auth_revision }) {
    if (!this.db.transactionBound) return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(organization_id,
      tx => new AuthRepository(tx, { now: this.now }).createSession({ user_id, organization_id, auth_revision }));
    const user = await this.db.get("SELECT * FROM users WHERE id=? AND organization_id=?", [user_id, organization_id]);
    if (!user || (auth_revision !== undefined && authRevision(user) !== auth_revision)) throw securityError("AUTH_CONTEXT_CHANGED", "Account authentication changed. Sign in again.", 401);
    const time = securityNow(this.now), timestamp = new Date(time).toISOString();
    const expired = await this.db.all("SELECT id FROM sessions WHERE user_id=? AND organization_id=? AND expires_at<=? ORDER BY expires_at,id LIMIT 200", [user_id, organization_id, timestamp]);
    if (expired.length) await this.db.run("DELETE FROM sessions WHERE user_id=? AND organization_id=? AND id IN (" + expired.map(() => "?").join(",") + ")", [user_id, organization_id, ...expired.map(row => row.id)]);
    const active = await this.db.get("SELECT COUNT(*) n FROM sessions WHERE user_id=? AND organization_id=? AND expires_at>? AND auth_revision=?", [user_id, organization_id, timestamp, authRevision(user)]);
    if (Number(active.n) >= MAX_ACCOUNT_SESSIONS) throw securityError("AUTH_SESSION_LIMIT", "This account has reached its active session limit. Revoke an existing session or use account recovery.");
    const id = createId("sess");
    const session = { id, public_id: sessionPublicId(id), user_id, organization_id, created_at: timestamp,
      expires_at: new Date(time + SESSION_TTL_MS).toISOString(), auth_revision: authRevision(user) };
    await this.db.run("INSERT INTO sessions (id,public_id,user_id,organization_id,created_at,expires_at,auth_revision) VALUES (?,?,?,?,?,?,?)",
      [session.id,session.public_id,session.user_id,session.organization_id,session.created_at,session.expires_at,session.auth_revision]);
    return session;
  }

  async getValidSession(id) {
    if (typeof id !== "string" || !id || id.length > 128) return null;
    const session = await this.db.get("SELECT * FROM sessions WHERE id = ?", [id]);
    if (!session) {
      return null;
    }
    const expires = typeof session.expires_at === "string" ? Date.parse(session.expires_at) : NaN;
    if (!Number.isFinite(expires) || new Date(expires).toISOString() !== session.expires_at || expires <= this.now()) {
      return null;
    }
    return session;
  }

  async deleteSession(id) {
    await this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }
}
