import {WorkspaceDataLifecycleService} from "../modules/data-lifecycle/workspaceDataLifecycleService.js";
import {OperationalMetricsService} from "../modules/operations/operationalMetrics.js";
import { verifyRuntimeSchema } from "../database/schemaVerifier.js";
import { verifyRuntimeRole } from "../database/runtimeRoleVerifier.js";
import {SetupJourneyService} from "../modules/onboarding/setupJourneyService.js";
import { EmailVerificationService } from "../modules/channels/emailVerificationService.js";
import { recordEmailVerificationReceipt } from "../modules/channels/emailVerificationRepository.js";
import { CustomerWorkflowService } from "../modules/customer-workflow/customerWorkflowService.js";
import { AccountSecurityService } from "../modules/auth/accountSecurityService.js";
import { ComposerService } from "../modules/outbound-automation/composerService.js";
import { PilotInterestService } from "../modules/public-interest/pilotInterestService.js";
import { emailConnectionHash } from "../modules/channels/emailConnectionContract.js";
import { EmailConnectionRepository, emailRouteOwners } from "../modules/channels/emailConnectionRepository.js";
import { EmailConnectionService } from "../modules/channels/emailConnectionService.js";
import { configureChannelRuntime, channelRuntimeFor, assessChannelCapability, assessCurrentChannelCapability } from "../modules/channels/channelCapability.js";
import { IntelligenceFeedbackService } from "../modules/intelligence-feedback/intelligenceFeedbackService.js";
import { IntelligenceEvaluationService } from "../modules/intelligence-evaluation/evaluationService.js";
import { createServer } from "node:http";
import { AnalysisJobsService } from "../modules/analysis-jobs/analysisJobsService.js";
import { configureAiRuntime } from "../modules/ai-usage/aiInvocationService.js";
import { BusinessContextService } from "../modules/business-context/businessContextService.js";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sendError, sendJson, serveStatic } from "../shared/http.js";
import { createNullLogger, safeRequestPath } from "../shared/logger.js";
import { loadConfig } from "../config.js";
import { HttpRequestPolicy, socketPeerAddress } from "../shared/httpRequestPolicy.js";
import { readRequestBody } from "../shared/requestBody.js";
import { AuthAdmissionService } from "../modules/auth/authAdmissionService.js";
import { DispatchControlsService } from "../modules/outbound-automation/dispatchControlsService.js";
import { describeDatabaseFailure, getMigrationStatus } from "../database/database.js";
import { LeadsRepository } from "../modules/data-foundation/leadsRepository.js";
import { loadOutcomeMetrics } from "../modules/customer-workflow/outcomeMetrics.js";
import { validateLeadInput } from "../modules/data-foundation/leadValidation.js";
import { ImportsRepository } from "../modules/data-foundation/importsRepository.js";
import { ImportsService } from "../modules/data-foundation/importsService.js";
import { LeadDataService } from "../modules/data-foundation/leadDataService.js";
import { LeadExportService } from "../modules/data-foundation/leadExportService.js";
import { ImportIdentityService } from "../modules/data-foundation/importIdentityService.js";
import { inspectCsv } from "../modules/data-foundation/reviewedImportMapping.js";
import { normalizeEmail, normalizePhone } from "../modules/data-foundation/normalization.js";
import { EventsRepository } from "../modules/events/eventsRepository.js";
import { AuditRepository } from "../modules/events/auditRepository.js";
import { IntelligenceRepository } from "../modules/lead-intelligence/intelligenceRepository.js";
import { IntelligenceService } from "../modules/lead-intelligence/intelligenceService.js";
import { readIntelligenceSummary } from "../modules/lead-intelligence/intelligenceSummary.js";
import { readIntelligenceView } from "../modules/lead-intelligence/intelligenceReadView.js";
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
import { createApprovalUnitOfWork } from "../modules/outbound-automation/approvalUnitOfWork.js";
import { CallbacksRepository } from "../modules/outbound-automation/callbacksRepository.js";
import { CallbacksService } from "../modules/outbound-automation/callbacksService.js";
import { OutboundAutomationService } from "../modules/outbound-automation/outboundAutomationService.js";
import { APPROVAL_STATUS, validateApprovalDecisionInput } from "../modules/outbound-automation/approvalContract.js";
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
import { verifySendgridWebhook, readBoundedWebhookBody } from "../modules/handlers/sendgridWebhookSecurity.js";
import { ContactPolicyService } from "../modules/contact-policy/contactPolicyService.js";
import { applySendgridEvent, applySendgridConflictPolicyInTransaction, normalizeSendgridEventReceipt, normalizeSendgridInbound } from "../modules/channels/sendgridEvents.js";
import { WebhookInboxService } from "../modules/webhook-inbox/webhookInboxService.js";
import { InboundMessageService } from "../modules/channels/inboundMessageService.js";
import { SettingsRepository } from "../modules/settings/settingsRepository.js";
import { maskSecrets, stripUnchangedSecrets } from "../modules/settings/secretSettings.js";
import { DispatchRecoveryService } from "../modules/outbound-automation/dispatchRecoveryService.js";
import { Worker } from "../modules/events/worker.js";
import { parseJson } from "../database/database.js";
import { createId } from "../shared/ids.js";
import { readRawBody, parseMultipartFormData } from "../shared/multipart.js";
import { getSessionCookie, setSessionCookie, clearSessionCookie } from "../shared/cookies.js";
import { AuthRepository } from "../modules/auth/authRepository.js";
import { AuthService } from "../modules/auth/authService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "..", "client", "dist");

