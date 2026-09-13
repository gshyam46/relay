import { nowIso } from "../../shared/time.js";
import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";

export class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  async get(organizationId, category, key) {
    const row = await this.db.get(
      "SELECT value FROM organization_settings WHERE organization_id = ? AND category = ? AND key = ?",
      [organizationId, category, key]
    );
    return row ? JSON.parse(row.value) : null;
  }

  async getCategory(organizationId, category) {
    const rows = await this.db.all(
      "SELECT key, value FROM organization_settings WHERE organization_id = ? AND category = ?",
      [organizationId, category]
    );
    const result = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }

  async getAll(organizationId) {
    const rows = await this.db.all(
      "SELECT category, key, value FROM organization_settings WHERE organization_id = ?",
      [organizationId]
    );
    const result = {};
    for (const row of rows) {
      if (!result[row.category]) result[row.category] = {};
      result[row.category][row.key] = JSON.parse(row.value);
    }
    return result;
  }

  async set(organizationId, category, key, value) {
    return this.setBulk(organizationId, category, { [key]: value });
  }

  async #write(organizationId, category, key, value) {
    const now = nowIso();
    await this.db.run(
      `INSERT INTO organization_settings (organization_id, category, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, category, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [organizationId, category, key, JSON.stringify(value), now]
    );
  }

  async setBulk(organizationId, category, entries) {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new TypeError("Settings must be a keyed object.");
    if (!this.db.transactionBound) {
      return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(organizationId,
        (tx) => new SettingsRepository(tx).setBulk(organizationId, category, entries));
    }
    assertWorkspaceTransaction(this.db, organizationId);
    for (const [key, value] of Object.entries(entries)) await this.#write(organizationId, category, key, value);
  }

  // Inbound webhooks arrive with no organization_id in hand — this is the one place a
  // setting value is looked up in the other direction, by an opaque per-org token, so a
  // real SendGrid POST can be routed to the right tenant without any other auth on the app.
  async findOrganizationIdByValue(category, key, value) {
    const rows = await this.db.all(
      "SELECT DISTINCT organization_id FROM organization_settings WHERE category = ? AND key = ? AND value = ? LIMIT 2",
      [category, key, JSON.stringify(value)]
    );
    if (rows.length > 1) throw Object.assign(new Error("Routing ownership requires operational inspection."), { code: "CHANNEL_ROUTE_AMBIGUOUS", statusCode: 409 });
    return rows[0]?.organization_id || null;
  }

  async delete(organizationId, category, key) {
    if (!this.db.transactionBound) {
      return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(organizationId,
        (tx) => new SettingsRepository(tx).delete(organizationId, category, key));
    }
    assertWorkspaceTransaction(this.db, organizationId);
    await this.db.run(
      "DELETE FROM organization_settings WHERE organization_id = ? AND category = ? AND key = ?",
      [organizationId, category, key]
    );
  }
}
