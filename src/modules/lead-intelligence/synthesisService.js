import { createHash } from "node:crypto";
import { serializeEvidenceItem } from "./researchEvidenceRepository.js";
import { LocalSynthesisAgent } from "./localSynthesisAgent.js";
import {
  collectEvidenceRefs,
  SYNTHESIS_PIPELINE_VERSION,
  SYNTHESIS_STATUS,
  validateSynthesisOutput
} from "./synthesisContract.js";

export class SynthesisService {
  constructor({
    synthesisRepository,
    intelligenceService,
    researchEvidenceRepository,
    auditRepository = null,
    synthesisAgent = new LocalSynthesisAgent()
  }) {
    this.synthesisRepository = synthesisRepository;
    this.intelligenceService = intelligenceService;
    this.researchEvidenceRepository = researchEvidenceRepository;
    this.auditRepository = auditRepository;
    this.synthesisAgent = synthesisAgent;
  }

  async runForLead(lead, { simulate_failure_stage = null } = {}) {
    const input = await this.buildInput(lead);
    const existing = await this.synthesisRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.input_fingerprint,
      pipeline_version: SYNTHESIS_PIPELINE_VERSION
    });
    if (existing?.status === SYNTHESIS_STATUS.READY) {
      return this.synthesisRepository.runDetail(existing);
    }

    const run =
      existing ||
      await this.synthesisRepository.createDraft({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        snapshot_id: input.snapshot.id,
        pipeline_version: SYNTHESIS_PIPELINE_VERSION,
        input_fingerprint: input.input_fingerprint
      });

    try {
      if (simulate_failure_stage === "AFTER_DRAFT") {
        throw new Error("Simulated synthesis failure after draft run.");
      }

      const output = await this.synthesisAgent.synthesize({
        lead,
        snapshot: input.snapshot,
        researchEvidenceItems: input.research_evidence_items
      });
      if (simulate_failure_stage === "AFTER_SYNTHESIS") {
        throw new Error("Simulated synthesis failure after output generation.");
      }

      const errors = validateSynthesisOutput(output);
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }

      const finalized = await this.synthesisRepository.markReady(run.id, {
        summary: output.summary,
        findings: output.findings,
        qualification: output.qualification,
        recommendation: output.recommendation,
        evidence_refs: collectEvidenceRefs(output)
      });
      await this.synthesisRepository.supersedeReadyRuns({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        except_run_id: finalized.id
      });
      await this.auditRepository?.record({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        event_type: "LeadIntelligenceSynthesized",
        message: "Evidence-grounded Lead Intelligence synthesis generated.",
        metadata: {
          synthesis_id: finalized.id,
          snapshot_id: input.snapshot.id,
          finding_count: output.findings.length,
          research_evidence_count: input.research_evidence_items.length
        }
      });
      return this.synthesisRepository.runDetail(finalized);
    } catch (error) {
      await this.synthesisRepository.markFailed(run.id, error);
      throw error;
    }
  }

  async currentForLead(lead) {
    const input = await this.tryBuildInput(lead);
    if (!input.ready) {
      return {
        synthesis_status: "NOT_READY",
        reason: input.reason,
        synthesis: null
      };
    }
    const run = await this.synthesisRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.value.input_fingerprint,
      pipeline_version: SYNTHESIS_PIPELINE_VERSION
    });
    return {
      synthesis_status: run?.status || "NOT_RUN",
      reason: run ? null : "No synthesis has been generated for the current intelligence evidence.",
      synthesis: run?.status === SYNTHESIS_STATUS.READY ? this.synthesisRepository.runDetail(run) : null
    };
  }

  async historyForLead(lead) {
    return (await this.synthesisRepository.historyForLead(lead.id, lead.organization_id)).map((run) => {
      return this.synthesisRepository.runDetail(run);
    });
  }

  async buildInput(lead) {
    const result = await this.tryBuildInput(lead);
    if (!result.ready) {
      throw new Error(result.reason);
    }
    return result.value;
  }

  async tryBuildInput(lead) {
    const intelligenceContext = await this.intelligenceService.assessLead(lead);
    const snapshot = intelligenceContext.snapshot;
    if (!snapshot || snapshot.status !== "READY") {
      return {
        ready: false,
        reason: "Run Lead Intelligence before synthesis."
      };
    }
    const researchEvidenceRecords = await this.researchEvidenceRepository.evidenceItemsForLead(
      lead.id,
      lead.organization_id
    );
    const researchEvidenceItems = researchEvidenceRecords.map(serializeEvidenceItem);
    return {
      ready: true,
      value: {
        lead,
        snapshot,
        research_evidence_items: researchEvidenceItems,
        input_fingerprint: synthesisFingerprint({ lead, snapshot, researchEvidenceItems })
      }
    };
  }
}

function synthesisFingerprint({ lead, snapshot, researchEvidenceItems }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        lead_id: lead.id,
        organization_id: lead.organization_id,
        snapshot_id: snapshot.id,
        snapshot_pipeline_version: snapshot.pipeline_version,
        snapshot_claims: (snapshot.claims || []).map((claim) => ({
          id: claim.id,
          field: claim.field,
          value: claim.value,
          evidence_ids: claim.evidence_ids
        })),
        snapshot_signals: (snapshot.signals || []).map((signal) => ({
          id: signal.id,
          type: signal.type,
          value: signal.value,
          evidence_ids: signal.evidence_ids
        })),
        research_evidence: researchEvidenceItems.map((item) => ({
          id: item.id,
          ingestion_id: item.ingestion_id,
          claim_field: item.claim_field,
          claim_value: item.claim_value,
          confidence: item.confidence
        }))
      })
    )
    .digest("hex");
}
