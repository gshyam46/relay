import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sendError, sendJson, serveStatic } from "../shared/http.js";
import { LeadsRepository } from "../modules/data-foundation/leadsRepository.js";
import { validateLeadInput } from "../modules/data-foundation/leadValidation.js";
import { ImportsRepository } from "../modules/data-foundation/importsRepository.js";
import { ImportsService } from "../modules/data-foundation/importsService.js";
import { normalizeEmail, normalizePhone } from "../modules/data-foundation/normalization.js";
import { EventsRepository } from "../modules/events/eventsRepository.js";
import { AuditRepository } from "../modules/events/auditRepository.js";
import { IntelligenceRepository } from "../modules/lead-intelligence/intelligenceRepository.js";
import { IntelligenceService } from "../modules/lead-intelligence/intelligenceService.js";
import { ResearchEvidenceRepository } from "../modules/lead-intelligence/researchEvidenceRepository.js";
import { ResearchEvidenceService } from "../modules/lead-intelligence/researchEvidenceService.js";
import { SynthesisRepository } from "../modules/lead-intelligence/synthesisRepository.js";
import { SynthesisService } from "../modules/lead-intelligence/synthesisService.js";
import { IntelligenceRecommendationRepository } from "../modules/lead-intelligence/intelligenceRecommendationRepository.js";
import { IntelligenceRecommendationService } from "../modules/lead-intelligence/intelligenceRecommendationService.js";
import { NextBestActionRepository } from "../modules/next-best-action/nextBestActionRepository.js";
import { NextBestActionService } from "../modules/next-best-action/nextBestActionService.js";
import { ActionsRepository } from "../modules/outbound-automation/actionsRepository.js";
import { ExecutionsRepository } from "../modules/outbound-automation/executionsRepository.js";
import { ActionsService } from "../modules/outbound-automation/actionsService.js";
import { ApprovalsRepository } from "../modules/outbound-automation/approvalsRepository.js";
import { ApprovalsService } from "../modules/outbound-automation/approvalsService.js";
import { CallbacksRepository } from "../modules/outbound-automation/callbacksRepository.js";
import { CallbacksService } from "../modules/outbound-automation/callbacksService.js";
import { OutboundAutomationService } from "../modules/outbound-automation/outboundAutomationService.js";
import { APPROVAL_STATUS } from "../modules/outbound-automation/approvalContract.js";
import { validateActionInput } from "../modules/outbound-automation/actionContract.js";
import { ChannelMessagesRepository } from "../modules/channels/channelMessagesRepository.js";
import { InboundEventsRepository } from "../modules/channels/inboundEventsRepository.js";
import { FollowUpsRepository } from "../modules/channels/followUpsRepository.js";
import { ChannelWorkflowService } from "../modules/channels/channelWorkflowService.js";
import { FOLLOW_UP_STATUS } from "../modules/channels/channelContract.js";
import { WorkflowsRepository } from "../modules/workflows/workflowsRepository.js";
import { WorkflowsService } from "../modules/workflows/workflowsService.js";
import { WORKFLOW_RUN_STATUS } from "../modules/workflows/workflowContract.js";
import { MockN8nAdapter } from "../modules/handlers/mockN8nAdapter.js";
import { ActionExecutor } from "../modules/handlers/actionExecutor.js";
import { Worker } from "../modules/events/worker.js";
import { parseJson } from "../database/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "..", "public");

