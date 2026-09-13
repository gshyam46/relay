import { createHash } from "node:crypto";
import { currentLeadData, leadDataRevision } from "../data-foundation/leadDataSafety.js";
import { loadLeadBusinessContext } from "../business-context/businessContextRepository.js";
import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { evaluateFreshness } from "./freshnessService.js";

const changed = () => Object.assign(new Error("Analysis inputs changed. Refresh analysis for the current saved sources."), { code: "INTELLIGENCE_CONTEXT_CHANGED", statusCode: 409 });

export async function captureBusinessContext(db, lead, { now = Date.now } = {}) {
  const current = await currentLeadData(db, lead);
  const { revisions } = await loadLeadBusinessContext(db, { organization_id: lead.organization_id, lead_id: lead.id });
  const freshness = await evaluateFreshness(db, current, { now });
  return { ...revisions, data_revision: leadDataRevision(current), source_fingerprint: freshness.source_fingerprint,
    freshness_authority: freshness.authority_fingerprint };
}

export function inputAuthority(input) {
  const { input_fingerprint: _fingerprint, ...authority } = input;
  return createHash("sha256").update(JSON.stringify(canonical(authority))).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function withScopedCurrentService(db, lead, stage, work, { now = Date.now } = {}) {
  const read = async tx => {
    const { createCurrentIntelligenceServices } = await import("./currentIntelligence.js");
    return work(createCurrentIntelligenceServices(tx, { now })[stage], tx);
  };
  return db.transactionBound ? read(db)
    : new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, read);
}

// Network/model generation stays outside the gate. Rebuild the exact parent input
// under the same workspace lock before cached reuse or artifact finalization.
export async function withCurrentBusinessContext(db, lead, expected, work, { now = Date.now, stage = null, input_fingerprint = null, input_authority = null } = {}) {
  const finalize = async tx => {
    assertWorkspaceTransaction(tx, lead.organization_id);
    let actual;
    try { actual = await captureBusinessContext(tx, lead, { now }); }
    catch (error) { if (["LEAD_ARCHIVED", "INTELLIGENCE_CONTEXT_CHANGED"].includes(error.code)) throw changed(); throw error; }
    if (Object.keys(expected).some(key => actual[key] !== expected[key])) throw changed();
    if (stage) {
      const currentLead = await currentLeadData(tx, lead);
      const result = await withScopedCurrentService(tx, currentLead, stage, service => service.tryBuildInput(currentLead), { now });
      if (!result.ready || result.value.input_fingerprint !== input_fingerprint || inputAuthority(result.value) !== input_authority) throw changed();
    }
    return work(tx);
  };
  return db.transactionBound ? finalize(db)
    : new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, finalize);
}
