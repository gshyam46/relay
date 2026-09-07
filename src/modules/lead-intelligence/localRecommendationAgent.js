import {
  INTELLIGENCE_RECOMMENDED_STEPS,
  INTELLIGENCE_SEGMENTS
} from "./intelligenceRecommendationContract.js";

export class LocalRecommendationAgent {
  recommend({ lead, snapshot, synthesis }) {
    const evidenceRefs = evidenceRefsFor({ snapshot, synthesis });
    const hasDuplicateWarning = (snapshot.signals || []).some((signal) => signal.type === "DUPLICATE_WARNING");
    const qualificationOutcome = synthesis.qualification?.outcome || "NEEDS_MORE_DATA";
    const baseScore = Number.isInteger(snapshot.readiness_score) ? snapshot.readiness_score : 0;
    const segment = segmentFor({ qualificationOutcome, hasDuplicateWarning, evidenceRefs });
    const priority = priorityFor({ segment, baseScore, evidenceRefs });
    const recommendation = recommendationFor({ segment, evidenceRefs });

    return {
      priority,
      segment,
      personalization_context: personalizationContextFor({ lead, synthesis }),
      recommendation
    };
  }
}

function segmentFor({ qualificationOutcome, hasDuplicateWarning, evidenceRefs }) {
  if (qualificationOutcome === "NEEDS_MORE_DATA") {
    return {
      type: INTELLIGENCE_SEGMENTS.NEEDS_DATA,
      label: "Needs more data",
      reason: "The lead is missing evidence required for reliable next-step intelligence.",
      evidence_refs: evidenceRefs
    };
  }
  if (hasDuplicateWarning) {
    return {
      type: INTELLIGENCE_SEGMENTS.DUPLICATE_CANDIDATE,
      label: "Duplicate candidate",
      reason: "Stored intelligence includes a duplicate warning that should be reviewed before outbound planning.",
      evidence_refs: evidenceRefs
    };
  }
  if (qualificationOutcome === "NEEDS_REVIEW") {
    return {
      type: INTELLIGENCE_SEGMENTS.NEEDS_INTELLIGENCE_REVIEW,
      label: "Needs intelligence review",
      reason: "Approved staged evidence is available and should be reviewed before downstream recommendations.",
      evidence_refs: evidenceRefs
    };
  }
  return {
    type: INTELLIGENCE_SEGMENTS.READY_FOR_OUTBOUND_REVIEW,
    label: "Ready for outbound review",
    reason: "The evidence-backed Lead Intelligence foundation is sufficient to prepare an outbound review.",
    evidence_refs: evidenceRefs
  };
}

function priorityFor({ segment, baseScore, evidenceRefs }) {
  const caps = {
    NEEDS_DATA: 35,
    DUPLICATE_CANDIDATE: 55,
    NEEDS_INTELLIGENCE_REVIEW: 70,
    READY_FOR_OUTBOUND_REVIEW: 85
  };
  const floor = {
    NEEDS_DATA: 10,
    DUPLICATE_CANDIDATE: 45,
    NEEDS_INTELLIGENCE_REVIEW: 60,
    READY_FOR_OUTBOUND_REVIEW: 70
  };
  const evidenceBonus = Math.min(evidenceRefs.length, 5);
  const capped = Math.min(caps[segment.type], Math.max(floor[segment.type], baseScore + evidenceBonus));
  return {
    score: capped,
    label: priorityLabel(capped),
    reason: "Priority is based on readiness, evidence coverage, duplicate risk, and synthesis outcome.",
    evidence_refs: evidenceRefs
  };
}

function recommendationFor({ segment, evidenceRefs }) {
  if (segment.type === INTELLIGENCE_SEGMENTS.NEEDS_DATA) {
    return {
      step: INTELLIGENCE_RECOMMENDED_STEPS.GATHER_MORE_DATA,
      label: "Gather more data",
      reason: "Collect missing identity or contact information before preparing outbound activity.",
      evidence_refs: evidenceRefs
    };
  }
  if (segment.type === INTELLIGENCE_SEGMENTS.DUPLICATE_CANDIDATE) {
    return {
      step: INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_DUPLICATE_CANDIDATE,
      label: "Review duplicate candidate",
      reason: "Review duplicate warnings before preparing outbound activity.",
      evidence_refs: evidenceRefs
    };
  }
  if (segment.type === INTELLIGENCE_SEGMENTS.NEEDS_INTELLIGENCE_REVIEW) {
    return {
      step: INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_LEAD_INTELLIGENCE,
      label: "Review Lead Intelligence",
      reason: "Review the synthesized evidence before preparing the outbound plan.",
      evidence_refs: evidenceRefs
    };
  }
  return {
    step: INTELLIGENCE_RECOMMENDED_STEPS.PREPARE_OUTBOUND_REVIEW,
    label: "Prepare outbound review",
    reason: "Use the evidence-backed intelligence to prepare the next outbound review. No outbound action is created yet.",
    evidence_refs: evidenceRefs
  };
}

function personalizationContextFor({ lead, synthesis }) {
  const facts = [];
  const findingsByField = new Map((synthesis.findings || []).map((finding) => [finding.field, finding]));
  pushPersonalizationFact(facts, "Lead name", lead.name, findingsByField.get("LEAD_NAME"));
  pushPersonalizationFact(facts, "Company", lead.company, findingsByField.get("COMPANY_NAME"));
  pushPersonalizationFact(
    facts,
    "Contact",
    lead.normalized_email || lead.email || lead.normalized_phone || lead.phone,
    findingsByField.get("CONTACT_EMAIL") || findingsByField.get("CONTACT_PHONE")
  );
  pushPersonalizationFact(facts, "Source", lead.source, findingsByField.get("LEAD_SOURCE"));
  return facts;
}

function pushPersonalizationFact(facts, label, value, finding) {
  if (!value || !finding?.evidence_refs?.length) {
    return;
  }
  facts.push({
    label,
    value: String(value),
    evidence_refs: finding.evidence_refs
  });
}

function evidenceRefsFor({ snapshot, synthesis }) {
  const refs = new Set(synthesis.evidence_refs || []);
  for (const signal of snapshot.signals || []) {
    for (const evidenceId of signal.evidence_ids || []) {
      refs.add(`snapshot_evidence:${evidenceId}`);
    }
  }
  return Array.from(refs).sort();
}

function priorityLabel(score) {
  if (score >= 75) {
    return "High attention";
  }
  if (score >= 50) {
    return "Medium attention";
  }
  return "Low attention";
}
