/**
 * Complexity Classifier — 6-signal detection + scoring.
 *
 * Analyzes a request across 6 signal dimensions to determine
 * complexity tier. Biased toward "simple" initially per
 * risk mitigation strategy.
 *
 * Signals:
 *   1. multiStep — requires multiple distinct actions
 *   2. ambiguousGoal — goal not fully specified
 *   3. contextDependent — needs external context
 *   4. timeSensitive — has deadline or urgency
 *   5. highStakes — client-facing or important outcome
 *   6. novelPattern — no matching skill or pattern
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 */

import type { CapabilityMatch } from "../self-model/types"
import type { ComplexitySignals, Complexity, AssessmentContext } from "./types"
import { ASSESSMENT_DEFAULTS } from "./types"

// ─── Signal Patterns ─────────────────────────────────────

/** Patterns indicating multiple distinct actions */
const MULTI_STEP_PATTERNS = [
  /\b(?:and\s+(?:then|also|additionally))\b/i,
  /\b(?:first|then|next|after\s+that|finally)\b/i,
  /\b(?:prepare|assemble|compile|gather)\b.*\b(?:and|then|plus)\b/i,
  /\b(?:research|draft|review|send)\b.*\b(?:and|then|plus)\b.*\b(?:research|draft|review|send)\b/i,
  // Verbs that inherently imply multi-step work (search → filter → synthesize)
  /\b(?:research|analyze|explore|investigate|rethink|plan|figure\s+out)\b/i,
  // Exploration/thinking verbs (open-ended reasoning → multi-step by nature)
  /\b(?:think\s+(?:through|about)|work\s+through|reason\s+about|sort\s+out)\b/i,
]

