import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database/database.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { createCurrentIntelligenceServices } from "../src/modules/lead-intelligence/currentIntelligence.js";
import { DomainEventProcessor } from "../src/modules/events/domainEventProcessor.js";
import { createLeadEventHandlers } from "../src/modules/events/leadEventHandlers.js";
import { AnalysisJobsService } from "../src/modules/analysis-jobs/analysisJobsService.js";
import { registerGenerationDescriptor, getGenerationDescriptor } from "../src/modules/ai-usage/generationDescriptor.js";
import { EventsRepository } from "../src/modules/events/eventsRepository.js";
import { ContactPolicyService } from "../src/modules/contact-policy/contactPolicyService.js";
async function fixture(t, count = 1, target = ":memory:") {
  const db = await createDatabase(target); t.after(() => db.close());
  const leads = new LeadsRepository(db), org = await leads.createOrganization({ name: "Synthetic analysis" }), actor = { id: "owner-" + org.id, role: "OWNER" };
  await db.run("INSERT INTO users(id,organization_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,'OWNER',?)", [actor.id, org.id, "Synthetic", actor.id + "@example.test", "synthetic-only", new Date().toISOString()]);
  let clock = Date.now() + 1000;
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await leads.createLead({ organization_id: org.id, name: "Synthetic lead " + i, email: "lead" + i + "@example.test", company: "Example" }));
  const services = createCurrentIntelligenceServices(db, { now: () => clock });
  const jobs = new AnalysisJobsService({ db, getServices: () => services, now: () => clock });
  services.analysisJobsService = jobs;
  const processor = () => new DomainEventProcessor({ db, now: () => clock, random: () => 0, handlers: createLeadEventHandlers({ getServices: () => services }) });
  services.domainEventProcessor = processor();
  const enqueue = (extra = {}) => jobs.enqueue({ organization_id: org.id, actor, request_key: "request-1", lead_ids: rows.map(row => row.id), mode: "ANALYSIS_ONLY", target_stage: "PLAN", ...extra });
  const get = id => jobs.get({ organization_id: org.id, job_id: id });
  const run = id => jobs.processOnce({ organization_id: org.id, job_id: id });
  return { db, org, actor, leads, rows, services, jobs, enqueue, get, run, now: () => clock, advance: milliseconds => { clock += milliseconds; }, processor, count: async table => Number((await db.get("SELECT count(*) AS n FROM " + table)).n) };
}
const barrier = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

test("job admission is atomic, scoped, bounded and exact request replay returns one selection", async t => {
  const f = await fixture(t, 2);
  const foreign = await f.leads.createOrganization({ name: "Other workspace" }), other = await f.leads.createLead({ organization_id: foreign.id, name: "Other" });
  await assert.rejects(f.enqueue({ lead_ids: [f.rows[0].id, other.id] }), { code: "ANALYSIS_LEAD_NOT_FOUND" });
  assert.equal(await f.count("analysis_jobs"), 0); assert.equal(await f.count("domain_events"), 0);
  await assert.rejects(f.enqueue({ lead_ids: [f.rows[0].id, f.rows[0].id] }), { code: "ANALYSIS_INVALID_SELECTION" });
  await assert.rejects(f.enqueue({ actor: { ...f.actor, role: "MEMBER" } }), { statusCode: 403 });
  await f.db.exec("CREATE TRIGGER synthetic_item_failure BEFORE INSERT ON analysis_job_items WHEN NEW.ordinal=1 BEGIN SELECT RAISE(ABORT,'Synthetic item failure'); END");
  await assert.rejects(f.enqueue()); assert.equal(await f.count("analysis_jobs"), 0); assert.equal(await f.count("domain_events"), 0);
  await f.db.exec("DROP TRIGGER synthetic_item_failure");
  const first = await f.enqueue(), retry = await f.enqueue();
  assert.equal(retry.replayed, true); assert.equal(first.job.id, retry.job.id); assert.equal(await f.count("domain_events"), 2);
  await assert.rejects(f.enqueue({ target_stage: "SNAPSHOT" }), { code: "ANALYSIS_REQUEST_CONFLICT" });
  assert.equal((await f.jobs.findByRequestKey({ organization_id: f.org.id, request_key: "request-1" })).job.id, first.job.id);
  await assert.rejects(f.jobs.get({ organization_id: foreign.id, job_id: first.job.id }), { statusCode: 404 });
});

