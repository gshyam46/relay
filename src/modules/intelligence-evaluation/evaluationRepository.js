import { loadEvaluationFeedback } from "../intelligence-feedback/intelligenceFeedbackRepository.js";
import { evaluationError, hash, MAX_CASES, MAX_SNAPSHOT_BYTES, parseBounded } from "./evaluationContract.js";

export function groupsFor(members) {
  const groups = new Map();
  for (const member of members) for (const [group_kind, group_key] of [["LEAD", member.lead_id], ["REPLY_TEXT", member.reply_text_sha256]]) groups.set(group_kind + ":" + group_key, { group_kind, group_key });
  return [...groups.values()];
}
export class EvaluationRepository {
  constructor(db, organizationId) { this.db = db; this.org = organizationId; }
  async dataset(id) {
    const row = await this.db.get("SELECT * FROM intelligence_evaluation_datasets WHERE organization_id=? AND id=?", [this.org, id]);
    if (!row) throw evaluationError("EVALUATION_NOT_FOUND");
    const manifest = parseBounded(row.manifest_json, 131072);
    if (hash(manifest) !== row.manifest_sha256 || !Array.isArray(manifest.cases) || manifest.cases.length !== row.case_count || row.case_count < 1 || row.case_count > MAX_CASES || manifest.dataset?.name !== row.name || manifest.dataset?.version !== row.version || manifest.dataset?.split !== row.split) throw evaluationError("EVALUATION_STATE_INVALID");
    return row;
  }
  async members(row) {
    const members = await this.db.all("SELECT * FROM intelligence_evaluation_members WHERE organization_id=? AND dataset_id=? ORDER BY position LIMIT 101", [this.org, row.id]);
    const manifest = parseBounded(row.manifest_json, 131072);
    if (members.length !== row.case_count || members.some((member, index) => member.position !== index) || hash(members.map(({ feedback_id, feedback_revision, lead_id, reply_text_sha256, case_sha256 }) => ({ feedback_id, revision: feedback_revision, lead_id, reply_text_sha256, case_sha256 }))) !== hash(manifest.cases)) throw evaluationError("EVALUATION_STATE_INVALID");
    return members;
  }
  async feedbackMetadata(references) {
    if (!references.length || references.length > MAX_CASES) throw evaluationError("EVALUATION_LIMIT");
    const items = []; let bytes = 0;
    for (const ref of references) {
      const item = await loadEvaluationFeedback(this.db, { organization_id: this.org, feedback_id: ref.feedback_id, revision: ref.revision ?? ref.feedback_revision, metadataOnly: true });
      if (!item || !Number.isSafeInteger(item.snapshot_bytes) || item.snapshot_bytes < 1) throw evaluationError("EVALUATION_STATE_INVALID");
      bytes += item.snapshot_bytes;
      if (bytes > MAX_SNAPSHOT_BYTES) throw evaluationError("EVALUATION_LIMIT");
      items.push(item);
    }
    return items;
  }
  feedback(ref) { return loadEvaluationFeedback(this.db, { organization_id: this.org, feedback_id: ref.feedback_id, revision: ref.revision ?? ref.feedback_revision }); }
  async groups(members) {
    const groups = groupsFor(members), predicates = groups.map(() => "(group_kind=? AND group_key=?)").join(" OR ");
    return this.db.all("SELECT * FROM intelligence_evaluation_groups WHERE organization_id=? AND (" + predicates + ")", [this.org, ...groups.flatMap(group => [group.group_kind, group.group_key])]);
  }
  async existingEvaluation(datasetId, sourceHash) { return this.db.get("SELECT * FROM intelligence_evaluations WHERE organization_id=? AND dataset_id=? AND candidate_source_sha256=?", [this.org, datasetId, sourceHash]); }
}
