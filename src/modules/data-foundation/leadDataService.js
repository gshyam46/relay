import { createHash } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { canonicalContactsForLead } from "../contact-policy/contactPolicyContract.js";
import { ContactPolicyRepository } from "../contact-policy/contactPolicyRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { LeadDataRepository } from "./leadDataRepository.js";
import { loadLeadDataContext } from "./leadDataContext.js";
import { applyLeadDataSafetyInTransaction } from "./leadDataSafety.js";
import { publicIdentityLead } from "./importIdentityContract.js";
import { buildNameCompanyLookupKey } from "./normalization.js";
import { LEAD_SOURCES } from "./leadValidation.js";
import { leadDataCommand, leadDataError, leadDataFingerprint, leadDataText, leadDataObject, requireLeadDataOwner, serializeLeadDataChange, LEAD_DATA_FIELDS } from "./leadDataContract.js";

export class LeadDataService {
  constructor(db) { this.db = db; this.policy = new ContactPolicyService(db); }
  async get(input) {
    leadDataObject(input, ["organization_id", "lead_id", "before_revision", "limit"], ["organization_id", "lead_id"]);
    const org = leadDataText(input.organization_id, "organization_id"), lead = leadDataText(input.lead_id, "lead_id"), limit = integerOption(input.limit, 20, 1, 50), before = input.before_revision === undefined || input.before_revision === null ? null : integerOption(input.before_revision, null, 1, 2147483647);
    return this.policy.withWorkspacePolicyTransaction(org, tx => dataResponse(tx, org, lead, before, limit));
  }
  async preview(input) {
    const command = leadDataCommand(input, "PREVIEW");
    return this.policy.withWorkspacePolicyTransaction(command.organization_id, async tx => {
      await requireLeadDataOwner(tx, command.organization_id, command.actor);
      return (await buildPreview(tx, command)).public;
    });
  }
  update(input) { return this.change(leadDataCommand(input, "UPDATE"), "CORRECT"); }
  setArchived(input) { const command = leadDataCommand(input, "ARCHIVE"); return this.change(command, command.archived ? "ARCHIVE" : "RESTORE"); }
  async change(command, kind) {
    const { organization_id: org, lead_id: leadId, actor } = command;
    const { actor: ignoredActor, ...intent } = command, hash = leadDataFingerprint({ kind, ...intent });
    try {
      return await this.policy.withWorkspacePolicyTransaction(org, async tx => {
        await requireLeadDataOwner(tx, org, actor);
        const repository = new LeadDataRepository(tx), prior = await repository.getChange(org, leadId, command.expected_revision);
        if (prior) {
          if (prior.request_hash !== hash) throw leadDataError("LEAD_DATA_CHANGE_CONFLICT", "This data revision already has a different recorded change.", 409);
          const change = serializeLeadDataChange(prior);
          return { ...await dataResponse(tx, org, leadId, prior.revision + 1), current: change.after, change, changed: true, replayed: true, effects: change.effects };
        }
        const before = await loadLeadDataContext(tx, { organization_id: org, lead_id: leadId });
        if (before.data_revision !== command.expected_revision) throw stale();
        let proposed, fields = [];
        if (kind === "CORRECT") {
          const preview = await buildPreview(tx, command);
          if (preview.public.unavailable_reason === "LEAD_DATA_NO_CHANGE") return unchanged(await dataResponse(tx, org, leadId));
          if (!preview.public.can_save) throw leadDataError(preview.public.unavailable_reason, "This correction requires current complete review before saving.", 409);
          if (command.review_token !== preview.public.review_token) throw leadDataError("LEAD_DATA_REVIEW_STALE", "The contact, duplicate, restriction or work review changed. Review the latest comparison.", 409);
          proposed = command.proposed; fields = preview.public.changed_fields;
        } else if (Boolean(before.archived_at) === command.archived) return unchanged(await dataResponse(tx, org, leadId));
        if (kind === "ARCHIVE") await checkArchiveWorkLimit(tx, org, leadId);
        const id = createId("lead_data"), timestamp = nowIso(), after = { ...before, data_revision: before.data_revision + 1, ...(proposed || {}), archived_at: kind === "ARCHIVE" ? timestamp : kind === "RESTORE" ? null : before.archived_at, field_provenance: { ...before.field_provenance } };
        for (const field of fields) after.field_provenance[field] = { source_type: "LEAD_DATA_CHANGE", change_id: id, revision: after.data_revision, created_by: actor.id, created_at: timestamp };
        if (Buffer.byteLength(JSON.stringify(before), "utf8") > 524288 || Buffer.byteLength(JSON.stringify(after), "utf8") > 524288) throw leadDataError("LEAD_DATA_SNAPSHOT_LIMIT", "Historical data exceeds the supported correction snapshot limit.", 413);
        const effects = await applyLeadDataSafetyInTransaction(tx, { organization_id: org, lead_id: leadId, before, after, change_id: id, kind, actor, reason: command.reason, timestamp });
        await repository.update(org, leadId, before, after, timestamp, kind);
        const record = { id, organization_id: org, lead_id: leadId, expected_revision: before.data_revision, revision: after.data_revision, kind, before_json: JSON.stringify(before), after_json: JSON.stringify(after), review_token: kind === "CORRECT" ? command.review_token : null, request_hash: hash, reason: command.reason, effects_json: JSON.stringify(effects), created_at: timestamp, created_by: actor.id };
        await repository.append(record);
        await new AuditRepository(tx).record({ organization_id: org, lead_id: leadId, event_type: "LeadDataChanged", message: kind === "CORRECT" ? "Owner corrected current lead identity with preserved source and restrictions." : kind === "ARCHIVE" ? "Owner archived this enquiry and stopped queued work." : "Owner restored this enquiry without restarting previous work.", metadata: { change_id: id, kind, previous_revision: before.data_revision, data_revision: after.data_revision, changed_fields: fields, reason: command.reason, actor: actor.id, effect_counts: { carried_restrictions: effects.carried_restriction_ids.length, blocked_actions: effects.blocked_actions, cancelled_follow_ups: effects.cancelled_follow_ups, stopped_workflows: effects.stopped_workflows } } });
        const change = serializeLeadDataChange(record);
        return { ...await dataResponse(tx, org, leadId), change, changed: true, replayed: false, effects: change.effects };
      });
    } catch (error) {
      if (error.statusCode) throw error;
      throw leadDataError("LEAD_DATA_WRITE_FAILED", "Data change was not confirmed. Read current history before retrying the same command.", 500);
    }
  }
  async directory(input) {
    leadDataObject(input, ["organization_id", "search", "source", "status", "archive", "cursor", "limit"], ["organization_id"]);
    const org = leadDataText(input.organization_id, "organization_id"), limit = integerOption(input.limit, 50, 1, 100);
    const filters = { search: filterText(input.search, 200), source: filterText(input.source, 80), status: filterText(input.status, 80), archive: input.archive || "ACTIVE" };
    if (!["ACTIVE", "ARCHIVED", "ALL"].includes(filters.archive) || (filters.source && !LEAD_SOURCES.has(filters.source))) throw leadDataError("LEAD_DATA_INVALID_FILTER", "Choose supported directory filters.");
    const filterHash = leadDataFingerprint({ organization_id: org, ...filters });
    const cursor = input.cursor ? parseCursor(input.cursor, filterHash) : null;
    const clauses = ["organization_id=?"], parameters = [org];
    if (filters.archive !== "ALL") clauses.push("archived_at IS " + (filters.archive === "ACTIVE" ? "NULL" : "NOT NULL"));
    if (filters.search) { clauses.push("(lower(name) LIKE ? OR lower(company) LIKE ? OR lower(email) LIKE ? OR lower(phone) LIKE ? OR lower(normalized_email) LIKE ? OR lower(normalized_phone) LIKE ?)"); parameters.push(...Array(6).fill("%" + filters.search.toLowerCase() + "%")); }
    for (const field of ["source", "status"]) if (filters[field]) { clauses.push(field + "=?"); parameters.push(filters[field]); }
    return this.policy.withWorkspacePolicyTransaction(org, async tx => {
      const total = Number((await tx.get("SELECT count(*) n FROM leads WHERE " + clauses.join(" AND "), parameters)).n);
      if (cursor) { clauses.push("(created_at<? OR (created_at=? AND id<?))"); parameters.push(cursor.created_at, cursor.created_at, cursor.id); }
      const columns = ["name", "company", "email", "phone", "normalized_email", "normalized_phone"];
      const rows = await tx.all("SELECT id,organization_id,source,status,data_revision,archived_at,created_at,updated_at," + columns.map(column => "substr(" + column + ",1,4096) AS " + column + ",CASE WHEN length(" + column + ")>4096 THEN 1 ELSE 0 END AS " + column + "_truncated").join(",") + " FROM leads WHERE " + clauses.join(" AND ") + " ORDER BY created_at DESC,id DESC LIMIT ?", [...parameters, limit + 1]);
      const leads = rows.slice(0, limit).map(row => { const lead = { ...row, truncated_fields: columns.filter(column => row[column + "_truncated"]) }; for (const column of columns) delete lead[column + "_truncated"]; return lead; });
      const last = leads.at(-1);
      return { leads, total, has_more: rows.length > limit, next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ version: 1, filter_hash: filterHash, created_at: last.created_at, id: last.id })).toString("base64url") : null, limit };
    });
  }
}
async function dataResponse(tx, org, lead, before = null, limit = 20) {
  return { current: await loadLeadDataContext(tx, { organization_id: org, lead_id: lead }), history: await new LeadDataRepository(tx).history(org, lead, before, limit) };
}
function unchanged(data) { return { ...data, change: null, changed: false, replayed: false, effects: { carried_restriction_ids: [], carried_restriction_count: 0, carried_restrictions_truncated: false, blocked_actions: 0, cancelled_follow_ups: 0, stopped_workflows: 0 } }; }
function stale() { return leadDataError("LEAD_DATA_REVISION_STALE", "Lead data changed. Load the latest values before deciding.", 409); }
function integerOption(value, fallback, min, max) {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw leadDataError("LEAD_DATA_INVALID_INPUT", "Pagination requires a bounded integer.");
  return number;
}
function filterText(value, max) { return value === undefined || value === null || value === "" ? null : leadDataText(value, "filter", max); }
function parseCursor(value, filterHash) {
  try {
    if (typeof value !== "string" || value.length > 1024 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error();
    const text = Buffer.from(value, "base64url").toString("utf8"), cursor = JSON.parse(text);
    if (Buffer.from(text).toString("base64url") !== value || Object.keys(cursor).sort().join(",") !== "created_at,filter_hash,id,version" || cursor.version !== 1 || cursor.filter_hash !== filterHash) throw new Error();
    leadDataText(cursor.created_at, "cursor time", 64); leadDataText(cursor.id, "cursor id"); return cursor;
  } catch { throw leadDataError("LEAD_DATA_INVALID_CURSOR", "Load the first page when directory filters change."); }
}
async function buildPreview(tx, command) {
  const org = command.organization_id, leadId = command.lead_id, repository = new LeadDataRepository(tx);
  const lead = await repository.getLead(org, leadId), current = await loadLeadDataContext(tx, { organization_id: org, lead_id: leadId });
  if (current.data_revision !== command.expected_revision) throw stale();
  const proposed = command.proposed, changed = LEAD_DATA_FIELDS.filter(field => current.values[field] !== proposed.values[field] || (field === "email" && current.normalized_values.normalized_email !== proposed.normalized_values.normalized_email) || (field === "phone" && current.normalized_values.normalized_phone !== proposed.normalized_values.normalized_phone));
  const duplicateTotal = await repository.duplicateCount(org, leadId, proposed.normalized_values), duplicates = [], candidatesHash = createHash("sha256");
  let after = null, scanned = 0;
  while (scanned < (duplicateTotal > 5000 ? 50 : duplicateTotal)) {
    const page = await repository.duplicatePage(org, leadId, proposed.normalized_values, after, Math.min(100, Math.min(duplicateTotal, 5000) - scanned));
    if (!page.length) throw stale();
    for (const candidate of page) {
      candidatesHash.update(leadDataFingerprint(candidate));
      if (duplicates.length < 50) duplicates.push({ lead: { ...publicIdentityLead(candidate), truncated_fields: LEAD_DATA_FIELDS.filter(field => candidate[field + "_truncated"]) }, match_types: matchTypes(proposed.normalized_values, candidate) });
    }
    scanned += page.length; after = page.at(-1).id;
  }
  const contactsBefore = canonicalContactsForLead(lead), contactsAfter = canonicalContactsForLead({ ...lead, ...proposed.normalized_values });
  const contacts = [...new Map([...contactsBefore, ...contactsAfter].map(item => [item.kind + ":" + item.value, item])).values()];
  const restrictionClause = contacts.map(() => "(contact_kind=? AND contact_value=?)").join(" OR "), restrictionArgs = [org, ...contacts.flatMap(item => [item.kind, item.value])];
  const restrictionCount = Number((await tx.get("SELECT count(*) n FROM contact_restrictions WHERE organization_id=? AND (" + restrictionClause + ")", restrictionArgs)).n);
  const pendingCount = Number((await tx.get("SELECT count(*) n FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING'", [org])).n), policyLimit = restrictionCount + pendingCount > 10000;
  const restrictions = policyLimit ? [] : await new ContactPolicyRepository(tx).restrictionsFor(org, contacts, "ALL");
  const pending = policyLimit ? [] : await tx.all("SELECT id FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING' ORDER BY id LIMIT 10000", [org]);
  const old = restrictions.filter(row => contactsBefore.some(contact => contact.kind === row.contact_kind && contact.value === row.contact_value));
  const newRestrictions = restrictions.filter(row => contactsAfter.some(contact => contact.kind === row.contact_kind && contact.value === row.contact_value));
  const effectiveNew = [...new Map([...newRestrictions, ...old].map(row => [row.id, row])).values()];
  const actions = await tx.all("SELECT id,status,type,updated_at,current_revision_id FROM actions WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING') AND NOT EXISTS (SELECT 1 FROM action_executions execution WHERE execution.action_id=actions.id AND (execution.outcome_class IS NULL OR execution.outcome_class NOT IN ('RETRYABLE_FAILURE','PERMANENT_FAILURE'))) ORDER BY id LIMIT 10001", [org, leadId]);
  const runs = await tx.all("SELECT id,status,revision,paused_at FROM workflow_runs WHERE organization_id=? AND lead_id=? AND status IN ('ACTIVE','WAITING','WAITING_APPROVAL','WAITING_EXECUTION') ORDER BY id LIMIT 10001", [org, leadId]);
  const followUps = await tx.all("SELECT id,status,updated_at FROM follow_up_tasks WHERE organization_id=? AND lead_id=? AND status IN ('PLANNED','DUE') AND action_id IS NOT NULL AND idempotency_key='action:' || action_id || ':no-response-follow-up:v1' ORDER BY id LIMIT 10001", [org, leadId]);
  const workLimit = await openWorkCount(tx, org, leadId) > 10000;
  const unavailable = current.archived_at ? "LEAD_ARCHIVED" : !changed.length ? "LEAD_DATA_NO_CHANGE" : duplicateTotal > 5000 ? "LEAD_DATA_CANDIDATE_LIMIT" : pendingCount > 0 ? "LEAD_DATA_POLICY_PENDING" : policyLimit ? "LEAD_DATA_POLICY_LIMIT" : workLimit ? "LEAD_DATA_WORK_LIMIT" : null;
  const effects = { carried_restrictions: old.filter(row => row.contact_kind !== "LEAD").length, blocked_actions: actions.length, cancelled_follow_ups: followUps.length, stopped_workflows: runs.length };
  const token = unavailable && unavailable !== "LEAD_DATA_NO_CHANGE" ? null : leadDataFingerprint({ organization_id: org, lead_id: leadId, current, proposed, region: command.default_phone_region, duplicate_total: duplicateTotal, duplicates: candidatesHash.digest("hex"), restrictions, pending, actions, runs, followUps, lead_status: lead.status });
  return { public: { current, proposed, changed_fields: changed, review_token: token, can_save: !unavailable, unavailable_reason: unavailable, duplicate_candidates: duplicates, duplicate_total: duplicateTotal, duplicates_truncated: duplicateTotal > duplicates.length,
    current_policy: policySummary(old, lead.status, pendingCount, policyLimit), proposed_policy: policySummary(effectiveNew, lead.status, pendingCount, policyLimit), effects } };
}
function policySummary(restrictions, status, pending, incomplete) {
  const restricted = restrictions.length > 0 || ["OPTED_OUT", "SUPPRESSED"].includes(status);
  const pairs = restrictions.map(({ reason, channel }) => ({ reason, channel }));
  if (["OPTED_OUT", "SUPPRESSED"].includes(status)) pairs.push({ reason: status === "OPTED_OUT" ? "OPT_OUT" : "SUPPRESSED", channel: "ALL" });
  const reasons = [...new Map(pairs.map(pair => [pair.reason + ":" + pair.channel, pair])).values()].sort((a, b) => a.reason.localeCompare(b.reason) || a.channel.localeCompare(b.channel));
  return { restricted, policy_pending: pending > 0, policy_incomplete: incomplete, reasons, restriction_ids: restrictions.slice(0, 100).map(row => row.id), restriction_count: incomplete ? null : restrictions.length, restrictions_truncated: incomplete || restrictions.length > 100, reason: incomplete ? "LEAD_DATA_POLICY_LIMIT" : restricted ? "CONTACT_RESTRICTED" : pending ? "CONTACT_POLICY_PENDING" : null };
}
function matchTypes(value, candidate) {
  const result = [];
  if (value.normalized_email && value.normalized_email === candidate.normalized_email) result.push("STRONG_EMAIL");
  if (value.normalized_phone && value.normalized_phone === candidate.normalized_phone) result.push("STRONG_PHONE");
  const key = buildNameCompanyLookupKey(value.name, value.company);
  if (key && key === (candidate.normalized_name_company_key || buildNameCompanyLookupKey(candidate.name, candidate.company))) result.push("POSSIBLE_NAME_COMPANY");
  return result;
}

async function checkArchiveWorkLimit(tx, org, lead) {
  if (await openWorkCount(tx, org, lead) > 10000) throw leadDataError("LEAD_DATA_WORK_LIMIT", "Open work exceeds the supported archive transition limit.", 409);
}
async function openWorkCount(tx, org, lead) {
  let total = 0;
  for (const [table, statuses] of [["actions", "'PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING'"], ["workflow_runs", "'ACTIVE','WAITING','WAITING_APPROVAL','WAITING_EXECUTION'"], ["follow_up_tasks", "'PLANNED','DUE'"]]) total += Number((await tx.get("SELECT count(*) n FROM " + table + " WHERE organization_id=? AND lead_id=? AND status IN (" + statuses + ")", [org, lead])).n);
  return total;
}