export function createServices(db, logger = createNullLogger(), config = loadConfig(), { aiProvider, emailVerificationAdapter } = {}) {
  if ((aiProvider !== undefined || emailVerificationAdapter !== undefined) && (config.env !== "test" || !config.security.testControlsEnabled)) throw new Error("Injected AI adapters require explicit test configuration.");
  configureChannelRuntime(db, config);
  const emailConnectionService = new EmailConnectionService(db, { publicOrigin: config.security.publicAppOrigin });
  const contactPolicyService = new ContactPolicyService(db);
  const businessContextService = new BusinessContextService(db);
  const leadsRepository = new LeadsRepository(db);
  const importsRepository = new ImportsRepository(db);
  const eventsRepository = new EventsRepository(db);
  const auditRepository = new AuditRepository(db);
  const authRepository = new AuthRepository(db);
  const authService = new AuthService({ authRepository, leadsRepository, auditRepository });
  const authAdmission = new AuthAdmissionService({ db, secret: config.auth.rateLimitSecret, maxConcurrentHashes: config.auth.maxConcurrentHashes });
  const importsService = new ImportsService({ importsRepository, leadsRepository, eventsRepository, auditRepository });
  const importIdentityService = new ImportIdentityService(db);
  const leadDataService = new LeadDataService(db);
  const leadExportService = new LeadExportService(db);
  const intelligenceRepository = new IntelligenceRepository(db);
  const intelligenceService = new IntelligenceService({ intelligenceRepository, auditRepository });
  const researchEvidenceRepository = new ResearchEvidenceRepository(db);
  const researchEvidenceService = new ResearchEvidenceService({ researchEvidenceRepository, auditRepository });
  const rawLlmProvider = aiProvider === undefined ? (isLlmConfigured() ? getLlmProvider() : null) : aiProvider;
  const { provider: llmProvider, invocationService: aiInvocationService, generationDescriptor } = configureAiRuntime(db, { provider: rawLlmProvider });
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
    generationDescriptor,
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
  const approvalsService = new ApprovalsService({ approvalsRepository, actionsRepository, auditRepository, unitOfWork: createApprovalUnitOfWork(db) });
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
    contactPolicyService,
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
  const dispatchControlsService = new DispatchControlsService({ db, contactPolicyService, globalEnabled: config.outbound.enabled, now: () => actionExecutor.now() });
  const actionExecutor = new ActionExecutor({
    contactPolicyService, dispatchControlsService,
    actionsRepository,
    executionsRepository,
    auditRepository,
    adapter,
    channelWorkflowService
  });
  const dispatchRecoveryService = new DispatchRecoveryService({ db, contactPolicyService, now: () => actionExecutor.now() });
  const workflowsService = new WorkflowsService({
    contactPolicyService, now: () => actionExecutor.now(),
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
    contactPolicyService,
    callbacksRepository,
    now: () => actionExecutor.now(),
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
    auditRepository,
    // Needed to compose customer-facing message copy grounded in the lead's own
    // record and their latest classified reply.
    leadsRepository,
    inboundEventsRepository
  });
  const inboundMessageService = channelWorkflowService.inboundMessageService || new InboundMessageService({
    db, contactPolicyService, replyClassifier: channelWorkflowService.replyClassifier
  });
  channelWorkflowService.inboundMessageService = inboundMessageService;
  const webhookInbox = new WebhookInboxService({
    db, contactPolicyService, now: () => actionExecutor.now(),
    policyHandlers: {
      SENDGRID_EVENT: (tx, input, context) => applySendgridConflictPolicyInTransaction(
        { actionsRepository, contactPolicyService }, tx, context.receipt.organization_id, input, context),
      INBOUND_MESSAGE: (tx, input, context) => inboundMessageService.applyConflictPolicyInTransaction(tx, context.receipt.organization_id, input, context)
    },
    handlers: {
      EXECUTION_CALLBACK: (input, context) => callbacksService.applyExecutionCallback(input, context),
      INBOUND_MESSAGE: (input, context) => inboundMessageService.applyInboundMessage(input, context),
      SENDGRID_EVENT: (input, context) => applySendgridEvent(
        { actionsRepository, callbacksService, auditRepository, contactPolicyService, webhookInbox }, context.receipt.organization_id, input, context)
    }
  });
  callbacksService.webhookInbox = webhookInbox;
  inboundMessageService.webhookInbox = webhookInbox;
  const intelligenceFeedbackService = new IntelligenceFeedbackService(db);
  const intelligenceEvaluationService = new IntelligenceEvaluationService(db);
  const analysisJobsService = new AnalysisJobsService({ db, getServices: () => services });
  const worker = new Worker({
    analysisJobsService,
    dispatchControlsService,
    workflowsService, contactPolicyService,
    webhookInbox,
    dispatchRecoveryService,
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

  const services = {
    accountSecurityService: new AccountSecurityService(db),
    composerService: new ComposerService(db),
    workspaceDataLifecycleService: new WorkspaceDataLifecycleService(db),
    operationalMetricsService: new OperationalMetricsService(db,{dispatchControlsService}),
    setupJourneyService: new SetupJourneyService(db),
    customerWorkflowService: new CustomerWorkflowService(db),
    emailVerificationService: new EmailVerificationService(db, { publicOrigin: config.security.publicAppOrigin, controlledRecipients: config.emailVerification?.controlledRecipients, ...(emailVerificationAdapter ? { adapter:emailVerificationAdapter } : {}) }),
    pilotInterestService: new PilotInterestService(db, { secret: config.auth.rateLimitSecret }),
    emailConnectionService,
    intelligenceFeedbackService, intelligenceEvaluationService,
    analysisJobsService, aiInvocationService,
    businessContextService,
    domainEventProcessor: worker.domainEventProcessor, scheduler: worker.scheduler, followUpDueService: worker.followUpDueService,
    webhookInbox,
    inboundMessageService,
    contactPolicyService,
    dispatchRecoveryService,
    leadsRepository,
    importsRepository,
    importsService,
    importIdentityService, leadDataService, leadExportService,
    authRepository,
    authService, authAdmission, dispatchControlsService,
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
  return services;
}

export function createApp({ db, logger = createNullLogger(), config = null, aiProvider = undefined, emailVerificationAdapter = undefined } = {}) {
  config ||= loadConfig();
  const services = createServices(db, logger, config, { aiProvider, emailVerificationAdapter });
  let readinessProof=null,readinessInFlight=null;
  async function inspectReadinessStructures(){
    if(readinessInFlight)return readinessInFlight;
    if(readinessProof&&performance.now()<readinessProof.expires){
      if(readinessProof.error)throw readinessProof.error;
      return readinessProof.result;
    }
    const operation=(async()=>{
      const schema=await verifyRuntimeSchema(db);
      const role=config.isProductionLike&&db.kind==="postgres"?await verifyRuntimeRole(db):{compatible:true,mode:"NOT_CHECKED"};
      return {schema:{compatible:schema.compatible,manifest_version:schema.manifest_version,tables:schema.tables},role:{compatible:role.compatible,mode:role.mode}};
    })();
    readinessInFlight=operation;
    try{const result=await operation;readinessProof={expires:performance.now()+5000,result};return result;}
    catch(error){readinessProof={expires:performance.now()+5000,error};throw error;}
    finally{if(readinessInFlight===operation)readinessInFlight=null;}
  }
  const httpPolicy = new HttpRequestPolicy({ publicAppOrigin: config.security.publicAppOrigin, maxInFlight: config.http.maxInFlight });
  const trustProxy = config ? config.security.trustProxy : true;
  const forceSecureCookies = config ? config.security.forceSecureCookies : false;
  const testControlsEnabled = config?.security?.testControlsEnabled === true
    && !config.isProductionLike && ["test", "development"].includes(config.env);
  const isolatedE2eHarness = testControlsEnabled && config.env === "test"
    && config.security.isolatedE2eHarness === true && db.kind === "sqlite"
    && config.database.driver === "sqlite" && config.database.databaseFile === ":memory:";

  const pendingRequests = new Set();
  let acceptingRequests = true;
  const server = createServer({ maxHeaderSize: config.http.headerBytes, headersTimeout: config.http.headerTimeout,
    requestTimeout: config.http.requestTimeout, keepAliveTimeout: config.http.keepAlive }, async (request, response) => {
    let completeRequest;
    const completion = new Promise(resolve => { completeRequest = resolve; });
    pendingRequests.add(completion);
    let handlerDone = false, responseDone = false, releaseAdmission = null;
    const releaseIfDone = () => { if (handlerDone && responseDone) releaseAdmission?.(); };
    const finishResponse = () => { responseDone = true; releaseIfDone(); };
    response.once("finish", finishResponse);
    response.once("close", finishResponse);
    // One id per request, echoed on error responses and stamped on every log
    // line for the request, so a user-reported failure can be found in the logs.
    const requestId = randomUUID();
    const startedAt = Date.now();
    const requestLogger = logger.child({ request_id: requestId });
    response.setHeader("x-request-id", requestId);
    let requestPath = "/:unparsed";
    try {
      if (typeof request.url !== "string" || request.url.length > 8192) throw Object.assign(httpError(414, "Request target is too long."), { closeConnection: true });
      let url;
      try { url = new URL(request.url, "http://localhost"); } catch { throw Object.assign(httpError(400, "Request target is invalid."), { closeConnection: true }); }
      requestPath = safeRequestPath(url.pathname);
      const route = `${request.method} ${url.pathname}`;
      const supportedWebhook = request.method === "POST" && /^\/api\/webhooks\/sendgrid\/(inbound|events)\/[^/]+$/.test(url.pathname);
      const stateChangingGet = request.method === "GET" && (/^\/api\/actions\/[^/]+\/approval$/.test(url.pathname) || url.pathname === "/api/settings/channels/email/webhooks");
      httpPolicy.assertOrigin(request, { supportedWebhook, stateChangingGet });
      const authBody = route === "POST /api/auth/register" || route === "POST /api/auth/login" || route === "POST /api/auth/recover" || url.pathname.startsWith("/api/auth/security") || route === "POST /api/public/pilot-requests" || url.pathname.startsWith("/api/workspace-data");
      request.bodyPolicy = { maxBytes: authBody ? 16 * 1024 : ["POST /api/imports/csv/preview", "POST /api/imports/csv/inspect"].includes(route) ? 5 * 1024 * 1024 : 1024 * 1024, timeoutMs: config.http.bodyTimeout };
      if (["GET", "HEAD"].includes(request.method) && (request.headers["transfer-encoding"] || Number(request.headers["content-length"]) > 0))
        throw Object.assign(httpError(400, "This request must not contain a body."), { closeConnection: true });
      if (!url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method))
        throw Object.assign(httpError(405, "This resource supports GET and HEAD only."), { closeConnection: true });
      // Capacity covers handler work even after a client disconnects. Liveness stays cheap.
      const liveProbe = route === "GET /api/health" || route === "GET /api/health/live";
      if (!liveProbe) {
        if (!acceptingRequests) throw Object.assign(httpError(503, "The service is shutting down."), { code: "HTTP_BUSY", retryAfterSeconds: 1, closeConnection: true });
        releaseAdmission = httpPolicy.acquire();
      }
      const testControlRoute = isTestControlRoute(route);
      if (testControlRoute && !testControlsEnabled) {
        throw httpError(404, "API route not found.");
      }

      // Every /api/ route requires a valid session except the handful that exist to create one
      // (register, login) or that authenticate a different way entirely (webhooks, which use a
      // workspace routing token plus verification of the provider signature over raw request bytes).
      // Once authenticated, the session's organization_id silently overwrites whatever
      // organization_id the request itself claims — the client is never trusted for tenant
      // identity, only for which of ITS OWN resources it wants.
      const isWebhookRoute = supportedWebhook;
      const PUBLIC_API_ROUTES = new Set([
        "GET /api/health",
        "GET /api/health/live",
        "GET /api/health/ready",
        "POST /api/auth/register",
        "POST /api/auth/login",
        "POST /api/public/pilot-requests",
        "POST /api/auth/recover"
      ]);
      const requiresAuth = url.pathname.startsWith("/api/") && !isWebhookRoute && !PUBLIC_API_ROUTES.has(route);
      let authContext = null;
      if (requiresAuth) {
        authContext = await services.authService.requireSession(getSessionCookie(request));
        url.searchParams.set("organization_id", authContext.organization_id);
        // Current accounts support a single owner. Additional write roles need L5-02.
        const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method)
          && route !== "POST /api/auth/logout";
        if (isMutation || url.pathname.startsWith("/api/settings") || url.pathname.startsWith("/api/ai/")
          || url.pathname.startsWith("/api/intelligence-feedback") || url.pathname.startsWith("/api/intelligence-evaluation")
          || /^GET \/api\/actions\/[^/]+\/approval$/.test(route)) {
          requireOwner(authContext);
        }
      }


      if (route === "GET /api/auth/security" || route === "GET /api/auth/security/history") {
        const input = { organization_id: authContext.organization_id, actor: authContext.user, session_id: authContext.session.id };
        sendJson(response, 200, route.endsWith("/history") ? await services.accountSecurityService.history({ ...input, before_revision: optionalIntegerQuery(url,"before_revision"), limit: optionalIntegerQuery(url,"limit") }) : await services.accountSecurityService.get(input)); return;
      }
      if (route === "POST /api/auth/recover") {
        const body = await readJson(request);
        const result = await services.authAdmission.run({ operation:"LOGIN", peerAddress:socketPeerAddress(request), email:body.email }, () => services.accountSecurityService.recover(body));
        clearSessionCookie(response, { secure:isSecureRequest(request,{trustProxy,forceSecureCookies}) });sendJson(response,200,result);return;
      }
      const securityMethods = { "POST /api/auth/security/password":"changePassword", "POST /api/auth/security/recovery-codes":"rotateRecoveryCodes", "POST /api/auth/security/sessions/revoke-others":"revokeOtherSessions", "POST /api/auth/security/sessions/revoke-all":"revokeAllSessions" };
      const sessionRevoke = /^POST \/api\/auth\/security\/sessions\/([^/]+)\/revoke$/.exec(route);
      if (Object.hasOwn(securityMethods,route) || sessionRevoke) {
        const body = await readAuthorizedJson(request,authContext,{testControlsEnabled});
        assertProductCommand(body,["expected_security_revision","current_password",...(route.endsWith("/password")?["new_password"]:[])]);
        const input = {...body,organization_id:authContext.organization_id,actor:authContext.user,session_id:authContext.session.id,...(sessionRevoke?{session_public_id:decodeURIComponent(sessionRevoke[1])}:{})};
        const method=sessionRevoke?"revokeSession":securityMethods[route];
        const result = await services.authAdmission.run({operation:"LOGIN",peerAddress:socketPeerAddress(request),email:authContext.user.email},()=>services.accountSecurityService[method](input));
        if(result.sign_in_required)clearSessionCookie(response,{secure:isSecureRequest(request,{trustProxy,forceSecureCookies})});sendJson(response,200,result);return;
      }
      if (route === "POST /api/public/pilot-requests") {
        sendJson(response, 202, await services.pilotInterestService.submit(await readJson(request), request.socket.remoteAddress)); return;
      }



      if(route==="GET /api/channels/email/verification"){
        sendJson(response,200,await services.emailVerificationService.get({organization_id:authContext.organization_id,actor:authContext.user}));return;
      }
      if(route==="POST /api/channels/email/verification"){
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});assertProductCommand(body,["expected_connection_revision","review_token","request_key","reason"]);
        sendJson(response,200,await services.emailVerificationService.create({...body,organization_id:authContext.organization_id,actor:authContext.user}));return;
      }
      const verificationRequest=/^GET \/api\/channels\/email\/verification\/requests\/([^/]+)$/.exec(route);
      if(verificationRequest){sendJson(response,200,await services.emailVerificationService.byRequestKey({organization_id:authContext.organization_id,actor:authContext.user,request_key:decodeURIComponent(verificationRequest[1])}));return;}
      const verificationCommand=/^POST \/api\/channels\/email\/verification\/([^/]+)\/(check|probes)$/.exec(route);
      if(verificationCommand){
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});assertProductCommand(body,verificationCommand[2]==="check"?["request_key"]:["request_key","purpose"]);
        sendJson(response,200,await services.emailVerificationService[verificationCommand[2]==="check"?"check":"createProbe"]({...body,organization_id:authContext.organization_id,actor:authContext.user,verification_id:decodeURIComponent(verificationCommand[1])}));return;
      }



      if(route==="GET /api/operations/status"){
        sendJson(response,200,await services.operationalMetricsService.get({organization_id:authContext.organization_id,actor:authContext.user}));return;
      }
      if(["GET /api/workspace-data","GET /api/workspace-data/history","POST /api/workspace-data/erasure-preview","POST /api/workspace-data/export","POST /api/workspace-data/erase"].includes(route)){
        const scope={organization_id:authContext.organization_id,actor:authContext.user,session_token:authContext.session.id};
        if(request.method==="GET"){sendJson(response,200,await services.workspaceDataLifecycleService[route.endsWith("/history")?"history":"inspect"]({...scope,...(route.endsWith("/history")?{cursor:url.searchParams.get("cursor")??undefined,limit:optionalIntegerQuery(url,"limit")}:{})}));return;}
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});
        assertProductCommand(body,route.endsWith("/erase")?["request_key","plan_token","confirmation","current_password"]:[]);
        if(route.endsWith("/export")){
          const result=await services.workspaceDataLifecycleService.export(scope),text=JSON.stringify(result);
          if(Buffer.byteLength(text,"utf8")>64*1024*1024)throw Object.assign(httpError(413,"Workspace export exceeds the supported size."),{code:"WORKSPACE_DATA_LIMIT"});
          response.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Disposition":'attachment; filename="workspace-customer-data.json"',"Cache-Control":"no-store"});response.end(text);return;
        }
        if(route.endsWith("/erase")){
          const result=await services.authAdmission.run({operation:"LOGIN",peerAddress:socketPeerAddress(request),email:authContext.user.email},()=>services.workspaceDataLifecycleService.erase({...body,...scope}));
          sendJson(response,200,result);return;
        }
        sendJson(response,200,await services.workspaceDataLifecycleService.previewErasure(scope));return;
      }
      const erasureRequest=/^GET \/api\/workspace-data\/requests\/([^/]+)$/.exec(route);
      if(erasureRequest){sendJson(response,200,await services.workspaceDataLifecycleService.byRequestKey({organization_id:authContext.organization_id,actor:authContext.user,session_token:authContext.session.id,request_key:decodeURIComponent(erasureRequest[1])}));return;}

      if(route==="GET /api/setup-journey"){
        sendJson(response,200,await services.setupJourneyService.get({organization_id:authContext.organization_id,actor:authContext.user}));return;
      }
      const conversationMessages=/^GET \/api\/leads\/([^/]+)\/conversation\/messages$/.exec(route);
      if(conversationMessages){
        sendJson(response,200,await services.customerWorkflowService.listConversationMessages({organization_id:authContext.organization_id,actor:authContext.user,lead_id:decodeURIComponent(conversationMessages[1]),after_id:url.searchParams.get("after_id")??undefined,limit:optionalIntegerQuery(url,"limit")}));return;
      }

      const customerLead = /^(GET|POST) \/api\/leads\/([^/]+)\/(conversation|follow-ups|outcomes)$/.exec(route);
      if (customerLead) {
        const scope={organization_id:authContext.organization_id,actor:authContext.user,lead_id:decodeURIComponent(customerLead[2])}, kind=customerLead[3];
        if(request.method==="GET"){
          const method={conversation:"getConversation","follow-ups":"listFollowUps",outcomes:"listOutcomes"}[kind];
          sendJson(response,200,await services.customerWorkflowService[method]({...scope,after_id:url.searchParams.get("after_id")??undefined,limit:optionalIntegerQuery(url,"limit")}));return;
        }
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});
        const fields={conversation:["request_key","expected_revision","review_token","status","read_state","assigned_owner_id","reason"],"follow-ups":["request_key","review_token","due_at","reason","reply_to_message_id"],outcomes:["outcome_id","expected_revision","review_token","request_key","status","values","reason"]};
        assertProductCommand(body,fields[kind]);
        const method={conversation:"saveConversation","follow-ups":"createFollowUp",outcomes:"saveOutcome"}[kind];
        sendJson(response,200,await services.customerWorkflowService[method]({...body,...scope}));return;
      }
      if(route==="GET /api/customer-workflow/conversations"){
        sendJson(response,200,await services.customerWorkflowService.listConversations({organization_id:authContext.organization_id,actor:authContext.user,after_lead_id:url.searchParams.get("after_lead_id")??undefined,limit:optionalIntegerQuery(url,"limit")}));return;
      }
      const customerRequest=/^GET \/api\/customer-workflow\/requests\/([^/]+)\/([^/]+)$/.exec(route);
      if(customerRequest){
        sendJson(response,200,await services.customerWorkflowService.byRequestKey({organization_id:authContext.organization_id,actor:authContext.user,kind:decodeURIComponent(customerRequest[1]),request_key:decodeURIComponent(customerRequest[2])}));return;
      }
      const followUpChange=/^POST \/api\/follow-ups\/([^/]+)\/change$/.exec(route);
      if(followUpChange){
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});assertProductCommand(body,["request_key","expected_task_token","operation","due_at","reason"]);
        sendJson(response,200,await services.customerWorkflowService.changeFollowUp({...body,organization_id:authContext.organization_id,actor:authContext.user,follow_up_id:decodeURIComponent(followUpChange[1])}));return;
      }
      const outcomeHistory=/^GET \/api\/outcomes\/([^/]+)$/.exec(route);
      if(outcomeHistory){
        sendJson(response,200,await services.customerWorkflowService.getOutcome({organization_id:authContext.organization_id,actor:authContext.user,outcome_id:decodeURIComponent(outcomeHistory[1]),lead_id:url.searchParams.get("lead_id")??undefined,before_revision:optionalIntegerQuery(url,"before_revision"),limit:optionalIntegerQuery(url,"limit")}));return;
      }
      if(route==="POST /api/outcomes/export"){
        const body=await readAuthorizedJson(request,authContext,{testControlsEnabled});assertProductCommand(body,["outcome_ids"]);
        const result=await services.customerWorkflowService.exportOutcomes({organization_id:authContext.organization_id,actor:authContext.user,outcome_ids:body.outcome_ids});
        response.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="enquiry-outcomes.csv"',"Cache-Control":"no-store","X-Export-Record-Count":String(result.row_count)});
        response.end(result.csv_text);return;
      }

      const composerLead = /^(GET|POST) \/api\/leads\/([^/]+)\/composer$/.exec(route);
      if (composerLead) {
        const scope = { organization_id: authContext.organization_id, actor: authContext.user, lead_id: decodeURIComponent(composerLead[2]) };
        if (request.method === "GET") { sendJson(response, 200, await services.composerService.get({ ...scope, reply_to_message_id: url.searchParams.get("reply_to_message_id") })); return; }
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertProductCommand(body, ["request_key","review_token","acknowledge_pending","reason","kind","reply_to_message_id","subject","body","scheduled_at"]);
        sendJson(response, 200, await services.composerService.create({ ...body, ...scope })); return;
      }
      const composerEdit = /^PUT \/api\/actions\/([^/]+)\/composer$/.exec(route);
      if (composerEdit) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertProductCommand(body, ["request_key","expected_revision_id","reason","subject","body","scheduled_at"]);
        sendJson(response, 200, await services.composerService.edit({ ...body, organization_id: authContext.organization_id, actor: authContext.user, action_id: decodeURIComponent(composerEdit[1]) })); return;
      }
      const composerRequest = /^GET \/api\/composer\/requests\/([^/]+)$/.exec(route);
      if (composerRequest) { sendJson(response, 200, await services.composerService.byRequestKey({ organization_id: authContext.organization_id, actor: authContext.user, request_key: decodeURIComponent(composerRequest[1]) })); return; }

      // Exact saved-result reviews and bounded, owner-curated replay datasets.
      if (route === "GET /api/intelligence-feedback/target" || route === "GET /api/intelligence-feedback/history") {
        const input = { organization_id: authContext.organization_id, actor: authContext.user,
          lead_id: url.searchParams.get("lead_id"), target_kind: url.searchParams.get("target_kind"), target_id: url.searchParams.get("target_id") };
        const result = route.endsWith("/history")
          ? await services.intelligenceFeedbackService.history({ ...input, before_revision: optionalIntegerQuery(url, "before_revision"), limit: optionalIntegerQuery(url, "limit") })
          : await services.intelligenceFeedbackService.review(input);
        sendJson(response, 200, result); return;
      }
      if (route === "GET /api/intelligence-feedback/candidates") {
        sendJson(response, 200, await services.intelligenceFeedbackService.listCandidates({
          organization_id: authContext.organization_id, actor: authContext.user,
          after_feedback_id: url.searchParams.get("after_feedback_id") ?? undefined, limit: optionalIntegerQuery(url, "limit")
        })); return;
      }
      const feedbackRequest = /^GET \/api\/intelligence-feedback\/requests\/([^/]+)$/.exec(route);
      if (feedbackRequest) {
        sendJson(response, 200, await services.intelligenceFeedbackService.byRequestKey({
          organization_id: authContext.organization_id, actor: authContext.user, request_key: decodeURIComponent(feedbackRequest[1])
        })); return;
      }
      if (route === "POST /api/intelligence-feedback") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertIntelligenceReviewCommand(body, ["lead_id", "target_kind", "target_id", "expected_feedback_revision", "review_token", "request_key", "operation", "labels", "reason"]);
        sendJson(response, 200, await services.intelligenceFeedbackService.record({ ...body, actor: authContext.user })); return;
      }
      if (route === "GET /api/intelligence-evaluation/datasets") {
        sendJson(response, 200, await services.intelligenceEvaluationService.listDatasets({
          organization_id: authContext.organization_id, actor: authContext.user,
          before_dataset_id: url.searchParams.get("before_dataset_id") ?? undefined, limit: optionalIntegerQuery(url, "limit")
        })); return;
      }
      if (route === "POST /api/intelligence-evaluation/datasets") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertIntelligenceReviewCommand(body, ["request_key", "expected_version", "name", "split", "feedback_revisions"]);
        sendJson(response, 200, await services.intelligenceEvaluationService.createDataset({ ...body, actor: authContext.user })); return;
      }
      const evaluationRequest = /^GET \/api\/intelligence-evaluation\/requests\/([^/]+)$/.exec(route);
      if (evaluationRequest) {
        sendJson(response, 200, await services.intelligenceEvaluationService.getDatasetRequest({
          organization_id: authContext.organization_id, actor: authContext.user, request_key: decodeURIComponent(evaluationRequest[1])
        })); return;
      }
      const datasetRoute = /^(GET|POST) \/api\/intelligence-evaluation\/datasets\/([^/]+)(?:\/(evaluate|evaluations))?$/.exec(route);
      if (datasetRoute) {
        const input = { organization_id: authContext.organization_id, actor: authContext.user, dataset_id: decodeURIComponent(datasetRoute[2]) };
        if (datasetRoute[1] === "GET" && !datasetRoute[3]) {
          sendJson(response, 200, await services.intelligenceEvaluationService.getDataset(input)); return;
        }
        if (datasetRoute[1] === "GET" && datasetRoute[3] === "evaluations") {
          sendJson(response, 200, await services.intelligenceEvaluationService.listEvaluations({ ...input,
            before_evaluation_id: url.searchParams.get("before_evaluation_id") ?? undefined, limit: optionalIntegerQuery(url, "limit") })); return;
        }
        if (datasetRoute[1] === "POST" && datasetRoute[3] === "evaluate") {
          const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
          assertIntelligenceReviewCommand(body, []);
          sendJson(response, 200, await services.intelligenceEvaluationService.evaluate(input)); return;
        }
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
          check: "live",
          ...(isolatedE2eHarness ? { test_harness: { kind: "isolated-e2e", database: "sqlite-memory", providers: "disabled" } } : {})
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
          const historyReady=migrations.initialized && migrations.compatible && migrations.pending.length===0;
          const proof=historyReady?await inspectReadinessStructures():null;
          const ready=historyReady&&proof.schema.compatible&&proof.role.compatible;
          sendJson(response, ready ? 200 : 503, {
            status: ready ? "ready" : historyReady ? !proof.schema.compatible ? "schema_incompatible" : "runtime_role_unsafe" : migrations.compatible ? "pending_migrations" : "schema_incompatible",
            ...(proof?{schema:proof.schema,runtime_role:proof.role,verification_cache_seconds:5}:{}),
            database: { driver: db.kind, reachable: true },
            migrations: {
              applied: migrations.applied.length,
              pending: migrations.pending,
              total: migrations.total,
              initialized: migrations.initialized,
              compatible: migrations.compatible
            }
          });
        } catch (error) {
          requestLogger.error("health.readiness_failed", describeDatabaseFailure(error));
          sendJson(response, 503, {
            status: "database_unreachable",
            database: { driver: db.kind, reachable: false }
          });
        }
        return;
      }

      if (route === "POST /api/auth/register") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        const result = await services.authAdmission.run({ operation: "REGISTER", peerAddress: socketPeerAddress(request), email: body.email },
          () => services.authService.register({ organization_name: body.organization_name, name: body.name, email: body.email, password: body.password }));
        setSessionCookie(response, result.session.id, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 201, { user: result.user, organization: result.organization });
        return;
      }

      if (route === "POST /api/auth/login") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        const result = await services.authAdmission.run({ operation: "LOGIN", peerAddress: socketPeerAddress(request), email: body.email },
          () => services.authService.login({ email: body.email, password: body.password }));
        setSessionCookie(response, result.session.id, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 200, { user: result.user, organization: result.organization });
        return;
      }

      if (route === "POST /api/auth/logout") {
        await readRequestBody(request, { maxBytes: 16 * 1024, timeoutMs: config.http.bodyTimeout });
        await services.authService.logout(authContext.session.id);
        clearSessionCookie(response, { secure: isSecureRequest(request, { trustProxy, forceSecureCookies }) });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (route === "GET /api/auth/me") {
        const organization = await services.leadsRepository.getOrganization(authContext.organization_id);
        sendJson(response, 200, { user: authContext.user, organization, capabilities: { test_controls: testControlsEnabled, developer_tools: ["development", "test"].includes(config.env) && config.security.developerToolsEnabled === true && authContext.user.role === "OWNER" } });
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


      if (route === "GET /api/settings/channels/email/connection") {
        sendJson(response, 200, await services.emailConnectionService.get({ organization_id: authContext.organization_id, actor: authContext.user })); return;
      }
      if (route === "GET /api/settings/channels/email/connection/history") {
        sendJson(response, 200, await services.emailConnectionService.history({ organization_id: authContext.organization_id, actor: authContext.user,
          before_revision: optionalIntegerQuery(url, "before_revision"), limit: optionalIntegerQuery(url, "limit") })); return;
      }
      const connectionRequest = /^GET \/api\/settings\/channels\/email\/connection\/requests\/([^/]+)$/.exec(route);
      if (connectionRequest) {
        sendJson(response, 200, await services.emailConnectionService.byRequestKey({ organization_id: authContext.organization_id, actor: authContext.user,
          request_key: decodeURIComponent(connectionRequest[1]) })); return;
      }
      if (route === "PUT /api/settings/channels/email/connection" || route === "POST /api/settings/channels/email/connection/provision" || route === "POST /api/settings/channels/email/connection/rotate") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        const save = request.method === "PUT";
        assertChannelSetupCommand(body, ["expected_revision", "review_token", "request_key", "reason", ...(save ? ["values"] : [])]);
        const input = { ...body, actor: authContext.user };
        if (isolatedE2eHarness) {
          const provider = save ? body.values?.provider : (await services.emailConnectionService.get({ organization_id: authContext.organization_id, actor: authContext.user })).settings.provider;
          if (provider !== "sandbox") throw channelSetupError(403, "CHANNEL_LIVE_DISABLED", "Live provider changes are disabled in the isolated test harness.");
        }
        const result = save ? await services.emailConnectionService.save(input) : route.endsWith("/rotate")
          ? await services.emailConnectionService.rotateRoute(input) : await services.emailConnectionService.provisionRoute(input);
        sendJson(response, 200, result); return;
      }

      if (route === "GET /api/settings") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        // Credentials are masked on the way out — see modules/settings/secretSettings.js.
        const emailSetup = channelRuntimeFor(db).legacy_adapter_tests ? null : await services.emailConnectionService.get({ organization_id: organizationId, actor: authContext.user });
        const settings = maskSecrets(await services.settingsRepository.getAll(organizationId));
        if (emailSetup) settings.channel_email = emailSetup.settings;
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        requireText(body.category, "category");
        const ALLOWED_CATEGORIES = new Set(["general", "channel_email", "channel_whatsapp", "channel_sms", "channel_telegram", "channel_call", "ai"]);
        if (!ALLOWED_CATEGORIES.has(body.category)) {
          throw httpError(400, `category must be one of: ${[...ALLOWED_CATEGORIES].join(", ")}`);
        }
        if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
          throw httpError(400, "values must be an object");
        }
        if (isolatedE2eHarness && body.category.startsWith("channel_")
          && Object.hasOwn(body.values, "provider") && body.values.provider !== "sandbox") {
          throw httpError(403, "Live providers are disabled in the isolated E2E harness.");
        }
        if (!channelRuntimeFor(db).legacy_adapter_tests && body.category.startsWith("channel_")) {
          if (body.category === "channel_email") throw channelSetupError(409, "CHANNEL_CONNECTION_REQUIRED", "Use the reviewed Email setup form to change this connection.");
          if (Object.keys(body.values).some(key => ["webhook_token", "connection_revision", "capabilities", "verification", "ready", "live_verified"].includes(key))) throw channelSetupError(400, "CHANNEL_INVALID_INPUT", "Channel settings contain server-owned fields.");
          const current = await services.settingsRepository.getCategory(body.organization_id, body.category);
          if ((body.values.provider ?? current.provider ?? "sandbox") !== "sandbox") throw channelSetupError(409, "CHANNEL_LIVE_UNSUPPORTED", "This live channel is unavailable in the current product workflow.");
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
        const setup = await services.emailConnectionService.get({ organization_id: authContext.organization_id, actor: authContext.user });
        sendJson(response, 200, {
          inbound_path: setup.routing.inbound_url ? new URL(setup.routing.inbound_url).pathname : null,
          events_path: setup.routing.events_url ? new URL(setup.routing.events_url).pathname : null,
          provisioned: setup.routing.provisioned,
          verification: setup.verification.status
        }); return;
      }

      if (route === "GET /api/settings/channels/test") {
        const types = { email: "SEND_EMAIL", sms: "SEND_SMS", whatsapp: "SEND_WHATSAPP", call: "SEND_VOICE_CALL", telegram: "SEND_TELEGRAM" };
        const channel = url.searchParams.get("channel");
        if (!Object.hasOwn(types, channel)) throw channelSetupError(400, "CHANNEL_INVALID_INPUT", "Select a supported channel category.");
        const configuration = channel === "email" ? await new EmailConnectionRepository(db).settings(authContext.organization_id)
          : await services.settingsRepository.getCategory(authContext.organization_id, "channel_" + channel);
        // Public setup never inherits the synthetic adapter test profile.
        const capability = await assessCurrentChannelCapability(db,{organization_id:authContext.organization_id,action_type:types[channel],strict:true});
        const provider = configuration.provider || "sandbox";
        sendJson(response, 200, { channel, provider,
          configured: capability.configuration_complete, status: provider === "sandbox" ? "sandbox"
            : !capability.implementation_supported ? "unsupported" : capability.verification==="VERIFIED" ? "verified" : capability.configuration_complete ? "configured_unverified" : "unconfigured",
          capability, provider_calls: 0, verification: capability.verification==="VERIFIED"?"VERIFIED":"NOT_VERIFIED"
        }); return;
      }

      if (route === "GET /api/ai/controls") {
        sendJson(response, 200, await services.aiInvocationService.getControls({
          organization_id: url.searchParams.get("organization_id"),
          ...(url.searchParams.has("before_revision") ? { before_revision: optionalIntegerQuery(url, "before_revision") } : {}),
          ...(url.searchParams.has("limit") ? { limit: optionalIntegerQuery(url, "limit") } : {})
        }));
        return;
      }
      if (route === "PUT /api/ai/controls") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.aiInvocationService.updateControls({
          organization_id: body.organization_id, actor: { id: authContext.user.id, role: authContext.user.role },
          expected_revision: body.expected_revision, reason: body.reason, paused: body.paused,
          max_daily_attempts: body.max_daily_attempts, max_in_flight: body.max_in_flight, pricing: body.pricing
        }));
        return;
      }
      if (route === "GET /api/ai/usage") {
        sendJson(response, 200, await services.aiInvocationService.usage({
          organization_id: url.searchParams.get("organization_id"),
          ...(url.searchParams.has("before_attempt_id") ? { before_attempt_id: url.searchParams.get("before_attempt_id") } : {}),
          ...(url.searchParams.has("limit") ? { limit: optionalIntegerQuery(url, "limit") } : {})
        }));
        return;
      }

      if (route === "POST /api/intelligence/jobs") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const result = await services.analysisJobsService.enqueue({
          organization_id: body.organization_id, request_key: body.request_key,
          lead_ids: body.lead_ids, mode: body.mode ?? "ANALYSIS_ONLY", target_stage: body.target_stage ?? "PLAN",
          actor: { id: authContext.user.id, role: authContext.user.role }
        });
        sendJson(response, 202, result);
        return;
      }

      if (route === "GET /api/intelligence/jobs") {
        const organization_id = url.searchParams.get("organization_id");
        const number = key => optionalIntegerQuery(url, key);
        sendJson(response, 200, await services.analysisJobsService.list({
          organization_id, lead_id: url.searchParams.get("lead_id") || undefined,
          request_key: url.searchParams.get("request_key") || undefined, limit: number("limit"), offset: number("offset")
        }));
        return;
      }

      const analysisJobMatch = url.pathname.match(/^\/api\/intelligence\/jobs\/([^/]+)(?:\/(cancel|retry))?$/);
      if (analysisJobMatch && request.method === "GET" && !analysisJobMatch[2]) {
        sendJson(response, 200, await services.analysisJobsService.get({
          organization_id: url.searchParams.get("organization_id"), job_id: analysisJobMatch[1]
        }));
        return;
      }
      if (analysisJobMatch && request.method === "POST" && analysisJobMatch[2]) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        const command = { organization_id: body.organization_id, job_id: analysisJobMatch[1],
          expected_revision: body.expected_revision, reason: body.reason, actor: { id: authContext.user.id, role: authContext.user.role } };
        sendJson(response, 200, await services.analysisJobsService[analysisJobMatch[2]](command));
        return;
      }

      if (route === "GET /api/intelligence/summary") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, await readIntelligenceSummary(db, organizationId, { after_lead_id: url.searchParams.get("after_lead_id") }));
        return;
      }

      if (route === "POST /api/intelligence/bulk-run") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const organizationId = body.organization_id;

        if (body.lead_ids !== undefined && (!Array.isArray(body.lead_ids) || body.lead_ids.length > 1000 ||
            body.lead_ids.some(id => typeof id !== "string" || !id.trim() || id.length > 200))) {
          throw Object.assign(new Error("Select at most 1000 valid lead IDs."), { statusCode: 400, code: "validation_failed" });
        }
        let leadIds = body.lead_ids === undefined ? null : [...new Set(body.lead_ids)];
        if (!leadIds) {
          leadIds = await collectEligibleLeadIds(services, organizationId);
        }

        const BATCH_CAP = 50;
        const batch = leadIds.slice(0, BATCH_CAP);
        const outcomes = new Map(), beforeByLead = new Map(), validIds = [];
        for (const leadId of batch) {
          try {
            const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, leadId, organizationId));
            beforeByLead.set(leadId, await readIntelligenceView(db, lead));
            validIds.push(leadId);
          } catch (error) { outcomes.set(leadId, { lead_id: leadId, status: "FAILED", reused: false, ...analysisFailure(error) }); }
        }
        let analysisJob = null;
        if (validIds.length) {
          try {
            const accepted = await services.analysisJobsService.enqueue({
              organization_id: organizationId, request_key: body.request_key ?? ("legacy-bulk:" + randomUUID()),
              lead_ids: validIds, mode: "PREPARE_DRAFTS", target_stage: "PLAN", actor: { id: authContext.user.id, role: authContext.user.role }
            });
            analysisJob = accepted.job;
            await services.analysisJobsService.processOnce({ organization_id: organizationId, job_id: analysisJob.id });
            for (const leadId of validIds) {
              try {
                const { item } = await services.analysisJobsService.compatibilityResult({
                  organization_id: organizationId, job_id: analysisJob.id, lead_id: leadId
                });
                const lead = await hydrateLeadProvenance(services, await getLeadForOrganizationOrThrow(services, leadId, organizationId));
                const current = await readIntelligenceView(db, lead), before = beforeByLead.get(leadId);
                if (current.currentness.state !== "CURRENT" ||
                    item.artifacts.snapshot_id !== current.snapshot?.id || item.artifacts.synthesis_id !== current.synthesis?.id ||
                    item.artifacts.recommendation_id !== current.recommendation?.id || item.artifacts.plan_id !== current.next_best_action?.id) {
                  throw Object.assign(new Error("Saved inputs changed during analysis."), { code: "INTELLIGENCE_CONTEXT_CHANGED", statusCode: 409 });
                }
                outcomes.set(leadId, {
                  lead_id: leadId, status: "COMPLETED",
                  reused: before.snapshot?.id === current.snapshot?.id && before.recommendation?.id === current.recommendation?.id && before.next_best_action?.id === current.next_best_action?.id,
                  currentness: current.currentness, recommendation_step: current.recommendation?.recommendation?.step || null,
                  plan_status: current.next_best_action?.status || null, action_id: item.artifacts?.action_id || null
                });
              } catch (error) { outcomes.set(leadId, { lead_id: leadId, status: "FAILED", reused: false, ...analysisFailure(error) }); }
            }
          } catch (error) {
            for (const leadId of validIds) outcomes.set(leadId, { lead_id: leadId, status: "FAILED", reused: false, ...analysisFailure(error) });
          }
        }
        const results = batch.map(id => outcomes.get(id));

        sendJson(response, 200, {
          organization_id: organizationId,
          job_id: analysisJob?.id || null,
          selection_scope: body.lead_ids === undefined ? "FIRST_100_ACTIVE_LEADS" : "EXPLICIT_SELECTION",
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
                 a.created_at, a.updated_at, a.next_attempt_at, a.retry_deadline_at, a.scheduled_at,
                 a.execution_hold_reason, a.max_attempts,
                 e.outcome_class AS execution_outcome, e.attempt AS execution_attempt,
                 l.name AS lead_name, l.email AS lead_email, l.company AS lead_company
          FROM actions a
          JOIN leads l ON a.lead_id = l.id
          LEFT JOIN action_executions e ON e.id = a.active_execution_id AND e.action_id = a.id
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
          next_attempt_at: a.next_attempt_at, retry_deadline_at: a.retry_deadline_at, scheduled_at: a.scheduled_at,
          execution_hold_reason: a.execution_hold_reason, max_attempts: a.max_attempts,
          execution_outcome: a.execution_outcome, execution_attempt: a.execution_attempt,
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
          JOIN leads l ON f.lead_id = l.id AND f.organization_id = l.organization_id
          WHERE f.organization_id = ?
          ORDER BY
            CASE f.status
              WHEN 'BLOCKED' THEN 0
              WHEN 'DUE' THEN 1
              WHEN 'PLANNED' THEN 2
              WHEN 'COMPLETED' THEN 3
              WHEN 'CANCELLED' THEN 4
              ELSE 5
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
          FROM leads WHERE organization_id = ? AND archived_at IS NULL
        `, [since7d, since30d, organizationId]);

        const archivedLeads = await db.get("SELECT COUNT(*) AS count FROM leads WHERE organization_id = ? AND archived_at IS NOT NULL", [organizationId]);
        leadStats.archived_count = Number(archivedLeads.count);

        const sourceBreakdown = await db.all(`
          SELECT source, COUNT(*) AS count
          FROM leads WHERE organization_id = ? AND archived_at IS NULL
          GROUP BY source ORDER BY count DESC
        `, [organizationId]);

        const statusBreakdown = await db.all(`
          SELECT status, COUNT(*) AS count
          FROM leads WHERE organization_id = ? AND archived_at IS NULL
          GROUP BY status ORDER BY count DESC
        `, [organizationId]);

        const pendingApprovals = await db.get(`
          SELECT COUNT(*) AS count FROM action_approvals ap
          JOIN leads l ON l.id=ap.lead_id AND l.organization_id=ap.organization_id
          WHERE ap.organization_id = ? AND ap.status = 'PENDING' AND l.archived_at IS NULL
        `, [organizationId]);

        const followUpsDue = await db.get(`
          SELECT COUNT(*) AS count FROM follow_up_tasks f
          JOIN leads l ON l.id=f.lead_id AND l.organization_id=f.organization_id
          WHERE f.organization_id = ? AND f.status = 'DUE' AND l.archived_at IS NULL
        `, [organizationId]);

        const recentLeads = await db.all(`
          SELECT id, name, email, phone, company, source, status, created_at
          FROM leads WHERE organization_id = ? AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 10
        `, [organizationId]);

        const dailyLeads = await db.all(`
          SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
          FROM leads WHERE organization_id = ? AND archived_at IS NULL
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
          business_outcomes: await loadOutcomeMetrics(db, {organization_id:organizationId}),
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
            l.*,
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
          WHERE l.organization_id = ? AND l.archived_at IS NULL AND l.status NOT IN ('OPTED_OUT', 'CONVERTED')
        `, [organizationId]);

        const items = [];
        for (const row of rows) {
          const currentSnapshot = await services.intelligenceService.assessLead(row);
          const currentRecommendation = await services.intelligenceRecommendationService.currentForLead(row);
          row.latest_snapshot_status = currentSnapshot.snapshot?.status || null;
          row.latest_recommendation_status = currentRecommendation.intelligence_recommendation?.status || null;
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const organization = await services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        const source = optionalText(body.source) || "MANUAL";
        requireNoValidationErrors(
          validateLeadInput({
            name: body.name,
            email: body.email,
            phone: body.phone,
            company: body.company,
            source
          })
        );

        const normalizedEmail = normalizeEmail(optionalText(body.email));
        const normalizedPhone = normalizePhone(optionalText(body.phone), "INTERNATIONAL_ONLY");
        if (!normalizedPhone.valid) {
          throw httpError(400, normalizedPhone.message);
        }
        const lead = await services.contactPolicyService.withWorkspacePolicyTransaction(body.organization_id, async (tx) => {
          if (!await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [body.organization_id, authContext.user.id])) throw httpError(403, "Workspace owner access is required.");
          const lead = await new LeadsRepository(tx).createLead({
            organization_id: body.organization_id,
            name: body.name.trim(),
            email: optionalText(body.email),
            phone: optionalText(body.phone),
            normalized_email: normalizedEmail.value,
            normalized_phone: normalizedPhone.normalized_phone,
            company: optionalText(body.company),
            source
          });
          await new EventsRepository(tx).publish({
            organization_id: lead.organization_id,
            lead_id: lead.id,
            type: "LeadCreated",
            payload: { lead_id: lead.id, source: lead.source }
          });
          await new AuditRepository(tx).record({
            organization_id: lead.organization_id,
            lead_id: lead.id,
            event_type: "LeadCreated",
            message: "Lead persisted and LeadCreated event published.",
            metadata: { source: lead.source }
          });
          return lead;
        });
        sendJson(response, 201, { lead });
        return;
      }


      if (route === "GET /api/leads/directory") {
        sendJson(response, 200, await services.leadDataService.directory({
          organization_id: authContext.organization_id,
          search: url.searchParams.get("search") ?? undefined,
          source: url.searchParams.get("source") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          archive: url.searchParams.get("archive") ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined
        }));
        return;
      }

      if (route === "POST /api/leads/export") {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertDataCommand(body, ["lead_ids"]);
        const exported = await services.leadExportService.exportSelected({
          organization_id: authContext.organization_id, lead_ids: body.lead_ids,
          actor: { id: authContext.user.id, role: authContext.user.role }
        });
        if (response.destroyed || response.writableEnded) return;
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="leads-export.csv"',
          "content-length": Buffer.byteLength(exported.csv_text, "utf8"),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-export-record-count": String(exported.row_count)
        });
        response.end(exported.csv_text);
        return;
      }

      const leadDataMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/data$/);
      if (request.method === "GET" && leadDataMatch) {
        sendJson(response, 200, await services.leadDataService.get({
          organization_id: authContext.organization_id, lead_id: leadDataMatch[1],
          before_revision: url.searchParams.get("before_revision") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined
        }));
        return;
      }
      const leadDataPreviewMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/data\/preview$/);
      if (request.method === "POST" && leadDataPreviewMatch) {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertDataCommand(body, ["expected_revision", "values", "default_phone_region"]);
        sendJson(response, 200, await services.leadDataService.preview({
          organization_id: authContext.organization_id, lead_id: leadDataPreviewMatch[1],
          expected_revision: body.expected_revision, values: body.values,
          default_phone_region: body.default_phone_region,
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }
      if (request.method === "PUT" && leadDataMatch) {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertDataCommand(body, ["expected_revision", "values", "default_phone_region", "review_token", "reason"]);
        sendJson(response, 200, await services.leadDataService.update({
          organization_id: authContext.organization_id, lead_id: leadDataMatch[1],
          expected_revision: body.expected_revision, values: body.values,
          default_phone_region: body.default_phone_region, review_token: body.review_token, reason: body.reason,
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }
      const leadArchiveMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/archive$/);
      if (request.method === "POST" && leadArchiveMatch) {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertDataCommand(body, ["expected_revision", "archived", "reason"]);
        sendJson(response, 200, await services.leadDataService.setArchived({
          organization_id: authContext.organization_id, lead_id: leadArchiveMatch[1],
          expected_revision: body.expected_revision, archived: body.archived, reason: body.reason,
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }

      if (route === "GET /api/leads") {
        const organizationId = url.searchParams.get("organization_id");
        requireText(organizationId, "organization_id");
        sendJson(response, 200, {
          leads: await services.leadsRepository.listLeads(organizationId, {
            search: optionalText(url.searchParams.get("search")),
            source: optionalText(url.searchParams.get("source")),
            status: optionalText(url.searchParams.get("status")),
            archive: url.searchParams.get("archive") ?? undefined
          })
        });
        return;
      }

      if (route === "POST /api/imports/csv/inspect") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertImportCommand(body, ["filename", "csv_text"]);
        requireText(body.filename, "filename");
        if (body.filename.trim().length > 200 || /[\u0000-\u001f\u007f]/u.test(body.filename)) throw httpError(400, "filename must be at most 200 characters without control characters.");
        sendJson(response, 200, inspectCsv(body.csv_text));
        return;
      }

      if (route === "POST /api/imports/csv/preview") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const organization = await services.leadsRepository.getOrganization(body.organization_id);
        if (!organization) {
          throw httpError(404, "Organization not found.");
        }
        assertImportCommand(body, ["filename", "csv_text", "default_phone_region", "mapping", "options"]);
        const preview = await services.importsService.previewCsv({
          organization_id: body.organization_id,
          filename: body.filename,
          csv_text: body.csv_text,
          default_phone_region: body.default_phone_region,
          ...(Object.hasOwn(body, "mapping") ? { mapping: body.mapping } : {}),
          ...(Object.hasOwn(body, "options") ? { options: body.options } : {}),
          actor: { id: authContext.user.id, role: authContext.user.role }
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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

      // The token resolves the workspace; verify provider signatures over original bytes.
      const sendgridInboundMatch = url.pathname.match(/^\/api\/webhooks\/sendgrid\/inbound\/([^/]+)$/);
      if (request.method === "POST" && sendgridInboundMatch) {
        const organizationId = await services.emailConnectionService.resolveWebhookToken(sendgridInboundMatch[1]);
        if (!organizationId) {
          throw httpError(404, "Unknown webhook token.");
        }
        const rawBody = await readBoundedWebhookBody(request, 5 * 1024 * 1024);
        const emailSettings = await new EmailConnectionRepository(db).settings(organizationId);
        verifySendgridWebhook({ headers: request.headers, rawBody,
          publicKey: emailSettings.sendgrid_inbound_public_key, allowUnsignedTest: testControlsEnabled });
        const contentType = request.headers["content-type"] || "";
        const fields = parseMultipartFormData(rawBody, contentType);
        const input = normalizeSendgridInbound(fields, { organization_id: organizationId });
        const result = await durableWebhookOperation(() => services.webhookInbox.receiveAndProcess({
          organization_id: organizationId, provider: "sendgrid", connection_key: "channel_email",
          event_kind: "INBOUND_MESSAGE", provider_event_id: input.provider_event_id,
          verification_kind: testControlsEnabled && !emailSettings.sendgrid_inbound_public_key ? "LOCAL_TEST" : "SIGNED_PROVIDER",
          input
        }, { throwOnProcessingError: false, onInsertedInTransaction:(tx,receipt)=>captureCurrentSignedReceipt(tx,{receipt,configuration:emailSettings,route_token:sendgridInboundMatch[1],input}) }));
        sendJson(response, 202, { duplicate: result.duplicate, receipt_id: result.receipt.id, processing_state: result.receipt.processing_state });
        return;
      }

      // SendGrid's Event Webhook — delivery/bounce/open/click notifications for a previously
      // sent email. Maps back to our action via custom_args (set at send time in emailAdapter.js),
      // Routing tokens resolve tenant scope; signatures authenticate provider requests.
      const sendgridEventsMatch = url.pathname.match(/^\/api\/webhooks\/sendgrid\/events\/([^/]+)$/);
      if (request.method === "POST" && sendgridEventsMatch) {
        const organizationId = await services.emailConnectionService.resolveWebhookToken(sendgridEventsMatch[1]);
        if (!organizationId) {
          throw httpError(404, "Unknown webhook token.");
        }
        const rawBody = await readBoundedWebhookBody(request, 1024 * 1024);
        const emailSettings = await new EmailConnectionRepository(db).settings(organizationId);
        verifySendgridWebhook({ headers: request.headers, rawBody,
          publicKey: emailSettings.sendgrid_events_public_key, allowUnsignedTest: testControlsEnabled });
        let events;
        try { events = JSON.parse(rawBody.toString("utf8")); } catch { throw httpError(400, "Webhook body must be valid JSON."); }
        if (!Array.isArray(events) || events.length > 1000) throw httpError(400, "Webhook body must be an array with at most 1000 events.");
        const receipts = [];
        // Receive the complete batch before attempting projections. A storage failure
        // leaves prior item identities reusable when the provider redelivers.
        for (const event of events) {
          const normalized = normalizeSendgridEventReceipt(event);
          const received = await durableWebhookOperation(() => services.webhookInbox.receive({
            organization_id: organizationId, provider: "sendgrid", connection_key: "channel_email",
            event_kind: "SENDGRID_EVENT", provider_event_id: normalized.provider_event_id,
            verification_kind: testControlsEnabled && !emailSettings.sendgrid_events_public_key ? "LOCAL_TEST" : "SIGNED_PROVIDER",
            input: normalized.payload
          }, { onInsertedInTransaction:(tx,receipt)=>captureCurrentSignedReceipt(tx,{receipt,configuration:emailSettings,route_token:sendgridEventsMatch[1],input:normalized.payload}) }));
          receipts.push(received);
        }
        const results = [];
        for (const item of receipts) {
          const processed = await services.webhookInbox.processReceipt({ organization_id: organizationId, receipt_id: item.row.id });
          results.push({ ok: processed.receipt.processing_state === "PROCESSED", receipt_id: processed.receipt.id,
            processing_state: processed.receipt.processing_state, duplicate: item.duplicate,
            ...(processed.result || {}) });
        }
        sendJson(response, 200, { received: receipts.length, processed: results.filter((item) => item.processing_state === "PROCESSED").length, results });
        return;
      }

      if (route === "GET /api/business-profile") {
        sendJson(response, 200, await services.businessContextService.getProfile({ organization_id: authContext.organization_id }));
        return;
      }
      if (route === "GET /api/business-profile/history") {
        sendJson(response, 200, await services.businessContextService.profileHistory({ organization_id: authContext.organization_id, ...contextHistoryQuery(url) }));
        return;
      }
      if (route === "PUT /api/business-profile") {
        const body = await readJson(request);
        assertContextCommand(body, "profile");
        sendJson(response, 200, await services.businessContextService.updateProfile({ ...body, organization_id: authContext.organization_id,
          actor: { id: authContext.user.id, role: authContext.user.role } }));
        return;
      }
      const enquiryContextRoute = url.pathname.match(/^\/api\/leads\/([^/]+)\/enquiry-context(\/history)?$/);
      if (enquiryContextRoute && request.method === "GET") {
        const input = { organization_id: authContext.organization_id, lead_id: enquiryContextRoute[1] };
        sendJson(response, 200, enquiryContextRoute[2]
          ? await services.businessContextService.enquiryHistory({ ...input, ...contextHistoryQuery(url) })
          : await services.businessContextService.getEnquiry(input));
        return;
      }
      if (enquiryContextRoute && !enquiryContextRoute[2] && request.method === "PUT") {
        const body = await readJson(request);
        assertContextCommand(body, "enquiry");
        sendJson(response, 200, await services.businessContextService.updateEnquiry({ ...body,
          organization_id: authContext.organization_id, lead_id: enquiryContextRoute[1],
          actor: { id: authContext.user.id, role: authContext.user.role } }));
        return;
      }

      if (route === "GET /api/dispatch-controls") {
        requireOwner(authContext);
        sendJson(response, 200, await services.dispatchControlsService.inspect({ organization_id: authContext.organization_id }));
        return;
      }
      if (route === "PUT /api/dispatch-controls") {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.dispatchControlsService.update({ organization_id: authContext.organization_id,
          expected_revision: body.expected_revision, paused: body.paused, daily_attempt_limit: body.daily_attempt_limit,
          unresolved_limit: body.unresolved_limit, reason: body.reason, actor: authContext.user.id }));
        return;
      }

      if (route === "GET /api/domain-events") {
        requireOwner(authContext);
        sendJson(response, 200, await services.domainEventProcessor.list({
          organization_id: authContext.organization_id, state: url.searchParams.get("state") || "ACTIVE",
          limit: Number(url.searchParams.get("limit") || 25), offset: Number(url.searchParams.get("offset") || 0)
        }));
        return;
      }
      const domainEventMatch = url.pathname.match(/^\/api\/domain-events\/([^/]+)(?:\/(review))?$/);
      if (domainEventMatch && request.method === "GET" && !domainEventMatch[2]) {
        requireOwner(authContext);
        sendJson(response, 200, await services.domainEventProcessor.inspect({ organization_id: authContext.organization_id, event_id: domainEventMatch[1] }));
        return;
      }
      if (domainEventMatch && request.method === "POST" && domainEventMatch[2] === "review") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.domainEventProcessor.review({
          organization_id: authContext.organization_id, event_id: domainEventMatch[1], expected_fence: body.expected_fence,
          decision: body.decision, evidence_note: body.evidence_note, reviewer_user_id: authContext.user.id
        }));
        return;
      }

      if (route === "GET /api/webhook-receipts") {
        requireOwner(authContext);
        sendJson(response, 200, await services.webhookInbox.list({
          organization_id: authContext.organization_id, state: url.searchParams.get("state") || "ACTIVE",
          limit: Number(url.searchParams.get("limit") || 25), offset: Number(url.searchParams.get("offset") || 0)
        }));
        return;
      }
      const receiptMatch = url.pathname.match(/^\/api\/webhook-receipts\/([^/]+)(?:\/(review))?$/);
      if (receiptMatch && request.method === "GET" && !receiptMatch[2]) {
        requireOwner(authContext);
        sendJson(response, 200, await services.webhookInbox.inspect({ organization_id: authContext.organization_id, receipt_id: receiptMatch[1] }));
        return;
      }
      if (receiptMatch && request.method === "POST" && receiptMatch[2] === "review") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.webhookInbox.review({ organization_id: authContext.organization_id, receipt_id: receiptMatch[1],
          reviewer_user_id: authContext.user.id, expected_fence: body.expected_fence, decision: body.decision, evidence_note: body.evidence_note }));
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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

      const workflowControlMatch = url.pathname.match(/^\/api\/workflow-runs\/([^/]+)\/control$/);
      if (request.method === "POST" && workflowControlMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.workflowsService.controlRun({
          organization_id: authContext.organization_id, run_id: workflowControlMatch[1],
          expected_revision: body.expected_revision, command: body.command, reason: body.reason, actor: authContext.user.id
        }));
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: organizationId,
          ...await readIntelligenceView(db, lead, { comparison: true })
        });
        return;
      }

      const leadIntelligenceRunMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/intelligence\/run$/);
      if (request.method === "POST" && leadIntelligenceRunMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadIntelligenceRunMatch[1], body.organization_id)
        );
        const { artifact: intelligence, job_id } = await runTrackedStage(services, lead, body, authContext, "SNAPSHOT");
        const intelligenceContext = await services.intelligenceService.assessLead(lead);
        sendJson(response, 200, {
          lead_id: lead.id,
          organization_id: body.organization_id,
          ...intelligenceContext,
          job_id,
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadSynthesisRunMatch[1], body.organization_id)
        );
        try {
          const { artifact: synthesis, job_id } = await runTrackedStage(services, lead, body, authContext, "SYNTHESIS");
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            synthesis, job_id
          });
        } catch (error) {
          if (error.code === "INTELLIGENCE_CONTEXT_CHANGED") throw error;
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, leadRecommendationRunMatch[1], body.organization_id)
        );
        try {
          const { artifact: intelligenceRecommendation, job_id } = await runTrackedStage(services, lead, body, authContext, "RECOMMENDATION");
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            job_id, intelligence_recommendation: intelligenceRecommendation
          });
        } catch (error) {
          if (error.code === "INTELLIGENCE_CONTEXT_CHANGED") throw error;
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const lead = await hydrateLeadProvenance(
          services,
          await getLeadForOrganizationOrThrow(services, nextBestActionPlanMatch[1], body.organization_id)
        );
        try {
          const { artifact: nextBestActionPlan, job_id } = await runTrackedStage(services, lead, body, authContext, "PLAN");
          sendJson(response, 200, {
            lead_id: lead.id,
            organization_id: body.organization_id,
            job_id, next_best_action_plan: nextBestActionPlan
          });
        } catch (error) {
          if (error.code === "INTELLIGENCE_CONTEXT_CHANGED") throw error;
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        sendJson(
          response,
          201,
          await services.workflowsService.enrollLeads({
            organization_id: body.organization_id,
            sequence_id: sequenceEnrollMatch[1],
            scheduled_at: body.scheduled_at,
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

      const identityReviewMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/rows\/([^/]+)\/identity-review$/);
      if (request.method === "GET" && identityReviewMatch) {
        requireOwner(authContext);
        sendJson(response, 200, await services.importIdentityService.review({
          organization_id: authContext.organization_id, import_id: identityReviewMatch[1], import_row_id: identityReviewMatch[2],
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }
      const identityResolutionMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/rows\/([^/]+)\/identity-resolution$/);
      if (request.method === "POST" && identityResolutionMatch) {
        requireOwner(authContext);
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertImportCommand(body, ["review_token", "decision", "classification", "target_lead_id", "reason"]);
        sendJson(response, 200, await services.importIdentityService.resolve({
          organization_id: authContext.organization_id, import_id: identityResolutionMatch[1], import_row_id: identityResolutionMatch[2],
          review_token: body.review_token, decision: body.decision, classification: body.classification,
          target_lead_id: body.target_lead_id, reason: body.reason,
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }
      const leadImportSourcesMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/import-sources$/);
      if (request.method === "GET" && leadImportSourcesMatch) {
        sendJson(response, 200, await services.importIdentityService.listSources({
          organization_id: authContext.organization_id, lead_id: leadImportSourcesMatch[1]
        }));
        return;
      }

      const importCorrectionMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/rows\/([^/]+)$/);
      if (request.method === "PUT" && importCorrectionMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        assertImportCommand(body, ["expected_revision", "values", "reason"]);
        sendJson(response, 200, await services.importsService.correctRow({
          organization_id: authContext.organization_id, import_id: importCorrectionMatch[1], import_row_id: importCorrectionMatch[2],
          expected_revision: body.expected_revision, values: body.values, reason: body.reason,
          actor: { id: authContext.user.id, role: authContext.user.role }
        }));
        return;
      }

      const importCommitMatch = url.pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
      if (request.method === "POST" && importCommitMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        assertImportCommand(body, ["selected_row_ids", "expected_revision", ...(testControlsEnabled ? ["simulate_failure_after_rows"] : [])]);
        const result = await services.importsService.commitImport({
          import_id: importCommitMatch[1],
          organization_id: body.organization_id,
          selected_row_ids: body.selected_row_ids,
          ...(Object.hasOwn(body, "expected_revision") ? { expected_revision: body.expected_revision } : {}),
          actor: { id: authContext.user.id, role: authContext.user.role },
          simulate_failure_after_rows: optionalNumber(body.simulate_failure_after_rows)
        });
        sendJson(response, 200, result);
        return;
      }

      const planActionMatch = url.pathname.match(/^\/api\/next-best-action-plans\/([^/]+)\/action$/);
      if (request.method === "POST" && planActionMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const action = await services.outboundAutomationService.createActionFromPlan({
          organization_id: body.organization_id,
          plan_id: planActionMatch[1]
        });
        sendJson(response, 201, { action });
        return;
      }

      if (route === "GET /api/outbound/recovery") {
        requireOwner(authContext);
        sendJson(response, 200, await services.dispatchRecoveryService.listForOrganization({
          organization_id: authContext.organization_id, limit: Number(url.searchParams.get("limit") || 50)
        }));
        return;
      }
      const recoveryMatch = url.pathname.match(new RegExp("^/api/actions/([^/]+)/recovery$"));
      if (request.method === "GET" && recoveryMatch) {
        requireOwner(authContext);
        sendJson(response, 200, await services.dispatchRecoveryService.inspectAction({
          organization_id: authContext.organization_id, action_id: recoveryMatch[1]
        }));
        return;
      }
      const recoveryResolveMatch = url.pathname.match(new RegExp("^/api/actions/([^/]+)/recovery/resolve$"));
      if (request.method === "POST" && recoveryResolveMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.dispatchRecoveryService.resolve({
          organization_id: authContext.organization_id, action_id: recoveryResolveMatch[1],
          expected_execution_id: body.expected_execution_id, expected_fence: body.expected_fence,
          decision: body.decision, evidence_note: body.evidence_note, provider_reference: body.provider_reference,
          reviewer_user_id: authContext.user.id
        }));
        return;
      }

      const executeActionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/execute$/);
      if (request.method === "POST" && executeActionMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const result = await services.outboundAutomationService.executeAction({
          organization_id: body.organization_id,
          action_id: executeActionMatch[1]
        });
        sendJson(response, 202, result);
        return;
      }

      if (route === "POST /api/actions/bulk-approve") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        if (!Array.isArray(body.revisions) || body.revisions.length === 0) {
          throw httpError(400, "revisions must contain displayed action_id and expected_revision_id pairs.");
        }
        const results = [];
        for (const revision of body.revisions.slice(0, 100)) {
          const actionId = revision?.action_id;
          try {
            const result = await services.approvalsService.approveAction({
              organization_id: body.organization_id,
              action_id: actionId,
              expected_revision_id: revision?.expected_revision_id,
              ...reviewerIdentity(authContext, body),
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        if (!Array.isArray(body.revisions) || body.revisions.length === 0) {
          throw httpError(400, "revisions must contain displayed action_id and expected_revision_id pairs.");
        }
        const results = [];
        for (const revision of body.revisions.slice(0, 100)) {
          const actionId = revision?.action_id;
          try {
            const result = await services.approvalsService.rejectAction({
              organization_id: body.organization_id,
              action_id: actionId,
              expected_revision_id: revision?.expected_revision_id,
              ...reviewerIdentity(authContext, body),
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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
          executed: results.filter((r) => r.ok && r.result.execution_result.dispatched).length,
          deferred: results.filter((r) => r.ok && r.result.execution_result.deferred).length,
          held: results.filter((r) => r.ok && !r.result.execution_result.dispatched && !r.result.execution_result.deferred).length,
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const result = await services.approvalsService.approveAction({
          organization_id: body.organization_id,
          action_id: actionApprovalApproveMatch[1],
          ...reviewerIdentity(authContext, body),
          reviewer_note: body.reviewer_note ?? null,
          expected_revision_id: body.expected_revision_id,
          edited_payload: body.edited_payload || null
        });
        sendJson(response, 200, result);
        return;
      }

      const actionApprovalPreviewMatch = url.pathname.match(new RegExp("^/api/actions/([^/]+)/approval/preview$"));
      if (request.method === "POST" && actionApprovalPreviewMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.approvalsService.previewAction({
          organization_id: authContext.organization_id, action_id: actionApprovalPreviewMatch[1],
          expected_revision_id: body.expected_revision_id, edited_payload: body.edited_payload || {}
        }));
        return;
      }
      const actionApprovalRevokeMatch = url.pathname.match(new RegExp("^/api/actions/([^/]+)/approval/revoke$"));
      if (request.method === "POST" && actionApprovalRevokeMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        sendJson(response, 200, await services.approvalsService.revokeAction({
          organization_id: authContext.organization_id, action_id: actionApprovalRevokeMatch[1],
          expected_revision_id: body.expected_revision_id, ...reviewerIdentity(authContext, body),
          reviewer_note: body.reviewer_note ?? null
        }));
        return;
      }
      if (request.method === "POST" && new RegExp("^/api/actions/[^/]+/approval/edit-and-approve$").test(url.pathname)) {
        throw httpError(409, "Preview the edited revision, then approve its displayed revision token.");
      }

      const actionApprovalRejectMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/approval\/reject$/);
      if (request.method === "POST" && actionApprovalRejectMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const result = await services.approvalsService.rejectAction({
          organization_id: body.organization_id,
          action_id: actionApprovalRejectMatch[1],
          ...reviewerIdentity(authContext, body),
          reviewer_note: body.reviewer_note ?? null,
          expected_revision_id: body.expected_revision_id
        });
        sendJson(response, 200, result);
        return;
      }

      const actionCallbackMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/callback$/);
      if (request.method === "POST" && actionCallbackMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        requireText(body.provider_event_id, "provider_event_id");
        const action = await services.actionsRepository.getActionForOrganization(actionCallbackMatch[1], body.organization_id);
        if (!action) {
          throw httpError(404, "Action not found.");
        }
        const result = await services.callbacksService.receiveExecutionCallback({
          organization_id: authContext.organization_id,
          action_id: action.id,
          ...await syntheticCallbackIdentity(services, action, body),
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
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

      const contactPolicyMatch = url.pathname.match(new RegExp("^/api/leads/([^/]+)/contact-policy$"));
      if (request.method === "GET" && contactPolicyMatch) {
        const lead = await getLeadForOrganizationOrThrow(services, contactPolicyMatch[1], authContext.organization_id);
        sendJson(response, 200, await services.contactPolicyService.inspectLead({
          organization_id: authContext.organization_id, lead_id: lead.id,
          channel: optionalText(url.searchParams.get("channel")) || "ALL"
        }));
        return;
      }
      const contactRestrictionMatch = url.pathname.match(new RegExp("^/api/leads/([^/]+)/contact-restrictions$"));
      if (request.method === "POST" && contactRestrictionMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        if (!["OPT_OUT", "SUPPRESSED"].includes(body.reason)) throw httpError(400, "reason must be OPT_OUT or SUPPRESSED.");
        requireText(body.idempotency_key, "idempotency_key");
        sendJson(response, 200, await services.contactPolicyService.restrictLead({
          organization_id: authContext.organization_id, lead_id: contactRestrictionMatch[1],
          channel: body.channel || "ALL", reason: body.reason, source: "MANUAL",
          source_event_id: body.idempotency_key, actor_id: authContext.user.id
        }));
        return;
      }

      const leadActionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/actions$/);
      if (request.method === "POST" && leadActionMatch) {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.organization_id, "organization_id");
        const lead = await getLeadForOrganizationOrThrow(services, leadActionMatch[1], body.organization_id);
        const type = optionalText(body.type) || "SEND_EMAIL";
        const mockBehavior = optionalText(body.mock_behavior) || "SUCCESS";
        requireNoValidationErrors(validateActionInput({ type, mock_behavior: mockBehavior }));
        if (type.startsWith("SEND_") && !testControlsEnabled) {
          throw httpError(409, "Manual outreach requires the shared reviewed composer. Use a reviewed next-best-action plan.");
        }
        const action = await services.actionsService.createManualAction(lead, {
          type,
          mock_behavior: mockBehavior
        });
        sendJson(response, 201, { action: await services.outboundAutomationService.actionDetail(action) });
        return;
      }

      if (route === "POST /api/worker/run") {
        await readRequestBody(request, request.bodyPolicy);
        sendJson(response, 200, await services.worker.runOnce({ organization_id: authContext.organization_id }));
        return;
      }

      if (route === "POST /api/callbacks/mock") {
        const body = await readAuthorizedJson(request, authContext, { testControlsEnabled });
        requireText(body.action_id, "action_id");
        requireText(body.provider_event_id, "provider_event_id");
        const action = await services.actionsRepository.getActionForOrganization(body.action_id, authContext.organization_id);
        if (!action) throw httpError(404, "Action not found.");
        const result = await services.callbacksService.receiveExecutionCallback({
          organization_id: authContext.organization_id,
          action_id: action.id,
          ...await syntheticCallbackIdentity(services, action, body),
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

      await serveStatic(request, response, publicDir, { publicOrigin: config.security.publicAppOrigin });
    } catch (error) {
      if (!request.readableEnded) {
        if (!response.headersSent) {
          response.shouldKeepAlive = false;
          response.setHeader("connection", "close");
        }
        const ignoreCloseError = () => {};
        request.once("error", ignoreCloseError);
        request.once("close", () => request.off("error", ignoreCloseError));
        const abandon = () => { if (!request.readableEnded && !request.destroyed) request.destroy(); };
        response.once("finish", abandon);
        response.once("close", abandon);
        if (response.destroyed || response.writableEnded) abandon();
      }
      sendError(response, error, { logger: requestLogger, requestId });
    } finally {
      handlerDone = true;
      releaseIfDone();
      pendingRequests.delete(completion);
      completeRequest();
      requestLogger.debug("http.request_completed", {
        method: request.method,
        path: requestPath,
        status: response.statusCode,
        duration_ms: Date.now() - startedAt
      });
    }
  });

  server.stopAcceptingRequests = () => { acceptingRequests = false; };
  server.drainRequests = async () => { while (pendingRequests.size) await Promise.all([...pendingRequests]); };
  server.services = services;
  server.httpPolicy = httpPolicy;
  return server;
}

function assertContextCommand(body, field) {
  if (Object.keys(body).some(key => !["expected_revision", "reason", field, ...(field === "profile" ? ["fit_criteria"] : [])].includes(key))) throw httpError(400, "Unexpected context command field.");
}
function optionalIntegerQuery(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw httpError(400, name + " must be a canonical integer within its supported limit.");
  return Number(value);
}
function contextHistoryQuery(url) {
  const parse = (name, maximum) => {
    const value = url.searchParams.get(name);
    if (value === null) return undefined;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
      throw httpError(400, name + " must be a positive integer within its supported limit.");
    return Number(value);
  };
  return { before_revision: parse("before_revision", 2147483647), limit: parse("limit", 50) };
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
 * The bounded first directory page inspected by the legacy bulk endpoint.
 *
 * Eligible means "does not already have a READY recommendation for its CURRENT
 * inputs". A lead always has an initial data-readiness snapshot from creation, so
 * the presence of a snapshot says nothing about whether analysis is needed; and
 * the check is fingerprint-aware, so a lead whose data changed since its last
 * recommendation becomes eligible again.
 *
 * The primary UI uses explicit durable job selections. This compatibility lookup
 * retains the same currentness definition as the first summary page — they cannot drift apart.
 */
async function collectEligibleLeadIds(services, organizationId) {
  return (await readIntelligenceSummary(services.intelligenceRepository.db, organizationId)).eligible_lead_ids;
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
async function readAuthorizedJson(request, authContext, { testControlsEnabled = false } = {}) {
  const body = await readJson(request);
  if (authContext) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw httpError(400, "Request body must be an object.");
    }
    if (!testControlsEnabled && Object.keys(body).some((key) => key.startsWith("simulate_") || key === "mock_behavior")) {
      throw httpError(403, "Simulation inputs are disabled.");
    }
    body.organization_id = authContext.organization_id;
  }
  return body;
}

function isTestControlRoute(route) {
  return new Set([
    "POST /api/callbacks/mock",
    "POST /api/inbound-events/mock",
    "POST /api/worker/run",
    "POST /api/workflows/run-due"
  ]).has(route) || /^POST \/api\/actions\/[^/]+\/callback$/.test(route);
}

function assertImportCommand(body, fields) {
  const allowed = new Set(["organization_id", ...fields]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw httpError(400, "Import command contains unsupported fields.");
}

function assertDataCommand(body, fields) {
  const allowed = new Set(["organization_id", ...fields]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw httpError(400, "Lead data command contains unsupported fields.");
}

function requireOwner(authContext) {
  if (authContext?.user?.role !== "OWNER") {
    throw httpError(403, "Workspace owner access is required.");
  }
}

function reviewerIdentity(authContext, body) {
  // Keep legacy input type validation, but never trust it as the actor identity.
  requireNoValidationErrors(validateApprovalDecisionInput({ reviewer_name: body.reviewer_name ?? null }));
  return {
    reviewer_name: authContext.user.name.trim().slice(0, 120),
    reviewer_user_id: authContext.user.id
  };
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

function requireNoValidationErrors(errors) {
  if (errors.length > 0) {
    throw httpError(400, errors.join(" "));
  }
}

async function syntheticCallbackIdentity(services, action, body) {
  // This helper is used only after the protected local test route verifies ownership.
  if (body.action_execution_id) return { action_execution_id: body.action_execution_id, revision_id: body.revision_id ?? null };
  const attempts = await services.executionsRepository.listForAction(action.id);
  if (attempts.length !== 1) throw httpError(400, "A synthetic callback must identify its exact action_execution_id.");
  return { action_execution_id: attempts[0].id, revision_id: body.revision_id ?? attempts[0].action_revision_id ?? null };
}

async function durableWebhookOperation(work) {
  try { return await work(); }
  catch (error) {
    if (error.statusCode >= 400 && error.statusCode < 500) throw error;
    throw httpError(503, "Webhook receipt could not be durably accepted. Retry this request.");
  }
}

async function runTrackedStage(services, lead, body, authContext, target_stage) {
  // Preserve prerequisite validation before accepting legacy single-stage intent.
  if (target_stage === "SYNTHESIS") await services.synthesisService.buildInput(lead);
  if (target_stage === "RECOMMENDATION") await services.intelligenceRecommendationService.buildInput(lead);
  if (target_stage === "PLAN") await services.nextBestActionService.buildInput(lead);
  const request_key = body.request_key ?? ("legacy-" + target_stage.toLowerCase() + ":" + randomUUID());
  const { job } = await services.analysisJobsService.enqueue({
    organization_id: lead.organization_id, request_key, lead_ids: [lead.id], mode: "ANALYSIS_ONLY",
    target_stage, execution_scope: "SINGLE_STAGE", simulate_failure_stage: optionalText(body.simulate_failure_stage),
    actor: { id: authContext.user.id, role: authContext.user.role }
  });
  await services.analysisJobsService.processOnce({ organization_id: lead.organization_id, job_id: job.id });
  return { ...(await services.analysisJobsService.compatibilityResult({
    organization_id: lead.organization_id, job_id: job.id, lead_id: lead.id
  })), job_id: job.id };
}

function analysisFailure(error) {
  const messages = {
    not_found: "Lead not found in this workspace.",
    LEAD_ARCHIVED: "This enquiry is archived. Restore and review it before analysis.",
    LEAD_DATA_STALE: "Contact details changed. Refresh the saved enquiry and try again.",
    INTELLIGENCE_CONTEXT_CHANGED: "Inputs changed during analysis. Review the latest facts and refresh again.",
    BUSINESS_FIT_INVALID: "Saved business criteria assessment could not be verified. Ask the workspace operator to review it.",
    FRESHNESS_STATE_INVALID: "Freshness history could not be verified. Ask the workspace operator to review it.",
    FRESHNESS_CLOCK_INVALID: "The assessment clock could not be verified. Retry after the operator checks it.",
    FRESHNESS_INPUT_LIMIT: "The source evidence exceeds the assessment limit. Review the evidence before retrying."
  };
  const code = error?.statusCode === 404 ? "not_found" : Object.hasOwn(messages, error?.code) ? error.code : "INTELLIGENCE_ANALYSIS_FAILED";
  return { code, error: messages[code] || "Analysis could not complete. Saved source data is retained; review the lead and retry." };
}

function assertIntelligenceReviewCommand(body, fields) {
  const allowed = new Set(["organization_id", ...fields]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw httpError(400, "Intelligence review command contains unsupported fields.");
}

function channelSetupError(statusCode, code, message) { return Object.assign(httpError(statusCode, message), { code }); }
function assertChannelSetupCommand(body, fields) {
  if (Object.keys(body).some(key => !["organization_id", ...fields].includes(key))) throw channelSetupError(400, "CHANNEL_INVALID_INPUT", "Channel setup command contains unsupported fields.");
}


async function captureCurrentSignedReceipt(tx,{receipt,configuration,route_token,input}){
  // Signature verification happens before receipt admission. Revalidate routing
  // under the same gate as insertion so erasure cannot resurrect old inputs.
  const current=await new EmailConnectionRepository(tx).settings(receipt.organization_id);
  const owners=await emailRouteOwners(tx,route_token);
  if(owners.length!==1||owners[0]!==receipt.organization_id||emailConnectionHash(current)!==emailConnectionHash(configuration)){
    throw Object.assign(httpError(409,"Webhook configuration changed before durable admission; retry against the current setup."),{code:"WEBHOOK_CONFIGURATION_STALE"});
  }
  return recordEmailVerificationReceipt(tx,{receipt,configuration,route_token,input});
}

function assertProductCommand(body, fields) { if (Object.keys(body).some(key => !["organization_id", ...fields].includes(key))) throw Object.assign(httpError(400, "This command contains unsupported fields."), { code: "PRODUCT_INVALID_INPUT" }); }
