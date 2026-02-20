import { SecureStorage } from "~src/lib/chrome-storage"
import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "~src/lib/storage"
import { MODEL_OPTIONS } from "~src/types/llm"
import type { LlmRequest, LlmResponse } from "~src/types/llm"
import { callAnthropic } from "./anthropic"
import { callOpenRouter } from "./openrouter"

const storage = new Storage({ area: "local" })
const secureStorage = new SecureStorage({ area: "local" })
const STORAGE_PASSWORD = "atlas-ext-v1"

// Define complexity tiers for cost optimization
export enum TaskTier {
  FAST = "fast",   // Classifications, Formatting, Extraction (Use Haiku/Flash)
  SMART = "smart"  // Drafting, Reasoning, Strategy (Use Sonnet/GPT-4)
}

/**
 * Select optimal model based on task tier (cost optimization)
 */
function selectModelByTier(provider: string, tier: TaskTier): string {
  if (provider === "anthropic") {
    return tier === TaskTier.FAST
      ? "claude-haiku-4-5-20251001"  // $1.00/$5.00 per MTok
      : "claude-sonnet-4-20250514"    // Smart: $3/$15 per MTok
  }

  if (provider === "openrouter") {
    return tier === TaskTier.FAST
      ? "google/gemini-flash-1.5"
      : "anthropic/claude-3.5-sonnet"
  }

  return "claude-haiku-4-5-20251001" // Fallback to cheap
}

/**
 * Route an LLM request to the correct provider based on the provided model,
 * task tier, or the user's selected model in storage.
 */
export async function routeLlmRequest(
  request: LlmRequest & { model?: string; tier?: TaskTier }
): Promise<LlmResponse> {
  // Get model - priority order:
  // 1. Explicit model in request
  // 2. Tier-based selection (cost optimization)
  // 3. User's default from storage
  let modelToUse: string
  let provider: string = "anthropic"

  if (request.model) {
    // Explicit model requested
    const modelConfig = MODEL_OPTIONS.find((m) => m.model === request.model || m.id === request.model) || MODEL_OPTIONS[0]!
    modelToUse = modelConfig.model
    provider = modelConfig.provider
  } else if (request.tier) {
    // Tier-based auto-selection (cost optimization)
    const selectedModelId = await storage.get<string>(STORAGE_KEYS.SELECTED_MODEL)
    const modelConfig = MODEL_OPTIONS.find((m) => m.id === selectedModelId) || MODEL_OPTIONS[0]!
    provider = modelConfig.provider
    modelToUse = selectModelByTier(provider, request.tier)
    console.log(`[Atlas Router] ${request.tier} tier → ${modelToUse}`)
  } else {
    // User's default selection
    const selectedModelId = await storage.get<string>(STORAGE_KEYS.SELECTED_MODEL)
    const modelConfig = MODEL_OPTIONS.find((m) => m.id === selectedModelId) || MODEL_OPTIONS[0]!
    modelToUse = modelConfig.model
    provider = modelConfig.provider
  }

  // Get API key for the provider
  await secureStorage.setPassword(STORAGE_PASSWORD)

  if (provider === "anthropic") {
    const apiKey = await secureStorage.get(STORAGE_KEYS.ANTHROPIC_KEY).catch(() => "")
    if (!apiKey) {
      return { text: "", model: modelToUse, error: "Anthropic API key not set" }
    }
    return callAnthropic(apiKey as string, modelToUse, request)
  }

  if (provider === "openrouter") {
    const apiKey = await secureStorage.get(STORAGE_KEYS.OPENROUTER_KEY).catch(() => "")
    if (!apiKey) {
      return { text: "", model: modelToUse, error: "OpenRouter API key not set" }
    }
    return callOpenRouter(apiKey as string, modelToUse, request)
  }

  return { text: "", model: "", error: `Unknown provider: ${provider}` }
}
