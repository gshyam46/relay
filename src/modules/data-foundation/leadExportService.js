import { csvCell, serializeCsv } from "../../shared/csv.js";
import { nowIso } from "../../shared/time.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { canonicalContactsForLead } from "../contact-policy/contactPolicyContract.js";
import { BusinessContextRepository } from "../business-context/businessContextRepository.js";
import { ENQUIRY_FIELDS } from "../business-context/businessContextContract.js";
import { loadLeadDataContext } from "./leadDataContext.js";
import { leadDataError, leadDataObject, leadDataText, requireLeadDataOwner, leadDataFingerprint } from "./leadDataContract.js";
import { AuditRepository } from "../events/auditRepository.js";
const MAX_BYTES = 8 * 1024 * 1024;
const HEADERS = ["lead_id", "name", "email", "phone", "normalized_email", "normalized_phone", "company", "source", "contact_status", "archived", "archived_at", "data_revision", "contact_restricted", "policy_pending", "enquiry_revision",
  ...ENQUIRY_FIELDS.flatMap(field => [field + "_state", field + "_value", field + "_provenance"]), "budget_currency", "budget_minimum_exact", "budget_maximum_exact", "contact_json", "enquiry_json"];
export class LeadExportService {
  constructor(db) { this.db = db; this.policy = new ContactPolicyService(db); }
  async exportSelected(input) {
    leadDataObject(input, ["organization_id", "lead_ids", "actor"]);
    const org = leadDataText(input.organization_id, "organization_id");
    if (!Array.isArray(input.lead_ids) || !input.lead_ids.length || input.lead_ids.length > 1000 || new Set(input.lead_ids).size !== input.lead_ids.length) throw leadDataError("LEAD_EXPORT_INVALID_SELECTION", "Select 1 to 1000 distinct enquiries explicitly.");
    const ids = input.lead_ids.map(id => leadDataText(id, "lead_id")).sort();
    return this.policy.withWorkspacePolicyTransaction(org, async tx => {
      await requireLeadDataOwner(tx, org, input.actor);
      const found = await tx.all("SELECT id FROM leads WHERE organization_id=? AND id IN (" + ids.map(() => "?").join(",") + ")", [org, ...ids]);
      if (found.length !== ids.length) throw leadDataError("LEAD_EXPORT_SELECTION_NOT_FOUND", "Every selected enquiry must belong to this workspace.", 404);
      await preflightExportBytes(tx, org, ids);
      const generated_at = nowIso(), pending = Boolean(await tx.get("SELECT id FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING' LIMIT 1", [org]));
      let csv = serializeCsv(HEADERS, []), bytes = Buffer.byteLength(csv, "utf8");
      const revisions = [];
      for (const id of ids) {
        const lead = await tx.get("SELECT id,name,email,phone,normalized_email,normalized_phone,company,status,source,import_batch_id,import_row_id,data_revision,archived_at FROM leads WHERE organization_id=? AND id=?", [org, id]);
        const context = await loadLeadDataContext(tx, { organization_id: org, lead_id: id }), enquiry = await new BusinessContextRepository(tx).current("enquiry", org, id);
        const contacts = canonicalContactsForLead(lead), clauses = contacts.map(() => "(contact_kind=? AND contact_value=?)").join(" OR ");
        const restricted = ["OPTED_OUT", "SUPPRESSED"].includes(lead.status) || Boolean(await tx.get("SELECT id FROM contact_restrictions WHERE organization_id=? AND (" + clauses + ") LIMIT 1", [org, ...contacts.flatMap(contact => [contact.kind, contact.value])]));
        const factCells = ENQUIRY_FIELDS.flatMap(field => { const fact = enquiry.enquiry[field]; return [fact.state, factValue(fact), fact.state === "UNKNOWN" ? "" : JSON.stringify(fact.state === "KNOWN" ? fact.provenance : fact.alternatives.map(item => item.provenance))]; });
        const budget = enquiry.enquiry.budget.state === "KNOWN" ? enquiry.enquiry.budget.value : null;
        const contact = { ...context.values, normalized_email: lead.normalized_email, normalized_phone: lead.normalized_phone, field_provenance: context.field_provenance, source: lead.source, import_batch_id: lead.import_batch_id, import_row_id: lead.import_row_id };
        const values = [lead.id, lead.name, lead.email, lead.phone, lead.normalized_email, lead.normalized_phone, lead.company, lead.source, lead.status, Boolean(lead.archived_at), lead.archived_at, String(context.data_revision), restricted, pending, String(enquiry.revision),
          ...factCells, budget?.currency || "", budget ? decimal(budget.minimum_minor, budget.scale) : "", budget ? decimal(budget.maximum_minor, budget.scale) : "", JSON.stringify(contact), JSON.stringify(enquiry.enquiry)];
        const line = values.map(csvCell).join(",") + "\r\n";
        bytes += Buffer.byteLength(line, "utf8");
        if (bytes > MAX_BYTES) throw exportLimit();
        csv += line; revisions.push({ id, data_revision: context.data_revision, enquiry_revision: enquiry.revision });
      }
      await new AuditRepository(tx).record({ organization_id: org, event_type: "LeadDataExported", message: "Owner exported an explicit selected set of current enquiry records.", metadata: { actor: input.actor.id, row_count: ids.length, selection_fingerprint: leadDataFingerprint(revisions), generated_at } });
      return { csv_text: csv, filename: "leads-export.csv", row_count: ids.length, generated_at };
    });
  }
}
async function preflightExportBytes(tx, org, ids) {
  const bytes = column => "coalesce(" + (tx.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))") + ",0)";
  const columns = ["id", "name", "email", "phone", "normalized_email", "normalized_phone", "company", "source", "status", "archived_at", "import_batch_id", "import_row_id"];
  // Read SQL byte counts until every selected input is bounded. Unrelated
  // source_metadata_json is not part of the export and must never be loaded.
  const metadata = await tx.all("SELECT " + columns.map(column => bytes("l." + column)).join("+") + " AS identity_bytes," +
    "coalesce((SELECT " + bytes("d.after_json") + " FROM lead_data_changes d WHERE d.organization_id=l.organization_id AND d.lead_id=l.id AND d.revision=l.data_revision),0) AS data_bytes," +
    "coalesce((SELECT " + bytes("e.enquiry_json") + " FROM lead_enquiry_revisions e WHERE e.organization_id=l.organization_id AND e.lead_id=l.id ORDER BY e.revision DESC LIMIT 1),0) AS enquiry_bytes" +
    " FROM leads l WHERE l.organization_id=? AND l.id IN (" + ids.map(() => "?").join(",") + ")", [org, ...ids]);
  let rawBytes = 0;
  for (const row of metadata) {
    rawBytes += Number(row.identity_bytes) + Number(row.enquiry_bytes);
    if (rawBytes > MAX_BYTES || Number(row.data_bytes) > 524288 || Number(row.enquiry_bytes) > 32768) throw exportLimit();
  }
}
function exportLimit() { return leadDataError("LEAD_EXPORT_LIMIT", "Selected export exceeds supported input or 8 MiB output limits. Select fewer enquiries; no partial export was produced.", 413); }
function decimal(minor, scale) {
  if (minor === null) return "";
  if (!scale) return minor;
  const text = minor.padStart(scale + 1, "0"); return text.slice(0, -scale) + "." + text.slice(-scale);
}
function factValue(fact) {
  if (fact.state === "UNKNOWN") return "";
  if (fact.state === "CONFLICTED") return JSON.stringify({ alternatives: fact.alternatives });
  if (typeof fact.value === "string") return fact.value;
  return JSON.stringify(fact.value);
}
