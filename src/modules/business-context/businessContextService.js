import { normalizeFitCriteria } from "./fitCriteriaContract.js";
import { assertLeadActive } from "../data-foundation/leadDataSafety.js";
import { validateImportedEnquiryProvenance } from "./importProvenance.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { BusinessContextRepository } from "./businessContextRepository.js";
import { contextError, exactObject, expectedRevision, historyOptions, instant, MAX_CONTEXT_REVISION, normalizeEnquiry, normalizeProfile, textValue } from "./businessContextContract.js";

export class BusinessContextService {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    this.policy = new ContactPolicyService(db);
  }
  async getProfile({ organization_id }) {
    const repository = new BusinessContextRepository(this.db);
    await repository.requireWorkspace(organization_id);
    return repository.current("profile", organization_id);
  }
  async getEnquiry({ organization_id, lead_id }) {
    const repository = new BusinessContextRepository(this.db);
    await repository.requireLead(organization_id, lead_id);
    return repository.current("enquiry", organization_id, lead_id);
  }
  async profileHistory({ organization_id, ...options }) {
    historyOptions(options);
    const repository = new BusinessContextRepository(this.db);
    await repository.requireWorkspace(organization_id);
    return repository.history("profile", organization_id, null, options);
  }
  async enquiryHistory({ organization_id, lead_id, ...options }) {
    historyOptions(options);
    const repository = new BusinessContextRepository(this.db);
    await repository.requireLead(organization_id, lead_id);
    return repository.history("enquiry", organization_id, lead_id, options);
  }
  updateProfile(input) { return this.update("profile", input); }
  updateEnquiry(input) { return this.update("enquiry", input); }
  async update(kind, input) {
    exactObject(input, ["organization_id", ...(kind === "enquiry" ? ["lead_id"] : []), "expected_revision", "reason", kind, "actor", ...(kind === "profile" && input && Object.hasOwn(input, "fit_criteria") ? ["fit_criteria"] : [])], "command");
    const organizationId = textValue(input.organization_id, "organization_id", 256);
    const leadId = kind === "enquiry" ? textValue(input.lead_id, "lead_id", 256) : null;
    const revision = expectedRevision(input.expected_revision);
    const reason = textValue(input.reason, "reason", 2000);
    exactObject(input.actor, ["id", "role"], "actor");
    const actorId = textValue(input.actor.id, "actor.id", 256);
    if (input.actor.role !== "OWNER") throw contextError("BUSINESS_CONTEXT_OWNER_REQUIRED", "Only a current workspace owner may change business context.", 403);
    const value = kind === "profile" ? normalizeProfile(input.profile) : normalizeEnquiry(input.enquiry);
    const hasCriteria = kind === "profile" && input && Object.hasOwn(input, "fit_criteria");
    const criteria = hasCriteria ? normalizeFitCriteria(input.fit_criteria) : null;
    return this.policy.withWorkspacePolicyTransaction(organizationId, async tx => {
      const owner = await tx.get("SELECT id FROM users WHERE id = ? AND organization_id = ? AND role = 'OWNER'", [actorId, organizationId]);
      if (!owner) throw contextError("BUSINESS_CONTEXT_OWNER_REQUIRED", "Only a current workspace owner may change business context.", 403);
      const repository = new BusinessContextRepository(tx);
      if (kind === "enquiry") {
        await repository.requireLead(organizationId, leadId);
        assertLeadActive(await tx.get("SELECT * FROM leads WHERE organization_id=? AND id=?", [organizationId, leadId]));
        await validateImportedEnquiryProvenance(tx, { organization_id: organizationId, lead_id: leadId, enquiry: value });
      }
      const current = await repository.current(kind, organizationId, leadId);
      if (current.revision !== revision) throw contextError("BUSINESS_CONTEXT_STALE", "Context changed. Load the latest version before saving again.", 409);
      const fit_criteria = kind === "profile" ? (hasCriteria ? criteria : current.fit_criteria) : null;
      if (JSON.stringify(current[kind]) === JSON.stringify(value) && (kind !== "profile" || JSON.stringify(current.fit_criteria) === JSON.stringify(fit_criteria))) return current;
      if (revision === MAX_CONTEXT_REVISION) throw contextError("BUSINESS_CONTEXT_REVISION_EXHAUSTED", "Context revision capacity requires operational review.", 409);
      const at = this.now();
      if (!Number.isSafeInteger(at) || !Number.isFinite(new Date(at).getTime())) throw new TypeError("Invalid business context clock.");
      const created_at = instant(new Date(at).toISOString(), "captured_at", true);
      const result = await repository.append(kind, { organization_id: organizationId, lead_id: leadId, revision: revision + 1, value, fit_criteria, reason, created_at, created_by: actorId });
      await new AuditRepository(tx).record({ organization_id: organizationId, lead_id: leadId,
        event_type: kind === "profile" ? "BusinessProfileUpdated" : "LeadEnquiryContextUpdated",
        message: kind === "profile" ? "Owner saved a business profile revision." : "Owner saved an enquiry context revision.",
        metadata: { actor: actorId, expected_revision: revision, revision: revision + 1, reason, schema_version: 1 } });
      return result;
    });
  }
}
