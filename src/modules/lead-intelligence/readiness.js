import {
  CONFIDENCE,
  QUALIFICATION_STATUS,
  READINESS_STATUS,
  RECOMMENDATION_TYPES,
  OUTBOUND_ACTION_TYPES,
  SIGNAL_TYPES
} from "./intelligenceContract.js";

export function analyzeReadiness(lead) {
  const facts = {
    hasName: hasValue(lead.name),
    hasCompany: hasValue(lead.company),
    hasEmail: hasUsableEmail(lead.normalized_email || lead.email),
    hasPhone: hasUsablePhone(lead.normalized_phone),
    hasNormalizedEmail: hasUsableEmail(lead.normalized_email),
    hasNormalizedPhone: hasUsablePhone(lead.normalized_phone),
    hasSource: hasValue(lead.source),
    hasProvenance: hasValue(lead.import_batch_id) || lead.source === "MANUAL",
    duplicateWarningCount: duplicateWarningCount(lead)
  };
  const hasContact = facts.hasNormalizedEmail || facts.hasNormalizedPhone || facts.hasEmail || facts.hasPhone;
  const hasIdentity = facts.hasName || facts.hasCompany;
  const reasons = [];
  const missing = [];

  let score = 20;
  if (facts.hasName) {
    score += 15;
    reasons.push("Lead name is available.");
  } else {
    missing.push("lead name");
  }
  if (facts.hasCompany) {
    score += 15;
    reasons.push("Company is available.");
  } else {
    missing.push("company");
  }
  if (facts.hasNormalizedEmail) {
    score += 20;
    reasons.push("Normalized email is available.");
  } else if (facts.hasEmail) {
    score += 12;
    reasons.push("Email is available but not normalized.");
  } else {
    missing.push("email");
  }
  if (facts.hasNormalizedPhone) {
    score += 15;
    reasons.push("Normalized phone is available.");
  } else if (facts.hasPhone) {
    score += 8;
    reasons.push("Phone is available but not normalized.");
  } else {
    missing.push("phone");
  }
  if (facts.hasSource) {
    score += 10;
    reasons.push("Lead source is recorded.");
  }
  if (facts.hasProvenance) {
    score += 5;
    reasons.push("Lead provenance is traceable.");
  }
  if (facts.duplicateWarningCount > 0) {
    score -= 10;
    reasons.push("Duplicate warning should be reviewed.");
  }

  score = Math.max(0, Math.min(100, score));
  const status = hasIdentity && hasContact ? READINESS_STATUS.READY_FOR_INTELLIGENCE : READINESS_STATUS.NEEDS_MORE_DATA;
  const blockingReasons = [];
  if (!hasIdentity) {
    blockingReasons.push("Add a name or company so the lead can be identified.");
  }
  if (!hasContact) {
    blockingReasons.push("Add an email or phone number so the lead can be contacted or reviewed.");
  }

  return {
    status,
    score,
    display_status: status === READINESS_STATUS.READY_FOR_INTELLIGENCE ? "READY" : "INSUFFICIENT",
    factors: buildReadinessFactors(facts),
    facts,
    hasContact,
    hasIdentity,
    missing,
    reasons,
    blockingReasons
  };
}

export function buildDeterministicSignals(lead, readiness) {
  const signals = [];
  if (readiness.hasContact) {
    signals.push(signal(SIGNAL_TYPES.CONTACT_INFORMATION_AVAILABLE, "true", "Usable contact information is available.", CONFIDENCE.HIGH));
  }
  signals.push(
    readiness.facts.hasCompany
      ? signal(SIGNAL_TYPES.COMPANY_PROVIDED, "true", "Company was provided in customer-owned data.", CONFIDENCE.HIGH)
      : signal(SIGNAL_TYPES.COMPANY_MISSING, "true", "Company information is missing.", CONFIDENCE.HIGH)
  );
  if (readiness.facts.hasNormalizedEmail || readiness.facts.hasEmail) {
    signals.push(signal(SIGNAL_TYPES.EMAIL_AVAILABLE, "true", "Email is available from customer-owned data.", CONFIDENCE.HIGH));
  }
  if (readiness.facts.hasNormalizedPhone || readiness.facts.hasPhone) {
    signals.push(signal(SIGNAL_TYPES.PHONE_AVAILABLE, "true", "Phone is available from customer-owned data.", CONFIDENCE.HIGH));
  }
  if (readiness.facts.hasProvenance) {
    signals.push(signal(SIGNAL_TYPES.PROVENANCE_AVAILABLE, "true", "Source/provenance is recorded.", CONFIDENCE.HIGH));
  }
  if (readiness.facts.duplicateWarningCount > 0) {
    signals.push(
      signal(
        SIGNAL_TYPES.DUPLICATE_WARNING,
        String(readiness.facts.duplicateWarningCount),
        "Duplicate candidate warning exists from Lead Data Foundation.",
        CONFIDENCE.MEDIUM
      )
    );
  }
  if (readiness.status === READINESS_STATUS.NEEDS_MORE_DATA) {
    signals.push(signal(SIGNAL_TYPES.DATA_INCOMPLETE, "true", readiness.blockingReasons.join(" "), CONFIDENCE.HIGH));
  }
  return signals;
}

