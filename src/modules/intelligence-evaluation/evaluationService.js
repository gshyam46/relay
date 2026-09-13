import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LocalReplyClassifier } from "../channels/replyClassifier.js";
import { REPLY_POLICY_VERSION } from "../channels/replyInterpretationContract.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { EvaluationRepository, groupsFor } from "./evaluationRepository.js";
import { aggregateReplay, validateAggregateReplay } from "./evaluationMetrics.js";
import { EVALUATION_VERSION, caseProjection, evaluationError, exactKeys, hash, integer, labelsCurrent, normalizeCreate, parseBounded, text, textHash } from "./evaluationContract.js";

const sourceFiles = ["../channels/replyClassifier.js", "../channels/replyInterpretationContract.js", "./evaluationContract.js", "./evaluationMetrics.js", "./evaluationRepository.js", "./evaluationService.js"];
// Captured once with the loaded implementation, never taken from a client or a
// freshly edited file while an older classifier remains in Node's module cache.
const loadedVersions = Object.freeze({ evaluation_version: EVALUATION_VERSION, reply_policy_version: REPLY_POLICY_VERSION, candidate_kind: "CURRENT_LOCAL_RULES", source_sha256: Object.freeze(Object.fromEntries(sourceFiles.map(file => [file, textHash(readFileSync(new URL(file, import.meta.url)))]))) });
const loadedSourceHash = hash(loadedVersions);
export function evaluationCandidateIdentity() { return structuredClone({ candidate_source_sha256: loadedSourceHash, candidate_versions: loadedVersions }); }
const datasetFields = ["id", "name", "version", "split", "manifest_sha256", "case_count", "created_at", "created_by"];

