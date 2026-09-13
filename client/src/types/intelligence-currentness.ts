export interface IntelligenceInputRevisions { profile_revision: number; enquiry_revision: number; data_revision: number }
export interface CurrentnessReason { code: string; scope: string; fields: string[] }
export type CurrentnessState = "NEVER_ANALYSED" | "CURRENT" | "OUTDATED" | "ARCHIVED";
export interface IntelligenceCurrentness { state: CurrentnessState; assessed_at: string; analysed_at: string | null; next_check_at: string | null; can_refresh: boolean; reasons: CurrentnessReason[]; evaluated_revisions: IntelligenceInputRevisions | null; current_revisions: IntelligenceInputRevisions }
export type FactFreshness = "CURRENT" | "STALE" | "AGE_UNKNOWN" | "FUTURE_DATED" | "INVALID_TIME" | "HISTORICAL" | "NOT_APPLICABLE";
export interface FactAssessment { field: string; source_reference: string | null; value_state: "UNKNOWN" | "KNOWN" | "CONFLICTED"; assertion: "CUSTOMER_STATED" | "OPERATOR_OBSERVED" | "INFERRED" | null; freshness: FactFreshness; observed_at: string | null; expires_at: string | null; usable: boolean; reasons: string[]; alternatives?: FactAssessment[] }
export interface ResearchAssessment extends FactAssessment { id: string; ingestion_id: string }
export interface IntelligenceFreshness { policy_version: 0 | 1; evaluated_at: string; next_transition_at: string | null; authority_fingerprint: string | null; source_fingerprint: string | null; current_revisions: IntelligenceInputRevisions; facts: Record<string, FactAssessment>; research: ResearchAssessment[]; review_reasons: CurrentnessReason[] }
export interface RecommendationDescriptor { id: string; created_at: string; step: string | null; reason: string | null; snapshot_id: string; revisions: IntelligenceInputRevisions | null }
export interface RecommendationComparison { current: RecommendationDescriptor | null; previous: RecommendationDescriptor | null; input_changes: CurrentnessReason[]; limitations: string[] }
export const currentnessLabels: Record<CurrentnessState, string> = { NEVER_ANALYSED: "Not analysed yet", CURRENT: "Analysis current", OUTDATED: "Analysis outdated", ARCHIVED: "Archived" };
export const freshnessFieldLabels: Record<string, string> = { interest: "Product or service interest", location: "Enquiry location", budget: "Stated budget", timeline: "Requested timing", enquiry_date: "Enquiry date", last_interaction: "Last meaningful interaction", profile_revision: "Business profile", enquiry_revision: "Enquiry context", data_revision: "Contact details" };
export function intelligenceFieldLabel(field: string) { return freshnessFieldLabels[field] || field.replaceAll("_", " ").toLowerCase(); }
export function intelligenceRecheckDelay(values: (IntelligenceCurrentness | undefined)[]): number {
  // Server-relative durations schedule a GET only. Browser wall time never decides authority.
  const delays = values.flatMap(value => { if (!value?.next_check_at) return []; const delta = Date.parse(value.next_check_at) - Date.parse(value.assessed_at); return Number.isFinite(delta) ? [Math.max(1000, delta + 100)] : []; });
  return Math.min(30_000, ...delays);
}