export function buildQualificationFoundation(readiness, signalIds, evidenceIds) {
  return {
    status:
      readiness.status === READINESS_STATUS.READY_FOR_INTELLIGENCE
        ? QUALIFICATION_STATUS.FOUNDATION_READY
        : QUALIFICATION_STATUS.NEEDS_REVIEW,
    readiness_score: readiness.score,
    reasons: readiness.blockingReasons.length > 0 ? readiness.blockingReasons : readiness.reasons,
    signal_ids: signalIds,
    evidence_ids: evidenceIds
  };
}

export function buildRecommendation(lead, readiness, evidenceIds) {
  if (readiness.status === READINESS_STATUS.NEEDS_MORE_DATA) {
    return {
      action_type: RECOMMENDATION_TYPES.GATHER_MORE_DATA,
      outbound_action_type: OUTBOUND_ACTION_TYPES.CREATE_HUMAN_TASK,
      reason: readiness.blockingReasons.join(" "),
      confidence: CONFIDENCE.HIGH,
      evidence_ids: evidenceIds
    };
  }
  if (readiness.facts.duplicateWarningCount > 0) {
    return {
      action_type: RECOMMENDATION_TYPES.REVIEW_LEAD,
      outbound_action_type: OUTBOUND_ACTION_TYPES.CREATE_HUMAN_TASK,
      reason: "Review duplicate warning before using this lead for intelligence or outbound planning.",
      confidence: CONFIDENCE.MEDIUM,
      evidence_ids: evidenceIds
    };
  }
  return {
    action_type: RECOMMENDATION_TYPES.READY_FOR_RESEARCH,
    outbound_action_type: OUTBOUND_ACTION_TYPES.CREATE_HUMAN_TASK,
    reason: "Customer-provided identity and contact data is available for a deeper Lead Intelligence step.",
    confidence: CONFIDENCE.HIGH,
    evidence_ids: evidenceIds
  };
}

function buildReadinessFactors(facts) {
  return [
    factor("Name", facts.hasName),
    factor("Company", facts.hasCompany),
    factor("Email", facts.hasEmail || facts.hasNormalizedEmail),
    factor("Phone", facts.hasPhone || facts.hasNormalizedPhone),
    factor("Normalized email", facts.hasNormalizedEmail),
    factor("Normalized phone", facts.hasNormalizedPhone),
    factor("Source", facts.hasSource),
    factor("Provenance", facts.hasProvenance),
    {
      label: "Duplicate warning",
      status: facts.duplicateWarningCount > 0 ? "REVIEW" : "CLEAR",
      available: facts.duplicateWarningCount === 0,
      value: facts.duplicateWarningCount
    }
  ];
}

function factor(label, available) {
  return {
    label,
    status: available ? "AVAILABLE" : "MISSING",
    available
  };
}

function signal(type, value, explanation, confidence) {
  return {
    type,
    value,
    explanation,
    confidence
  };
}

function duplicateWarningCount(lead) {
  if (typeof lead.source_metadata === "object" && lead.source_metadata !== null) {
    return Number(lead.source_metadata.duplicate_candidate_count || lead.source_metadata.duplicate_candidates?.length || 0);
  }
  return 0;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasUsableEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

function hasUsablePhone(value) {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.trim());
}