export class IntelligenceEvaluationService {
  constructor(db, { now = Date.now } = {}) { this.db = db.rootDatabase || db; this.now = now; }
  async gate(input, work) {
    const org = text(input.organization_id), actor = input.actor;
    if (!actor || actor.role !== "OWNER") throw evaluationError("EVALUATION_OWNER_REQUIRED");
    text(actor.id);
    return new ContactPolicyService(this.db).withWorkspacePolicyTransaction(org, async tx => {
      const owner = await tx.get("SELECT role FROM users WHERE organization_id=? AND id=?", [org, actor.id]);
      if (owner?.role !== "OWNER") throw evaluationError("EVALUATION_OWNER_REQUIRED");
      return work(tx, new EvaluationRepository(tx, org));
    });
  }
  timestamp() { try { return new Date(this.now()).toISOString(); } catch { throw evaluationError("EVALUATION_STATE_INVALID"); } }
  async state(repo, row) {
    const members = await repo.members(row), metadata = await repo.feedbackMetadata(members), current = metadata.every(labelsCurrent);
    const existing = await repo.existingEvaluation(row.id, loadedSourceHash);
    const groups = await repo.groups(members);
    if (groups.length !== groupsFor(members).length || groups.some(group => group.split !== row.split)) throw evaluationError("EVALUATION_STATE_INVALID");
    const consumed = row.split === "HOLDOUT" && groups.some(group => group.consumed_evaluation_id);
    const hold = !current ? "EVALUATION_LABELS_CHANGED" : consumed && !existing ? "EVALUATION_HOLDOUT_CONSUMED" : null;
    return { members, current, existing, groups, hold };
  }
  async datasetView(repo, row, state = null) {
    state ||= await this.state(repo, row);
    return { ...Object.fromEntries(datasetFields.map(key => [key, row[key]])), labels_current: state.current, can_evaluate: !state.hold, hold_reason: state.hold };
  }
  evaluationView(row, current) {
    const versions = parseBounded(row.candidate_versions_json, 32768); let metrics;
    try {
      exactKeys(versions, ["evaluation_version", "reply_policy_version", "candidate_kind", "source_sha256"]);
      if (versions.candidate_kind !== "CURRENT_LOCAL_RULES" || !/^[a-z0-9.-]{1,100}$/.test(versions.evaluation_version || "") || !/^[a-z0-9.-]{1,100}$/.test(versions.reply_policy_version || "")) throw new Error();
      exactKeys(versions.source_sha256, sourceFiles);
      if (Object.values(versions.source_sha256).some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) throw new Error();
      metrics = validateAggregateReplay(parseBounded(row.metrics_json, 262144));
    } catch { throw evaluationError("EVALUATION_STATE_INVALID"); }
    if (hash(versions) !== row.candidate_source_sha256 || metrics?.version !== 1 || metrics?.execution_mode !== "LOCAL_RULE_REPLAY" || metrics?.provider_calls !== 0 || metrics?.release_decision !== "NOT_AUTHORIZED") throw evaluationError("EVALUATION_STATE_INVALID");
    return { id: row.id, dataset_id: row.dataset_id, manifest_sha256: row.manifest_sha256, candidate_source_sha256: row.candidate_source_sha256, candidate_versions: versions, metrics, created_at: row.created_at, created_by: row.created_by, labels_current: current };
  }
  async createDataset(input) {
    const value = normalizeCreate(input);
    return this.gate(input, async (tx, repo) => {
      const prior = await tx.get("SELECT id,request_hash FROM intelligence_evaluation_datasets WHERE organization_id=? AND request_key=?", [repo.org, value.request_key]);
      if (prior) { if (prior.request_hash !== value.request_hash) throw evaluationError("EVALUATION_REQUEST_CONFLICT"); return this.datasetView(repo, await repo.dataset(prior.id)); }
      const head = await tx.get("SELECT MAX(version) AS version FROM intelligence_evaluation_datasets WHERE organization_id=? AND name=?", [repo.org, value.name]);
      if (Number(head.version || 0) !== value.expected_version) throw evaluationError("EVALUATION_VERSION_STALE");
      const metadata = await repo.feedbackMetadata(value.feedback_revisions);
      if (!metadata.every(labelsCurrent)) throw evaluationError("EVALUATION_LABELS_CHANGED");
      const cases = [];
      for (const ref of value.feedback_revisions) cases.push(caseProjection(await repo.feedback(ref)));
      const members = cases.map(item => ({ feedback_id: item.feedback_id, revision: item.revision, lead_id: item.lead_id, reply_text_sha256: textHash(item.reply.text), case_sha256: hash(item) }));
      if (new Set(members.map(item => item.reply_text_sha256)).size !== members.length) throw evaluationError("EVALUATION_REQUEST_INVALID");
      const previousGroups = await repo.groups(members);
      if (previousGroups.some(group => group.split !== value.split)) throw evaluationError("EVALUATION_SPLIT_CONFLICT");
      const id = randomUUID(), at = this.timestamp(), version = value.expected_version + 1;
      const manifest = { version: 1, dataset: { name: value.name, version, split: value.split }, cases: members }, manifestJson = JSON.stringify(manifest);
      if (Buffer.byteLength(manifestJson) > 131072) throw evaluationError("EVALUATION_LIMIT");
      await tx.run("INSERT INTO intelligence_evaluation_datasets(id,organization_id,name,version,split,manifest_sha256,manifest_json,case_count,created_by,created_at,request_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [id, repo.org, value.name, version, value.split, hash(manifest), manifestJson, members.length, input.actor.id, at, value.request_key, value.request_hash]);
      for (const [position, member] of members.entries()) await tx.run("INSERT INTO intelligence_evaluation_members(organization_id,dataset_id,position,feedback_id,feedback_revision,lead_id,reply_text_sha256,case_sha256) VALUES (?,?,?,?,?,?,?,?)", [repo.org, id, position, member.feedback_id, member.revision, member.lead_id, member.reply_text_sha256, member.case_sha256]);
      for (const group of groupsFor(members)) await tx.run("INSERT INTO intelligence_evaluation_groups(organization_id,group_kind,group_key,split,first_dataset_id,consumed_evaluation_id) VALUES (?,?,?,?,?,NULL) ON CONFLICT(organization_id,group_kind,group_key) DO NOTHING", [repo.org, group.group_kind, group.group_key, value.split, id]);
      await new AuditRepository(tx).record({ organization_id: repo.org, event_type: "IntelligenceEvaluationDatasetCreated", message: "Owner froze an explicitly selected reviewed reply dataset.", metadata: { dataset_id: id, version, split: value.split, case_count: members.length, actor: input.actor.id } });
      return this.datasetView(repo, await repo.dataset(id));
    });
  }
  async getDatasetRequest(input) {
    exactKeys(input, ["organization_id", "actor", "request_key"]); text(input.request_key, 200);
    return this.gate(input, async (tx, repo) => { const row = await tx.get("SELECT id FROM intelligence_evaluation_datasets WHERE organization_id=? AND request_key=?", [repo.org, input.request_key]); return { dataset: row ? await this.datasetView(repo, await repo.dataset(row.id)) : null }; });
  }
  async getDataset(input) { exactKeys(input, ["organization_id", "actor", "dataset_id"]); text(input.dataset_id); return this.gate(input, async (_, repo) => this.datasetView(repo, await repo.dataset(input.dataset_id))); }
  async listDatasets(input) {
    exactKeys(input, ["organization_id", "actor"], ["limit", "before_dataset_id"]);
    const limit = integer(input.limit ?? 20, 1, 50); if (input.before_dataset_id !== undefined) text(input.before_dataset_id);
    return this.gate(input, async (tx, repo) => {
      const params = [repo.org]; let cursor = "";
      if (input.before_dataset_id !== undefined) { const before = await repo.dataset(input.before_dataset_id); cursor = " AND (created_at<? OR (created_at=? AND id<?))"; params.push(before.created_at, before.created_at, before.id); }
      params.push(limit + 1);
      const rows = await tx.all("SELECT id FROM intelligence_evaluation_datasets WHERE organization_id=?" + cursor + " ORDER BY created_at DESC,id DESC LIMIT ?", params), items = [];
      for (const row of rows.slice(0, limit)) items.push(await this.datasetView(repo, await repo.dataset(row.id)));
      return { items, limit, has_more: rows.length > limit, next_before_dataset_id: rows.length > limit ? items.at(-1).id : null };
    });
  }
  async evaluate(input) {
    exactKeys(input, ["organization_id", "actor", "dataset_id"]); text(input.dataset_id);
    return this.gate(input, async (tx, repo) => {
      const dataset = await repo.dataset(input.dataset_id), state = await this.state(repo, dataset);
      if (state.existing) return this.evaluationView(state.existing, state.current);
      if (state.hold) throw evaluationError(state.hold);
      const cases = [];
      for (const member of state.members) {
        const item = caseProjection(await repo.feedback(member));
        if (hash(item) !== member.case_sha256 || textHash(item.reply.text) !== member.reply_text_sha256) throw evaluationError("EVALUATION_STATE_INVALID");
        cases.push(item);
      }
      const classifier = new LocalReplyClassifier(), predictions = cases.map(item => classifier.classify(item.reply.text)), metrics = aggregateReplay(cases, predictions);
      const id = randomUUID(), at = this.timestamp(), serialized = JSON.stringify(metrics);
      if (Buffer.byteLength(serialized) > 262144) throw evaluationError("EVALUATION_LIMIT");
      await tx.run("INSERT INTO intelligence_evaluations(id,organization_id,dataset_id,candidate_source_sha256,candidate_versions_json,manifest_sha256,metrics_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [id, repo.org, dataset.id, loadedSourceHash, JSON.stringify(loadedVersions), dataset.manifest_sha256, serialized, input.actor.id, at]);
      if (dataset.split === "HOLDOUT") for (const group of state.groups) {
        const result = await tx.run("UPDATE intelligence_evaluation_groups SET consumed_evaluation_id=? WHERE organization_id=? AND group_kind=? AND group_key=? AND consumed_evaluation_id IS NULL", [id, repo.org, group.group_kind, group.group_key]);
        if (result.changes !== 1) throw evaluationError("EVALUATION_STATE_INVALID");
      }
      await new AuditRepository(tx).record({ organization_id: repo.org, event_type: "IntelligenceEvaluationRecorded", message: "Owner recorded an aggregate local-rule evaluation against reviewed reply labels.", metadata: { dataset_id: dataset.id, evaluation_id: id, case_count: cases.length, split: dataset.split, candidate_source_sha256: loadedSourceHash, actor: input.actor.id } });
      return this.evaluationView(await repo.existingEvaluation(dataset.id, loadedSourceHash), true);
    });
  }
  async listEvaluations(input) {
    exactKeys(input, ["organization_id", "actor", "dataset_id"], ["limit", "before_evaluation_id"]); text(input.dataset_id);
    const limit = integer(input.limit ?? 20, 1, 50); if (input.before_evaluation_id !== undefined) text(input.before_evaluation_id);
    return this.gate(input, async (tx, repo) => {
      const dataset = await repo.dataset(input.dataset_id), state = await this.state(repo, dataset), params = [repo.org, dataset.id]; let cursor = "";
      if (input.before_evaluation_id !== undefined) { const before = await tx.get("SELECT created_at,id FROM intelligence_evaluations WHERE organization_id=? AND dataset_id=? AND id=?", [...params, input.before_evaluation_id]); if (!before) throw evaluationError("EVALUATION_NOT_FOUND"); cursor = " AND (created_at<? OR (created_at=? AND id<?))"; params.push(before.created_at, before.created_at, before.id); }
      params.push(limit + 1);
      const rows = await tx.all("SELECT * FROM intelligence_evaluations WHERE organization_id=? AND dataset_id=?" + cursor + " ORDER BY created_at DESC,id DESC LIMIT ?", params), items = rows.slice(0, limit).map(row => { if (row.manifest_sha256 !== dataset.manifest_sha256) throw evaluationError("EVALUATION_STATE_INVALID"); return this.evaluationView(row, state.current); });
      return { items, limit, has_more: rows.length > limit, next_before_evaluation_id: rows.length > limit ? items.at(-1).id : null };
    });
  }
}
