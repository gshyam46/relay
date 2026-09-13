import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { buildNameCompanyLookupKey } from "./normalization.js";
import { IDENTITY_SOURCE_LIMIT } from "./importIdentityContract.js";

export class ImportIdentityRepository {
  constructor(db) { this.db = db; }
  get(organization_id, import_row_id) { return this.db.get("SELECT * FROM import_identity_resolutions WHERE organization_id=? AND import_row_id=?", [organization_id, import_row_id]); }
  list(organization_id, import_id) { return this.db.all("SELECT * FROM import_identity_resolutions WHERE organization_id=? AND import_id=? ORDER BY created_at,id", [organization_id, import_id]); }
  async append(record) {
    assertWorkspaceTransaction(this.db, record.organization_id);
    const keys = Object.keys(record);
    await this.db.run("INSERT INTO import_identity_resolutions(" + keys.join(",") + ") VALUES(" + keys.map(() => "?").join(",") + ")", Object.values(record));
    return record;
  }
  async existingCount(org, values) {
    const match = candidateQuery(org, values);
    return Number((await this.db.get("SELECT count(*) AS n FROM (" + match.sql + ") candidates", match.params)).n);
  }
  existingPage(org, values, after = null, limit = 100) {
    const match = candidateQuery(org, values);
    return this.db.all("SELECT l.id,l.name,l.email,l.phone,l.normalized_email,l.normalized_phone,l.company,l.status,l.data_revision,l.archived_at FROM leads l JOIN (" + match.sql + ") c ON c.id=l.id WHERE l.organization_id=?" + (after ? " AND l.id>?" : "") + " ORDER BY l.id LIMIT ?", [...match.params, org, ...(after ? [after] : []), limit]);
  }
  async enquiryRevisions(org, ids) {
    if (!ids.length) return new Map();
    return new Map((await this.db.all("SELECT lead_id,MAX(revision) AS revision FROM lead_enquiry_revisions WHERE organization_id=? AND lead_id IN (" + ids.map(() => "?").join(",") + ") GROUP BY lead_id", [org, ...ids])).map(row => [row.lead_id, Number(row.revision)]));
  }
  sourceRows(org, leadId) {
    return this.db.all("SELECT r.id AS import_row_id,r.import_id,b.filename,r.row_number,s.source_at FROM (" +
      "SELECT r.id AS source_row_id,r.updated_at AS source_at FROM import_rows r JOIN leads l ON l.organization_id=r.organization_id AND l.id=r.created_lead_id AND l.import_batch_id=r.import_id AND l.import_row_id=r.id WHERE r.organization_id=? AND r.committed=1 AND r.created_lead_id=? " +
      "UNION ALL SELECT import_row_id AS source_row_id,created_at AS source_at FROM import_identity_resolutions WHERE organization_id=? AND lead_id=?" +
      ") s JOIN import_rows r ON r.id=s.source_row_id AND r.organization_id=? JOIN import_batches b ON b.id=r.import_id AND b.organization_id=r.organization_id ORDER BY s.source_at DESC,r.id DESC LIMIT ?", [org, leadId, org, leadId, org, IDENTITY_SOURCE_LIMIT + 1]);
  }
}
function candidateQuery(org, values) {
  const clauses = [], params = [];
  for (const [column, value] of [["normalized_email", values.email], ["normalized_phone", values.normalized_phone], ["normalized_name_company_key", buildNameCompanyLookupKey(values.name, values.company)]]) if (value) {
    clauses.push("SELECT id FROM leads WHERE organization_id=? AND " + column + "=?"); params.push(org, value);
  }
  return clauses.length ? { sql: clauses.join(" UNION "), params } : { sql: "SELECT id FROM leads WHERE organization_id=? AND 1=0", params: [org] };
}
