import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { LeadsRepository } from "../data-foundation/leadsRepository.js";
import { InboundEventsRepository } from "../channels/inboundEventsRepository.js";
import { IntelligenceRepository } from "../lead-intelligence/intelligenceRepository.js";
import { IntelligenceService } from "../lead-intelligence/intelligenceService.js";
import { ResearchEvidenceRepository } from "../lead-intelligence/researchEvidenceRepository.js";
import { SynthesisRepository } from "../lead-intelligence/synthesisRepository.js";
import { SynthesisService } from "../lead-intelligence/synthesisService.js";
import { IntelligenceRecommendationRepository } from "../lead-intelligence/intelligenceRecommendationRepository.js";
import { IntelligenceRecommendationService } from "../lead-intelligence/intelligenceRecommendationService.js";
import { NextBestActionRepository } from "../next-best-action/nextBestActionRepository.js";
import { NextBestActionService } from "../next-best-action/nextBestActionService.js";
import { ActionsRepository } from "../outbound-automation/actionsRepository.js";
import { ActionsService } from "../outbound-automation/actionsService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { eventError, inputHash, canonical } from "../events/domainEventProcessor.js";

import { getGenerationDescriptor } from "../ai-usage/generationDescriptor.js";
import { withAiInvocationContext } from "../ai-usage/aiInvocationContext.js";