/** Patterns indicating vague or underspecified goals */
const AMBIGUOUS_PATTERNS = [
  /^(?:help\s+(?:me\s+)?(?:with|on|think|understand|figure))\b/i,
  /^(?:work\s+on|look\s+(?:at|into))\b/i,
  /\b(?:something\s+(?:about|like|related))\b/i,
  /\b(?:figure\s+out|think\s+(?:about|through)|deal\s+with|sort\s+out)\b/i,
  /\b(?:stuff|things|whatever)\b/i,
  // Broad scope markers — "everything" or "all of this" without specifics
  /\b(?:everything|anything|all\s+of\s+(?:this|that|it))\b/i,
  // Explicit uncertainty
  /\b(?:what\s+to\s+do|how\s+to\s+(?:handle|approach|tackle))\b/i,
  /\b(?:not\s+sure|don't\s+know|no\s+idea)\b/i,
  // Emotional uncertainty — gut-feel signals that intent is unresolved
  /\b(?:feels?\s+(?:off|wrong|weird|like)|uncomfortable\s+with|uneasy\s+about)\b/i,
  /\b(?:something\s+(?:feels|is)\s+(?:off|wrong))\b/i,
]

/** Patterns indicating need for external context */
const CONTEXT_PATTERNS = [
  /\b(?:our\s+(?:last|previous|prior)\s+(?:call|meeting|chat|conversation))\b/i,
  /\b(?:she|he|they)\s+(?:said|mentioned|asked|wants?)\b/i,
  /\b(?:follow\s+up|circle\s+back|revisit)\b/i,
  /\b(?:remember\s+(?:when|that|the))\b/i,
  /\b(?:based\s+on\s+(?:what|our|the))\b/i,
  // Domain references that imply needing system/project context
  /\b(?:the\s+Grove|Atlas|content\s+strategy)\b/i,
  /\b(?:our\s+(?:[\w-]+\s+){0,3}(?:approach|strategy|plan|pipeline|system|architecture|positioning|position))\b/i,
  // Broad scope — "everything" implies needing full picture
  /\b(?:everything|the\s+whole\s+(?:thing|picture|situation))\b/i,
]

/** Patterns indicating time pressure */
const TIME_PATTERNS = [
  /\b(?:today|tonight|tomorrow|asap|urgent(?:ly)?|immediately)\b/i,
  /\b(?:by\s+(?:end\s+of\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b(?:by\s+(?:end\s+of\s+)?(?:this\s+)?(?:week|month|day|morning|afternoon|evening))\b/i,
  /\b(?:deadline|due\s+(?:date|by)|time.?sensitive)\b/i,
  /\b(?:before\s+(?:the|my|our)\s+(?:meeting|call|session))\b/i,
  // Standalone time scoping (without "by" prefix)
  /\b(?:for\s+)?this\s+(?:week|month|quarter|sprint)\b/i,
]

/** Patterns indicating high-stakes outcome */
const HIGH_STAKES_PATTERNS = [
  /\b(?:client|customer|stakeholder|investor|board)\b/i,
  /\b(?:presentation|pitch|proposal|interview|meeting\s+with)\b/i,
  /\b(?:important|critical|crucial|essential|key)\b/i,
  /\b(?:enterprise|fortune\s+\d+|c-suite|executive)\b/i,
  // Strategic decisions — architecture/strategy choices have high downstream impact
  /\b(?:strategy|architecture)\b/i,
]

/** Pillars that often indicate higher stakes */
const HIGH_STAKES_PILLARS = ["Consulting"]

// ─── Person Name Detection ───────────────────────────────

/** Basic heuristic for capitalized names (not at sentence start) */
const PERSON_PATTERN = /(?:with|from|for|to|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/

// ─── Signal Detectors ────────────────────────────────────

function detectMultiStep(request: string): boolean {
  // Multiple sentences with action verbs
  const sentences = request.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length >= 3) return true

  return MULTI_STEP_PATTERNS.some((p) => p.test(request))
}

function detectAmbiguousGoal(request: string): boolean {
  const trimmed = request.trim()

  // Slash commands are explicit intent, never ambiguous
  if (/^\/\w+/.test(trimmed)) return false

  // Trivial messages (greetings, acknowledgments) aren't ambiguous — they're just short
  if (/^(?:hey|hi|hello|thanks|thank\s+you|ok|sure|got\s+it|yep|nope|yes|no)[!.?]*$/i.test(trimmed)) {
    return false
  }

  // Very short requests without clear action are ambiguous
  // But short noun phrases (notes, prep, list) are clear capture intent
  const words = trimmed.split(/\s+/)
  if (words.length <= 3 && !/\b(?:save|capture|log|check|health|research|draft|send|add|remove|delete|set|get|update|list|create|find|show|remind|schedule|prep|notes?|brief|review)\b/i.test(request)) {
    return true
  }

  return AMBIGUOUS_PATTERNS.some((p) => p.test(request))
}

function detectContextDependent(request: string, context: AssessmentContext): boolean {
  // Explicit contact reference
  if (context.hasContact) return true

  // Person name mentioned
  if (PERSON_PATTERN.test(request)) return true

  // References to prior interactions
  if ((context.priorInteractionCount ?? 0) > 2) return true

  return CONTEXT_PATTERNS.some((p) => p.test(request))
}

function detectTimeSensitive(request: string, context: AssessmentContext): boolean {
  if (context.hasDeadline) return true
  return TIME_PATTERNS.some((p) => p.test(request))
}

function detectHighStakes(request: string, context: AssessmentContext): boolean {
  if (context.pillar && HIGH_STAKES_PILLARS.includes(context.pillar)) return true
  return HIGH_STAKES_PATTERNS.some((p) => p.test(request))
}

function detectNovelPattern(request: string, capabilities: CapabilityMatch[]): boolean {
  const trimmed = request.trim()

  // Trivial messages (greetings, acknowledgments) aren't novel
  if (/^(?:hey|hi|hello|thanks|thank\s+you|ok|sure|got\s+it|yep|nope|yes|no)[!.?]*$/i.test(trimmed)) {
    return false
  }

  // Simple action requests aren't "novel" — they're just basic tasks
  // without a matching skill (e.g. "add milk" has no skill but isn't novel)
  if (/^\s*(?:add|remove|delete|check|set|get|list|update|send|log|save|capture|create|find|show|remind|schedule|cancel|mark|open|close|prep)\b/i.test(request)) {
    return false
  }

  // Short noun phrases (notes, briefs, lists) are clear capture intent
  if (/^\s*(?:\w+\s+){0,3}(?:notes?|brief|list|update|review|summary)\s*$/i.test(request)) {
    return false
  }

  // Question-form queries are lookups, not novel patterns
  if (/^\s*(?:what|when|where|who|how\s+(?:much|many|long|often))\b/i.test(request)) {
    return false
  }

  // If no capability matched with decent confidence, it's novel
  if (capabilities.length === 0) return true

  const bestConfidence = Math.max(...capabilities.map((c) => c.confidence))
  return bestConfidence < 0.5
}

// ─── Public API ──────────────────────────────────────────

/**
 * Detect all 6 complexity signals from the request.
 *
 * @param request - The user's request text
 * @param context - Assessment context
 * @param capabilities - Matched capabilities from self-model
 */
export function detectSignals(
  request: string,
  context: AssessmentContext,
  capabilities: CapabilityMatch[],
): ComplexitySignals {
  return {
    multiStep: detectMultiStep(request),
    ambiguousGoal: detectAmbiguousGoal(request),
    contextDependent: detectContextDependent(request, context),
    timeSensitive: detectTimeSensitive(request, context),
    highStakes: detectHighStakes(request, context),
    novelPattern: detectNovelPattern(request, capabilities),
  }
}

/**
 * Score complexity signals into a tier.
 *
 * 0 signals → simple
 * 1-2 signals → moderate
 * 3 signals → complex
 * 4+ signals → rough
 */
export function classifyComplexity(signals: ComplexitySignals): Complexity {
  const score = Object.values(signals).filter(Boolean).length

  if (score === 0) return "simple"
  if (score <= ASSESSMENT_DEFAULTS.thresholds.moderate) return "moderate"
  if (score <= ASSESSMENT_DEFAULTS.thresholds.complex) return "complex"
  return "rough"
}

/**
 * Count the number of active signals.
 */
export function countSignals(signals: ComplexitySignals): number {
  return Object.values(signals).filter(Boolean).length
}