export function createServices(db) {
  const leadsRepository = new LeadsRepository(db);
  const importsRepository = new ImportsRepository(db);
  const eventsRepository = new EventsRepository(db);
  const auditRepository = new AuditRepository(db);
  const importsService = new ImportsService({ importsRepository, leadsRepository, eventsRepository, auditRepository });
  const intelligenceRepository = new IntelligenceRepository(db);
  const intelligenceService = new IntelligenceService({ intelligenceRepository, auditRepository });
  const researchEvidenceRepository = new ResearchEvidenceRepository(db);
  const researchEvidenceService = new ResearchEvidenceService({ researchEvidenceRepository, auditRepository });
  const synthesisRepository = new SynthesisRepository(db);
  const synthesisService = new SynthesisService({
    synthesisRepository,
    intelligenceService,
    researchEvidenceRepository,
    auditRepository
  });
  const intelligenceRecommendationRepository = new IntelligenceRecommendationRepository(db);
  const intelligenceRecommendationService = new IntelligenceRecommendationService({
    recommendationRepository: intelligenceRecommendationRepository,
    synthesisService,
    intelligenceRepository,
    auditRepository
  });
  const nextBestActionRepository = new NextBestActionRepository(db);
  const nextBestActionService = new NextBestActionService({
    nextBestActionRepository,
    intelligenceRecommendationService,
    auditRepository
  });
  const actionsRepository = new ActionsRepository(db);
  const executionsRepository = new ExecutionsRepository(db);
  const actionsService = new ActionsService({ actionsRepository, intelligenceRepository, auditRepository });
  const approvalsRepository = new ApprovalsRepository(db);
  const approvalsService = new ApprovalsService({ approvalsRepository, actionsRepository, auditRepository });
  const adapter = new MockN8nAdapter();
  const channelMessagesRepository = new ChannelMessagesRepository(db);
  const inboundEventsRepository = new InboundEventsRepository(db);
  const followUpsRepository = new FollowUpsRepository(db);
  const workflowsRepository = new WorkflowsRepository(db);
  const channelWorkflowService = new ChannelWorkflowService({
    leadsRepository,
    actionsRepository,
    channelMessagesRepository,
    inboundEventsRepository,
    followUpsRepository,
    auditRepository
  });
  const actionExecutor = new ActionExecutor({
    actionsRepository,
    executionsRepository,
    auditRepository,
    adapter,
    channelWorkflowService
  });
  const workflowsService = new WorkflowsService({
    workflowsRepository,
    leadsRepository,
    actionsRepository,
    approvalsService,
    actionExecutor,
    auditRepository
  });
  channelWorkflowService.workflowService = workflowsService;
  const callbacksRepository = new CallbacksRepository(db);
  const callbacksService = new CallbacksService({
    callbacksRepository,
    actionsRepository,
    executionsRepository,
    leadsRepository,
    importsRepository,
    importsService,
    eventsRepository,
    auditRepository,
    channelWorkflowService
  });
  const outboundAutomationService = new OutboundAutomationService({
    actionsRepository,
    executionsRepository,
    callbacksRepository,
    approvalsRepository,
    approvalsService,
    nextBestActionRepository,
    actionExecutor,
    auditRepository
  });
  const worker = new Worker({
    eventsRepository,
    leadsRepository,
    intelligenceService,
    actionsService,
    actionsRepository,
    actionExecutor,
    auditRepository
  });

  return {
    leadsRepository,
    importsRepository,
    importsService,
    eventsRepository,
    auditRepository,
    intelligenceRepository,
    intelligenceService,
    researchEvidenceRepository,
    researchEvidenceService,
    synthesisRepository,
    synthesisService,
    intelligenceRecommendationRepository,
    intelligenceRecommendationService,
    nextBestActionRepository,
    nextBestActionService,
    actionsRepository,
    executionsRepository,
    actionsService,
    approvalsRepository,
    approvalsService,
    channelMessagesRepository,
    inboundEventsRepository,
    followUpsRepository,
    channelWorkflowService,
    workflowsRepository,
    workflowsService,
    callbacksRepository,
    callbacksService,
    outboundAutomationService,
    worker
  };
}

