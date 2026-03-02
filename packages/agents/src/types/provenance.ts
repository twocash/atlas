/**
 * ProvenanceChain — Universal Action Trace
 *
 * Every pipeline action carries a ProvenanceChain that accumulates
 * as execution proceeds. 6 fields: Route, Config, Compute, Context,
 * Result, Time. Initialized at action entry, finalized at delivery.
 *
 * Sprint: Sprint A — Pipeline Unification + Provenance Core
 * Spec: Universal Provenance Chain (316780a78eef81369c47ee7cdf339380)
 */

import type { Pillar } from '../types';

// ─── Route ─────────────────────────────────────────────

/** How the action was triggered and what path it took */
export interface ProvenanceRoute {
  /** Entry point: 'orchestrator' | 'socratic-resolved' | 'content-confirm' | 'agent-command' */
  entry: string;
  /** Dispatch path through the pipeline */
  path: string[];
  /** What triggered the action: 'user-message' | 'url-share' | 'socratic-answer' | 'auto-dispatch' */
  trigger: string;
}

// ─── Config ────────────────────────────────────────────

/** Where configuration values came from */
export interface ProvenanceConfig {
  /** Config resolution source: 'notion' | 'compiled-default' | 'env-override' */
  source: string;
  /** Research depth applied */
  depth?: string;
  /** Pillar used for routing */
  pillar?: Pillar;
  /** Voice/drafter template applied */
  drafter?: string;
  /** Whether POV context was injected */
  povContextInjected: boolean;
  /** Whether V2 evidence requirements were applied */
  v2ConfigApplied: boolean;
}

// ─── Compute ───────────────────────────────────────────

/** A single compute phase in the pipeline */
export interface ComputePhase {
  /** Phase name: 'retrieve' | 'synthesize' | 'andon-gate' | 'triage' | 'classify' */
  name: string;
  /** Provider used: 'claude-haiku' | 'gemini-2.0-flash' | 'claude-sonnet' */
  provider: string;
  /** Tools/capabilities used in this phase */
  tools: string[];
  /** Duration of this phase in milliseconds */
  durationMs: number;
}

/** All compute phases that executed */
export interface ProvenanceCompute {
  /** Ordered list of compute phases */
  phases: ComputePhase[];
  /** Total API calls made */
  apiCalls: number;
}

// ─── Context ───────────────────────────────────────────

/** What context was available and used */
export interface ProvenanceContext {
  /** Socratic slot states at resolution time */
  slots: Record<string, 'filled' | 'inferred' | 'empty'>;
  /** Drafter template ID if applied */
  drafterId?: string;
  /** RAG sources consulted (AnythingLLM workspace chunks) */
  ragSources: string[];
  /** Source URL if content-triggered */
  sourceUrl?: string;
  /** Whether pre-reader content was available */
  preReaderAvailable: boolean;
}

// ─── Result ────────────────────────────────────────────

/** Outcome quality metadata */
export interface ProvenanceResult {
  /** Andon Gate classification: 'Grounded' | 'Informed' | 'Speculative' | 'Insufficient' */
  andonGrade?: string;
  /** Andon confidence score (0-1) */
  andonConfidence?: number;
  /** Web citations (real URLs from search) */
  citations: string[];
  /** RAG chunks (workspace document references) — separate from web citations */
  ragChunks: string[];
  /** Number of distinct findings produced */
  findingCount: number;
  /** Whether hallucination was detected */
  hallucinationDetected: boolean;
  /** Sensitive claim categories detected: 'financial' | 'medical' | 'legal' */
  claimFlags: string[];
}

// ─── Time ──────────────────────────────────────────────

/** Timing metadata */
export interface ProvenanceTime {
  /** When the chain was initialized */
  startedAt: string;
  /** When the chain was finalized */
  finalizedAt?: string;
  /** Total wall-clock duration in milliseconds */
  totalDurationMs?: number;
}

// ─── ProvenanceChain (Top-Level) ───────────────────────

/** Complete provenance trace for a pipeline action */
export interface ProvenanceChain {
  route: ProvenanceRoute;
  config: ProvenanceConfig;
  compute: ProvenanceCompute;
  context: ProvenanceContext;
  result: ProvenanceResult;
  time: ProvenanceTime;
}
