export const NAV_ITEMS = ["Overview", "Leads", "Intelligence", "Outbound", "Activity"];

export function deriveOrganizationLeadState({ organizationId, isLoading, leads = [], error = null }) {
  if (!organizationId) {
    return {
      kind: "none",
      title: "No workspace selected",
      message: "Select a workspace to view leads."
    };
  }

  if (isLoading) {
    return {
      kind: "loading",
      title: "Loading workspace",
      message: "Loading leads..."
    };
  }

  if (error) {
    return {
      kind: "error",
      title: "Could not load leads",
      message: error.message || String(error)
    };
  }

  if (leads.length === 0) {
    return {
      kind: "empty",
      title: "No leads yet",
      message: "Import your existing lead data or add a lead manually."
    };
  }

  return {
    kind: "ready",
    title: "Leads available",
    message: `${leads.length} lead${leads.length === 1 ? "" : "s"} available.`
  };
}

export function buildOverview(leads = [], { followUps = [] } = {}) {
  const leadCount = leads.length;
  const intelligenceAvailable = leads.filter((lead) => Boolean(lead.intelligence)).length;
  const attentionLeads = leads.filter((lead) => leadNeedsAttention(lead)).length;
  const readyForIntelligence = leads.filter((lead) => intelligenceFilterKey(lead) === "NOT_ANALYZED").length;
  const readyForReview = leads.filter((lead) => attentionKey(lead) === "READY_FOR_OUTBOUND_REVIEW").length;
  const openFollowUps = followUps.filter((item) => ["PLANNED", "DUE"].includes(item.status)).length;

  return {
    leadCount,
    attentionLeads,
    readyForIntelligence,
    readyForReview,
    intelligenceAvailable,
    actionsNeedAttention: openFollowUps,
    recentActivity: []
  };
}

export function buildLeadDisplayModel(lead) {
  const latestAction = lead.actions?.[0] || null;
  const duplicateCount = lead.source_metadata?.duplicate_candidate_count || 0;
  const intelligenceContext = lead.intelligence_context || {};
  const readiness = intelligenceContext.readiness || null;
  const readinessScore = readiness?.score ?? lead.intelligence?.readiness_score ?? lead.intelligence?.score ?? null;
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company || "No company recorded",
    source: sourceLabel(lead.source),
    sourceCode: lead.source,
    contact: lead.email || lead.normalized_phone || lead.phone || "No contact detail",
    normalizedContact: lead.normalized_email || lead.normalized_phone || "No normalized contact recorded",
    importLabel: lead.import_batch_id ? `Imported row ${lead.source_metadata?.row_number || "unknown"}` : "Manual entry",
    duplicateWarning: duplicateCount > 0 ? "Possible duplicate" : null,
    duplicateWarningDetail:
      duplicateCount > 0 ? `${duplicateCount} possible match${duplicateCount === 1 ? "" : "es"} found in your lead data.` : null,
    duplicateCandidates: lead.source_metadata?.duplicate_candidates || [],
    statusLabel: leadStatusLabel(lead.status),
    score: readinessScore,
    readinessScore,
    readinessLabel: readinessStatusLabel(readiness?.technical_status || lead.intelligence?.readiness_status),
    intelligenceFilterKey: intelligenceFilterKey(lead),
    attentionKey: attentionKey(lead),
    intelligenceStatus: intelligenceStatusLabel(intelligenceContext.intelligence_status, lead.intelligence),
    recommendedAction: recommendationLabel(lead.intelligence, intelligenceContext),
    primaryAction: primaryActionForLead(lead),
    summary: lead.intelligence?.summary || "Run Lead Intelligence to analyze the information already available for this lead.",
    currentAssessment: buildCurrentAssessment(lead),
    actionStatus: latestAction ? actionStatusLabel(latestAction.status) : "No action planned",
    latestAction
  };
}

export function deriveIntelligenceState({ lead = null, isLoading = false, error = null }) {
  if (!lead) {
    return {
      kind: "none",
      message: "Select a lead to inspect Lead Intelligence."
    };
  }
  if (isLoading) {
    return {
      kind: "loading",
      message: "Refreshing Lead Intelligence foundation."
    };
  }
  if (error) {
    return {
      kind: "error",
      message: error.message || String(error)
    };
  }
  if (!lead.intelligence && !lead.intelligence_context) {
    return {
      kind: "empty",
      message: "Not analyzed yet. Run intelligence when you are ready."
    };
  }
  return {
    kind: "ready",
    message: "Lead Intelligence foundation is available."
  };
}

