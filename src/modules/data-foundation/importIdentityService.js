import { createHash } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { ContactPolicyRepository } from "../contact-policy/contactPolicyRepository.js";
import { canonicalContactsForLead } from "../contact-policy/contactPolicyContract.js";
import { BusinessContextRepository } from "../business-context/businessContextRepository.js";
import { LeadsRepository } from "./leadsRepository.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ImportsRepository, serializeImportRow } from "./importsRepository.js";
import { ImportsService, importDetailInTransaction } from "./importsService.js";
import { ImportIdentityRepository } from "./importIdentityRepository.js";
import { buildNameCompanyLookupKey } from "./normalization.js";
import { importError, importText } from "./reviewedImportContract.js";
import { identityInput, identityFingerprint, requireIdentityOwner, identityUnavailable, publicIdentityLead, serializeIdentityResolution, IDENTITY_EXISTING_LIMIT, IDENTITY_ROW_LIMIT, IDENTITY_SCAN_LIMIT, IDENTITY_SOURCE_LIMIT } from "./importIdentityContract.js";

export class ImportIdentityService {
  constructor(db) { this.db = db; this.policy = new ContactPolicyService(db); }
  async review(input) {
    const command = identityInput(input);
    return this.policy.withWorkspacePolicyTransaction(command.organization_id, async tx => {
      await requireIdentityOwner(tx, command.organization_id, command.owner);
      return (await buildReview(tx, command)).public;
    });
  }
  async resolve(input) {
    const command = identityInput(input, true), { organization_id, import_id, import_row_id, owner } = command;
    const { owner: ignoredOwner, ...intent } = command;
    const requestHash = identityFingerprint(intent);
    let saved;
    try {
      saved = await this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
        await requireIdentityOwner(tx, organization_id, owner);
        const repository = new ImportIdentityRepository(tx), prior = await repository.get(organization_id, import_row_id);
        if (prior) {
          if (prior.import_id !== import_id || prior.request_hash !== requestHash) throw importError("IDENTITY_DECISION_CONFLICT", "This source row already has a different recorded identity decision.", 409);
          return serializeIdentityResolution(prior);
        }
        const review = await buildReview(tx, command);
        if (!review.public.can_resolve) throw importError(review.public.unavailable_reason, "This row is not available for identity resolution. Read its current review before continuing.", 409);
        if (review.public.review_token !== command.review_token) throw importError("IDENTITY_REVIEW_STALE", "The source, candidate or restriction review changed. Load and review the latest comparison.", 409);
        const target = command.decision === "LINK_EXISTING" ? review.target : null;
        if (command.decision === "LINK_EXISTING" && (!target || !target.can_link)) throw importError("IDENTITY_LINK_NOT_ALLOWED", "Link requires an existing candidate with the exact same email and phone pair, including missing values.", 409);
        const values = review.row.normalized_values, stamp = nowIso();
        let leadId = target?.lead.id || null, eventId = null;
        if (command.decision === "CREATE_SEPARATE") {
          const lead = await new LeadsRepository(tx).createLead({ organization_id, name: values.name || values.company || values.email || values.normalized_phone || "Imported Lead", email: values.email, phone: values.raw_phone, normalized_email: values.email, normalized_phone: values.normalized_phone, company: values.company,
            source: values.source || "CSV", import_batch_id: import_id, import_row_id, source_metadata: { adapter_type: "CSV", import_id, import_row_id, filename: review.batch.filename, row_number: review.row.row_number, import_review_revision: review.batch.review_revision, identity_classification: command.classification } });
          leadId = lead.id;
          if (Object.values(values.enquiry).some(fact => fact.state !== "UNKNOWN")) {
            await new BusinessContextRepository(tx).append("enquiry", { organization_id, lead_id: leadId, revision: 1, value: values.enquiry, reason: "Created as a separate enquiry from owner-reviewed import identity.", created_at: stamp, created_by: owner });
            await new AuditRepository(tx).record({ organization_id, lead_id: leadId, event_type: "LeadEnquiryContextUpdated", message: "Initial enquiry facts retain their reviewed import source.", metadata: { import_id, import_row_id, review_revision: review.batch.review_revision, revision: 1, actor: owner } });
          }
          const event = await new EventsRepository(tx).publish({ organization_id, lead_id: leadId, type: "LeadCreated", payload: { lead_id: leadId, source: lead.source, import_id, import_row_id } });
          eventId = event.id;
        }
        const snapshot = { normalized_values: values, source_digest: identityFingerprint({ raw_cells: review.row.raw_cells, raw_row: review.row.raw_row, mapped_values: review.row.mapped_values }),
          row_state: { commit_state: review.row.commit_state, selected: review.row.selected, hold_reason: review.row.hold_reason },
          batch_state: review.batch.state, review_revision: review.batch.review_revision, matching_digest: review.matching_digest,
          existing_total: review.public.existing_total, row_total: review.public.row_total, target };
        const record = { id: createId("identity"), organization_id, import_id, import_row_id, review_revision: review.batch.review_revision, review_token: command.review_token, request_hash: requestHash,
          decision: command.decision, classification: command.classification, target_lead_id: command.target_lead_id, lead_id: leadId, event_id: eventId, reason: command.reason, review_snapshot_json: JSON.stringify(snapshot), created_at: stamp, created_by: owner };
        await repository.append(record);
        await new AuditRepository(tx).record({ organization_id, lead_id: leadId, event_type: "ImportIdentityResolved", message: command.decision === "LINK_EXISTING" ? "Owner attached a reviewed source to the same enquiry." : "Owner retained a separate enquiry and its reviewed source.", metadata: { resolution_id: record.id, import_id, import_row_id, review_revision: record.review_revision, decision: record.decision, classification: record.classification, target_lead_id: record.target_lead_id, reason: record.reason, actor: owner } });
        return serializeIdentityResolution(record);
      });
    } catch (error) {
      if (error.statusCode) throw error;
      throw importError("IDENTITY_WRITE_FAILED", "Identity resolution was not confirmed. Load current review history before retrying the same decision.", 500);
    }
    return { resolution: saved, import: await new ImportsService({ importsRepository: new ImportsRepository(this.db) }).getImport(import_id, organization_id) };
  }
  async listSources(input) {
    if (!input || Object.keys(input).some(key => !["organization_id", "lead_id"].includes(key))) throw importError("IDENTITY_INVALID_INPUT", "Supply workspace and lead identity only.");
    const org = importText(input.organization_id, "organization_id"), leadId = importText(input.lead_id, "lead_id");
    return this.policy.withWorkspacePolicyTransaction(org, async tx => {
      if (!await tx.get("SELECT id FROM leads WHERE organization_id=? AND id=?", [org, leadId])) throw importError("LEAD_NOT_FOUND", "Lead not found in this workspace.", 404);
      const repository = new ImportIdentityRepository(tx), pointers = await repository.sourceRows(org, leadId), sources = [];
      const byteLimit = 8 * 1024 * 1024; let bytes = 0;
      for (const pointer of pointers.slice(0, IDENTITY_SOURCE_LIMIT)) {
        const record = await new ImportsRepository(tx).getRowById(pointer.import_row_id, org), source = serializeImportRow(record);
        const stored = await repository.get(org, pointer.import_row_id);
        if (stored && stored.lead_id !== leadId) throw importError("IDENTITY_STATE_INVALID", "Saved source association requires operational review.", 503);
        const resolution = serializeIdentityResolution(stored, { withSnapshot: true });
        const item = { import_id: record.import_id, import_row_id: record.id, filename: pointer.filename, row_number: record.row_number,
          raw_cells: source.raw_cells, raw_row: source.raw_row, mapped_values: source.mapped_values,
          normalized_values: resolution ? resolution.review_snapshot.normalized_values : source.normalized_values,
          resolution: serializeIdentityResolution(stored), created_at: pointer.source_at };
        const size = Buffer.byteLength(JSON.stringify(item), "utf8");
        if (bytes + size > byteLimit) break;
        sources.push(item); bytes += size;
      }
      return { sources, has_more: pointers.length > sources.length, limit: IDENTITY_SOURCE_LIMIT, byte_limit: byteLimit };
    });
  }
}

