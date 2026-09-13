import { currentLeadData } from "../data-foundation/leadDataSafety.js";
import { captureBusinessContext, withCurrentBusinessContext, withScopedCurrentService, inputAuthority } from "./businessContextGuard.js";
import { IntelligenceRecommendationRepository } from "./intelligenceRecommendationRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { createHash } from "node:crypto";
import { LocalRecommendationAgent } from "./localRecommendationAgent.js";
import {
  collectRecommendationEvidenceRefs,
  INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION,
  INTELLIGENCE_RECOMMENDATION_STATUS,
  validateIntelligenceRecommendationOutput
} from "./intelligenceRecommendationContract.js";

export class IntelligenceRecommendationService {
  constructor({
    recommendationRepository,
    synthesisService,
    intelligenceRepository,
    auditRepository = null,
    recommendationAgent = new LocalRecommendationAgent(),
    now = Date.now
  }) {
    this.now = now;
    this.recommendationRepository = recommendationRepository;
    this.synthesisService = synthesisService;
    this.intelligenceRepository = intelligenceRepository;
    this.auditRepository = auditRepository;
    this.recommendationAgent = recommendationAgent;
  }

  async runForLead(lead, { simulate_failure_stage = null } = {}) {
    lead = await currentLeadData(this.recommendationRepository.db, lead);
    const capturedContext = await captureBusinessContext(this.recommendationRepository.db, lead, { now: this.now });
    const input = await this.buildInput(lead);
    const guard = { now: this.now, stage: "intelligenceRecommendationService", input_fingerprint: input.input_fingerprint, input_authority: inputAuthority(input) };
    const existing = await this.recommendationRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.input_fingerprint,
      pipeline_version: INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION
    });
    if (existing?.status === INTELLIGENCE_RECOMMENDATION_STATUS.READY) {
      return withCurrentBusinessContext(this.recommendationRepository.db, lead, capturedContext, tx =>
        new IntelligenceRecommendationRepository(tx).runDetail(existing), guard);
    }

    const run =
      existing ||
      await this.recommendationRepository.createDraft({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        synthesis_id: input.synthesis.id,
        snapshot_id: input.snapshot.id,
        pipeline_version: INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION,
        input_fingerprint: input.input_fingerprint
      });

    try {
      if (simulate_failure_stage === "AFTER_DRAFT") {
        throw new Error("Simulated intelligence recommendation failure after draft run.");
      }

      const output = await this.recommendationAgent.recommend({
        lead,
        snapshot: input.snapshot,
        synthesis: input.synthesis
      });
      if (simulate_failure_stage === "AFTER_RECOMMENDATION") {
        throw new Error("Simulated intelligence recommendation failure after output generation.");
      }

      const errors = validateIntelligenceRecommendationOutput(output);
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }

      return await withCurrentBusinessContext(this.recommendationRepository.db, lead, capturedContext, async (tx) => {
        const repository = tx === this.recommendationRepository.db ? this.recommendationRepository : new IntelligenceRecommendationRepository(tx);
        const audit = this.auditRepository ? (tx === this.auditRepository.db ? this.auditRepository : new AuditRepository(tx)) : null;
        const finalized = await repository.markReady(run.id, {
          priority: output.priority,
          segment: output.segment,
          personalization_context: output.personalization_context,
          recommendation: output.recommendation,
          evidence_refs: collectRecommendationEvidenceRefs(output)
        });
        await repository.supersedeReadyRuns({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          except_run_id: finalized.id
        });
        await audit?.record({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          event_type: "LeadIntelligenceRecommendationUpdated",
          message: "Evidence-grounded Lead Intelligence recommendation generated.",
          metadata: {
            recommendation_id: finalized.id,
            synthesis_id: input.synthesis.id,
            snapshot_id: input.snapshot.id,
            recommended_step: output.recommendation.step,
            segment: output.segment.type,
            priority_score: output.priority.score
          }
        });
        return repository.runDetail(finalized);
      }, guard);
    } catch (error) {
      await this.recommendationRepository.markFailed(run.id, error);
      throw error;
    }
  }

  async currentForLead(lead) {
    if (!this.recommendationRepository.db.transactionBound) return withScopedCurrentService(this.recommendationRepository.db, lead, "intelligenceRecommendationService", service => service.currentForLead(lead), { now: this.now });
    const input = await this.tryBuildInput(lead);
    if (!input.ready) {
      return {
        recommendation_status: "NOT_READY",
        reason: input.reason,
        intelligence_recommendation: null
      };
    }
    const run = await this.recommendationRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.value.input_fingerprint,
      pipeline_version: INTELLIGENCE_RECOMMENDATION_PIPELINE_VERSION
    });
    return {
      recommendation_status: run?.status || "NOT_RUN",
      reason: run ? null : "No intelligence recommendation has been generated for the current synthesis.",
      intelligence_recommendation:
        run?.status === INTELLIGENCE_RECOMMENDATION_STATUS.READY ? this.recommendationRepository.runDetail(run) : null
    };
  }

  async historyForLead(lead) {
    return (await this.recommendationRepository.historyForLead(lead.id, lead.organization_id)).map((run) => {
      return this.recommendationRepository.runDetail(run);
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
    const synthesisState = await this.synthesisService.currentForLead(lead);
    const synthesis = synthesisState.synthesis;
    if (!synthesis || synthesis.status !== "READY") {
      return {
        ready: false,
        reason: "Run Lead Intelligence synthesis before recommendation."
      };
    }
    const snapshot = await this.intelligenceRepository.snapshotDetail(
      await this.intelligenceRepository.getSnapshot(synthesis.snapshot_id),
      lead.organization_id
    );
    if (!snapshot || snapshot.status !== "READY") {
      return {
        ready: false,
        reason: "Run Lead Intelligence before recommendation."
      };
    }
    return {
      ready: true,
      value: {
        lead,
        snapshot,
        synthesis,
        input_fingerprint: recommendationFingerprint({ lead, snapshot, synthesis })
      }
    };
  }
}

function recommendationFingerprint({ lead, snapshot, synthesis }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        lead_id: lead.id,
        organization_id: lead.organization_id,
        snapshot_id: snapshot.id,
        synthesis_id: synthesis.id,
        synthesis_version: synthesis.version,
        synthesis_evidence_refs: synthesis.evidence_refs,
        synthesis_qualification: synthesis.qualification,
        synthesis_recommendation: synthesis.recommendation
      })
    )
    .digest("hex");
}