export function createApp({ db }) {
  const services = createServices(db);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const route = `${request.method} ${url.pathname}`;

      if (route === "GET /api/health") {
        sendJson(response, 200, {
          product: "AI Lead Intelligence & Outbound Automation",
          status: "ok"
        });
        return;
      }

      if (route === "GET /api/organizations") {
        sendJson(response, 200, { organizations: services.leadsRepository.listOrganizations() });
        return;
      }

      if (route === "POST /api/organizations") {
        const body = await readJson(request);
        requireText(body.name, "name");
        const existing = services.leadsRepository.getOrganizationByName(body.name);
        if (existing) {
          throw httpError(409, "An organization with this name already exists.");
        }
        const organization = services.leadsRepository.createOrganization({ name: body.name.trim() });
        services.auditRepository.record({
          organization_id: organization.id,
          event_type: "OrganizationCreated",
          message: "Organization created.",
          metadata: { name: organization.name }
        });
        sendJson(response, 201, { organization });
        return;
      }

      if (route === "POST /api/leads") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const organization = services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        const source = optionalText(body.source) || "MANUAL";
        requireNoValidationErrors(
          validateLeadInput({
            name: body.name,
            email: optionalText(body.email),
            phone: optionalText(body.phone),
            source
          })
        );

        const normalizedEmail = normalizeEmail(optionalText(body.email));
        const normalizedPhone = normalizePhone(optionalText(body.phone), "INTERNATIONAL_ONLY");
        if (!normalizedPhone.valid) {
          throw httpError(400, normalizedPhone.message);
        }
        const lead = services.leadsRepository.createLead({
          organization_id: body.organization_id,
          name: body.name.trim(),
          email: optionalText(body.email),
          phone: optionalText(body.phone),
          normalized_email: normalizedEmail.value,
          normalized_phone: normalizedPhone.normalized_phone,
          company: optionalText(body.company),
          source
        });
        services.eventsRepository.publish({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          type: "LeadCreated",
          payload: { lead_id: lead.id, source: lead.source }
        });
        services.auditRepository.record({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          event_type: "LeadCreated",
          message: "Lead persisted and LeadCreated event published.",
          metadata: { source: lead.source }
        });
        sendJson(response, 201, { lead });
        return;
      }

      if (route === "GET /api/leads") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, {
          leads: services.leadsRepository.listLeads(organizationId, {
            search: optionalText(url.searchParams.get("search")),
            source: optionalText(url.searchParams.get("source")),
            status: optionalText(url.searchParams.get("status"))
          })
        });
        return;
      }

      if (route === "POST /api/imports/csv/preview") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const organization = services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        const preview = services.importsService.previewCsv({
          organization_id: body.organization_id,
          filename: body.filename,
          csv_text: body.csv_text,
          default_phone_region: body.default_phone_region
        });
        sendJson(response, 201, preview);
        return;
      }

      if (route === "GET /api/imports") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, services.importsService.listImports(organizationId));
        return;
      }

      if (route === "GET /api/approvals") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(APPROVAL_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, services.approvalsService.listForOrganization({ organization_id: organizationId, status }));
        return;
      }

      if (route === "GET /api/channels") {
        sendJson(response, 200, services.channelWorkflowService.availableChannels());
        return;
      }

      if (route === "POST /api/inbound-events/mock") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        requireText(body.lead_id, "lead_id");
        requireText(body.channel, "channel");
        requireText(body.provider_event_id, "provider_event_id");
        requireText(body.event_type, "event_type");
        sendJson(
          response,
          202,
          services.channelWorkflowService.receiveMockInboundEvent({
            organization_id: body.organization_id,
            lead_id: body.lead_id,
            channel: body.channel,
            provider_event_id: body.provider_event_id,
            event_type: body.event_type,
            payload: body.payload || {}
          })
        );
        return;
      }

      if (route === "GET /api/follow-ups") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(FOLLOW_UP_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, services.channelWorkflowService.listFollowUps({ organization_id: organizationId, status }));
        return;
      }

      if (route === "POST /api/campaigns") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const organization = services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        sendJson(
          response,
          201,
          services.workflowsService.createCampaign({
            organization_id: body.organization_id,
            name: body.name,
            objective: optionalText(body.objective)
          })
        );
        return;
      }

      if (route === "GET /api/campaigns") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, services.workflowsService.listCampaigns({ organization_id: organizationId }));
        return;
      }

      if (route === "POST /api/sequences") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        requireText(body.campaign_id, "campaign_id");
        sendJson(
          response,
          201,
          services.workflowsService.createSequence({
            organization_id: body.organization_id,
            campaign_id: body.campaign_id,
            name: body.name,
            stop_on_reply: body.stop_on_reply !== false,
            steps: body.steps
          })
        );
        return;
      }

      if (route === "GET /api/sequences") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, services.workflowsService.listSequences({ organization_id: organizationId }));
        return;
      }

      if (route === "GET /api/workflow-runs") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(WORKFLOW_RUN_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, services.workflowsService.listRuns({ organization_id: organizationId, status }));
        return;
      }

      if (route === "POST /api/workflows/run-due") {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          200,
          services.workflowsService.runDue({
            organization_id: body.organization_id,
            due_at: optionalText(body.due_at) || undefined,
            limit: optionalNumber(body.limit) || 25
          })
        );
        return;
      }

      const leadIntelligenceMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence$/);
      if (request.method === "GET" && leadIntelligenceMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = hydrateLeadProvenance(
          services,
          getLeadForOrganizationOrThrow(services, leadIntelligenceMatch[1], organizationId)
        );
        const intelligenceContext = services.intelligenceService.assessLead(lead);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...intelligenceContext,
          intelligence: intelligenceContext.snapshot
        });
        return;
      }

      const leadIntelligenceRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence\/run$/);
      if (request.method === "POST" && leadIntelligenceRunMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = hydrateLeadProvenance(
          services,
          getLeadForOrganizationOrThrow(services, leadIntelligenceRunMatch[1], body.organization_id)
        );
        const intelligence = services.intelligenceService.runForLead(lead);
        const intelligenceContext = services.intelligenceService.assessLead(lead);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: body.organization_id,
          ...intelligenceContext,
          intelligence
        });
        return;
      }

      const leadIntelligenceHistoryMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence\/history$/);
      if (request.method === "GET" && leadIntelligenceHistoryMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadIntelligenceHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          snapshots: services.intelligenceService.historyForLead(lead)
        });
        return;
      }

      const leadResearchEvidenceMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/research-evidence$/);
      if (request.method === "GET" && leadResearchEvidenceMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadResearchEvidenceMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...services.researchEvidenceService.listForLead(lead)
        });
        return;
      }

      if (request.method === "POST" && leadResearchEvidenceMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadResearchEvidenceMatch[1], body.organization_id);
        try {
          const ingestion = services.researchEvidenceService.ingestForLead({
            lead,
            provider_key: body.provider_key,
            idempotency_key: body.idempotency_key,
            evidence_items: body.evidence_items,
            simulate_failure_stage: optionalText(body.simulate_failure_stage)
          });
          sendJson(response, 201, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            ingestion
          });
        } catch (error) {
          throw httpError(400, error.message || String(error));
        }
        return;
      }

      const leadSynthesisMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/synthesis$/);
      if (request.method === "GET" && leadSynthesisMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = hydrateLeadProvenance(services, getLeadForOrganizationOrThrow(services, leadSynthesisMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...services.synthesisService.currentForLead(lead)
        });
        return;
      }

      const leadSynthesisRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/synthesis\/run$/);
      if (request.method === "POST" && leadSynthesisRunMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = hydrateLeadProvenance(
          services,
          getLeadForOrganizationOrThrow(services, leadSynthesisRunMatch[1], body.organization_id)
        );
        try {
          const synthesis = services.synthesisService.runForLead(lead, {
            simulate_failure_stage: optionalText(body.simulate_failure_stage)
          });
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            synthesis
          });
        } catch (error) {
          throw httpError(400, error.message || String(error));
        }
        return;
      }

      const leadSynthesisHistoryMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/synthesis\/history$/);
      if (request.method === "GET" && leadSynthesisHistoryMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadSynthesisHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          syntheses: services.synthesisService.historyForLead(lead)
        });
        return;
      }

      const leadRecommendationMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence-recommendation$/);
      if (request.method === "GET" && leadRecommendationMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = hydrateLeadProvenance(services, getLeadForOrganizationOrThrow(services, leadRecommendationMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...services.intelligenceRecommendationService.currentForLead(lead)
        });
        return;
      }

      const leadRecommendationRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence-recommendation\/run$/);
      if (request.method === "POST" && leadRecommendationRunMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = hydrateLeadProvenance(
          services,
          getLeadForOrganizationOrThrow(services, leadRecommendationRunMatch[1], body.organization_id)
        );
        try {
          const intelligenceRecommendation = services.intelligenceRecommendationService.runForLead(lead, {
            simulate_failure_stage: optionalText(body.simulate_failure_stage)
          });
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            intelligence_recommendation: intelligenceRecommendation
          });
        } catch (error) {
          throw httpError(400, error.message || String(error));
        }
        return;
      }

      const leadRecommendationHistoryMatch = url.pathname.match(
        /^\/api\/leads\/([^/]+)\/intelligence-recommendation\/history$/
      );
      if (request.method === "GET" && leadRecommendationHistoryMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadRecommendationHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          intelligence_recommendations: services.intelligenceRecommendationService.historyForLead(lead)
        });
        return;
      }

      const nextBestActionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/next-best-action$/);
      if (request.method === "GET" && nextBestActionMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = hydrateLeadProvenance(services, getLeadForOrganizationOrThrow(services, nextBestActionMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...services.nextBestActionService.currentForLead(lead)
        });
        return;
      }

      const nextBestActionPlanMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/next-best-action\/plan$/);
      if (request.method === "POST" && nextBestActionPlanMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = hydrateLeadProvenance(
          services,
          getLeadForOrganizationOrThrow(services, nextBestActionPlanMatch[1], body.organization_id)
        );
        try {
          const nextBestActionPlan = services.nextBestActionService.planForLead(lead, {
            simulate_failure_stage: optionalText(body.simulate_failure_stage)
          });
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            next_best_action_plan: nextBestActionPlan
          });
        } catch (error) {
          throw httpError(400, error.message || String(error));
        }
        return;
      }

      const nextBestActionHistoryMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/next-best-action\/history$/);
      if (request.method === "GET" && nextBestActionHistoryMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, nextBestActionHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          next_best_action_plans: services.nextBestActionService.historyForLead(lead)
        });
        return;
      }

      const leadOutboundMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/outbound$/);
      if (request.method === "GET" && leadOutboundMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadOutboundMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          actions: services.outboundAutomationService.listForLead({
            organization_id: organizationId,
            lead_id: lead.id
          })
        });
        return;
      }

      const leadTimelineMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/timeline$/);
      if (request.method === "GET" && leadTimelineMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(
          response,
          200,
          services.channelWorkflowService.listLeadTimeline({
            organization_id: organizationId,
            lead_id: leadTimelineMatch[1]
          })
        );
        return;
      }

      const sequenceEnrollMatch = url.pathname.match(/^\/api\/sequences\/([^/]+)\/enroll$/);
      if (request.method === "POST" && sequenceEnrollMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          201,
          services.workflowsService.enrollLeads({
            organization_id: body.organization_id,
            sequence_id: sequenceEnrollMatch[1],
            lead_ids: body.lead_ids
          })
        );
        return;
      }

      const leadMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
      if (request.method === "GET" && leadMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadMatch[1], organizationId);
        sendJson(response, 200, { lead: hydrateLead(services, lead) });
        return;
      }

      const importMatch = url.pathname.match(/^\/api\/imports\/([^/]+)$/);
      if (request.method === "GET" && importMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, services.importsService.getImport(importMatch[1], organizationId));
        return;
      }

      const importCommitMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
      if (request.method === "POST" && importCommitMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const result = services.importsService.commitImport({
          import_id: importCommitMatch[1],
          organization_id: body.organization_id,
          selected_row_ids: body.selected_row_ids,
          simulate_failure_after_rows: optionalNumber(body.simulate_failure_after_rows)
        });
        sendJson(response, 200, result);
        return;
      }

      const planActionMatch = url.pathname.match(/^\/api\/next-best-action-plans\/([^/]+)\/action$/);
      if (request.method === "POST" && planActionMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const action = services.outboundAutomationService.createActionFromPlan({
          organization_id: body.organization_id,
          plan_id: planActionMatch[1]
        });
        sendJson(response, 201, { action });
        return;
      }

      const executeActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/execute$/);
      if (request.method === "POST" && executeActionMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const result = services.outboundAutomationService.executeAction({
          organization_id: body.organization_id,
          action_id: executeActionMatch[1]
        });
        sendJson(response, 202, result);
        return;
      }

      const actionApprovalMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval$/);
      if (request.method === "GET" && actionApprovalMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(
          response,
          200,
          services.approvalsService.currentForAction({
            organization_id: organizationId,
            action_id: actionApprovalMatch[1]
          })
        );
        return;
      }

      const actionApprovalApproveMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval\/approve$/);
      if (request.method === "POST" && actionApprovalApproveMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const result = services.approvalsService.approveAction({
          organization_id: body.organization_id,
          action_id: actionApprovalApproveMatch[1],
          reviewer_name: body.reviewer_name ?? null,
          reviewer_note: body.reviewer_note ?? null,
          edited_payload: body.edited_payload || null
        });
        sendJson(response, 200, result);
        return;
      }

      const actionApprovalEditApproveMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval\/edit-and-approve$/);
      if (request.method === "POST" && actionApprovalEditApproveMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const result = services.approvalsService.approveAction({
          organization_id: body.organization_id,
          action_id: actionApprovalEditApproveMatch[1],
          reviewer_name: body.reviewer_name ?? null,
          reviewer_note: body.reviewer_note ?? null,
          edited_payload: body.edited_payload || {}
        });
        sendJson(response, 200, result);
        return;
      }

      const actionApprovalRejectMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval\/reject$/);
      if (request.method === "POST" && actionApprovalRejectMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const result = services.approvalsService.rejectAction({
          organization_id: body.organization_id,
          action_id: actionApprovalRejectMatch[1],
          reviewer_name: body.reviewer_name ?? null,
          reviewer_note: body.reviewer_note ?? null
        });
        sendJson(response, 200, result);
        return;
      }

      const actionCallbackMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/callback$/);
      if (request.method === "POST" && actionCallbackMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        requireText(body.provider_event_id, "provider_event_id");
        const action = services.actionsRepository.getActionForOrganization(actionCallbackMatch[1], body.organization_id);
        if (!action) {
          throw httpError(404, "Action not found.");
        }
        const result = services.callbacksService.receiveExecutionCallback({
          action_id: action.id,
          provider_event_id: body.provider_event_id,
          status: optionalText(body.status) || "COMPLETED",
          provider_reference: optionalText(body.provider_reference),
          details: body.details || {}
        });
        sendJson(response, result.duplicate ? 200 : 202, result);
        return;
      }

      const followUpCompleteMatch = url.pathname.match(/^\/api\/follow-ups\/([^/]+)\/complete$/);
      if (request.method === "POST" && followUpCompleteMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          200,
          services.channelWorkflowService.completeFollowUp({
            organization_id: body.organization_id,
            follow_up_id: followUpCompleteMatch[1]
          })
        );
        return;
      }

      const leadActionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/actions$/);
      if (request.method === "POST" && leadActionMatch) {
        const body = await readJson(request);
        requireText(body.organization_id, "organization_id");
        const lead = getLeadForOrganizationOrThrow(services, leadActionMatch[1], body.organization_id);
        const type = optionalText(body.type) || "SEND_EMAIL";
        const mockBehavior = optionalText(body.mock_behavior) || "SUCCESS";
        requireNoValidationErrors(validateActionInput({ type, mock_behavior: mockBehavior }));
        const action = services.actionsService.createManualAction(lead, {
          type,
          mock_behavior: mockBehavior
        });
        sendJson(response, 201, { action: services.outboundAutomationService.actionDetail(action) });
        return;
      }

      if (route === "POST /api/worker/run") {
        sendJson(response, 200, services.worker.runOnce());
        return;
      }

      if (route === "POST /api/callbacks/mock") {
        const body = await readJson(request);
        requireText(body.action_id, "action_id");
        requireText(body.provider_event_id, "provider_event_id");
        const result = services.callbacksService.receiveExecutionCallback({
          action_id: body.action_id,
          provider_event_id: body.provider_event_id,
          status: optionalText(body.status) || "COMPLETED",
          provider_reference: optionalText(body.provider_reference),
          details: body.details || {}
        });
        sendJson(response, result.duplicate ? 200 : 202, result);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        throw httpError(404, "API route not found.");
      }

      await serveStatic(request, response, publicDir);
    } catch (error) {
      sendError(response, error);
    }
  });
}

