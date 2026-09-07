import test from "node:test";
import assert from "node:assert/strict";
import {
  buildApprovalDisplayModel,
  buildApprovalQueueModel,
  buildFollowUpQueueModel,
  buildIntelligenceDisplayModel,
  buildImportPreviewModel,
  buildImportReviewSummary,
  buildIntelligenceRecommendationDisplayModel,
  buildLeadDisplayModel,
  buildLeadTimelineModel,
  buildNextBestActionPlanDisplayModel,
  buildOutboundActivityModel,
  buildOverview,
  buildSynthesisDisplayModel,
  deriveIntelligenceState,
  deriveImportHistoryState,
  deriveOrganizationLeadState,
  filterLeadDisplayModels,
  humanImportIssue,
  importRowPresentation,
  importStateLabel,
  NAV_ITEMS
} from "../public/uiState.js";

test("navigation exposes product concepts", () => {
  assert.deepEqual(NAV_ITEMS, ["Overview", "Leads", "Intelligence", "Outbound", "Activity"]);
});

test("organization lead state handles no organization selected", () => {
  const state = deriveOrganizationLeadState({
    organizationId: null,
    isLoading: false,
    leads: []
  });

  assert.equal(state.kind, "none");
  assert.equal(state.message, "Select a workspace to view leads.");
});

test("organization lead state handles selected organization loading", () => {
  const state = deriveOrganizationLeadState({
    organizationId: "org_1",
    isLoading: true,
    leads: []
  });

  assert.equal(state.kind, "loading");
  assert.equal(state.message, "Loading leads...");
});

test("organization lead state handles selected organization with zero leads", () => {
  const state = deriveOrganizationLeadState({
    organizationId: "org_1",
    isLoading: false,
    leads: []
  });

  assert.equal(state.kind, "empty");
  assert.match(state.message, /Import your existing lead data/);
});

test("organization lead state handles successful lead loading", () => {
  const state = deriveOrganizationLeadState({
    organizationId: "org_1",
    isLoading: false,
    leads: [{ id: "lead_1" }]
  });

  assert.equal(state.kind, "ready");
  assert.match(state.message, /1 lead/);
});

test("organization lead state handles lead loading failure", () => {
  const state = deriveOrganizationLeadState({
    organizationId: "org_1",
    isLoading: false,
    leads: [],
    error: new Error("Network unavailable")
  });

  assert.equal(state.kind, "error");
  assert.equal(state.message, "Network unavailable");
});

test("overview metrics keep M0 mock executions out of customer activity", () => {
  const overview = buildOverview([
    {
      name: "Ready Lead",
      intelligence: { score: 64, next_best_action: "SEND_EMAIL" },
      actions: [{ type: "SEND_EMAIL", status: "COMPLETED", updated_at: "2026-09-06T00:00:02.000Z" }]
    },
    {
      name: "Needs Work",
      intelligence: null,
      actions: [{ type: "SEND_EMAIL", status: "RETRYING", updated_at: "2026-09-06T00:00:03.000Z" }]
    }
  ]);

  assert.equal(overview.leadCount, 2);
  assert.equal(overview.attentionLeads, 1);
  assert.equal(overview.intelligenceAvailable, 1);
  assert.equal(overview.actionsNeedAttention, 0);
  assert.deepEqual(overview.recentActivity, []);
});

test("overview metrics keep execution-foundation actions out of customer dashboard activity", () => {
  const overview = buildOverview([
    {
      name: "Outbound Lead",
      intelligence: { score: 70 },
      actions: [
        {
          type: "SEND_EMAIL",
          status: "AWAITING_APPROVAL",
          next_best_action_plan_id: "nba_1",
          updated_at: "2026-09-07T00:00:01.000Z"
        }
      ]
    }
  ]);

  assert.equal(overview.actionsNeedAttention, 0);
  assert.deepEqual(overview.recentActivity, []);
});

