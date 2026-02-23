/**
 * Dialogue Types — Collaborative exploration for rough terrain.
 *
 * When a request has too many unknowns for a linear plan,
 * Atlas enters dialogue mode: surfacing observations, asking
 * open-ended questions, and iterating until an approach crystallizes.
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 * EPIC: Conversational Architecture
 */

import type { CapabilityMatch } from "../self-model/types"
import type { ApproachProposal, AssessmentContext, ComplexitySignals } from "../assessment/types"

// ─── Terrain ────────────────────────────────────────────

/**
 * Terrain classification for routing.
 *
 * - clean: Execute immediately (simple/moderate)
 * - bumpy: One clarifying question, then execute (complex with clear angle)
 * - rough: Multi-turn dialogue needed (5+ signals, ambiguous goal)
 */
export type Terrain = "clean" | "bumpy" | "rough"

// ─── Threads ────────────────────────────────────────────

/** Where an observation came from */
export type ThreadSource = "knowledge" | "context" | "inference"

/**
 * A thread is an observation Atlas surfaces during dialogue.
 *
 * Threads are NOT questions — they're things Atlas notices.
 * "I see X connecting to Y" not "What do you want?"
 */
export interface Thread {
  /** Unique thread identifier */
  id: string
  /** What Atlas observed (human-readable) */
  insight: string
  /** Where this observation came from */
  source: ThreadSource
  /** How relevant this thread is (0-1) */
  relevance: number
  /** Optional capability that informed this thread */
  capability?: string
}

// ─── Dialogue State ─────────────────────────────────────

/**
 * The evolving state of a dialogue session.
 *
 * Surface-agnostic — works for Telegram, Chrome, Bridge.
 * Persistent state deferred to Sprint 5.
 */
export interface DialogueState {
  /** Current terrain assessment */
  terrain: Terrain
  /** How many turns have elapsed */
  turnCount: number
  /** Threads Atlas has surfaced */
  threads: Thread[]
  /** Context accumulated through dialogue */
  resolvedContext: Partial<AssessmentContext>
  /** What's still ambiguous */
  openQuestions: string[]
  /** The framing question Atlas is currently asking */
  currentQuestion: string
  /** Whether this dialogue has resolved */
  resolved: boolean
}

// ─── Dialogue Result ────────────────────────────────────

/**
 * What the dialogue engine returns at each turn.
 *
 * Either the dialogue continues (needsResponse: true) with
 * a question for Jim, or it resolves to an executable request.
 */
export interface DialogueResult {
  /** Updated dialogue state */
  state: DialogueState
  /** Whether Jim needs to respond */
  needsResponse: boolean
  /** If resolved, the approach proposal */
  proposal?: ApproachProposal
  /** If resolved, the refined request text */
  refinedRequest?: string
  /** Human-readable message for Jim */
  message: string
}

// ─── Configuration ──────────────────────────────────────

export const DIALOGUE_DEFAULTS = {
  /** Maximum dialogue turns before best-guess proposal */
  maxTurns: 4,
  /** Minimum threads to surface in first turn */
  minThreads: 2,
  /** Maximum threads to surface per turn */
  maxThreads: 5,
  /** Relevance threshold for including a thread */
  relevanceThreshold: 0.3,
} as const