test("normal event processing completes persisted stages and new exact analysis reuses every artifact", async t => {
  const f = await fixture(t), { job } = await f.enqueue(), completed = (await f.run(job.id)).job;
  assert.equal(completed.status, "COMPLETED"); assert.equal(completed.items[0].attempts, 1); assert.equal(completed.items[0].reused, false);
  for (const field of ["snapshot_id", "synthesis_id", "recommendation_id", "plan_id"]) assert.ok(completed.items[0].artifacts[field]);
  assert.equal(await f.count("action_executions"), 0);
  const second = await f.enqueue({ request_key: "request-2" }), reused = (await f.run(second.job.id)).job;
  assert.equal(reused.status, "COMPLETED"); assert.equal(reused.items[0].reused, true); assert.deepEqual(reused.items[0].artifacts, completed.items[0].artifacts);
  assert.equal(await f.count("intelligence_synthesis_runs"), 1);
});

test("partial failure survives processor replacement and reuses committed sibling and prior stages", async t => {
  const f = await fixture(t, 2), original = f.services.synthesisService.synthesisAgent; let fail = true, calls = 0;
  f.services.synthesisService.synthesisAgent = { synthesize(input) { calls++; if (input.lead.id === f.rows[1].id && fail) throw new Error("private-synthetic-error"); return original.synthesize(input); } };
  const { job } = await f.enqueue(), partial = (await f.run(job.id)).job;
  assert.equal(partial.counts.completed, 1); assert.equal(partial.counts.retry_pending, 1); assert.equal(calls, 2);
  assert.equal(JSON.stringify(partial).includes("private-synthetic-error"), false);
  const snapshot = partial.items[1].artifacts.snapshot_id; fail = false; f.advance(6000); f.services.domainEventProcessor = f.processor();
  const done = (await f.run(job.id)).job; assert.equal(done.status, "COMPLETED"); assert.equal(calls, 3);
  assert.equal(done.items[0].attempts, 1); assert.equal(done.items[1].attempts, 2); assert.equal(done.items[1].artifacts.snapshot_id, snapshot);
});

test("cancellation during generation revokes finalization while preserving earlier snapshot and exact replay", async t => {
  const f = await fixture(t), started = barrier(), release = barrier(), original = f.services.synthesisService.synthesisAgent;
  f.services.synthesisService.synthesisAgent = { async synthesize(input) { started.release(); await release.promise; return original.synthesize(input); } };
  const { job } = await f.enqueue(), running = f.run(job.id); await started.promise;
  const command = { organization_id: f.org.id, job_id: job.id, actor: f.actor, expected_revision: 0, reason: "Stop this requested work" };
  const cancelled = (await f.jobs.cancel(command)).job; assert.equal(cancelled.status, "CANCELLED");
  release.release(); await running;
  assert.equal(await f.count("intelligence_snapshots"), 1); assert.equal(await f.count("intelligence_synthesis_runs"), 0); assert.equal(await f.count("next_best_action_plans"), 0);
  assert.equal((await f.jobs.cancel(command)).job.revision, 1);
  await assert.rejects(f.jobs.retry({ ...command, expected_revision: 1 }), { code: "ANALYSIS_JOB_CANCELLED" });
});

test("expired processor cannot overwrite replacement completion", async t => {
  const f = await fixture(t), started = barrier(), release = barrier(), original = f.services.synthesisService.synthesisAgent;
  f.services.synthesisService.synthesisAgent = { async synthesize(input) { started.release(); await release.promise; return original.synthesize(input); } };
  const { job } = await f.enqueue(), old = f.run(job.id); await started.promise;
  f.services.synthesisService.synthesisAgent = original; f.advance(120001); f.services.domainEventProcessor = f.processor();
  const replacement = (await f.run(job.id)).job;
  release.release(); await old; assert.equal(replacement.status, "COMPLETED");
  assert.equal(await f.count("intelligence_synthesis_runs"), 1); assert.equal((await f.get(job.id)).job.status, "COMPLETED");
});

test("changed deployed generation contract holds queued work without a snapshot or model call", async t => {
  const f = await fixture(t), { job } = await f.enqueue();
  registerGenerationDescriptor(f.db, { ...getGenerationDescriptor(f.db), pipeline_version: "synthetic-new-version" });
  const held = (await f.run(job.id)).job; assert.equal(held.status, "FAILED"); assert.equal(held.items[0].error_code, "ANALYSIS_VERSION_CHANGED"); assert.equal(held.can_retry, false);
  assert.equal(await f.count("intelligence_snapshots"), 0);
});