export function scoped(tx, source = {}, prepared = null, now = Date.now) {
  const auditRepository = new AuditRepository(tx);
  const intelligenceRepository = new IntelligenceRepository(tx);
  const intelligenceService = new IntelligenceService({ intelligenceRepository, auditRepository, inboundEventsRepository: new InboundEventsRepository(tx), now });
  const unavailable = () => { throw eventError("EVENT_PIPELINE_UNAVAILABLE", "A prepared processing result is required."); };
  const provide = (name) => prepared?.name === name ? prepared.provide : unavailable;
  const synthesisService = new SynthesisService({ synthesisRepository: new SynthesisRepository(tx), intelligenceService,
    researchEvidenceRepository: new ResearchEvidenceRepository(tx), auditRepository, now, generationDescriptor: source.synthesisService?.generationDescriptor, synthesisAgent: { synthesize: provide("synthesis") } });
  const intelligenceRecommendationService = new IntelligenceRecommendationService({ recommendationRepository: new IntelligenceRecommendationRepository(tx),
    synthesisService, intelligenceRepository, auditRepository, now, recommendationAgent: { recommend: provide("recommendation") } });
  const nextBestActionService = new NextBestActionService({ nextBestActionRepository: new NextBestActionRepository(tx), intelligenceRecommendationService,
    auditRepository, now, actionPlanner: { plan: provide("plan") }, ...(source.nextBestActionService?.policyEngine ? { policyEngine: source.nextBestActionService.policyEngine } : {}) });
  const actionsRepository = new ActionsRepository(tx);
  return { leadsRepository: new LeadsRepository(tx), auditRepository, intelligenceRepository, intelligenceService, synthesisService,
    intelligenceRecommendationService, nextBestActionService, actionsRepository,
    actionsService: new ActionsService({ actionsRepository, intelligenceRepository, auditRepository }) };
}
export async function scopedLead(tx, event) {
  const lead = await new LeadsRepository(tx).getLead(event.lead_id);
  if (!lead || lead.organization_id !== event.organization_id) throw eventError("EVENT_LEAD_NOT_FOUND", "The lead is unavailable for this workspace.", 422);
  return lead;
}
export function payload(event) {
  try { const value = JSON.parse(event.payload_json); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw eventError("EVENT_INVALID_PAYLOAD", "The persisted event input is invalid.", 422); }
}
export async function stageInput(name, services, lead) {
  try {
    if (name === "synthesis") {
      const input = await services.synthesisService.buildInput(lead);
      return { lead, snapshot: input.snapshot, researchEvidenceItems: input.research_evidence_items };
    }
    if (name === "recommendation") {
      const input = await services.intelligenceRecommendationService.buildInput(lead);
      return { lead, snapshot: input.snapshot, synthesis: input.synthesis };
    }
    const input = await services.nextBestActionService.buildInput(lead);
    const planningContext = await services.intelligenceRecommendationService.buildInput(lead);
    const policyDecision = services.nextBestActionService.policyEngine.evaluate({ lead, actionType: input.intelligence_recommendation.recommendation?.step });
    return { lead, snapshot: planningContext.snapshot, intelligenceRecommendation: input.intelligence_recommendation, policyDecision };
  } catch (error) {
    if (error.code) throw error;
    // The preceding snapshot/input may have changed while a model was running.
    throw eventError("EVENT_INPUT_CHANGED", "The current lead evidence is not ready for this processing stage.");
  }
}
export async function currentStage(name, services, lead) {
  if (name === "synthesis") return (await services.synthesisService.currentForLead(lead)).synthesis;
  if (name === "recommendation") return (await services.intelligenceRecommendationService.currentForLead(lead)).intelligence_recommendation;
  return (await services.nextBestActionService.currentForLead(lead)).next_best_action_plan;
}
export function runStage(name, services, lead, options = {}) {
  if (name === "synthesis") return services.synthesisService.runForLead(lead, options);
  if (name === "recommendation") return services.intelligenceRecommendationService.runForLead(lead, options);
  return services.nextBestActionService.planForLead(lead, options);
}
export function generatorFor(source, name) {
  if (name === "synthesis") return (input) => source.synthesisService.synthesisAgent.synthesize(input);
  if (name === "recommendation") return (input) => source.intelligenceRecommendationService.recommendationAgent.recommend(input);
  return (input) => source.nextBestActionService.actionPlanner.plan(input);
}
export function requireStage(source, name) {
  const valid = name === "synthesis" ? typeof source.synthesisService?.synthesisAgent?.synthesize === "function"
    : name === "recommendation" ? typeof source.intelligenceRecommendationService?.recommendationAgent?.recommend === "function"
      : typeof source.nextBestActionService?.actionPlanner?.plan === "function";
  if (!valid) throw eventError("EVENT_PIPELINE_UNAVAILABLE", "The lead processing stage is unavailable.");
}
export async function generate(generator, input, timeoutMs) {
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => generator(structuredClone(input))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(eventError("EVENT_GENERATION_TIMEOUT", "Lead processing exceeded its generation limit.")), timeoutMs); })
    ]);
    const normalized = canonical(result);
    if (Buffer.byteLength(normalized, "utf8") > 256 * 1024) throw eventError("EVENT_GENERATION_INVALID", "The generated processing result exceeds its size limit.", 422);
    return JSON.parse(normalized);
  } finally { clearTimeout(timer); }
}
export async function completeAudit(tx, event, context, input, record) {
  const fingerprint = inputHash(input);
  const existing = (await new EventsRepository(tx).listStages(event.organization_id, event.id)).find((item) => item.stage_key === "done");
  if (existing?.status === "DONE" && existing.input_fingerprint === fingerprint) return;
  await new AuditRepository(tx).record({ organization_id: event.organization_id, lead_id: event.lead_id,
    event_type: "LeadIntelligenceUpdated", ...record });
  await context.stage(tx, { stage_key: "done", input_fingerprint: fingerprint, status: "DONE" });
}

export async function processingPolicy(tx, lead) {
  const policy = await new ContactPolicyService(tx).inspectLeadInTransaction(tx, { organization_id: lead.organization_id, lead_id: lead.id, channel: "ALL" });
  if (policy.policy_pending && !policy.restricted) throw eventError("EVENT_POLICY_PENDING", "Required contact policy is waiting to finish.");
  return policy;
}

