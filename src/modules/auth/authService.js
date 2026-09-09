import { hashPassword, verifyPassword } from "./passwords.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  constructor({ authRepository, leadsRepository, auditRepository = null }) {
    this.authRepository = authRepository;
    this.leadsRepository = leadsRepository;
    this.auditRepository = auditRepository;
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

    const organization = await this.leadsRepository.createOrganization({ name: organization_name.trim() });
    const password_hash = await hashPassword(password);
    const user = await this.authRepository.createUser({
      organization_id: organization.id,
      name: name.trim(),
      email: normalizedEmail,
      password_hash
    });
    const session = await this.authRepository.createSession({ user_id: user.id, organization_id: organization.id });
    await this.auditRepository?.record({
      organization_id: organization.id,
      event_type: "UserRegistered",
      message: "Workspace and owner account created.",
      metadata: { user_id: user.id, email: normalizedEmail }
    });
    return { user: publicUser(user), organization, session };
  }

  async login({ email, password }) {
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      throw validationError("email and password are required.");
    }
    const user = await this.authRepository.getUserByEmail(email.trim());
    // Same error for "no such user" and "wrong password" — don't tell an attacker which one it was.
    const invalidCredentials = () => authError("Invalid email or password.");
    if (!user || !user.password_hash) {
      throw invalidCredentials();
    }
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw invalidCredentials();
    }
    const organization = await this.leadsRepository.getOrganization(user.organization_id);
    const session = await this.authRepository.createSession({ user_id: user.id, organization_id: user.organization_id });
    return { user: publicUser(user), organization, session };
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
    if (!user) {
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
  if (typeof organization_name !== "string" || !organization_name.trim()) {
    errors.push("organization_name is required.");
  }
  if (typeof name !== "string" || !name.trim()) {
    errors.push("name is required.");
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    errors.push("A valid email is required.");
  }
  if (typeof password !== "string" || password.length < 8) {
    errors.push("password must be at least 8 characters.");
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
