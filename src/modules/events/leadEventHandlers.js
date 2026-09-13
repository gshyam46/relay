import { scoped, scopedLead, processingPolicy, skipArchived, completeAudit, payload, runAnalysisPipeline } from "../analysis-jobs/analysisPipelineRunner.js";
import { inputHash, eventError } from "./domainEventProcessor.js";

export function createLeadEventHandlers({getServices,generationTimeoutMs=30000}) {
 if (typeof getServices!=="function" || !Number.isSafeInteger(generationTimeoutMs) || generationTimeoutMs<1 || generationTimeoutMs>30000) throw new TypeError("Invalid lead processing composition.");
 return {
    LeadCreated: async (event, context) => {
      await context.transaction(async (tx) => {
        const services = scoped(tx);
        let lead = await scopedLead(tx, event);
        if (await skipArchived(tx, event, context, lead, ["normalize", "snapshot", "initial_action"])) return;
        if (lead.status === "NEW") {
          await services.leadsRepository.updateLeadStatus(lead.id, "NORMALIZED");
          lead = await scopedLead(tx, event);
        }
        await context.stage(tx, { stage_key: "normalize", input_fingerprint: inputHash({ lead_id: lead.id, status: lead.status }), status: "DONE" });
        const snapshot = await services.intelligenceService.runForLead(lead);
        await context.stage(tx, { stage_key: "snapshot", input_fingerprint: snapshot.input_fingerprint, status: "DONE", artifact_type: "SNAPSHOT", artifact_id: snapshot.id });
        const policy = await processingPolicy(tx, lead);
        let action = await services.actionsRepository.getByIdempotencyKey("lead:" + lead.id + ":initial-next-best-action");
        if (action && action.organization_id !== event.organization_id) throw eventError("EVENT_INVALID_PAYLOAD", "Initial action does not belong to this workspace.", 422);
        if (!action && !policy.restricted) action = await services.actionsService.planInitialAction(lead);
        await context.stage(tx, { stage_key: "initial_action", input_fingerprint: inputHash({ lead_id: lead.id, snapshot_id: snapshot.id, restricted: policy.restricted }),
          status: policy.restricted ? "SKIPPED" : "DONE", artifact_type: action ? "ACTION" : null, artifact_id: action?.id || null });
        await completeAudit(tx, event, context, { snapshot_id: snapshot.id, action_id: action?.id || null }, {
          message: "Initial Lead Intelligence snapshot created.", metadata: { domain_event_id: event.id, snapshot_id: snapshot.id }
        });
      });
    },
    LeadReplyReceived: (event,context) => runAnalysisPipeline({event,context,getServices,generationTimeoutMs,reply:true}),
    AnalysisRequested: (event,context) => { const service=getServices().analysisJobsService; if(!service) throw eventError("EVENT_PIPELINE_UNAVAILABLE","Analysis jobs are unavailable."); return service.handleEvent(event,context); },
    ActionCompleted: async (event, context) => context.transaction(async (tx) => {
      // Callback processing already commits the authoritative action/execution facts.
      // This explicit notification handler neither replays nor invents those effects.
      await context.stage(tx, { stage_key: "notification", input_fingerprint: inputHash(payload(event)), status: "DONE" });
    })
  };
}
