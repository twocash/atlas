/**
 * Reply Strategy Rules Engine
 *
 * Evaluates rules from Notion against contact fields.
 * Each rule has a Conditions property (IF clause) and Archetype property (THEN clause).
 * Rules are pre-sorted by priority — first match wins.
 */

import type { CommentAuthor } from '~src/types/comments'
import type { StrategyConfigEntry } from './strategy-config'

export interface RuleEvaluation {
  archetype: string         // Archetype slug from THEN clause
  modifiers: string[]       // Triggered modifier slugs
  confidence: number        // 0-1 based on rule match quality
  matchedRule: string       // Name of the matching rule (for debugging)
}

// --- Contact Field Extraction ---

interface ContactFields {
  [key: string]: string | number | boolean | undefined
}

/**
 * Extracts evaluable fields from a CommentAuthor.
 * Maps CommentAuthor properties to the field names used in rule conditions.
 */
export function extractFields(author: CommentAuthor): ContactFields {
  return {
    sector: author.sector || '',
    groveAlignment: parseAlignmentScore(author.groveAlignment),
    priority: author.priority || '',
    linkedInDegree: author.linkedInDegree || '',
    tier: author.tier || '',
    strategicBucket: author.strategicBucket || '',
    relationshipStage: author.relationshipStage || '',
    linkedInIsOpenToWork: author.linkedInIsOpenToWork ?? false,
    headline: author.headline || '',
    name: author.name || '',
  }
}

/**
 * Parse grove alignment string to numeric score.
 * "⭐⭐⭐⭐ Strong Alignment" → 4
 * "⭐⭐ Moderate Alignment" → 2
 */
export function parseAlignmentScore(alignment: string): number {
  if (!alignment) return 0
  const stars = (alignment.match(/⭐/g) || []).length
  if (stars > 0) return stars
  if (alignment.toLowerCase().includes('strong')) return 4
  if (alignment.toLowerCase().includes('good')) return 3
  if (alignment.toLowerCase().includes('moderate')) return 2
  if (alignment.toLowerCase().includes('weak')) return 1
  return 0
}

// --- Condition Evaluation ---

/**
 * Evaluate a condition string against contact fields.
 *
 * Supports:
 *   field == "value"           (string equality)
 *   field != "value"           (string inequality)
 *   field >= number            (numeric comparison)
 *   field <= number / > / <
 *   field contains "substring" (case-insensitive substring match)
 *   condition && condition     (AND, higher precedence)
 *   condition || condition     (OR, lower precedence)
 */
export function evaluateCondition(condition: string, fields: ContactFields): boolean {
  if (!condition.trim()) return false
  // Wildcard rule matches everything
  if (condition.trim() === '*') return true

  // Split on || first (lower precedence)
  const orParts = condition.split('||').map((s) => s.trim())
  return orParts.some((orPart) => {
    // Split on && (higher precedence)
    const andParts = orPart.split('&&').map((s) => s.trim())
    return andParts.every((atom) => evaluateAtom(atom, fields))
  })
}

function evaluateAtom(atom: string, fields: ContactFields): boolean {
  const match = atom.match(/^(\w+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/)
  if (!match) return false

  const [, fieldName, operator, rawValue] = match
  const value = rawValue.trim().replace(/^["']|["']$/g, '')
  const fieldValue = fields[fieldName]

  if (fieldValue === undefined) return false

  switch (operator) {
    case '==':
      if (typeof fieldValue === 'boolean') return fieldValue === (value === 'true')
      if (typeof fieldValue === 'number') return fieldValue === Number(value)
      return String(fieldValue) === value

    case '!=':
      if (typeof fieldValue === 'boolean') return fieldValue !== (value === 'true')
      if (typeof fieldValue === 'number') return fieldValue !== Number(value)
      return String(fieldValue) !== value

    case '>=':
      return Number(fieldValue) >= Number(value)

    case '<=':
      return Number(fieldValue) <= Number(value)

    case '>':
      return Number(fieldValue) > Number(value)

    case '<':
      return Number(fieldValue) < Number(value)

    case 'contains':
      return String(fieldValue).toLowerCase().includes(value.toLowerCase())

    default:
      return false
  }
}

// --- Rules Evaluation ---

/**
 * Evaluate all rules against a contact and return the best match.
 * Rules are pre-sorted by priority (lower = checked first). First match wins.
 */
export function evaluateRules(
  rules: StrategyConfigEntry[],
  author: CommentAuthor,
  modifierEntries: Record<string, StrategyConfigEntry>
): RuleEvaluation {
  const fields = extractFields(author)

  // Find first matching rule
  for (const rule of rules) {
    if (evaluateCondition(rule.conditions, fields)) {
      return {
        archetype: rule.archetype,
        modifiers: findTriggeredModifiers(fields, modifierEntries),
        confidence: 0.9,
        matchedRule: rule.name,
      }
    }
  }

  // No rule matched — standard_engagement fallback
  return {
    archetype: 'standard_engagement',
    modifiers: findTriggeredModifiers(fields, modifierEntries),
    confidence: 0.3,
    matchedRule: 'fallback',
  }
}

/**
 * Find modifiers whose conditions are satisfied by the contact fields.
 * Returns slugs sorted by priority (lower = applied first).
 */
function findTriggeredModifiers(
  fields: ContactFields,
  modifiers: Record<string, StrategyConfigEntry>
): string[] {
  return Object.values(modifiers)
    .filter((mod) => mod.conditions.trim() && evaluateCondition(mod.conditions, fields))
    .sort((a, b) => a.priority - b.priority)
    .map((mod) => mod.slug)
}
