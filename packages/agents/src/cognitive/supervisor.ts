/**
 * Cognitive Router - Supervisor
 *
 * Main orchestrator for the cognitive routing layer.
 * Implements:
 * - Two-stage validation (spec compliance, then output quality)
 * - Progressive disclosure (profile first, load context second)
 * - Circuit breaker pattern (3 failures → surface to user)
 * - Parallel dispatch for complex queries
 */

import type {
  SupervisorRequest,
  SupervisorResponse,
  TaskProfile,
  WorkerRequest,
  WorkerResult,
  CircuitBreakerState,
  ValidationResult,
} from "./types";
import { profileTask, assessRiskTier, canSkipLLM, getQuickResponse, upgradeComplexity } from "./profiler";
import { selectModel, upgradeModelSelection } from "./selector";
import { routeProvider, getFallbackRoute } from "./router";
import { executeWorker, isRetriableError } from "./worker";
import { recordTokens, aggregateUsage } from "./ledger";
import { persistWorkerExecution } from "./persistence";
import { getCognitiveConfig } from "../config/cognitive";
import { logger } from "../logger";

// Circuit breaker state per task type
const circuitBreakers: Map<string, CircuitBreakerState> = new Map();

/**
 * Main supervisor entry point
 */
export async function supervise(request: SupervisorRequest): Promise<SupervisorResponse> {
  const startTime = Date.now();

  // Phase 1: Profile the task
  const profile = profileTask(request.input);

  logger.info("Supervisor processing", {
    taskId: profile.taskId,
    complexity: profile.complexity,
    tools: profile.detectedTools.length,
  });

  // Check if we can skip LLM entirely
  if (canSkipLLM(profile)) {
    const quickResponse = getQuickResponse(request.input);
    if (quickResponse) {
      return {
        success: true,
        content: quickResponse,
        needsReview: false,
        totalCost: 0,
        totalLatencyMs: Date.now() - startTime,
        workerResults: [],
        taskId: profile.taskId,
      };
    }
  }

  // Phase 2: Assess risk
  const riskTier = assessRiskTier(profile);
  if (riskTier === "review") {
    return {
      success: false,
      content: "",
      needsReview: true,
      reviewReason: getReviewReason(profile),
      totalCost: 0,
      totalLatencyMs: Date.now() - startTime,
      workerResults: [],
      taskId: profile.taskId,
    };
  }

  // Phase 3: Select model
  const modelSelection = request.forceModel
    ? { modelId: request.forceModel, reasoning: "Forced model", estimatedCost: 0 }
    : selectModel(profile);

  // Phase 4: Check cost threshold
  const config = getCognitiveConfig();
  if (modelSelection.estimatedCost > config.costCheckpointThreshold) {
    return {
      success: false,
      content: "",
      needsReview: true,
      reviewReason: `Estimated cost $${modelSelection.estimatedCost.toFixed(4)} exceeds threshold`,
      totalCost: 0,
      totalLatencyMs: Date.now() - startTime,
      workerResults: [],
      taskId: profile.taskId,
    };
  }

  // Phase 5: Execute with circuit breaker
  const result = await executeWithCircuitBreaker(
    request,
    profile,
    modelSelection,
    config.maxRetries
  );

  // Calculate totals
  const totalLatencyMs = Date.now() - startTime;
  const totalCost = aggregateUsage(result.workerResults).cost;

  // Persist to Notion (async, don't await)
  if (result.workerResults.length > 0) {
    const lastResult = result.workerResults[result.workerResults.length - 1];
    persistWorkerExecution(lastResult, request.input.substring(0, 100)).catch((err) =>
      logger.error("Failed to persist worker execution", { error: err })
    );
  }

  return {
    ...result,
    totalLatencyMs,
    totalCost,
    taskId: profile.taskId,
  };
}

/**
 * Execute with circuit breaker pattern
 */
async function executeWithCircuitBreaker(
  request: SupervisorRequest,
  profile: TaskProfile,
  initialSelection: ReturnType<typeof selectModel>,
  maxRetries: number
): Promise<Omit<SupervisorResponse, "totalLatencyMs" | "totalCost" | "taskId">> {
  const workerResults: WorkerResult[] = [];
  let currentProfile = profile;
  let currentSelection = initialSelection;
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;

    // Route to provider
    const route = routeProvider(currentSelection.modelId);

    // Build worker request
    const workerRequest: WorkerRequest = {
      taskId: currentProfile.taskId,
      profile: currentProfile,
      model: currentSelection,
      route,
      systemPrompt: buildSystemPrompt(currentProfile),
      userMessage: request.input,
      jsonMode: currentProfile.requiresStructuredOutput,
    };

    // Execute worker
    const result = await executeWorker(workerRequest);
    workerResults.push(result);

    // Record in ledger
    recordTokens(result);

    // Success path
    if (result.success && result.content) {
      // Stage 1: Spec compliance validation
      if (!request.skipValidation) {
        const specValid = await validateSpecCompliance(request, result);
        if (!specValid.passed) {
          logger.warn("Spec compliance failed", {
            taskId: currentProfile.taskId,
            issues: specValid.issues,
          });

          // Upgrade model and retry
          currentSelection = upgradeModelSelection(currentSelection, currentProfile);
          continue;
        }

        // Stage 2: Output quality validation (optional for simple tasks)
        if (currentProfile.complexity !== "simple") {
          const qualityValid = await validateOutputQuality(result);
          if (!qualityValid.passed && qualityValid.score < 60) {
            logger.warn("Output quality low", {
              taskId: currentProfile.taskId,
              score: qualityValid.score,
            });

            // Try to refine with same model
            currentProfile = upgradeComplexity(currentProfile);
            continue;
          }
        }
      }

      return {
        success: true,
        content: result.content,
        needsReview: false,
        workerResults,
      };
    }

    // Failure path
    logger.warn("Worker attempt failed", {
      taskId: currentProfile.taskId,
      attempt: attempts,
      error: result.error,
    });

    // Check if retriable
    if (isRetriableError(result)) {
      // Try fallback route
      const fallbackRoute = getFallbackRoute(route, currentSelection.modelId);
      if (fallbackRoute) {
        logger.info("Trying fallback route", {
          taskId: currentProfile.taskId,
          fallbackEndpoint: fallbackRoute.endpoint,
        });
        continue;
      }
    }

    // Upgrade model for next attempt
    currentSelection = upgradeModelSelection(currentSelection, currentProfile);
  }

  // Circuit breaker triggered
  logger.error("Circuit breaker triggered", {
    taskId: currentProfile.taskId,
    attempts,
  });

  return {
    success: false,
    content: `Failed after ${attempts} attempts. May need a different approach.`,
    needsReview: true,
    reviewReason: `Circuit breaker: ${attempts} failures`,
    workerResults,
  };
}

