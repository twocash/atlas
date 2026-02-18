/**
 * Context Enrichment Middleware — Telegram Surface
 *
 * Calls the bridge context assembler to populate 6 context slots,
 * then formats populated slots into prompt sections for injection
 * into the system prompt.
 *
 * Context Transparency: Each slot is wrapped in a SlotResult with
 * ok/degraded/failed status. When any slot is non-ok, a degraded
 * context note is generated for injection into the system prompt.
 *
 * Feature gate: ATLAS_CONTEXT_ENRICHMENT (default: enabled)
 * On error: logs at error level with stack trace and re-throws.
 */

import { assembleContext, type AssemblyResult } from "../../../../packages/bridge/src/context"
import type { OrchestrationRequest, SlotId, ComplexityTier, ContextSlot } from "../../../../packages/bridge/src/types/orchestration"
import type { TriageResult } from "../cognitive/triage-skill"
import { reportFailure } from "@atlas/shared/error-escalation"
import { type SlotResult, type SlotName, wrapSlotResult } from "@atlas/shared/types/slot-result"
import { buildDegradedContextNote } from "@atlas/shared/context-transparency"
import { logger } from "../logger"

// ─── Types ───────────────────────────────────────────────

export interface EnrichmentResult {
  /** Formatted slot content for prompt injection */
  enrichedContext: string
  /** Which slots populated */
  slotsUsed: SlotId[]
  /** Token count for enrichment */
  totalTokens: number
  /** Wall clock time for assembly */
  assemblyLatencyMs: number
  /** Triage result from assembler */
  triage: TriageResult
  /** Complexity tier */
  tier: ComplexityTier
  /** Per-slot transparency results */
  slotResults: SlotResult[]
  /** Degraded context note (null when all slots ok) */
  degradedContextNote: string | null
}

// Slots to exclude from Telegram enrichment:
// - browser: always empty for Telegram (no extension context)
// - output: Telegram has its own response format in prompt.ts
const EXCLUDED_SLOTS: Set<SlotId> = new Set(["browser", "output"])

// Slot display labels for prompt sections
const SLOT_LABELS: Record<SlotId, string> = {
  intent: "INTENT",
  domain_rag: "DOMAIN KNOWLEDGE",
  pov: "POV LIBRARY",
  voice: "VOICE",
  browser: "BROWSER",
  output: "OUTPUT",
}

// ─── Helpers ─────────────────────────────────────────────

/** Wrap a ContextSlot into a SlotResult with status transparency. */
function toSlotResult(slot: ContextSlot): SlotResult {
  if (!slot.populated) {
    return wrapSlotResult(slot.id as SlotName, null, `${slot.source} did not populate`)
  }
  return wrapSlotResult(slot.id as SlotName, slot.content)
}

// ─── Enrichment ──────────────────────────────────────────

/**
 * Enrich a Telegram message with context slots from the bridge assembler.
 *
 * @param messageText - The user's message text
 * @param userId - Telegram user ID (used for synthetic session/connection IDs)
 * @returns EnrichmentResult or null when ALL non-excluded slots are failed
 */
export async function enrichWithContextSlots(
  messageText: string,
  userId: number,
): Promise<EnrichmentResult | null> {
  const start = Date.now()

  try {
    const request: OrchestrationRequest = {
      messageText,
      surface: "telegram",
      browserContext: undefined,
      sessionId: `tg-${userId}-${Date.now()}`,
      sourceConnectionId: `telegram-${userId}`,
      timestamp: new Date().toISOString(),
    }

    const result: AssemblyResult = await assembleContext(request)
    const assemblyLatencyMs = Date.now() - start

    // Wrap ALL slots into SlotResults for transparency
    const allSlotResults = result.slots.map(toSlotResult)

    // Slot results for non-excluded slots only (what Telegram cares about)
    const relevantSlotResults = allSlotResults.filter(
      (s) => !EXCLUDED_SLOTS.has(s.slotName as SlotId),
    )

    // Build degraded context note from relevant slots
    const degradedContextNote = buildDegradedContextNote(relevantSlotResults)

    // Report individual slot failures for escalation tracking
    for (const sr of relevantSlotResults) {
      if (sr.status === 'failed') {
        reportFailure(`slot-${sr.slotName}`, new Error(sr.reason ?? 'Slot failed'), {
          slotName: sr.slotName,
          assemblyLatencyMs,
        })
      }
    }

    // Filter to populated slots for content assembly
    const enrichedSlots = result.slots.filter(
      (s) => s.populated && !EXCLUDED_SLOTS.has(s.id),
    )

    if (enrichedSlots.length === 0) {
      logger.info("[enrichment] No slots populated — skipping enrichment", {
        assemblyLatencyMs,
        degradedSlots: relevantSlotResults.filter((s) => s.status !== 'ok').map((s) => s.slotName),
      })
      return null
    }

    // Format each populated slot into a labeled section
    const sections = enrichedSlots.map(
      (s) => `--- CONTEXT: ${SLOT_LABELS[s.id]} ---\n${s.content}`,
    )
    const enrichedContext = sections.join("\n\n")

    const enrichmentResult: EnrichmentResult = {
      enrichedContext,
      slotsUsed: enrichedSlots.map((s) => s.id),
      totalTokens: result.totalContextTokens,
      assemblyLatencyMs,
      triage: result.triage,
      tier: result.tier,
      slotResults: relevantSlotResults,
      degradedContextNote,
    }

    logger.info("[enrichment] Context assembly complete", {
      slotsUsed: enrichmentResult.slotsUsed,
      totalTokens: enrichmentResult.totalTokens,
      assemblyLatencyMs,
      tier: result.tier,
      degradedNote: degradedContextNote != null,
      slotStatuses: Object.fromEntries(relevantSlotResults.map((s) => [s.slotName, s.status])),
    })

    return enrichmentResult
  } catch (err) {
    const assemblyLatencyMs = Date.now() - start
    logger.error("[enrichment] Context assembly FAILED — not degrading gracefully (fix the root cause)", {
      error: (err as Error).message,
      stack: (err as Error).stack,
      assemblyLatencyMs,
    })
    reportFailure("context-enrichment", err, { assemblyLatencyMs })
    throw err
  }
}