export function buildIntelligenceDisplayModel(lead) {
  if (!lead) {
    return null;
  }
  const intelligence = lead.intelligence;
  const context = lead.intelligence_context || {};
  const readiness = context.readiness || {
    status: intelligence?.readiness_status === "READY_FOR_INTELLIGENCE" ? "READY" : "INSUFFICIENT",
    technical_status: intelligence?.readiness_status,
    score: intelligence?.readiness_score ?? intelligence?.score ?? 0,
    factors: [],
    missing: [],
    blocking_reasons: []
  };
  return {
    snapshotId: intelligence?.id || null,
    version: intelligence?.version || null,
    status: intelligenceStatusLabel(context.intelligence_status, intelligence),
    summary: intelligence?.summary || "Run Lead Intelligence to analyze the information already available for this lead.",
    readinessStatus: readinessStatusLabel(readiness.technical_status),
    readinessScore: readiness.score,
    readinessFactors: readiness.factors || [],
    missing: readiness.blocking_reasons || readiness.missing || [],
    confidenceNote: "These details come from your records unless separately added as approved evidence.",
    customerProvided: customerProvidedFacts(lead),
    provenanceSummary: provenanceSummaryForLead(lead),
    claims: (intelligence?.claims || []).map((claim) => ({
      id: claim.id,
      label: claimLabel(claim.field),
      value: formatClaimValue(claim.value),
      sourceNote: sourceNoteForLead(lead),
      evidenceCount: claim.evidence_ids?.length || 0
    })),
    evidence: (intelligence?.evidence || []).map((evidence) => ({
      id: evidence.id,
      title: evidence.title || evidence.claim_field || "Evidence",
      source: sourceLabel(evidence.source_type),
      value: evidence.claim_value || "Recorded source",
      sourceDetail: humanEvidenceSource(evidence, lead)
    })),
    signals: (intelligence?.signals || []).map((signal) => ({
      id: signal.id,
      label: signalLabel(signal.type),
      explanation: signal.explanation,
      sourceNote: "Derived from stored lead data"
    })),
    qualification: intelligence?.qualification
      ? {
          status: qualificationStatusLabel(intelligence.qualification.status),
          reasons: intelligence.qualification.reasons || []
        }
      : null,
    recommendation: {
      label: recommendationLabel(intelligence, context),
      reason:
        intelligence?.recommendation?.reason ||
        (context.intelligence_status === "NOT_RUN"
          ? "The lead has not been analyzed yet."
          : "Add more customer-provided information before intelligence can be useful."),
      sourceNote: intelligence ? "Based on available lead data" : "No recommendation yet"
    }
  };
}

export function buildSynthesisDisplayModel(synthesisState = null) {
  if (!synthesisState) {
    return {
      status: "Not checked",
      message: "Prepare insights after Lead Intelligence is available.",
      synthesis: null
    };
  }
  if (synthesisState.synthesis_status === "NOT_READY") {
    return {
      status: "Not ready",
      message: synthesisState.reason || "Run Lead Intelligence before synthesis.",
      synthesis: null
    };
  }
  if (synthesisState.synthesis_status === "NOT_RUN") {
    return {
      status: "Not synthesized yet",
      message: synthesisState.reason || "Prepare insights to review findings and qualification.",
      synthesis: null
    };
  }
  if (synthesisState.synthesis_status === "FAILED") {
    return {
      status: "Failed",
      message: "Synthesis failed. Retry after checking the lead intelligence evidence.",
      synthesis: null
    };
  }
  const synthesis = synthesisState.synthesis;
  return {
    status: synthesisStatusLabel(synthesis?.status),
    message: synthesis?.summary?.text || "Synthesis is available.",
    synthesis: synthesis
      ? {
          id: synthesis.id,
          version: synthesis.version,
          findings: synthesis.findings || [],
          qualification: {
            outcome: qualificationOutcomeLabel(synthesis.qualification?.outcome),
            reasons: synthesis.qualification?.reasons || []
          },
          recommendation: {
            label: synthesisRecommendationLabel(synthesis.recommendation?.type),
            reason: synthesis.recommendation?.reason || "No synthesis recommendation recorded."
          },
          evidenceRefCount: synthesis.evidence_refs?.length || 0
        }
      : null
  };
}

