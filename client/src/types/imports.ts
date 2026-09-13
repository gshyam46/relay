import type { Enquiry } from "./business-context";
export const importTargets = ["name", "email", "phone", "company", "source", "interest", "location", "country_code", "budget_amount", "budget_minimum", "budget_maximum", "currency", "timeline", "target_date", "enquiry_date", "last_interaction", "observed_at"] as const;
export type ImportTarget = typeof importTargets[number];
export type ImportMapping = Partial<Record<ImportTarget, number>>;
export interface ImportOptions { date_format: "ISO" | "DMY" | "MDY"; default_currency: string | null; assertion: "OPERATOR_OBSERVED" | "CUSTOMER_STATED" | "INFERRED" }
export interface CsvInspection { headers: { index: number; label: string; samples: string[] }[]; suggested_mapping: ImportMapping; row_count: number; limits: Record<string, number> }
export interface ImportIssue { id: string; import_row_id: string | null; issue_type: string; field: string | null; message: string; severity: string; metadata?: { row_number?: number } }
export interface ImportRow {
  id: string; row_number: number; raw_cells: string[]; raw_row: Record<string, string>;
  mapped_values: Partial<Record<ImportTarget, string | null>>;
  normalized_values: { name?: string | null; company?: string | null; email?: string | null; raw_phone?: string | null; normalized_phone?: string | null; enquiry?: Enquiry; [key: string]: unknown };
  validation_state: string; can_commit: boolean; committed: boolean; selected: boolean; created_lead_id: string | null;
  contact_policy?: IdentityContactPolicy;
  identity_resolution?: IdentityResolution | null; can_resolve_identity?: boolean;
  commit_state: string; hold_reason: string | null; duplicate_candidates: { message: string; [key: string]: unknown }[];
}
export interface ImportSummary { total_rows: number; valid_rows: number; invalid_rows: number; duplicate_candidate_rows: number; issue_count: number; selected_rows: number; committed_rows: number }
export interface ImportBatch { id: string; filename: string; state: string; contract_version?: number; review_revision?: number; created_at: string; updated_at: string;
  summary: ImportSummary; progress?: { selected_rows: number; committed_rows: number; held_rows: number; remaining_rows: number }; source_metadata: { headers?: string[]; mapping?: ImportMapping; options?: ImportOptions; default_phone_region?: string } }
export interface ImportCorrection { id: string; import_row_id: string; revision: number; reason: string; created_by: string; created_at: string;
  before: { mapped_values: Partial<Record<ImportTarget, string | null>> }; after: { mapped_values: Partial<Record<ImportTarget, string | null>> } }
export interface ImportDetail { import_id: string; state: string; summary: ImportSummary; import: ImportBatch; rows: ImportRow[]; issues: ImportIssue[];
  contract_version: number; review_revision: number; frozen_selection: string[] | null;
  resolutions?: IdentityResolution[]; resolution_summary?: { linked_rows: number; created_rows: number; resolved_held_rows: number; unresolved_duplicate_rows: number };
  progress: { selected_rows: number; committed_rows: number; held_rows: number; remaining_rows: number }; corrections: ImportCorrection[] }
export const importLabels: Record<ImportTarget, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company", source: "Lead source", interest: "Product or service interest", location: "Locality", country_code: "Country code", budget_amount: "Exact budget", budget_minimum: "Minimum budget", budget_maximum: "Maximum budget", currency: "Currency", timeline: "Timing description", target_date: "Target date", enquiry_date: "Enquiry date", last_interaction: "Last meaningful interaction", observed_at: "Source observed at" };

export type IdentityDecision = "LINK_EXISTING" | "CREATE_SEPARATE";
export type IdentityClassification = "SAME_ENQUIRY" | "REPEATED_ENQUIRY" | "SHARED_CONTACT" | "DISTINCT_ENQUIRY";
export interface IdentityCommand { review_token: string; decision: IdentityDecision; classification: IdentityClassification; target_lead_id: string | null; reason: string }
export interface IdentityResolution { id: string; import_id: string; import_row_id: string; review_revision: number; decision: IdentityDecision; classification: IdentityClassification; target_lead_id: string | null; lead_id: string; event_id: string | null; reason: string; created_at: string; created_by: string }
export interface IdentityContactPolicy { restricted: boolean; policy_pending: boolean; reason: string | null; restriction_ids: string[]; restriction_count?: number; restrictions_truncated?: boolean }
export interface IdentityCandidate { lead: { id: string; name: string | null; email: string | null; phone: string | null; normalized_email: string | null; normalized_phone: string | null; company: string | null; status: string; archived_at?: string | null; data_revision?: number }; match_types: string[]; enquiry_revision: number; enquiry: Enquiry; contact_policy: IdentityContactPolicy; can_link: boolean; link_block_reason: string | null }
export interface IdentityReview { review_token: string | null; can_resolve: boolean; unavailable_reason: string | null; row: ImportRow; existing_candidates: IdentityCandidate[]; existing_total: number; existing_truncated: boolean; row_candidates: { id: string; row_number: number; normalized_values: ImportRow["normalized_values"]; match_types: string[]; resolution: IdentityResolution | null }[]; row_total: number; row_truncated: boolean; resolution: IdentityResolution | null }
export interface ImportSource { mapped_values: Partial<Record<ImportTarget, string | null>>; import_id: string; import_row_id: string; filename: string; row_number: number; raw_cells: string[] | null; raw_row: Record<string, string>; normalized_values: ImportRow["normalized_values"]; resolution: IdentityResolution | null; created_at: string }
export interface ImportSources { sources: ImportSource[]; has_more: boolean; limit: number }
export const identityClassificationLabels: Record<IdentityClassification, string> = { SAME_ENQUIRY: "Same enquiry", REPEATED_ENQUIRY: "Repeated enquiry", SHARED_CONTACT: "Shared contact", DISTINCT_ENQUIRY: "Distinct enquiry" };
