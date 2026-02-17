/**
 * Cognitive Router types — Gate 1.6
 *
 * Defines the routing decision model that maps interaction tier +
 * task complexity + Bridge connectivity → backend selection.
 *
 * The cognitive router gives tier classification a second job:
 * routing key for backend selection. ~80% of replies (general +
 * recruiting) stay on Haiku. ~20% (grove + consulting) route to
 * Claude Code via Bridge when connected.
 */

import type { InteractionTier } from "./classification"
import type { BridgeConnectionState, BridgeStatus } from "./claude-sdk"

// ─── Routing Backends ────────────────────────────────────

/**
 * Available LLM backends for reply generation.
 *
 * - `claude_code`: Full cognitive stack via Bridge WebSocket → Claude Code CLI
 * - `haiku`: Existing routeLlmRequest() path with TaskTier-based model selection
 * - `template_fallback`: Last resort — cached template with manual edit flag
 */
export type RoutingBackend = "claude_code" | "haiku" | "template_fallback"

// ─── Task Complexity ─────────────────────────────────────

/**
 * Task types that influence routing decisions.
 *
 * - `draft`: Reply drafting — benefits from full context (MCP tools, Notion history)
 * - `classification`: Contact tier classification — lightweight, doesn't need Claude Code
 * - `socratic_question`: Bounded Socratic questions — lightweight
 * - `status_write`: Deterministic status updates — no LLM needed
 */
export type TaskComplexity = "draft" | "classification" | "socratic_question" | "status_write"

// ─── Bridge Status (re-exported from claude-sdk) ─────────

export type { BridgeConnectionState, BridgeStatus }

// ─── Router Input ────────────────────────────────────────

export interface CognitiveRouterInput {
  /** Contact's interaction tier (from AI classification or cache) */
  tier: InteractionTier | undefined
  /** What kind of task is being routed */
  taskComplexity: TaskComplexity
  /** Current Bridge connectivity state */
  bridgeStatus: BridgeStatus
}

// ─── Routing Decision ────────────────────────────────────

export interface RoutingDecision {
  /** Selected backend for this request */
  backend: RoutingBackend
  /** Human-readable routing rationale for console logging */
  rationale: string
  /** Ordered fallback chain if primary backend fails */
  fallbackChain: RoutingBackend[]
  /** If this is a fallback, why the preferred backend was unavailable */
  fallbackReason?: string
  /** TaskTier hint for the haiku backend (maps to FAST/SMART model selection) */
  taskTier: "fast" | "smart"
  /** The tier that drove this decision (resolved from input, defaults to "general") */
  resolvedTier: InteractionTier
}