export function buildIntelligenceRecommendationDisplayModel(recommendationState = null) {
  if (!recommendationState) {
    return {
      status: "Not checked",
      message: "Prepare a recommendation after insights are available.",
      intelligenceRecommendation: null
    };
  }
  if (recommendationState.recommendation_status === "NOT_READY") {
    return {
      status: "Not ready",
      message: recommendationState.reason || "Prepare insights before creating a recommendation.",
      intelligenceRecommendation: null
    };
  }
  if (recommendationState.recommendation_status === "NOT_RUN") {
    return {
      status: "Not recommended yet",
      message: recommendationState.reason || "Prepare the next recommended step for review.",
      intelligenceRecommendation: null
    };
  }
  if (recommendationState.recommendation_status === "FAILED") {
    return {
      status: "Failed",
      message: "Recommendation failed. Retry after checking synthesis.",
      intelligenceRecommendation: null
    };
  }
  const recommendation = recommendationState.intelligence_recommendation;
  return {
    status: recommendationStatusLabel(recommendation?.status),
    message: recommendation?.recommendation?.reason || "Recommendation is available.",
    intelligenceRecommendation: recommendation
      ? {
          id: recommendation.id,
          version: recommendation.version,
          priority: {
            score: recommendation.priority?.score ?? 0,
            label: recommendation.priority?.label || "Not scored"
          },
          segment: {
            label: recommendation.segment?.label || recommendation.segment?.type || "Not segmented",
            reason: recommendation.segment?.reason || "No segment reason recorded."
          },
          personalizationContext: recommendation.personalization_context || [],
          recommendation: {
            label: recommendation.recommendation?.label || recommendation.recommendation?.step || "No next step",
            reason: recommendation.recommendation?.reason || "No recommendation reason recorded."
          },
          evidenceRefCount: recommendation.evidence_refs?.length || 0
        }
      : null
  };
}

export function buildNextBestActionPlanDisplayModel(planState = null) {
  if (!planState) {
    return {
      status: "Not checked",
      message: "Plan the next best action after recommendation intelligence is available.",
      plan: null
    };
  }
  if (planState.plan_status === "NOT_READY") {
    return {
      status: "Not ready",
      message: planState.reason || "Prepare a recommendation before planning the next step.",
      plan: null
    };
  }
  if (planState.plan_status === "NOT_RUN") {
    return {
      status: "Not planned yet",
      message: planState.reason || "Plan the next best action for review.",
      plan: null
    };
  }
  if (planState.plan_status === "FAILED") {
    return {
      status: "Failed",
      message: "Next-best-action planning failed. Retry after checking recommendation intelligence.",
      plan: null
    };
  }
  const plan = planState.next_best_action_plan;
  return {
    status: nextBestActionStatusLabel(plan?.status),
    message: plan?.rationale || "Next-best-action plan is available.",
    plan: plan
      ? {
          id: plan.id,
          version: plan.version,
          actionType: nextBestActionLabel(plan.action_type),
          title: plan.title,
          rationale: plan.rationale,
          policyDecision: policyDecisionLabel(plan.policy_decision?.decision),
          policyReasons: plan.policy_decision?.reasons || [],
          approvalRequirement: approvalRequirementLabel(plan.approval?.requirement),
          approvalReason: plan.approval?.reason || "",
          executable: plan.execution_contract?.executable === true,
          executionNote: plan.execution_contract?.reason || "Planning only. No outbound execution is created.",
          evidenceRefCount: plan.decision_evidence_refs?.length || 0
        }
      : null
  };
}

