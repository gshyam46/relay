import { evaluateBusinessFit } from "./businessFit.js";
import { evaluateFreshness } from "./freshnessService.js";
import { FreshnessRepository } from "./freshnessRepository.js";
import { freshnessFingerprintPart, freshnessChanges, parseFreshnessAssessment } from "./freshnessContract.js";
import { currentLeadData, leadDataRevision } from "../data-foundation/leadDataSafety.js";
import { loadLeadDataContext } from "../data-foundation/leadDataContext.js";
import { createHash } from "node:crypto";
import { IntelligenceRepository } from "./intelligenceRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { InboundEventsRepository } from "../channels/inboundEventsRepository.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { loadLeadBusinessContext } from "../business-context/businessContextRepository.js";
import { addEnquiryEvidence, contextFingerprintPart, contextWarnings } from "./businessContextEvidence.js";
import { parseJson } from "../../database/database.js";
import {
  CLAIM_FIELDS,
  CONFIDENCE,
  EVIDENCE_SOURCE_TYPES,
  INTELLIGENCE_STATUS,
  PIPELINE_VERSION,
  SNAPSHOT_STATUS
} from "./intelligenceContract.js";
import {
  analyzeReadiness,
  buildDeterministicSignals,
  buildQualificationFoundation,
  buildRecommendation
} from "./readiness.js";

export class IntelligenceService {
  constructor({ intelligenceRepository, auditRepository = null, inboundEventsRepository = null, now = Date.now }) {
    this.intelligenceRepository = intelligenceRepository;
    this.now = now;
    this.auditRepository = auditRepository;
    this.inboundEventsRepository = inboundEventsRepository;
  }

  async createInitialSnapshot(lead) {
    return await this.runForLead(lead);
  }

