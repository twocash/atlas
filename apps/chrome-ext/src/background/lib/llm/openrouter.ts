import type { LlmRequest, LlmResponse } from "~src/types/llm"

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

export async function callOpenRouter(
  apiKey: string,
  model: string,
  request: LlmRequest
): Promise<LlmResponse> {
  const messages: Array<{ role: string; content: string }> = []

  if (request.systemPrompt) {
    messages.push({ role: "system", content: request.systemPrompt })
  }
  messages.push({ role: "user", content: request.prompt })

  const body = {
    model,
    messages,
    max_tokens: request.maxTokens || 1024,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "chrome-extension://atlas",
      "X-Title": "Atlas Chrome Extension",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return {
      text: "",
      model,
      error: `OpenRouter API error ${response.status}: ${errorText}`,
    }
  }

  const data = await response.json()
  const choice = data.choices?.[0]

  return {
    text: choice?.message?.content || "",
    model: data.model || model,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        }
      : undefined,
  }
}
