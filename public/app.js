import {
  buildApprovalDisplayModel,
  buildApprovalQueueModel,
  buildIntelligenceDisplayModel,
  buildImportPreviewModel,
  buildImportReviewSummary,
  buildIntelligenceRecommendationDisplayModel,
  buildLeadDisplayModel,
  buildNextBestActionPlanDisplayModel,
  buildOverview,
  buildSynthesisDisplayModel,
  buildFollowUpQueueModel,
  buildLeadTimelineModel,
  deriveIntelligenceState,
  deriveImportHistoryState,
  deriveOrganizationLeadState,
  filterLeadDisplayModels,
  humanImportIssue,
  importRowPresentation,
  importStateLabel,
  actionStatusLabel
} from "./uiState.js";

const state = {
  activeView: "Overview",
  leadsMode: "list",
  importStep: "upload",
  organizationId: null,
  organizations: [],
  leads: [],
  imports: [],
  approvals: [],
  followUps: [],
  timelineByLead: {},
  campaigns: [],
  sequences: [],
  workflowRuns: [],
  activeImport: null,
  selectedImportRowIds: new Set(),
  selectedLeadId: null,
  isLoadingOrganizations: false,
  isLoadingLeads: false,
  isLoadingImports: false,
  isLoadingApprovals: false,
  isLoadingFollowUps: false,
  isLoadingTimeline: false,
  isLoadingWorkflows: false,
  isCreatingSequence: false,
  isEnrollingSequence: false,
  isRunningDueWorkflows: false,
  isPreviewingImport: false,
  isCommittingImport: false,
  isRefreshingIntelligence: false,
  isRunningSynthesis: false,
  isRunningIntelligenceRecommendation: false,
  isPlanningNextBestAction: false,
  isPreparingOutboundAction: false,
  isExecutingOutboundAction: false,
  intelligenceError: null,
  synthesisError: null,
  intelligenceRecommendationError: null,
  nextBestActionError: null,
  synthesisByLead: {},
  intelligenceRecommendationByLead: {},
  nextBestActionByLead: {},
  leadLoadError: null,
  importLoadError: null,
  approvalLoadError: null,
  followUpLoadError: null,
  timelineLoadError: null,
  workflowLoadError: null,
  leadFilters: {
    search: "",
    source: "",
    status: "",
    intelligence: "",
    attention: ""
  }
};

const organizationForm = document.querySelector("#organization-form");
const leadForm = document.querySelector("#lead-form");
const importForm = document.querySelector("#import-form");
const leadBoard = document.querySelector("#lead-board");
const importFlow = document.querySelector("#import-flow");
const closeImportFlowButton = document.querySelector("#close-import-flow");
const showAddLeadButton = document.querySelector("#show-add-lead");
const showImportLeadsButton = document.querySelector("#show-import-leads");
const runWorkerButton = document.querySelector("#run-worker");
const addRetryActionButton = document.querySelector("#add-retry-action");
const addBlockedActionButton = document.querySelector("#add-blocked-action");
const simulateCallbackButton = document.querySelector("#simulate-callback");
const runDueWorkflowsButton = document.querySelector("#run-due-workflows");
const simulateInboundQuestionButton = document.querySelector("#simulate-inbound-question");
const simulateInboundPositiveButton = document.querySelector("#simulate-inbound-positive");
const simulateInboundOptOutButton = document.querySelector("#simulate-inbound-opt-out");
const createFollowUpSequenceButton = document.querySelector("#create-follow-up-sequence");
const enrollLeadSequenceButton = document.querySelector("#enroll-lead-sequence");
const refreshIntelligenceButton = document.querySelector("#refresh-intelligence");
const runSynthesisButton = document.querySelector("#run-synthesis");
const runIntelligenceRecommendationButton = document.querySelector("#run-intelligence-recommendation");
const planNextBestActionButton = document.querySelector("#plan-next-best-action");
const prepareOutboundActionButton = document.querySelector("#prepare-outbound-action");
const executeOutboundActionButton = document.querySelector("#execute-outbound-action");
const organizationSelect = document.querySelector("#organization-select");
const organizationState = document.querySelector("#organization-state");
const leadList = document.querySelector("#lead-list");
const detail = document.querySelector("#lead-detail");
const detailPanel = document.querySelector(".detail-panel");
const statusBanner = document.querySelector("#status-banner");
const developerOutput = document.querySelector("#developer-output");
const overview = document.querySelector("#overview");
const intelligenceView = document.querySelector("#intelligence-view");
const outboundView = document.querySelector("#outbound-view");
const activityView = document.querySelector("#activity-view");
const importPreview = document.querySelector("#import-preview");
const importHistory = document.querySelector("#import-history");
const workspaceCurrent = document.querySelector("#workspace-current");
const leadSearch = document.querySelector("#lead-search");
const sourceFilter = document.querySelector("#source-filter");
const statusFilter = document.querySelector("#status-filter");
const intelligenceFilter = document.querySelector("#intelligence-filter");
const attentionFilter = document.querySelector("#attention-filter");

initialize();

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    render();
  });
});

organizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withStatus("Creating workspace...", async () => {
    const data = new FormData(organizationForm);
    const response = await api("/api/organizations", {
      method: "POST",
      body: { name: data.get("organization_name") }
    });
    state.organizationId = response.organization.id;
    state.selectedLeadId = null;
    state.activeImport = null;
    await loadOrganizations();
    await loadWorkspaceData();
    state.activeView = "Overview";
    setStatus("Workspace created.", "ok");
  });
});

organizationSelect.addEventListener("change", async (event) => {
  state.organizationId = event.target.value || null;
  state.selectedLeadId = null;
  state.activeImport = null;
  state.selectedImportRowIds = new Set();
  await loadWorkspaceData();
  render();
});

showAddLeadButton.addEventListener("click", () => {
  state.leadsMode = "list";
  leadForm.hidden = !leadForm.hidden;
});

showImportLeadsButton.addEventListener("click", () => {
  state.leadsMode = "import";
  state.importStep = state.activeImport?.import.state === "COMMITTED" ? "complete" : "upload";
  state.activeView = "Leads";
  leadForm.hidden = true;
  render();
});

closeImportFlowButton.addEventListener("click", () => {
  state.leadsMode = "list";
  state.importStep = "upload";
  state.activeImport = null;
  state.selectedImportRowIds = new Set();
  render();
});

leadSearch.addEventListener("input", async (event) => {
  state.leadFilters.search = event.target.value;
  await loadLeads();
});

sourceFilter.addEventListener("change", async (event) => {
  state.leadFilters.source = event.target.value;
  await loadLeads();
});

statusFilter.addEventListener("change", async (event) => {
  state.leadFilters.status = event.target.value;
  await loadLeads();
});

intelligenceFilter.addEventListener("change", (event) => {
  state.leadFilters.intelligence = event.target.value;
  renderLeadList();
});

attentionFilter.addEventListener("change", (event) => {
  state.leadFilters.attention = event.target.value;
  renderLeadList();
});

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withStatus("Adding lead...", async () => {
    if (!state.organizationId) {
      throw new Error("Create or select a workspace before adding a lead.");
    }
    const data = new FormData(leadForm);
    const response = await api("/api/leads", {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        name: data.get("name"),
        email: data.get("email"),
        phone: data.get("phone"),
        company: data.get("company"),
        source: "MANUAL"
      }
    });
    state.selectedLeadId = response.lead.id;
    leadForm.hidden = true;
    await loadLeads();
    state.activeView = "Leads";
    setStatus("Lead added. Run Lead Intelligence when you are ready.", "ok");
  });
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await previewCsvImport();
});

runWorkerButton.addEventListener("click", async () => {
  await withStatus("Refreshing Lead Intelligence and recommended actions...", async () => {
    const result = await api("/api/worker/run", { method: "POST", body: {} });
    developerOutput.textContent = JSON.stringify(result, null, 2);
    await loadLeads();
    setStatus("Lead Intelligence and outbound recommendations refreshed.", "ok");
  });
});

addRetryActionButton.addEventListener("click", () => createDeveloperAction("TRANSIENT_FAIL_ONCE"));
addBlockedActionButton.addEventListener("click", () => createDeveloperAction("PERMANENT_FAILURE"));
simulateCallbackButton.addEventListener("click", completeLatestExecutableAction);
runDueWorkflowsButton?.addEventListener("click", runDueWorkflows);
simulateInboundQuestionButton?.addEventListener("click", () => simulateInboundEvent("QUESTION"));
simulateInboundPositiveButton?.addEventListener("click", () => simulateInboundEvent("POSITIVE_REPLY"));
simulateInboundOptOutButton?.addEventListener("click", () => simulateInboundEvent("OPT_OUT"));
createFollowUpSequenceButton?.addEventListener("click", createFollowUpSequence);
enrollLeadSequenceButton?.addEventListener("click", enrollSelectedLeadInSequence);
refreshIntelligenceButton.addEventListener("click", refreshSelectedLeadIntelligence);
runSynthesisButton.addEventListener("click", runSelectedLeadSynthesis);
runIntelligenceRecommendationButton.addEventListener("click", runSelectedLeadIntelligenceRecommendation);
planNextBestActionButton.addEventListener("click", planSelectedLeadNextBestAction);
prepareOutboundActionButton?.addEventListener("click", prepareSelectedLeadOutboundAction);
executeOutboundActionButton?.addEventListener("click", executeSelectedLeadOutboundAction);

