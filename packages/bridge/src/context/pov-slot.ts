/**
 * POV Slot Assembly — Slot 3 Wiring
 *
 * Replaces the `assemblePovSlot()` stub.
 * Flow: fetch POV → format structured fields → createSlot()
 *
 * Graceful degradation: returns empty slot on any failure.
 */

import type { ContextSlot } from "../types/orchestration"
import { createSlot, createEmptySlot } from "./slots"
import { fetchPovForPillar, type PovContent } from "./pov-fetcher"

// ─── Types ───────────────────────────────────────────────

interface TriageLike {
  pillar: string
  keywords: string[]
}

// ─── Slot Assembly ───────────────────────────────────────

/**
 * Assemble the POV Library slot from Notion.
 *
 * Source string encodes the fetch outcome:
 *   - "notion-pov-library" → successfully populated
 *   - "pov-no-match"       → query succeeded but no matching entries
 *   - "pov-no-domains"     → pillar has no domain mapping (expected)
 *   - "pov-unreachable"    → database access error (ADR-008 visible)
 *   - "pov-error"          → unexpected exception
 *
 * @param triage - Triage result (needs pillar + keywords)
 */
export async function assemblePovSlot(
  triage: TriageLike,
): Promise<ContextSlot> {
  try {
    const result = await fetchPovForPillar(triage.pillar, triage.keywords)

    switch (result.status) {
      case 'found':
        return createSlot({
          id: "pov",
          source: "notion-pov-library",
          content: formatPovContent(result.content!),
        })

      case 'unreachable':
        console.warn(`[POV] Database unreachable — slot degraded: ${result.error}`)
        return createEmptySlot("pov", "pov-unreachable")

      case 'no_match':
        return createEmptySlot("pov", "pov-no-match")

      case 'no_domains':
        return createEmptySlot("pov", "pov-no-domains")

      default:
        return createEmptySlot("pov", "pov-no-match")
    }
  } catch (err) {
    console.warn("[POV] Slot assembly failed:", (err as Error).message)
    return createEmptySlot("pov", "pov-error")
  }
}

// ─── Content Formatting ──────────────────────────────────

function formatPovContent(pov: PovContent): string {
  const lines: string[] = [
    `POV: ${pov.title}`,
  ]

  if (pov.coreThesis) {
    lines.push(`Thesis: ${pov.coreThesis}`)
  }
  if (pov.evidenceStandards) {
    lines.push(`Evidence Standard: ${pov.evidenceStandards}`)
  }
  if (pov.rhetoricalPatterns) {
    lines.push(`Rhetorical Pattern: ${pov.rhetoricalPatterns}`)
  }
  if (pov.counterArguments) {
    lines.push(`Counter-Arguments: ${pov.counterArguments}`)
  }
  if (pov.boundaryConditions) {
    lines.push(`Boundaries: ${pov.boundaryConditions}`)
  }

  return lines.join("\n")
}
