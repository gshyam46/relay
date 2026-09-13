import { performance } from "node:perf_hooks";
import { parseProviderUsage, safeReference } from "../../ai-usage/aiUsageContract.js";
import { providerRequest } from "../../handlers/providerRequest.js";

export const LLM_REQUEST_BYTES = 256 * 1024;

// This adapter only returns bounded text completions. Tool execution and retries
// are application decisions and are never inferred from a provider envelope.
export class OpenAICompatibleProvider {
  constructor({ baseUrl, apiKey, model, providerName = "unknown", timeoutMs = 15000 }) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
      throw new TypeError("Invalid internal AI request deadline.");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.providerName = providerName;
    this.timeoutMs = timeoutMs;
  }

  prepareRequest({ messages, temperature = 0.3, maxTokens = 2048, responseFormat = null }) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 32
      || messages.some((message) => !message || !["system", "user", "assistant"].includes(message.role)
        || typeof message.content !== "string" || Object.keys(message).some((key) => !["role", "content"].includes(key)))
      || !Number.isFinite(temperature) || temperature < 0 || temperature > 2
      || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096
      || (responseFormat !== null && (responseFormat.type !== "json_object" || Object.keys(responseFormat).length !== 1))) {
      throw new Error("AI request rejected.");
    }
    const body = { model: this.model, messages, temperature, max_tokens: maxTokens };
    if (responseFormat) body.response_format = responseFormat;
    let encoded;
    try { encoded = JSON.stringify(body); } catch { throw new Error("AI request rejected."); }
    if (Buffer.byteLength(encoded, "utf8") > LLM_REQUEST_BYTES) throw new Error("AI request exceeds the supported size.");

    return Object.freeze({ encoded });
  }

  prepareJsonRequest({ messages, temperature = 0.2, maxTokens = 2048 }) {
    return this.prepareRequest({ messages, temperature, maxTokens, responseFormat: { type: "json_object" } });
  }

  async completePrepared(prepared, asJson) {
    const started = performance.now();
    const result = await providerRequest(this.baseUrl + "/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + this.apiKey }, body: prepared.encoded
    }, "AI provider", { timeoutMs: this.timeoutMs });
    const data = result.data;
    const observation = {
      outcome: "COMPLETED", http_status: result.response?.status || result.http_status || null,
      response_model: safeReference(data?.model), provider_response_id: safeReference(data?.id),
      usage: parseProviderUsage(data?.usage), elapsed_ms: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started)))
    };
    // Capture the envelope usage before judging completion text or domain JSON.
    if (!result.ok || result.response_issue) {
      observation.outcome = result.response_issue === "RESPONSE_TIMEOUT" ? "TIMEOUT"
        : result.response_issue ? "INVALID_RESPONSE" : result.http_status && !result.uncertain ? "HTTP_REJECTED" : "TRANSPORT_UNCONFIRMED";
      return { observation, error: "AI provider completion unavailable." };
    }
    const choice = data?.choices?.[0], message = choice?.message;
    if (!Array.isArray(data?.choices) || data.choices.length !== 1 || choice?.finish_reason !== "stop"
      || message?.role !== "assistant" || typeof message.content !== "string" || !message.content.trim()
      || message.tool_calls != null || message.function_call != null || message.refusal != null) {
      observation.outcome = "INVALID_RESPONSE";
      return { observation, error: "AI provider completion rejected." };
    }
    if (!asJson) return { observation, value: message.content };
    try { return { observation, value: JSON.parse(message.content) }; }
    catch { observation.outcome = "INVALID_RESPONSE"; return { observation, error: "AI provider JSON completion rejected." }; }
  }

  async completePreparedJson(prepared) { return this.completePrepared(prepared, true); }
  async chatCompletion(request) {
    const result = await this.completePrepared(this.prepareRequest(request), false);
    if (result.error) throw new Error(result.error); return result.value;
  }
  async jsonCompletion(request) {
    const result = await this.completePreparedJson(this.prepareJsonRequest(request));
    if (result.error) throw new Error(result.error); return result.value;
  }

  get info() {
    return { provider: this.providerName, model: this.model };
  }
}
