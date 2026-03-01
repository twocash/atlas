/**
 * Provenance Accumulation Helpers
 *
 * In-memory object accumulation — negligible overhead.
 * Chain is created at action entry, phases appended during execution,
 * context/result set when available, finalized at delivery.
 *
 * Sprint: Sprint A — Pipeline Unification + Provenance Core
 */

import type {
  ProvenanceChain,
  ProvenanceRoute,
  ProvenanceConfig,
  ProvenanceContext,
  ProvenanceResult,
  ComputePhase,
} from '../types/provenance';

export type { ProvenanceChain } from '../types/provenance';
export type {
  ProvenanceRoute,
  ProvenanceConfig,
  ProvenanceCompute,
  ProvenanceContext,
  ProvenanceResult,
  ProvenanceTime,
  ComputePhase,
} from '../types/provenance';

// ─── Create ────────────────────────────────────────────

/**
 * Initialize a ProvenanceChain at action entry.
 *
 * @param entry - Pipeline entry point identifier
 * @param path - Initial path segment(s)
 * @param trigger - What caused this action
 */
export function createProvenanceChain(
  entry: string,
  path: string[],
  trigger = 'user-message',
): ProvenanceChain {
  return {
    route: { entry, path: [...path], trigger },
    config: {
      source: 'compiled-default',
      povContextInjected: false,
      v2ConfigApplied: false,
    },
    compute: { phases: [], apiCalls: 0 },
    context: {
      slots: {},
      ragSources: [],
      preReaderAvailable: false,
    },
    result: {
      citations: [],
      ragChunks: [],
      findingCount: 0,
      hallucinationDetected: false,
    },
    time: { startedAt: new Date().toISOString() },
  };
}

// ─── Accumulate: Compute ───────────────────────────────

/**
 * Append a compute phase to the chain.
 * Called once per LLM call / tool invocation.
 */
export function appendPhase(
  chain: ProvenanceChain,
  phase: ComputePhase,
): ProvenanceChain {
  chain.compute.phases.push(phase);
  chain.compute.apiCalls++;
  return chain;
}

// ─── Accumulate: Config ────────────────────────────────

/**
 * Record config provenance — where settings came from.
 */
export function setConfig(
  chain: ProvenanceChain,
  config: Partial<ProvenanceConfig>,
): ProvenanceChain {
  Object.assign(chain.config, config);
  return chain;
}

// ─── Accumulate: Context ───────────────────────────────

/**
 * Record context state at resolution time.
 */
export function setContext(
  chain: ProvenanceChain,
  context: Partial<ProvenanceContext>,
): ProvenanceChain {
  if (context.slots) chain.context.slots = context.slots;
  if (context.drafterId !== undefined) chain.context.drafterId = context.drafterId;
  if (context.ragSources) chain.context.ragSources = context.ragSources;
  if (context.sourceUrl !== undefined) chain.context.sourceUrl = context.sourceUrl;
  if (context.preReaderAvailable !== undefined) chain.context.preReaderAvailable = context.preReaderAvailable;
  return chain;
}

// ─── Accumulate: Result ────────────────────────────────

/**
 * Record output quality metadata.
 * Citations (web URLs) and ragChunks (RAG sources) are kept SEPARATE.
 */
export function setResult(
  chain: ProvenanceChain,
  result: Partial<ProvenanceResult>,
): ProvenanceChain {
  if (result.andonGrade !== undefined) chain.result.andonGrade = result.andonGrade;
  if (result.andonConfidence !== undefined) chain.result.andonConfidence = result.andonConfidence;
  if (result.citations) chain.result.citations = result.citations;
  if (result.ragChunks) chain.result.ragChunks = result.ragChunks;
  if (result.findingCount !== undefined) chain.result.findingCount = result.findingCount;
  if (result.hallucinationDetected !== undefined) chain.result.hallucinationDetected = result.hallucinationDetected;
  return chain;
}

// ─── Accumulate: Route ─────────────────────────────────

/**
 * Append a path segment to the route trace.
 */
export function appendPath(
  chain: ProvenanceChain,
  segment: string,
): ProvenanceChain {
  chain.route.path.push(segment);
  return chain;
}

// ─── Finalize ──────────────────────────────────────────

/**
 * Stamp the chain with final timing.
 * Called once at delivery time. Returns the same chain (mutated).
 */
export function finalizeProvenance(chain: ProvenanceChain): ProvenanceChain {
  const now = new Date();
  chain.time.finalizedAt = now.toISOString();
  chain.time.totalDurationMs = now.getTime() - new Date(chain.time.startedAt).getTime();
  return chain;
}