async function initialize() {
  await withStatus("Loading workspace...", async () => {
    await loadOrganizations();
    await loadWorkspaceData();
    const message = state.organizationId ? "Workspace loaded." : "Create a workspace to begin.";
    setStatus(message, state.organizationId ? "ok" : "warn");
  });
}

async function loadOrganizations() {
  state.isLoadingOrganizations = true;
  render();
  try {
    const response = await api("/api/organizations");
    state.organizations = response.organizations;
    if (!state.organizations.some((organization) => organization.id === state.organizationId)) {
      state.organizationId = null;
    }
  } finally {
    state.isLoadingOrganizations = false;
    render();
  }
}

async function loadWorkspaceData() {
  state.synthesisByLead = {};
  state.intelligenceRecommendationByLead = {};
  state.nextBestActionByLead = {};
  state.timelineByLead = {};
  await Promise.all([loadLeads(), loadImports(), loadApprovals(), loadFollowUps(), loadWorkflows()]);
  await loadSelectedSynthesis();
  await loadSelectedIntelligenceRecommendation();
  await loadSelectedNextBestAction();
  await loadSelectedTimeline();
}

async function loadLeads() {
  state.leadLoadError = null;
  state.leads = [];
  if (!state.organizationId) {
    state.isLoadingLeads = false;
    render();
    return;
  }

  state.isLoadingLeads = true;
  render();
  try {
    const params = new URLSearchParams({ organization_id: state.organizationId });
    const response = await api(`/api/leads?${params.toString()}`);
    state.leads = await Promise.all(
      response.leads.map(async (lead) => {
        const detailResponse = await api(`/api/leads/${lead.id}?organization_id=${state.organizationId}`);
        return detailResponse.lead;
      })
    );
    if (!state.selectedLeadId && state.leads.length > 0) {
      state.selectedLeadId = state.leads[0].id;
    }
    if (!state.leads.some((lead) => lead.id === state.selectedLeadId)) {
      state.selectedLeadId = state.leads[0]?.id || null;
    }
  } catch (error) {
    state.leadLoadError = error;
    state.selectedLeadId = null;
  } finally {
    state.isLoadingLeads = false;
    render();
  }
}

async function loadSelectedSynthesis() {
  const selectedLead = getSelectedLead();
  state.synthesisError = null;
  if (!state.organizationId || !selectedLead) {
    return;
  }
  try {
    state.synthesisByLead[selectedLead.id] = await api(
      `/api/leads/${selectedLead.id}/synthesis?organization_id=${state.organizationId}`
    );
  } catch (error) {
    state.synthesisError = error;
  } finally {
    render();
  }
}

async function loadSelectedIntelligenceRecommendation() {
  const selectedLead = getSelectedLead();
  state.intelligenceRecommendationError = null;
  if (!state.organizationId || !selectedLead) {
    return;
  }
  try {
    state.intelligenceRecommendationByLead[selectedLead.id] = await api(
      `/api/leads/${selectedLead.id}/intelligence-recommendation?organization_id=${state.organizationId}`
    );
  } catch (error) {
    state.intelligenceRecommendationError = error;
  } finally {
    render();
  }
}

async function loadSelectedNextBestAction() {
  const selectedLead = getSelectedLead();
  state.nextBestActionError = null;
  if (!state.organizationId || !selectedLead) {
    return;
  }
  try {
    state.nextBestActionByLead[selectedLead.id] = await api(
      `/api/leads/${selectedLead.id}/next-best-action?organization_id=${state.organizationId}`
    );
  } catch (error) {
    state.nextBestActionError = error;
  } finally {
    render();
  }
}

async function loadImports() {
  state.importLoadError = null;
  state.imports = [];
  if (!state.organizationId) {
    state.isLoadingImports = false;
    render();
    return;
  }

  state.isLoadingImports = true;
  render();
  try {
    const response = await api(`/api/imports?organization_id=${state.organizationId}`);
    state.imports = response.imports;
  } catch (error) {
    state.importLoadError = error;
  } finally {
    state.isLoadingImports = false;
    render();
  }
}

async function loadApprovals() {
  state.approvalLoadError = null;
  state.approvals = [];
  if (!state.organizationId) {
    state.isLoadingApprovals = false;
    render();
    return;
  }

  state.isLoadingApprovals = true;
  render();
  try {
    const response = await api(`/api/approvals?organization_id=${state.organizationId}`);
    state.approvals = response.approvals;
  } catch (error) {
    state.approvalLoadError = error;
  } finally {
    state.isLoadingApprovals = false;
    render();
  }
}

async function loadFollowUps() {
  state.followUpLoadError = null;
  state.followUps = [];
  if (!state.organizationId) {
    state.isLoadingFollowUps = false;
    render();
    return;
  }

  state.isLoadingFollowUps = true;
  render();
  try {
    const response = await api(`/api/follow-ups?organization_id=${state.organizationId}`);
    state.followUps = response.follow_ups;
  } catch (error) {
    state.followUpLoadError = error;
  } finally {
    state.isLoadingFollowUps = false;
    render();
  }
}

async function loadSelectedTimeline() {
  const selectedLead = getSelectedLead();
  state.timelineLoadError = null;
  if (!state.organizationId || !selectedLead) {
    return;
  }

  state.isLoadingTimeline = true;
  render();
  try {
    state.timelineByLead[selectedLead.id] = await api(`/api/leads/${selectedLead.id}/timeline?organization_id=${state.organizationId}`);
  } catch (error) {
    state.timelineLoadError = error;
  } finally {
    state.isLoadingTimeline = false;
    render();
  }
}

async function loadWorkflows() {
  state.workflowLoadError = null;
  state.campaigns = [];
  state.sequences = [];
  state.workflowRuns = [];
  if (!state.organizationId) {
    state.isLoadingWorkflows = false;
    render();
    return;
  }

  state.isLoadingWorkflows = true;
  render();
  try {
    const [campaigns, sequences, runs] = await Promise.all([
      api(`/api/campaigns?organization_id=${state.organizationId}`),
      api(`/api/sequences?organization_id=${state.organizationId}`),
      api(`/api/workflow-runs?organization_id=${state.organizationId}`)
    ]);
    state.campaigns = campaigns.campaigns;
    state.sequences = sequences.sequences;
    state.workflowRuns = runs.workflow_runs;
  } catch (error) {
    state.workflowLoadError = error;
  } finally {
    state.isLoadingWorkflows = false;
    render();
  }
}

async function previewCsvImport() {
  await withStatus("Preparing Lead Data Foundation preview...", async () => {
    if (!state.organizationId) {
      throw new Error("Create or select a workspace before importing leads.");
    }
    const file = document.querySelector("#csv-file").files[0];
    if (!file) {
      throw new Error("Select a CSV file first.");
    }
    state.isPreviewingImport = true;
    render();
    const csvText = await file.text();
    const response = await api("/api/imports/csv/preview", {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        filename: file.name,
        csv_text: csvText,
        default_phone_region: new FormData(importForm).get("default_phone_region")
      }
    });
    state.activeImport = response;
    state.importStep = "review";
    state.selectedLeadId = null;
    state.selectedImportRowIds = new Set(
      response.rows.filter((row) => row.validation_state === "VALID").map((row) => row.id)
    );
    await loadImports();
    state.activeView = "Leads";
    setStatus("Review your import before adding leads.", "ok");
  });
  state.isPreviewingImport = false;
  render();
}

async function commitActiveImport() {
  if (!state.activeImport) {
    return;
  }
  state.isCommittingImport = true;
  render();
  try {
    const response = await api(`/api/imports/${state.activeImport.import.id}/commit`, {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        selected_row_ids: Array.from(state.selectedImportRowIds)
      }
    });
    state.activeImport = response;
    state.importStep = "complete";
    await loadWorkspaceData();
    setStatus("Import complete. Imported leads are now available.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.isCommittingImport = false;
    render();
  }
}

async function createDeveloperAction(mockBehavior) {
  await withStatus("Creating developer test action...", async () => {
    const selectedLead = getSelectedLead();
    if (!selectedLead) {
      throw new Error("Select a lead before creating a developer test action.");
    }
    const response = await api(`/api/leads/${selectedLead.id}/actions`, {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        type: "SEND_EMAIL",
        mock_behavior: mockBehavior
      }
    });
    developerOutput.textContent = JSON.stringify(response, null, 2);
    await loadLeads();
    await loadSelectedTimeline();
    await loadFollowUps();
    setStatus("Developer test action created.", "ok");
  });
}

async function completeLatestExecutableAction() {
  await withStatus("Completing outbound activity...", async () => {
    const selectedLead = getSelectedLead();
    const action = selectedLead?.actions.find((item) => item.status === "EXECUTING");
    if (!action) {
      throw new Error("No in-progress action is available for callback simulation.");
    }
    const response = await api("/api/callbacks/mock", {
      method: "POST",
      body: {
        action_id: action.id,
        provider_event_id: `ui-${action.id}`,
        status: "COMPLETED",
        provider_reference: `ui-callback-${action.id}`
      }
    });
    developerOutput.textContent = JSON.stringify(response, null, 2);
    await loadLeads();
    await loadSelectedTimeline();
    await loadFollowUps();
    setStatus(response.duplicate ? "Duplicate callback ignored without side effects." : "Outbound activity completed.", "ok");
  });
}

