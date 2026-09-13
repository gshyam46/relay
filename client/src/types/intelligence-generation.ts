export interface SourceSpan { start: number; end: number; quote: string }
export type ReplyConfidence = "HIGH" | "MEDIUM" | "LOW";
export interface ReplyGeneration {
  mode: "LOCAL_POLICY" | "DETERMINISTIC_CLASSIFICATION" | "LLM_CLASSIFICATION" | "DETERMINISTIC_FALLBACK";
  reason: string | null;
  reply_policy_version: string;
  prompt_version: string | null;
  provider?: string | null;
  model?: string | null;
}
export interface ReplyInterpretation {
  event_type: string;
  confidence: ReplyConfidence | null;
  reason: string | null;
  suggested_next_step: string | null;
  generation: ReplyGeneration | null;
  evidence: SourceSpan | null;
  review_required: boolean;
  candidate: { event_type: string; confidence: ReplyConfidence; evidence: SourceSpan } | null;
}
export interface SynthesisGeneration {
  mode: "DETERMINISTIC_EXTRACTIVE" | "LLM_EXTRACTIVE" | "DETERMINISTIC_FALLBACK";
  reason: string | null;
  grounding_version: string;
}
export interface RecordedClaim { field: string; value: string; evidence_refs: string[]; kind: "RECORDED_VALUE" }
export interface SourceEvidence {
  id: string;
  reference?: string;
  claim_field: string | null;
  claim_value: string | null;
  source_type: string;
  source_reference?: string | null;
  observed_at?: string | null;
  title?: string;
}