  async runForLead(lead, { simulate_failure_stage = null } = {}) {
    const db = this.intelligenceRepository.db;
    if (!db.transactionBound) {
      // Deterministic snapshot work has no model/network I/O; serialize it with context writes.
      const outcome = await new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, async tx => {
        const scoped = new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(tx), now: this.now,
          auditRepository: this.auditRepository ? new AuditRepository(tx) : null,
          inboundEventsRepository: this.inboundEventsRepository ? new InboundEventsRepository(tx) : null });
        try { return { value: await scoped.runForLead(lead, { simulate_failure_stage }) }; }
        catch (error) { return { error }; } // Preserve recorded FAILED snapshot semantics.
      });
      if (outcome.error) throw outcome.error;
      return outcome.value;
    }
    lead = await currentLeadData(db, lead);
    const businessContext = await loadLeadBusinessContext(db, { organization_id: lead.organization_id, lead_id: lead.id });
    const freshness = await evaluateFreshness(db, lead, { now: this.now });
    const hydratedLead = hydrateLeadForIntelligence(lead);
    hydratedLead.field_provenance = (await loadLeadDataContext(db, { organization_id: lead.organization_id, lead_id: lead.id })).field_provenance;
    const replies = (await this.inboundEventsRepository?.listForLead(hydratedLead.organization_id, hydratedLead.id)) || [];
    const latestReply = replies[0] || null;
    const inputFingerprint = inputFingerprintForLead(hydratedLead, latestReply, businessContext, freshness);
    const existing = await this.intelligenceRepository.findSnapshotByFingerprint({
      organization_id: hydratedLead.organization_id,
      lead_id: hydratedLead.id,
      input_fingerprint: inputFingerprint,
      pipeline_version: PIPELINE_VERSION
    });

    if (existing?.status === SNAPSHOT_STATUS.READY) {
      return await this.intelligenceRepository.snapshotDetail(existing);
    }

    const snapshot =
      existing ||
      await this.intelligenceRepository.createDraftSnapshot({
        organization_id: hydratedLead.organization_id,
        lead_id: hydratedLead.id,
        version: await this.intelligenceRepository.nextVersionForLead(hydratedLead.id),
        pipeline_version: PIPELINE_VERSION,
        input_fingerprint: inputFingerprint,
        freshness,
        business_fit: evaluateBusinessFit({ businessContext, freshness })
      });

    try {
      if (simulate_failure_stage === "AFTER_DRAFT") {
        throw new Error("Simulated intelligence failure after draft snapshot.");
      }

      await this.intelligenceRepository.replaceSnapshotChildren(snapshot.id);

      const readiness = analyzeReadiness(hydratedLead);
      const evidenceRecords = await createEvidenceForLead({
        lead: hydratedLead,
        snapshotId: snapshot.id,
        repository: this.intelligenceRepository
      });
      if (simulate_failure_stage === "AFTER_EVIDENCE") {
        throw new Error("Simulated intelligence failure after evidence.");
      }

      const leadEvidenceIds = evidenceRecords.map(record => record.id);
      const contextEvidence = await addEnquiryEvidence(this.intelligenceRepository, hydratedLead, snapshot.id, businessContext, freshness);
      evidenceRecords.push(...contextEvidence.records);
      const evidenceByField = new Map(evidenceRecords.map((record) => [record.claim_field, record.id]));
      const claims = await createClaimsForLead({
        lead: hydratedLead,
        snapshotId: snapshot.id,
        evidenceByField,
        repository: this.intelligenceRepository
      });
      claims.push(...contextEvidence.claims);
      const signals = await createSignalsForLead({
        lead: hydratedLead,
        snapshotId: snapshot.id,
        readiness,
        latestReply,
        evidenceIds: leadEvidenceIds,
        repository: this.intelligenceRepository
      });
      const qualification = buildQualificationFoundation(
        readiness,
        signals.map((item) => item.id),
        evidenceRecords.map((record) => record.id)
      );
      await this.intelligenceRepository.createQualification({
        organization_id: hydratedLead.organization_id,
        lead_id: hydratedLead.id,
        snapshot_id: snapshot.id,
        ...qualification
      });
      const recommendation = buildRecommendation(
        hydratedLead,
        readiness,
        evidenceRecords.map((record) => record.id)
      );
      await this.intelligenceRepository.createRecommendation({
        organization_id: hydratedLead.organization_id,
        lead_id: hydratedLead.id,
        snapshot_id: snapshot.id,
        ...recommendation
      });

      const summary = buildSummary(hydratedLead, readiness, latestReply);
      const finalized = await this.intelligenceRepository.finalizeSnapshot(snapshot.id, {
        status: SNAPSHOT_STATUS.READY,
        readiness_status: readiness.status,
        readiness_score: readiness.score,
        summary,
        next_best_action: recommendation.outbound_action_type,
        evidence: evidenceRecords.map((record) => ({
          id: record.id,
          source_type: record.source_type,
          field: record.claim_field,
          confidence: record.confidence
        }))
      });
      await this.intelligenceRepository.supersedeReadySnapshots({
        organization_id: hydratedLead.organization_id,
        lead_id: hydratedLead.id,
        except_snapshot_id: snapshot.id
      });
      await this.auditRepository?.record({
        organization_id: hydratedLead.organization_id,
        lead_id: hydratedLead.id,
        event_type: "LeadIntelligenceUpdated",
        message: "Deterministic Lead Intelligence foundation generated.",
        metadata: {
          snapshot_id: snapshot.id,
          readiness_status: readiness.status,
          readiness_score: readiness.score,
          claim_count: claims.length,
          signal_count: signals.length
        }
      });
      return await this.intelligenceRepository.snapshotDetail(finalized);
    } catch (error) {
      await this.intelligenceRepository.markSnapshotFailed(snapshot.id, error);
      throw error;
    }
  }

  async assessLead(lead) {
    const db = this.intelligenceRepository.db;
    if (!db.transactionBound) return new ContactPolicyService(db).withWorkspacePolicyTransaction(lead.organization_id, tx => new IntelligenceService({ intelligenceRepository: new IntelligenceRepository(tx), inboundEventsRepository: this.inboundEventsRepository ? new InboundEventsRepository(tx) : null, now: this.now }).assessLead(lead));
    lead = await currentLeadData(db, lead, { allowArchived: true, checkRevision: false });
    const businessContext = await loadLeadBusinessContext(db, { organization_id: lead.organization_id, lead_id: lead.id });
    const freshness = await evaluateFreshness(db, lead, { now: this.now });
    const hydratedLead = hydrateLeadForIntelligence(lead), readiness = analyzeReadiness(hydratedLead);
    const replies = (await this.inboundEventsRepository?.listForLead(hydratedLead.organization_id, hydratedLead.id)) || [];
    const latestReply = replies[0] || null;
    const matching = await this.intelligenceRepository.findSnapshotByFingerprint({ organization_id: lead.organization_id, lead_id: lead.id, input_fingerprint: inputFingerprintForLead(hydratedLead, latestReply, businessContext, freshness), pipeline_version: PIPELINE_VERSION });
    const latest = await new FreshnessRepository(db).latestSnapshot(lead.organization_id, lead.id), previous = parseFreshnessAssessment(latest?.freshness_json);
    const snapshot = !lead.archived_at && matching ? await this.intelligenceRepository.snapshotDetail(matching) : null;
    const state = lead.archived_at ? "ARCHIVED" : !latest ? "NEVER_ANALYSED" : snapshot?.status === "READY" ? "CURRENT" : "OUTDATED";
    const reasons = state === "CURRENT" || state === "NEVER_ANALYSED" ? [] : freshnessChanges(previous, freshness);
    if (state === "ARCHIVED") reasons.unshift({ code: "LEAD_ARCHIVED", scope: "LEAD", fields: [] });
    if (state === "OUTDATED" && !reasons.length) reasons.push({ code: latest?.status === "FAILED" ? "ANALYSIS_FAILED" : "INPUTS_CHANGED", scope: "ANALYSIS", fields: [] });
    return {
      data_revision: leadDataRevision(lead), archived_at: lead.archived_at || null, business_context: businessContext, context_warnings: contextWarnings(businessContext, freshness),
      freshness, currentness: { state, assessed_at: freshness.evaluated_at, analysed_at: latest?.created_at || null, next_check_at: freshness.next_transition_at, can_refresh: !lead.archived_at, reasons, evaluated_revisions: previous?.current_revisions || null, current_revisions: freshness.current_revisions },
      lead_status: hydratedLead.status, intelligence_status: intelligenceStatusFor({ snapshot, readiness }), readiness: serializeReadiness(readiness), snapshot, recommendation: snapshot?.recommendation || null
    };
  }

  async latestForLead(lead) {
    const snapshot = await this.intelligenceRepository.latestForLeadInOrganization(lead.id, lead.organization_id);
    return snapshot ? await this.intelligenceRepository.snapshotDetail(snapshot) : null;
  }

  async historyForLead(lead) {
    const snapshots = await this.intelligenceRepository.historyForLead(lead.id, lead.organization_id);
    const details = [];
    for (const snapshot of snapshots) {
      details.push(await this.intelligenceRepository.snapshotDetail(snapshot));
    }
    return details;
  }
}

