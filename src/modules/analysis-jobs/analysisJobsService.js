import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { requireLeadDataOwner } from "../data-foundation/leadDataContract.js";
import { EventsRepository } from "../events/eventsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { getGenerationDescriptor } from "../ai-usage/generationDescriptor.js";
import { AnalysisJobsRepository } from "./analysisJobsRepository.js";
import { analysisError, enqueueCommand, jobText, jobInteger, jobHash, eventRetryable, TERMINAL_EVENTS, MAX_UNFINISHED_ITEMS } from "./analysisJobsContract.js";
import { runAnalysisPipeline } from "./analysisPipelineRunner.js";
import { IntelligenceRepository } from "../lead-intelligence/intelligenceRepository.js";
import { SynthesisRepository } from "../lead-intelligence/synthesisRepository.js";
import { IntelligenceRecommendationRepository } from "../lead-intelligence/intelligenceRecommendationRepository.js";
import { NextBestActionRepository } from "../next-best-action/nextBestActionRepository.js";

export class AnalysisJobsService {
  constructor({ db, getServices, now = Date.now }) {
    if (!db || typeof getServices !== "function") throw new TypeError("Analysis jobs require database and services.");
    this.db = db; this.getServices = getServices; this.now = now; this.policy = new ContactPolicyService(db);
  }
  time() { const at = this.now(); if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(new Date(at).getTime())) throw new TypeError("Invalid analysis clock."); return at; }
  transaction(org, work) { return this.policy.withWorkspacePolicyTransaction(org, work); }
  async enqueue(input) {
    const command = enqueueCommand(input);
    const { organization_id: org, request_key, actor } = command;
    const requestHash = jobHash({ lead_ids: command.lead_ids, mode: command.mode, target_stage: command.target_stage, execution_scope: command.execution_scope, simulation: command.simulation });
    return this.transaction(org, async tx => {
      await requireLeadDataOwner(tx, org, actor);
      const repository = new AnalysisJobsRepository(tx), prior = await repository.byKey(org, request_key);
      if (prior) {
        if (prior.request_hash !== requestHash) throw analysisError("ANALYSIS_REQUEST_CONFLICT", "This request key already records different analysis work.", 409);
        return { job: await repository.detail(org, prior.id, this.time()), replayed: true };
      }
      for (const id of command.lead_ids) {
        const lead = await tx.get("SELECT id,archived_at FROM leads WHERE organization_id=? AND id=?", [org, id]);
        if (!lead) throw analysisError("ANALYSIS_LEAD_NOT_FOUND", "A selected enquiry is unavailable in this workspace.", 404);
        if (lead.archived_at) throw analysisError("LEAD_ARCHIVED", "Restore archived enquiries before starting analysis.", 409);
      }
      if (await repository.unfinished(org) + command.lead_ids.length > MAX_UNFINISHED_ITEMS) throw analysisError("ANALYSIS_QUEUE_LIMIT", "This workspace already has its allowed unfinished analysis work. Finish or cancel existing jobs.", 429);
      const descriptor = getGenerationDescriptor(this.db), generationJson = JSON.stringify(descriptor);
      if (!descriptor || Buffer.byteLength(generationJson, "utf8") > 8192) throw analysisError("ANALYSIS_VERSION_CHANGED", "The analysis generation contract is unavailable.", 409);
      const timestamp = new Date(this.time()).toISOString(), id = createId("analysis");
      const row = { id, organization_id: org, request_key, request_hash: requestHash, requested_by: actor.id, mode: command.mode, target_stage: command.target_stage,
        execution_scope: command.execution_scope, generation_json: generationJson, simulation_json: command.simulation ? JSON.stringify({ simulate_failure_stage: command.simulation }) : null,
        revision: 0, command_history_json: "[]", created_at: timestamp, updated_at: timestamp, cancelled_at: null, cancel_reason: null };
      await repository.insertJob(row);
      for (const [ordinal, lead_id] of command.lead_ids.entries()) {
        const itemId = createId("analysis_item");
        const event = await new EventsRepository(tx).publish({ organization_id: org, lead_id, type: "AnalysisRequested", payload: { job_id: id, item_id: itemId } });
        await repository.insertItem({ id: itemId, organization_id: org, job_id: id, lead_id, event_id: event.id, ordinal });
      }
      await new AuditRepository(tx).record({ organization_id: org, event_type: "AnalysisRequested", message: "Owner requested bounded Lead Intelligence analysis.", metadata: { job_id: id, item_count: command.lead_ids.length, mode: command.mode, target_stage: command.target_stage, actor: actor.id } });
      return { job: await repository.detail(org, id, this.time()), replayed: false };
    });
  }
  async get({ organization_id, job_id }) {
    const org = jobText(organization_id, "organization_id"), id = jobText(job_id, "job_id");
    return this.transaction(org, async tx => ({ job: await new AnalysisJobsRepository(tx).detail(org, id, this.time()) }));
  }
  async findByRequestKey({ organization_id, request_key }) {
    const org = jobText(organization_id, "organization_id"), key = jobText(request_key, "request_key");
    return this.transaction(org, async tx => { const repository = new AnalysisJobsRepository(tx), row = await repository.byKey(org, key); return { job: row ? await repository.detail(org, row.id, this.time()) : null }; });
  }
  async list({ organization_id, lead_id, request_key, limit, offset }) {
    const org = jobText(organization_id, "organization_id"), cap = jobInteger(limit, 10, 1, 20), skip = jobInteger(offset, 0, 0, 10000);
    const where = ["j.organization_id=?"], parameters = [org];
    if (lead_id !== undefined) { where.push("EXISTS(SELECT 1 FROM analysis_job_items i WHERE i.organization_id=j.organization_id AND i.job_id=j.id AND i.lead_id=?)"); parameters.push(jobText(lead_id, "lead_id")); }
    if (request_key !== undefined) { where.push("j.request_key=?"); parameters.push(jobText(request_key, "request_key")); }
    return this.transaction(org, async tx => {
      const sql = where.join(" AND "), total = Number((await tx.get("SELECT count(*) AS n FROM analysis_jobs j WHERE " + sql, parameters)).n);
      const rows = await tx.all("SELECT j.id FROM analysis_jobs j WHERE " + sql + " ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?", [...parameters, cap, skip]), repository = new AnalysisJobsRepository(tx), jobs = [];
      for (const row of rows) jobs.push(await repository.detail(org, row.id, this.time()));
      return { jobs, total, has_more: total > skip + jobs.length, limit: cap, offset: skip };
    });
  }
  cancel(input) { return this.command(input, "CANCEL"); }
  retry(input) { return this.command(input, "RETRY"); }
  async command(input, kind) {
    const org = jobText(input.organization_id, "organization_id"), id = jobText(input.job_id, "job_id"), reason = jobText(input.reason, "reason", 2000);
    const revision = jobInteger(input.expected_revision, null, 0, 2147483646);
    if (revision === null) throw analysisError("ANALYSIS_INVALID_INPUT", "Provide the reviewed job revision.");
    return this.transaction(org, async tx => {
      await requireLeadDataOwner(tx, org, input.actor);
      const repository = new AnalysisJobsRepository(tx), row = await repository.row(org, id);
      if (!row) throw analysisError("ANALYSIS_JOB_NOT_FOUND", "Analysis job not found.", 404);
      let history; try { history = JSON.parse(row.command_history_json); if (!Array.isArray(history) || history.length > 100) throw new Error(); } catch { throw analysisError("ANALYSIS_JOB_INVALID", "Recorded job command history requires review.", 409); }
      const hash = jobHash({ kind, reason, revision, actor: input.actor.id }), prior = history.find(change => change.expected_revision === revision);
      if (prior) {
        if (prior.request_hash !== hash) throw analysisError("ANALYSIS_COMMAND_CONFLICT", "A different decision already used this job revision.", 409);
        return { job: await repository.detail(org, id, this.time()) };
      }
      if (row.revision !== revision) throw analysisError("ANALYSIS_STALE_REVIEW", "Analysis job decisions changed. Refresh before deciding.", 409);
      if (row.cancelled_at) throw analysisError("ANALYSIS_JOB_CANCELLED", "Cancelled analysis jobs cannot reopen.", 409);
      const items = await repository.items(org, id), now = this.time(), timestamp = new Date(now).toISOString();
      const selected = items.filter(item => kind === "CANCEL" ? !TERMINAL_EVENTS.has(item.status) : eventRetryable(item, now));
      if (!selected.length) throw analysisError("ANALYSIS_COMMAND_UNAVAILABLE", "This decision has no eligible unfinished analysis items.", 409);
      if (history.length >= 100) throw analysisError("ANALYSIS_HISTORY_LIMIT", "This job reached its bounded decision history.", 409);
      history.push({ expected_revision: revision, revision: revision + 1, kind, reason, actor: input.actor.id, request_hash: hash, created_at: timestamp, item_ids: selected.map(item => item.id) });
      const historyJson = JSON.stringify(history);
      if (Buffer.byteLength(historyJson, "utf8") > 65536) throw analysisError("ANALYSIS_HISTORY_LIMIT", "This job reached its bounded decision history.", 409);
      for (const item of selected) {
        if (!Number.isSafeInteger(item.processing_fence) || item.processing_fence >= Number.MAX_SAFE_INTEGER) throw analysisError("ANALYSIS_JOB_INVALID", "Invalid processing fence requires review.", 409);
        await tx.run("UPDATE domain_events SET status=?,processing_fence=processing_fence+1,next_attempt_at=?,processing_hold_reason=?,lease_owner=NULL,lease_expires_at=NULL,processed_at=?,updated_at=? WHERE organization_id=? AND id=?",
          [kind === "CANCEL" ? "DISMISSED" : "RETRY_PENDING", kind === "RETRY" ? timestamp : null, kind === "CANCEL" ? "ANALYSIS_JOB_CANCELLED" : null, kind === "CANCEL" ? timestamp : null, timestamp, org, item.event_id]);
      }
      await tx.run("UPDATE analysis_jobs SET revision=revision+1,command_history_json=?,updated_at=?,cancelled_at=?,cancel_reason=? WHERE organization_id=? AND id=?",
        [historyJson, timestamp, kind === "CANCEL" ? timestamp : null, kind === "CANCEL" ? reason : null, org, id]);
      await new AuditRepository(tx).record({ organization_id: org, event_type: "AnalysisReviewed", message: kind === "CANCEL" ? "Owner cancelled unfinished analysis work." : "Owner requested a bounded analysis retry.", metadata: { job_id: id, kind, reason, actor: input.actor.id, revision: revision + 1, item_count: selected.length } });
      return { job: await repository.detail(org, id, this.time()) };
    });
  }
  async processOnce({ organization_id, job_id, event_id }) {
    const { job } = await this.get({ organization_id, job_id }), source = this.getServices(), processor = source.domainEventProcessor || source.worker?.domainEventProcessor;
    if (!processor) throw analysisError("ANALYSIS_PROCESSOR_UNAVAILABLE", "Analysis processing is unavailable.", 503);
    if (event_id && !job.items.some(item => item.event_id === event_id)) throw analysisError("ANALYSIS_JOB_NOT_FOUND", "Analysis item not found.", 404);
    for (const item of job.items) {
      if (event_id && item.event_id !== event_id) continue;
      if (["QUEUED", "RETRY_PENDING", "RUNNING"].includes(item.state)) await processor.processOne({ organization_id, event_id: item.event_id });
    }
    return this.get({ organization_id, job_id });
  }
  async handleEvent(event, context) {
    const validate = async tx => {
      const link = await tx.get("SELECT job_id,id,lead_id FROM analysis_job_items WHERE organization_id=? AND event_id=?", [event.organization_id, event.id]);
      let payload; try { payload = JSON.parse(event.payload_json); } catch { throw analysisError("ANALYSIS_JOB_INVALID", "Invalid analysis job linkage.", 409); }
      if (!link || link.id !== payload.item_id || link.job_id !== payload.job_id || link.lead_id !== event.lead_id) throw analysisError("ANALYSIS_JOB_INVALID", "Invalid analysis job linkage.", 409);
      const row = await new AnalysisJobsRepository(tx).row(event.organization_id, link.job_id);
      if (!row || row.cancelled_at) throw analysisError("ANALYSIS_JOB_CANCELLED", "Analysis work was cancelled.", 409);
      let descriptor; try { descriptor = JSON.parse(row.generation_json); } catch { throw analysisError("ANALYSIS_JOB_INVALID", "Invalid saved generation contract.", 409); }
      if (jobHash(descriptor) !== jobHash(getGenerationDescriptor(this.db))) throw analysisError("ANALYSIS_VERSION_CHANGED", "The analysis engine changed. Start a new explicit analysis job.", 409);
      return row;
    };
    const row = await context.transaction(validate);
    const scopedContext = { ...context, transaction: work => context.transaction(async tx => { await validate(tx); return work(tx); }) };
    let simulation = null;
    try { if (row.simulation_json) simulation = JSON.parse(row.simulation_json).simulate_failure_stage; } catch { throw analysisError("ANALYSIS_JOB_INVALID", "Invalid saved test configuration.", 409); }
    try {
      return await runAnalysisPipeline({ event, context: scopedContext, getServices: this.getServices, targetStage: row.target_stage,
        executionScope: row.execution_scope, prepareDrafts: row.mode === "PREPARE_DRAFTS", simulateFailureStage: simulation });
    } catch (error) {
      if (error.code === "EVENT_INPUT_CHANGED") throw analysisError("INTELLIGENCE_CONTEXT_CHANGED", "Saved analysis inputs changed. Review current sources before retrying.", 409);
      if (simulation && !error.code) throw analysisError("ANALYSIS_STAGE_FAILED", "The requested stage did not complete.", 409);
      throw error;
    }
  }
  async compatibilityResult({ organization_id, job_id, lead_id }) {
    const { job } = await this.get({ organization_id, job_id }), item = job.items.find(value => value.lead_id === lead_id);
    if (!item) throw analysisError("ANALYSIS_JOB_NOT_FOUND", "Analysis item not found.", 404);
    if (item.state !== "COMPLETED") throw analysisError(item.error_code || "ANALYSIS_STAGE_FAILED", item.error_message || "Analysis has not completed.", item.error_code === "INTELLIGENCE_CONTEXT_CHANGED" || item.error_code === "EVENT_INPUT_CHANGED" ? 409 : 400);
    const kind = job.target_stage, id = item.artifacts[kind.toLowerCase() + "_id"];
    if (!id) throw analysisError("ANALYSIS_STAGE_FAILED", "The requested analysis stage is unavailable.", 400);
    const repository = kind === "SNAPSHOT" ? new IntelligenceRepository(this.db) : kind === "SYNTHESIS" ? new SynthesisRepository(this.db) : kind === "RECOMMENDATION" ? new IntelligenceRecommendationRepository(this.db) : new NextBestActionRepository(this.db);
    const row = await (kind === "SNAPSHOT" ? repository.getSnapshot(id) : kind === "PLAN" ? repository.getPlan(id) : repository.getRun(id));
    const artifact = await (kind === "SNAPSHOT" ? repository.snapshotDetail(row, organization_id) : kind === "PLAN" ? repository.planDetail(row, organization_id) : repository.runDetail(row, organization_id));
    if (!artifact) throw analysisError("ANALYSIS_STAGE_FAILED", "Recorded analysis output is unavailable.", 409);
    return { item, artifact };
  }
}
