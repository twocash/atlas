import type { LlmRequest, LlmResponse } from "~src/types/llm"

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

export async function callAnthropic(
  apiKey: string,
  model: string,
  request: LlmRequest
): Promise<LlmResponse> {
  const body = {
    model,
    max_tokens: request.maxTokens || 1024,
    messages: [{ role: "user", content: request.prompt }],
    ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return {
      text: "",
      model,
      error: `Anthropic API error ${response.status}: ${errorText}`,
    }
  }

  const data = await response.json()
  const textBlock = data.content?.find((c: { type: string }) => c.type === "text")

  return {
    text: textBlock?.text || "",
    model: data.model || model,
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        }
      : undefined,
  }
}
