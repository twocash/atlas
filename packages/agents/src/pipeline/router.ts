/**
 * CognitiveRouter — Universal Dispatch from System-Level Compute
 *
 * Makes ALL compute decisions. The router has access to the full desk
 * (SystemCapabilities). It evaluates the task, selects minimum viable
 * compute, and dispatches. Surface NEVER constrains this decision.
 *
 * What the surface CAN affect:
 *   - Available context (enriches the request)
 *   - Available device tools (merged with desk tools)
 *   - Delivery format (streaming vs batch, length limits)
 *
 * What the surface CANNOT affect:
 *   - Which model handles the task
 *   - Whether Claude Code is used
 *   - Whether local models are used
 *   - Whether desk tools are available
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../logger';
import type { ToolDefinition, DeliveryConstraints } from './surface';
import type {
  CognitiveTier,
  ExecutionStrategy,
  ExecutionMode,
  ContextCheck,
  SystemCapabilities,
} from './system';
import type { RouterConfigCache, RouterConfig } from './router-config';
import type { TriageResult } from '../cognitive/triage-skill';

// ─── Cognitive Task ──────────────────────────────────────
// Intermediate representation of what needs to be computed.

export interface CognitiveTask {
  /** Original message text */
  message: string;
  /** Triage result (intent, complexity, pillar, etc.) */
  triage: TriageResult;
  /** User ID for session continuity */
  userId: number;
  /** Whether this is a follow-on from a previous turn */
  isFollowOn: boolean;
  /** Whether tools are required (command intent, explicit dispatches) */
  requiresToolUse: boolean;
}

// ─── Assembled Context ───────────────────────────────────
// Output of the context enrichment pipeline.

export interface AssemblyResult {
  /** Assembled context string for prompt injection */
  enrichedContext: string;
  /** Which context slots were populated */
  slotsPopulated: string[];
  /** Which context slots were empty (expected absence, not error) */
  slotsEmpty: string[];
  /** Which context slots degraded (partial failure) */
  slotsDegraded: string[];
  /** Total token estimate across all slots */
  totalTokens: number;
  /** Assembly latency */
  assemblyLatencyMs: number;
  /** Whether browser context was available */
  hasBrowserContext: boolean;
  /** Degradation note for prompt injection (if any slots degraded) */
  degradedContextNote: string | null;
}

// ─── Router ──────────────────────────────────────────────

/**
 * Evaluate a task and produce an execution strategy.
 *
 * The router:
 * 1. Assigns a cognitive tier based on task complexity
 * 2. Checks if the task needs context the surface can't provide
 * 3. Selects model from config cache (tier → model mapping)
 * 4. Selects mode: deterministic / conversational / agentic
 * 5. Assembles tools: desk tools (always) + device tools (from surface)
 * 6. Selects backend from system-level backends
 * 7. Determines delivery mode from surface constraints
 */
export function route(
  task: CognitiveTask,
  assembly: AssemblyResult,
  availableTools: ToolDefinition[],
  deliveryConstraints: DeliveryConstraints,
  config: RouterConfig,
  system: SystemCapabilities,
): ExecutionStrategy {
  // 1. Assign tier from triage
  const tier = assignTier(task);

  // 2. Select model from config (tier → model mapping)
  const tierConfig = config.tierModelMapping[tier];
  const model = tierConfig?.primary ?? getDefaultModel(tier);

  // 3. Select mode
  const mode = selectMode(tier, task, config);

  // 4. Select backend
  const backend = selectBackend(tier, mode, system, config);

  // 5. Determine delivery mode
  const deliveryMode = deliveryConstraints.supportsStreaming ? 'stream' : 'batch';

  logger.info('Router decision', {
    tier,
    model,
    mode,
    backend: backend.backendId,
    deliveryMode,
    toolCount: availableTools.length,
    slotsPopulated: assembly.slotsPopulated,
  });

  return {
    tier,
    model,
    mode,
    backend,
    tools: availableTools,
    deliveryMode: deliveryMode as 'stream' | 'batch',
  };
}

/**
 * Check if a task requires context the surface can't provide.
 * Returns a graceful degradation message if insufficient.
 *
 * e.g., "I can't see your screen right now. Send the text or use Bridge."
 */
export function checkContextRequirements(
  task: CognitiveTask,
  assembly: AssemblyResult,
): ContextCheck {
  // Tasks that reference screen content need browser context
  const screenPatterns = [
    /\b(what('s| is) on (my |the )?screen)\b/i,
    /\b(summarize|read|look at) what (I('m| am)|you) (see|looking at)\b/i,
    /\b(this page|current page|what('s| is) (here|open))\b/i,
    /\bwhat do you see\b/i,
  ];

  const needsBrowser = screenPatterns.some(p => p.test(task.message));

  if (needsBrowser && !assembly.hasBrowserContext) {
    return {
      sufficient: false,
      missingContext: ['browser_state', 'page_content'],
      userMessage: "I can't see your screen right now. Send me the text, drop a URL, or ask me again from Bridge.",
    };
  }

  return { sufficient: true };
}

// ─── Internal Helpers ────────────────────────────────────

function assignTier(task: CognitiveTask): CognitiveTier {
  const triage = task.triage;

  // Use triage complexity tier if available
  if (triage.complexityTier !== undefined) {
    return Math.min(triage.complexityTier, 3) as CognitiveTier;
  }

  // Fallback heuristics
  if (triage.intent === 'command' && triage.confidence > 0.9) return 0;
  if (triage.intent === 'clarify') return 1;
  if (triage.intent === 'capture') return 1;
  if (triage.intent === 'query' && !triage.isCompound) return 2;
  if (triage.isCompound) return 3;

  return 2; // Default to conversational
}

function getDefaultModel(tier: CognitiveTier): string {
  switch (tier) {
    case 0: return 'deterministic';
    case 1: return 'claude-haiku-4-5-20251001';
    case 2: return 'claude-sonnet-4-20250514';
    case 3: return 'claude-sonnet-4-20250514';
  }
}

function selectMode(
  tier: CognitiveTier,
  task: CognitiveTask,
  config: RouterConfig,
): ExecutionMode {
  // Config override
  const configMode = config.tierModeDefaults[tier];
  if (configMode) return configMode;

  // Defaults
  if (tier === 0) return 'deterministic';
  if (tier === 3 || task.requiresToolUse) return 'agentic';
  return 'conversational';
}

function selectBackend(
  tier: CognitiveTier,
  mode: ExecutionMode,
  system: SystemCapabilities,
  _config: RouterConfig,
): import('./system').ExecutionBackend {
  // Agentic mode → prefer Claude Code backend if available
  if (mode === 'agentic') {
    const codeBackend = system.backends.find(b => b.backendId === 'claude-code');
    if (codeBackend) return codeBackend;
  }

  // Local model backend for Tier 0-1 (when available — Grove ratchet)
  if (tier <= 1) {
    const localBackend = system.backends.find(b => b.backendId === 'local-model');
    if (localBackend) return localBackend;
  }

  // Default: Claude API backend
  const apiBackend = system.backends.find(b => b.backendId === 'claude-api');
  if (apiBackend) return apiBackend;

  // Last resort: first available
  return system.backends[0];
}