test("stale source during generation discards output and keeps committed stages retryable", async t => {
  const f = await fixture(t), started = barrier(), release = barrier(), original = f.services.synthesisService.synthesisAgent;
  f.services.synthesisService.synthesisAgent = { async synthesize(input) { started.release(); await release.promise; return original.synthesize(input); } };
  const { job } = await f.enqueue(), running = f.run(job.id); await started.promise;
  await new ContactPolicyService(f.db).withWorkspacePolicyTransaction(f.org.id, tx => tx.run("UPDATE leads SET company='Changed source' WHERE id=?", [f.rows[0].id]));
  release.release(); const stale = (await running).job;
  assert.notEqual(stale.status, "COMPLETED"); assert.equal(await f.count("intelligence_synthesis_runs"), 0);
});

test("held retries retain original deadline and spent attempts; expiry refuses reset", async t => {
  const f = await fixture(t), { job } = await f.enqueue({ target_stage: "SYNTHESIS", execution_scope: "SINGLE_STAGE" });
  const held = (await f.run(job.id)).job; assert.equal(held.status, "FAILED"); assert.equal(held.can_retry, true);
  const before = await f.db.get("SELECT attempts,retry_deadline_at FROM domain_events WHERE id=?", [held.items[0].event_id]);
  const command = { organization_id: f.org.id, job_id: job.id, expected_revision: 0, reason: "Prerequisite is being corrected", actor: f.actor };
  await f.jobs.retry(command);
  const after = await f.db.get("SELECT attempts,retry_deadline_at FROM domain_events WHERE id=?", [held.items[0].event_id]); assert.deepEqual(after, before);
  await f.run(job.id); f.advance(86400001);
  assert.equal((await f.get(job.id)).job.can_retry, false);
  await assert.rejects(f.jobs.retry({ ...command, expected_revision: 1 }), { code: "ANALYSIS_COMMAND_UNAVAILABLE" });
});

test("workspace admission cap counts held work and cancellation releases only unfinished selection slots", async t => {
  const f = await fixture(t, 50), first = await f.enqueue(), second = await f.enqueue({ request_key: "request-2" });
  assert.equal(await f.count("analysis_job_items"), 100);
  await assert.rejects(f.enqueue({ request_key: "overflow", lead_ids: [f.rows[0].id] }), { code: "ANALYSIS_QUEUE_LIMIT" });
  await f.jobs.cancel({ organization_id: f.org.id, job_id: first.job.id, expected_revision: 0, reason: "Reduce queued work", actor: f.actor });
  await f.enqueue({ request_key: "replacement" });
  const listed = await f.jobs.list({ organization_id: f.org.id, limit: "1", offset: "0" }); assert.equal(listed.jobs.length, 1); assert.equal(listed.total, 3); assert.equal(listed.has_more, true);
  assert.equal((await f.get(second.job.id)).job.counts.queued, 50);
});

test("artifact and stage audit failure roll back together", async t => {
  const f = await fixture(t), { job } = await f.enqueue();
  await f.db.exec("CREATE TRIGGER fail_analysis_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='LeadIntelligenceSynthesized' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");
  const failed = (await f.run(job.id)).job; assert.equal(failed.counts.retry_pending, 1);
  assert.equal(await f.count("intelligence_synthesis_runs"), 0);
  assert.equal(failed.items[0].stages.find(stage => stage.key === "synthesis").status, "PREPARED");
});

test("accepted single-stage work reports missing current context and records failed drafts without an unnecessary generator call", async t => {
  const f = await fixture(t), missing = await f.enqueue({ target_stage: "SYNTHESIS", execution_scope: "SINGLE_STAGE" });
  await f.run(missing.job.id);
  await assert.rejects(f.jobs.compatibilityResult({ organization_id: f.org.id, job_id: missing.job.id, lead_id: f.rows[0].id }), { code: "INTELLIGENCE_CONTEXT_CHANGED", statusCode: 409 });
  const initial = await f.enqueue({ request_key: "snapshot", target_stage: "SNAPSHOT", execution_scope: "SINGLE_STAGE" }); await f.run(initial.job.id);
  const snapshot = await f.jobs.compatibilityResult({ organization_id: f.org.id, job_id: initial.job.id, lead_id: f.rows[0].id }); assert.equal(snapshot.artifact.status, "READY");
  let calls = 0; f.services.synthesisService.synthesisAgent = { synthesize() { calls++; throw new Error("must not generate after injected draft failure"); } };
  const failed = await f.enqueue({ request_key: "injected", target_stage: "SYNTHESIS", execution_scope: "SINGLE_STAGE", simulate_failure_stage: "AFTER_DRAFT" });
  assert.equal((await f.run(failed.job.id)).job.items[0].error_code, "ANALYSIS_STAGE_FAILED"); assert.equal(calls, 0);
  assert.equal((await f.db.get("SELECT status FROM intelligence_synthesis_runs")).status, "FAILED");
});

