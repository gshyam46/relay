import { instant } from "../business-context/businessContextContract.js";
import { CLAIM_FIELDS, CONFIDENCE, EVIDENCE_SOURCE_TYPES } from "./intelligenceContract.js";

export const RESEARCH_EVIDENCE_ADAPTER_TYPES = Object.freeze({
  APPROVED_MANUAL_RESEARCH: "APPROVED_MANUAL_RESEARCH"
});

export const RESEARCH_EVIDENCE_INGESTION_STATES = Object.freeze({
  RECEIVED: "RECEIVED",
  VALIDATED: "VALIDATED",
  PERSISTED: "PERSISTED",
  FAILED: "FAILED"
});

export const RESEARCH_EVIDENCE_SOURCE_TYPES = Object.freeze({
  CUSTOMER_PROVIDED: EVIDENCE_SOURCE_TYPES.CUSTOMER_PROVIDED,
  MANUAL: EVIDENCE_SOURCE_TYPES.MANUAL,
  CSV: EVIDENCE_SOURCE_TYPES.CSV,
  APPROVED_RESEARCH: "APPROVED_RESEARCH"
});

export const APPROVED_RESEARCH_PROVIDERS = new Set(["APPROVED_MANUAL_RESEARCH"]);

export class ResearchProvider {
  constructor({ provider_key }) {
    this.provider_key = provider_key;
  }

  async collectEvidence() {
    throw new Error("External research provider execution is not implemented in M2.1.");
  }
}

export function normalizeResearchEvidenceItem(item = {}, { provider_key }) {
  return {
    source_type: normalizeSourceType(item.source_type),
    source_reference: normalizeOptionalText(item.source_reference),
    source_url: normalizeOptionalText(item.source_url),
    title: normalizeRequiredText(item.title),
    raw_content_reference: normalizeOptionalText(item.raw_content_reference),
    claim_field: normalizeRequiredText(item.claim_field),
    claim_value: normalizeRequiredText(item.claim_value),
    evidence_timestamp: normalizeTimestamp(item.evidence_timestamp),
    retrieved_at: normalizeTimestamp(item.retrieved_at),
    confidence: normalizeConfidence(item.confidence),
    metadata: {
      provider_key,
      ...normalizeMetadata(item.metadata)
    }
  };
}

export function validateResearchEvidenceItem(item) {
  const errors = [];
  if (!Object.values(RESEARCH_EVIDENCE_SOURCE_TYPES).includes(item.source_type)) {
    errors.push("source_type must be an approved evidence source type.");
  }
  if (!Object.values(CLAIM_FIELDS).includes(item.claim_field)) {
    errors.push("claim_field must be a supported claim field.");
  }
  if (!item.title) {
    errors.push("title is required.");
  }
  if (!item.claim_value) {
    errors.push("claim_value is required.");
  }
  if (!Object.values(CONFIDENCE).includes(item.confidence)) {
    errors.push("confidence must be LOW, MEDIUM, or HIGH.");
  }
  for (const [key, maximum] of Object.entries({ source_reference: 500, source_url: 2048, title: 500, raw_content_reference: 500, claim_field: 100, claim_value: 500 })) if (typeof item[key] === "string" && item[key].length > maximum) errors.push(key + " exceeds its supported text limit.");
  if (item.source_url && !/^https?:\/\/\S+$/i.test(item.source_url)) {
    errors.push("source_url must be an http or https URL.");
  }
  return errors;
}

function normalizeSourceType(value) {
  const normalized = normalizeOptionalText(value)?.toUpperCase() || RESEARCH_EVIDENCE_SOURCE_TYPES.APPROVED_RESEARCH;
  return Object.values(RESEARCH_EVIDENCE_SOURCE_TYPES).includes(normalized) ? normalized : normalized;
}

function normalizeConfidence(value) {
  const normalized = normalizeOptionalText(value)?.toUpperCase() || CONFIDENCE.MEDIUM;
  return Object.values(CONFIDENCE).includes(normalized) ? normalized : normalized;
}

function normalizeRequiredText(value) {
  return normalizeOptionalText(value) || null;
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  return instant(value, "research timestamp");
}