export function buildApprovalDisplayModel(action = null) {
  if (!action) {
    return {
      hasAction: false,
      status: "Not prepared",
      message: "Prepare the recommended step for human review when you are ready.",
      canApprove: false,
      canReject: false,
      canEditAndApprove: false
    };
  }

  const approval = action.approval || null;
  if (action.approval_requirement !== "REQUIRED") {
    return {
      hasAction: true,
      actionId: action.id,
      actionStatus: actionStatusLabel(action.status),
      status: "No approval required",
      message: "This recommended step can proceed without a separate approval request.",
      canApprove: false,
      canReject: false,
      canEditAndApprove: false
    };
  }

  if (!approval || approval.status === "PENDING") {
    return {
      hasAction: true,
      actionId: action.id,
      actionStatus: actionStatusLabel(action.status),
      status: "Needs your approval",
      message: approval?.requested_reason || "Review this recommended step before it can proceed.",
      canApprove: true,
      canReject: true,
      canEditAndApprove: true
    };
  }

  if (approval.status === "APPROVED") {
    return {
      hasAction: true,
      actionId: action.id,
      actionStatus: actionStatusLabel(action.status),
      status: "Approved",
      message: approval.edited_payload ? "Approved with reviewer edits." : "Approved for the next outbound step.",
      canApprove: false,
      canReject: false,
      canEditAndApprove: false
    };
  }

  if (approval.status === "REJECTED") {
    return {
      hasAction: true,
      actionId: action.id,
      actionStatus: actionStatusLabel(action.status),
      status: "Rejected",
      message: approval.reviewer_note || "This recommended step was rejected during human review.",
      canApprove: false,
      canReject: false,
      canEditAndApprove: false
    };
  }

  return {
    hasAction: true,
    actionId: action.id,
    actionStatus: actionStatusLabel(action.status),
    status: approval.status,
    message: "Review state is available.",
    canApprove: false,
    canReject: false,
    canEditAndApprove: false
  };
}

export function buildApprovalQueueModel(approvals = []) {
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  return {
    pendingCount: pending.length,
    items: pending.slice(0, 5).map((approval) => ({
      id: approval.id,
      actionId: approval.action_id,
      leadId: approval.lead_id,
      leadName: approval.lead_name || "Lead",
      company: approval.lead_company || "No company recorded",
      actionType: actionTypeLabel(approval.action_type),
      requestedReason: approval.requested_reason || "Review required before this step can proceed."
    }))
  };
}

export function buildOutboundActivityModel(actions = []) {
  const items = actions.map((action) => {
    const latestExecution = action.executions?.[action.executions.length - 1] || null;
    return {
      id: action.id,
      type: actionTypeLabel(action.type),
      status: actionStatusLabel(action.status),
      statusCode: action.status,
      approvalRequirement: approvalRequirementLabel(action.approval_requirement),
      sourcePlanId: action.next_best_action_plan_id || null,
      executionCount: action.executions?.length || 0,
      callbackCount: action.callbacks?.length || 0,
      latestExecutionStatus: latestExecution ? executionStatusLabel(latestExecution.status) : "Not started",
      lastError: action.last_error || latestExecution?.error || null
    };
  });
  return {
    hasActions: items.length > 0,
    currentAction: items[0] || null,
    items
  };
}

export function buildFollowUpQueueModel(followUps = []) {
  const open = followUps.filter((item) => ["PLANNED", "DUE"].includes(item.status));
  return {
    openCount: open.length,
    items: open.slice(0, 6).map((item) => ({
      id: item.id,
      leadId: item.lead_id,
      leadName: item.lead_name || "Lead",
      company: item.lead_company || "No company recorded",
      channel: channelLabel(item.channel),
      status: followUpStatusLabel(item.status),
      reason: item.reason,
      dueAt: item.due_at
    }))
  };
}

export function buildLeadTimelineModel(timelineState = null) {
  const timeline = timelineState?.timeline || [];
  return {
    hasActivity: timeline.length > 0,
    items: timeline.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title || timelineTitle(item),
      message: item.message || "Activity recorded.",
      channel: item.channel ? channelLabel(item.channel) : null,
      direction: item.direction ? directionLabel(item.direction) : null,
      status: item.kind === "follow_up" ? followUpStatusLabel(item.status) : channelMessageStatusLabel(item.status),
      occurredAt: item.occurred_at
    }))
  };
}

export function deriveImportHistoryState({ organizationId, isLoading, imports = [], error = null }) {
  if (!organizationId) {
    return {
      kind: "none",
      message: "Select a workspace to view import history."
    };
  }
  if (isLoading) {
    return {
      kind: "loading",
      message: "Loading import history."
    };
  }
  if (error) {
    return {
      kind: "error",
      message: error.message || String(error)
    };
  }
  if (imports.length === 0) {
    return {
      kind: "empty",
      message: "No CSV imports yet."
    };
  }
  return {
    kind: "ready",
    message: `${imports.length} import${imports.length === 1 ? "" : "s"} available.`
  };
}

