import { normalizeResearchEvidenceItem } from "./researchProviderContract.js";

export class ApprovedManualResearchAdapter {
  constructor({ provider_key = "APPROVED_MANUAL_RESEARCH" } = {}) {
    this.provider_key = provider_key;
    this.adapter_type = "APPROVED_MANUAL_RESEARCH";
  }

  normalize(evidenceItems = []) {
    return evidenceItems.map((item) => normalizeResearchEvidenceItem(item, { provider_key: this.provider_key }));
  }
}
