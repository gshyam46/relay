import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

export class PreparedActionRepository {
  constructor(db) { this.db = db; }

  async current(action) {
    if (!action.current_revision_id) return null;
    return this.db.get("SELECT * FROM action_revisions WHERE id = ? AND organization_id = ? AND action_id = ?",
      [action.current_revision_id, action.organization_id, action.id]);
  }

  async create(action, { envelope, contentHash, senderFingerprint, contextFingerprint }) {
    assertWorkspaceTransaction(this.db, action.organization_id);
    const latest = await this.db.get("SELECT MAX(revision) AS revision FROM action_revisions WHERE organization_id = ? AND action_id = ?",
      [action.organization_id, action.id]);
    const row = {
      id: createId("rev"), organization_id: action.organization_id, action_id: action.id,
      revision: Number(latest?.revision || 0) + 1,
      envelope_json: JSON.stringify(envelope), content_hash: contentHash,
      sender_config_fingerprint: senderFingerprint, context_fingerprint: contextFingerprint,
      created_at: nowIso()
    };
    await this.db.run(`INSERT INTO action_revisions
      (id, organization_id, action_id, revision, envelope_json, content_hash, sender_config_fingerprint, context_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
    await this.db.run("UPDATE actions SET current_revision_id = ? WHERE id = ? AND organization_id = ?",
      [row.id, action.id, action.organization_id]);
    return row;
  }

  async decision(revision) {
    return this.db.get("SELECT * FROM action_revision_decisions WHERE action_revision_id = ? AND organization_id = ? AND action_id = ?",
      [revision.id, revision.organization_id, revision.action_id]);
  }

  async decide(revision, { decision, reviewer_user_id, reviewer_name, reviewer_note }) {
    assertWorkspaceTransaction(this.db, revision.organization_id);
    const row = {
      id: createId("rdec"), organization_id: revision.organization_id, action_id: revision.action_id,
      action_revision_id: revision.id, decision, reviewed_hash: revision.content_hash,
      reviewer_user_id, reviewer_name: reviewer_name || null, reviewer_note: reviewer_note || null, decided_at: nowIso()
    };
    await this.db.run(`INSERT INTO action_revision_decisions
      (id, organization_id, action_id, action_revision_id, decision, reviewed_hash, reviewer_user_id, reviewer_name, reviewer_note, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
    return row;
  }
}
