export type LlmProvider = "anthropic" | "openrouter"

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey: string
}

export interface LlmRequest {
  prompt: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface LlmResponse {
  text: string
  model: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  error?: string
}

export interface ModelOption {
  id: string           // Used for selection/storage
  name: string         // Display name
  provider: LlmProvider
  model: string        // Actual model ID for API
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-haiku", name: "Claude Haiku", provider: "anthropic", model: "claude-3-5-haiku-20241022" },
  { id: "claude-sonnet", name: "Claude Sonnet", provider: "anthropic", model: "claude-sonnet-4-20250514" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openrouter", model: "openai/gpt-4o-mini" },
  { id: "llama-3.1-8b", name: "Llama 3.1 8B", provider: "openrouter", model: "meta-llama/llama-3.1-8b-instruct" },
]