async function buildReview(tx, command) {
  const { organization_id: org, import_id, import_row_id } = command;
  const imports = new ImportsRepository(tx), batch = await imports.getBatch(import_id, org);
  if (!batch) throw importError("IMPORT_NOT_FOUND", "Import not found in this workspace.", 404);
  const detail = await importDetailInTransaction(imports, batch), row = detail.rows.find(item => item.id === import_row_id);
  if (!row) throw importError("IMPORT_ROW_NOT_FOUND", "Row not found in this import.", 404);
  const repository = new ImportIdentityRepository(tx), values = row.normalized_values;
  const existingTotal = await repository.existingCount(org, values), exceeded = existingTotal > IDENTITY_SCAN_LIMIT;
  const pendingCount = Number((await tx.get("SELECT count(*) n FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING'", [org])).n);
  const pending = pendingCount <= 10000 ? await tx.all("SELECT id FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING' ORDER BY id LIMIT 10000", [org]) : [];
  const policyState = { count: pendingCount, exceeded: pendingCount > 10000, scopes: new Set(), restrictions: new Map() };
  const sourceContacts = canonicalContactsForLead({ id: row.id, normalized_email: values.email, normalized_phone: values.normalized_phone }).filter(contact => contact.kind !== "LEAD");
  const sourcePolicy = await loadPolicyScopes(tx, org, sourceContacts, policyState), sourceRestrictions = sourcePolicy.restrictions;
  row.contact_policy = { restricted: sourcePolicy.count > 0, policy_pending: pendingCount > 0, reason: sourcePolicy.count ? "CONTACT_RESTRICTED" : pendingCount ? "CONTACT_POLICY_PENDING" : null, restriction_ids: sourceRestrictions.slice(0, 100).map(item => item.id), restriction_count: sourcePolicy.count, restrictions_truncated: sourcePolicy.count > sourceRestrictions.slice(0, 100).length, policy_incomplete: policyState.exceeded };
  const digest = createHash("sha256"), add = value => digest.update(identityFingerprint(value) + "\n");
  add({ source_restrictions: sourceRestrictions, pending_policy: pending });
  const candidates = []; let target = null, after = null, visited = 0;
  while (!policyState.exceeded && visited < (exceeded ? IDENTITY_EXISTING_LIMIT : existingTotal)) {
    const page = await repository.existingPage(org, values, after, Math.min(100, (exceeded ? IDENTITY_EXISTING_LIMIT : existingTotal) - visited));
    if (!page.length) throw importError("IDENTITY_REVIEW_STALE", "Candidate records changed during review. Load the current comparison.", 409);
    const revisions = await repository.enquiryRevisions(org, page.map(lead => lead.id));
    const scopes = [...new Map(page.flatMap(canonicalContactsForLead).map(contact => [contact.kind + ":" + contact.value, contact])).values()];
    await loadPolicyScopes(tx, org, scopes, policyState);
    if (policyState.exceeded) break;
    const restrictions = [...policyState.restrictions.values()];
    for (const lead of page) {
      const contacts = canonicalContactsForLead(lead), applicable = restrictions.filter(restriction => contacts.some(contact => restriction.contact_kind === contact.kind && restriction.contact_value === contact.value));
      const revision = revisions.get(lead.id) || 0;
      add({ lead, enquiry_revision: revision, restrictions: applicable });
      if (candidates.length < IDENTITY_EXISTING_LIMIT || lead.id === command.target_lead_id) {
        const current = await new BusinessContextRepository(tx).current("enquiry", org, lead.id);
        const legacy = ["OPTED_OUT", "SUPPRESSED"].includes(lead.status), restricted = legacy || applicable.length > 0;
        const contactConflict = legacyContactConflict(lead), canLink = !lead.archived_at && !contactConflict && sameContacts(values, lead), candidate = { lead: publicIdentityLead(lead), match_types: matchTypes(values, lead), enquiry_revision: current.revision, enquiry: current.enquiry,
          contact_policy: { restricted, policy_pending: pendingCount > 0, reason: restricted ? "CONTACT_RESTRICTED" : pendingCount ? "CONTACT_POLICY_PENDING" : null, restriction_ids: applicable.slice(0, 100).map(item => item.id), restriction_count: applicable.length, restrictions_truncated: applicable.length > 100 },
          can_link: canLink, link_block_reason: canLink ? null : lead.archived_at ? "LEAD_ARCHIVED" : contactConflict ? "LEGACY_CONTACT_CONFLICT" : "CONTACT_PAIR_DIFFERS" };
        if (candidates.length < IDENTITY_EXISTING_LIMIT) candidates.push(candidate);
        if (lead.id === command.target_lead_id) target = candidate;
      }
    }
    visited += page.length; after = page.at(-1).id;
  }
  const rowCandidates = [];
  for (const candidate of detail.rows) {
    if (candidate.id === row.id) continue;
    const types = matchTypes(values, candidate.normalized_values);
    if (!types.length) continue;
    add({ id: candidate.id, row_number: candidate.row_number, normalized_values: candidate.normalized_values, validation_state: candidate.validation_state, selected: candidate.selected, commit_state: candidate.commit_state, resolution: candidate.identity_resolution });
    rowCandidates.push({ id: candidate.id, row_number: candidate.row_number, normalized_values: candidate.normalized_values, match_types: types, resolution: candidate.identity_resolution });
  }
  const matchingDigest = digest.digest("hex");
  const unavailable = identityUnavailable(batch, row, Boolean(row.identity_resolution)) || (exceeded ? "IDENTITY_CANDIDATE_LIMIT" : policyState.exceeded ? "IDENTITY_POLICY_LIMIT" : !existingTotal && !rowCandidates.length && !row.duplicate_candidates.length ? "IDENTITY_NO_DUPLICATE_EVIDENCE" : null);
  const token = exceeded || policyState.exceeded ? null : identityFingerprint({ import_id, organization_id: org, review_revision: batch.review_revision, batch_state: batch.state, frozen_selection: batch.frozen_selection_json,
    row: { id: row.id, raw_cells: row.raw_cells, raw_row: row.raw_row, mapped_values: row.mapped_values, normalized_values: row.normalized_values, validation_state: row.validation_state, selected: row.selected, commit_state: row.commit_state, hold_reason: row.hold_reason, resolution: row.identity_resolution },
    existing_total: existingTotal, row_total: rowCandidates.length, matching_digest: matchingDigest });
  return { batch, row, target, matching_digest: matchingDigest, public: { review_token: token, can_resolve: !unavailable, unavailable_reason: unavailable, row, existing_candidates: candidates, existing_total: existingTotal,
    existing_truncated: existingTotal > candidates.length, row_candidates: rowCandidates.slice(0, IDENTITY_ROW_LIMIT), row_total: rowCandidates.length, row_truncated: rowCandidates.length > IDENTITY_ROW_LIMIT, resolution: row.identity_resolution } };
}
function sameContacts(values, lead) {
  return Boolean(values.email || values.normalized_phone) && (values.email || null) === (lead.normalized_email || null) && (values.normalized_phone || null) === (lead.normalized_phone || null);
}
function matchTypes(values, other) {
  const types = [];
  if (values.email && values.email === (other.normalized_email || other.email)) types.push("STRONG_EMAIL");
  if (values.normalized_phone && values.normalized_phone === other.normalized_phone) types.push("STRONG_PHONE");
  const key = buildNameCompanyLookupKey(values.name, values.company);
  if (key && key === buildNameCompanyLookupKey(other.name, other.company)) types.push("POSSIBLE_NAME_COMPANY");
  return types;
}