test("cancellation and retry commands reject stale decisions, preserve completed siblings and audit rollback", async t => {
  const f = await fixture(t, 2), { job } = await f.enqueue({ target_stage: "SNAPSHOT" });
  await f.jobs.processOnce({ organization_id: f.org.id, job_id: job.id, event_id: job.items[0].event_id });
  const command = { organization_id: f.org.id, job_id: job.id, expected_revision: 0, reason: "Cancel remaining selection", actor: f.actor };
  await f.db.exec("CREATE TRIGGER fail_cancel_audit BEFORE INSERT ON audit_logs WHEN NEW.event_type='AnalysisReviewed' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");
  await assert.rejects(f.jobs.cancel(command)); assert.equal((await f.get(job.id)).job.items[1].state, "QUEUED");
  await f.db.exec("DROP TRIGGER fail_cancel_audit");
  const cancelled = (await f.jobs.cancel(command)).job;
  assert.equal(cancelled.counts.completed, 1); assert.equal(cancelled.counts.cancelled, 1);
  assert.equal(await f.count("intelligence_snapshots"), 1);
  await assert.rejects(f.jobs.cancel({ ...command, reason: "Different intent" }), { code: "ANALYSIS_COMMAND_CONFLICT" });
});

test("job progress is metadata-only and paged without loading saved source or command history", async t => {
  const f = await fixture(t), { job } = await f.enqueue({ target_stage: "SNAPSHOT" });
  await f.db.run("UPDATE leads SET name=?,source_metadata_json=? WHERE id=?", ["N".repeat(40000), JSON.stringify({ source: "X".repeat(1000000) }), f.rows[0].id]);
  const detail = (await f.get(job.id)).job;
  assert.equal(detail.items[0].lead_name.length, 200);
  assert.equal(JSON.stringify(detail).includes("source_metadata"), false);
  assert.equal(JSON.stringify(detail).includes("command_history"), false);
  await assert.rejects(f.jobs.list({ organization_id: f.org.id, limit: "21" }), { code: "ANALYSIS_INVALID_INPUT" });
});

test("queued work and committed artifacts survive closing and reopening the SQLite database", async t => {
  const directory = mkdtempSync(join(tmpdir(), "l303-analysis-restart-")), file = join(directory, "analysis.db");
  const f = await fixture(t, 1, file), { job } = await f.enqueue();
  await f.db.close();
  const reopened = await createDatabase(file);
  t.after(async () => { await reopened.close(); assert.equal(dirname(directory), tmpdir()); rmSync(directory, { recursive: true, force: true }); });
  const source = createCurrentIntelligenceServices(reopened, { now: f.now });
  const jobs = new AnalysisJobsService({ db: reopened, getServices: () => source, now: f.now });
  source.analysisJobsService = jobs; source.domainEventProcessor = new DomainEventProcessor({ db: reopened, now: f.now, handlers: createLeadEventHandlers({ getServices: () => source }) });
  const restored = await jobs.findByRequestKey({ organization_id: f.org.id, request_key: "request-1" }); assert.equal(restored.job.id, job.id);
  assert.equal((await jobs.processOnce({ organization_id: f.org.id, job_id: job.id })).job.status, "COMPLETED");
  const history = await jobs.get({ organization_id: f.org.id, job_id: job.id }); assert.equal(history.job.items[0].attempts, 1); assert.ok(history.job.items[0].artifacts.plan_id);
});

test("cancel after earlier stages prevents a late plan from preparing an outbound draft", async t => {
  const f = await fixture(t), entered = barrier(), release = barrier(), original = f.services.nextBestActionService.actionPlanner;
  f.services.nextBestActionService.actionPlanner = { async plan(input) { entered.release(); await release.promise; return original.plan(input); } };
  const { job } = await f.enqueue({ mode: "PREPARE_DRAFTS" }), pending = f.run(job.id); await entered.promise;
  assert.equal(await f.count("intelligence_recommendation_runs"), 1);
  await f.jobs.cancel({ organization_id: f.org.id, job_id: job.id, expected_revision: 0, reason: "Stop before draft preparation", actor: f.actor });
  release.release(); await pending;
  assert.equal(await f.count("next_best_action_plans"), 0); assert.equal(await f.count("actions"), 0); assert.equal(await f.count("action_executions"), 0);
});
