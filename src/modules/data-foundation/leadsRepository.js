import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { stringifyJson } from "../../database/database.js";

export class LeadsRepository {
  constructor(db) {
    this.db = db;
  }

  async createOrganization({ name }) {
    const organization = {
      id: createId("org"),
      name,
      created_at: nowIso()
    };
    await this.db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
      organization.id,
      organization.name,
      organization.created_at
    ]);
    return organization;
  }

  async getOrganization(id) {
    return await this.db.get("SELECT * FROM organizations WHERE id = ?", [id]);
  }

  async getOrganizationByName(name) {
    return await this.db.get("SELECT * FROM organizations WHERE lower(name) = lower(?)", [name.trim()]);
  }

  async listOrganizations() {
    return await this.db.all("SELECT * FROM organizations ORDER BY created_at DESC");
  }

  async createLead({
    organization_id,
    name,
    email = null,
    phone = null,
    normalized_email = null,
    normalized_phone = null,
    company = null,
    source = "MANUAL",
    import_batch_id = null,
    import_row_id = null,
    source_metadata = {}
  }) {
    const timestamp = nowIso();
    const lead = {
      id: createId("lead"),
      organization_id,
      name,
      email,
      phone,
      normalized_email: normalized_email || email?.trim().toLowerCase() || null,
      normalized_phone: normalized_phone || null,
      company,
      source,
      import_batch_id,
      import_row_id,
      source_metadata_json: stringifyJson(source_metadata),
      status: "NEW",
      created_at: timestamp,
      updated_at: timestamp
    };

    await this.db.run(
      `INSERT INTO leads
          (id, organization_id, name, email, phone, normalized_email, normalized_phone, company, source,
           import_batch_id, import_row_id, source_metadata_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead.id,
        lead.organization_id,
        lead.name,
        lead.email,
        lead.phone,
        lead.normalized_email,
        lead.normalized_phone,
        lead.company,
        lead.source,
        lead.import_batch_id,
        lead.import_row_id,
        lead.source_metadata_json,
        lead.status,
        lead.created_at,
        lead.updated_at
      ]
    );

    return lead;
  }

  async listLeads(organizationId, filters = {}) {
    const clauses = ["organization_id = ?"];
    const params = [organizationId];

    if (filters.search) {
      const search = `%${filters.search.trim().toLowerCase()}%`;
      clauses.push(
        `(lower(name) LIKE ? OR lower(company) LIKE ? OR lower(email) LIKE ? OR lower(phone) LIKE ? OR lower(normalized_email) LIKE ? OR lower(normalized_phone) LIKE ?)`
      );
      params.push(search, search, search, search, search, search);
    }
    if (filters.source) {
      clauses.push("source = ?");
      params.push(filters.source);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    return await this.db.all(`SELECT * FROM leads WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`, params);
  }

  async getLead(id) {
    return await this.db.get("SELECT * FROM leads WHERE id = ?", [id]);
  }

  async updateLeadStatus(id, status) {
    const updatedAt = nowIso();
    await this.db.run("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?", [status, updatedAt, id]);
    return await this.getLead(id);
  }

  async findByNormalizedEmail(organizationId, normalizedEmail) {
    if (!normalizedEmail) {
      return null;
    }
    return await this.db.get("SELECT * FROM leads WHERE organization_id = ? AND normalized_email = ? LIMIT 1", [
      organizationId,
      normalizedEmail
    ]);
  }

  async findByNormalizedPhone(organizationId, normalizedPhone) {
    if (!normalizedPhone) {
      return null;
    }
    return await this.db.get("SELECT * FROM leads WHERE organization_id = ? AND normalized_phone = ? LIMIT 1", [
      organizationId,
      normalizedPhone
    ]);
  }
}
