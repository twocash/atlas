/**
 * Socratic Context Builder — LinkedIn Comment → Slot Scores
 *
 * Maps Chrome extension's LinkedInComment data into weighted
 * context slot scores for the Socratic adapter.
 *
 * Each slot has sub-signals that contribute to its completeness.
 * The adapter then multiplies completeness × weight to get contribution.
 */

import type { LinkedInComment } from '~src/types/comments'
import type { SlotScore } from '~src/types/socratic'
import { CONTEXT_WEIGHTS } from '~src/types/socratic'

/**
 * Score all five context slots from a LinkedIn comment.
 * Returns array of SlotScore with completeness, contribution, and gaps.
 */
export function scoreContextSlots(comment: LinkedInComment): SlotScore[] {
  return [
    scoreContactData(comment),
    scoreContentSignals(comment),
    scoreClassification(comment),
    scoreBridgeContext(comment),
    scoreSkillRequirements(),
  ]
}

// --- Slot Assessors ---

function scoreContactData(c: LinkedInComment): SlotScore {
  const weight = CONTEXT_WEIGHTS.contact_data
  const gaps: string[] = []
  let completeness = 0

  if (c.author.name) completeness += 0.15
  else gaps.push('author name')

  if (c.author.headline) completeness += 0.10

  if (c.author.linkedInDegree) completeness += 0.10

  if (c.author.sector && c.author.sector !== 'Unknown') {
    completeness += 0.15
  } else {
    gaps.push('sector')
  }

  if (c.author.groveAlignment) completeness += 0.15
  else gaps.push('grove alignment')

  if (c.author.strategicBucket) completeness += 0.15
  else gaps.push('strategic bucket')

  if (c.author.relationshipStage) completeness += 0.15
  else gaps.push('relationship stage')

  // Bonus for 1st-degree connections (more context available)
  if (c.author.linkedInDegree === '1st') completeness += 0.05

  return {
    slot: 'contact_data',
    completeness: Math.min(1, completeness),
    contribution: Math.min(1, completeness) * weight,
    gaps,
  }
}

function scoreContentSignals(c: LinkedInComment): SlotScore {
  const weight = CONTEXT_WEIGHTS.content_signals
  const gaps: string[] = []
  let completeness = 0

  if (c.content) {
    completeness += 0.30
    if (c.content.length > 50) completeness += 0.15
    if (c.content.length > 200) completeness += 0.10
  } else {
    gaps.push('comment content')
  }

  if (c.postTitle) completeness += 0.20
  else gaps.push('post title')

  if (c.commentUrl) completeness += 0.10

  // threadDepth is always present (defaults to 0)
  completeness += 0.15

  return {
    slot: 'content_signals',
    completeness: Math.min(1, completeness),
    contribution: Math.min(1, completeness) * weight,
    gaps,
  }
}

function scoreClassification(c: LinkedInComment): SlotScore {
  const weight = CONTEXT_WEIGHTS.classification
  const gaps: string[] = []
  let completeness = 0

  if (c.author.tier) {
    completeness += 0.30
  } else {
    gaps.push('tier classification')
  }

  if (c.author.tierConfidence && c.author.tierConfidence > 0.5) {
    completeness += 0.20
  }

  if (c.author.priority && c.author.priority !== 'Standard') {
    completeness += 0.25
  } else if (c.author.priority === 'Standard') {
    completeness += 0.10
  } else {
    gaps.push('priority')
  }

  // LinkedIn reply intent is implicitly 'engage'
  completeness += 0.25

  return {
    slot: 'classification',
    completeness: Math.min(1, completeness),
    contribution: Math.min(1, completeness) * weight,
    gaps,
  }
}

function scoreBridgeContext(c: LinkedInComment): SlotScore {
  const weight = CONTEXT_WEIGHTS.bridge_context
  const gaps: string[] = []
  let completeness = 0

  if (c.notionPageId) completeness += 0.30
  else gaps.push('engagement record')

  if (c.notionContactId) completeness += 0.40
  else gaps.push('Notion contact')

  if (c.parentAuthorName) completeness += 0.15

  if (c.isMe !== undefined) completeness += 0.15

  return {
    slot: 'bridge_context',
    completeness: Math.min(1, completeness),
    contribution: Math.min(1, completeness) * weight,
    gaps,
  }
}

function scoreSkillRequirements(): SlotScore {
  // LinkedIn reply is a fixed, well-understood skill — always complete
  return {
    slot: 'skill_requirements',
    completeness: 1.0,
    contribution: CONTEXT_WEIGHTS.skill_requirements,
    gaps: [],
  }
}