test("lead display model uses product-facing labels", () => {
  const model = buildLeadDisplayModel({
    id: "lead_1",
    name: "Asha Mehta",
    company: "Northstar Interiors",
    source: "MANUAL",
    status: "NORMALIZED",
    intelligence_context: {
      intelligence_status: "GENERATED",
      readiness: {
        status: "READY",
        technical_status: "READY_FOR_INTELLIGENCE",
        score: 64
      }
    },
    intelligence: {
      score: 64,
      next_best_action: "CREATE_HUMAN_TASK",
      summary: "Contact information is available.",
      recommendation: {
        action_type: "READY_FOR_RESEARCH"
      }
    },
    actions: [{ type: "SEND_EMAIL", status: "EXECUTING" }]
  });

  assert.equal(model.statusLabel, "Data normalized");
  assert.equal(model.intelligenceStatus, "Intelligence available");
  assert.equal(model.actionStatus, "In progress");
  assert.equal(model.recommendedAction, "Lead Intelligence is ready");
  assert.equal(model.readinessLabel, "Ready");
  assert.equal(model.source, "Manual");
  assert.equal(model.primaryAction, "Review recommendation");
});

test("intelligence state distinguishes selection, loading, empty, error, and ready", () => {
  assert.equal(deriveIntelligenceState({ lead: null }).kind, "none");
  assert.equal(deriveIntelligenceState({ lead: { id: "lead_1" }, isLoading: true }).kind, "loading");
  assert.equal(deriveIntelligenceState({ lead: { id: "lead_1" } }).kind, "empty");
  assert.equal(deriveIntelligenceState({ lead: { id: "lead_1" }, error: new Error("Unable") }).kind, "error");
  assert.equal(deriveIntelligenceState({ lead: { id: "lead_1", intelligence: { id: "intel_1" } } }).kind, "ready");
  assert.equal(
    deriveIntelligenceState({
      lead: {
        id: "lead_1",
        intelligence: null,
        intelligence_context: {
          intelligence_status: "NOT_RUN",
          readiness: { status: "READY", technical_status: "READY_FOR_INTELLIGENCE" }
        }
      }
    }).kind,
    "ready"
  );
});

test("intelligence display model exposes readiness, evidence, claims, signals, qualification, and recommendation", () => {
  const model = buildIntelligenceDisplayModel({
    id: "lead_1",
    name: "Priya Sharma",
    company: "Northstar Interiors",
    email: "priya@example.com",
    source: "CSV",
    source_metadata: {
      filename: "evidence.csv",
      row_number: 4
    },
    intelligence_context: {
      intelligence_status: "GENERATED",
      readiness: {
        status: "READY",
        technical_status: "READY_FOR_INTELLIGENCE",
        score: 85,
        factors: [{ key: "email", label: "Email available", status: "AVAILABLE", value: "priya@example.com" }],
        blocking_reasons: []
      }
    },
    intelligence: {
      id: "intel_1",
      version: 2,
      status: "READY",
      summary: "Customer-owned data is ready.",
      readiness_status: "READY_FOR_INTELLIGENCE",
      readiness_score: 85,
      claims: [
        {
          id: "claim_1",
          field: "CONTACT_EMAIL",
          value: "priya@example.com",
          confidence: "HIGH",
          evidence_ids: ["evidence_1"]
        }
      ],
      evidence: [
        {
          id: "evidence_1",
          title: "Customer-provided email",
          source_type: "CSV",
          claim_value: "priya@example.com",
          confidence: "HIGH",
          source_reference: "import_1:row_1",
          metadata: {
            filename: "evidence.csv",
            row_number: 4
          }
        }
      ],
      signals: [
        {
          id: "signal_1",
          type: "CONTACT_INFORMATION_AVAILABLE",
          explanation: "Usable contact information is available.",
          confidence: "HIGH"
        }
      ],
      qualification: {
        status: "FOUNDATION_READY",
        readiness_score: 85,
        reasons: ["Normalized email is available."]
      },
      recommendation: {
        action_type: "READY_FOR_RESEARCH",
        reason: "Customer-provided identity and contact data is available for a deeper Lead Intelligence step.",
        confidence: "HIGH"
      }
    }
  });

  assert.equal(model.readinessStatus, "Ready");
  assert.equal(model.claims[0].label, "Email");
  assert.equal(model.claims[0].sourceNote, "Provided by customer CSV");
  assert.equal(model.evidence[0].source, "CSV");
  assert.equal(model.evidence[0].sourceDetail, "evidence.csv, row 4");
  assert.equal(model.provenanceSummary, "Source: CSV import - evidence.csv - row 4");
  assert.equal(model.signals[0].label, "Contact information available");
  assert.equal(model.qualification.status, "Data foundation ready");
  assert.equal(model.recommendation.label, "Lead Intelligence is ready");
  assert.match(model.confidenceNote, /come from your records/);
});