function getLeadForOrganizationOrThrow(services, leadId, organizationId) {
  const lead = services.leadsRepository.getLead(leadId);
  if (!lead) {
    throw httpError(404, "Lead not found.");
  }
  if (lead.organization_id !== organizationId) {
    throw httpError(404, "Lead not found for organization.");
  }
  return lead;
}

function hydrateLead(services, lead) {
  const actions = services.outboundAutomationService.listForLead({
    organization_id: lead.organization_id,
    lead_id: lead.id
  });
  const hydratedLead = hydrateLeadProvenance(services, lead);
  const intelligenceContext = services.intelligenceService.assessLead(hydratedLead);
  const intelligence = intelligenceContext.snapshot?.status === "READY" ? intelligenceContext.snapshot : null;
  return {
    ...hydratedLead,
    intelligence,
    intelligence_context: {
      lead_status: intelligenceContext.lead_status,
      intelligence_status: intelligenceContext.intelligence_status,
      readiness: intelligenceContext.readiness,
      recommendation: intelligenceContext.recommendation
    },
    actions
  };
}

function hydrateLeadProvenance(services, lead) {
  const sourceMetadata = parseJson(lead.source_metadata_json) || {};
  const importRow = lead.import_row_id ? services.importsRepository.getRowById(lead.import_row_id, lead.organization_id) : null;
  return {
    ...lead,
    source_metadata: {
      ...sourceMetadata,
      duplicate_candidates: importRow ? parseJson(importRow.duplicate_candidates_json) || [] : []
    }
  };
}

function requireText(value, fieldName) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${fieldName} is required.`);
  }
}

function optionalText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireNoValidationErrors(errors) {
  if (errors.length > 0) {
    throw httpError(400, errors.join(" "));
  }
}
