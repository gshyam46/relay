import type { EnquiryFact } from "./business-context";
import type { FactAssessment } from "./intelligence-currentness";
export type FitRequirement = "REQUIRED" | "PREFERRED";
export type FitField = "interest" | "location" | "budget" | "timeline";
export interface FitArea { country_code: string; locality: string | null; aliases: string[] }
export interface InterestCriterion { requirement: FitRequirement; accepted_aliases: string[]; excluded_aliases: string[] }
export interface LocationCriterion { requirement: FitRequirement; areas: FitArea[]; excluded_areas: FitArea[] }
export interface BudgetCriterion { requirement: FitRequirement; currency: string; minimum: string }
export interface TimelineCriterion { requirement: FitRequirement; earliest_date: string | null; latest_date: string | null }
export interface FitCriteria { version: 1; interest: InterestCriterion | null; location: LocationCriterion | null; budget: BudgetCriterion | null; timeline: TimelineCriterion | null }
export type FitStatus = "NOT_CONFIGURED" | "MATCHES_CRITERIA" | "DOES_NOT_MATCH" | "NEEDS_REVIEW";
export interface CriterionResult { criterion_id: FitField; requirement: FitRequirement; rule: InterestCriterion | LocationCriterion | BudgetCriterion | TimelineCriterion; outcome: "MATCH" | "NOT_MATCH" | "UNKNOWN" | "NEEDS_REVIEW"; reason_codes: string[]; evidence: { fact: EnquiryFact; freshness: FactAssessment }; missing_fields: string[] }
export interface AttentionPriority { band: "MATCHING" | "REVIEW" | "LOW" | "UNASSESSED"; reason: string; preferred_matches: number; preferred_total: number; ranking_incomplete: boolean; criterion_refs: string[] }
export interface BusinessFit { version: 1; criteria_revision: number; evaluated_at: string; status: FitStatus; criterion_results: CriterionResult[]; unassessed_profile_criteria: boolean; limitations: string[]; attention_priority: AttentionPriority }
export interface FitRanking { basis: "CONFIGURED_CRITERIA_V1"; scope: "RETURNED_LEADS"; returned_count: number; has_more: boolean; next_after_lead_id: string | null; workspace_active_count: number; assessed_at: string; limit?: number }
export const fitFields: FitField[] = ["interest", "location", "budget", "timeline"];
export const fitFieldLabels: Record<FitField, string> = { interest: "Product or service interest", location: "Enquiry location", budget: "Stated budget", timeline: "Requested timing" };
export const fitStatusLabels: Record<FitStatus, string> = { NOT_CONFIGURED: "Criteria not configured", MATCHES_CRITERIA: "Matches configured criteria", DOES_NOT_MATCH: "Does not meet criteria", NEEDS_REVIEW: "Fit needs review" };
export const attentionLabels: Record<AttentionPriority["band"], string> = { MATCHING: "Matching enquiries", REVIEW: "Review required", LOW: "Lower priority under these criteria", UNASSESSED: "Not ranked by business fit" };

export type BusinessFitSummary = Pick<BusinessFit, "version" | "status" | "criteria_revision" | "unassessed_profile_criteria" | "attention_priority"> & { criterion_results: Pick<CriterionResult, "criterion_id" | "requirement" | "outcome" | "reason_codes" | "missing_fields">[] };