test("synthesis display model distinguishes not-ready and available synthesis states", () => {
  const notReady = buildSynthesisDisplayModel({
    synthesis_status: "NOT_READY",
    reason: "Run Lead Intelligence before synthesis.",
    synthesis: null
  });
  const available = buildSynthesisDisplayModel({
    synthesis_status: "READY",
    synthesis: {
      id: "synthesis_1",
      status: "READY",
      version: 1,
      summary: {
        text: "Lead Intelligence synthesis is based on persisted evidence."
      },
      findings: [
        {
          field: "CONTACT_EMAIL",
          value: "priya@example.com",
          evidence_refs: ["snapshot_evidence:evidence_1"]
        }
      ],
      qualification: {
        outcome: "READY_FOR_DEEPER_INTELLIGENCE",
        reasons: ["The evidence-backed foundation is ready."]
      },
      recommendation: {
        type: "READY_FOR_DEEPER_INTELLIGENCE",
        reason: "Proceed to deeper Lead Intelligence.",
        evidence_refs: ["snapshot_evidence:evidence_1"]
      },
      evidence_refs: ["snapshot_evidence:evidence_1"]
    }
  });

  assert.equal(notReady.status, "Not ready");
  assert.match(notReady.message, /Run Lead Intelligence/);
  assert.equal(available.status, "Synthesis available");
  assert.equal(available.synthesis.qualification.outcome, "Lead Intelligence is ready");
  assert.equal(available.synthesis.recommendation.label, "Ready for outbound review");
  assert.equal(available.synthesis.evidenceRefCount, 1);
});

test("intelligence recommendation display model exposes priority, segment, next step, and personalization", () => {
  const notReady = buildIntelligenceRecommendationDisplayModel({
    recommendation_status: "NOT_READY",
    reason: "Run Lead Intelligence synthesis before recommendation.",
    intelligence_recommendation: null
  });
  const available = buildIntelligenceRecommendationDisplayModel({
    recommendation_status: "READY",
    intelligence_recommendation: {
      id: "intel_rec_1",
      status: "READY",
      version: 1,
      priority: {
        score: 78,
        label: "High attention"
      },
      segment: {
        type: "READY_FOR_OUTBOUND_REVIEW",
        label: "Ready for outbound review",
        reason: "The evidence-backed foundation is sufficient."
      },
      personalization_context: [
        {
          label: "Company",
          value: "Northstar Interiors",
          evidence_refs: ["snapshot_evidence:evidence_1"]
        }
      ],
      recommendation: {
        step: "PREPARE_OUTBOUND_REVIEW",
        label: "Prepare outbound review",
        reason: "Use the evidence-backed intelligence to prepare the next outbound review."
      },
      evidence_refs: ["snapshot_evidence:evidence_1"]
    }
  });

  assert.equal(notReady.status, "Not ready");
  assert.match(notReady.message, /Run Lead Intelligence synthesis/);
  assert.equal(available.status, "Recommendation available");
  assert.equal(available.intelligenceRecommendation.priority.label, "High attention");
  assert.equal(available.intelligenceRecommendation.segment.label, "Ready for outbound review");
  assert.equal(available.intelligenceRecommendation.recommendation.label, "Prepare outbound review");
  assert.equal(available.intelligenceRecommendation.personalizationContext[0].label, "Company");
  assert.equal(available.intelligenceRecommendation.evidenceRefCount, 1);
});

