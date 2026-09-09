import { OpenAICompatibleProvider } from "./providers/openaiCompatible.js";

const PROVIDER_PRESETS = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    envKey: "GROQ_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
    envKey: "OPENROUTER_API_KEY",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    envKey: "OLLAMA_API_KEY",
    noAuth: true,
  },
};

let _instance = null;

export function getLlmProvider() {
  if (_instance) return _instance;
  _instance = createProvider();
  return _instance;
}

export function createProvider(overrides = {}) {
  const providerName = overrides.provider || process.env.LLM_PROVIDER || "groq";
  const preset = PROVIDER_PRESETS[providerName];
  if (!preset) {
    throw new Error(`Unknown LLM provider: ${providerName}. Supported: ${Object.keys(PROVIDER_PRESETS).join(", ")}`);
  }
  const apiKey = overrides.apiKey || process.env[preset.envKey] || (preset.noAuth ? "ollama" : "");
  if (!apiKey) {
    return null;
  }
  const model = overrides.model || process.env.LLM_MODEL || preset.defaultModel;
  return new OpenAICompatibleProvider({
    baseUrl: overrides.baseUrl || preset.baseUrl,
    apiKey,
    model,
    providerName,
  });
}

export function isLlmConfigured() {
  const providerName = process.env.LLM_PROVIDER || "groq";
  const preset = PROVIDER_PRESETS[providerName];
  if (!preset) return false;
  if (preset.noAuth) return true;
  return !!process.env[preset.envKey];
}
