import { createHash } from "node:crypto";
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
  constructor({ intelligenceRepository, auditRepository = null, inboundEventsRepository = null }) {
    this.intelligenceRepository = intelligenceRepository;
    this.auditRepository = auditRepository;
    this.inboundEventsRepository = inboundEventsRepository;
  }

  async createInitialSnapshot(lead) {
    return await this.runForLead(lead);
  }

  async runForLead(lead, { simulate_failure_stage = null } = {}) {
    const hydratedLead = hydrateLeadForIntelligence(lead);
    const replies = (await this.inboundEventsRepository?.listForLead(hydratedLead.organization_id, hydratedLead.id)) || [];
    const latestReply = replies[0] || null;
    const inputFingerprint = inputFingerprintForLead(hydratedLead, latestReply);
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
        input_fingerprint: inputFingerprint
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

      const evidenceByField = new Map(evidenceRecords.map((record) => [record.claim_field, record.id]));
      const claims = await createClaimsForLead({
        lead: hydratedLead,
        snapshotId: snapshot.id,
        evidenceByField,
        repository: this.intelligenceRepository
      });
      const signals = await createSignalsForLead({
        lead: hydratedLead,
        snapshotId: snapshot.id,
        readiness,
        latestReply,
        evidenceIds: evidenceRecords.map((record) => record.id),
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
    const hydratedLead = hydrateLeadForIntelligence(lead);
    const readiness = analyzeReadiness(hydratedLead);
    const replies = (await this.inboundEventsRepository?.listForLead(hydratedLead.organization_id, hydratedLead.id)) || [];
    const latestReply = replies[0] || null;
    const latestSnapshot = await this.intelligenceRepository.findSnapshotByFingerprint({
      organization_id: hydratedLead.organization_id,
      lead_id: hydratedLead.id,
      input_fingerprint: inputFingerprintForLead(hydratedLead, latestReply),
      pipeline_version: PIPELINE_VERSION
    });
    const snapshot = latestSnapshot ? await this.intelligenceRepository.snapshotDetail(latestSnapshot) : null;
    return {
      lead_status: hydratedLead.status,
      intelligence_status: intelligenceStatusFor({ snapshot, readiness }),
      readiness: serializeReadiness(readiness),
      snapshot,
      recommendation: snapshot?.recommendation || null
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
  const contactEmail = contactEmailForLead(lead);
  const contactPhone = contactPhoneForLead(lead);
  const evidence = [];
  await pushEvidence(evidence, repository, common, CLAIM_FIELDS.LEAD_NAME, lead.name, "Customer-provided lead name");
  await pushEvidence(evidence, repository, common, CLAIM_FIELDS.COMPANY_NAME, lead.company, "Customer-provided company");
  await pushEvidence(evidence, repository, common, CLAIM_FIELDS.CONTACT_EMAIL, contactEmail, "Customer-provided email");
  await pushEvidence(
    evidence,
    repository,
    common,
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
      title,
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

function inputFingerprintForLead(lead, latestReply = null) {
  return createHash("sha256")
    .update(
      JSON.stringify({
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