export async function skipArchived(tx, event, context, lead, stages) {
  if (!lead.archived_at) return false;
  const input = { lead_id: lead.id, data_revision: lead.data_revision, archived_at: lead.archived_at };
  for (const stage of stages) await context.stage(tx, { stage_key: stage, input_fingerprint: inputHash(input), status: "SKIPPED" });
  await completeAudit(tx, event, context, input, { message: "Skipped new intelligence and outbound work for an archived enquiry.", metadata: { domain_event_id: event.id, code: "LEAD_ARCHIVED" } });
  return true;
}

export async function runAnalysisPipeline({ event, context, getServices, generationTimeoutMs = 30000, reply = false,
  targetStage = "PLAN", executionScope = "PIPELINE", prepareDrafts = false, simulateFailureStage = null }) {
  const stages = ["snapshot", "synthesis", "recommendation", "plan"];
  const requested = executionScope === "SINGLE_STAGE" ? [targetStage.toLowerCase()] : stages.slice(0, stages.indexOf(targetStage.toLowerCase()) + 1);
  let reused = true;
  const artifactIds = {};
  for (const name of requested) {
    if (name === "snapshot") {
      const prepared = await context.transaction(async tx => {
        const lead = await scopedLead(tx, event), services = scoped(tx, getServices(), null, context.now);
        if (lead.archived_at) {
          if (reply) { await skipArchived(tx, event, context, lead, requested); return { stopped: true }; }
          throw eventError("LEAD_ARCHIVED", "This enquiry was archived before analysis.", 409);
        }
        const before = await services.intelligenceService.assessLead(lead);
        try {
          const artifact = await services.intelligenceService.runForLead(lead, { simulate_failure_stage: simulateFailureStage });
          await context.stage(tx, { stage_key: name, input_fingerprint: artifact.input_fingerprint, status: "DONE", artifact_type: "SNAPSHOT", artifact_id: artifact.id });
          return { artifact, cached: before.snapshot?.id === artifact.id };
        } catch (error) { if (simulateFailureStage) return { error }; throw error; }
      });
      if (prepared.error) throw prepared.error;
      if (prepared.stopped) return;
      reused &&= prepared.cached; artifactIds.snapshot = prepared.artifact.id;
      continue;
    }
    const prepared = await context.transaction(async tx => {
      const lead = await scopedLead(tx, event);
      if (lead.archived_at) throw eventError("LEAD_ARCHIVED", "This enquiry was archived before analysis.", 409);
      const policy = await processingPolicy(tx, lead);
      if (policy.restricted && reply) {
        for (const key of requested.filter(key => key !== "snapshot")) await context.stage(tx, { stage_key: key, input_fingerprint: inputHash({ lead_id: lead.id, status: lead.status, restriction_ids: policy.restriction_ids }), status: "SKIPPED" });
        await completeAudit(tx, event, context, { status: lead.status, restriction_ids: policy.restriction_ids }, {
          message: "Updated reply snapshot; skipped contact recommendations for a restricted lead.", metadata: { domain_event_id: event.id, lead_status: lead.status, stages: ["snapshot"] }
        });
        return { stopped: true };
      }
      const source = getServices(); requireStage(source, name);
      const services = scoped(tx, source, null, context.now), input = await stageInput(name, services, lead), fingerprint = inputHash({ input, generation: getGenerationDescriptor(tx) });
      const existing = await currentStage(name, services, lead);
      if (existing) {
        await context.stage(tx, { stage_key: name, input_fingerprint: fingerprint, status: "DONE", artifact_type: name.toUpperCase(), artifact_id: existing.id });
        return { cached: true, artifact: existing };
      }
      await context.stage(tx, { stage_key: name, input_fingerprint: fingerprint, status: "PREPARED" });
      if (simulateFailureStage === "AFTER_DRAFT") {
        try { await runStage(name, services, lead, { simulate_failure_stage: simulateFailureStage }); } catch (error) { return { error }; }
      }
      return { input: structuredClone(input), fingerprint, generator: generatorFor(source, name) };
    });
    if (prepared.stopped) return;
    if (prepared.error) throw prepared.error;
    if (prepared.cached) { artifactIds[name] = prepared.artifact.id; continue; }
    reused = false;
    const output = await withAiInvocationContext({ organization_id: event.organization_id, lead_id: event.lead_id, purpose: "SYNTHESIS",
      origin: { kind: "DOMAIN_EVENT", id: event.id, fence: event.processing_fence }, input_fingerprint: prepared.fingerprint },
      () => generate(prepared.generator, prepared.input, generationTimeoutMs));
    const finalized = await context.transaction(async tx => {
      const lead = await scopedLead(tx, event);
      if (lead.archived_at) throw eventError("EVENT_INPUT_CHANGED", "Enquiry archived during processing.");
      const policy = await processingPolicy(tx, lead);
      if (policy.restricted && reply) throw eventError("EVENT_INPUT_CHANGED", "Contact policy changed during lead processing.");
      const provide = actual => {
        if (inputHash({ input: actual, generation: getGenerationDescriptor(tx) }) !== prepared.fingerprint) throw eventError("EVENT_INPUT_CHANGED", "Lead evidence changed during processing.");
        return structuredClone(output);
      };
      const services = scoped(tx, getServices(), { name, provide }, context.now), actual = await stageInput(name, services, lead);
      if (inputHash({ input: actual, generation: getGenerationDescriptor(tx) }) !== prepared.fingerprint) throw eventError("EVENT_INPUT_CHANGED", "Lead evidence changed during processing.");
      try {
        const artifact = await runStage(name, services, lead, { simulate_failure_stage: simulateFailureStage });
        await context.stage(tx, { stage_key: name, input_fingerprint: prepared.fingerprint, status: "DONE", artifact_type: name.toUpperCase(), artifact_id: artifact.id });
        return { artifact };
      } catch (error) { if (simulateFailureStage) return { error }; throw error; }
    });
    if (finalized.error) throw finalized.error;
    artifactIds[name] = finalized.artifact.id;
  }
  await context.transaction(async tx => {
    const lead = await scopedLead(tx, event);
    if (lead.archived_at) throw eventError("EVENT_INPUT_CHANGED", "Enquiry archived during analysis.");
    if (prepareDrafts) {
      const source = getServices(), services = scoped(tx, source, null, context.now), plan = await currentStage("plan", services, lead);
      const policy = await processingPolicy(tx, lead);
      let action = null;
      if (plan?.status === "PLANNED" && !policy.restricted) {
        const original = source.outboundAutomationService;
        if (!original) throw eventError("ANALYSIS_DRAFT_UNAVAILABLE", "Draft preparation is unavailable.", 409);
        const options = { ...original };
        for (const key of Object.keys(options)) if (key.endsWith("Repository") && options[key]?.db) options[key] = new options[key].constructor(tx);
        const { ApprovalsService } = await import("../outbound-automation/approvalsService.js");
        options.approvalsService = new ApprovalsService({ actionsRepository: options.actionsRepository, approvalsRepository: options.approvalsRepository, auditRepository: options.auditRepository });
        action = await new original.constructor(options).createActionFromPlan({ organization_id: event.organization_id, plan_id: plan.id });
      }
      await context.stage(tx, { stage_key: "draft", input_fingerprint: inputHash({ plan_id: plan?.id || null, restriction_ids: policy.restriction_ids }), status: action ? "DONE" : "SKIPPED", artifact_type: action ? "ACTION" : null, artifact_id: action?.id || null });
    }
    await context.stage(tx, { stage_key: "reused", input_fingerprint: inputHash({ artifactIds, reused }), status: reused ? "DONE" : "SKIPPED" });
    await completeAudit(tx, event, context, artifactIds, {
      event_type: reply ? "LeadIntelligenceUpdated" : "AnalysisCompleted",
      message: reply ? "Re-analysed lead after inbound reply." : "Completed requested Lead Intelligence analysis.",
      metadata: { domain_event_id: event.id, stages: requested, reused, ...(reply ? { inbound_event_id: payload(event).inbound_event_id || null, reply_type: payload(event).event_type || null } : {}) }
    });
  });
}
