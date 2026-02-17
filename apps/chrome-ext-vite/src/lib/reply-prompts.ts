/**
 * Reply Prompt Composition
 *
 * Assembles prompt from Notion page body content:
 *   Core Voice → Archetype → Modifiers → Comment Context
 *
 * Core Voice and Archetype are always included in full (non-negotiable).
 * Modifier stack is where budget discipline applies — sorted by priority,
 * lowest-priority modifiers dropped first when the cap is reached.
 * Comment context is appended separately.
 */

import type { StrategyConfig } from './strategy-config'
import type { LinkedInComment } from '~src/types/comments'
import { GROVE_CONTEXT } from '~src/types/comments'

// Gate 1.8: Total strategy block budget (prompt 2000→2500, response 1500→1000, total 3500 unchanged)
// ~4 chars per token. 2500 chars ≈ 625 tokens for the full strategy block.
const STRATEGY_BLOCK_BUDGET = 2500

// Modifier budget is dynamically computed from remaining space after core voice + archetype.
// Fallback cap if core voice + archetype are tiny/empty.
const MODIFIER_CHAR_BUDGET_MAX = 2400

export interface ComposedPrompt {
  systemPrompt: string
  strategyBlock: string   // Just the strategy portion (for debugging/display)
  archetype: string
  modifiers: string[]
  usedFallback: boolean
}

/**
 * Compose a full reply prompt from strategy config + comment context.
 * Falls back to GROVE_CONTEXT if no config available.
 */
export function composeReplyPrompt(
  config: StrategyConfig | null,
  archetypeSlug: string,
  modifierSlugs: string[],
  comment: LinkedInComment,
  instruction?: string
): ComposedPrompt {
  if (!config) {
    return {
      systemPrompt: buildFallbackPrompt(comment, instruction),
      strategyBlock: GROVE_CONTEXT,
      archetype: 'fallback',
      modifiers: [],
      usedFallback: true,
    }
  }

  const strategyBlock = buildStrategyBlock(config, archetypeSlug, modifierSlugs)
  const systemPrompt = assembleSystemPrompt(strategyBlock, comment, instruction)

  return {
    systemPrompt,
    strategyBlock,
    archetype: archetypeSlug,
    modifiers: modifierSlugs,
    usedFallback: false,
  }
}

// --- Strategy Block Assembly ---

function buildStrategyBlock(
  config: StrategyConfig,
  archetypeSlug: string,
  modifierSlugs: string[]
): string {
  const parts: string[] = []
  let usedChars = 0

  // 1. Core Voice — full content, non-negotiable
  if (config.coreVoice?.content) {
    const section = `## Core Voice\n${config.coreVoice.content}`
    parts.push(section)
    usedChars += section.length
  }

  // 2. Archetype voice — full content, non-negotiable
  const archetype = config.archetypes[archetypeSlug]
  if (archetype?.content) {
    const section = `## Voice: ${archetype.name}\n${archetype.content}`
    const joinerCost = parts.length > 0 ? 2 : 0  // "\n\n" between parts
    parts.push(section)
    usedChars += section.length + joinerCost
  }

  // 3. Modifiers — budget is remaining space in the strategy block
  if (modifierSlugs.length > 0) {
    const remainingBudget = Math.min(
      STRATEGY_BLOCK_BUDGET - usedChars - 2, // -2 for "\n\n" joiner
      MODIFIER_CHAR_BUDGET_MAX,
    )

    if (remainingBudget > 0) {
      const modHeader = '## Context Modifiers\n'
      let modCharCount = modHeader.length
      const modifierParts: string[] = []

      for (const slug of modifierSlugs) {
        const mod = config.modifiers[slug]
        if (!mod?.content) continue

        const section = `### ${mod.name}\n${mod.content}`
        const joinerCost = modifierParts.length > 0 ? 2 : 0
        if (modCharCount + section.length + joinerCost > remainingBudget) break
        modifierParts.push(section)
        modCharCount += section.length + joinerCost
      }

      if (modifierParts.length > 0) {
        parts.push(`${modHeader}${modifierParts.join('\n\n')}`)
      }
    }
  }

  return parts.join('\n\n')
}

// --- System Prompt Assembly ---

function assembleSystemPrompt(
  strategyBlock: string,
  comment: LinkedInComment,
  instruction?: string
): string {
  const lines = [
    strategyBlock,
    '',
    'You are drafting a reply to a LinkedIn comment. Be concise and authentic.',
  ]

  if (instruction) {
    lines.push(`User's specific request: ${instruction}`)
  }

  lines.push(
    '',
    `The comment is on Jim's post titled: "${comment.postTitle}"`,
    '',
    'Commenter info:',
    `- Name: ${comment.author.name}`,
    `- Headline: ${comment.author.headline}`,
    `- Sector: ${comment.author.sector}`,
    `- Grove Alignment: ${comment.author.groveAlignment}`,
    `- Degree: ${comment.author.linkedInDegree}`,
  )

  if (comment.author.strategicBucket) {
    lines.push(`- Strategic Bucket: ${comment.author.strategicBucket}`)
  }
  if (comment.author.relationshipStage) {
    lines.push(`- Relationship Stage: ${comment.author.relationshipStage}`)
  }

  lines.push('', 'Reply ONLY with the draft text, no preamble or explanation.')

  return lines.join('\n')
}

function buildFallbackPrompt(comment: LinkedInComment, instruction?: string): string {
  const lines = [
    GROVE_CONTEXT,
    '',
    'You are drafting a reply to a LinkedIn comment. Be concise and authentic.',
  ]

  if (instruction) {
    lines.push(`User's specific request: ${instruction}`)
  }

  lines.push(
    '',
    `The comment is on Jim's post titled: "${comment.postTitle}"`,
    '',
    'Commenter info:',
    `- Name: ${comment.author.name}`,
    `- Headline: ${comment.author.headline}`,
    `- Sector: ${comment.author.sector}`,
    `- Grove Alignment: ${comment.author.groveAlignment}`,
    '',
    'Reply ONLY with the draft text, no preamble or explanation.',
  )

  return lines.join('\n')
}