function intelligenceStatusFor({ snapshot, readiness }) {
  if (!snapshot) {
    return INTELLIGENCE_STATUS.NOT_RUN;
  }
  if (snapshot.status === SNAPSHOT_STATUS.FAILED) {
    return INTELLIGENCE_STATUS.FAILED;
  }
  if (snapshot.status === SNAPSHOT_STATUS.READY && snapshot.readiness_status === "NEEDS_MORE_DATA") {
    return INTELLIGENCE_STATUS.NEEDS_DATA;
  }
  if (snapshot.status === SNAPSHOT_STATUS.READY) {
    return INTELLIGENCE_STATUS.GENERATED;
  }
  if (readiness.status === "NEEDS_MORE_DATA") {
    return INTELLIGENCE_STATUS.NEEDS_DATA;
  }
  return INTELLIGENCE_STATUS.READY_TO_RUN;
}

function serializeReadiness(readiness) {
  return {
    status: readiness.display_status,
    technical_status: readiness.status,
    score: readiness.score,
    factors: readiness.factors,
    missing: readiness.missing,
    reasons: readiness.reasons,
    blocking_reasons: readiness.blockingReasons,
    duplicate_warning_count: readiness.facts.duplicateWarningCount
  };
}

async function createEvidenceForLead({ lead, snapshotId, repository }) {
  const common = {
    organization_id: lead.organization_id,
    lead_id: lead.id,
    snapshot_id: snapshotId,
    source_type: sourceTypeForLead(lead),
    source_reference: sourceReferenceForLead(lead),
    raw_content_reference: rawContentReferenceForLead(lead),
    retrieved_at: null,
    confidence: CONFIDENCE.HIGH,
    metadata: {
      source: lead.source,
      import_batch_id: lead.import_batch_id || null,
      import_row_id: lead.import_row_id || null,
      filename: lead.source_metadata?.filename || null,
      row_number: lead.source_metadata?.row_number || null
    }
  };
  const fieldSource = field => {
    const origin = lead.field_provenance?.[field];
    return origin ? { ...common, source_type: EVIDENCE_SOURCE_TYPES.MANUAL, source_reference: "lead-data-change:" + origin.change_id,
      raw_content_reference: "lead-data-change:" + origin.change_id + ":" + field,
      metadata: { ...common.metadata, field_provenance: origin, field, created_at: origin.created_at } } : common;
  };
  const contactEmail = contactEmailForLead(lead);
  const contactPhone = contactPhoneForLead(lead);
  const evidence = [];
  await pushEvidence(evidence, repository, fieldSource("name"), CLAIM_FIELDS.LEAD_NAME, lead.name, "Customer-provided lead name");
  await pushEvidence(evidence, repository, fieldSource("company"), CLAIM_FIELDS.COMPANY_NAME, lead.company, "Customer-provided company");
  await pushEvidence(evidence, repository, fieldSource("email"), CLAIM_FIELDS.CONTACT_EMAIL, contactEmail, "Customer-provided email");
  await pushEvidence(
    evidence,
    repository,
    fieldSource("phone"),
    CLAIM_FIELDS.CONTACT_PHONE,
    contactPhone,
    "Customer-provided phone"
  );
  await pushEvidence(evidence, repository, common, CLAIM_FIELDS.LEAD_SOURCE, lead.source, "Recorded lead source");
  await pushEvidence(
    evidence,
    repository,
    common,
    CLAIM_FIELDS.PROVENANCE,
    sourceReferenceForLead(lead),
    "Lead provenance reference"
  );
  return evidence;
}

