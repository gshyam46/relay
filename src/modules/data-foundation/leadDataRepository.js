import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { buildNameCompanyLookupKey } from "./normalization.js";
import { leadDataError, serializeLeadDataChange } from "./leadDataContract.js";
export class LeadDataRepository {
  constructor(db) { this.db = db; }
  getLead(org, id) { return this.db.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [org, id]); }
  getChange(org, lead, expected) { return this.db.get("SELECT * FROM lead_data_changes WHERE organization_id=? AND lead_id=? AND expected_revision=?", [org, lead, expected]); }
  async history(org, lead, before, limit) {
    const pointers = await this.db.all("SELECT id,revision FROM lead_data_changes WHERE organization_id=? AND lead_id=?" + (before === null ? "" : " AND revision<?") + " ORDER BY revision DESC LIMIT ?", [org, lead, ...(before === null ? [] : [before]), limit + 1]);
    const changes = []; let bytes = 0;
    for (const pointer of pointers.slice(0, limit)) {
      const row = await this.db.get("SELECT * FROM lead_data_changes WHERE organization_id=? AND lead_id=? AND id=?", [org, lead, pointer.id]);
      const change = serializeLeadDataChange(row), size = Buffer.byteLength(JSON.stringify(change), "utf8");
      if (bytes + size > 8 * 1024 * 1024) break;
      changes.push(change); bytes += size;
    }
    return { changes, has_more: pointers.length > changes.length, next_before_revision: pointers.length > changes.length ? changes.at(-1)?.revision || null : null };

  }
  async append(record) {
    assertWorkspaceTransaction(this.db, record.organization_id);
    const keys = Object.keys(record);
    await this.db.run("INSERT INTO lead_data_changes(" + keys.join(",") + ") VALUES(" + keys.map(() => "?").join(",") + ")", Object.values(record));
  }
  async update(org, lead, before, after, timestamp, kind = "CORRECT") {
    assertWorkspaceTransaction(this.db, org);
    if (kind !== "CORRECT") {
      const changed = await this.db.run("UPDATE leads SET data_revision=?,archived_at=?,updated_at=? WHERE organization_id=? AND id=? AND data_revision=?", [after.data_revision, after.archived_at, timestamp, org, lead, before.data_revision]);
      if (changed.changes !== 1) throw leadDataError("LEAD_DATA_REVISION_STALE", "Lead data changed before archive transition.", 409);
      return;
    }
    const value = after.normalized_values;
    const result = await this.db.run("UPDATE leads SET name=?,email=?,phone=?,company=?,normalized_email=?,normalized_phone=?,normalized_name_company_key=?,data_revision=?,archived_at=?,updated_at=? WHERE organization_id=? AND id=? AND data_revision=?", [value.name, value.email, value.phone, value.company, value.normalized_email, value.normalized_phone, buildNameCompanyLookupKey(value.name, value.company), after.data_revision, after.archived_at, timestamp, org, lead, before.data_revision]);
    if (result.changes !== 1) throw leadDataError("LEAD_DATA_REVISION_STALE", "Lead data changed. Load the latest values before deciding.", 409);
  }
  async duplicateCount(org, leadId, values) {
    const match = duplicateQuery(org, leadId, values);
    return Number((await this.db.get("SELECT count(*) n FROM (" + match.sql + ") matched", match.params)).n);
  }
  duplicatePage(org, leadId, values, after, limit = 100) {
    const match = duplicateQuery(org, leadId, values);
    return this.db.all("SELECT l.id,substr(l.name,1,4096) AS name,substr(l.email,1,4096) AS email,substr(l.phone,1,4096) AS phone,substr(l.normalized_email,1,4096) AS normalized_email,substr(l.normalized_phone,1,4096) AS normalized_phone,substr(l.company,1,4096) AS company,l.normalized_name_company_key,l.status,l.data_revision,l.archived_at,CASE WHEN length(l.name)>4096 THEN 1 ELSE 0 END AS name_truncated,CASE WHEN length(l.company)>4096 THEN 1 ELSE 0 END AS company_truncated,CASE WHEN length(l.email)>4096 THEN 1 ELSE 0 END AS email_truncated,CASE WHEN length(l.phone)>4096 THEN 1 ELSE 0 END AS phone_truncated FROM leads l JOIN (" + match.sql + ") matched ON matched.id=l.id WHERE l.organization_id=?" + (after ? " AND l.id>?" : "") + " ORDER BY l.id LIMIT ?", [...match.params, org, ...(after ? [after] : []), limit]);
  }
}
function duplicateQuery(org, leadId, values) {
  const clauses = [], params = [];
  for (const [column, value] of [["normalized_email", values.normalized_email], ["normalized_phone", values.normalized_phone], ["normalized_name_company_key", buildNameCompanyLookupKey(values.name, values.company)]]) if (value) {
    clauses.push("SELECT id FROM leads WHERE organization_id=? AND id<>? AND " + column + "=?"); params.push(org, leadId, value);
  }
  return clauses.length ? { sql: clauses.join(" UNION "), params } : { sql: "SELECT id FROM leads WHERE organization_id=? AND 1=0", params: [org] };
}
