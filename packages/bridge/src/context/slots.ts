/**
 * Slot helpers — create, validate, and budget-enforce context slots.
 *
 * Each slot represents one source of information injected into the
 * orchestration prompt. Helpers here handle creation with defaults,
 * token estimation, and budget trimming.
 */

import type { ContextSlot, SlotId } from "../types/orchestration"
import {
  SLOT_TOKEN_BUDGETS,
  SLOT_PRIORITIES,
  TOTAL_CONTEXT_BUDGET,
} from "../types/orchestration"

// ─── Token Estimation ──────────────────────────────────────

/** Rough token estimate: ~4 chars per token (conservative for English text) */
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ─── Slot Creation ─────────────────────────────────────────

export interface CreateSlotOptions {
  id: SlotId
  source: string
  content: string
  /** Override default priority */
  priority?: number
  /** Override default token budget */
  maxTokens?: number
}

/**
 * Create a context slot with defaults from the slot config tables.
 * Truncates content to the slot's token budget if it exceeds it.
 */
export function createSlot(opts: CreateSlotOptions): ContextSlot {
  const { id, source, content } = opts
  const priority = opts.priority ?? SLOT_PRIORITIES[id]
  const maxTokens = opts.maxTokens ?? SLOT_TOKEN_BUDGETS[id]
  const populated = content.length > 0

  // Truncate to budget
  const truncated = truncateToTokenBudget(content, maxTokens)
  const tokens = estimateTokens(truncated)

  return { id, source, content: truncated, tokens, priority, populated }
}

/**
 * Create an empty (stubbed) slot — marks it as unpopulated.
 */
export function createEmptySlot(id: SlotId, source: string): ContextSlot {
  return {
    id,
    source,
    content: "",
    tokens: 0,
    priority: SLOT_PRIORITIES[id],
    populated: false,
  }
}

// ─── Budget Enforcement ────────────────────────────────────

/**
 * Truncate text to fit within a token budget.
 * Cuts at the nearest word boundary before the limit.
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (!text) return ""
  const maxChars = maxTokens * CHARS_PER_TOKEN
  if (text.length <= maxChars) return text

  // Cut at word boundary
  const truncated = text.slice(0, maxChars)
  const lastSpace = truncated.lastIndexOf(" ")
  return (lastSpace > maxChars * 0.8 ? truncated.slice(0, lastSpace) : truncated) + "…"
}

/**
 * Enforce total context budget across all slots.
 *
 * If the combined token count exceeds TOTAL_CONTEXT_BUDGET:
 * 1. Sort slots by priority (ascending — lowest priority trimmed first)
 * 2. Trim lowest-priority slots until budget fits
 * 3. Trimmed slots get content cleared and populated set to false
 *
 * Returns a new array — does NOT mutate inputs.
 */
export function enforceTokenBudget(slots: ContextSlot[]): ContextSlot[] {
  const totalTokens = slots.reduce((sum, s) => sum + s.tokens, 0)
  if (totalTokens <= TOTAL_CONTEXT_BUDGET) return slots

  // Sort by priority ascending (trim lowest first)
  const sorted = [...slots].sort((a, b) => a.priority - b.priority)
  let remaining = totalTokens

  const result: ContextSlot[] = sorted.map((slot) => {
    if (remaining <= TOTAL_CONTEXT_BUDGET) return slot

    // This slot gets trimmed
    remaining -= slot.tokens
    return {
      ...slot,
      content: "",
      tokens: 0,
      populated: false,
    }
  })

  // Restore original ordering by slot ID
  const slotOrder: SlotId[] = slots.map((s) => s.id)
  return slotOrder.map((id) => result.find((s) => s.id === id)!)
}

/**
 * Get total token count across all slots.
 */
export function totalTokens(slots: ContextSlot[]): number {
  return slots.reduce((sum, s) => sum + s.tokens, 0)
}

/**
 * Get populated slot IDs.
 */
export function populatedSlotIds(slots: ContextSlot[]): SlotId[] {
  return slots.filter((s) => s.populated).map((s) => s.id)
}
