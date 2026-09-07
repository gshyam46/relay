import { createHash } from "node:crypto";
import { ActionPlanner } from "./actionPlanner.js";
import { PolicyEngine } from "./policyEngine.js";
import {
  NEXT_BEST_ACTION_PIPELINE_VERSION,
  NEXT_BEST_ACTION_PLAN_STATUS,
  validateNextBestActionPlanOutput
} from "./nextBestActionContract.js";

export class NextBestActionService {
  constructor({
    nextBestActionRepository,
    intelligenceRecommendationService,
    auditRepository = null,
    actionPlanner = new ActionPlanner(),
    policyEngine = new PolicyEngine()
  }) {
    this.nextBestActionRepository = nextBestActionRepository;
    this.intelligenceRecommendationService = intelligenceRecommendationService;
    this.auditRepository = auditRepository;
    this.actionPlanner = actionPlanner;
    this.policyEngine = policyEngine;
  }

  planForLead(lead, { simulate_failure_stage = null } = {}) {
    const input = this.buildInput(lead);
    const existing = this.nextBestActionRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.input_fingerprint,
      pipeline_version: NEXT_BEST_ACTION_PIPELINE_VERSION
    });
    if (["PLANNED", "BLOCKED"].includes(existing?.status)) {
      return this.nextBestActionRepository.planDetail(existing);
    }

    const draft =
      existing ||
      this.nextBestActionRepository.createDraft({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        intelligence_recommendation_id: input.intelligence_recommendation.id,
        synthesis_id: input.intelligence_recommendation.synthesis_id,
        snapshot_id: input.intelligence_recommendation.snapshot_id,
        pipeline_version: NEXT_BEST_ACTION_PIPELINE_VERSION,
        input_fingerprint: input.input_fingerprint
      });

    try {
      if (simulate_failure_stage === "AFTER_DRAFT") {
        throw new Error("Simulated next-best-action planning failure after draft.");
      }
      const actionType = input.intelligence_recommendation.recommendation?.step;
      const policyDecision = this.policyEngine.evaluate({ lead, actionType });
      const output = this.actionPlanner.plan({
        intelligenceRecommendation: input.intelligence_recommendation,
        policyDecision
      });
      if (simulate_failure_stage === "AFTER_POLICY") {
        throw new Error("Simulated next-best-action planning failure after policy.");
      }
      const errors = validateNextBestActionPlanOutput(output);
      if (errors.length > 0) {
        throw new Error(errors.join(" "));
      }
      const status =
        output.policy_decision.decision === "BLOCK"
          ? NEXT_BEST_ACTION_PLAN_STATUS.BLOCKED
          : NEXT_BEST_ACTION_PLAN_STATUS.PLANNED;
      const plan = this.nextBestActionRepository.markReady(draft.id, {
        status,
        ...output
      });
      this.nextBestActionRepository.supersedeReadyPlans({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        except_plan_id: plan.id
      });
      this.auditRepository?.record({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        event_type: "NextBestActionPlanned",
        message: "Policy-checked next-best-action plan generated.",
        metadata: {
          plan_id: plan.id,
          action_type: plan.action_type,
          status: plan.status,
          policy_decision: output.policy_decision.decision
        }
      });
      return this.nextBestActionRepository.planDetail(plan);
    } catch (error) {
      this.nextBestActionRepository.markFailed(draft.id, error);
      throw error;
    }
  }

  currentForLead(lead) {
    const input = this.tryBuildInput(lead);
    if (!input.ready) {
      return {
        plan_status: "NOT_READY",
        reason: input.reason,
        next_best_action_plan: null
      };
    }
    const plan = this.nextBestActionRepository.findByFingerprint({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      input_fingerprint: input.value.input_fingerprint,
      pipeline_version: NEXT_BEST_ACTION_PIPELINE_VERSION
    });
    return {
      plan_status: plan?.status || "NOT_RUN",
      reason: plan ? null : "No next-best-action plan has been generated for the current recommendation.",
      next_best_action_plan: ["PLANNED", "BLOCKED"].includes(plan?.status) ? this.nextBestActionRepository.planDetail(plan) : null
    };
  }

  historyForLead(lead) {
    return this.nextBestActionRepository.historyForLead(lead.id, lead.organization_id).map((plan) => {
      return this.nextBestActionRepository.planDetail(plan);
    });
  }

  buildInput(lead) {
    const result = this.tryBuildInput(lead);
    if (!result.ready) {
      throw new Error(result.reason);
    }
    return result.value;
  }

  tryBuildInput(lead) {
    const recommendationState = this.intelligenceRecommendationService.currentForLead(lead);
    const intelligenceRecommendation = recommendationState.intelligence_recommendation;
    if (!intelligenceRecommendation || intelligenceRecommendation.status !== "READY") {
      return {
        ready: false,
        reason: "Run intelligence recommendation before planning the next best action."
      };
    }
    return {
      ready: true,
      value: {
        intelligence_recommendation: intelligenceRecommendation,
        input_fingerprint: planFingerprint({ lead, intelligenceRecommendation })
      }
    };
  }
}

function planFingerprint({ lead, intelligenceRecommendation }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        lead_id: lead.id,
        organization_id: lead.organization_id,
        lead_status: lead.status,
        intelligence_recommendation_id: intelligenceRecommendation.id,
        action_step: intelligenceRecommendation.recommendation?.step,
        priority: intelligenceRecommendation.priority,
        segment: intelligenceRecommendation.segment,
        evidence_refs: intelligenceRecommendation.evidence_refs
      })
    )
    .digest("hex");
}
