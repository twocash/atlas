/**
 * Cognitive Router - Model Selector
 *
 * Selects the optimal model based on task profile and requirements.
 * Layer 1 of the two-layer routing system.
 */

import type { TaskProfile, ModelSelection } from "./types";
import {
  type ModelId,
  MODEL_CATALOG,
  estimateCost,
  DEFAULT_MODEL_BY_TASK,
} from "./models";
import { logger } from "../logger";

/**
 * Select the optimal model for a task
 */
export function selectModel(profile: TaskProfile): ModelSelection {
  let modelId: ModelId;
  let reasoning: string;
  let fallbackModelId: ModelId | undefined;

  // Trivial tasks: use local or skip entirely
  if (profile.complexity === "trivial") {
    modelId = "local";
    reasoning = "Trivial task - no LLM needed";
    return {
      modelId,
      reasoning,
      estimatedCost: 0,
    };
  }

  // Structured output requirement: prefer GPT-4o-mini for JSON mode
  if (profile.requiresStructuredOutput) {
    modelId = DEFAULT_MODEL_BY_TASK.structuredOutput;
    reasoning = "Structured output required - GPT-4o-mini has reliable JSON mode";
    fallbackModelId = "claude-3-5-haiku-20241022";
  }
  // Code generation: use Sonnet
  else if (profile.requiresCode) {
    modelId = DEFAULT_MODEL_BY_TASK.codeGeneration;
    reasoning = "Code generation required - Sonnet has best code quality";
    fallbackModelId = "gpt-4o";
  }
  // Deep reasoning or complex analysis: use Sonnet
  else if (profile.requiresReasoning && profile.complexity === "complex") {
    modelId = DEFAULT_MODEL_BY_TASK.deepAnalysis;
    reasoning = "Complex reasoning required - Sonnet has best analysis";
    fallbackModelId = "gpt-4o";
  }
  // Long context: use Sonnet (200k context)
  else if (profile.requiresLongContext) {
    modelId = DEFAULT_MODEL_BY_TASK.longContext;
    reasoning = "Long context required - Sonnet has 200k context window";
    fallbackModelId = "gpt-4o";
  }
  // Creative writing: prefer Sonnet
  else if (profile.requiresCreativity) {
    modelId = "claude-sonnet-4-20250514";
    reasoning = "Creative task - Sonnet produces better creative output";
    fallbackModelId = "gpt-4o";
  }
  // Simple tasks: use Haiku for speed and cost
  else if (profile.complexity === "simple") {
    modelId = DEFAULT_MODEL_BY_TASK.quickLookup;
    reasoning = "Simple task - Haiku is fast and cost-efficient";
    fallbackModelId = "gpt-4o-mini";
  }
  // Moderate tasks: default to Haiku, upgrade if needed
  else {
    modelId = "claude-3-5-haiku-20241022";
    reasoning = "Moderate task - starting with Haiku, can upgrade if needed";
    fallbackModelId = "claude-sonnet-4-20250514";
  }

  // Calculate estimated cost
  const estimatedCost = estimateCost(
    modelId,
    profile.estimatedInputTokens,
    profile.estimatedOutputTokens
  );

  logger.debug("Model selected", {
    taskId: profile.taskId,
    modelId,
    fallbackModelId,
    estimatedCost: estimatedCost.toFixed(6),
    reasoning,
  });

  return {
    modelId,
    reasoning,
    estimatedCost,
    fallbackModelId,
  };
}

/**
 * Upgrade model selection after a failure
 */
export function upgradeModelSelection(
  current: ModelSelection,
  profile: TaskProfile
): ModelSelection {
  // If we have a fallback, use it
  if (current.fallbackModelId) {
    const upgradedCost = estimateCost(
      current.fallbackModelId,
      profile.estimatedInputTokens,
      profile.estimatedOutputTokens
    );

    logger.info("Upgrading model", {
      taskId: profile.taskId,
      from: current.modelId,
      to: current.fallbackModelId,
    });

    return {
      modelId: current.fallbackModelId,
      reasoning: `Upgraded from ${current.modelId} after failure`,
      estimatedCost: upgradedCost,
      // Set new fallback based on tier
      fallbackModelId: getNextFallback(current.fallbackModelId),
    };
  }

  // No fallback available - return premium model
  const premiumModel: ModelId = "claude-sonnet-4-20250514";
  const premiumCost = estimateCost(
    premiumModel,
    profile.estimatedInputTokens,
    profile.estimatedOutputTokens
  );

  return {
    modelId: premiumModel,
    reasoning: "Upgraded to premium model after fallback exhausted",
    estimatedCost: premiumCost,
  };
}

/**
 * Get next fallback model in the chain
 */
function getNextFallback(currentModel: ModelId): ModelId | undefined {
  const fallbackChain: Record<ModelId, ModelId | undefined> = {
    "claude-3-5-haiku-20241022": "claude-sonnet-4-20250514",
    "gpt-4o-mini": "gpt-4o",
    "gpt-4o": "claude-sonnet-4-20250514",
    "claude-sonnet-4-20250514": "claude-opus-4-20250514",
    "claude-opus-4-20250514": undefined, // Top of chain
    "gemini-2.0-flash": "gemini-2.0-pro",
    "gemini-2.0-pro": "claude-sonnet-4-20250514",
    local: "claude-3-5-haiku-20241022",
  };

  return fallbackChain[currentModel];
}

/**
 * Check if estimated cost exceeds threshold
 */
export function exceedsCostThreshold(
  selection: ModelSelection,
  threshold: number
): boolean {
  return selection.estimatedCost > threshold;
}

/**
 * Get model tier for display
 */
export function getModelTierLabel(modelId: ModelId): string {
  const tier = MODEL_CATALOG[modelId].tier;
  switch (tier) {
    case "premium":
      return "Premium";
    case "efficient":
      return "Efficient";
    case "free":
      return "Local";
  }
}

/**
 * Format selection for logging/display
 */
export function formatSelection(selection: ModelSelection): string {
  const tierLabel = getModelTierLabel(selection.modelId);
  const costStr = selection.estimatedCost > 0
    ? `~$${selection.estimatedCost.toFixed(4)}`
    : "free";

  return `${selection.modelId} (${tierLabel}) - ${costStr}`;
}
