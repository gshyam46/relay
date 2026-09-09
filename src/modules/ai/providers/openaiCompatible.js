export class OpenAICompatibleProvider {
  constructor({ baseUrl, apiKey, model, providerName = "unknown" }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.providerName = providerName;
  }

  async chatCompletion({ messages, temperature = 0.3, maxTokens = 2048, responseFormat = null }) {
    const body = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (responseFormat) {
      body.response_format = responseFormat;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API error (${this.providerName}): ${res.status} ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  async jsonCompletion({ messages, temperature = 0.2, maxTokens = 2048 }) {
    const content = await this.chatCompletion({
      messages,
      temperature,
      maxTokens,
      responseFormat: { type: "json_object" },
    });
    return JSON.parse(content);
  }

  get info() {
    return { provider: this.providerName, model: this.model };
  }
}
