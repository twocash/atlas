/**
 * Cognitive Router Configuration
 *
 * Centralizes all configuration for the cognitive routing layer.
 */

import type { ModelId } from "../cognitive/models";

/**
 * API configuration for each provider
 */
export interface ApiConfig {
  anthropic: {
    apiKey: string | undefined;
    available: boolean;
  };
  openai: {
    apiKey: string | undefined;
    available: boolean;
  };
  openrouter: {
    apiKey: string | undefined;
    available: boolean;
  };
}

/**
 * Notion database IDs for persistence
 */
export interface NotionDatabases {
  tokenLedger: string | undefined;
  workerResults: string | undefined;
}

/**
 * Main cognitive router configuration
 */
export interface CognitiveConfig {
  api: ApiConfig;
  notion: NotionDatabases;

  /** Maximum concurrent workers */
  maxConcurrentWorkers: number;

  /** Prefer direct API over OpenRouter */
  preferDirectApi: boolean;

  /** Enable OpenRouter fallback when direct API unavailable */
  openrouterFallback: boolean;

  /** Cost threshold (USD) requiring user approval */
  costCheckpointThreshold: number;

  /** Max retries before circuit breaker triggers */
  maxRetries: number;

  /** Default timeout per worker (ms) */
  defaultTimeoutMs: number;

  /** Model defaults */
  defaults: {
    classificationModel: ModelId;
    chatModel: ModelId;
    structuredOutputModel: ModelId;
  };
}

/**
 * Load configuration from environment variables
 */
export function loadCognitiveConfig(): CognitiveConfig {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  return {
    api: {
      anthropic: {
        apiKey: anthropicKey,
        available: Boolean(anthropicKey && anthropicKey.length > 0),
      },
      openai: {
        apiKey: openaiKey,
        available: Boolean(openaiKey && openaiKey.length > 0),
      },
      openrouter: {
        apiKey: openrouterKey,
        available: Boolean(openrouterKey && openrouterKey.length > 0),
      },
    },
    notion: {
      tokenLedger: process.env.NOTION_TOKEN_LEDGER_DB || "6ec84319-8867-4aee-b55d-defe921c9f7b",
      workerResults: process.env.NOTION_WORKER_RESULTS_DB || "d886ee70-ab25-4388-acff-4314c77573b1",
    },
    maxConcurrentWorkers: parseInt(
      process.env.COGNITIVE_MAX_CONCURRENT_WORKERS || "5",
      10
    ),
    preferDirectApi:
      process.env.COGNITIVE_PREFER_DIRECT_API !== "false",
    openrouterFallback:
      process.env.COGNITIVE_OPENROUTER_FALLBACK !== "false",
    costCheckpointThreshold: parseFloat(
      process.env.COGNITIVE_COST_CHECKPOINT_THRESHOLD || "0.50"
    ),
    maxRetries: parseInt(process.env.COGNITIVE_MAX_RETRIES || "3", 10),
    defaultTimeoutMs: 30000,
    defaults: {
      classificationModel: "claude-haiku-4-5-20251001",
      chatModel: "claude-sonnet-4-20250514",
      structuredOutputModel: "gpt-4o-mini",
    },
  };
}

// Singleton config instance - lazy loaded
let _config: CognitiveConfig | null = null;

/**
 * Get the cognitive router configuration
 */
export function getCognitiveConfig(): CognitiveConfig {
  if (!_config) {
    _config = loadCognitiveConfig();
  }
  return _config;
}

/**
 * Check if a direct API is available for a provider
 */
export function isDirectApiAvailable(provider: "anthropic" | "openai"): boolean {
  const config = getCognitiveConfig();
  return config.api[provider].available;
}

/**
 * Check if any fallback is available
 */
export function isFallbackAvailable(): boolean {
  const config = getCognitiveConfig();
  return config.openrouterFallback && config.api.openrouter.available;
}

/**
 * Get routing preference order for a provider
 */
export function getRoutingOrder(
  preferredProvider: "anthropic" | "openai"
): ("direct" | "openrouter")[] {
  const config = getCognitiveConfig();
  const order: ("direct" | "openrouter")[] = [];

  // Always try direct first if preferred and available
  if (config.preferDirectApi && config.api[preferredProvider].available) {
    order.push("direct");
  }

  // Add OpenRouter fallback if enabled and available
  if (config.openrouterFallback && config.api.openrouter.available) {
    order.push("openrouter");
  }

  // If nothing available, still try direct as last resort
  if (order.length === 0) {
    order.push("direct");
  }

  return order;
}