async function simulateInboundEvent(eventType) {
  await withStatus("Recording inbound channel event...", async () => {
    const selectedLead = getSelectedLead();
    if (!selectedLead) {
      throw new Error("Select a lead before simulating an inbound response.");
    }
    const channel = channelForSelectedLead(selectedLead);
    const response = await api("/api/inbound-events/mock", {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        lead_id: selectedLead.id,
        channel,
        provider_event_id: `ui-${eventType.toLowerCase()}-${selectedLead.id}-${Date.now()}`,
        event_type: eventType,
        payload: inboundPayload(eventType)
      }
    });
    developerOutput.textContent = JSON.stringify(response, null, 2);
    await loadLeads();
    state.selectedLeadId = selectedLead.id;
    await loadSelectedTimeline();
    await loadFollowUps();
    setStatus("Inbound activity recorded.", "ok");
  });
}

async function createFollowUpSequence() {
  state.isCreatingSequence = true;
  render();
  await withStatus("Creating follow-up sequence...", async () => {
    if (!state.organizationId) {
      throw new Error("Select a workspace before creating a sequence.");
    }
    if (state.sequences.length > 0) {
      setStatus("A follow-up sequence is already available in this workspace.", "ok");
      return;
    }
    const campaign = await api("/api/campaigns", {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        name: "Lead follow-up campaign",
        objective: "Review and follow up with leads based on Lead Intelligence."
      }
    });
    await api("/api/sequences", {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        campaign_id: campaign.campaign.id,
        name: "Simple follow-up sequence",
        stop_on_reply: true,
        steps: [
          {
            type: "SEND_EMAIL",
            title: "Send reviewed introduction",
            body: "Use the approved recommendation to contact this lead.",
            delay_hours: 24,
            requires_approval: true
          },
          {
            type: "CREATE_HUMAN_TASK",
            title: "Review follow-up",
            body: "Review whether this lead needs another follow-up.",
            delay_hours: 0,
            requires_approval: false
          }
        ]
      }
    });
    await loadWorkflows();
    setStatus("Follow-up sequence created.", "ok");
  });
  state.isCreatingSequence = false;
  render();
}

async function enrollSelectedLeadInSequence() {
  state.isEnrollingSequence = true;
  render();
  await withStatus("Enrolling lead in follow-up sequence...", async () => {
    const selectedLead = getSelectedLead();
    if (!selectedLead) {
      throw new Error("Select a lead before enrolling in a sequence.");
    }
    if (state.sequences.length === 0) {
      throw new Error("Create a follow-up sequence before enrolling a lead.");
    }
    await api(`/api/sequences/${state.sequences[0].id}/enroll`, {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        lead_ids: [selectedLead.id]
      }
    });
    await loadWorkflows();
    setStatus("Lead enrolled in follow-up sequence.", "ok");
  });
  state.isEnrollingSequence = false;
  render();
}

async function runDueWorkflows() {
  state.isRunningDueWorkflows = true;
  render();
  await withStatus("Running due workflow steps...", async () => {
    if (!state.organizationId) {
      throw new Error("Select a workspace before running due workflow steps.");
    }
    const response = await api("/api/workflows/run-due", {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    developerOutput.textContent = JSON.stringify(response, null, 2);
    await loadWorkspaceData();
    setStatus(`${response.processed_runs.length} workflow run${response.processed_runs.length === 1 ? "" : "s"} processed.`, "ok");
  });
  state.isRunningDueWorkflows = false;
  render();
}

async function refreshSelectedLeadIntelligence() {
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    setStatus("Select a lead before refreshing Lead Intelligence.", "error");
    return;
  }
  state.isRefreshingIntelligence = true;
  state.intelligenceError = null;
  render();
  try {
    await api(`/api/leads/${selectedLead.id}/intelligence/run`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    await loadLeads();
    state.selectedLeadId = selectedLead.id;
    await loadSelectedSynthesis();
    state.activeView = "Intelligence";
    setStatus("Lead Intelligence foundation refreshed.", "ok");
  } catch (error) {
    state.intelligenceError = error;
    setStatus(error.message, "error");
  } finally {
    state.isRefreshingIntelligence = false;
    render();
  }
}

async function runSelectedLeadSynthesis() {
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    setStatus("Select a lead before running synthesis.", "error");
    return;
  }
  state.isRunningSynthesis = true;
  state.synthesisError = null;
  render();
  try {
    const response = await api(`/api/leads/${selectedLead.id}/synthesis/run`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    state.synthesisByLead[selectedLead.id] = {
      synthesis_status: response.synthesis.status,
      synthesis: response.synthesis
    };
    await loadSelectedIntelligenceRecommendation();
    state.activeView = "Intelligence";
    setStatus("Lead Intelligence insights prepared.", "ok");
  } catch (error) {
    state.synthesisError = error;
    setStatus(error.message, "error");
  } finally {
    state.isRunningSynthesis = false;
    render();
  }
}

async function runSelectedLeadIntelligenceRecommendation() {
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    setStatus("Select a lead before running recommendation.", "error");
    return;
  }
  state.isRunningIntelligenceRecommendation = true;
  state.intelligenceRecommendationError = null;
  render();
  try {
    const response = await api(`/api/leads/${selectedLead.id}/intelligence-recommendation/run`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    state.intelligenceRecommendationByLead[selectedLead.id] = {
      recommendation_status: response.intelligence_recommendation.status,
      intelligence_recommendation: response.intelligence_recommendation
    };
    await loadSelectedNextBestAction();
    state.activeView = "Intelligence";
    setStatus("Recommendation prepared.", "ok");
  } catch (error) {
    state.intelligenceRecommendationError = error;
    setStatus(error.message, "error");
  } finally {
    state.isRunningIntelligenceRecommendation = false;
    render();
  }
}

async function planSelectedLeadNextBestAction() {
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    setStatus("Select a lead before planning next best action.", "error");
    return;
  }
  state.isPlanningNextBestAction = true;
  state.nextBestActionError = null;
  render();
  try {
    const response = await api(`/api/leads/${selectedLead.id}/next-best-action/plan`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    state.nextBestActionByLead[selectedLead.id] = {
      plan_status: response.next_best_action_plan.status,
      next_best_action_plan: response.next_best_action_plan
    };
    state.activeView = "Outbound";
    setStatus("Recommendation ready for review.", "ok");
  } catch (error) {
    state.nextBestActionError = error;
    setStatus(error.message, "error");
  } finally {
    state.isPlanningNextBestAction = false;
    render();
  }
}

async function prepareSelectedLeadOutboundAction() {
  const selectedLead = getSelectedLead();
  const plan = state.nextBestActionByLead[selectedLead?.id]?.next_best_action_plan;
  if (!selectedLead || !plan) {
    setStatus("Plan the next best action before preparing outbound activity.", "error");
    return;
  }
  state.isPreparingOutboundAction = true;
  render();
  try {
    const response = await api(`/api/next-best-action-plans/${plan.id}/action`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    await loadLeads();
    await loadApprovals();
    await loadSelectedTimeline();
    await loadFollowUps();
    state.selectedLeadId = selectedLead.id;
    state.activeView = "Outbound";
    setStatus(response.action.status === "AWAITING_APPROVAL" ? "Review item prepared." : "Recommended step prepared.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.isPreparingOutboundAction = false;
    render();
  }
}

async function approveSelectedLeadAction({ edited = false } = {}) {
  const selectedLead = getSelectedLead();
  const action = selectedLead ? currentActionForSelectedPlan(selectedLead) : null;
  if (!selectedLead || !action) {
    setStatus("Prepare a review item before approving.", "error");
    return;
  }

  await withStatus(edited ? "Saving edits and approval..." : "Approving recommended step...", async () => {
    const note = document.querySelector("#approval-note")?.value || "";
    const instruction = document.querySelector("#approval-edit")?.value || "";
    await api(`/api/actions/${action.id}/approval/${edited ? "edit-and-approve" : "approve"}`, {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        reviewer_name: "Workspace reviewer",
        reviewer_note: note,
        edited_payload: edited && instruction.trim() ? { instruction: instruction.trim() } : undefined
      }
    });
    await loadLeads();
    await loadApprovals();
    await loadSelectedTimeline();
    await loadFollowUps();
    state.selectedLeadId = selectedLead.id;
    state.activeView = "Outbound";
    setStatus(edited ? "Recommended step edited and approved." : "Recommended step approved.", "ok");
  });
}

async function rejectSelectedLeadAction() {
  const selectedLead = getSelectedLead();
  const action = selectedLead ? currentActionForSelectedPlan(selectedLead) : null;
  if (!selectedLead || !action) {
    setStatus("Prepare a review item before rejecting.", "error");
    return;
  }

  await withStatus("Rejecting recommended step...", async () => {
    const note = document.querySelector("#approval-note")?.value || "";
    await api(`/api/actions/${action.id}/approval/reject`, {
      method: "POST",
      body: {
        organization_id: state.organizationId,
        reviewer_name: "Workspace reviewer",
        reviewer_note: note
      }
    });
    await loadLeads();
    await loadApprovals();
    await loadSelectedTimeline();
    await loadFollowUps();
    state.selectedLeadId = selectedLead.id;
    state.activeView = "Outbound";
    setStatus("Recommended step rejected.", "ok");
  });
}

async function executeSelectedLeadOutboundAction() {
  const selectedLead = getSelectedLead();
  const action = selectedLead?.actions.find((item) => ["PLANNED", "APPROVED", "RETRYING"].includes(item.status));
  if (!selectedLead || !action) {
    setStatus("No reviewed outbound action is ready to run.", "error");
    return;
  }
  state.isExecutingOutboundAction = true;
  render();
  try {
    await api(`/api/actions/${action.id}/execute`, {
      method: "POST",
      body: {
        organization_id: state.organizationId
      }
    });
    await loadLeads();
    await loadSelectedTimeline();
    await loadFollowUps();
    state.selectedLeadId = selectedLead.id;
    state.activeView = "Outbound";
    setStatus("Execution started.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.isExecutingOutboundAction = false;
    render();
  }
}

function render() {
  renderNavigation();
  renderOrganizations();
  renderWorkspaceCurrent();
  renderLeadsShell();
  renderImportSteps();
  renderOrganizationState();
  renderLeadList();
  renderLeadDetail();
  renderImportPreview();
  renderImportHistory();
  renderOverview();
  renderIntelligence();
  renderOutbound();
  renderActivity();
  renderButtons();
}

function renderNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === state.activeView);
  });
}

