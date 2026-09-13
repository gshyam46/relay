import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, MAX_PASSWORD_BYTES } from "./passwords.js";

import { AuthRepository } from "./authRepository.js";
import { authRevision, securityError } from "./accountSecurityContract.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { LeadsRepository } from "../data-foundation/leadsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  constructor({ authRepository, leadsRepository, auditRepository = null, passwords = { hashPassword, verifyPassword } }) {
    this.authRepository = authRepository;
    this.leadsRepository = leadsRepository;
    this.auditRepository = auditRepository;
    this.passwords = passwords;
  }

  // Self-serve signup: there is no "join an existing workspace" flow yet, so registering
  // always creates a brand new organization along with its first (owner) user.
  async register({ organization_name, name, email, password }) {
    const errors = validateRegistration({ organization_name, name, email, password });
    if (errors.length > 0) {
      throw validationError(errors.join(" "));
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await this.authRepository.getUserByEmail(normalizedEmail)) {
      throw validationError("An account with this email already exists.");
    }

    // Password work is bounded at admission and never holds a database transaction.
    const password_hash = await this.passwords.hashPassword(password);
    try {
      return await this.authRepository.db.transaction(async (tx) => {
        const auth = new AuthRepository(tx), leads = new LeadsRepository(tx);
        if (await auth.getUserByEmail(normalizedEmail)) throw validationError("An account with this email already exists.");
        const organization = await leads.createOrganization({ name: organization_name.trim() });
        const user = await auth.createUser({ organization_id: organization.id, name: name.trim(), email: normalizedEmail, password_hash });
        const session = await auth.createSession({ user_id: user.id, organization_id: organization.id });
        await new AuditRepository(tx).record({ organization_id: organization.id, event_type: "UserRegistered",
          message: "Workspace and owner account created.", metadata: { user_id: user.id } });
        return { user: publicUser(user), organization, session };
      }, { lockTimeoutMs: 5000 });
    } catch (error) {
      // A competing PostgreSQL registration may pass its read before the unique
      // user insertion wins elsewhere. Translate only after rollback completes.
      if ((error.code === "23505" || Number(error.errcode) === 2067)
        && await this.authRepository.getUserByEmail(normalizedEmail)) throw validationError("An account with this email already exists.");
      throw error;
    }
  }

  async login({ email, password }) {
    if (typeof email !== "string" || !email.trim() || email.trim().length > 254 || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
      throw validationError("email and password are required.");
    }
    const user = await this.authRepository.getUserByEmail(email.trim());
    // Same error for "no such user" and "wrong password" — don't tell an attacker which one it was.
    const invalidCredentials = () => authError("Invalid email or password.");
    const valid = await this.passwords.verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !user.password_hash || !valid) {
      throw invalidCredentials();
    }
    return new ContactPolicyService(this.authRepository.db).withWorkspacePolicyTransaction(user.organization_id, async tx => {
      const auth = new AuthRepository(tx), current = await auth.getUserById(user.id);
      if (!current || current.organization_id !== user.organization_id || current.password_hash !== user.password_hash || authRevision(current) !== authRevision(user)) {
        throw securityError("AUTH_CONTEXT_CHANGED", "Account authentication changed. Sign in again.", 401);
      }
      const organization = await new LeadsRepository(tx).getOrganization(current.organization_id);
      if (!organization) throw invalidCredentials();
      const session = await auth.createSession({ user_id: current.id, organization_id: current.organization_id, auth_revision: authRevision(current) });
      return { user: publicUser(current), organization, session };
    });
  }

  async logout(sessionId) {
    if (sessionId) {
      await this.authRepository.deleteSession(sessionId);
    }
  }

  // The one function every authenticated route ultimately depends on: given a session cookie
  // value, resolve it to a real, unexpired session or throw. There is no fallback to a
  // client-supplied organization_id anywhere in this path — the session is authoritative.
  async requireSession(sessionId) {
    if (!sessionId) {
      throw authError("Not signed in.");
    }
    const session = await this.authRepository.getValidSession(sessionId);
    if (!session) {
      throw authError("Session expired or invalid. Please sign in again.");
    }
    const user = await this.authRepository.getUserById(session.user_id);
    if (!user || user.organization_id !== session.organization_id || authRevision(user) !== authRevision(session)) {
      throw authError("Session expired or invalid. Please sign in again.");
    }
    return { session, user: publicUser(user), organization_id: session.organization_id };
  }
}

function publicUser(user) {
  return { id: user.id, organization_id: user.organization_id, name: user.name, email: user.email, role: user.role };
}

function validateRegistration({ organization_name, name, email, password }) {
  const errors = [];
  if (typeof organization_name !== "string" || !organization_name.trim() || organization_name.trim().length > 200) {
    errors.push("organization_name must contain 1..200 characters.");
  }
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    errors.push("name must contain 1..120 characters.");
  }
  if (typeof email !== "string" || email.trim().length > 254 || !EMAIL_PATTERN.test(email.trim())) {
    errors.push("A valid email is required.");
  }
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    errors.push("password must be at least 8 characters and at most 1024 UTF-8 bytes.");
  }
  return errors;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function authError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}