/**
 * Build system prompt based on task profile
 */
function buildSystemPrompt(profile: TaskProfile): string {
  const parts: string[] = [
    "You are Atlas, Jim's AI Chief of Staff.",
    "Be concise and direct. This is a mobile interface.",
  ];

  if (profile.requiresStructuredOutput) {
    parts.push("Return valid JSON only, no markdown.");
  }

  if (profile.requiresCode) {
    parts.push("When providing code, use TypeScript and follow best practices.");
  }

  if (profile.latencySensitive) {
    parts.push("Keep responses brief - under 100 words if possible.");
  }

  return parts.join(" ");
}

/**
 * Validate spec compliance (Stage 1)
 */
async function validateSpecCompliance(
  request: SupervisorRequest,
  result: WorkerResult
): Promise<ValidationResult> {
  // For now, basic heuristic validation
  // Future: Use a small model to validate

  const issues: string[] = [];
  let score = 100;

  // Check if response is empty
  if (!result.content || result.content.trim().length === 0) {
    issues.push("Empty response");
    score -= 50;
  }

  // Check if response is too short for complex requests
  if (result.content && result.content.length < 20 && request.input.length > 100) {
    issues.push("Response may be too brief");
    score -= 20;
  }

  // Check for error indicators in response
  if (result.content?.includes("I cannot") || result.content?.includes("I'm unable")) {
    issues.push("Response indicates inability to complete");
    score -= 30;
  }

  return {
    stage: "spec_compliance",
    passed: score >= 60,
    score,
    issues,
    suggestions: issues.length > 0 ? ["Try with a more capable model"] : [],
  };
}

/**
 * Validate output quality (Stage 2)
 */
async function validateOutputQuality(result: WorkerResult): Promise<ValidationResult> {
  // For now, basic heuristic validation
  // Future: Use a small model to score quality

  const issues: string[] = [];
  let score = 80; // Start with good assumption

  const content = result.content || "";

  // Check for generic filler phrases
  const fillerPhrases = [
    "I'd be happy to",
    "Great question",
    "Certainly!",
    "Of course!",
    "Let me help",
  ];
  for (const phrase of fillerPhrases) {
    if (content.includes(phrase)) {
      issues.push("Contains filler phrases");
      score -= 10;
      break;
    }
  }

  // Check for excessive length (walls of text)
  if (content.length > 2000) {
    issues.push("Response may be too verbose");
    score -= 10;
  }

  // Check for markdown in non-markdown context
  if (content.includes("```") && content.split("```").length > 4) {
    issues.push("Excessive code blocks");
    score -= 5;
  }

  return {
    stage: "output_quality",
    passed: score >= 60,
    score,
    issues,
    suggestions: issues.length > 0 ? ["Consider refining the response"] : [],
  };
}

/**
 * Get human-readable review reason
 */
function getReviewReason(profile: TaskProfile): string {
  const reasons: string[] = [];

  if (profile.touchesAuth) {
    reasons.push("touches authentication");
  }
  if (profile.touchesFilesystem) {
    reasons.push("modifies files");
  }
  if (profile.executesCode) {
    reasons.push("executes code");
  }
  if (profile.mutatesExternal) {
    reasons.push("modifies external systems");
  }

  return `This task ${reasons.join(", ")} and requires your approval.`;
}

/**
 * Execute multiple tasks in parallel (for complex queries)
 */
export async function superviseParallel(
  requests: SupervisorRequest[]
): Promise<SupervisorResponse[]> {
  const config = getCognitiveConfig();
  const maxConcurrent = config.maxConcurrentWorkers;

  // If under limit, run all in parallel
  if (requests.length <= maxConcurrent) {
    return Promise.all(requests.map(supervise));
  }

  // Otherwise, batch
  const results: SupervisorResponse[] = [];
  for (let i = 0; i < requests.length; i += maxConcurrent) {
    const batch = requests.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(supervise));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Reset circuit breaker for a task type
 */
export function resetCircuitBreaker(taskType: string): void {
  circuitBreakers.delete(taskType);
  logger.info("Circuit breaker reset", { taskType });
}

/**
 * Get circuit breaker status
 */
export function getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
  return new Map(circuitBreakers);
}
