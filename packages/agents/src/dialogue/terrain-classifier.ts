/**
 * Terrain Classifier — Maps RequestAssessment → Terrain.
 *
 * Gates dialogue entry. Only "rough" terrain enters the
 * DialogueEngine. Everything else flows through Sprint 1-2
 * pipelines (clean → execute, bumpy → clarify then execute).
 *
 * Terrain categories:
 *   clean  — Simple or moderate. Execute directly.
 *   bumpy  — Complex with a clear angle. One question, then go.
 *   rough  — Too many unknowns. Needs collaborative exploration.
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 */

import type { RequestAssessment } from "../assessment/types"
import type { Terrain } from "./types"

// ─── Terrain Classification ─────────────────────────────

/**
 * Classify the terrain from a request assessment.
 *
 * This is the routing decision that determines whether
 * Sprint 3's DialogueEngine activates.
 */
export function classifyTerrain(assessment: RequestAssessment): Terrain {
  const { complexity, signals } = assessment

  // Simple and moderate: clean terrain, Sprint 1-2 handles
  if (complexity === "simple" || complexity === "moderate") {
    return "clean"
  }

  // Rough: always enters dialogue
  if (complexity === "rough") {
    return "rough"
  }

  // Complex: depends on whether the goal is clear
  // If the goal is ambiguous or novel AND context-dependent, it's rough
  if (signals.ambiguousGoal && signals.novelPattern) {
    return "rough"
  }

  // Complex with clear signals: bumpy (one question, then go)
  return "bumpy"
}

/**
 * Check if a terrain classification requires dialogue.
 */
export function needsDialogue(terrain: Terrain): boolean {
  return terrain === "rough"
}

/**
 * Quick check: does this assessment need dialogue?
 */
export function assessmentNeedsDialogue(assessment: RequestAssessment): boolean {
  return needsDialogue(classifyTerrain(assessment))
}