function renderOrganizations() {
  organizationSelect.innerHTML = "";
  if (state.isLoadingOrganizations) {
    organizationSelect.innerHTML = `<option value="">Loading workspaces</option>`;
    return;
  }
  if (state.organizations.length === 0) {
    organizationSelect.innerHTML = `<option value="">No workspaces yet</option>`;
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select workspace";
  organizationSelect.append(placeholder);
  for (const organization of state.organizations) {
    const option = document.createElement("option");
    option.value = organization.id;
    option.textContent = organization.name;
    organizationSelect.append(option);
  }
  organizationSelect.value = state.organizationId || "";
}

function renderWorkspaceCurrent() {
  const activeWorkspace = state.organizations.find((organization) => organization.id === state.organizationId);
  workspaceCurrent.textContent = activeWorkspace?.name || "No workspace selected";
}

function renderLeadsShell() {
  const importMode = state.leadsMode === "import";
  leadBoard.hidden = importMode;
  importFlow.hidden = !importMode;
  detailPanel.hidden = importMode;
}

function renderImportSteps() {
  document.querySelectorAll("[data-import-step]").forEach((step) => {
    step.classList.toggle("active", step.dataset.importStep === state.importStep);
  });
  importForm.hidden = state.importStep !== "upload";
  importPreview.hidden = state.importStep === "upload" || !state.activeImport;
}

function renderOrganizationState() {
  const viewState = deriveOrganizationLeadState({
    organizationId: state.organizationId,
    isLoading: state.isLoadingLeads,
    leads: state.leads,
    error: state.leadLoadError
  });
  organizationState.textContent = viewState.message;
}

function renderLeadList() {
  const viewState = deriveOrganizationLeadState({
    organizationId: state.organizationId,
    isLoading: state.isLoadingLeads,
    leads: state.leads,
    error: state.leadLoadError
  });

  if (viewState.kind !== "ready") {
    leadList.innerHTML = `<div class="detail-empty">${escapeHtml(viewState.message)}</div>`;
    return;
  }

  const displayModels = filterLeadDisplayModels(state.leads, state.leadFilters);
  if (displayModels.length === 0) {
    leadList.innerHTML = `<div class="empty-state">
      <strong>No leads match your search.</strong>
      <p>Change the search or filters to see more leads.</p>
    </div>`;
    return;
  }

  leadList.innerHTML = "";
  for (const model of displayModels) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lead-item ${model.id === state.selectedLeadId ? "active" : ""}`;
    button.innerHTML = `
      <div class="lead-columns">
        <strong>${escapeHtml(model.name)}</strong>
        <span>${escapeHtml(model.company)}</span>
        <span>${escapeHtml(model.contact)}</span>
        <span>${escapeHtml(model.statusLabel)}</span>
        <span>${escapeHtml(model.intelligenceStatus)}</span>
        <span>${escapeHtml(model.recommendedAction)}</span>
      </div>
      ${model.duplicateWarning ? `<span class="warning-badge">${escapeHtml(model.duplicateWarning)}</span>` : ""}
    `;
    button.addEventListener("click", () => {
      state.selectedLeadId = model.id;
      void loadSelectedSynthesis();
      void loadSelectedIntelligenceRecommendation();
      void loadSelectedNextBestAction();
      void loadSelectedTimeline();
      render();
    });
    leadList.append(button);
  }
}

function renderLeadDetail() {
  if (state.activeImport && state.activeImport.import.state !== "COMMITTED") {
    detail.innerHTML = `<div class="detail-empty">Review the import preview. Select rows that are ready to import, resolve rows that need attention, and import when ready.</div>`;
    return;
  }
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    detail.innerHTML = `<div class="detail-empty">Select or create a lead to understand what the system knows and recommends.</div>`;
    return;
  }
  detail.innerHTML = renderLeadConcepts(selectedLead);
  detail.querySelector("[data-detail-primary-action]")?.addEventListener("click", () => {
    const action = buildLeadDisplayModel(selectedLead).primaryAction;
    if (action === "Run intelligence") {
      void refreshSelectedLeadIntelligence();
      return;
    }
    if (action === "Review recommendation") {
      state.activeView = "Outbound";
      render();
      return;
    }
    state.activeView = "Leads";
    render();
  });
}

function renderImportPreview() {
  if (!state.activeImport) {
    importPreview.hidden = true;
    importPreview.innerHTML = "";
    return;
  }
  importPreview.hidden = false;
  const model = buildImportPreviewModel(state.activeImport);
  const summary = buildImportReviewSummary(state.activeImport, state.selectedImportRowIds);
  if (state.importStep === "complete") {
    importPreview.innerHTML = renderImportComplete(summary);
    importPreview.querySelector("#view-imported-leads").addEventListener("click", () => {
      state.leadsMode = "list";
      state.importStep = "upload";
      state.activeImport = null;
      state.selectedImportRowIds = new Set();
      state.leadFilters = { search: "", source: "CSV", status: "", intelligence: "", attention: "" };
      sourceFilter.value = "CSV";
      statusFilter.value = "";
      intelligenceFilter.value = "";
      attentionFilter.value = "";
      leadSearch.value = "";
      render();
    });
    return;
  }
  const canCommit = model.state !== "COMMITTED" && summary.selectedRows > 0 && !state.isCommittingImport;
  importPreview.innerHTML = `
    <div class="panel-header">
      <div>
        <h4>Review import</h4>
        <p class="section-note">Duplicate warnings do not prevent import. Review them before committing.</p>
      </div>
      <div class="inline-actions">
        <button id="clear-import-preview" class="secondary-button" type="button">Close preview</button>
        <button id="commit-import" type="button" ${canCommit ? "" : "disabled"}>Import ${summary.selectedRows} selected leads</button>
      </div>
    </div>
    <section class="metric-grid import-summary-grid">
      ${metric(summary.totalRows, "Rows")}
      ${metric(summary.readyToImport, "Ready to import")}
      ${metric(summary.needAttention, "Need attention")}
      ${metric(summary.duplicateWarnings, "Duplicate warnings")}
    </section>
    <p class="selection-note">${summary.selectedRows} of ${summary.totalRows} rows selected.</p>
    ${renderImportIssues(state.activeImport.issues)}
    <div class="import-table" role="table" aria-label="CSV import preview">
      ${model.rows.map((row) => renderImportRow(row)).join("")}
    </div>
  `;
  importPreview.querySelector("#commit-import").addEventListener("click", commitActiveImport);
  importPreview.querySelector("#clear-import-preview").addEventListener("click", () => {
    state.activeImport = null;
    state.selectedImportRowIds = new Set();
    render();
  });
  importPreview.querySelectorAll("[data-import-row]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedImportRowIds.add(event.target.value);
      } else {
        state.selectedImportRowIds.delete(event.target.value);
      }
      renderImportPreview();
    });
  });
}

function renderImportRow(row) {
  const view = importRowPresentation(row, state.activeImport.rows);
  const checked = state.selectedImportRowIds.has(row.id) ? "checked" : "";
  const disabled = view.selectable ? "" : "disabled";
  return `
    <div class="import-row ${row.validation_state === "VALID" ? "" : "invalid"}">
      <label class="checkbox-row">
        <input data-import-row type="checkbox" value="${escapeHtml(row.id)}" ${checked} ${disabled}>
        Row ${view.rowNumber}
      </label>
      <div class="import-row-grid">
        <div>
          <span class="label-text">Identity</span>
          <strong>${escapeHtml(view.identity)}</strong>
        </div>
        <div>
          <span class="label-text">Company</span>
          <p>${escapeHtml(view.company)}</p>
        </div>
        <div>
          <span class="label-text">Contact</span>
          <p>${escapeHtml(view.contact)}</p>
        </div>
        <div>
          <span class="label-text">State</span>
          <p>${escapeHtml(view.stateLabel)}</p>
        </div>
        ${renderDuplicateCandidates(view)}
        ${renderNormalizedValues(view.normalizedValues)}
      </div>
    </div>
  `;
}

function renderDuplicateCandidates(rowView) {
  if (!rowView.duplicateSummary) {
    return "";
  }
  return `
    <details class="duplicate-details">
      <summary>${escapeHtml(rowView.duplicateSummary)}</summary>
      ${renderDuplicateGroup("Existing lead", rowView.duplicateGroups.existingLeads)}
      ${renderDuplicateGroup("CSV row", rowView.duplicateGroups.previewRows)}
    </details>
  `;
}

function renderDuplicateGroup(label, candidates) {
  if (!candidates.length) {
    return "";
  }
  return `
    <div class="duplicate-group">
      <strong>${escapeHtml(label)}</strong>
      ${candidates.map((candidate) => `<p>${escapeHtml(duplicateMatchLabel(candidate))}</p>`).join("")}
    </div>
  `;
}

function duplicateMatchLabel(candidate) {
  const match = candidate.matched_import_row_id
    ? `CSV row ${candidate.matched_row_number || "already shown"}`
    : "an existing lead";
  const reason = {
    STRONG_EMAIL: "matching email",
    STRONG_PHONE: "matching phone",
    POSSIBLE_NAME_COMPANY: "matching name + company"
  }[candidate.duplicate_type];
  return `${reason} with ${match}`;
}

function renderNormalizedValues(values) {
  if (!values.length) {
    return "";
  }
  return `
    <details class="normalized-details">
      <summary>View normalized values</summary>
      ${values
        .map((item) => {
          return `
            <div class="normalized-pair">
              <strong>${escapeHtml(item.label)}</strong>
              <p>Original: ${escapeHtml(item.original || "Not provided")}</p>
              <p>Stored: ${escapeHtml(item.stored || "Not stored")}</p>
            </div>
          `;
        })
        .join("")}
    </details>
  `;
}

function renderImportIssues(issues) {
  if (!issues.length) {
    return `<div class="success-note">No rows need attention.</div>`;
  }
  return `
    <div class="issue-list">
      ${issues
        .map((issue) => {
          const rowLabel = issue.metadata?.row_number || state.activeImport.rows.find((row) => row.id === issue.import_row_id)?.row_number;
          const humanIssue = humanImportIssue(issue);
          return `
            <div class="issue-item ${issue.severity === "ERROR" ? "danger" : "warn"}">
              <strong>${escapeHtml(humanIssue.title)}</strong>
              <p>${rowLabel ? `Row ${escapeHtml(rowLabel)}: ` : ""}${escapeHtml(humanIssue.message)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderImportComplete(summary) {
  return `
    <div class="completion-state">
      <h4>Import complete</h4>
      <strong>${summary.importedRows} leads added</strong>
      <p>${summary.needAttention} rows need attention.</p>
      <p>${summary.duplicateWarnings} duplicate warnings were reviewed.</p>
      <button id="view-imported-leads" type="button">View imported leads</button>
    </div>
  `;
}

function renderImportHistory() {
  const viewState = deriveImportHistoryState({
    organizationId: state.organizationId,
    isLoading: state.isLoadingImports,
    imports: state.imports,
    error: state.importLoadError
  });
  if (viewState.kind !== "ready") {
    importHistory.className = "detail-empty";
    importHistory.innerHTML = escapeHtml(viewState.message);
    return;
  }
  importHistory.className = "activity-list";
  importHistory.innerHTML = state.imports
    .map((item) => {
      return `
        <button class="history-item" type="button" data-import-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.filename)}</strong>
          <span>${item.summary.total_rows || 0} rows - ${item.summary.committed_rows || 0} imported - ${escapeHtml(
            importStateLabel(item.state)
          )}</span>
        </button>
      `;
    })
    .join("");
  importHistory.querySelectorAll("[data-import-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const response = await api(`/api/imports/${button.dataset.importId}?organization_id=${state.organizationId}`);
      state.activeImport = response;
      state.leadsMode = "import";
      state.importStep = response.import.state === "COMMITTED" ? "complete" : "review";
      const persistedSelection = response.rows.filter((row) => row.selected).map((row) => row.id);
      state.selectedImportRowIds = new Set(
        persistedSelection.length > 0
          ? persistedSelection
          : response.rows.filter((row) => row.validation_state === "VALID").map((row) => row.id)
      );
      render();
    });
  });
}

function renderOverview() {
  const viewState = deriveOrganizationLeadState({
    organizationId: state.organizationId,
    isLoading: state.isLoadingLeads,
    leads: state.leads,
    error: state.leadLoadError
  });

  if (viewState.kind !== "ready") {
    overview.innerHTML = `<section class="panel"><h3>${escapeHtml(viewState.title)}</h3><p>${escapeHtml(viewState.message)}</p></section>`;
    return;
  }

  const metrics = buildOverview(state.leads, { followUps: state.followUps });
  const approvalQueue = buildApprovalQueueModel(state.approvals);
  const followUpQueue = buildFollowUpQueueModel(state.followUps);
  const attentionItems = buildAttentionItems(state.leads).slice(0, 5);
  const recentItems = buildRecentActivityItems(state.leads, state.imports, state.followUps).slice(0, 5);
  overview.innerHTML = `
    <section class="metric-grid">
      ${metric(metrics.leadCount, "Leads")}
      ${metric(metrics.attentionLeads, "Need attention")}
      ${metric(metrics.readyForIntelligence, "Ready to analyze")}
      ${metric(metrics.intelligenceAvailable, "Intelligence ready")}
      ${metric(approvalQueue.pendingCount + followUpQueue.openCount || metrics.readyForReview, "Need review")}
    </section>
    <section class="dashboard-grid">
      <section class="panel">
        <h3>Needs your attention</h3>
        ${renderAttentionItems([...approvalQueue.items.map(approvalQueueToAttentionItem), ...attentionItems].slice(0, 5))}
      </section>
      <section class="panel">
        <h3>Lead and outbound flow</h3>
        ${renderPipeline(metrics)}
      </section>
    </section>
    <section class="panel">
      <h3>Follow-ups</h3>
      ${renderFollowUpQueue(followUpQueue)}
    </section>
      <section class="panel">
        <h3>Recent activity</h3>
      ${renderRecentActivityItems(recentItems)}
    </section>
  `;
  overview.querySelectorAll("[data-attention-lead-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLeadId = button.dataset.attentionLeadId;
      state.activeView = button.dataset.attentionView || "Leads";
      void loadSelectedSynthesis();
      void loadSelectedIntelligenceRecommendation();
      void loadSelectedNextBestAction();
      render();
    });
  });
}

function approvalQueueToAttentionItem(approval) {
  return {
    leadId: approval.leadId,
    title: approval.leadName,
    message: `${approval.actionType} needs approval.`,
    view: "Outbound"
  };
}

function buildAttentionItems(leads) {
  return leads
    .map((lead) => {
      const model = buildLeadDisplayModel(lead);
      if (model.duplicateWarning) {
        return { leadId: lead.id, title: model.name, message: "Possible duplicate needs review.", view: "Leads" };
      }
      if (!lead.intelligence) {
        return { leadId: lead.id, title: model.name, message: "Run Lead Intelligence.", view: "Intelligence" };
      }
      if (model.primaryAction === "Review recommendation") {
        return { leadId: lead.id, title: model.name, message: "Review the recommended next step.", view: "Outbound" };
      }
      if (model.primaryAction === "Gather more data") {
        return { leadId: lead.id, title: model.name, message: "More lead information is needed.", view: "Leads" };
      }
      return null;
    })
    .filter(Boolean);
}

function buildRecentActivityItems(leads, imports, followUps = []) {
  const imported = imports.map((item) => ({
    title: item.filename,
    message: `${item.summary?.committed_rows || 0} leads imported`,
    date: item.updated_at || item.created_at
  }));
  const intelligence = leads
    .filter((lead) => lead.intelligence)
    .map((lead) => ({
      title: lead.name,
      message: "Lead Intelligence is ready",
      date: lead.intelligence.updated_at || lead.updated_at
    }));
  const recommendations = leads
    .filter((lead) => {
      const recommendation =
        lead.intelligence_context?.recommendation?.action_type ||
        lead.intelligence?.recommendation?.action_type ||
        lead.intelligence?.next_best_action;
      return recommendation === "PREPARE_OUTBOUND_REVIEW" || recommendation === "READY_FOR_RESEARCH";
    })
    .map((lead) => ({
      title: lead.name,
      message: "Recommended next step is ready for review",
      date: lead.intelligence?.updated_at || lead.updated_at
    }));
  const followUpItems = followUps.map((item) => ({
    title: item.lead_name || "Follow-up",
    message: `${followUpStatusText(item.status)} - ${item.reason}`,
    date: item.updated_at || item.due_at || item.created_at
  }));
  return [...imported, ...intelligence, ...recommendations, ...followUpItems].sort((first, second) =>
    String(second.date || "").localeCompare(String(first.date || ""))
  );
}

function renderFollowUpQueue(model) {
  if (!model.items.length) {
    return `<div class="detail-empty">No open follow-ups yet.</div>`;
  }
  return `
    <div class="activity-list">
      ${model.items
        .map(
          (item) => `
            <div class="activity-item">
              <strong>${escapeHtml(item.leadName)}</strong>
              <p>${escapeHtml(item.channel)} - ${escapeHtml(item.status)}</p>
              <p>${escapeHtml(item.reason)}</p>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAttentionItems(items) {
  if (!items.length) {
    return `<div class="detail-empty">No urgent items. Add leads or run Lead Intelligence to continue.</div>`;
  }
  return `
    <div class="activity-list">
      ${items
        .map(
          (item) => `
            <button class="activity-item" type="button" data-attention-lead-id="${escapeHtml(item.leadId)}" data-attention-view="${escapeHtml(item.view)}">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.message)}</p>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPipeline(metrics) {
  const stages = [
    { label: "Imported", value: state.imports.reduce((count, item) => count + (item.summary?.committed_rows || 0), 0) },
    { label: "Not analyzed", value: metrics.readyForIntelligence },
    { label: "Intelligence ready", value: metrics.intelligenceAvailable },
    { label: "Ready for review", value: metrics.readyForReview },
    { label: "Open follow-ups", value: metrics.actionsNeedAttention }
  ];
  return `<div class="pipeline">${stages.map((stage) => renderPipelineStage(stage)).join("")}</div>`;
}

function renderPipelineStage(stage) {
  return `
    <div class="pipeline-stage${stage.disabled ? " disabled" : ""}">
      <strong>${escapeHtml(String(stage.value))}</strong>
      <span>${escapeHtml(stage.label)}</span>
    </div>
  `;
}

function renderRecentActivityItems(items) {
  if (!items.length) {
    return `<div class="detail-empty">Activity will appear here as work is completed.</div>`;
  }
  return `
    <div class="activity-list">
      ${items
        .map(
          (item) => `
            <div class="activity-item">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.message)}</p>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderIntelligence() {
  const selectedLead = getSelectedLead();
  const viewState = deriveIntelligenceState({
    lead: selectedLead,
    isLoading: state.isRefreshingIntelligence,
    error: state.intelligenceError
  });
  if (viewState.kind !== "ready") {
    intelligenceView.innerHTML = `<div class="detail-empty">${escapeHtml(viewState.message)}</div>`;
    return;
  }
  const model = buildIntelligenceDisplayModel(selectedLead);
  const synthesisModel = buildSynthesisDisplayModel(state.synthesisByLead[selectedLead.id]);
  const intelligenceRecommendationModel = buildIntelligenceRecommendationDisplayModel(
    state.intelligenceRecommendationByLead[selectedLead.id]
  );
  intelligenceView.innerHTML = `
    <div class="intelligence-layout">
      <section class="concept-section">
        <h4>Status</h4>
        <p><strong>${escapeHtml(model.status)}</strong></p>
        <p>${escapeHtml(model.summary)}</p>
      </section>
      <section class="concept-section">
        <h4>Intelligence readiness</h4>
        <div class="readiness-row">
          <strong>${escapeHtml(model.readinessStatus)}</strong>
          <span>Data completeness</span>
        </div>
        ${renderReadinessFactors(model.readinessFactors)}
        ${model.missing.length ? `<p>${escapeHtml(model.missing.join(" "))}</p>` : ""}
      </section>
      <section class="concept-section">
        <h4>What we know</h4>
        <div class="fact-grid">${model.customerProvided.map(renderFact).join("")}</div>
        <details class="normalized-details">
          <summary>View data details</summary>
          <p>${escapeHtml(model.provenanceSummary)}</p>
        </details>
      </section>
      <section class="concept-section">
        <h4>Insights</h4>
        <p>${escapeHtml(model.qualification?.status || "Not assessed")}</p>
        <p>${escapeHtml(model.confidenceNote)}</p>
      </section>
      <section class="concept-section">
        <h4>Recommendation</h4>
        <p><strong>${escapeHtml(model.recommendation.label)}</strong></p>
        <p>${escapeHtml(model.recommendation.reason)}</p>
      </section>
      ${renderSynthesisPanel(synthesisModel)}
      ${renderIntelligenceRecommendationPanel(intelligenceRecommendationModel)}
    </div>
  `;
}

function renderOutbound() {
  const selectedLead = getSelectedLead();
  if (!selectedLead) {
    outboundView.innerHTML = `<div class="detail-empty">Select a lead to review the recommended next action.</div>`;
    return;
  }
  if (state.isPlanningNextBestAction) {
    outboundView.innerHTML = `
      <section class="concept-section">
        <h4>Recommended action</h4>
        <p>Preparing the next recommended step...</p>
      </section>
    `;
    return;
  }
  if (state.nextBestActionError) {
    outboundView.innerHTML = `
      <section class="concept-section">
        <h4>Recommended action</h4>
        <p class="error-text">${escapeHtml(state.nextBestActionError.message)}</p>
      </section>
    `;
    return;
  }

  const model = buildNextBestActionPlanDisplayModel(state.nextBestActionByLead[selectedLead.id]);
  const action = currentActionForSelectedPlan(selectedLead);
  const approvalModel = buildApprovalDisplayModel(action);
  if (!model.plan) {
    outboundView.innerHTML = `
      <section class="concept-section">
        <h4>Recommended action</h4>
        <p><strong>${escapeHtml(model.status)}</strong></p>
        <p>${escapeHtml(model.message)}</p>
        <p class="source-summary">Nothing is sent from this screen.</p>
      </section>
      ${renderPendingOutboundPanel()}
      ${renderCommunicationPanel(selectedLead)}
      ${renderSequencePanel(selectedLead)}
    `;
    attachOutboundReviewHandlers();
    return;
  }

  outboundView.innerHTML = `
    <div class="intelligence-layout">
      <section class="concept-section">
        <h4>Recommended next step</h4>
        <p><strong>${escapeHtml(model.plan.actionType)}</strong></p>
        <p>${escapeHtml(model.plan.title)}</p>
      </section>
      <section class="concept-section">
        <h4>Review status</h4>
        <div class="fact-grid">
          ${renderFact({ label: "Status", value: model.status === "Blocked" ? "Blocked" : "Needs your review" })}
          ${renderFact({ label: "Data used", value: `${model.plan.evidenceRefCount} available data point${model.plan.evidenceRefCount === 1 ? "" : "s"}` })}
        </div>
      </section>
      <section class="concept-section">
        <h4>Why this is recommended</h4>
        <p>${escapeHtml(model.plan.rationale)}</p>
      </section>
      <section class="concept-section">
        <h4>Outbound</h4>
        <p>Nothing has been sent. Channel sending is a later step after human review.</p>
      </section>
      ${renderApprovalReviewPanel({ model, approvalModel })}
      ${renderCommunicationPanel(selectedLead)}
      ${renderSequencePanel(selectedLead)}
    </div>
  `;
  attachOutboundReviewHandlers();
}

function currentActionForSelectedPlan(selectedLead) {
  const plan = state.nextBestActionByLead[selectedLead?.id]?.next_best_action_plan;
  if (!selectedLead || !plan) {
    return null;
  }
  return selectedLead.actions?.find((action) => action.next_best_action_plan_id === plan.id) || null;
}

function renderApprovalReviewPanel({ model, approvalModel }) {
  if (!approvalModel.hasAction) {
    return `
      <section class="concept-section approval-review">
        <h4>Human review</h4>
        <p>${escapeHtml(approvalModel.message)}</p>
        <button type="button" data-prepare-review ${model.status === "Blocked" ? "disabled" : ""}>Prepare for review</button>
      </section>
    `;
  }

  const controls = approvalModel.canApprove
    ? `
      <label>
        Review note
        <textarea id="approval-note" rows="3" placeholder="Optional note for this decision"></textarea>
      </label>
      <label>
        Suggested edit
        <textarea id="approval-edit" rows="3" placeholder="Optional instruction or edit before approval"></textarea>
      </label>
      <div class="inline-actions">
        <button type="button" data-approve-action>Approve</button>
        <button type="button" data-edit-approve-action>Edit and approve</button>
        <button class="secondary-button" type="button" data-reject-action>Reject</button>
      </div>
    `
    : "";

  return `
    <section class="concept-section approval-review">
      <h4>Human review</h4>
      <div class="fact-grid">
        ${renderFact({ label: "Review status", value: approvalModel.status })}
        ${renderFact({ label: "Action state", value: approvalModel.actionStatus })}
      </div>
      <p>${escapeHtml(approvalModel.message)}</p>
      ${controls}
    </section>
  `;
}

function attachOutboundReviewHandlers() {
  outboundView.querySelector("[data-prepare-review]")?.addEventListener("click", prepareSelectedLeadOutboundAction);
  outboundView.querySelector("[data-approve-action]")?.addEventListener("click", () => approveSelectedLeadAction());
  outboundView.querySelector("[data-edit-approve-action]")?.addEventListener("click", () => approveSelectedLeadAction({ edited: true }));
  outboundView.querySelector("[data-reject-action]")?.addEventListener("click", rejectSelectedLeadAction);
}

function renderPendingOutboundPanel() {
  return `
    <section class="concept-section">
      <h4>Outbound activity</h4>
      <p>No customer outbound activity has been sent from this product yet.</p>
    </section>
  `;
}

function renderCommunicationPanel(selectedLead) {
  const model = buildLeadTimelineModel(state.timelineByLead[selectedLead.id]);
  return `
    <section class="concept-section">
      <h4>Communication and follow-ups</h4>
      ${renderLeadTimeline(model)}
    </section>
  `;
}

function renderSequencePanel(selectedLead) {
  if (state.isLoadingWorkflows) {
    return `
      <section class="concept-section">
        <h4>Follow-up workflow</h4>
        <p>Loading follow-up workflow.</p>
      </section>
    `;
  }
  if (state.workflowLoadError) {
    return `
      <section class="concept-section">
        <h4>Follow-up workflow</h4>
        <p class="error-text">${escapeHtml(state.workflowLoadError.message)}</p>
      </section>
    `;
  }
  const leadRuns = state.workflowRuns.filter((run) => run.lead_id === selectedLead.id);
  return `
    <section class="concept-section">
      <h4>Follow-up workflow</h4>
      <div class="fact-grid">
        ${renderFact({ label: "Sequences", value: String(state.sequences.length) })}
        ${renderFact({ label: "This lead", value: leadRuns.length ? workflowRunStatusText(leadRuns[0].status) : "Not enrolled" })}
      </div>
      ${
        leadRuns.length
          ? `<div class="activity-list">${leadRuns.slice(0, 3).map(renderWorkflowRunItem).join("")}</div>`
          : `<p>No follow-up workflow is active for this lead.</p>`
      }
    </section>
  `;
}

function renderWorkflowRunItem(run) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(run.sequence_name || "Follow-up sequence")}</strong>
      <p>${escapeHtml(workflowRunStatusText(run.status))}</p>
      <p>${escapeHtml(run.stop_reason || `Next step ${run.current_step_order}`)}</p>
    </div>
  `;
}

function renderOutboundActivityPanel(model) {
  if (!model.hasActions) {
    return `
      <section class="concept-section">
        <h4>Outbound activity</h4>
        <p>No customer outbound activity has been sent from this product yet.</p>
      </section>
    `;
  }
  return `
    <section class="concept-section">
      <h4>Outbound activity</h4>
      <div class="activity-list">
        ${model.items.map(renderOutboundActivityItem).join("")}
      </div>
    </section>
  `;
}

function renderOutboundActivityItem(action) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(action.type)} - ${escapeHtml(action.status)}</strong>
      <p>${escapeHtml(action.status === "Waiting for approval" ? "Needs review before anything is sent." : action.latestExecutionStatus)}</p>
      ${action.lastError ? `<p class="error-text">${escapeHtml(action.lastError)}</p>` : ""}
    </div>
  `;
}

function renderSynthesisPanel(model) {
  if (state.isRunningSynthesis) {
    return `
      <section class="concept-section synthesis-section">
        <h4>Lead Intelligence synthesis</h4>
        <p>Preparing evidence-grounded synthesis...</p>
      </section>
    `;
  }
  if (state.synthesisError) {
    return `
      <section class="concept-section synthesis-section">
        <h4>Lead Intelligence synthesis</h4>
        <p class="error-text">${escapeHtml(state.synthesisError.message)}</p>
      </section>
    `;
  }
  if (!model.synthesis) {
    return `
      <section class="concept-section synthesis-section">
        <h4>Lead Intelligence synthesis</h4>
        <p><strong>${escapeHtml(model.status)}</strong></p>
        <p>${escapeHtml(model.message)}</p>
        <p class="source-summary">Uses information already available in this workspace. No external research is run here.</p>
      </section>
    `;
  }
  return `
    <section class="concept-section synthesis-section">
      <h4>Lead Intelligence summary</h4>
      <p><strong>${escapeHtml(model.status)}</strong></p>
      <p>${escapeHtml(model.message)}</p>
      <div class="fact-grid">
        ${renderFact({ label: "Qualification", value: model.synthesis.qualification.outcome })}
        ${renderFact({ label: "Recommendation", value: model.synthesis.recommendation.label })}
        ${renderFact({ label: "Available data points", value: String(model.synthesis.evidenceRefCount) })}
      </div>
      <div class="activity-list">
        ${model.synthesis.findings.slice(0, 6).map(renderSynthesisFinding).join("")}
      </div>
      <p>${escapeHtml(model.synthesis.recommendation.reason)}</p>
    </section>
  `;
}

function renderIntelligenceRecommendationPanel(model) {
  if (state.isRunningIntelligenceRecommendation) {
    return `
      <section class="concept-section">
        <h4>Recommended next step</h4>
        <p>Preparing evidence-backed recommendation...</p>
      </section>
    `;
  }
  if (state.intelligenceRecommendationError) {
    return `
      <section class="concept-section">
        <h4>Recommended next step</h4>
        <p class="error-text">${escapeHtml(state.intelligenceRecommendationError.message)}</p>
      </section>
    `;
  }
  if (!model.intelligenceRecommendation) {
    return `
      <section class="concept-section">
        <h4>Recommended next step</h4>
        <p><strong>${escapeHtml(model.status)}</strong></p>
        <p>${escapeHtml(model.message)}</p>
        <p class="source-summary">This prepares the next recommendation for review. Nothing is sent.</p>
      </section>
    `;
  }
  const recommendation = model.intelligenceRecommendation;
  return `
    <section class="concept-section">
      <h4>Recommended next step</h4>
      <p><strong>${escapeHtml(model.status)}</strong></p>
      <div class="fact-grid">
        ${renderFact({ label: "Attention", value: recommendation.priority.label })}
        ${renderFact({ label: "Segment", value: recommendation.segment.label })}
        ${renderFact({ label: "Available data points", value: String(recommendation.evidenceRefCount) })}
      </div>
      <p><strong>${escapeHtml(recommendation.recommendation.label)}</strong></p>
      <p>${escapeHtml(recommendation.recommendation.reason)}</p>
      <p>${escapeHtml(recommendation.segment.reason)}</p>
      ${
        recommendation.personalizationContext.length === 0
          ? ""
          : `<div class="activity-list">${recommendation.personalizationContext.map(renderPersonalizationFact).join("")}</div>`
      }
    </section>
  `;
}

function renderActivity() {
  if (!state.organizationId) {
    activityView.innerHTML = `<div class="detail-empty">Select a workspace to view activity.</div>`;
    return;
  }
  if (state.isLoadingLeads || state.isLoadingImports || state.isLoadingFollowUps) {
    activityView.innerHTML = `<div class="detail-empty">Loading workspace activity.</div>`;
    return;
  }
  if (state.leadLoadError || state.importLoadError || state.followUpLoadError) {
    activityView.innerHTML = `<div class="detail-empty">Could not load workspace activity.</div>`;
    return;
  }
  activityView.innerHTML = renderRecentActivityItems(buildRecentActivityItems(state.leads, state.imports, state.followUps));
}

function renderLeadConcepts(lead) {
  const model = buildLeadDisplayModel(lead);
  const dataQuality = leadDataQuality(lead);
  const timelineModel = buildLeadTimelineModel(state.timelineByLead[lead.id]);
  return `
    <div class="concept-stack">
      <section class="lead-detail-header">
        <div>
          <h3>${escapeHtml(model.name)}</h3>
          <p>${escapeHtml(model.company)}</p>
          <p>${escapeHtml(model.contact)}</p>
        </div>
        <div class="detail-header-action">
          <span class="status-pill">${escapeHtml(model.statusLabel)}</span>
          <button type="button" data-detail-primary-action>${escapeHtml(model.primaryAction)}</button>
        </div>
      </section>
      <section class="concept-section">
        <h4>Lead information</h4>
        <div class="detail-fields">
          ${detailField("Lead", model.name)}
          ${detailField("Company", model.company)}
          ${detailField("Email", lead.normalized_email || lead.email || "Not provided")}
          ${detailField("Phone", lead.normalized_phone || lead.phone || "Not provided")}
          ${detailField("Source", model.source)}
        </div>
        <details class="normalized-details">
          <summary>View data details</summary>
          <p>${escapeHtml(model.importLabel)}</p>
          <p>${escapeHtml(model.normalizedContact)}</p>
        </details>
      </section>
      <section class="concept-section">
        <h4>Data quality</h4>
        <p><strong>${escapeHtml(model.readinessLabel)}</strong></p>
        <p>${escapeHtml(model.currentAssessment)}</p>
        ${renderDataQuality(dataQuality)}
        ${renderLeadDuplicateWarning(model)}
      </section>
      <section class="concept-section">
        <h4>Lead Intelligence</h4>
        <p><strong>${escapeHtml(model.intelligenceStatus)}</strong></p>
        <p>${escapeHtml(model.summary)}</p>
      </section>
      <section class="concept-section">
        <h4>Next step</h4>
        <p>${escapeHtml(model.recommendedAction)}</p>
      </section>
      <section class="concept-section">
        <h4>Communication and follow-ups</h4>
        ${renderLeadTimeline(timelineModel)}
      </section>
    </div>
  `;
}

function renderLeadTimeline(model) {
  if (state.isLoadingTimeline) {
    return `<p>Loading communication activity.</p>`;
  }
  if (state.timelineLoadError) {
    return `<p class="error-text">${escapeHtml(state.timelineLoadError.message)}</p>`;
  }
  if (!model.hasActivity) {
    return `<p>No communication or follow-up activity recorded yet.</p>`;
  }
  return `
    <div class="activity-list">
      ${model.items.slice(0, 6).map(renderLeadTimelineItem).join("")}
    </div>
  `;
}

function renderLeadTimelineItem(item) {
  const meta = [item.direction, item.channel, item.status].filter(Boolean).join(" - ");
  return `
    <div class="activity-item">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(meta)}</p>
      <p>${escapeHtml(item.message)}</p>
    </div>
  `;
}

function leadDataQuality(lead) {
  return [
    { label: "Name", available: Boolean(lead.name) },
    { label: "Company", available: Boolean(lead.company) },
    { label: "Email", available: Boolean(lead.normalized_email || lead.email) },
    { label: "Phone", available: Boolean(lead.normalized_phone || lead.phone) }
  ];
}

function renderDataQuality(items) {
  return `
    <div class="factor-list">
      ${items
        .map((item) => `<span>${escapeHtml(item.label)}: ${item.available ? "Available" : "Not provided"}</span>`)
        .join("")}
    </div>
  `;
}

function detailField(label, value) {
  return `
    <div class="detail-field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderButtons() {
  const isBusy =
    state.isLoadingOrganizations ||
    state.isLoadingLeads ||
    state.isLoadingImports ||
    state.isLoadingApprovals ||
    state.isLoadingFollowUps ||
    state.isLoadingTimeline ||
    state.isPreviewingImport ||
    state.isCommittingImport ||
    state.isRefreshingIntelligence ||
    state.isRunningSynthesis ||
    state.isRunningIntelligenceRecommendation ||
    state.isPlanningNextBestAction ||
    state.isPreparingOutboundAction ||
    state.isExecutingOutboundAction ||
    state.isCreatingSequence ||
    state.isEnrollingSequence ||
    state.isRunningDueWorkflows ||
    state.isLoadingWorkflows;
  const hasOrganization = Boolean(state.organizationId);
  const hasLead = Boolean(getSelectedLead());
  const selectedLead = getSelectedLead();
  const selectedPlan = state.nextBestActionByLead[selectedLead?.id]?.next_best_action_plan;
  const hasExecutableAction = Boolean(
    selectedLead?.actions.some((action) => ["PLANNED", "APPROVED", "RETRYING"].includes(action.status))
  );
  const hasInProgressAction = Boolean(getSelectedLead()?.actions.some((action) => action.status === "EXECUTING"));

  organizationForm.querySelector("button").disabled = isBusy;
  leadForm.querySelector("button").disabled = isBusy || !hasOrganization;
  importForm.querySelector("button").disabled = isBusy || !hasOrganization;
  showAddLeadButton.disabled = isBusy || !hasOrganization;
  showImportLeadsButton.disabled = isBusy || !hasOrganization;
  refreshIntelligenceButton.disabled = isBusy || !hasLead;
  runSynthesisButton.disabled = isBusy || !hasLead;
  runIntelligenceRecommendationButton.disabled = isBusy || !hasLead;
  planNextBestActionButton.disabled = isBusy || !hasLead;
  if (prepareOutboundActionButton) {
    prepareOutboundActionButton.disabled = isBusy || !selectedPlan;
  }
  if (executeOutboundActionButton) {
    executeOutboundActionButton.disabled = isBusy || !hasExecutableAction;
  }
  organizationSelect.disabled = isBusy || state.organizations.length === 0;
  runWorkerButton.disabled = isBusy || !hasOrganization;
  addRetryActionButton.disabled = isBusy || !hasLead;
  addBlockedActionButton.disabled = isBusy || !hasLead;
  simulateCallbackButton.disabled = isBusy || !hasInProgressAction;
  if (simulateInboundQuestionButton) {
    simulateInboundQuestionButton.disabled = isBusy || !hasLead;
  }
  if (simulateInboundPositiveButton) {
    simulateInboundPositiveButton.disabled = isBusy || !hasLead;
  }
  if (simulateInboundOptOutButton) {
    simulateInboundOptOutButton.disabled = isBusy || !hasLead;
  }
  if (runDueWorkflowsButton) {
    runDueWorkflowsButton.disabled = isBusy || !hasOrganization;
  }
  if (createFollowUpSequenceButton) {
    createFollowUpSequenceButton.disabled = isBusy || !hasOrganization;
  }
  if (enrollLeadSequenceButton) {
    enrollLeadSequenceButton.disabled = isBusy || !hasLead || state.sequences.length === 0;
  }
}

function renderFact(fact) {
  return `
    <div class="fact-item">
      <span>${escapeHtml(fact.label)}</span>
      <strong>${escapeHtml(fact.value)}</strong>
    </div>
  `;
}

function renderEvidence(evidence) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(evidence.title)}</strong>
      <p>${escapeHtml(evidence.source)} - ${escapeHtml(evidence.value)}</p>
      <p>${escapeHtml(evidence.sourceDetail)}</p>
    </div>
  `;
}

function renderSignal(signal) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(signal.label)}</strong>
      <p>${escapeHtml(signal.explanation)}</p>
      <p>${escapeHtml(signal.sourceNote)}</p>
    </div>
  `;
}

function renderSynthesisFinding(finding) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(humanFindingLabel(finding.field))}</strong>
      <p>${escapeHtml(finding.value)}</p>
      <p>${escapeHtml(finding.evidence_refs?.length || 0)} supporting data point${(finding.evidence_refs?.length || 0) === 1 ? "" : "s"}</p>
    </div>
  `;
}

function humanFindingLabel(field) {
  const labels = {
    LEAD_NAME: "Lead name",
    COMPANY_NAME: "Company",
    CONTACT_EMAIL: "Email",
    CONTACT_PHONE: "Phone",
    LEAD_SOURCE: "Source",
    PROVENANCE: "Source details"
  };
  return labels[field] || String(field || "Insight").replaceAll("_", " ").toLowerCase();
}

function renderPersonalizationFact(fact) {
  return `
    <div class="activity-item">
      <strong>${escapeHtml(fact.label)}</strong>
      <p>${escapeHtml(fact.value)}</p>
      <p>${escapeHtml(fact.evidence_refs?.length || 0)} supporting data point${(fact.evidence_refs?.length || 0) === 1 ? "" : "s"}</p>
    </div>
  `;
}

function renderReadinessFactors(factors) {
  if (!factors.length) {
    return `<p>No readiness factors available yet.</p>`;
  }
  return `
    <div class="factor-list">
      ${factors
        .map((factor) => {
          const marker = factor.status === "AVAILABLE" || factor.status === "CLEAR" ? "Available" : "Needs data";
          const value = factor.value ? ` (${factor.value})` : "";
          return `<span>${escapeHtml(marker)}: ${escapeHtml(factor.label)}${escapeHtml(value)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderLeadDuplicateWarning(model) {
  if (!model.duplicateWarning) {
    return `<p>No duplicate warning recorded.</p>`;
  }
  const details = model.duplicateCandidates.length
    ? model.duplicateCandidates.map((candidate) => `<p>${escapeHtml(duplicateMatchLabel(candidate))}</p>`).join("")
    : "";
  return `
    <details class="duplicate-details">
      <summary>${escapeHtml(model.duplicateWarning)}</summary>
      ${details || "<p>Review the original import preview for duplicate details.</p>"}
    </details>
  `;
}

function renderActivityList(activity) {
  if (!activity.length) {
    return `<div class="detail-empty">No real outbound activity yet.</div>`;
  }
  return `
    <div class="activity-list">
      ${activity
        .map((item) => {
          return `
            <div class="activity-item">
              <strong>${escapeHtml(item.leadName)}</strong>
              <p>${escapeHtml(item.actionType)} - ${escapeHtml(actionStatusLabel(item.status))}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function metric(value, label) {
  return `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;
}

function getSelectedLead() {
  return state.leads.find((lead) => lead.id === state.selectedLeadId) || null;
}

function channelForSelectedLead(lead) {
  if (lead.normalized_phone || lead.phone) {
    return "WHATSAPP";
  }
  if (lead.normalized_email || lead.email) {
    return "EMAIL";
  }
  return "VOICE";
}

function inboundPayload(eventType) {
  const messages = {
    QUESTION: { text: "Can you share more details?" },
    POSITIVE_REPLY: { text: "Yes, I am interested." },
    OPT_OUT: { text: "Please stop contacting me." }
  };
  return messages[eventType] || { text: "Inbound response received." };
}

function followUpStatusText(status) {
  const labels = {
    PLANNED: "Follow-up planned",
    DUE: "Follow-up needs attention",
    COMPLETED: "Follow-up completed",
    CANCELLED: "Follow-up stopped",
    BLOCKED: "Follow-up blocked"
  };
  return labels[status] || "Follow-up";
}

function workflowRunStatusText(status) {
  const labels = {
    ACTIVE: "Active",
    WAITING: "Waiting for next step",
    WAITING_APPROVAL: "Waiting for approval",
    COMPLETED: "Completed",
    STOPPED: "Stopped",
    BLOCKED: "Blocked"
  };
  return labels[status] || status || "Not enrolled";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(humanizeApiError(body.error || "Request failed."));
  }
  return body;
}

function humanizeApiError(message) {
  return String(message).replaceAll("organization", "workspace").replaceAll("Organization", "Workspace");
}

async function withStatus(message, operation) {
  setStatus(message, "warn");
  renderButtons();
  try {
    await operation();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    render();
  }
}

function setStatus(message, tone = "") {
  statusBanner.className = `status-banner ${tone}`;
  statusBanner.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
