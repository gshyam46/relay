// Synthetic injected adapters for the production React verifier, never an app route.
import { createApp } from "../../src/api/app.js";
import { loadConfig, validateConfig } from "../../src/config.js";
import { createDatabase } from "../../src/database/database.js";
import { LocalSynthesisAgent } from "../../src/modules/lead-intelligence/localSynthesisAgent.js";
import { OpenAICompatibleProvider } from "../../src/modules/ai/providers/openaiCompatible.js";
import { LocalReplyClassifier } from "../../src/modules/channels/replyClassifier.js";
import { assertNoLiveProviders, workflowVerificationTarget } from "./testSafety.js";

export async function startIntelligenceTrustFixture() {
  assertNoLiveProviders();
  const config = loadConfig();
  if (process.env.DATABASE_URL || config.env !== "test" || config.database.driver !== "sqlite" || config.database.databaseFile !== ":memory:" || !config.security.isolatedE2eHarness || !config.security.testControlsEnabled || config.worker.enabled) throw new Error("Trust UI fixture requires the sanitized isolated in-memory E2E environment.");
  const base = workflowVerificationTarget("http://127.0.0.1:" + config.port);
  if (config.security.publicAppOrigin !== base || validateConfig(config).length) throw new Error("Trust UI fixture requires its own explicit loopback public origin and valid test configuration.");
  const db = await createDatabase(":memory:");
  // Use the real factory gateway and one captured descriptor. These synthetic
  // completions never call the transport or read environment credentials.
  const validator = new OpenAICompatibleProvider({ baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", providerName: "synthetic", model: "ui-fixture" });
  let responses = 0;
  const aiProvider = { info: Object.freeze({ provider: "synthetic", model: "ui-fixture" }),
    prepareJsonRequest(request) { return validator.prepareJsonRequest(request); },
    async completePreparedJson(prepared) {
      const body = JSON.parse(JSON.parse(prepared.encoded).messages[1].content);
      const observation = { outcome: "COMPLETED", http_status: 200, response_model: "ui-fixture", provider_response_id: "synthetic-trust-" + ++responses,
        usage: { usage_status: "PROVIDER_REPORTED", input_tokens: 10, output_tokens: 2, total_tokens: 12, usage_reason: null }, elapsed_ms: 1 };
      const unavailable = () => ({ error: "AI provider completion unavailable.", observation: { ...observation, outcome: "TRANSPORT_UNCONFIRMED", http_status: null, usage: null } });
      if (body.findings) {
        const name = body.findings.find(item => item.field === "LEAD_NAME")?.value || "";
        if (name.startsWith("Trust unavailable")) return unavailable();
        if (name.startsWith("Trust empty")) return { value: { selected_claims: [] }, observation };
        const finding = body.findings[0];
        return { value: { selected_claims: [{ field: finding.field, value: name.startsWith("Trust rejected") ? "Unsupported guaranteed return" : finding.value, evidence_refs: finding.evidence_refs }] }, observation };
      }
      const text = body.message;
      if (text === "Can you share details?") return unavailable();
      return { value: { event_type: text === "The signal should fade here." ? "OPT_OUT" : "POSITIVE_REPLY", confidence: text === "The signal should fade here." ? "LOW" : "HIGH", evidence_quote: text }, observation };
    }
  };
  const app = createApp({ db, config, aiProvider });
  const modelSynthesis = app.services.synthesisService.synthesisAgent, modelReply = app.services.channelWorkflowService.replyClassifier;
  const localSynthesis = new LocalSynthesisAgent(), localReply = new LocalReplyClassifier();
  app.services.synthesisService.synthesisAgent = {
    async synthesize(input) {
      const name = input.lead.name || "";
      if (name === "Trust historical extraction") {
        const output = await localSynthesis.synthesize(input);
        delete output.summary.generation;
        return output;
      }
      if (!name.startsWith("Trust model") && !name.startsWith("Trust empty") && !name.startsWith("Trust rejected") && !name.startsWith("Trust unavailable")) return localSynthesis.synthesize(input);
      return modelSynthesis.synthesize(input);
    }
  };
  app.services.channelWorkflowService.replyClassifier = {
    async classify(text) {
      if (text === "Historical reply fixture.") return { event_type: "QUESTION", confidence: "MEDIUM", reason: "Historical recorded interpretation.", suggested_next_step: "Read the original message before deciding." };
      if (!["A seat at the table suits us.", "The signal should fade here.", "Can you share details?"].includes(text)) return localReply.classify(text);
      return modelReply.classify(text);
    }
  };
  try { await new Promise((resolve, reject) => { app.once("error", reject); app.listen(config.port, "127.0.0.1", resolve); }); }
  catch (error) { await db.close(); throw error; }
  return { base, services: app.services, async close() { await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); await db.close(); } };
}
