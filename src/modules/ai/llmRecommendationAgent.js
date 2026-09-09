import {
  INTELLIGENCE_RECOMMENDED_STEPS,
  INTELLIGENCE_SEGMENTS
} from "../lead-intelligence/intelligenceRecommendationContract.js";

export class LlmRecommendationAgent {
  constructor(llmProvider) {
    this.llm = llmProvider;
  }

  async recommend({ lead, snapshot, synthesis }) {
    const evidenceRefs = collectEvidenceRefs({ snapshot, synthesis });

    const messages = [
      {
        role: "system",
        content: `You are a lead intelligence analyst determining the next best action for a sales lead. Analyze the lead data and produce a JSON recommendation.

Return JSON with these exact fields:

{
  "segment": one of "NEEDS_DATA" | "DUPLICATE_CANDIDATE" | "NEEDS_INTELLIGENCE_REVIEW" | "READY_FOR_OUTBOUND_REVIEW",
  "segment_label": "human-readable segment label",
  "segment_reason": "why this segment was chosen",
  "priority_score": integer 0-100,
  "priority_reason": "why this priority score",
  "step": one of "GATHER_MORE_DATA" | "REVIEW_DUPLICATE_CANDIDATE" | "REVIEW_LEAD_INTELLIGENCE" | "PREPARE_OUTBOUND_REVIEW",
  "step_label": "human-readable step label",
  "step_reason": "specific actionable reason for this next step",
  "personalization_facts": [{"label": "fact label", "value": "fact value"}]
}

Scoring guidelines:
- NEEDS_DATA: score 10-35 (missing critical info)
- DUPLICATE_CANDIDATE: score 45-55 (needs dedup review)
- NEEDS_INTELLIGENCE_REVIEW: score 60-70 (has evidence to review)
- READY_FOR_OUTBOUND_REVIEW: score 70-85 (ready to contact)

Personalization: extract key facts useful for crafting personalized outreach (name, company, role, interests, etc).
Be specific to this lead — mention their name and company in reasons.`
      },
      {
        role: "user",
        content: JSON.stringify({
          lead: { name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, source: lead.source },
          readiness_score: snapshot.readiness_score,
          has_duplicate_warning: (snapshot.signals || []).some((s) => s.type === "DUPLICATE_WARNING"),
          synthesis_qualification: synthesis.qualification?.outcome,
          synthesis_summary: synthesis.summary?.text,
          findings_count: (synthesis.findings || []).length,
        })
      }
    ];

    try {
      const result = await this.llm.jsonCompletion({ messages, maxTokens: 1024 });
      const segment = validSegment(result.segment);
      const step = validStep(result.step, segment);
      const score = clampScore(result.priority_score, segment);

      return {
        priority: {
          score,
          label: priorityLabel(score),
          reason: result.priority_reason || "AI-assessed priority based on lead intelligence.",
          evidence_refs: evidenceRefs,
        },
        segment: {
          type: segment,
          label: result.segment_label || segmentLabel(segment),
          reason: result.segment_reason || "AI-determined segment.",
          evidence_refs: evidenceRefs,
        },
        personalization_context: buildPersonalization(result.personalization_facts, lead, synthesis, evidenceRefs),
        recommendation: {
          step,
          label: result.step_label || stepLabel(step),
          reason: result.step_reason || "AI-generated next step recommendation.",
          evidence_refs: evidenceRefs,
        }
      };
    } catch (err) {
      console.error("LLM recommendation failed, falling back to deterministic:", err.message);
      return this.fallback({ lead, snapshot, synthesis, evidenceRefs });
    }
  }

  fallback({ lead, snapshot, synthesis, evidenceRefs }) {
    const hasDuplicate = (snapshot.signals || []).some((s) => s.type === "DUPLICATE_WARNING");
    const outcome = synthesis.qualification?.outcome || "NEEDS_MORE_DATA";
    let segment, step;

    if (outcome === "NEEDS_MORE_DATA") {
      segment = INTELLIGENCE_SEGMENTS.NEEDS_DATA;
      step = INTELLIGENCE_RECOMMENDED_STEPS.GATHER_MORE_DATA;
    } else if (hasDuplicate) {
      segment = INTELLIGENCE_SEGMENTS.DUPLICATE_CANDIDATE;
      step = INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_DUPLICATE_CANDIDATE;
    } else if (outcome === "NEEDS_REVIEW") {
      segment = INTELLIGENCE_SEGMENTS.NEEDS_INTELLIGENCE_REVIEW;
      step = INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_LEAD_INTELLIGENCE;
    } else {
      segment = INTELLIGENCE_SEGMENTS.READY_FOR_OUTBOUND_REVIEW;
      step = INTELLIGENCE_RECOMMENDED_STEPS.PREPARE_OUTBOUND_REVIEW;
    }

    const score = clampScore(snapshot.readiness_score || 50, segment);
    return {
      priority: { score, label: priorityLabel(score), reason: "Deterministic fallback priority.", evidence_refs: evidenceRefs },
      segment: { type: segment, label: segmentLabel(segment), reason: "Deterministic fallback segment.", evidence_refs: evidenceRefs },
      personalization_context: basicPersonalization(lead, synthesis, evidenceRefs),
      recommendation: { step, label: stepLabel(step), reason: "Deterministic fallback recommendation.", evidence_refs: evidenceRefs },
    };
  }
}

