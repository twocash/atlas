/**
 * Cognitive Router - Model Catalog
 *
 * Defines available models, their capabilities, costs, and routing metadata.
 */

export type ModelId =
  | "claude-opus-4-20250514"
  | "claude-sonnet-4-20250514"
  | "claude-3-5-haiku-20241022"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-2.0-flash"
  | "gemini-2.0-pro"
  | "local";

export type Provider = "anthropic" | "openai" | "google" | "openrouter" | "local";

export type ModelTier = "premium" | "efficient" | "free";

export type ModelStrength =
  | "reasoning"
  | "code"
  | "analysis"
  | "long_context"
  | "creative"
  | "speed"
  | "simple_tasks"
  | "cost_efficient"
  | "summarization"
  | "structured_output"
  | "json_mode"
  | "function_calling"
  | "transforms"
  | "parsing"
  | "file_processing";

export interface ModelConfig {
  provider: Provider;
  tier: ModelTier;
  contextWindow: number | null;
  inputCostPer1M: number;
  outputCostPer1M: number;
  strengths: ModelStrength[];
  openrouterModel: string | null;
  maxOutputTokens?: number;
}

/**
 * Model catalog with pricing and capabilities
 *
 * Pricing as of January 2026 - update as needed
 */
export const MODEL_CATALOG: Record<ModelId, ModelConfig> = {
  // === Anthropic ===
  "claude-opus-4-20250514": {
    provider: "anthropic",
    tier: "premium",
    contextWindow: 200000,
    inputCostPer1M: 15.0,
    outputCostPer1M: 75.0,
    strengths: ["reasoning", "code", "analysis", "long_context", "creative"],
    openrouterModel: "anthropic/claude-opus-4-20250514",
    maxOutputTokens: 32000,
  },
  "claude-sonnet-4-20250514": {
    provider: "anthropic",
    tier: "premium",
    contextWindow: 200000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    strengths: ["reasoning", "code", "analysis", "long_context", "creative"],
    openrouterModel: "anthropic/claude-sonnet-4-20250514",
    maxOutputTokens: 8192,
  },
  "claude-3-5-haiku-20241022": {
    provider: "anthropic",
    tier: "efficient",
    contextWindow: 200000,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
    strengths: ["speed", "simple_tasks", "cost_efficient", "summarization"],
    openrouterModel: "anthropic/claude-3-5-haiku-20241022",
    maxOutputTokens: 8192,
  },

  // === OpenAI ===
  "gpt-4o": {
    provider: "openai",
    tier: "premium",
    contextWindow: 128000,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    strengths: ["structured_output", "json_mode", "function_calling"],
    openrouterModel: "openai/gpt-4o",
    maxOutputTokens: 16384,
  },
  "gpt-4o-mini": {
    provider: "openai",
    tier: "efficient",
    contextWindow: 128000,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    strengths: ["structured_output", "json_mode", "speed", "cost_efficient"],
    openrouterModel: "openai/gpt-4o-mini",
    maxOutputTokens: 16384,
  },

  // === Google ===
  "gemini-2.0-flash": {
    provider: "google", // Direct API with grounding support
    tier: "efficient",
    contextWindow: 1000000,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    strengths: ["speed", "long_context", "cost_efficient", "simple_tasks"],
    openrouterModel: "google/gemini-2.0-flash-001",
    maxOutputTokens: 8192,
  },
  "gemini-2.0-pro": {
    provider: "google", // Direct API
    tier: "premium",
    contextWindow: 2000000,
    inputCostPer1M: 1.25,
    outputCostPer1M: 5.0,
    strengths: ["reasoning", "long_context", "analysis", "code"],
    openrouterModel: "google/gemini-2.0-pro-exp-02-05",
    maxOutputTokens: 8192,
  },

  // === Local (No API) ===
  local: {
    provider: "local",
    tier: "free",
    contextWindow: null,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    strengths: ["transforms", "parsing", "file_processing"],
    openrouterModel: null,
  },
};

/**
 * Get model config by ID
 */
export function getModelConfig(modelId: ModelId): ModelConfig {
  return MODEL_CATALOG[modelId];
}

/**
 * Calculate estimated cost for a request
 */
export function estimateCost(
  modelId: ModelId,
  inputTokens: number,
  outputTokens: number
): number {
  const config = MODEL_CATALOG[modelId];
  const inputCost = (inputTokens / 1_000_000) * config.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * config.outputCostPer1M;
  return inputCost + outputCost;
}

/**
 * Check if a model has a specific strength
 */
export function hasStrength(modelId: ModelId, strength: ModelStrength): boolean {
  return MODEL_CATALOG[modelId].strengths.includes(strength);
}

/**
 * Get models by tier
 */
export function getModelsByTier(tier: ModelTier): ModelId[] {
  return (Object.entries(MODEL_CATALOG) as [ModelId, ModelConfig][])
    .filter(([, config]) => config.tier === tier)
    .map(([id]) => id);
}

/**
 * Get models by provider
 */
export function getModelsByProvider(provider: Provider): ModelId[] {
  return (Object.entries(MODEL_CATALOG) as [ModelId, ModelConfig][])
    .filter(([, config]) => config.provider === provider)
    .map(([id]) => id);
}

/**
 * Get the cheapest model with required strengths
 */
export function getCheapestModelWithStrengths(
  requiredStrengths: ModelStrength[]
): ModelId | null {
  const candidates = (
    Object.entries(MODEL_CATALOG) as [ModelId, ModelConfig][]
  ).filter(([, config]) =>
    requiredStrengths.every((s) => config.strengths.includes(s))
  );

  if (candidates.length === 0) return null;

  // Sort by average cost (input + output) and return cheapest
  candidates.sort(
    ([, a], [, b]) =>
      a.inputCostPer1M + a.outputCostPer1M - (b.inputCostPer1M + b.outputCostPer1M)
  );

  return candidates[0][0];
}

/**
 * Default model selections by task type
 */
export const DEFAULT_MODEL_BY_TASK = {
  quickLookup: "claude-3-5-haiku-20241022",
  deepAnalysis: "claude-sonnet-4-20250514",
  codeGeneration: "claude-sonnet-4-20250514",
  structuredOutput: "gpt-4o-mini",
  longContext: "claude-sonnet-4-20250514",
  simpleTransform: "local",
} as const satisfies Record<string, ModelId>;

/**
 * Task-based model routing for specialist agents
 *
 * Maps agent task types to optimal models:
 * - research: Gemini 2.0 Flash with Google Search grounding
 * - coding: Claude Opus for complex code generation
 * - chat: Claude Sonnet for general conversation
 * - classification: Claude Haiku for quick SPARKS triage
 */
export type AgentTaskType = "research" | "coding" | "chat" | "classification";

export const TASK_MODEL_MAP: Record<AgentTaskType, ModelId> = {
  research: "gemini-2.0-flash",       // Deep research with Google Search grounding
  coding: "claude-opus-4-20250514",   // Complex code generation
  chat: "claude-sonnet-4-20250514",   // General conversation
  classification: "claude-3-5-haiku-20241022", // Quick triage (SPARKS)
};

/**
 * Get model for a specific agent task type
 */
export function getModelForTask(taskType: AgentTaskType): ModelId {
  return TASK_MODEL_MAP[taskType];
}