test("next best action display model distinguishes not-ready and policy-checked plan states", () => {
  const notReady = buildNextBestActionPlanDisplayModel({
    plan_status: "NOT_READY",
    reason: "Prepare a recommendation before planning.",
    next_best_action_plan: null
  });
  const available = buildNextBestActionPlanDisplayModel({
    plan_status: "PLANNED",
    next_best_action_plan: {
      id: "nba_1",
      status: "PLANNED",
      version: 1,
      action_type: "PREPARE_OUTBOUND_REVIEW",
      title: "Prepare outbound review",
      rationale: "The lead has enough evidence-backed intelligence for outbound review.",
      policy_decision: {
        decision: "REQUIRE_HUMAN_APPROVAL",
        reasons: ["Outbound preparation must be reviewed before execution."]
      },
      approval: {
        requirement: "REQUIRED",
        reason: "Human approval is required before outbound execution."
      },
      decision_evidence_refs: ["snapshot_evidence:evidence_1"],
      execution_contract: {
        executable: false,
        reason: "M3 creates a policy-checked plan only. M4/M5 own execution and approval workflows."
      }
    }
  });

  assert.equal(notReady.status, "Not ready");
  assert.match(notReady.message, /Prepare a recommendation/);
  assert.equal(available.status, "Plan ready");
  assert.equal(available.plan.actionType, "Prepare outbound review");
  assert.equal(available.plan.policyDecision, "Needs human approval");
  assert.equal(available.plan.approvalRequirement, "Required");
  assert.equal(available.plan.executable, false);
  assert.equal(available.plan.evidenceRefCount, 1);
});

test("outbound activity display model exposes action, approval, execution, and callback state", () => {
  const model = buildOutboundActivityModel([
    {
      id: "act_1",
      type: "CREATE_HUMAN_TASK",
      status: "COMPLETED",
      approval_requirement: "NOT_REQUIRED",
      next_best_action_plan_id: "nba_1",
      executions: [{ status: "COMPLETED", error: null }],
      callbacks: [{ id: "cb_1" }]
    }
  ]);

  assert.equal(model.hasActions, true);
  assert.equal(model.currentAction.type, "Human task");
  assert.equal(model.currentAction.status, "Completed");
  assert.equal(model.currentAction.approvalRequirement, "Not required");
  assert.equal(model.currentAction.latestExecutionStatus, "Completed");
  assert.equal(model.currentAction.executionCount, 1);
  assert.equal(model.currentAction.callbackCount, 1);
});

test("approval display model exposes human review states", () => {
  const pending = buildApprovalDisplayModel({
    id: "act_1",
    status: "AWAITING_APPROVAL",
    approval_requirement: "REQUIRED",
    approval: {
      status: "PENDING",
      requested_reason: "Human approval is required before outbound execution."
    }
  });
  const approved = buildApprovalDisplayModel({
    id: "act_1",
    status: "APPROVED",
    approval_requirement: "REQUIRED",
    approval: {
      status: "APPROVED",
      edited_payload: { instruction: "Use approved wording." }
    }
  });
  const rejected = buildApprovalDisplayModel({
    id: "act_1",
    status: "BLOCKED",
    approval_requirement: "REQUIRED",
    approval: {
      status: "REJECTED",
      reviewer_note: "Do not contact."
    }
  });

  assert.equal(pending.status, "Needs your approval");
  assert.equal(pending.canApprove, true);
  assert.equal(approved.status, "Approved");
  assert.match(approved.message, /edits/);
  assert.equal(rejected.status, "Rejected");
  assert.equal(rejected.message, "Do not contact.");
});

test("approval queue model shows pending reviews only", () => {
  const model = buildApprovalQueueModel([
    {
      id: "appr_1",
      action_id: "act_1",
      lead_id: "lead_1",
      lead_name: "Priya Sharma",
      lead_company: "Northstar Interiors",
      action_type: "SEND_EMAIL",
      status: "PENDING",
      requested_reason: "Review before sending."
    },
    {
      id: "appr_2",
      action_id: "act_2",
      lead_id: "lead_2",
      lead_name: "Approved Lead",
      action_type: "CREATE_HUMAN_TASK",
      status: "APPROVED"
    }
  ]);

  assert.equal(model.pendingCount, 1);
  assert.equal(model.items[0].leadName, "Priya Sharma");
  assert.equal(model.items[0].actionType, "Email action");
});

test("follow-up queue model exposes open customer-facing follow-ups", () => {
  const model = buildFollowUpQueueModel([
    {
      id: "fu_1",
      lead_id: "lead_1",
      lead_name: "Priya Sharma",
      lead_company: "Northstar Interiors",
      channel: "WHATSAPP",
      status: "DUE",
      reason: "Answer the lead's question.",
      due_at: "2026-09-08T10:00:00.000Z"
    },
    {
      id: "fu_2",
      lead_id: "lead_2",
      lead_name: "Closed Lead",
      channel: "EMAIL",
      status: "COMPLETED",
      reason: "Already handled.",
      due_at: "2026-09-08T11:00:00.000Z"
    }
  ]);

  assert.equal(model.openCount, 1);
  assert.equal(model.items[0].leadName, "Priya Sharma");
  assert.equal(model.items[0].channel, "WhatsApp");
  assert.equal(model.items[0].status, "Needs attention");
});

