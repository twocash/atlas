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
import { getStrategyConfig, type StrategyConfig } from './strategy-config'
import { evaluateRules } from './strategy-rules'
import { composeReplyPrompt, type ComposedPrompt } from './reply-prompts'

export interface ReplyStrategy {
  archetype: string
  modifiers: string[]
  confidence: number
  matchedRule: string
  composedPrompt: ComposedPrompt
}

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
