/**
 * Cognitive Router - Task Profiler
 *
 * Analyzes incoming messages to determine complexity, requirements, and risks.
 * Uses heuristic detection with optional Claude fallback for ambiguous cases.
 */

import type { TaskProfile, TaskComplexity, RiskTier } from "./types";
import { logger } from "../logger";

/**
 * Tool trigger patterns for intent detection
 */
const TOOL_TRIGGERS = [
  { tool: "query_inbox", pattern: /\b(inbox|captures?|sparks?|what'?s\s+in)\b/i },
  { tool: "query_work_queue", pattern: /\b(queue|tasks?|work|projects?|to-?do)\b/i },
  { tool: "get_status", pattern: /\b(status|overview|urgent|p0|priority|focus)\b/i },
  { tool: "get_atlas_state", pattern: /\b(atlas|how'?s\s+it|state|health)\b/i },
  { tool: "search", pattern: /\b(find|search|look\s+for|where\s+is)\b/i },
  { tool: "create_item", pattern: /\b(create|add|new|capture|save)\b/i },
  { tool: "update_item", pattern: /\b(mark|complete|done|archive|dismiss|update)\b/i },
] as const;

/**
 * Patterns for detecting risk indicators
 */
const RISK_PATTERNS = {
  filesystem: /\b(file|folder|directory|path|write|delete|create|save\s+to)\b/i,
  auth: /\b(password|token|key|secret|credential|login|auth|api[_-]?key)\b/i,
  codeExecution: /\b(run|execute|eval|shell|command|script|code)\b/i,
  externalMutation: /\b(send|post|publish|deploy|delete|remove)\b/i,
};

/**
 * Patterns for detecting capability requirements
 */
const CAPABILITY_PATTERNS = {
  reasoning: /\b(analyze|compare|explain|why|how|evaluate|assess|think|consider)\b/i,
  code: /\b(code|function|implement|fix|bug|error|debug|typescript|javascript|python)\b/i,
  structuredOutput: /\b(json|extract|parse|list|table|format|schema|structured)\b/i,
  creativity: /\b(write|draft|compose|creative|story|poem|idea|brainstorm)\b/i,
  longContext: /\b(summarize|document|article|paper|long|entire|full)\b/i,
};

/**
 * Estimate tokens from text
 * Rough approximation: ~4 chars per token for English
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Detect which tools might be needed
 */
function detectTools(input: string): string[] {
  return TOOL_TRIGGERS.filter((t) => t.pattern.test(input)).map((t) => t.tool);
}

/**
 * Detect complexity from message patterns
 */
function detectComplexity(
  input: string,
  capabilities: ReturnType<typeof detectCapabilities>
): TaskComplexity {
  const tokenCount = estimateTokens(input);

  // Trivial: greetings, acknowledgments, single words
  if (/^(hey|hi|hello|yo|sup|ok|okay|cool|nice|good|great|thanks?|thx|ty)!?$/i.test(input.trim())) {
    return "trivial";
  }

  // Simple: short queries, basic lookups
  if (tokenCount < 20 && !capabilities.requiresReasoning && !capabilities.requiresCode) {
    return "simple";
  }

  // Complex: long context, multiple capabilities needed
  const capabilityCount = Object.values(capabilities).filter(Boolean).length;
  if (tokenCount > 500 || capabilityCount >= 3 || capabilities.requiresLongContext) {
    return "complex";
  }

  // Moderate: everything else
  return "moderate";
}

/**
 * Detect capability requirements
 */
function detectCapabilities(input: string) {
  return {
    requiresReasoning: CAPABILITY_PATTERNS.reasoning.test(input),
    requiresCode: CAPABILITY_PATTERNS.code.test(input),
    requiresStructuredOutput: CAPABILITY_PATTERNS.structuredOutput.test(input),
    requiresCreativity: CAPABILITY_PATTERNS.creativity.test(input),
    requiresLongContext: CAPABILITY_PATTERNS.longContext.test(input),
  };
}

/**
 * Detect risk indicators
 */
function detectRisks(input: string) {
  return {
    touchesFilesystem: RISK_PATTERNS.filesystem.test(input),
    touchesAuth: RISK_PATTERNS.auth.test(input),
    executesCode: RISK_PATTERNS.codeExecution.test(input),
    mutatesExternal: RISK_PATTERNS.externalMutation.test(input),
  };
}

/**
 * Determine required context based on tools detected
 */
function determineRequiredContext(tools: string[]): string[] {
  const context: string[] = [];

  if (tools.includes("query_inbox") || tools.includes("create_item")) {
    context.push("inbox_data");
  }
  if (tools.includes("query_work_queue") || tools.includes("update_item")) {
    context.push("work_queue_data");
  }
  if (tools.includes("get_status") || tools.includes("get_atlas_state")) {
    context.push("status_summary");
  }
  if (tools.includes("search")) {
    context.push("search_index");
  }

  return context;
}

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Profile a task from user input
 */
export function profileTask(input: string): TaskProfile {
  const taskId = generateTaskId();
  const tools = detectTools(input);
  const capabilities = detectCapabilities(input);
  const risks = detectRisks(input);
  const complexity = detectComplexity(input, capabilities);
  const requiredContext = determineRequiredContext(tools);

  // Estimate tokens
  const estimatedInputTokens = estimateTokens(input) + 500; // Add system prompt overhead
  const estimatedOutputTokens = complexity === "trivial" ? 50 : complexity === "simple" ? 150 : complexity === "moderate" ? 300 : 500;

  const profile: TaskProfile = {
    taskId,
    input,
    complexity,
    estimatedInputTokens,
    estimatedOutputTokens,
    ...capabilities,
    // Constraints based on complexity
    latencySensitive: complexity === "trivial" || complexity === "simple",
    costSensitive: true, // Always cost-sensitive by default
    ...risks,
    detectedTools: tools,
    requiredContext,
  };

  logger.debug("Task profiled", {
    taskId,
    complexity,
    tools: tools.length,
    risks: Object.values(risks).filter(Boolean).length,
  });

  return profile;
}

/**
 * Determine risk tier from profile
 */
export function assessRiskTier(profile: TaskProfile): RiskTier {
  // Review: dangerous operations
  if (profile.touchesAuth || profile.touchesFilesystem || profile.executesCode) {
    return "review";
  }

  // Notify: external mutations
  if (profile.mutatesExternal) {
    return "notify";
  }

  // Auto: everything else
  return "auto";
}

/**
 * Check if task should skip LLM entirely
 */
export function canSkipLLM(profile: TaskProfile): boolean {
  // Trivial greetings don't need LLM
  if (profile.complexity === "trivial" && profile.detectedTools.length === 0) {
    return true;
  }

  return false;
}

/**
 * Get quick response for trivial tasks (no LLM needed)
 */
export function getQuickResponse(input: string): string | null {
  const lowerInput = input.toLowerCase().trim();

  // Greetings
  if (/^(hey|hi|hello|yo|sup)!?$/.test(lowerInput)) {
    return "Hey. What's up?";
  }

  // Thanks
  if (/^(thanks|thank you|thx|ty)!?$/.test(lowerInput)) {
    return "Got it.";
  }

  // Acknowledgments
  if (/^(ok|okay|cool|nice|good|great|perfect)!?$/.test(lowerInput)) {
    return "Anything else?";
  }

  return null;
}

/**
 * Upgrade complexity if initial assessment was too low
 */
export function upgradeComplexity(profile: TaskProfile): TaskProfile {
  const newComplexity: TaskComplexity =
    profile.complexity === "trivial"
      ? "simple"
      : profile.complexity === "simple"
        ? "moderate"
        : "complex";

  return {
    ...profile,
    complexity: newComplexity,
    estimatedOutputTokens: profile.estimatedOutputTokens * 1.5,
  };
}