test("lead timeline model presents inbound outbound and follow-up activity without provider wording", () => {
  const model = buildLeadTimelineModel({
    timeline: [
      {
        kind: "message",
        id: "msg_1",
        direction: "OUTBOUND",
        channel: "EMAIL",
        status: "DELIVERED",
        title: "Intro email",
        message: "Outbound activity completed.",
        occurred_at: "2026-09-08T10:00:00.000Z"
      },
      {
        kind: "message",
        id: "msg_2",
        direction: "INBOUND",
        channel: "VOICE",
        status: "RECEIVED",
        title: "Question received",
        message: "Lead asked a question.",
        occurred_at: "2026-09-08T10:05:00.000Z"
      },
      {
        kind: "follow_up",
        id: "fu_1",
        channel: "VOICE",
        status: "DUE",
        title: "Follow-up",
        message: "Answer the lead's question.",
        occurred_at: "2026-09-08T10:06:00.000Z"
      }
    ]
  });

  assert.equal(model.hasActivity, true);
  assert.equal(model.items[0].direction, "Outbound");
  assert.equal(model.items[0].channel, "Email");
  assert.equal(model.items[0].status, "Completed");
  assert.equal(model.items[1].direction, "Inbound");
  assert.equal(model.items[1].channel, "Voice");
  assert.equal(model.items[2].status, "Needs attention");
});

test("lead display model exposes persisted duplicate warnings consistently", () => {
  const model = buildLeadDisplayModel({
    id: "lead_1",
    name: "Imported Lead",
    company: "Northstar Interiors",
    email: "same@example.com",
    source: "CSV",
    status: "NEW",
    source_metadata: {
      duplicate_candidate_count: 1,
      duplicate_candidates: [{ duplicate_type: "STRONG_EMAIL", matched_lead_id: "lead_existing" }]
    },
    actions: []
  });

  assert.equal(model.duplicateWarning, "Possible duplicate");
  assert.equal(model.duplicateWarningDetail, "1 possible match found in your lead data.");
  assert.equal(model.duplicateCandidates[0].duplicate_type, "STRONG_EMAIL");
});

test("quoted CSV values render as ordinary imported lead values", () => {
  const model = buildLeadDisplayModel({
    id: "lead_1",
    name: "Quoted",
    company: "Company, With Comma",
    email: "quoted@example.com",
    source: "CSV",
    status: "NEW",
    actions: []
  });

  assert.equal(model.name, "Quoted");
  assert.equal(model.company, "Company, With Comma");
  assert.equal(model.contact, "quoted@example.com");
  assert.equal(model.source, "CSV");
});

test("import history state distinguishes no organization, loading, empty, success, and failure", () => {
  const noWorkspace = deriveImportHistoryState({ organizationId: null, isLoading: false });
  assert.equal(noWorkspace.kind, "none");
  assert.match(noWorkspace.message, /workspace/);
  assert.equal(deriveImportHistoryState({ organizationId: "org_1", isLoading: true }).kind, "loading");
  assert.equal(deriveImportHistoryState({ organizationId: "org_1", isLoading: false, imports: [] }).kind, "empty");
  assert.equal(
    deriveImportHistoryState({
      organizationId: "org_1",
      isLoading: false,
      imports: [{ id: "import_1" }]
    }).kind,
    "ready"
  );
  assert.equal(
    deriveImportHistoryState({
      organizationId: "org_1",
      isLoading: false,
      imports: [],
      error: new Error("Could not load imports")
    }).kind,
    "error"
  );
});

test("import preview model exposes valid, invalid, duplicate, and committed state", () => {
  const model = buildImportPreviewModel({
    import: {
      id: "import_1",
      state: "READY_TO_COMMIT",
      summary: { valid_rows: 1, invalid_rows: 1, duplicate_candidate_rows: 1 }
    },
    rows: [
      {
        id: "row_1",
        validation_state: "VALID",
        committed: false,
        duplicate_candidates: [{ duplicate_type: "STRONG_EMAIL" }]
      },
      {
        id: "row_2",
        validation_state: "INVALID",
        committed: false,
        duplicate_candidates: []
      }
    ]
  });

  assert.equal(model.validRows.length, 1);
  assert.equal(model.invalidRows.length, 1);
  assert.equal(model.duplicateRows.length, 1);
  assert.equal(model.stateLabel, "Ready to review");
});