async function pushEvidence(evidence, repository, common, claimField, claimValue, title) {
  if (!claimValue) {
    return;
  }
  evidence.push(
    await repository.createEvidence({
      ...common,
      title: common.metadata.field_provenance ? "Owner-corrected " + common.metadata.field : title,
      claim_field: claimField,
      claim_value: String(claimValue),
      evidence_timestamp: common.metadata.import_row_id ? null : common.metadata.created_at || null
    })
  );
}

async function createClaimsForLead({ lead, snapshotId, evidenceByField, repository }) {
  const claims = [];
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.LEAD_NAME, lead.name, evidenceByField);
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.COMPANY_NAME, lead.company, evidenceByField);
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.CONTACT_EMAIL, contactEmailForLead(lead), evidenceByField);
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.CONTACT_PHONE, contactPhoneForLead(lead), evidenceByField);
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.LEAD_SOURCE, lead.source, evidenceByField);
  await pushClaim(claims, repository, lead, snapshotId, CLAIM_FIELDS.PROVENANCE, sourceReferenceForLead(lead), evidenceByField);
  return claims;
}

async function pushClaim(claims, repository, lead, snapshotId, field, value, evidenceByField) {
  if (!value) {
    return;
  }
  claims.push(
    await repository.createClaim({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      snapshot_id: snapshotId,
      field,
      value,
      confidence: CONFIDENCE.HIGH,
      evidence_ids: evidenceByField.get(field) ? [evidenceByField.get(field)] : []
    })
  );
}

