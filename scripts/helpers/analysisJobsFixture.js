// Isolated browser fixture: real job/event/gateway persistence, injected provider only.
import { createApp } from "../../src/api/app.js";
import { loadConfig, validateConfig } from "../../src/config.js";
import { createDatabase } from "../../src/database/database.js";
import { assertNoLiveProviders, workflowVerificationTarget } from "./testSafety.js";

export async function startAnalysisJobsFixture({ model = "fixture-v1", configured = true, automatic = true } = {}) {
  assertNoLiveProviders();
  const config = loadConfig();
  if (process.env.DATABASE_URL || config.env !== "test" || config.database.driver !== "sqlite" || config.database.databaseFile !== ":memory:" || !config.security.isolatedE2eHarness || !config.security.testControlsEnabled || config.worker.enabled) throw new Error("Analysis UI fixture requires a sanitized isolated in-memory E2E environment.");
  const base = workflowVerificationTarget("http://127.0.0.1:" + config.port);
  if (config.security.publicAppOrigin !== base || validateConfig(config).length) throw new Error("Analysis UI fixture requires its own explicit loopback public origin and valid configuration.");
  const db = await createDatabase(":memory:");
  const scenarios = new Map(), releases = new Set(), calls = [], pumpErrors = [];
  let paused = !automatic, stopped = false, operation = Promise.resolve(), busy = false;
  function providerFor(requestedModel) {
    return { info: Object.freeze({ provider: "synthetic", model: requestedModel }),
      prepareJsonRequest(request) { return Object.freeze({ encoded: JSON.stringify({ model: requestedModel, ...request }) }); },
      async completePreparedJson(prepared) {
        const request = JSON.parse(prepared.encoded), findings = JSON.parse(request.messages[1].content).findings;
        const name = findings.find(item => item.field === "LEAD_NAME")?.value || "", scenario = scenarios.get(name) || {};
        calls.push({ name, model: requestedModel });
        scenario.started?.();
        if (scenario.wait) await scenario.wait;
        const selected = findings[0];
        return { value: { selected_claims: [{ field: selected.field, value: selected.value, evidence_refs: selected.evidence_refs }] }, observation: { outcome: "COMPLETED", http_status: 200, response_model: requestedModel, provider_response_id: "synthetic-ui-response-" + calls.length, usage: scenario.unknownUsage ? null : { usage_status: "PROVIDER_REPORTED", input_tokens: 10, output_tokens: 2, total_tokens: 12, usage_reason: null }, elapsed_ms: 1 } };
      }
    };
  }
  let app = createApp({ db, config, ...(configured ? { aiProvider: providerFor(model) } : {}) });
  async function listen() { await new Promise((resolve, reject) => { app.once("error", reject); app.listen(config.port, "127.0.0.1", resolve); }); }
  try { await listen(); } catch (error) { await db.close(); throw error; }
  async function pump() {
    if (stopped || paused || busy) return;
    busy = true;
    operation = (async () => {
      // Never process LeadCreated, reply events, receipts, dispatch or workflows here.
      // Synchronous compatibility calls process their own legacy-prefixed jobs.
      const rows = await db.all("SELECT e.id,e.organization_id FROM domain_events e JOIN analysis_job_items i ON i.organization_id=e.organization_id AND i.event_id=e.id JOIN analysis_jobs j ON j.organization_id=i.organization_id AND j.id=i.job_id WHERE e.type='AnalysisRequested' AND e.status IN ('PENDING','RETRY_PENDING') AND j.request_key NOT LIKE 'legacy-%' AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=?) ORDER BY e.created_at,e.id LIMIT 1", [new Date().toISOString()]);
      for (const row of rows) await app.services.domainEventProcessor.processOne({ organization_id: row.organization_id, event_id: row.id });
    })().finally(() => { busy = false; });
    return operation;
  }
  const timer = setInterval(() => { void pump().catch(error => { pumpErrors.push(error.name + ": " + error.message); }); }, 100);
  async function closeHttp() { await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); }
  return {
    base, db, calls, pumpErrors, get services() { return app.services; }, pump,
    pause() { paused = true; }, resume() { paused = false; }, async idle() { await operation; },
    unknownUsage(name) { scenarios.set(name, { ...(scenarios.get(name) || {}), unknownUsage: true }); },
    hold(name) {
      let started, release;
      const began = new Promise(resolve => { started = resolve; }), wait = new Promise(resolve => { release = resolve; });
      const done = () => { releases.delete(done); release(); };
      releases.add(done); scenarios.set(name, { ...(scenarios.get(name) || {}), started, wait });
      return { started: began, release: done };
    },
    async restart(nextModel = model) {
      const wasPaused = paused; paused = true; await operation; await closeHttp();
      model = nextModel; app = createApp({ db, config, ...(configured ? { aiProvider: providerFor(model) } : {}) });
      await listen(); paused = wasPaused;
    },
    async close() { stopped = true; clearInterval(timer); for (const release of [...releases]) release(); await operation; await closeHttp(); await db.close(); }
  };
}

// Browser UI assertions may await jobs without converting POST202 into terminal success.
export async function waitForBrowserJob(page, base, accepted, timeout = 30000) {
  let job = accepted.job;
  if (!job?.id) throw new Error("Expected accepted job identity.");
  const deadline = Date.now() + timeout;
  while (!["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(job.status)) {
    if (Date.now() > deadline) throw new Error("Analysis job did not finish within the bounded browser wait: " + job.id);
    await new Promise(resolve => setTimeout(resolve, 100));
    const response = await page.request.get(base + "/api/intelligence/jobs/" + job.id + "?organization_id=" + job.organization_id);
    if (response.status() !== 200) throw new Error("Saved job lookup failed: " + response.status());
    job = (await response.json()).job;
  }
  return job;
}
export function legacyResultFromJob(job) {
  return { job_id: job.id, organization_id: job.organization_id, eligible: job.counts.total, processed: job.counts.total, remaining: 0, succeeded: job.counts.completed, failed: job.counts.failed + job.counts.cancelled, results: job.items.map(item => ({ lead_id: item.lead_id, status: item.state === "COMPLETED" ? "COMPLETED" : "FAILED", reused: item.reused, code: item.error_code, action_id: item.artifacts.action_id })) };
}
