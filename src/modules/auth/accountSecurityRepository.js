import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { canonicalInstant, MAX_ACCOUNT_SESSIONS, MAX_SECURITY_CHANGES, publicSecurityChange, securityError, sessionPublicId } from "./accountSecurityContract.js";
const invalid = () => securityError("AUTH_SECURITY_STATE_INVALID", "Account security state needs operational inspection.", 503);
export class AccountSecurityRepository {
  constructor(db) { this.db = db; }
  async state(org, user) {
    const row = await this.db.get("SELECT * FROM account_security_state WHERE organization_id=? AND user_id=?", [org, user]);
    const head = await this.db.get("SELECT revision FROM account_security_changes WHERE organization_id=? AND user_id=? ORDER BY revision DESC LIMIT 1", [org, user]);
    if (!row) { if (head) throw invalid(); return { organization_id: org, user_id: user, revision: 0, recovery_generation: 0, updated_at: null }; }
    if (!Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > MAX_SECURITY_CHANGES || !Number.isSafeInteger(row.recovery_generation) || row.recovery_generation < 0 || row.recovery_generation > row.revision || (head?.revision || 0) !== row.revision || canonicalInstant(row.updated_at) === null) throw invalid();
    return row;
  }
  async sessions(org, user, revision, time, currentId) {
    const rows = await this.db.all("SELECT id,public_id,created_at,expires_at FROM sessions WHERE organization_id=? AND user_id=? AND auth_revision=? AND expires_at>? ORDER BY created_at DESC,id DESC LIMIT ?", [org, user, revision, new Date(time).toISOString(), MAX_ACCOUNT_SESSIONS + 1]);
    if (rows.length > MAX_ACCOUNT_SESSIONS) throw securityError("AUTH_SECURITY_LIMIT", "Active session history exceeds the supported inspection limit.");
    return rows.map(row => {
      const created = canonicalInstant(row.created_at), expires = canonicalInstant(row.expires_at);
      if (created === null || expires === null || created > time || expires <= time || row.public_id !== sessionPublicId(row.id)) throw invalid();
      return { public_id: row.public_id, created_at: row.created_at, expires_at: row.expires_at, current: row.id === currentId };
    });
  }
  async recovery(org, user, generation, time) {
    if (!generation) return { generation: 0, usable_count: 0, expires_at: null };
    const rows = await this.db.all("SELECT created_at,expires_at,consumed_at,revoked_at FROM account_recovery_codes WHERE organization_id=? AND user_id=? AND generation=? LIMIT 9", [org, user, generation]);
    if (rows.length !== 8 || rows.some(row => canonicalInstant(row.created_at) === null || canonicalInstant(row.expires_at) === null || row.expires_at <= row.created_at || (row.consumed_at !== null && canonicalInstant(row.consumed_at) === null) || (row.revoked_at !== null && canonicalInstant(row.revoked_at) === null)) || new Set(rows.map(row => row.expires_at)).size !== 1) throw invalid();
    return { generation, usable_count: rows.filter(row => !row.consumed_at && !row.revoked_at && Date.parse(row.created_at) <= time && Date.parse(row.expires_at) > time).length, expires_at: rows[0].expires_at };
  }
  async history(org, user, before = null, limit = 20) {
    const rows = await this.db.all("SELECT * FROM account_security_changes WHERE organization_id=? AND user_id=?" + (before === null ? "" : " AND revision<?") + " ORDER BY revision DESC LIMIT ?", [org, user, ...(before === null ? [] : [before]), limit + 1]);
    const changes = rows.slice(0, limit).map(publicSecurityChange), has_more = rows.length > limit;
    return { changes, has_more, next_before_revision: has_more ? changes.at(-1).revision : null };
  }
  async setState(row) {
    assertWorkspaceTransaction(this.db, row.organization_id);
    await this.db.run("INSERT INTO account_security_state(organization_id,user_id,revision,recovery_generation,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET revision=excluded.revision,recovery_generation=excluded.recovery_generation,updated_at=excluded.updated_at", [row.organization_id, row.user_id, row.revision, row.recovery_generation, row.updated_at]);
  }
  async append(row) {
    assertWorkspaceTransaction(this.db, row.organization_id);
    const keys = Object.keys(row);
    await this.db.run("INSERT INTO account_security_changes(" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", Object.values(row));
  }
}
