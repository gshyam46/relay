import type { FitCriteria } from "./business-fit";
export interface BusinessProfile {
  business_name: string | null;
  offerings: string[];
  service_areas: string[];
  target_customers: string[];
  exclusions: string[];
  required_criteria: string[];
  preferred_criteria: string[];
  preferred_next_step: string | null;
  timezone: string | null;
  language: string | null;
}
interface ProvenanceBase {
  assertion: "CUSTOMER_STATED" | "OPERATOR_OBSERVED" | "INFERRED";
  source_reference: string;
  observed_at: string | null;
}
export type Provenance = (ProvenanceBase & { source_type: "MANUAL" }) | (ProvenanceBase & { source_type: "IMPORT_ROW"; import_id: string; import_row_id: string; field: EnquiryField });
export interface Budget {
  currency: string;
  scale: number;
  minimum_minor: string;
  maximum_minor: string;
}
export interface BudgetInput { currency: string; minimum: string; maximum: string }
export interface Location { locality: string; country_code: string | null }
export interface Timeline { description: string; target_date: string | null }
export type FactValue = string | Location | Timeline | Budget | BudgetInput;
export interface Assertion { value: FactValue; provenance: Provenance }
export type EnquiryFact =
  | { state: "UNKNOWN"; value: null; provenance: null }
  | ({ state: "KNOWN" } & Assertion)
  | { state: "CONFLICTED"; alternatives: Assertion[] };
export const enquiryFields = ["interest", "location", "budget", "timeline", "enquiry_date", "last_interaction"] as const;
export type EnquiryField = typeof enquiryFields[number];
export type Enquiry = Record<EnquiryField, EnquiryFact>;
export interface RevisionMetadata {
  revision: number;
  schema_version: 1;
  reason: string | null;
  created_at: string | null;
  created_by: string | null;
}
export interface ProfileRevision extends RevisionMetadata { profile: BusinessProfile; fit_criteria: FitCriteria | null }
export interface EnquiryRevision extends RevisionMetadata { enquiry: Enquiry }
export interface ContextHistory<T> { items: T[]; next_before_revision: number | null }
export const currencies: Record<string, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, AED: 2, SAR: 2, JPY: 0, KWD: 3, BHD: 3 };
// Monetary values stay decimal strings through rendering, editing and persistence.
export function minorToDecimal(digits: string, scale: number): string {
  if (!scale) return digits;
  const padded = digits.padStart(scale + 1, "0");
  return padded.slice(0, -scale) + "." + padded.slice(-scale);
}
export function budgetInput(value: Budget | BudgetInput): BudgetInput {
  return "minimum_minor" in value
    ? { currency: value.currency, minimum: minorToDecimal(value.minimum_minor, value.scale), maximum: minorToDecimal(value.maximum_minor, value.scale) }
    : value;
}
