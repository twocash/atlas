/**
 * Reply Strategy Computation
 *
 * Orchestrates the strategy pipeline:
 * 1. Get config from cache (or fetch from Notion)
 * 2. Evaluate rules against CommentAuthor
 * 3. Compose prompt from config + rules result
 * 4. Return strategy result with composed prompt
 */

import type { LinkedInComment } from '~src/types/comments'
import type { SocraticQuestion } from '~src/types/socratic'
import { getStrategyConfig, type StrategyConfig } from './strategy-config'
import { evaluateRules } from './strategy-rules'
import { composeReplyPrompt, type ComposedPrompt } from './reply-prompts'
import { assessReplyContext, submitSocraticAnswer } from './socratic-adapter'

export interface ReplyStrategy {
  archetype: string
  modifiers: string[]
  confidence: number
  matchedRule: string
  composedPrompt: ComposedPrompt
  /** Socratic assessment confidence (if assessment ran) */
  socraticConfidence?: number
}

/** Result from Socratic-aware strategy computation */
export type SocraticReplyResult =
  | { type: 'ready'; strategy: ReplyStrategy }
  | { type: 'interview'; sessionId: string; questions: SocraticQuestion[]; confidence: number }

/**
 * Compute the reply strategy for a comment.
 * Returns the archetype, modifiers, and composed prompt.
 * Falls back to GROVE_CONTEXT if config unavailable.
 */
export async function getReplyStrategy(
  comment: LinkedInComment,
  instruction?: string
): Promise<ReplyStrategy> {
  const config = await getStrategyConfig()

  if (!config) {
    return {
      archetype: 'fallback',
      modifiers: [],
      confidence: 0,
      matchedRule: 'no_config',
      composedPrompt: composeReplyPrompt(null, 'fallback', [], comment, instruction),
    }
  }

  // Evaluate rules against contact fields
  const evaluation = evaluateRules(config.rules, comment.author, config.modifiers)

  // Compose the full prompt
  const composedPrompt = composeReplyPrompt(
    config,
    evaluation.archetype,
    evaluation.modifiers,
    comment,
    instruction
  )

  return {
    archetype: evaluation.archetype,
    modifiers: evaluation.modifiers,
    confidence: evaluation.confidence,
    matchedRule: evaluation.matchedRule,
    composedPrompt,
  }
}

/**
 * Quick Reply strategy — used when no contact data is available.
 * Returns standard_engagement with no modifiers.
 */
export async function getQuickReplyStrategy(
  comment: LinkedInComment,
  instruction?: string
): Promise<ReplyStrategy> {
  const config = await getStrategyConfig()

  return {
    archetype: 'standard_engagement',
    modifiers: [],
    confidence: 0.5,
    matchedRule: 'quick_reply',
    composedPrompt: composeReplyPrompt(
      config,
      'standard_engagement',
      [],
      comment,
      instruction
    ),
  }
}

// ==========================================
// Socratic-Aware Strategy (Gate 1)
// ==========================================

/**
 * Socratic-aware reply strategy: assesses context first, asks questions
 * if confidence is low, then runs the existing strategy pipeline.
 *
 * Flow:
 *   1. Run Socratic assessment on the comment
 *   2. If auto_draft → pass through to existing pipeline
 *   3. If questions needed → return them for UI rendering
 *   4. If error → fall through to existing pipeline (graceful degradation)
 */
export async function getSocraticReplyStrategy(
  comment: LinkedInComment,
  instruction?: string
): Promise<SocraticReplyResult> {
  try {
    const assessment = assessReplyContext(comment)

    if (assessment.type === 'resolved') {
      // Auto-draft or post-answer resolution
      const enrichedInstruction = assessment.enrichedInstruction
        ? [instruction, assessment.enrichedInstruction].filter(Boolean).join('. ')
        : instruction
      const strategy = await getReplyStrategy(comment, enrichedInstruction)
      strategy.socraticConfidence = assessment.confidence
      return { type: 'ready', strategy }
    }

    if (assessment.type === 'question') {
      return {
        type: 'interview',
        sessionId: assessment.sessionId,
        questions: assessment.questions,
        confidence: assessment.confidence,
      }
    }
  } catch (e) {
    console.warn('[Socratic] Assessment failed, falling through:', e)
  }

  // Error fallback → existing pipeline
  const strategy = await getReplyStrategy(comment, instruction)
  return { type: 'ready', strategy }
}

/**
 * Submit a Socratic answer and get the updated result.
 * If all questions answered → resolves to ready strategy.
 * If more questions → returns them.
 */
export async function submitSocraticAndGetStrategy(
  sessionId: string,
  answerValue: string,
  questionIndex: number,
  comment: LinkedInComment,
  instruction?: string
): Promise<SocraticReplyResult> {
  const result = submitSocraticAnswer(sessionId, answerValue, questionIndex)

  if (result.type === 'resolved') {
    const enrichedInstruction = result.enrichedInstruction
      ? [instruction, result.enrichedInstruction].filter(Boolean).join('. ')
      : instruction
    const strategy = await getReplyStrategy(comment, enrichedInstruction)
    strategy.socraticConfidence = result.confidence
    return { type: 'ready', strategy }
  }

  if (result.type === 'question') {
    return {
      type: 'interview',
      sessionId: result.sessionId,
      questions: result.questions,
      confidence: result.confidence,
    }
  }

  // Error → fall through to existing pipeline
  const strategy = await getReplyStrategy(comment, instruction)
  return { type: 'ready', strategy }
}
