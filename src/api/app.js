import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sendError, sendJson, serveStatic } from "../shared/http.js";
import { createNullLogger } from "../shared/logger.js";
import { getMigrationStatus } from "../database/database.js";
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
import { isLlmConfigured, getLlmProvider } from "../modules/ai/llmProvider.js";
import { LlmSynthesisAgent } from "../modules/ai/llmSynthesisAgent.js";
import { LlmRecommendationAgent } from "../modules/ai/llmRecommendationAgent.js";
import { LlmActionPlanner } from "../modules/ai/llmActionPlanner.js";
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
import { LocalReplyClassifier } from "../modules/channels/replyClassifier.js";
import { LlmReplyClassifier } from "../modules/ai/llmReplyClassifier.js";
import { FOLLOW_UP_STATUS } from "../modules/channels/channelContract.js";
import { WorkflowsRepository } from "../modules/workflows/workflowsRepository.js";
import { WorkflowsService } from "../modules/workflows/workflowsService.js";
import { WORKFLOW_RUN_STATUS } from "../modules/workflows/workflowContract.js";
import { MockN8nAdapter } from "../modules/handlers/mockN8nAdapter.js";
import { ChannelRouter } from "../modules/handlers/channelRouter.js";
import { EmailAdapter } from "../modules/handlers/emailAdapter.js";
import { SmsAdapter } from "../modules/handlers/smsAdapter.js";
import { WhatsAppAdapter } from "../modules/handlers/whatsappAdapter.js";
import { VoiceAdapter } from "../modules/handlers/voiceAdapter.js";
import { ActionExecutor } from "../modules/handlers/actionExecutor.js";
import { SettingsRepository } from "../modules/settings/settingsRepository.js";
import { maskSecrets, stripUnchangedSecrets } from "../modules/settings/secretSettings.js";
import { Worker } from "../modules/events/worker.js";
import { parseJson } from "../database/database.js";
import { createId } from "../shared/ids.js";
import { readRawBody, parseMultipartFormData } from "../shared/multipart.js";
import { getSessionCookie, setSessionCookie, clearSessionCookie } from "../shared/cookies.js";
import { AuthRepository } from "../modules/auth/authRepository.js";
import { AuthService } from "../modules/auth/authService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "..", "client", "dist");

export function createServices(db, logger = createNullLogger()) {
  const leadsRepository = new LeadsRepository(db);
  const importsRepository = new ImportsRepository(db);
  const eventsRepository = new EventsRepository(db);
  const auditRepository = new AuditRepository(db);
  const authRepository = new AuthRepository(db);
  const authService = new AuthService({ authRepository, leadsRepository, auditRepository });
  const importsService = new ImportsService({ importsRepository, leadsRepository, eventsRepository, auditRepository });
  const intelligenceRepository = new IntelligenceRepository(db);
  const intelligenceService = new IntelligenceService({ intelligenceRepository, auditRepository });
  const researchEvidenceRepository = new ResearchEvidenceRepository(db);
  const researchEvidenceService = new ResearchEvidenceService({ researchEvidenceRepository, auditRepository });
  const llmProvider = isLlmConfigured() ? getLlmProvider() : null;
  if (llmProvider) {
    logger.info("ai.provider_configured", { provider: llmProvider.info.provider, model: llmProvider.info.model });
  } else {
    logger.info("ai.provider_missing", {
      detail: "Using deterministic local agents. Set LLM_PROVIDER and an API key to enable AI."
    });
  }
  const synthesisRepository = new SynthesisRepository(db);
  const synthesisService = new SynthesisService({
    synthesisRepository,
    intelligenceService,
    researchEvidenceRepository,
    auditRepository,
    ...(llmProvider ? { synthesisAgent: new LlmSynthesisAgent(llmProvider) } : {})
  });
  const intelligenceRecommendationRepository = new IntelligenceRecommendationRepository(db);
  const intelligenceRecommendationService = new IntelligenceRecommendationService({
    recommendationRepository: intelligenceRecommendationRepository,
    synthesisService,
    intelligenceRepository,
    auditRepository,
    ...(llmProvider ? { recommendationAgent: new LlmRecommendationAgent(llmProvider) } : {})
  });
  const nextBestActionRepository = new NextBestActionRepository(db);
  const nextBestActionService = new NextBestActionService({
    nextBestActionRepository,
    intelligenceRecommendationService,
    auditRepository,
    ...(llmProvider ? { actionPlanner: new LlmActionPlanner(llmProvider) } : {})
  });
  const settingsRepository = new SettingsRepository(db);
  const actionsRepository = new ActionsRepository(db);
  const executionsRepository = new ExecutionsRepository(db);
  const actionsService = new ActionsService({ actionsRepository, intelligenceRepository, auditRepository });
  const approvalsRepository = new ApprovalsRepository(db);
  const approvalsService = new ApprovalsService({ approvalsRepository, actionsRepository, auditRepository });
  const emailAdapter = new EmailAdapter({ settingsRepository });
  const smsAdapter = new SmsAdapter({ settingsRepository });
  const whatsappAdapter = new WhatsAppAdapter({ settingsRepository });
  const voiceAdapter = new VoiceAdapter({ settingsRepository });
  const channelRouter = new ChannelRouter({
    emailAdapter,
    smsAdapter,
    whatsappAdapter,
    voiceAdapter,
    settingsRepository,
    leadsRepository
  });
  const adapter = channelRouter;
  const channelMessagesRepository = new ChannelMessagesRepository(db);
  const inboundEventsRepository = new InboundEventsRepository(db);
  const followUpsRepository = new FollowUpsRepository(db);
  // Reply history lives in a module the intelligence service predates in this wiring order —
  // attach it now so runForLead can fold the lead's latest classified reply into its signals.
  intelligenceService.inboundEventsRepository = inboundEventsRepository;
  const workflowsRepository = new WorkflowsRepository(db);
  const channelWorkflowService = new ChannelWorkflowService({
    leadsRepository,
    actionsRepository,
    channelMessagesRepository,
    inboundEventsRepository,
    followUpsRepository,
    auditRepository,
    replyClassifier: llmProvider ? new LlmReplyClassifier(llmProvider) : new LocalReplyClassifier(),
    eventsRepository,
    intelligenceService
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
    auditRepository,
    executionsRepository,
    callbacksService,
    // Needed to bring a lead's synthesis, recommendation and plan back in line
    // after an inbound reply changes what we know about them.
    synthesisService,
    intelligenceRecommendationService,
    nextBestActionService
  });

  return {
    leadsRepository,
    importsRepository,
    importsService,
    authRepository,
    authService,
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
    // Exposed so tests (and any future operational tooling) can drive a single
    // action through the real channel routing without going via HTTP.
    actionExecutor,
    channelRouter,
    emailAdapter,
    workflowsRepository,
    workflowsService,
    callbacksRepository,
    callbacksService,
    outboundAutomationService,
    settingsRepository,
    worker
  };
}

