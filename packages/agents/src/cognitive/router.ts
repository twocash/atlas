/**
 * Cognitive Router - Provider Router
 *
 * Routes model requests to the appropriate provider/endpoint.
 * Layer 2 of the two-layer routing system.
 *
 * Priority:
 * 1. Direct API (if key available and preferred)
 * 2. OpenRouter fallback (if enabled and available)
 */

import type { ProviderRoute, Endpoint } from "./types";
import type { ModelId, Provider } from "./models";
import { MODEL_CATALOG } from "./models";
import {
  getCognitiveConfig,
  isDirectApiAvailable,
  isFallbackAvailable,
} from "../config/cognitive";
import { logger } from "../logger";

/**
 * OpenRouter base URL
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Route a model request to the appropriate provider
 */
export function routeProvider(modelId: ModelId): ProviderRoute {
  const config = getCognitiveConfig();
  const modelConfig = MODEL_CATALOG[modelId];

  // Local models don't need API routing
  if (modelConfig.provider === "local") {
    return {
      endpoint: "local",
      provider: "local",
      modelId: modelId,
      apiKey: undefined,
    };
  }

  // Determine preferred provider from model config
  const preferredProvider = modelConfig.provider as "anthropic" | "openai";

  // Try direct API first if preferred and available
  if (config.preferDirectApi && isDirectApiAvailable(preferredProvider)) {
    const apiKey = config.api[preferredProvider].apiKey;

    logger.debug("Routing to direct API", {
      modelId,
      provider: preferredProvider,
    });

    return {
      endpoint: "direct",
      provider: preferredProvider,
      modelId: modelId,
      apiKey,
    };
  }

  // Fall back to OpenRouter if available
  if (isFallbackAvailable() && modelConfig.openrouterModel) {
    logger.debug("Routing to OpenRouter fallback", {
      modelId,
      openrouterModel: modelConfig.openrouterModel,
    });

    return {
      endpoint: "openrouter",
      provider: "openrouter",
      modelId: modelConfig.openrouterModel,
      apiKey: config.api.openrouter.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
    };
  }

  // Last resort: try direct API even if key not confirmed
  // (will fail at runtime if key is invalid, but gives better error)
  logger.warn("No confirmed API available, trying direct as last resort", {
    modelId,
    provider: preferredProvider,
  });

  return {
    endpoint: "direct",
    provider: preferredProvider,
    modelId: modelId,
    apiKey: config.api[preferredProvider].apiKey,
  };
}

/**
 * Get fallback route if primary fails
 */
export function getFallbackRoute(
  primaryRoute: ProviderRoute,
  modelId: ModelId
): ProviderRoute | null {
  const config = getCognitiveConfig();
  const modelConfig = MODEL_CATALOG[modelId];

  // If we were on direct, try OpenRouter
  if (primaryRoute.endpoint === "direct" && isFallbackAvailable() && modelConfig.openrouterModel) {
    logger.debug("Getting OpenRouter fallback route", {
      modelId,
      openrouterModel: modelConfig.openrouterModel,
    });

    return {
      endpoint: "openrouter",
      provider: "openrouter",
      modelId: modelConfig.openrouterModel,
      apiKey: config.api.openrouter.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
    };
  }

  // If we were on OpenRouter, try direct (might work now)
  if (primaryRoute.endpoint === "openrouter") {
    const preferredProvider = modelConfig.provider as "anthropic" | "openai";
    if (isDirectApiAvailable(preferredProvider)) {
      logger.debug("Getting direct API fallback route", {
        modelId,
        provider: preferredProvider,
      });

      return {
        endpoint: "direct",
        provider: preferredProvider,
        modelId: modelId,
        apiKey: config.api[preferredProvider].apiKey,
      };
    }
  }

  // No fallback available
  return null;
}

/**
 * Check if a route is available (has API key)
 */
export function isRouteAvailable(route: ProviderRoute): boolean {
  if (route.endpoint === "local") {
    return true;
  }
  return Boolean(route.apiKey && route.apiKey.length > 0);
}

/**
 * Get available endpoints for a model
 */
export function getAvailableEndpoints(modelId: ModelId): Endpoint[] {
  const modelConfig = MODEL_CATALOG[modelId];
  const endpoints: Endpoint[] = [];

  if (modelConfig.provider === "local") {
    endpoints.push("local");
    return endpoints;
  }

  const preferredProvider = modelConfig.provider as "anthropic" | "openai";

  if (isDirectApiAvailable(preferredProvider)) {
    endpoints.push("direct");
  }

  if (isFallbackAvailable() && modelConfig.openrouterModel) {
    endpoints.push("openrouter");
  }

  return endpoints;
}

/**
 * Format route for logging/display
 */
export function formatRoute(route: ProviderRoute): string {
  if (route.endpoint === "local") {
    return "Local execution";
  }

  const providerLabel = route.provider === "openrouter" ? "OpenRouter" : route.provider;
  return `${providerLabel} (${route.endpoint}) → ${route.modelId}`;
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "local":
      return "Local";
  }
}

/**
 * Check if routing is healthy (at least one endpoint available)
 */
export function isRoutingHealthy(): boolean {
  const config = getCognitiveConfig();

  return (
    config.api.anthropic.available ||
    config.api.openai.available ||
    config.api.openrouter.available
  );
}

/**
 * Get routing health summary
 */
export function getRoutingHealthSummary(): {
  healthy: boolean;
  anthropic: boolean;
  openai: boolean;
  openrouter: boolean;
} {
  const config = getCognitiveConfig();

  return {
    healthy: isRoutingHealthy(),
    anthropic: config.api.anthropic.available,
    openai: config.api.openai.available,
    openrouter: config.api.openrouter.available,
  };
}