export function buildImportPreviewModel(importDetail) {
  if (!importDetail) {
    return null;
  }
  const rows = importDetail.rows || [];
  return {
    id: importDetail.import.id,
    state: importDetail.import.state,
    stateLabel: importStateLabel(importDetail.import.state),
    summary: importDetail.import.summary,
    validRows: rows.filter((row) => row.validation_state === "VALID"),
    invalidRows: rows.filter((row) => row.validation_state === "INVALID"),
    duplicateRows: rows.filter((row) => row.duplicate_candidates.length > 0),
    rows
  };
}

export function buildImportReviewSummary(importDetail, selectedRowIds = new Set()) {
  const model = buildImportPreviewModel(importDetail);
  if (!model) {
    return null;
  }
  return {
    totalRows: model.rows.length,
    readyToImport: model.validRows.length,
    needAttention: model.invalidRows.length,
    duplicateWarnings: model.rows.reduce((count, row) => count + row.duplicate_candidates.length, 0),
    selectedRows: selectedRowIds.size,
    importedRows: model.rows.filter((row) => row.committed).length,
    stateLabel: model.stateLabel
  };
}

export function importRowPresentation(row, allRows = []) {
  const values = row.normalized_values;
  return {
    id: row.id,
    rowNumber: row.row_number,
    identity: values.name || values.company || values.email || values.normalized_phone || "Unusable row",
    company: values.company || "No company",
    contact: values.email || values.normalized_phone || "No usable contact",
    stateLabel: row.committed ? "Imported" : row.validation_state === "VALID" ? "Ready to import" : "Needs attention",
    selectable: row.validation_state === "VALID" && !row.committed,
    duplicateSummary: duplicateSummary(row.duplicate_candidates),
    duplicateGroups: groupDuplicateCandidates(row.duplicate_candidates, allRows),
    normalizedValues: [
      {
        label: "Email",
        original: row.mapped_values?.email || null,
        stored: values.email || null
      },
      {
        label: "Phone",
        original: values.raw_phone || row.mapped_values?.phone || null,
        stored: values.normalized_phone || null
      }
    ].filter((item) => item.original || item.stored)
  };
}

export function humanImportIssue(issue) {
  if (issue.issue_type === "INVALID_PHONE") {
    return {
      title: "Phone number needs attention",
      message:
        issue.field === "phone"
          ? "This number is not valid for the selected phone region. Use a local number for that region or an international number beginning with +."
          : issue.message
    };
  }
  if (issue.issue_type === "INVALID_EMAIL") {
    return {
      title: "Email needs attention",
      message: "This email address is not valid. Check the address and preview the file again."
    };
  }
  if (issue.issue_type === "INSUFFICIENT_IDENTITY") {
    return {
      title: "Lead information is incomplete",
      message: "Add a name or company with a usable email or phone number."
    };
  }
  if (issue.issue_type === "DUPLICATE_CANDIDATE") {
    return {
      title: "Duplicate warning",
      message: "This row may already represent someone in your data."
    };
  }
  return {
    title: issue.severity === "ERROR" ? "Needs attention" : "Review note",
    message: issue.message
  };
}

export function importStateLabel(state) {
  const labels = {
    UPLOADED: "Uploaded",
    PREVIEWED: "Ready to review",
    READY_TO_COMMIT: "Ready to review",
    COMMITTING: "Importing",
    COMMITTED: "Completed",
    FAILED: "Failed"
  };
  return labels[state] || state;
}

export function filterLeadDisplayModels(leads, { search = "", source = "", status = "", intelligence = "", attention = "" } = {}) {
  const searchTerm = search.trim().toLowerCase();
  return leads
    .filter((lead) => !source || lead.source === source)
    .filter((lead) => !status || lead.status === status)
    .filter((lead) => !intelligence || intelligenceFilterKey(lead) === intelligence)
    .filter((lead) => !attention || attentionKey(lead) === attention)
    .filter((lead) => {
      if (!searchTerm) {
        return true;
      }
      return [lead.name, lead.company, lead.email, lead.phone, lead.normalized_email, lead.normalized_phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchTerm));
    })
    .map((lead) => buildLeadDisplayModel(lead));
}

export function leadNeedsAttention(lead) {
  if (!lead.intelligence) {
    return true;
  }
  return lead.intelligence_context?.intelligence_status === "NEEDS_DATA";
}