export function createApp({ db, logger = createNullLogger(), config = null } = {}) {
  const services = createServices(db, logger);
  const trustProxy = config ? config.security.trustProxy : true;
  const forceSecureCookies = config ? config.security.forceSecureCookies : false;

  const server = createServer(async (request, response) => {
    // One id per request, echoed on error responses and stamped on every log
    // line for the request, so a user-reported failure can be found in the logs.
    const requestId = randomUUID();
    const startedAt = Date.now();
    const requestLogger = logger.child({ request_id: requestId });
    response.setHeader("x-request-id", requestId);

    try {
      const url = new URL(request.url, "http://localhost");
      const route = `${request.method} ${url.pathname}`;

      // Every /api/ route requires a valid session except the handful that exist to create one
      // (register, login) or that authenticate a different way entirely (webhooks, which use a
      // per-organization opaque token in the URL since SendGrid can't hold a browser session).
      // Once authenticated, the session's organization_id silently overwrites whatever
      // organization_id the request itself claims — the client is never trusted for tenant
      // identity, only for which of ITS OWN resources it wants.
      const isWebhookRoute = url.pathname.startsWith("/api/webhooks/");
      const PUBLIC_API_ROUTES = new Set([
        "GET /api/health",
        "GET /api/health/live",
        "GET /api/health/ready",
        "POST /api/auth/register",
        "POST /api/auth/login"
      ]);
      const requiresAuth = url.pathname.startsWith("/api/") && !isWebhookRoute && !PUBLIC_API_ROUTES.has(route);
      let authContext = null;
      if (requiresAuth) {
        authContext = await services.authService.requireSession(getSessionCookie(request));
        url.searchParams.set("organization_id", authContext.organization_id);
      }

      // Liveness: the process is up and serving. Deliberately does not touch the
      // database, so a database blip never makes the platform restart a process
      // that is otherwise healthy.
      //
      // /api/health is the original path and stays for compatibility;
      // /api/health/live is the name that pairs readably with /api/health/ready.
      if (route === "GET /api/health" || route === "GET /api/health/live") {
        sendJson(response, 200, {
          product: "AI Lead Intelligence & Outbound Automation",
          status: "ok",
          check: "live"
        });
        return;
      }

      if (route === "GET /api/health/ready") {
        // Readiness: can this instance actually serve traffic? Checks that the
        // database answers and that no migration is still pending, so a deploy
        // that half-applied its schema is reported as not-ready rather than
        // silently serving errors.
        try {
          const migrations = await getMigrationStatus(db);
          const ready = migrations.pending.length === 0;
          sendJson(response, ready ? 200 : 503, {
            status: ready ? "ready" : "pending_migrations",
            database: { driver: db.kind, reachable: true },
            migrations: {
              applied: migrations.applied.length,
              pending: migrations.pending,
              total: migrations.total
            }
          });
        } catch (error) {
          requestLogger.error("health.readiness_failed", { error });
          sendJson(response, 503, {
            status: "database_unreachable",
            database: { driver: db.kind, reachable: false }
          });
        }
        return;
      }

      if (route === "POST /api/auth/register") {
        const body = await readAuthorizedJson(request, authContext);
        const result = await services.authService.register({
          organization_name: body.organization_name,
          name: body.name,
          email: body.email,
          password: body.password
        });
        setSessionCookie(response, result.session.id, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 201, { user: result.user, organization: result.organization });
        return;
      }

      if (route === "POST /api/auth/login") {
        const body = await readAuthorizedJson(request, authContext);
        const result = await services.authService.login({ email: body.email, password: body.password });
        setSessionCookie(response, result.session.id, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 200, { user: result.user, organization: result.organization });
        return;
      }

      if (route === "POST /api/auth/logout") {
        await services.authService.logout(authContext.session.id);
        clearSessionCookie(response, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (route === "GET /api/auth/me") {
        const organization = await services.leadsRepository.getOrganization(authContext.organization_id);
        sendJson(response, 200, { user: authContext.user, organization });
        return;
      }

      if (route === "GET /api/ai/status") {
        const configured = isLlmConfigured();
        const provider = configured ? getLlmProvider() : null;
        sendJson(response, 200, {
          configured,
          provider: provider?.info.provider || null,
          model: provider?.info.model || null,
          supported_providers: ["groq", "openai", "openrouter", "ollama"],
          setup_hint: configured ? null : "Set LLM_PROVIDER=groq and GROQ_API_KEY=your-key to enable AI. Groq offers free API access at console.groq.com.",
        });
        return;
      }

      if (route === "GET /api/settings") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        // Credentials are masked on the way out — see modules/settings/secretSettings.js.
        const settings = maskSecrets(await services.settingsRepository.getAll(organizationId));
        const aiConfigured = isLlmConfigured();
        const aiProvider = aiConfigured ? getLlmProvider() : null;
        const aiStatus = {
          configured: aiConfigured,
          provider: aiProvider?.info.provider || null,
          model: aiProvider?.info.model || null,
        };
        sendJson(response, 200, { settings, ai_status: aiStatus });
        return;
      }

      if (route === "PUT /api/settings") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        requireText(body.category, "category");
        const ALLOWED_CATEGORIES = new Set(["general", "channel_email", "channel_whatsapp", "channel_sms", "channel_telegram", "channel_call", "ai"]);
        if (!ALLOWED_CATEGORIES.has(body.category)) {
          throw httpError(400, `category must be one of: ${[...ALLOWED_CATEGORIES].join(", ")}`);
        }
        if (!body.values || typeof body.values !== "object") {
          throw httpError(400, "values must be an object");
        }
        // A secret submitted as the mask means "unchanged", so saving the form
        // without retyping the key does not overwrite it with the mask.
        await services.settingsRepository.setBulk(
          body.organization_id,
          body.category,
          stripUnchangedSecrets(body.values)
        );
        sendJson(response, 200, {
          category: body.category,
          settings: maskSecrets({
            [body.category]: await services.settingsRepository.getCategory(body.organization_id, body.category),
          })[body.category],
        });
        return;
      }

      if (route === "GET /api/settings/channels/email/webhooks") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        let token = await services.settingsRepository.get(organizationId, "channel_email", "webhook_token");
        if (!token) {
          token = createId("whk");
          await services.settingsRepository.set(organizationId, "channel_email", "webhook_token", token);
        }
        sendJson(response, 200, {
          inbound_path: `/api/webhooks/sendgrid/inbound/${token}`,
          events_path: `/api/webhooks/sendgrid/events/${token}`,
        });
        return;
      }

      if (route === "GET /api/settings/channels/test") {
        const organizationId = url.searchParams.get("organization_id");
        const channel = url.searchParams.get("channel");
        requireText(organizationId, "organization_id");
        requireText(channel, "channel");
        const config = await services.settingsRepository.getCategory(organizationId, `channel_${channel}`);
        const provider = config.provider || "sandbox";
        const configured = provider !== "sandbox" && !!config.api_key;
        sendJson(response, 200, {
          channel,
          provider,
          configured,
          status: configured ? "ready" : "sandbox",
        });
        return;
      }

      if (route === "GET /api/intelligence/summary") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");

        const leads = await db.all(`
          SELECT id, name, email, phone, company, source, status, created_at
          FROM leads WHERE organization_id = ?
          ORDER BY created_at DESC
        `, [organizationId]);

        const snapshots = await db.all(`
          SELECT lead_id, status, created_at
          FROM intelligence_snapshots WHERE organization_id = ?
          ORDER BY created_at DESC
        `, [organizationId]);

        const snapshotByLead = {};
        for (const s of snapshots) {
          if (!snapshotByLead[s.lead_id]) snapshotByLead[s.lead_id] = s;
        }

        const recommendations = await db.all(`
          SELECT lead_id, status, created_at
          FROM intelligence_recommendation_runs WHERE organization_id = ?
          ORDER BY created_at DESC
        `, [organizationId]);

        const recByLead = {};
        for (const r of recommendations) {
          if (!recByLead[r.lead_id]) recByLead[r.lead_id] = r;
        }

        const nbaPlans = await db.all(`
          SELECT lead_id, status, action_type, title, created_at
          FROM next_best_action_plans WHERE organization_id = ?
          ORDER BY created_at DESC
        `, [organizationId]);

        const nbaByLead = {};
        for (const n of nbaPlans) {
          if (!nbaByLead[n.lead_id]) nbaByLead[n.lead_id] = n;
        }

        const mapStatus = (s) => ({ READY: "COMPLETED", DRAFT: "PENDING", FAILED: "FAILED", SUPERSEDED: "COMPLETED" }[s] || s);

        const rows = leads.map(lead => {
          const snap = snapshotByLead[lead.id];
          const rec = recByLead[lead.id];
          const nba = nbaByLead[lead.id];
          return {
            lead_id: lead.id,
            name: lead.name,
            email: lead.email,
            company: lead.company,
            source: lead.source,
            lead_status: lead.status,
            intelligence_status: snap ? mapStatus(snap.status) : "NOT_RUN",
            intelligence_at: snap ? snap.created_at : null,
            recommendation_status: rec ? mapStatus(rec.status) : "NOT_RUN",
            nba_status: nba ? mapStatus(nba.status) : null,
            nba_action_type: nba ? nba.action_type : null,
            nba_title: nba ? nba.title : null,
          };
        });

        // Which leads the bulk action would actually process. This MUST come from
        // the same helper POST /api/intelligence/bulk-run uses, or the button and
        // the server disagree: `not_run` below counts leads with no intelligence
        // SNAPSHOT, and every lead gets one at creation, so it is always 0 and
        // previously left the bulk action permanently disabled.
        const eligibleLeadIds = await collectEligibleLeadIds(services, organizationId);

        const totals = {
          total: rows.length,
          not_run: rows.filter(r => r.intelligence_status === "NOT_RUN").length,
          pending: rows.filter(r => r.intelligence_status === "PENDING").length,
          completed: rows.filter(r => r.intelligence_status === "COMPLETED").length,
          failed: rows.filter(r => r.intelligence_status === "FAILED").length,
          with_recommendation: rows.filter(r => r.recommendation_status === "COMPLETED").length,
          with_nba: rows.filter(r => r.nba_status !== null).length,
          eligible_for_analysis: eligibleLeadIds.length,
        };

        // Returned so the client can hand these exact ids back to bulk-run rather
        // than making the server scan for eligibility a second time.
        sendJson(response, 200, { leads: rows, totals, eligible_lead_ids: eligibleLeadIds });
        return;
      }

      if (route === "POST /api/intelligence/bulk-run") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const organizationId = body.organization_id;

        let leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.filter((id) => typeof id === "string") : null;
        if (!leadIds) {
          leadIds = await collectEligibleLeadIds(services, organizationId);
        }

        const BATCH_CAP = 50;
        const batch = leadIds.slice(0, BATCH_CAP);
        const results = [];
        for (const leadId of batch) {
          try {
            const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, leadId, organizationId));
            await services.intelligenceService.runForLead(lead);
            await services.synthesisService.runForLead(lead);
            const recommendation = await services.intelligenceRecommendationService.runForLead(lead);
            const plan = await services.nextBestActionService.planForLead(lead);
            let actionId = null;
            if (plan?.status === "PLANNED") {
              try {
                const action = await services.outboundAutomationService.createActionFromPlan({
                  organization_id: organizationId,
                  plan_id: plan.id
                });
                actionId = action.id;
              } catch {
                // plan may have flipped state between planning and action creation; skip silently
              }
            }
            results.push({
              lead_id: leadId,
              status: "COMPLETED",
              recommendation_step: recommendation?.recommendation?.step || null,
              plan_status: plan?.status || null,
              action_id: actionId
            });
          } catch (error) {
            results.push({ lead_id: leadId, status: "FAILED", error: error.message || String(error) });
          }
        }

        sendJson(response, 200, {
          organization_id: organizationId,
          eligible: leadIds.length,
          processed: batch.length,
          remaining: Math.max(0, leadIds.length - batch.length),
          succeeded: results.filter((r) => r.status === "COMPLETED").length,
          failed: results.filter((r) => r.status === "FAILED").length,
          results
        });
        return;
      }

      if (route === "GET /api/outbound/summary") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");

        const actions = await db.all(`
          SELECT a.id, a.lead_id, a.type, a.status, a.payload_json, a.approval_requirement,
                 a.created_at, a.updated_at,
                 l.name AS lead_name, l.email AS lead_email, l.company AS lead_company
          FROM actions a
          JOIN leads l ON a.lead_id = l.id
          WHERE a.organization_id = ?
          ORDER BY a.created_at DESC
        `, [organizationId]);

        const approvals = await db.all(`
          SELECT ap.id, ap.action_id, ap.status, ap.reviewer_name, ap.reviewer_note, ap.created_at, ap.decided_at
          FROM action_approvals ap
          WHERE ap.organization_id = ?
          ORDER BY ap.created_at DESC
        `, [organizationId]);

        const approvalByAction = {};
        for (const ap of approvals) {
          if (!approvalByAction[ap.action_id]) approvalByAction[ap.action_id] = ap;
        }

        const rows = actions.map(a => ({
          action_id: a.id,
          lead_id: a.lead_id,
          lead_name: a.lead_name,
          lead_email: a.lead_email,
          lead_company: a.lead_company,
          type: a.type,
          status: a.status,
          approval_requirement: a.approval_requirement,
          payload: a.payload_json ? parseJson(a.payload_json) : null,
          created_at: a.created_at,
          updated_at: a.updated_at,
          approval: approvalByAction[a.id] || null,
        }));

        const typeBreakdown = {};
        for (const r of rows) {
          typeBreakdown[r.type] = (typeBreakdown[r.type] || 0) + 1;
        }

        const statusBreakdown = {};
        for (const r of rows) {
          statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
        }

        const pendingApprovalCount = rows.filter(r => r.approval && r.approval.status === "PENDING").length;

        sendJson(response, 200, {
          actions: rows,
          totals: {
            total: rows.length,
            by_type: typeBreakdown,
            by_status: statusBreakdown,
            pending_approval: pendingApprovalCount,
          }
        });
        return;
      }

      if (route === "GET /api/activity/feed") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

        const auditLogs = await db.all(`
          SELECT a.event_type, a.message, a.metadata_json, a.created_at, a.lead_id,
                 l.name AS lead_name
          FROM audit_logs a
          LEFT JOIN leads l ON l.id = a.lead_id
          WHERE a.organization_id = ?
          ORDER BY a.created_at DESC LIMIT ?
        `, [organizationId, limit]);

        for (const log of auditLogs) {
          log.metadata = log.metadata_json ? parseJson(log.metadata_json) : null;
          delete log.metadata_json;
        }

        sendJson(response, 200, { events: auditLogs });
        return;
      }

      if (route === "GET /api/follow-ups/summary") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");

        const followUps = await db.all(`
          SELECT f.id, f.lead_id, f.action_id, f.reason, f.status, f.due_at, f.created_at, f.completed_at, f.escalated,
                 l.name AS lead_name, l.email AS lead_email, l.company AS lead_company
          FROM follow_up_tasks f
          JOIN leads l ON f.lead_id = l.id
          WHERE f.organization_id = ?
          ORDER BY
            CASE f.status
              WHEN 'OVERDUE' THEN 0
              WHEN 'DUE' THEN 1
              WHEN 'SCHEDULED' THEN 2
              WHEN 'COMPLETED' THEN 3
              WHEN 'CANCELLED' THEN 4
            END,
            f.due_at ASC
        `, [organizationId]);

        const statusBreakdown = {};
        for (const f of followUps) {
          statusBreakdown[f.status] = (statusBreakdown[f.status] || 0) + 1;
        }

        sendJson(response, 200, {
          follow_ups: followUps,
          totals: {
            total: followUps.length,
            by_status: statusBreakdown,
          }
        });
        return;
      }

      if (route === "GET /api/dashboard/metrics") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");

        // Date cutoffs are computed here rather than in SQL: `datetime('now', '-7
        // days')` is SQLite-only, and created_at is an ISO 8601 TEXT column, which
        // compares correctly as a string in every dialect.
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const leadStats = await db.get(`
          SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END), 0) AS new_count,
            COALESCE(SUM(CASE WHEN status NOT IN ('OPTED_OUT','CONVERTED') THEN 1 ELSE 0 END), 0) AS active_count,
            COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN 1 ELSE 0 END), 0) AS converted_count,
            COALESCE(SUM(CASE WHEN status = 'OPTED_OUT' THEN 1 ELSE 0 END), 0) AS opted_out_count,
            COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_last_7d,
            COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_last_30d
          FROM leads WHERE organization_id = ?
        `, [since7d, since30d, organizationId]);

        const sourceBreakdown = await db.all(`
          SELECT source, COUNT(*) AS count
          FROM leads WHERE organization_id = ?
          GROUP BY source ORDER BY count DESC
        `, [organizationId]);

        const statusBreakdown = await db.all(`
          SELECT status, COUNT(*) AS count
          FROM leads WHERE organization_id = ?
          GROUP BY status ORDER BY count DESC
        `, [organizationId]);

        const pendingApprovals = await db.get(`
          SELECT COUNT(*) AS count FROM action_approvals
          WHERE organization_id = ? AND status = 'PENDING'
        `, [organizationId]);

        const followUpsDue = await db.get(`
          SELECT COUNT(*) AS count FROM follow_up_tasks
          WHERE organization_id = ? AND status = 'DUE'
        `, [organizationId]);

        const recentLeads = await db.all(`
          SELECT id, name, email, phone, company, source, status, created_at
          FROM leads WHERE organization_id = ?
          ORDER BY created_at DESC LIMIT 10
        `, [organizationId]);

        const dailyLeads = await db.all(`
          SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
          FROM leads WHERE organization_id = ?
            AND created_at >= ?
          GROUP BY substr(created_at, 1, 10)
          ORDER BY day ASC
        `, [organizationId, since30d]);

        const intelligenceStats = await db.get(`
          SELECT
            COUNT(*) AS total_snapshots,
            COALESCE(SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END), 0) AS completed,
            COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END), 0) AS pending
          FROM intelligence_snapshots WHERE organization_id = ?
        `, [organizationId]);

        sendJson(response, 200, {
          leads: leadStats,
          sources: sourceBreakdown,
          statuses: statusBreakdown,
          pending_approvals: pendingApprovals.count,
          follow_ups_due: followUpsDue.count,
          recent_leads: recentLeads,
          daily_leads: dailyLeads,
          intelligence: intelligenceStats
        });
        return;
      }

      if (route === "GET /api/dashboard/attention") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");

        const rows = await db.all(`
          SELECT
            l.id, l.name, l.email, l.phone, l.company, l.source, l.status,
            l.created_at,
            (
              SELECT COUNT(*) FROM actions a
              JOIN action_approvals ap ON ap.action_id = a.id
              WHERE a.lead_id = l.id AND ap.status = 'PENDING'
            ) AS pending_approvals,
            (
              SELECT COUNT(*) FROM actions a
              WHERE a.lead_id = l.id AND a.status IN ('FAILED', 'BLOCKED')
            ) AS failed_actions,
            (
              SELECT s.status FROM intelligence_snapshots s
              WHERE s.lead_id = l.id ORDER BY s.created_at DESC LIMIT 1
            ) AS latest_snapshot_status,
            (
              SELECT r.status FROM intelligence_recommendation_runs r
              WHERE r.lead_id = l.id ORDER BY r.created_at DESC LIMIT 1
            ) AS latest_recommendation_status,
            (
              SELECT COUNT(*) FROM actions a WHERE a.lead_id = l.id
            ) AS action_count,
            (
              SELECT COUNT(*) FROM follow_up_tasks f
              WHERE f.lead_id = l.id AND f.status = 'DUE'
            ) AS follow_ups_due,
            (
              SELECT COUNT(*) FROM follow_up_tasks f
              WHERE f.lead_id = l.id AND f.status = 'DUE' AND f.escalated = 1
            ) AS escalated_follow_ups
          FROM leads l
          WHERE l.organization_id = ? AND l.status NOT IN ('OPTED_OUT', 'CONVERTED')
        `, [organizationId]);

        const items = [];
        for (const row of rows) {
          let reason = null;
          let priority = "LOW";
          if (row.escalated_follow_ups > 0) {
            reason = "Reply needs human review";
            priority = "HIGH";
          } else if (row.pending_approvals > 0) {
            reason = "Recommendation ready for review";
            priority = "HIGH";
          } else if (row.failed_actions > 0) {
            reason = "Outbound action failed";
            priority = "HIGH";
          } else if (row.follow_ups_due > 0) {
            reason = "Follow-up due";
            priority = "MEDIUM";
          } else if (row.latest_recommendation_status === "READY" && row.action_count === 0) {
            reason = "Recommendation ready, no action taken yet";
            priority = "MEDIUM";
          } else if (row.latest_snapshot_status === "FAILED") {
            reason = "Analysis failed";
            priority = "MEDIUM";
          } else if (!row.latest_recommendation_status) {
            reason = "Needs analysis";
            priority = "MEDIUM";
          }
          if (reason) {
            items.push({
              lead_id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              company: row.company,
              source: row.source,
              status: row.status,
              reason,
              priority
            });
          }
        }

        const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

        sendJson(response, 200, { items: items.slice(0, 50), total: items.length });
        return;
      }

      if (route === "GET /api/organizations") {
        // One workspace per account: this is always exactly the caller's own organization, not
        // a browsable directory of every workspace in the system.
        const organization = await services.leadsRepository.getOrganization(authContext.organization_id);
        sendJson(response, 200, { organizations: organization ? [organization] : [] });
        return;
      }

      if (route === "POST /api/leads") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const organization = await services.leadsRepository.getOrganization(body.organization_id);
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
        const lead = await services.leadsRepository.createLead({
          organization_id: body.organization_id,
          name: body.name.trim(),
          email: optionalText(body.email),
          phone: optionalText(body.phone),
          normalized_email: normalizedEmail.value,
          normalized_phone: normalizedPhone.normalized_phone,
          company: optionalText(body.company),
          source
        });
        await services.eventsRepository.publish({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          type: "LeadCreated",
          payload: { lead_id: lead.id, source: lead.source }
        });
        await services.auditRepository.record({
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
          leads: await services.leadsRepository.listLeads(organizationId, {
            search: optionalText(url.searchParams.get("search")),
            source: optionalText(url.searchParams.get("source")),
            status: optionalText(url.searchParams.get("status"))
          })
        });
        return;
      }

      if (route === "POST /api/imports/csv/preview") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const organization = await services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        const preview = await services.importsService.previewCsv({
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
        sendJson(response, 200, await services.importsService.listImports(organizationId));
        return;
      }

      if (route === "GET /api/approvals") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(APPROVAL_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, await services.approvalsService.listForOrganization({ organization_id: organizationId, status }));
        return;
      }

      if (route === "GET /api/channels") {
        sendJson(response, 200, services.channelWorkflowService.availableChannels());
        return;
      }

      if (route === "GET /api/channels/messages") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
        let messages = await services.channelMessagesRepository.listForOrganization(organizationId, { limit });
        const channel = optionalText(url.searchParams.get("channel"));
        const direction = optionalText(url.searchParams.get("direction"));
        if (channel) {
          messages = messages.filter((m) => m.channel === channel);
        }
        if (direction) {
          messages = messages.filter((m) => m.direction === direction);
        }
        sendJson(response, 200, { messages });
        return;
      }

      if (route === "POST /api/inbound-events/mock") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        requireText(body.channel, "channel");
        requireText(body.provider_event_id, "provider_event_id");
        // lead_id is optional when body.contact ({name, email, phone}) is supplied instead —
        // this is real inbound lead capture: an unknown contact reaching out becomes a new lead
        // rather than requiring one to already exist. See ChannelWorkflowService#resolveOrCreateLead.
        if (!body.lead_id && !body.contact) {
          throw httpError(400, "Either lead_id or contact is required.");
        }
        // event_type is optional: when omitted, the reply classifier derives it from
        // payload.text (see ChannelWorkflowService#receiveMockInboundEvent).
        sendJson(
          response,
          202,
          await services.channelWorkflowService.receiveInboundEvent({
            organization_id: body.organization_id,
            lead_id: optionalText(body.lead_id),
            contact: body.contact || null,
            channel: body.channel,
            provider_event_id: body.provider_event_id,
            event_type: optionalText(body.event_type),
            payload: body.payload || {}
          })
        );
        return;
      }

      // Real inbound email replies land here from SendGrid's Inbound Parse — the org has no
      // other way to identify itself to an unauthenticated public POST, so the opaque token in
      // the path (generated by GET /api/settings/channels/email/webhooks) stands in for auth.
      const sendgridInboundMatch = url.pathname.match(/^\/api\/webhooks\/sendgrid\/inbound\/([^/]+)$/);
      if (request.method === "POST" && sendgridInboundMatch) {
        const organizationId = await services.settingsRepository.findOrganizationIdByValue(
          "channel_email",
          "webhook_token",
          sendgridInboundMatch[1]
        );
        if (!organizationId) {
          throw httpError(404, "Unknown webhook token.");
        }
        const rawBody = await readRawBody(request);
        const contentType = request.headers["content-type"] || "";
        const fields = parseMultipartFormData(rawBody, contentType);
        const from = parseEmailAddress(fields.from);
        if (!from) {
          throw httpError(400, "Could not parse a sender address from the inbound email.");
        }
        const messageIdMatch = /^Message-ID:\s*(.+)$/im.exec(fields.headers || "");
        const providerEventId = (messageIdMatch ? messageIdMatch[1].trim() : null) || `sendgrid-inbound-${sha256Hex(rawBody)}`;

        const result = await services.channelWorkflowService.receiveInboundEvent({
          organization_id: organizationId,
          contact: { email: from.email, name: from.name },
          channel: "EMAIL",
          provider: "sendgrid",
          provider_event_id: providerEventId,
          payload: { text: fields.text || stripHtml(fields.html) || "", subject: fields.subject || null }
        });
        sendJson(response, 202, { duplicate: result.duplicate });
        return;
      }

      // SendGrid's Event Webhook — delivery/bounce/open/click notifications for a previously
      // sent email. Maps back to our action via custom_args (set at send time in emailAdapter.js),
      // not by trusting anything in the payload for tenant identity — that's the URL token's job.
      const sendgridEventsMatch = url.pathname.match(/^\/api\/webhooks\/sendgrid\/events\/([^/]+)$/);
      if (request.method === "POST" && sendgridEventsMatch) {
        const organizationId = await services.settingsRepository.findOrganizationIdByValue(
          "channel_email",
          "webhook_token",
          sendgridEventsMatch[1]
        );
        if (!organizationId) {
          throw httpError(404, "Unknown webhook token.");
        }
        const events = await readAuthorizedJson(request, authContext);
        const results = [];
        for (const event of Array.isArray(events) ? events : []) {
          try {
            results.push(await applySendgridEvent(services, organizationId, event));
          } catch (error) {
            results.push({ ok: false, error: error.message || String(error) });
          }
        }
        sendJson(response, 200, { processed: results.length, results });
        return;
      }

      if (route === "GET /api/follow-ups") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(FOLLOW_UP_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, await services.channelWorkflowService.listFollowUps({ organization_id: organizationId, status }));
        return;
      }

      if (route === "POST /api/campaigns") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const organization = await services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        sendJson(
          response,
          201,
          await services.workflowsService.createCampaign({
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
        sendJson(response, 200, await services.workflowsService.listCampaigns({ organization_id: organizationId }));
        return;
      }

      if (route === "POST /api/sequences") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        requireText(body.campaign_id, "campaign_id");
        sendJson(
          response,
          201,
          await services.workflowsService.createSequence({
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
        sendJson(response, 200, await services.workflowsService.listSequences({ organization_id: organizationId }));
        return;
      }

      if (route === "GET /api/workflow-runs") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const status = optionalText(url.searchParams.get("status"));
        if (status && !Object.values(WORKFLOW_RUN_STATUS).includes(status)) {
          throw httpError(400, "status is invalid.");
        }
        sendJson(response, 200, await services.workflowsService.listRuns({ organization_id: organizationId, status }));
        return;
      }

      if (route === "POST /api/workflows/run-due") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          200,
          await services.workflowsService.runDue({
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
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadIntelligenceMatch[1], organizationId)
        );
        const intelligenceContext = await services.intelligenceService.assessLead(lead);
        const synthesisState = await services.synthesisService.currentForLead(lead);
        const recommendationState = await services.intelligenceRecommendationService.currentForLead(lead);
        const nbaState = await services.nextBestActionService.currentForLead(lead);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...intelligenceContext,
          intelligence: intelligenceContext.snapshot,
          synthesis: synthesisState.synthesis,
          synthesis_status: synthesisState.synthesis_status,
          recommendation: recommendationState.intelligence_recommendation,
          recommendation_status: recommendationState.recommendation_status,
          next_best_action: nbaState.next_best_action_plan,
          next_best_action_status: nbaState.plan_status
        });
        return;
      }

      const leadIntelligenceRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence\/run$/);
      if (request.method === "POST" && leadIntelligenceRunMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadIntelligenceRunMatch[1], body.organization_id)
        );
        const intelligence = await services.intelligenceService.runForLead(lead);
        const intelligenceContext = await services.intelligenceService.assessLead(lead);
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
        const lead = await getLeadForOrganizationOrThrow(services, leadIntelligenceHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          snapshots: await services.intelligenceService.historyForLead(lead)
        });
        return;
      }

      const leadResearchEvidenceMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/research-evidence$/);
      if (request.method === "GET" && leadResearchEvidenceMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = await getLeadForOrganizationOrThrow(services, leadResearchEvidenceMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...(await services.researchEvidenceService.listForLead(lead))
        });
        return;
      }

      if (request.method === "POST" && leadResearchEvidenceMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await getLeadForOrganizationOrThrow(services, leadResearchEvidenceMatch[1], body.organization_id);
        try {
          const ingestion = await services.researchEvidenceService.ingestForLead({
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
        const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, leadSynthesisMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...(await services.synthesisService.currentForLead(lead))
        });
        return;
      }

      const leadSynthesisRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/synthesis\/run$/);
      if (request.method === "POST" && leadSynthesisRunMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadSynthesisRunMatch[1], body.organization_id)
        );
        try {
          const synthesis = await services.synthesisService.runForLead(lead, {
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
        const lead = await getLeadForOrganizationOrThrow(services, leadSynthesisHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          syntheses: await services.synthesisService.historyForLead(lead)
        });
        return;
      }

      const leadRecommendationMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence-recommendation$/);
      if (request.method === "GET" && leadRecommendationMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, leadRecommendationMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...(await services.intelligenceRecommendationService.currentForLead(lead))
        });
        return;
      }

      const leadRecommendationRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence-recommendation\/run$/);
      if (request.method === "POST" && leadRecommendationRunMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadRecommendationRunMatch[1], body.organization_id)
        );
        try {
          const intelligenceRecommendation = await services.intelligenceRecommendationService.runForLead(lead, {
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
        const lead = await getLeadForOrganizationOrThrow(services, leadRecommendationHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          intelligence_recommendations: await services.intelligenceRecommendationService.historyForLead(lead)
        });
        return;
      }

      const nextBestActionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/next-best-action$/);
      if (request.method === "GET" && nextBestActionMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, nextBestActionMatch[1], organizationId));
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...(await services.nextBestActionService.currentForLead(lead))
        });
        return;
      }

      const nextBestActionPlanMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/next-best-action\/plan$/);
      if (request.method === "POST" && nextBestActionPlanMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, nextBestActionPlanMatch[1], body.organization_id)
        );
        try {
          const nextBestActionPlan = await services.nextBestActionService.planForLead(lead, {
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
        const lead = await getLeadForOrganizationOrThrow(services, nextBestActionHistoryMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          next_best_action_plans: await services.nextBestActionService.historyForLead(lead)
        });
        return;
      }

      const leadOutboundMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/outbound$/);
      if (request.method === "GET" && leadOutboundMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        const lead = await getLeadForOrganizationOrThrow(services, leadOutboundMatch[1], organizationId);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          actions: await services.outboundAutomationService.listForLead({
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
          await services.channelWorkflowService.listLeadTimeline({
            organization_id: organizationId,
            lead_id: leadTimelineMatch[1]
          })
        );
        return;
      }

      const sequenceEnrollMatch = url.pathname.match(/^\/api\/sequences\/([^/]+)\/enroll$/);
      if (request.method === "POST" && sequenceEnrollMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          201,
          await services.workflowsService.enrollLeads({
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
        const lead = await getLeadForOrganizationOrThrow(services, leadMatch[1], organizationId);
        sendJson(response, 200, { lead: await hydrateLead(services, lead) });
        return;
      }

      const importMatch = url.pathname.match(/^\/api\/imports\/([^/]+)$/);
      if (request.method === "GET" && importMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, await services.importsService.getImport(importMatch[1], organizationId));
        return;
      }

      const importCommitMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
      if (request.method === "POST" && importCommitMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const result = await services.importsService.commitImport({
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
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const action = await services.outboundAutomationService.createActionFromPlan({
          organization_id: body.organization_id,
          plan_id: planActionMatch[1]
        });
        sendJson(response, 201, { action });
        return;
      }

      const executeActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/execute$/);
      if (request.method === "POST" && executeActionMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const result = await services.outboundAutomationService.executeAction({
          organization_id: body.organization_id,
          action_id: executeActionMatch[1]
        });
        sendJson(response, 202, result);
        return;
      }

      if (route === "POST /api/actions/bulk-approve") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        if (!Array.isArray(body.action_ids) || body.action_ids.length === 0) {
          throw httpError(400, "action_ids must be a non-empty array.");
        }
        const results = [];
        for (const actionId of body.action_ids.slice(0, 100)) {
          try {
            const result = await services.approvalsService.approveAction({
              organization_id: body.organization_id,
              action_id: actionId,
              reviewer_name: body.reviewer_name ?? "Bulk approval",
              reviewer_note: body.reviewer_note ?? null,
              edited_payload: null
            });
            results.push({ action_id: actionId, ok: true, result });
          } catch (error) {
            results.push({ action_id: actionId, ok: false, error: error.message || String(error) });
          }
        }
        sendJson(response, 200, {
          organization_id: body.organization_id,
          approved: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results
        });
        return;
      }

      if (route === "POST /api/actions/bulk-reject") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        if (!Array.isArray(body.action_ids) || body.action_ids.length === 0) {
          throw httpError(400, "action_ids must be a non-empty array.");
        }
        const results = [];
        for (const actionId of body.action_ids.slice(0, 100)) {
          try {
            const result = await services.approvalsService.rejectAction({
              organization_id: body.organization_id,
              action_id: actionId,
              reviewer_name: body.reviewer_name ?? "Bulk rejection",
              reviewer_note: body.reviewer_note ?? null
            });
            results.push({ action_id: actionId, ok: true, result });
          } catch (error) {
            results.push({ action_id: actionId, ok: false, error: error.message || String(error) });
          }
        }
        sendJson(response, 200, {
          organization_id: body.organization_id,
          rejected: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results
        });
        return;
      }

      if (route === "POST /api/actions/bulk-execute") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        if (!Array.isArray(body.action_ids) || body.action_ids.length === 0) {
          throw httpError(400, "action_ids must be a non-empty array.");
        }
        const results = [];
        for (const actionId of body.action_ids.slice(0, 100)) {
          try {
            const result = await services.outboundAutomationService.executeAction({
              organization_id: body.organization_id,
              action_id: actionId
            });
            results.push({ action_id: actionId, ok: true, result });
          } catch (error) {
            results.push({ action_id: actionId, ok: false, error: error.message || String(error) });
          }
        }
        sendJson(response, 200, {
          organization_id: body.organization_id,
          executed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results
        });
        return;
      }

      const actionApprovalMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval$/);
      if (request.method === "GET" && actionApprovalMatch) {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(
          response,
          200,
          await services.approvalsService.currentForAction({
            organization_id: organizationId,
            action_id: actionApprovalMatch[1]
          })
        );
        return;
      }

      const actionApprovalApproveMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval\/approve$/);
      if (request.method === "POST" && actionApprovalApproveMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const result = await services.approvalsService.approveAction({
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
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const result = await services.approvalsService.approveAction({
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
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const result = await services.approvalsService.rejectAction({
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
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        requireText(body.provider_event_id, "provider_event_id");
        const action = await services.actionsRepository.getActionForOrganization(actionCallbackMatch[1], body.organization_id);
        if (!action) {
          throw httpError(404, "Action not found.");
        }
        const result = await services.callbacksService.receiveExecutionCallback({
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
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          200,
          await services.channelWorkflowService.completeFollowUp({
            organization_id: body.organization_id,
            follow_up_id: followUpCompleteMatch[1]
          })
        );
        return;
      }

      const followUpCancelMatch = url.pathname.match(/^\/api\/follow-ups\/([^/]+)\/cancel$/);
      if (request.method === "POST" && followUpCancelMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          200,
          await services.channelWorkflowService.cancelFollowUp({
            organization_id: body.organization_id,
            follow_up_id: followUpCancelMatch[1]
          })
        );
        return;
      }

      const leadActionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/actions$/);
      if (request.method === "POST" && leadActionMatch) {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.organization_id, "organization_id");
        const lead = await getLeadForOrganizationOrThrow(services, leadActionMatch[1], body.organization_id);
        const type = optionalText(body.type) || "SEND_EMAIL";
        const mockBehavior = optionalText(body.mock_behavior) || "SUCCESS";
        requireNoValidationErrors(validateActionInput({ type, mock_behavior: mockBehavior }));
        const action = await services.actionsService.createManualAction(lead, {
          type,
          mock_behavior: mockBehavior
        });
        sendJson(response, 201, { action: await services.outboundAutomationService.actionDetail(action) });
        return;
      }

      if (route === "POST /api/worker/run") {
        sendJson(response, 200, await services.worker.runOnce());
        return;
      }

      if (route === "POST /api/callbacks/mock") {
        const body = await readAuthorizedJson(request, authContext);
        requireText(body.action_id, "action_id");
        requireText(body.provider_event_id, "provider_event_id");
        const result = await services.callbacksService.receiveExecutionCallback({
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
      sendError(response, error, { logger: requestLogger, requestId });
    } finally {
      requestLogger.debug("http.request_completed", {
        method: request.method,
        path: new URL(request.url, "http://localhost").pathname,
        status: response.statusCode,
        duration_ms: Date.now() - startedAt
      });
    }
  });

  server.services = services;
  return server;
}

async function getLeadForOrganizationOrThrow(services, leadId, organizationId) {
  const lead = await services.leadsRepository.getLead(leadId);
  if (!lead) {
    throw httpError(404, "Lead not found.");
  }
  if (lead.organization_id !== organizationId) {
    throw httpError(404, "Lead not found for organization.");
  }
  return lead;
}

async function hydrateLead(services, lead) {
  const actions = await services.outboundAutomationService.listForLead({
    organization_id: lead.organization_id,
    lead_id: lead.id
  });
  const hydratedLead = await hydrateLeadProvenance(services, lead);
  const intelligenceContext = await services.intelligenceService.assessLead(hydratedLead);
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

/**
 * The leads a bulk intelligence run would process.
 *
 * Eligible means "does not already have a READY recommendation for its CURRENT
 * inputs". A lead always has an initial data-readiness snapshot from creation, so
 * the presence of a snapshot says nothing about whether analysis is needed; and
 * the check is fingerprint-aware, so a lead whose data changed since its last
 * recommendation becomes eligible again.
 *
 * One definition, used by both the bulk-run endpoint and the summary that drives
 * the button — they cannot drift apart.
 */
async function collectEligibleLeadIds(services, organizationId) {
  const leads = await services.leadsRepository.listLeads(organizationId, {});
  const eligible = [];
  for (const lead of leads) {
    const hydrated = await hydrateLeadProvenance(services, lead);
    const current = await services.intelligenceRecommendationService.currentForLead(hydrated);
    if (current.recommendation_status !== "READY") {
      eligible.push(lead.id);
    }
  }
  return eligible;
}

async function hydrateLeadProvenance(services, lead) {
  const sourceMetadata = parseJson(lead.source_metadata_json) || {};
  const importRow = lead.import_row_id ? await services.importsRepository.getRowById(lead.import_row_id, lead.organization_id) : null;
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

// Behind a hosting platform's reverse proxy (Render, Railway, etc.) the connection to this
// process is plain HTTP even though the browser is talking to the app over HTTPS — the proxy
// tells us the truth via this header, which is why Secure can't just check request.socket.encrypted.
// X-Forwarded-Proto is only meaningful when a proxy we control sets it; a direct
// client could otherwise claim HTTPS and be handed a Secure-flagged cookie over
// plaintext. `trustProxy` is off in local development for that reason, and
// `forceSecureCookies` covers deployments that terminate TLS further upstream.
function isSecureRequest(request, { trustProxy, forceSecureCookies }) {
  if (forceSecureCookies) {
    return true;
  }
  if (trustProxy && request.headers["x-forwarded-proto"] === "https") {
    return true;
  }
  return !!request.socket?.encrypted;
}

// Same as readJson, but for authenticated routes: once a session exists, organization_id is a
// server-derived fact, not client input, so this forces the parsed body's organization_id to
// match the session no matter what the request itself said (or omit). A no-op when authContext
// is null (public routes, or routes with their own non-session auth like the webhooks).
async function readAuthorizedJson(request, authContext) {
  const body = await readJson(request);
  if (authContext) {
    body.organization_id = authContext.organization_id;
  }
  return body;
}

// Parses "Name" <email@example.com> or a bare email@example.com, as sent in SendGrid
// Inbound Parse's `from` field.
function parseEmailAddress(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const angleMatch = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(value);
  if (angleMatch) {
    const name = angleMatch[1].trim();
    const email = angleMatch[2].trim();
    return email ? { name: name || null, email } : null;
  }
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? { name: null, email: trimmed } : null;
}

function stripHtml(html) {
  if (typeof html !== "string" || !html) {
    return "";
  }
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

// A SendGrid Event Webhook delivery covers a wide range of event types — only delivered/
// bounce/dropped/spamreport actually change the outbound action's lifecycle; everything else
// (processed, deferred, open, click, unsubscribe) is tracking-only and just gets audited.
const SENDGRID_TERMINAL_EVENTS = {
  delivered: "COMPLETED",
  bounce: "FAILED",
  dropped: "FAILED",
  spamreport: "FAILED"
};

async function applySendgridEvent(services, organizationId, event) {
  const actionId = event?.custom_args?.relay_action_id;
  if (!actionId) {
    return { ok: false, error: "Event carried no relay_action_id in custom_args." };
  }
  const action = await services.actionsRepository.getActionForOrganization(actionId, organizationId);
  if (!action) {
    return { ok: false, error: "Action not found for this organization." };
  }

  const outcome = SENDGRID_TERMINAL_EVENTS[event.event];
  if (!outcome) {
    await services.auditRepository.record({
      organization_id: organizationId,
      lead_id: action.lead_id,
      action_id: action.id,
      event_type: "EmailTrackingEvent",
      message: `SendGrid reported "${event.event}" for this send.`,
      metadata: { event: event.event, sg_message_id: event.sg_message_id || null }
    });
    return { ok: true, applied: false, event: event.event };
  }

  const result = await services.callbacksService.receiveExecutionCallback({
    action_id: action.id,
    provider_event_id: event.sg_event_id || `${event.event}:${event.sg_message_id}:${event.timestamp}`,
    status: outcome,
    provider_reference: event.sg_message_id || null,
    details: { reason: event.event, sendgrid_reason: event.reason || null }
  });
  return { ok: true, applied: !result.duplicate, event: event.event, action_id: action.id };
}

function requireNoValidationErrors(errors) {
  if (errors.length > 0) {
    throw httpError(400, errors.join(" "));
  }
}