function validSegment(raw) {
  const valid = Object.values(INTELLIGENCE_SEGMENTS);
  return valid.includes(raw) ? raw : INTELLIGENCE_SEGMENTS.NEEDS_DATA;
}

function validStep(raw, segment) {
  const valid = Object.values(INTELLIGENCE_RECOMMENDED_STEPS);
  if (valid.includes(raw)) return raw;
  const map = {
    NEEDS_DATA: INTELLIGENCE_RECOMMENDED_STEPS.GATHER_MORE_DATA,
    DUPLICATE_CANDIDATE: INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_DUPLICATE_CANDIDATE,
    NEEDS_INTELLIGENCE_REVIEW: INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_LEAD_INTELLIGENCE,
    READY_FOR_OUTBOUND_REVIEW: INTELLIGENCE_RECOMMENDED_STEPS.PREPARE_OUTBOUND_REVIEW,
  };
  return map[segment] || INTELLIGENCE_RECOMMENDED_STEPS.REVIEW_LEAD_INTELLIGENCE;
}

function clampScore(raw, segment) {
  const floors = { NEEDS_DATA: 10, DUPLICATE_CANDIDATE: 45, NEEDS_INTELLIGENCE_REVIEW: 60, READY_FOR_OUTBOUND_REVIEW: 70 };
  const caps = { NEEDS_DATA: 35, DUPLICATE_CANDIDATE: 55, NEEDS_INTELLIGENCE_REVIEW: 70, READY_FOR_OUTBOUND_REVIEW: 85 };
  const n = Number.isInteger(raw) ? raw : 50;
  return Math.min(caps[segment] ?? 85, Math.max(floors[segment] ?? 10, n));
}

function priorityLabel(score) {
  if (score >= 75) return "High attention";
  if (score >= 50) return "Medium attention";
  return "Low attention";
}

function segmentLabel(seg) {
  return { NEEDS_DATA: "Needs more data", DUPLICATE_CANDIDATE: "Duplicate candidate", NEEDS_INTELLIGENCE_REVIEW: "Needs intelligence review", READY_FOR_OUTBOUND_REVIEW: "Ready for outbound review" }[seg] || seg;
}

function stepLabel(step) {
  return { GATHER_MORE_DATA: "Gather more data", REVIEW_DUPLICATE_CANDIDATE: "Review duplicate candidate", REVIEW_LEAD_INTELLIGENCE: "Review Lead Intelligence", PREPARE_OUTBOUND_REVIEW: "Prepare outbound review" }[step] || step;
}

function buildPersonalization(llmFacts, lead, synthesis, evidenceRefs) {
  const facts = [];
  if (Array.isArray(llmFacts)) {
    for (const f of llmFacts) {
      if (f.label && f.value) {
        facts.push({ label: f.label, value: String(f.value), evidence_refs: evidenceRefs });
      }
    }
  }
  if (facts.length === 0) return basicPersonalization(lead, synthesis, evidenceRefs);
  return facts;
}

function basicPersonalization(lead, synthesis, evidenceRefs) {
  const facts = [];
  if (lead.name) facts.push({ label: "Lead name", value: lead.name, evidence_refs: evidenceRefs });
  if (lead.company) facts.push({ label: "Company", value: lead.company, evidence_refs: evidenceRefs });
  if (lead.email || lead.phone) facts.push({ label: "Contact", value: lead.email || lead.phone, evidence_refs: evidenceRefs });
  if (lead.source) facts.push({ label: "Source", value: lead.source, evidence_refs: evidenceRefs });
  return facts;
}

function collectEvidenceRefs({ snapshot, synthesis }) {
  const refs = new Set(synthesis.evidence_refs || []);
  for (const signal of snapshot.signals || []) {
    for (const eid of signal.evidence_ids || []) {
      refs.add(`snapshot_evidence:${eid}`);
    }
  }
  return Array.from(refs).sort();
}