function intelligenceFilterKey(lead) {
  const status = lead.intelligence_context?.intelligence_status;
  const readiness = lead.intelligence_context?.readiness?.technical_status || lead.intelligence?.readiness_status;
  if (status === "GENERATED" || lead.intelligence) {
    return "READY";
  }
  if (readiness === "NEEDS_MORE_DATA" || status === "NEEDS_DATA") {
    return "NEEDS_MORE_DATA";
  }
  return "NOT_ANALYZED";
}

function attentionKey(lead) {
  if ((lead.source_metadata?.duplicate_candidate_count || 0) > 0) {
    return "DUPLICATE";
  }
  const recommendationStep =
    lead.intelligence_context?.recommendation?.action_type ||
    lead.intelligence?.recommendation?.action_type ||
    lead.intelligence?.next_best_action;
  if (recommendationStep === "PREPARE_OUTBOUND_REVIEW" || recommendationStep === "READY_FOR_RESEARCH") {
    return "READY_FOR_OUTBOUND_REVIEW";
  }
  if (leadNeedsAttention(lead)) {
    return "NEEDS_ATTENTION";
  }
  return "";
}

function primaryActionForLead(lead) {
  if (!lead.intelligence) {
    return "Run intelligence";
  }
  if ((lead.source_metadata?.duplicate_candidate_count || 0) > 0) {
    return "Review duplicate";
  }
  const recommendation = recommendationLabel(lead.intelligence, lead.intelligence_context || {});
  if (recommendation === "Lead Intelligence is ready") {
    return "Review recommendation";
  }
  return recommendation;
}

export function actionNeedsAttention(action) {
  return ["PLANNED", "AWAITING_APPROVAL", "RETRYING", "BLOCKED", "FAILED"].includes(action.status);
}

export function leadStatusLabel(status) {
  const labels = {
    NEW: "New",
    NORMALIZED: "Data normalized",
    ACTIVE: "Active",
    FAILED: "Failed",
    SUPPRESSED: "Suppressed",
    OPTED_OUT: "Opted out"
  };
  return labels[status] || status;
}

export function sourceLabel(source) {
  const labels = {
    CUSTOMER_PROVIDED: "Customer provided",
    MANUAL: "Manual",
    CSV: "CSV",
    GOOGLE_SHEETS: "Google Sheets",
    CRM: "CRM",
    WEBSITE: "Website",
    FORM: "Form",
    DATABASE: "Customer database",
    DISCOVERY: "Discovery",
    EXTERNAL_PROVIDER: "External provider"
  };
  return labels[source] || source;
}

export function readinessStatusLabel(status) {
  const labels = {
    READY_FOR_INTELLIGENCE: "Ready",
    NEEDS_MORE_DATA: "Needs more data"
  };
  return labels[status] || "Not assessed";
}

export function recommendationLabel(intelligence, context = {}) {
  const recommendation = intelligence?.recommendation?.action_type || intelligence?.next_best_action || null;
  if (!recommendation && context.intelligence_status === "NOT_RUN") {
    return "Run intelligence";
  }
  const labels = {
    GATHER_MORE_DATA: "Gather more data",
    REVIEW_LEAD: "Review lead",
    READY_FOR_RESEARCH: "Lead Intelligence is ready",
    READY_FOR_DEEPER_INTELLIGENCE: "Lead Intelligence is ready",
    RUN_INTELLIGENCE: "Run intelligence",
    HUMAN_REVIEW: "Human review",
    SEND_EMAIL: "Review lead data",
    SEND_WHATSAPP: "Review lead data",
    CREATE_HUMAN_TASK: "Review lead",
    RUN_RESEARCH: "Gather more data",
    WAIT: "Wait"
  };
  return recommendation ? labels[recommendation] || recommendation : "Run intelligence";
}

function duplicateSummary(candidates = []) {
  if (candidates.length === 0) {
    return null;
  }
  return `Duplicate warning - ${candidates.length} match${candidates.length === 1 ? "" : "es"}`;
}

function groupDuplicateCandidates(candidates = [], allRows = []) {
  return {
    existingLeads: candidates.filter((candidate) => candidate.matched_lead_id),
    previewRows: candidates
      .filter((candidate) => candidate.matched_import_row_id)
      .map((candidate) => ({
        ...candidate,
        matched_row_number: allRows.find((row) => row.id === candidate.matched_import_row_id)?.row_number || null
      }))
  };
}

