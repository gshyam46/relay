import { nowIso } from "../../shared/time.js";

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
    for (const [key, value] of Object.entries(entries)) {
      await this.set(organizationId, category, key, value);
    }
  }

  // Inbound webhooks arrive with no organization_id in hand — this is the one place a
  // setting value is looked up in the other direction, by an opaque per-org token, so a
  // real SendGrid POST can be routed to the right tenant without any other auth on the app.
  async findOrganizationIdByValue(category, key, value) {
    const row = await this.db.get(
      "SELECT organization_id FROM organization_settings WHERE category = ? AND key = ? AND value = ?",
      [category, key, JSON.stringify(value)]
    );
    return row ? row.organization_id : null;
  }

  async delete(organizationId, category, key) {
    await this.db.run(
      "DELETE FROM organization_settings WHERE organization_id = ? AND category = ? AND key = ?",
      [organizationId, category, key]
    );
  }
}
