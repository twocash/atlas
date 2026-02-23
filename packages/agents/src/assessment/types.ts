/**
 * Request Assessment Types — How should Atlas approach this request?
 *
 * Sprint 2 of the Conversational Architecture EPIC.
 * The self-model (Sprint 1) tells Atlas WHAT it can do.
 * The assessment tells Atlas HOW to approach the request.
 *
 * Simple requests execute immediately. Complex requests get
 * an approach proposal before Atlas dives in.
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 * EPIC: Conversational Architecture
 */

import type { CapabilityMatch } from "../self-model/types"

// ─── Complexity ──────────────────────────────────────────

/**
 * Complexity tier for a request.
 *
 * - simple: Just do it. No preamble.
 * - moderate: Brief context, then do. (1-2 signals)
 * - complex: Propose approach first. (3-4 signals)
 * - rough: Needs collaborative exploration. (5-6 signals, Sprint 3)
 */
export type Complexity = "simple" | "moderate" | "complex" | "rough"

/**
 * The 6 signal dimensions used to classify complexity.
 *
 * Each signal is a boolean flag detected from the request text
 * and context. The count of true signals determines the tier.
 */
export interface ComplexitySignals {
  /** Requires multiple distinct actions to fulfill */
  multiStep: boolean
  /** Goal is not fully specified — needs clarification */
  ambiguousGoal: boolean
  /** Needs external context (contacts, history, prior interactions) */
  contextDependent: boolean
  /** Has a deadline or urgency marker */
  timeSensitive: boolean
  /** Client-facing, important outcome, or high-visibility deliverable */
  highStakes: boolean
  /** No matching skill or established pattern */
  novelPattern: boolean
}

// ─── Approach Proposal ───────────────────────────────────

/** A single step in an approach proposal */
export interface ApproachStep {
  /** What this step does (human-readable) */
  description: string
  /** Which capability handles this step (if known) */
  capability?: string
  /** Estimated seconds for this step */
  estimatedSeconds?: number
}

/**
 * An approach proposal for moderate+ requests.
 *
 * For moderate requests: 1-2 steps, no question.
 * For complex requests: 2-4 steps, asks "Sound right?".
 * For rough requests: Sprint 3 placeholder.
 */
export interface ApproachProposal {
  /** Ordered steps Atlas would take */
  steps: ApproachStep[]
  /** Human-readable time estimate (e.g. "~2 minutes", "~5 minutes") */
  timeEstimate: string
  /** Alternative ways to tackle this */
  alternativeAngles: string[]
  /** Confirmation question for Jim (complex only) */
  questionForJim?: string
}

// ─── Assessment Result ───────────────────────────────────

/**
 * The complete assessment of a request.
 *
 * This is the output of RequestAssessor.assess(). It tells the
 * downstream pipeline whether to execute immediately (simple),
 * provide brief context (moderate), propose an approach (complex),
 * or enter dialogue (rough).
 */
export interface RequestAssessment {
  /** Complexity tier */
  complexity: Complexity
  /** Inferred pillar from message keywords (bypasses triage) */
  pillar: string
  /** Approach proposal (null for simple requests) */
  approach: ApproachProposal | null
  /** Matched capabilities from self-model */
  capabilities: CapabilityMatch[]
  /** Human-readable reasoning for the assessment */
  reasoning: string
  /** Raw signals for telemetry/debugging */
  signals: ComplexitySignals
}

// ─── Assessment Context ──────────────────────────────────

/**
 * Minimal context shape needed for request assessment.
 *
 * This is surface-agnostic — works for Telegram, Chrome, Bridge.
 * Fields are optional because different surfaces provide different context.
 */
export interface AssessmentContext {
  /** Classified intent (e.g. "research", "capture", "query") */
  intent?: string
  /** Pillar routing (e.g. "The Grove", "Consulting") */
  pillar?: string
  /** Extracted keywords */
  keywords?: string[]
  /** Whether the request contains a URL */
  hasUrl?: boolean
  /** Whether the request mentions a person/contact */
  hasContact?: boolean
  /** Whether a deadline or time reference is present */
  hasDeadline?: boolean
  /** Number of prior interactions in this session */
  priorInteractionCount?: number
  /** Recent session message history (for pattern detection) */
  sessionHistory?: string[]
}

// ─── Configuration ───────────────────────────────────────

/** Assessment defaults */
export const ASSESSMENT_DEFAULTS = {
  /** Environment variable controlling feature flag */
  featureFlag: "ATLAS_REQUEST_ASSESSMENT",
  /** Bias toward simple initially — tune via telemetry */
  complexityBias: "simple" as const,
  /** Max steps in an approach proposal */
  maxApproachSteps: 5,
  /** Max alternative angles to suggest */
  maxAlternativeAngles: 3,
  /** Score thresholds for complexity tiers */
  thresholds: {
    /** 0 signals → simple */
    simple: 0,
    /** 1-2 signals → moderate */
    moderate: 2,
    /** 3 signals → complex */
    complex: 3,
    /** 4+ signals → rough */
    rough: 4,
  },
} as const
