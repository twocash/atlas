/**
 * Self-Model Slot Builder — Formats the capability model into
 * a context slot for Bridge prompt injection (Slot 9).
 *
 * Produces a curated summary of relevant capabilities, strengths,
 * limitations, and health warnings — not a raw dump of the full model.
 *
 * Sprint: CONV-ARCH-001 (Self-Model — What Can Atlas Do?)
 */

import type { CapabilityModel, SelfModelSlotContent } from "./types"
import { SELF_MODEL_DEFAULTS } from "./types"
import type { MatchResult } from "./matcher"

// ─── Token Estimation ─────────────────────────────────────

const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ─── Slot Content Builder ─────────────────────────────────

/**
 * Build the self-model slot content from the capability model and match result.
 *
 * The output is a curated text block designed for prompt injection:
 * - Relevant capabilities (from matcher)
 * - Strengths for this request context
 * - Known limitations or degraded services
 * - Health warnings (if any)
 *
 * Stays within the 500-token slot budget.
 */
export function buildSelfModelSlotContent(
  model: CapabilityModel,
  matchResult: MatchResult,
): SelfModelSlotContent {
  const sections: string[] = []

  // Section 1: Relevant capabilities
  if (matchResult.relevantCapabilityNames.length > 0) {
    sections.push(
      "Relevant capabilities:\n" +
      matchResult.relevantCapabilityNames.map((name) => `- ${name}`).join("\n"),
    )
  }

  // Section 2: Strengths
  if (matchResult.strengths.length > 0) {
    sections.push(
      "Strengths for this request:\n" +
      matchResult.strengths.map((s) => `- ${s}`).join("\n"),
    )
  }

  // Section 3: Limitations
  if (matchResult.limitations.length > 0) {
    sections.push(
      "Current limitations:\n" +
      matchResult.limitations.map((l) => `- ${l}`).join("\n"),
    )
  }

  // Section 4: Health warnings (only if degraded/critical)
  if (model.health.status !== "healthy") {
    sections.push(
      `System health: ${model.health.summary}\n` +
      model.health.degradedCapabilities.map((d) => `- ${d}: degraded`).join("\n"),
    )
  }

  let text = sections.join("\n\n")

  // Enforce token budget
  const maxChars = SELF_MODEL_DEFAULTS.slotTokenBudget * CHARS_PER_TOKEN
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1) + "\u2026"
  }

  return {
    relevantCapabilities: matchResult.relevantCapabilityNames,
    strengths: matchResult.strengths,
    limitations: matchResult.limitations,
    healthWarnings: model.health.status !== "healthy"
      ? model.health.degradedCapabilities
      : [],
    text,
    tokenEstimate: estimateTokens(text),
  }
}

/**
 * Build a minimal self-model slot when the feature is disabled or model unavailable.
 */
export function buildEmptySelfModelSlot(): SelfModelSlotContent {
  return {
    relevantCapabilities: [],
    strengths: [],
    limitations: [],
    healthWarnings: [],
    text: "",
    tokenEstimate: 0,
  }
}
