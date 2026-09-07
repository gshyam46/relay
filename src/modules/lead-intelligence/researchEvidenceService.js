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

  ingestForLead({
    lead,
    provider_key,
    idempotency_key,
    evidence_items,
    simulate_failure_stage = null
  }) {
    requireProvider(provider_key);
    requireText(idempotency_key, "idempotency_key");
    if (!Array.isArray(evidence_items) || evidence_items.length === 0) {
      throw new Error("evidence_items must contain at least one item.");
    }

    const existing = this.researchEvidenceRepository.findIngestionByIdempotencyKey({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      idempotency_key
    });
    if (existing?.state === RESEARCH_EVIDENCE_INGESTION_STATES.PERSISTED) {
      return this.researchEvidenceRepository.ingestionDetail(existing);
    }

    const ingestion =
      existing ||
      this.researchEvidenceRepository.createIngestion({
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

      const adapter = new ApprovedManualResearchAdapter({ provider_key });
      const normalizedItems = adapter.normalize(evidence_items);
      const errors = normalizedItems.flatMap((item, index) =>
        validateResearchEvidenceItem(item).map((message) => `item ${index + 1}: ${message}`)
      );
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }

      this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.VALIDATED
      });
      this.researchEvidenceRepository.replaceEvidenceItems(ingestion.id);
      const persisted = normalizedItems.map((item) =>
        this.researchEvidenceRepository.createEvidenceItem({
          ingestion_id: ingestion.id,
          organization_id: lead.organization_id,
          lead_id: lead.id,
          ...item
        })
      );
      const completed = this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.PERSISTED,
        summary: { evidence_count: persisted.length },
        completed: true
      });
      this.auditRepository?.record({
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
      return this.researchEvidenceRepository.ingestionDetail(completed);
    } catch (error) {
      this.researchEvidenceRepository.updateIngestionState(ingestion.id, {
        state: RESEARCH_EVIDENCE_INGESTION_STATES.FAILED,
        last_error: error.message || String(error)
      });
      throw error;
    }
  }

  listForLead(lead) {
    return {
      ingestions: this.researchEvidenceRepository.listIngestionsForLead(lead.id, lead.organization_id),
      evidence_items: this.researchEvidenceRepository.evidenceItemsForLead(lead.id, lead.organization_id).map(serializeEvidenceItem)
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
