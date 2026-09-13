import type { Lead } from "@/types";
export type PhoneRegion = "IN" | "US" | "INTERNATIONAL_ONLY";
export type ArchiveFilter = "ACTIVE" | "ARCHIVED" | "ALL";
export interface LeadValues { name: string; email: string | null; phone: string | null; company: string | null }
export interface NormalizedLeadValues extends LeadValues { normalized_email: string | null; normalized_phone: string | null }
export interface LeadFieldSource { source_type: "LEAD_DATA_CHANGE"; change_id: string; revision: number; created_by: string; created_at: string }
export interface LeadDataCurrent { data_revision: number; archived_at: string | null; values: LeadValues; normalized_values: NormalizedLeadValues; field_provenance: Record<keyof LeadValues, LeadFieldSource | null> }
export interface LeadDataEffects { carried_restriction_ids: string[]; carried_restriction_count?: number; carried_restrictions_truncated?: boolean; blocked_actions: number; cancelled_follow_ups: number; stopped_workflows: number }
export interface LeadDataChange { id: string; expected_revision: number; revision: number; kind: "CORRECT" | "ARCHIVE" | "RESTORE"; before: LeadDataCurrent; after: LeadDataCurrent; reason: string; created_at: string; created_by: string; effects: LeadDataEffects }
export interface LeadDataResponse { current: LeadDataCurrent; history: { changes: LeadDataChange[]; has_more: boolean; next_before_revision: number | null } }
export interface LeadDataResult extends LeadDataResponse { change: LeadDataChange | null; changed: boolean; replayed: boolean; effects: LeadDataEffects }
export interface LeadDataInput { expected_revision: number; values: LeadValues; default_phone_region: PhoneRegion }
export interface LeadDataCommand extends LeadDataInput { review_token: string; reason: string }
export interface ArchiveCommand { expected_revision: number; archived: boolean; reason: string }
export interface LeadPolicySummary { reasons: { reason: string; channel: string }[]; policy_incomplete: boolean; restricted: boolean; policy_pending: boolean; restriction_ids: string[]; restriction_count: number | null; restrictions_truncated: boolean; reason: string | null }
export interface LeadDataPreview { current: LeadDataCurrent; proposed: { values: LeadValues; normalized_values: NormalizedLeadValues }; changed_fields: string[]; review_token: string | null; can_save: boolean; unavailable_reason: string | null; duplicate_candidates: { lead: Lead; match_types: string[] }[]; duplicate_total: number; duplicates_truncated: boolean; current_policy: LeadPolicySummary; proposed_policy: LeadPolicySummary; effects: { carried_restrictions: number; blocked_actions: number; cancelled_follow_ups: number; stopped_workflows: number } }
export interface LeadDirectory { leads: Lead[]; total: number; has_more: boolean; next_cursor: string | null; limit: number }
export interface DirectoryFilters { search: string; source: string; status: string; archive: ArchiveFilter }
export const leadValueLabels: Record<keyof LeadValues, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company" };

export const leadSourceLabels: Record<string, string> = { MANUAL: "Manual entry", CSV: "CSV import", GOOGLE_SHEETS: "Google Sheets", CRM: "CRM", WEBSITE: "Website", FORM: "Form", DATABASE: "Database", DISCOVERY: "Lead discovery", EXTERNAL_PROVIDER: "External provider" };
