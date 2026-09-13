import { Link } from "react-router-dom";
import type { RecordedClaim, SourceEvidence, SynthesisGeneration } from "@/types/intelligence-generation";

const METHODS: Record<string, string> = {
  DETERMINISTIC_EXTRACTIVE: "Application extraction",
  LLM_EXTRACTIVE: "Model selected recorded facts",
  DETERMINISTIC_FALLBACK: "Fallback · review required",
};
const REASONS: Record<string, string> = {
  PROVIDER_FAILURE: "The configured model could not complete this assessment. Its output was not used.",
  MODEL_OUTPUT_REJECTED: "The model output did not satisfy the source-support checks and was not used.",
  SOURCE_REVIEW_REQUIRED: "Source quality or contact restrictions require review before using this assessment.",
  NO_SUPPORTED_SELECTION: "The model did not select a supported recorded fact. This is an abstention, not a completed interpretation.",
};
export function AssessmentMethod({ generation, claims, evidence, leadId, reviewFlags = [] }: {
  generation?: SynthesisGeneration | null;
  claims?: RecordedClaim[];
  evidence: SourceEvidence[];
  leadId: string;
  reviewFlags?: string[];
}) {
  const method = generation && METHODS[generation.mode];
  const review = !method || generation?.mode === "DETERMINISTIC_FALLBACK" || Boolean(generation?.reason) || reviewFlags.length > 0;
  return <section aria-label="Source extraction method" className="space-y-3 rounded-lg border border-line bg-page p-3">
    <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-sm">Source extraction method</h4><span className={"rounded px-2 py-1 text-xs " + (review ? "bg-warn-light text-warn" : "bg-soft text-muted")}>{method || "Method not recorded"}</span></div>
    <p className="text-sm text-muted">{!method ? "The method for this historical assessment is unavailable. It cannot be inferred from today's model settings." : generation?.mode === "LLM_EXTRACTIVE" ? "A model selected from saved facts; the application quoted their recorded values. The model did not establish those facts as true." : generation?.mode === "DETERMINISTIC_EXTRACTIVE" ? "Application rules selected recorded source values. No model interpretation is claimed for this summary." : "Review the saved sources and original context before deciding what this result means."}</p>
    {generation?.reason && <p className="text-sm text-warn">{REASONS[generation.reason] || "The recorded assessment requires review; its detailed reason is unavailable."}</p>}
    <p className="text-xs text-muted">Source support establishes where a value was recorded. It does not verify its truth, business fit, buying intent or permission to contact.</p>
    <details><summary className="cursor-pointer text-sm text-brand">Exact recorded claims and support ({claims?.length ?? 0})</summary><div className="mt-3 space-y-3">
      {!claims?.length ? <p className="text-sm text-muted">No exact claim list is recorded for this assessment. Review the saved sources.</p> : claims.map((claim, index) => <article key={index} aria-label={label(claim.field) + " recorded claim"} className="space-y-2 rounded-lg border border-line bg-surface p-3"><p className="text-xs font-semibold">{label(claim.field)}</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-sm">{claim.value}</blockquote><EvidenceSupport references={claim.evidence_refs} evidence={evidence} field={claim.field} value={claim.value} /></article>)}
    </div></details>
    {generation && <details><summary className="cursor-pointer text-xs text-brand">Recorded assessment version</summary><p className="mt-2 break-words text-xs text-muted">Grounding contract: {generation.grounding_version || "Not recorded"}</p></details>}
    <Link className="inline-block text-sm text-brand underline" to={"/leads/" + leadId + "?tab=enquiry"}>Review saved enquiry and source history</Link>
  </section>;
}
export function EvidenceSupport({ references, evidence, field, value }: { references: string[]; evidence: SourceEvidence[]; field: string; value: string }) {
  const supported = references.map(id => evidence.find(item => (item.reference || "snapshot_evidence:" + item.id) === id && item.claim_field === field && item.claim_value === value));
  return <div className="space-y-2 text-xs text-muted">{!references.length && <p>No supporting source reference is recorded.</p>}{supported.map((item, index) => item ? <div key={references[index]} className="space-y-1"><p>Recorded source: {label(item.source_type)}{item.title ? " · " + item.title : ""}</p>{item.source_reference && <p className="whitespace-pre-wrap break-words">{item.source_reference}</p>}<details><summary className="cursor-pointer text-brand">Exact supporting record</summary><p className="mt-1 break-all">{references[index]}</p><p className="whitespace-pre-wrap break-words">{item.claim_value}</p></details></div> : <p key={references[index]} className="text-warn">Matching support is unavailable in this assessment. Review the original source.</p>)}</div>;
}
function label(value: string) { return value.replace(/_/g, " ").toLowerCase().replace(/^\w/, first => first.toUpperCase()); }
