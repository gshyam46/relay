import { freshnessError } from "./freshnessContract.js";
import { currentLeadData } from "../data-foundation/leadDataSafety.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { ResearchEvidenceRepository } from "./researchEvidenceRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { ApprovedManualResearchAdapter } from "./approvedResearchAdapter.js";
import { serializeEvidenceItem } from "./researchEvidenceRepository.js";
import {
  APPROVED_RESEARCH_PROVIDERS,
  RESEARCH_EVIDENCE_ADAPTER_TYPES,
  RESEARCH_EVIDENCE_INGESTION_STATES,
  validateResearchEvidenceItem
} from "./researchProviderContract.js";

export class ResearchEvidenceService {
  constructor({ researchEvidenceRepository, auditRepository = null }) {
    this.researchEvidenceRepository = researchEvidenceRepository;
    this.auditRepository = auditRepository;
  }

  async ingestForLead({
    lead,
    provider_key,
    idempotency_key,
    evidence_items,
    simulate_failure_stage = null
  }) {
    const db = this.researchEvidenceRepository.db;
    if (!db.transactionBound) {
      const result = await new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, async tx => {
        const service = new ResearchEvidenceService({ researchEvidenceRepository: new ResearchEvidenceRepository(tx), auditRepository: this.auditRepository ? new AuditRepository(tx) : null });
        try { return { value: await service.ingestForLead({ lead, provider_key, idempotency_key, evidence_items, simulate_failure_stage }) }; }
        catch (error) { return { error }; }
      });
      if (result.error) throw result.error;
      return result.value;
    }
    lead = await currentLeadData(db, lead);
    requireProvider(provider_key);
    requireText(idempotency_key, "idempotency_key");
    if (!Array.isArray(evidence_items) || evidence_items.length === 0) {
      throw new Error("evidence_items must contain at least one item.");
    }

    const existing = await this.researchEvidenceRepository.findIngestionByIdempotencyKey({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      idempotency_key
    });
    if (existing?.state === RESEARCH_EVIDENCE_INGESTION_STATES.PERSISTED) {
      return await this.researchEvidenceRepository.ingestionDetail(existing);
    }

    if (evidence_items.length > 100 || Buffer.byteLength(JSON.stringify(evidence_items), "utf8") > 524288) throw freshnessError("FRESHNESS_INPUT_LIMIT", "Research ingestion exceeds 100 records or 512 KiB.", 409);
    const adapter = new ApprovedManualResearchAdapter({ provider_key });
    const normalizedItems = adapter.normalize(evidence_items);
    const errors = normalizedItems.flatMap((item, index) => validateResearchEvidenceItem(item).map(message => "item " + (index + 1) + ": " + message));
    if (errors.length) throw Object.assign(new Error(errors.join(" ")), { statusCode: 400 });
    const retained = (await this.researchEvidenceRepository.evidenceItemsForLead(lead.id, lead.organization_id)).filter(item => item.ingestion_id !== existing?.id);
    // This conservative request bound includes future persisted ownership/identifier overhead.
    if (retained.length + normalizedItems.length > 100 || Buffer.byteLength(JSON.stringify([...retained, ...normalizedItems]), "utf8") + normalizedItems.length * 1024 > 524288) throw freshnessError("FRESHNESS_INPUT_LIMIT", "Combined research sources exceed the bounded input limit.", 409);
    const ingestion =
      existing ||
      await this.researchEvidenceRepository.createIngestion({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        adapter_type: RESEARCH_EVIDENCE_ADAPTER_TYPES.APPROVED_MANUAL_RESEARCH,
        provider_key,
        idempotency_key,
        request: { provider_key, evidence_count: evidence_items.length }
      });

    try {
      if (simulate_failure_stage === "AFTER_INGESTION") {
        throw new Error("Simulated research evidence ingestion failure.");
      }

      await this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.VALIDATED
      });
      await this.researchEvidenceRepository.replaceEvidenceItems(ingestion.id);
      const persisted = [];
      for (const item of normalizedItems) {
        persisted.push(
          await this.researchEvidenceRepository.createEvidenceItem({
            ingestion_id: ingestion.id,
            organization_id: lead.organization_id,
            lead_id: lead.id,
            ...item
          })
        );
      }
      const completed = await this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.PERSISTED,
        summary: { evidence_count: persisted.length },
        completed: true
      });
      await this.auditRepository?.record({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        event_type: "ResearchEvidenceIngested",
        message: "Research evidence normalized and persisted.",
        metadata: {
          ingestion_id: ingestion.id,
          provider_key,
          evidence_count: persisted.length
        }
      });
      return await this.researchEvidenceRepository.ingestionDetail(completed);
    } catch (error) {
      await this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.FAILED,
        last_error: error.message || String(error)
      });
      throw error;
    }
  }

  async listForLead(lead) {
    const evidenceItems = await this.researchEvidenceRepository.evidenceItemsForLead(lead.id, lead.organization_id);
    return {
      ingestions: await this.researchEvidenceRepository.listIngestionsForLead(lead.id, lead.organization_id),
      evidence_items: evidenceItems.map(serializeEvidenceItem)
    };
  }
}

function requireProvider(providerKey) {
  requireText(providerKey, "provider_key");
  if (!APPROVED_RESEARCH_PROVIDERS.has(providerKey)) {
    throw new Error("provider_key is not approved for M2.1.");
  }
}

function requireText(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
}