test("import review summary uses customer-facing counts that are not mutually exclusive", () => {
  const summary = buildImportReviewSummary(
    {
      import: {
        id: "import_1",
        state: "READY_TO_COMMIT",
        summary: {}
      },
      rows: [
        {
          id: "row_1",
          validation_state: "VALID",
          committed: false,
          duplicate_candidates: [{ duplicate_type: "STRONG_EMAIL" }]
        },
        {
          id: "row_2",
          validation_state: "INVALID",
          committed: false,
          duplicate_candidates: []
        }
      ]
    },
    new Set(["row_1"])
  );

  assert.equal(summary.totalRows, 2);
  assert.equal(summary.readyToImport, 1);
  assert.equal(summary.needAttention, 1);
  assert.equal(summary.duplicateWarnings, 1);
  assert.equal(summary.selectedRows, 1);
});

test("import row presentation keeps invalid rows unselectable and duplicate rows selectable", () => {
  const duplicateRow = importRowPresentation({
    id: "row_1",
    row_number: 2,
    validation_state: "VALID",
    committed: false,
    mapped_values: { email: " Priya@Example.COM ", phone: "09876543210" },
    normalized_values: {
      name: "Priya Sharma",
      company: "Northstar Interiors",
      email: "priya@example.com",
      raw_phone: "09876543210",
      normalized_phone: "+919876543210"
    },
    duplicate_candidates: [{ duplicate_type: "STRONG_EMAIL", matched_lead_id: "lead_1" }]
  });
  const invalidRow = importRowPresentation({
    id: "row_2",
    row_number: 3,
    validation_state: "INVALID",
    committed: false,
    mapped_values: {},
    normalized_values: {},
    duplicate_candidates: []
  });

  assert.equal(duplicateRow.selectable, true);
  assert.equal(duplicateRow.duplicateSummary, "Duplicate warning - 1 match");
  assert.equal(duplicateRow.normalizedValues[0].stored, "priya@example.com");
  assert.equal(invalidRow.selectable, false);
  assert.equal(invalidRow.stateLabel, "Needs attention");
});

test("import state and issue labels are human-readable", () => {
  assert.equal(importStateLabel("READY_TO_COMMIT"), "Ready to review");
  assert.equal(importStateLabel("COMMITTED"), "Completed");
  assert.equal(humanImportIssue({ issue_type: "INVALID_PHONE", field: "phone" }).title, "Phone number needs attention");
});

test("lead display filtering supports search, source, status, intelligence, attention, and empty results", () => {
  const leads = [
    {
      id: "lead_1",
      name: "Priya Sharma",
      company: "Northstar Interiors",
      email: "priya@example.com",
      source: "CSV",
      status: "NEW",
      source_metadata: { duplicate_candidate_count: 1 },
      actions: []
    },
    {
      id: "lead_2",
      name: "Manual Lead",
      company: "Manual Co",
      email: "manual@example.com",
      source: "MANUAL",
      status: "ACTIVE",
      intelligence_context: { intelligence_status: "GENERATED" },
      intelligence: { recommendation: { action_type: "READY_FOR_RESEARCH" } },
      actions: []
    }
  ];

  assert.deepEqual(
    filterLeadDisplayModels(leads, { search: "northstar", source: "CSV", status: "NEW" }).map((lead) => lead.name),
    ["Priya Sharma"]
  );
  assert.deepEqual(filterLeadDisplayModels(leads, { attention: "DUPLICATE" }).map((lead) => lead.name), ["Priya Sharma"]);
  assert.deepEqual(filterLeadDisplayModels(leads, { intelligence: "READY" }).map((lead) => lead.name), ["Manual Lead"]);
  assert.deepEqual(filterLeadDisplayModels(leads, { attention: "READY_FOR_OUTBOUND_REVIEW" }).map((lead) => lead.name), [
    "Manual Lead"
  ]);
  assert.equal(filterLeadDisplayModels(leads, { search: "missing" }).length, 0);
});
