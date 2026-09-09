import { QUALIFICATION_OUTCOMES, SYNTHESIS_RECOMMENDATION_TYPES } from "../lead-intelligence/synthesisContract.js";

export class LlmSynthesisAgent {
  constructor(llmProvider) {
    this.llm = llmProvider;
  }

  async synthesize({ lead, snapshot, researchEvidenceItems = [] }) {
    const snapshotFindings = (snapshot.claims || []).map((claim) => ({
      field: claim.field,
      value: String(claim.value),
      source: "CURRENT_INTELLIGENCE_SNAPSHOT",
      confidence: claim.confidence,
      evidence_refs: (claim.evidence_ids || []).map((id) => `snapshot_evidence:${id}`)
    }));
    const researchFindings = researchEvidenceItems.map((item) => ({
      field: item.claim_field,
      value: item.claim_value,
      source: "APPROVED_RESEARCH_EVIDENCE",
      confidence: item.confidence,
      evidence_refs: [`research_evidence:${item.id}`]
    }));
    const allFindings = [...snapshotFindings, ...researchFindings];
    const allEvidenceRefs = Array.from(new Set(allFindings.flatMap((f) => f.evidence_refs || []))).sort();

    const messages = [
      {
        role: "system",
        content: `You are a lead intelligence analyst for a B2B/B2C sales platform. Your job is to synthesize lead data into actionable intelligence.

You will receive lead data, intelligence snapshot findings, and optional research evidence. Produce a JSON synthesis with these exact fields:

{
  "summary_text": "A 2-3 sentence summary of the lead's intelligence profile, mentioning key strengths and gaps",
  "qualification_outcome": one of "READY_FOR_DEEPER_INTELLIGENCE" | "NEEDS_MORE_DATA" | "NEEDS_REVIEW",
  "qualification_reasons": ["array of specific reasons for the outcome"],
  "qualification_missing": ["array of missing data points, if any"],
  "recommendation_type": one of "GATHER_MORE_DATA" | "REVIEW_LEAD_INTELLIGENCE" | "READY_FOR_DEEPER_INTELLIGENCE",
  "recommendation_reason": "specific actionable reason for the recommendation"
}

Rules:
- If lead has name + email/phone + company → likely READY_FOR_DEEPER_INTELLIGENCE
- If lead is missing critical fields (no email AND no phone, or no name) → NEEDS_MORE_DATA
- If there is research evidence to review → NEEDS_REVIEW
- Be specific about the lead in your summary, mention their name and company
- Evidence-grounded: only state facts present in the data`
      },
      {
        role: "user",
        content: JSON.stringify({
          lead: { name: lead.name, email: lead.email, phone: lead.phone, company: lead.company, source: lead.source },
          readiness_score: snapshot.readiness_score,
          readiness_status: snapshot.readiness_status,
          findings: allFindings.map((f) => ({ field: f.field, value: f.value, source: f.source, confidence: f.confidence })),
          research_evidence_count: researchEvidenceItems.length,
        })
      }
    ];

    try {
      const result = await this.llm.jsonCompletion({ messages, maxTokens: 1024 });
      const outcome = validOutcome(result.qualification_outcome);
      const recType = validRecommendationType(result.recommendation_type, outcome);

      return {
        summary: {
          text: result.summary_text || fallbackSummary(lead),
          evidence_refs: allEvidenceRefs,
        },
        findings: allFindings,
        qualification: {
          outcome,
          reasons: Array.isArray(result.qualification_reasons) ? result.qualification_reasons : [result.qualification_reasons || "AI-generated assessment"],
          missing: Array.isArray(result.qualification_missing) ? result.qualification_missing : [],
          evidence_refs: allEvidenceRefs,
        },
        recommendation: {
          type: recType,
          reason: result.recommendation_reason || "AI-generated recommendation based on lead intelligence.",
          evidence_refs: allEvidenceRefs,
        }
      };
    } catch (err) {
      console.error("LLM synthesis failed, falling back to deterministic:", err.message);
      return this.fallback({ lead, snapshot, allFindings, allEvidenceRefs, researchEvidenceItems });
    }
  }

  fallback({ lead, snapshot, allFindings, allEvidenceRefs, researchEvidenceItems }) {
    const outcome = snapshot.readiness_status === "NEEDS_MORE_DATA"
      ? QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA
      : researchEvidenceItems.length > 0
        ? QUALIFICATION_OUTCOMES.NEEDS_REVIEW
        : QUALIFICATION_OUTCOMES.READY_FOR_DEEPER_INTELLIGENCE;

    const recType = outcome === QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA
      ? SYNTHESIS_RECOMMENDATION_TYPES.GATHER_MORE_DATA
      : outcome === QUALIFICATION_OUTCOMES.NEEDS_REVIEW
        ? SYNTHESIS_RECOMMENDATION_TYPES.REVIEW_LEAD_INTELLIGENCE
        : SYNTHESIS_RECOMMENDATION_TYPES.READY_FOR_DEEPER_INTELLIGENCE;

    return {
      summary: { text: fallbackSummary(lead), evidence_refs: allEvidenceRefs },
      findings: allFindings,
      qualification: { outcome, reasons: ["Deterministic fallback assessment"], missing: [], evidence_refs: allEvidenceRefs },
      recommendation: { type: recType, reason: "Deterministic fallback recommendation", evidence_refs: allEvidenceRefs },
    };
  }
}

function validOutcome(raw) {
  const valid = Object.values(QUALIFICATION_OUTCOMES);
  return valid.includes(raw) ? raw : QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA;
}

function validRecommendationType(raw, outcome) {
  const valid = Object.values(SYNTHESIS_RECOMMENDATION_TYPES);
  if (valid.includes(raw)) return raw;
  if (outcome === QUALIFICATION_OUTCOMES.NEEDS_MORE_DATA) return SYNTHESIS_RECOMMENDATION_TYPES.GATHER_MORE_DATA;
  if (outcome === QUALIFICATION_OUTCOMES.NEEDS_REVIEW) return SYNTHESIS_RECOMMENDATION_TYPES.REVIEW_LEAD_INTELLIGENCE;
  return SYNTHESIS_RECOMMENDATION_TYPES.READY_FOR_DEEPER_INTELLIGENCE;
}

function fallbackSummary(lead) {
  const identity = lead.company || lead.name || lead.email || "this lead";
  return `Lead Intelligence synthesis for ${identity} is based on the current persisted intelligence snapshot.`;
}