async function createSignalsForLead({ lead, snapshotId, readiness, latestReply, evidenceIds, repository }) {
  const signals = [];
  for (const signal of buildDeterministicSignals(lead, readiness, latestReply)) {
    signals.push(
      await repository.createSignal({
        organization_id: lead.organization_id,
        lead_id: lead.id,
        snapshot_id: snapshotId,
        ...signal,
        evidence_ids: evidenceIds
      })
    );
  }
  return signals;
}

function buildSummary(lead, readiness, latestReply = null) {
  const known = [];
  if (lead.company) {
    known.push(`company ${lead.company}`);
  }
  if (contactEmailForLead(lead)) {
    known.push("email");
  }
  if (contactPhoneForLead(lead)) {
    known.push("phone");
  }
  const prefix = known.length > 0 ? `The system has ${known.join(", ")} from customer-owned data.` : "The lead has limited data.";
  const replyNote = latestReply?.event_type ? ` ${REPLY_SUMMARY_NOTE[latestReply.event_type] || ""}` : "";
  if (readiness.status === "READY_FOR_INTELLIGENCE") {
    return `${prefix} This is a data-readiness assessment, not external AI research.${replyNote}`;
  }
  return `${prefix} More identity or contact information is needed before meaningful intelligence can be produced.${replyNote}`;
}

const REPLY_SUMMARY_NOTE = {
  POSITIVE_REPLY: "The lead's most recent reply was positive.",
  NEGATIVE_REPLY: "The lead's most recent reply was negative.",
  QUESTION: "The lead's most recent reply asked a question that still needs an answer.",
  OPT_OUT: "The lead opted out of further contact.",
  UNKNOWN: "The lead's most recent reply could not be classified confidently and needs review."
};

function contactEmailForLead(lead) {
  const value = lead.normalized_email || lead.email;
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

function contactPhoneForLead(lead) {
  const value = lead.normalized_phone;
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.trim()) ? value.trim() : null;
}

function inputFingerprintForLead(lead, latestReply = null, businessContext = null, freshness = null) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...freshnessFingerprintPart(freshness),
        ...(leadDataRevision(lead) ? { data_revision: leadDataRevision(lead) } : {}),
        ...(businessContext ? contextFingerprintPart(businessContext) : {}),
        id: lead.id,
        organization_id: lead.organization_id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        normalized_email: lead.normalized_email,
        normalized_phone: lead.normalized_phone,
        company: lead.company,
        source: lead.source,
        import_batch_id: lead.import_batch_id,
        import_row_id: lead.import_row_id,
        source_metadata: fingerprintSourceMetadata(lead.source_metadata),
        latest_reply: latestReply ? { event_type: latestReply.event_type, received_at: latestReply.received_at } : null
      })
    )
    .digest("hex");
}

function fingerprintSourceMetadata(sourceMetadata = {}) {
  return {
    adapter_type: sourceMetadata.adapter_type || null,
    import_id: sourceMetadata.import_id || null,
    import_row_id: sourceMetadata.import_row_id || null,
    filename: sourceMetadata.filename || null,
    row_number: sourceMetadata.row_number || null,
    duplicate_candidate_count: sourceMetadata.duplicate_candidate_count || 0
  };
}

function hydrateLeadForIntelligence(lead) {
  return {
    ...lead,
    source_metadata:
      lead.source_metadata || (typeof lead.source_metadata_json === "string" ? parseJson(lead.source_metadata_json) || {} : {})
  };
}

function sourceTypeForLead(lead) {
  if (lead.source === "CSV") {
    return EVIDENCE_SOURCE_TYPES.CSV;
  }
  if (lead.source === "MANUAL") {
    return EVIDENCE_SOURCE_TYPES.MANUAL;
  }
  return EVIDENCE_SOURCE_TYPES.CUSTOMER_PROVIDED;
}

function sourceReferenceForLead(lead) {
  if (lead.import_batch_id || lead.import_row_id) {
    return [lead.import_batch_id, lead.import_row_id].filter(Boolean).join(":");
  }
  return `lead:${lead.id}`;
}

function rawContentReferenceForLead(lead) {
  return lead.import_row_id ? `import_row:${lead.import_row_id}` : null;
}