export function actionStatusLabel(status) {
  const labels = {
    PLANNED: "Recommended",
    AWAITING_APPROVAL: "Waiting for approval",
    APPROVED: "Approved",
    RETRYING: "Needs retry",
    EXECUTING: "In progress",
    COMPLETED: "Completed",
    FAILED: "Failed",
    BLOCKED: "Blocked"
  };
  return labels[status] || status;
}

function actionTypeLabel(type) {
  const labels = {
    SEND_EMAIL: "Email action",
    SEND_WHATSAPP: "WhatsApp action",
    CREATE_HUMAN_TASK: "Human task",
    UPDATE_CRM: "CRM update",
    RUN_RESEARCH: "Research task",
    WAIT: "Wait"
  };
  return labels[type] || type || "Action";
}

export function channelLabel(channel) {
  const labels = {
    EMAIL: "Email",
    WHATSAPP: "WhatsApp",
    SMS: "SMS",
    VOICE: "Voice",
    HUMAN_TASK: "Human task",
    CRM: "CRM"
  };
  return labels[channel] || channel || "Channel";
}

function directionLabel(direction) {
  const labels = {
    OUTBOUND: "Outbound",
    INBOUND: "Inbound"
  };
  return labels[direction] || direction || "Activity";
}

function channelMessageStatusLabel(status) {
  const labels = {
    QUEUED: "Queued",
    SENT: "Sent",
    DELIVERED: "Completed",
    FAILED: "Failed",
    RECEIVED: "Received",
    COMPLETED: "Completed"
  };
  return labels[status] || status || "Recorded";
}

function followUpStatusLabel(status) {
  const labels = {
    PLANNED: "Planned",
    DUE: "Needs attention",
    COMPLETED: "Completed",
    CANCELLED: "Stopped",
    BLOCKED: "Blocked"
  };
  return labels[status] || status || "Planned";
}

function timelineTitle(item) {
  if (item.kind === "follow_up") {
    return "Follow-up";
  }
  return `${directionLabel(item.direction)} ${channelLabel(item.channel)}`;
}

function executionStatusLabel(status) {
  const labels = {
    STARTED: "Started",
    COMPLETED: "Completed",
    FAILED: "Failed"
  };
  return labels[status] || status || "Not started";
}

function intelligenceStatusLabel(status, intelligence = null) {
  const labels = {
    NOT_RUN: "Not analyzed yet",
    READY_TO_RUN: "Ready to analyze",
    GENERATED: "Intelligence available",
    NEEDS_DATA: "Needs more data",
    FAILED: "Failed"
  };
  if (status) {
    return labels[status] || status;
  }
  return intelligence ? "Intelligence available" : "Not analyzed yet";
}

function buildCurrentAssessment(lead) {
  if (!lead.intelligence) {
    if (lead.intelligence_context?.readiness?.status === "READY") {
      return "This lead has enough information to run Lead Intelligence.";
    }
    return "This lead needs more information before Lead Intelligence can continue.";
  }

  if (lead.intelligence.readiness_status === "READY_FOR_INTELLIGENCE" || lead.intelligence.readiness_score >= 60) {
    return "This lead has enough name, company, or contact information for Lead Intelligence.";
  }

  return "This lead needs more information before Lead Intelligence can continue.";
}

function claimLabel(field) {
  const labels = {
    LEAD_NAME: "Lead name",
    COMPANY_NAME: "Company",
    CONTACT_EMAIL: "Email",
    CONTACT_PHONE: "Phone",
    LEAD_SOURCE: "Source",
    PROVENANCE: "Provenance"
  };
  return labels[field] || field;
}

function signalLabel(type) {
  const labels = {
    CONTACT_INFORMATION_AVAILABLE: "Contact information available",
    COMPANY_PROVIDED: "Company provided",
    COMPANY_MISSING: "Company missing",
    EMAIL_AVAILABLE: "Email available",
    PHONE_AVAILABLE: "Phone available",
    DUPLICATE_WARNING: "Duplicate warning",
    DATA_INCOMPLETE: "Data incomplete",
    PROVENANCE_AVAILABLE: "Provenance available"
  };
  return labels[type] || type;
}

function qualificationStatusLabel(status) {
  const labels = {
    FOUNDATION_READY: "Data foundation ready",
    NEEDS_REVIEW: "Needs review"
  };
  return labels[status] || "Not assessed";
}

