/**
 * Request Assessor — Main orchestrator for request assessment.
 *
 * Decides HOW Atlas should approach a request:
 *   - Simple → execute immediately, no preamble
 *   - Moderate → brief context, then execute
 *   - Complex → propose approach, ask "Sound right?"
 *   - Rough → enter dialogue (Sprint 3)
 *
 * Integration:
 *   - Consumes CapabilityMatcher from Sprint 1 (self-model)
 *   - Feature-flagged via ATLAS_REQUEST_ASSESSMENT
 *   - Assessment informs, doesn't block (ADR-004)
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 */

import type { CapabilityModel, CapabilityMatch } from "../self-model/types"
import { matchCapabilities } from "../self-model/matcher"
import type { TriageLike, MatchResult } from "../self-model/matcher"
import type { RequestAssessment, AssessmentContext, Complexity } from "./types"
import { ASSESSMENT_DEFAULTS } from "./types"
import { detectSignals, classifyComplexity, countSignals } from "./complexity-classifier"
import { buildApproach } from "./approach-builder"

// ─── Feature Flag ────────────────────────────────────────

/**
 * Check if request assessment is enabled.
 *
 * Opt-in: `ATLAS_REQUEST_ASSESSMENT=true` (default OFF).
 */
export function isAssessmentEnabled(): boolean {
  return process.env[ASSESSMENT_DEFAULTS.featureFlag] !== "false"
}

// ─── Triage Construction ─────────────────────────────────

/**
 * Construct a TriageLike from AssessmentContext for the capability matcher.
 *
 * The matcher needs a triage shape to find relevant capabilities.
 * We build this from the assessment context.
 */
function buildTriageLike(context: AssessmentContext): TriageLike {
  return {
    intent: context.intent ?? "unknown",
    pillar: context.pillar ?? "Personal",
    keywords: context.keywords ?? [],
    complexityTier: 0, // Will be refined after classification
  }
}

// ─── Pillar Inference ────────────────────────────────────

/**
 * Infer pillar from message keywords. Deterministic, no LLM.
 * Default: Personal (groceries, errands, health — the most common simple requests).
 */
export function inferPillar(message: string): string {
  const lower = message.toLowerCase()
  if (/\b(grove|infrastructure|concentration)\b/.test(lower)) return "The Grove"
  if (/\b(atlas|bug|sprint|feature|stab-)\b/.test(lower)) return "Atlas Dev"
  if (/\b(client|chase|walmart|consulting)\b/.test(lower)) return "Consulting"
  return "Personal"
}

// ─── Reasoning Generation ────────────────────────────────

function generateReasoning(
  complexity: Complexity,
  signalCount: number,
  capabilities: CapabilityMatch[],
): string {
  switch (complexity) {
    case "simple":
      return "Direct execution — no ambiguity or dependencies."

    case "moderate": {
      const capNames = capabilities
        .slice(0, 2)
        .map((c) => c.capabilityId)
        .join(", ")
      return `${signalCount} complexity signal(s). Using ${capNames || "general capabilities"}.`
    }

    case "complex": {
      const capNames = capabilities
        .slice(0, 3)
        .map((c) => c.capabilityId)
        .join(", ")
      return `${signalCount} complexity signals — proposing approach. Capabilities: ${capNames || "multiple"}.`
    }

    case "rough":
      return `${signalCount} complexity signals — too many unknowns for a linear plan. Needs collaborative exploration.`
  }
}

// ─── Public API ──────────────────────────────────────────

/**
 * Assess a request and determine the approach.
 *
 * This is the main entry point for Sprint 2. It:
 *   1. Matches capabilities from the self-model (Sprint 1)
 *   2. Detects complexity signals
 *   3. Classifies complexity tier
 *   4. Builds approach proposal (if needed)
 *
 * Architecture constraint: Assessment informs, doesn't block.
 * Simple requests never wait for proposal generation.
 *
 * @param request - The user's request text
 * @param context - Assessment context (surface-agnostic)
 * @param capabilityModel - The assembled capability model from Sprint 1
 * @returns The complete assessment with complexity, approach, and capabilities
 */
export function assessRequest(
  request: string,
  context: AssessmentContext,
  capabilityModel: CapabilityModel,
): RequestAssessment {
  // Step 1: Match capabilities from self-model
  const triage = buildTriageLike(context)
  const matchResult: MatchResult = matchCapabilities(triage, request, capabilityModel)
  const capabilities = matchResult.relevant

  // Step 2: Detect complexity signals
  const signals = detectSignals(request, context, capabilities)

  // Step 3: Classify complexity tier
  const complexity = classifyComplexity(signals)
  const signalCount = countSignals(signals)

  // Step 4: Build approach (null for simple)
  const approach = buildApproach(request, context, capabilities, complexity)

  // Step 5: Generate reasoning
  const reasoning = generateReasoning(complexity, signalCount, capabilities)

  // Step 6: Infer pillar from message keywords
  const pillar = inferPillar(request)

  return {
    complexity,
    pillar,
    approach,
    capabilities,
    reasoning,
    signals,
  }
}

/**
 * Quick-check: assess and return only the complexity tier.
 *
 * Useful for routing decisions where the full assessment isn't needed.
 */
export function quickClassify(
  request: string,
  context: AssessmentContext,
  capabilityModel: CapabilityModel,
): Complexity {
  const triage = buildTriageLike(context)
  const matchResult = matchCapabilities(triage, request, capabilityModel)
  const signals = detectSignals(request, context, matchResult.relevant)
  return classifyComplexity(signals)
}
