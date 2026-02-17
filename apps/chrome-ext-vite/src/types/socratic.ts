/**
 * Socratic Interview Types — Chrome Extension
 *
 * Chrome-specific types for the Socratic adapter layer.
 * Mirrors Gate 0 engine concepts but stays independent of
 * packages/agents (which has Node.js deps like @notionhq/client).
 */

// ==========================================
// Context Scoring
// ==========================================

export type ContextSlot =
  | 'contact_data'
  | 'content_signals'
  | 'classification'
  | 'bridge_context'
  | 'skill_requirements'

export type ConfidenceRegime = 'auto_draft' | 'ask_one' | 'ask_framing'

/** Weights for each context slot (sum = 1.0, matches Gate 0 engine) */
export const CONTEXT_WEIGHTS: Record<ContextSlot, number> = {
  contact_data: 0.30,
  content_signals: 0.25,
  classification: 0.20,
  bridge_context: 0.15,
  skill_requirements: 0.10,
}

/** Confidence thresholds for regime determination */
export const CONFIDENCE_THRESHOLDS = {
  AUTO_DRAFT: 0.85,
  ASK_ONE: 0.50,
} as const

/** Score for a single context slot */
export interface SlotScore {
  slot: ContextSlot
  /** 0.0 = no data, 1.0 = fully present */
  completeness: number
  /** completeness * weight */
  contribution: number
  /** What's missing */
  gaps: string[]
}

/** Full context assessment result */
export interface ContextAssessment {
  overallConfidence: number
  regime: ConfidenceRegime
  slots: SlotScore[]
  topGaps: Array<{ slot: ContextSlot; gap: string }>
}

// ==========================================
// Questions
// ==========================================

export interface QuestionOption {
  label: string
  value: string
}

export interface SocraticQuestion {
  text: string
  targetSlot: ContextSlot
  options: QuestionOption[]
}

// ==========================================
// Adapter Result
// ==========================================

export type SocraticAdapterResult =
  | { type: 'resolved'; confidence: number; enrichedInstruction?: string }
  | { type: 'question'; sessionId: string; questions: SocraticQuestion[]; confidence: number }
  | { type: 'error'; message: string }