function synthesisStatusLabel(status) {
  const labels = {
    READY: "Synthesis available",
    DRAFT: "Preparing synthesis",
    SUPERSEDED: "Previous synthesis",
    FAILED: "Failed"
  };
  return labels[status] || "Not synthesized yet";
}

function qualificationOutcomeLabel(outcome) {
  const labels = {
    READY_FOR_DEEPER_INTELLIGENCE: "Lead Intelligence is ready",
    NEEDS_MORE_DATA: "Needs more data",
    NEEDS_REVIEW: "Needs review"
  };
  return labels[outcome] || "Not qualified";
}

function synthesisRecommendationLabel(type) {
  const labels = {
    GATHER_MORE_DATA: "Gather more data",
    REVIEW_LEAD_INTELLIGENCE: "Review Lead Intelligence",
    READY_FOR_DEEPER_INTELLIGENCE: "Ready for outbound review"
  };
  return labels[type] || "No recommendation";
}

function recommendationStatusLabel(status) {
  const labels = {
    READY: "Recommendation available",
    DRAFT: "Preparing recommendation",
    SUPERSEDED: "Previous recommendation",
    FAILED: "Failed"
  };
  return labels[status] || "Not recommended yet";
}

function nextBestActionStatusLabel(status) {
  const labels = {
    PLANNED: "Plan ready",
    BLOCKED: "Blocked",
    DRAFT: "Preparing plan",
    SUPERSEDED: "Previous plan",
    FAILED: "Failed"
  };
  return labels[status] || "Not planned yet";
}

function nextBestActionLabel(actionType) {
  const labels = {
    GATHER_MORE_DATA: "Gather more data",
    REVIEW_DUPLICATE_CANDIDATE: "Review duplicate candidate",
    REVIEW_LEAD_INTELLIGENCE: "Review Lead Intelligence",
    PREPARE_OUTBOUND_REVIEW: "Prepare outbound review"
  };
  return labels[actionType] || actionType || "No action planned";
}

function policyDecisionLabel(decision) {
  const labels = {
    ALLOW: "Allowed",
    REQUIRE_HUMAN_APPROVAL: "Needs human approval",
    BLOCK: "Blocked"
  };
  return labels[decision] || "Not checked";
}

function approvalRequirementLabel(requirement) {
  const labels = {
    NOT_REQUIRED: "Not required",
    REQUIRED: "Required",
    BLOCKED: "Blocked"
  };
  return labels[requirement] || "Not checked";
}

function formatClaimValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function customerProvidedFacts(lead) {
  const sourceNote = sourceNoteForLead(lead);
  return [
    { label: "Name", value: lead.name || "Not provided", sourceNote },
    { label: "Company", value: lead.company || "Not provided", sourceNote },
    { label: "Email", value: lead.normalized_email || lead.email || "Not provided", sourceNote },
    { label: "Phone", value: lead.normalized_phone || lead.phone || "Not provided", sourceNote },
    { label: "Source", value: sourceLabel(lead.source), sourceNote },
    {
      label: "Import",
      value: lead.import_batch_id ? `${lead.source_metadata?.filename || "CSV import"}, row ${lead.source_metadata?.row_number || "unknown"}` : "Manual entry",
      sourceNote
    }
  ];
}

function sourceNoteForLead(lead) {
  return lead.source === "CSV" ? "Provided by customer CSV" : "Provided by customer";
}

function humanEvidenceSource(evidence, lead) {
  if (lead.source === "CSV") {
    const filename = lead.source_metadata?.filename || evidence.metadata?.filename || "CSV import";
    const rowNumber = lead.source_metadata?.row_number || evidence.metadata?.row_number || null;
    const row = rowNumber ? `row ${rowNumber}` : "import row";
    return `${filename}, ${row}`;
  }
  if (evidence.source_type === "MANUAL") {
    return "Manual entry";
  }
  return sourceLabel(evidence.source_type);
}

function provenanceSummaryForLead(lead) {
  if (lead.source === "CSV") {
    const filename = lead.source_metadata?.filename || "CSV import";
    const rowNumber = lead.source_metadata?.row_number || null;
    return rowNumber ? `Source: CSV import - ${filename} - row ${rowNumber}` : `Source: CSV import - ${filename}`;
  }
  return "Source: Manual entry";
}
