/**
 * Approach Builder — Constructs step-by-step proposals.
 *
 * For moderate requests: 1-2 steps, brief context, no question.
 * For complex requests: 2-4 steps, capabilities mapped, asks "Sound right?".
 * For rough requests: Sprint 3 placeholder.
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 */

import type { CapabilityMatch } from "../self-model/types"
import type { ApproachProposal, ApproachStep, Complexity, AssessmentContext } from "./types"
import { ASSESSMENT_DEFAULTS } from "./types"

// ─── Step Construction ───────────────────────────────────

/**
 * Infer approach steps from matched capabilities and request context.
 *
 * Each step maps to a capability where possible.
 */
function inferSteps(
  request: string,
  context: AssessmentContext,
  capabilities: CapabilityMatch[],
  complexity: Complexity,
): ApproachStep[] {
  const steps: ApproachStep[] = []
  const maxSteps = complexity === "moderate" ? 2 : ASSESSMENT_DEFAULTS.maxApproachSteps

  // Step 1: If context-dependent, gather context first
  if (context.hasContact || /\b(?:meeting|call|conversation)\b/i.test(request)) {
    const contextCap = capabilities.find(
      (c) => c.layer === "knowledge" || c.layer === "integrations",
    )
    steps.push({
      description: "Gather relationship context and prior interactions",
      capability: contextCap?.capabilityId,
      estimatedSeconds: 30,
    })
  }

  // Step 2: If it involves research or knowledge retrieval
  if (/\b(?:research|find|look\s+up|search|pull|check)\b/i.test(request)) {
    const knowledgeCap = capabilities.find(
      (c) => c.layer === "knowledge" || c.capabilityId.includes("research"),
    )
    steps.push({
      description: "Research and retrieve relevant information",
      capability: knowledgeCap?.capabilityId,
      estimatedSeconds: 60,
    })
  }

  // Step 3: If it involves content creation or drafting
  if (/\b(?:draft|write|prepare|create|compose|assemble)\b/i.test(request)) {
    const executionCap = capabilities.find(
      (c) => c.layer === "execution" || c.capabilityId.includes("prompt"),
    )
    steps.push({
      description: "Draft and compose the deliverable",
      capability: executionCap?.capabilityId,
      estimatedSeconds: 120,
    })
  }

  // Step 4: If it involves external action (sending, posting, updating)
  if (/\b(?:send|post|update|share|publish|deploy)\b/i.test(request)) {
    const integrationCap = capabilities.find((c) => c.layer === "integrations")
    steps.push({
      description: "Execute the delivery action",
      capability: integrationCap?.capabilityId,
      estimatedSeconds: 15,
    })
  }

  // Fallback: if no specific steps detected, add a generic execution step
  if (steps.length === 0) {
    const primaryCap = capabilities[0]
    steps.push({
      description: "Process the request",
      capability: primaryCap?.capabilityId,
      estimatedSeconds: 30,
    })
  }

  // If URL involved and not yet addressed, add URL analysis step
  if (context.hasUrl && !steps.some((s) => s.description.includes("Research"))) {
    steps.unshift({
      description: "Analyze shared URL content",
      estimatedSeconds: 20,
    })
  }

  return steps.slice(0, maxSteps)
}

// ─── Time Estimation ─────────────────────────────────────

function estimateTime(steps: ApproachStep[]): string {
  const totalSeconds = steps.reduce((sum, s) => sum + (s.estimatedSeconds ?? 30), 0)

  if (totalSeconds < 60) return "~30 seconds"
  if (totalSeconds < 120) return "~1 minute"
  if (totalSeconds < 300) return `~${Math.ceil(totalSeconds / 60)} minutes`
  return `~${Math.round(totalSeconds / 60)} minutes`
}

// ─── Alternative Angles ──────────────────────────────────

function suggestAlternatives(
  request: string,
  context: AssessmentContext,
  capabilities: CapabilityMatch[],
): string[] {
  const angles: string[] = []
  const maxAngles = ASSESSMENT_DEFAULTS.maxAlternativeAngles

  // If research is involved, suggest different depths
  if (/\b(?:research|find|look\s+up)\b/i.test(request)) {
    angles.push("Quick summary vs. deep dive with citations")
  }

  // If content creation, suggest different formats
  if (/\b(?:draft|write|prepare)\b/i.test(request)) {
    angles.push("Bullet points vs. polished narrative")
  }

  // If multiple capabilities matched, suggest different approaches
  if (capabilities.length > 1) {
    const layers = [...new Set(capabilities.map((c) => c.layer))]
    if (layers.includes("knowledge") && layers.includes("execution")) {
      angles.push("RAG-augmented vs. fresh generation")
    }
  }

  // If consulting/client context, suggest framing options
  if (context.pillar === "Consulting") {
    angles.push("Internal prep vs. client-ready deliverable")
  }

  return angles.slice(0, maxAngles)
}

// ─── Public API ──────────────────────────────────────────

/**
 * Build an approach proposal for moderate+ requests.
 *
 * Returns null for simple requests (they execute immediately).
 * Returns a Sprint 3 placeholder for rough requests.
 *
 * @param request - The user's request text
 * @param context - Assessment context
 * @param capabilities - Matched capabilities from self-model
 * @param complexity - The classified complexity tier
 */
export function buildApproach(
  request: string,
  context: AssessmentContext,
  capabilities: CapabilityMatch[],
  complexity: Complexity,
): ApproachProposal | null {
  // Simple requests: no proposal needed
  if (complexity === "simple") return null

  // Rough requests: Sprint 3 placeholder
  if (complexity === "rough") {
    return {
      steps: [
        {
          description: "This needs collaborative exploration — multiple unknowns to resolve",
        },
      ],
      timeEstimate: "Requires dialogue",
      alternativeAngles: [
        "Break into smaller sub-requests",
        "Start with the most constrained piece",
      ],
      questionForJim: "This is a big one. Where should I start?",
    }
  }

  // Moderate and complex: build a real proposal
  const steps = inferSteps(request, context, capabilities, complexity)
  const timeEstimate = estimateTime(steps)
  const alternativeAngles = suggestAlternatives(request, context, capabilities)

  const proposal: ApproachProposal = {
    steps,
    timeEstimate,
    alternativeAngles,
  }

  // Complex requests get a confirmation question
  if (complexity === "complex") {
    proposal.questionForJim = "Sound right, or different angle?"
  }

  return proposal
}
