import type { ReplyInterpretation as Interpretation, SourceSpan } from "@/types/intelligence-generation";

const CATEGORIES: Record<string, string> = { POSITIVE_REPLY: "Positive interpretation", NEGATIVE_REPLY: "Negative interpretation", QUESTION: "Question", OPT_OUT: "Stop contact", UNKNOWN: "Interpretation unclear" };
const METHODS: Record<string, string> = { LOCAL_POLICY: "Explicit stop rule", DETERMINISTIC_CLASSIFICATION: "Application reply rules", LLM_CLASSIFICATION: "Model-assisted interpretation", DETERMINISTIC_FALLBACK: "Fallback · human review" };
export function ReplyInterpretationBadges({ interpretation, eventType, confidence }: { interpretation?: Interpretation | null; eventType?: string | null; confidence?: string | null }) {
  const category = interpretation?.event_type || eventType || "UNKNOWN";
  const review = interpretation?.review_required !== false || (interpretation?.confidence || confidence) === "LOW" || category === "UNKNOWN";
  return <span className="inline-flex flex-wrap gap-1.5 text-[10px] font-semibold"><span className={"rounded-full px-2 py-1 " + (category === "OPT_OUT" ? "bg-danger-light text-danger" : "bg-soft text-muted")}>{CATEGORIES[category] || "Event interpretation unavailable"}</span>{review && <span className="rounded-full bg-warn-light px-2 py-1 text-warn">Human review required</span>}</span>;
}
export function ReplyInterpretation({ interpretation, original, eventType, confidence }: { interpretation?: Interpretation | null; original: string; eventType?: string | null; confidence?: string | null }) {
  const generation = interpretation?.generation;
  const method = generation && METHODS[generation.mode];
  const category = interpretation?.event_type || eventType;
  const quote = exactSpan(interpretation?.evidence, original);
  const candidate = interpretation?.candidate;
  const candidateQuote = exactSpan(candidate?.evidence, original);
  const stop = category === "OPT_OUT";
  return <section aria-label="Recorded reply interpretation" className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-ink">Recorded interpretation</h4><ReplyInterpretationBadges interpretation={interpretation} eventType={eventType} confidence={confidence} /></div>
    <p className="font-medium text-muted">{method || "Method not recorded"}</p>
    {!method && <p className="text-muted">No usable interpretation method is recorded for this message. Read the original text; current settings do not explain historical results.</p>}
    {stop && <p className="text-danger">{generation?.mode === "LOCAL_POLICY" ? "An explicit stop request matched the recorded policy rule." : generation?.mode === "LLM_CLASSIFICATION" ? "A possible opt-out was identified by the model. Conservative contact restrictions apply; a human must review the wording." : "A stop-contact event is recorded. Review its source and the current contact policy."} This interpretation cannot release a contact restriction.</p>}
    {interpretation?.reason && <p className="text-muted">{interpretation.reason}</p>}
    {quote && <div><p className="font-medium text-ink">Supporting original text</p><blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-line pl-2 text-ink">{quote}</blockquote></div>}
    {interpretation?.evidence && !quote && <p className="text-warn">The recorded supporting span could not be matched to the displayed original text. Review the original message.</p>}
    {candidate && <div className="space-y-2 rounded-lg border border-warn/30 bg-warn-light p-3"><p className="font-semibold text-warn">Model suggestion · human review required</p><p>{CATEGORIES[candidate.event_type] || "Unrecognized suggestion"}. The recorded event remains unclear; this suggestion is not confirmed customer intent.</p>{candidateQuote ? <blockquote className="whitespace-pre-wrap break-words border-l-2 border-warn/30 pl-2">{candidateQuote}</blockquote> : <p>Supporting text is unavailable. Read the original message before interpreting this suggestion.</p>}</div>}
    <p className="text-muted">{interpretation?.confidence ? "Recorded confidence: " + interpretation.confidence.toLowerCase() + ". " : "Confidence not recorded. "}This is a classifier label, not a measured probability of intent or source truth. Exact quotation shows attribution, not semantic correctness.</p>
    <p className="text-ink"><span className="font-semibold">Next step: </span>{interpretation?.suggested_next_step || "Read the original message and review the lead record before deciding what to do."}</p>
    {generation && <details><summary className="cursor-pointer text-brand">Recorded interpretation version</summary><dl className="mt-2 space-y-1 break-words text-muted"><div><dt className="inline font-medium">Reply policy: </dt><dd className="inline">{generation.reply_policy_version || "Not recorded"}</dd></div><div><dt className="inline font-medium">Prompt: </dt><dd className="inline">{generation.prompt_version || "Not recorded"}</dd></div>{generation.provider && <div><dt className="inline font-medium">Provider: </dt><dd className="inline">{generation.provider}</dd></div>}{generation.model && <div><dt className="inline font-medium">Model: </dt><dd className="inline">{generation.model}</dd></div>}</dl></details>}
  </section>;
}
function exactSpan(span: SourceSpan | null | undefined, original: string) { return span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && original.slice(span.start, span.end) === span.quote ? span.quote : null; }
