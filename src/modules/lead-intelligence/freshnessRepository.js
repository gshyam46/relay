import { assertWorkspaceTransaction, recordWorkspaceFreshnessTime } from "../contact-policy/contactPolicyService.js";
import { instant } from "../business-context/businessContextContract.js";
import { freshnessError } from "./freshnessContract.js";
export class FreshnessRepository {
  constructor(db) { this.db = db; this.checkedHistory = new Set(); }
  async effectiveTime(organization_id, now) {
    assertWorkspaceTransaction(this.db, organization_id);
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw freshnessError("FRESHNESS_CLOCK_INVALID", "Freshness clock requires operational review.");
    const prior = await this.db.get("SELECT high_water_at FROM workspace_freshness_clocks WHERE organization_id=?", [organization_id]);
    let previous = now;
    try { if (prior) previous = Date.parse(instant(prior.high_water_at, "high_water_at", true)); }
    catch { throw freshnessError("FRESHNESS_STATE_INVALID", "Saved freshness clock requires operational review."); }
    const value = Math.max(now, previous), at = new Date(value).toISOString();
    if (!prior) await this.db.run("INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES (?,?)", [organization_id, at]);
    else if (value > previous) await this.db.run("UPDATE workspace_freshness_clocks SET high_water_at=? WHERE organization_id=?", [at, organization_id]);
    recordWorkspaceFreshnessTime(this.db, organization_id, at);
    return value;
  }
  async recordedAt(organization_id, lead_id, field, assertion) {
    const scope = organization_id + ":" + lead_id;
    if (!this.checkedHistory.has(scope)) {
      const bytes = this.db.kind === "postgres" ? "octet_length(enquiry_json)" : "length(CAST(enquiry_json AS BLOB))";
      const size = await this.db.get("SELECT count(*) n,coalesce(sum(" + bytes + "),0) AS bytes FROM lead_enquiry_revisions WHERE organization_id=? AND lead_id=?", [organization_id, lead_id]);
      if (Number(size.n) > 1000 || Number(size.bytes) > 8388608) throw freshnessError("FRESHNESS_INPUT_LIMIT", "Enquiry source history exceeds 1000 revisions or 8 MiB. Operational review is required.", 409);
      this.checkedHistory.add(scope);
    }
    const value = JSON.stringify(assertion.value), provenance = JSON.stringify(assertion.provenance);
    let predicate, args;
    if (this.db.kind === "postgres") {
      const path = "enquiry_json::jsonb -> ?::text";
      predicate = "((" + path + ") @> ?::jsonb OR (" + path + " -> 'alternatives') @> ?::jsonb)";
      args = [field, JSON.stringify(assertion), field, JSON.stringify([assertion])];
    } else {
      const path = "$." + field;
      predicate = "((json_extract(enquiry_json,?) IS json_extract(?,'$') AND json_extract(enquiry_json,?)=json(?)) OR EXISTS(SELECT 1 FROM json_each(enquiry_json,?) a WHERE json_extract(a.value,'$.value') IS json_extract(?,'$') AND json_extract(a.value,'$.provenance')=json(?)))";
      args = [path + ".value", value, path + ".provenance", provenance, path + ".alternatives", value, provenance];
    }
    try {
      const row = await this.db.get("SELECT created_at FROM lead_enquiry_revisions WHERE organization_id=? AND lead_id=? AND " + predicate + " ORDER BY revision ASC LIMIT 1", [organization_id, lead_id, ...args]);
      if (!row) throw new Error();
      return row.created_at;
    } catch { throw freshnessError("FRESHNESS_STATE_INVALID", "Original enquiry source recording time requires operational review."); }
  }
  latestSnapshot(organization_id, lead_id) { return this.db.get("SELECT id,status,created_at,substr(freshness_json,1,262145) AS freshness_json FROM intelligence_snapshots WHERE organization_id=? AND lead_id=? ORDER BY version DESC,created_at DESC LIMIT 1", [organization_id, lead_id]); }
}
