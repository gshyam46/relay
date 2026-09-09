import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class AuthRepository {
  constructor(db) {
    this.db = db;
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

  async createSession({ user_id, organization_id }) {
    const session = {
      id: createId("sess"),
      user_id,
      organization_id,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
    await this.db.run(
      "INSERT INTO sessions (id, user_id, organization_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [session.id, session.user_id, session.organization_id, session.created_at, session.expires_at]
    );
    return session;
  }

  async getValidSession(id) {
    const session = await this.db.get("SELECT * FROM sessions WHERE id = ?", [id]);
    if (!session) {
      return null;
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return null;
    }
    return session;
  }

  async deleteSession(id) {
    await this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }
}