function legacyContactConflict(lead) {
  const expected = [{ kind: "EMAIL", value: lead.normalized_email }, { kind: "PHONE", value: lead.normalized_phone }].filter(item => item.value);
  const actual = canonicalContactsForLead(lead).filter(item => item.kind !== "LEAD");
  return actual.length !== expected.length || actual.some(item => !expected.some(value => item.kind === value.kind && item.value === value.value));
}

async function loadPolicyScopes(tx, org, contacts, state) {
  const key = contact => contact.kind + ":" + contact.value;
  const fresh = contacts.filter(contact => !state.scopes.has(key(contact)));
  let count = 0;
  if (fresh.length) {
    const predicate = fresh.map(() => "(contact_kind=? AND contact_value=?)").join(" OR ");
    count = Number((await tx.get("SELECT count(*) n FROM contact_restrictions WHERE organization_id=? AND (" + predicate + ")", [org, ...fresh.flatMap(contact => [contact.kind, contact.value])])).n);
    state.count += count;
    for (const contact of fresh) state.scopes.add(key(contact));
    if (state.count > 10000) state.exceeded = true;
    if (!state.exceeded) for (const record of await new ContactPolicyRepository(tx).restrictionsFor(org, fresh, "ALL")) state.restrictions.set(record.id, record);
  }
  const restrictions = [...state.restrictions.values()].filter(record => contacts.some(contact => record.contact_kind === contact.kind && record.contact_value === contact.value));
  return { count: state.exceeded ? count : restrictions.length, restrictions };
}
