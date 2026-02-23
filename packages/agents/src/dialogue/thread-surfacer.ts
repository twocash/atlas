/**
 * Thread Surfacer — Extracts observations from Atlas's knowledge.
 *
 * Threads are things Atlas NOTICES, not questions it asks.
 * "I see your agent swarm work connecting to the cost model"
 * not "What do you want to do?"
 *
 * Three thread sources:
 *   knowledge — from RAG/POV/knowledge layers in the self-model
 *   context   — from the assessment context (pillar, contacts, deadlines)
 *   inference — from pattern-matching the request text
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 */

import type { CapabilityModel, CapabilityMatch } from "../self-model/types"
import type { AssessmentContext, ComplexitySignals } from "../assessment/types"
import type { Thread, ThreadSource } from "./types"
import { DIALOGUE_DEFAULTS } from "./types"

// ─── Thread ID Generation ───────────────────────────────

let threadCounter = 0

function nextThreadId(): string {
  return `thread-${++threadCounter}`
}

/** Reset counter (for testing) */
export function resetThreadCounter(): void {
  threadCounter = 0
}

// ─── Knowledge Threads ──────────────────────────────────

/**
 * Surface threads from Atlas's knowledge layers.
 *
 * Looks at what knowledge sources are available and how they
 * connect to the request's domain. Doesn't query the actual
 * RAG system — that happens at the surface layer.
 */
function surfaceKnowledgeThreads(
  request: string,
  capabilities: CapabilityMatch[],
  model: CapabilityModel,
): Thread[] {
  const threads: Thread[] = []
  const requestLower = request.toLowerCase()

  // Check knowledge sources for domain overlap
  for (const ks of model.knowledge) {
    if (!ks.available) continue

    const domainOverlap = ks.domains.filter((d) =>
      requestLower.includes(d.toLowerCase()),
    )

    if (domainOverlap.length > 0) {
      threads.push({
        id: nextThreadId(),
        insight: `${ks.workspace} has ${ks.documentCount} docs covering ${domainOverlap.join(", ")}`,
        source: "knowledge",
        relevance: Math.min(0.5 + domainOverlap.length * 0.15, 0.95),
        capability: `knowledge:${ks.workspace}`,
      })
    }
  }

  // Check matched capabilities for knowledge-layer items
  for (const cap of capabilities) {
    if (cap.layer === "knowledge" && cap.confidence > 0.3) {
      // Avoid duplicating workspace threads already surfaced
      if (!threads.some((t) => t.capability?.includes(cap.capabilityId))) {
        threads.push({
          id: nextThreadId(),
          insight: `${cap.capabilityId} is relevant (${cap.matchReason})`,
          source: "knowledge",
          relevance: cap.confidence,
          capability: cap.capabilityId,
        })
      }
    }
  }

  return threads
}

// ─── Context Threads ────────────────────────────────────

/**
 * Surface threads from the assessment context.
 *
 * These are observations about WHAT Atlas already knows about
 * the request from the context signals.
 */
function surfaceContextThreads(
  context: AssessmentContext,
  signals: ComplexitySignals,
): Thread[] {
  const threads: Thread[] = []

  // Pillar gives us domain framing
  if (context.pillar) {
    threads.push({
      id: nextThreadId(),
      insight: `This touches ${context.pillar} — framing and voice should match`,
      source: "context",
      relevance: 0.6,
    })
  }

  // Contact reference means relationship context matters
  if (context.hasContact || signals.contextDependent) {
    threads.push({
      id: nextThreadId(),
      insight: "There's a person/relationship angle here that needs context",
      source: "context",
      relevance: 0.7,
    })
  }

  // Deadline creates framing constraint
  if (context.hasDeadline || signals.timeSensitive) {
    threads.push({
      id: nextThreadId(),
      insight: "Time pressure means we should scope down to what's achievable",
      source: "context",
      relevance: 0.65,
    })
  }

  // URL context
  if (context.hasUrl) {
    threads.push({
      id: nextThreadId(),
      insight: "There's shared content that could anchor the exploration",
      source: "context",
      relevance: 0.5,
    })
  }

  return threads
}

// ─── Inference Threads ──────────────────────────────────

/** Patterns that suggest cross-domain thinking */
const INTERSECTION_PATTERNS = [
  { pattern: /\b(?:intersection|overlap|connection|bridge)\b.*\b(?:and|between|with)\b/i, label: "cross-domain connection" },
  { pattern: /\b(?:but|however|although)\b.*\b(?:haven't|not\s+sure|unclear)\b/i, label: "unresolved tension" },
  { pattern: /\b(?:something\s+(?:here|about|like))\b/i, label: "emerging intuition" },
  { pattern: /\b(?:crystallize|formulate|articulate|figure\s+out)\b/i, label: "idea still forming" },
]

/** Patterns that suggest multi-purpose intent */
const MULTI_PURPOSE_PATTERNS = [
  { pattern: /\b(?:both|dual|also\s+(?:works?|serves?|informs?))\b/i, label: "dual-purpose" },
  { pattern: /\b(?:blog|article|post)\b.*\b(?:and|but|also)\b.*\b(?:pitch|client|deck)\b/i, label: "content + business" },
  { pattern: /\b(?:research|explore)\b.*\b(?:and|then|plus)\b.*\b(?:draft|write|create)\b/i, label: "explore then produce" },
]

/**
 * Surface threads from pattern inference on the request itself.
 *
 * These are observations about the REQUEST's shape — what kind
 * of thinking it represents.
 */
function surfaceInferenceThreads(request: string): Thread[] {
  const threads: Thread[] = []

  // Check for intersection/cross-domain patterns
  for (const { pattern, label } of INTERSECTION_PATTERNS) {
    if (pattern.test(request)) {
      threads.push({
        id: nextThreadId(),
        insight: `This looks like a ${label} — the thinking isn't linear yet`,
        source: "inference",
        relevance: 0.55,
      })
      break // One inference thread per category
    }
  }

  // Check for multi-purpose patterns
  for (const { pattern, label } of MULTI_PURPOSE_PATTERNS) {
    if (pattern.test(request)) {
      threads.push({
        id: nextThreadId(),
        insight: `Detecting ${label} intent — output needs to serve multiple goals`,
        source: "inference",
        relevance: 0.6,
      })
      break
    }
  }

  // If request is long and complex but none of the above matched
  const words = request.trim().split(/\s+/)
  if (words.length > 20 && threads.length === 0) {
    threads.push({
      id: nextThreadId(),
      insight: "This is a complex thought — let me help decompose it",
      source: "inference",
      relevance: 0.4,
    })
  }

  return threads
}

// ─── Public API ─────────────────────────────────────────

/**
 * Surface all threads for a rough-terrain request.
 *
 * Combines knowledge, context, and inference threads,
 * sorted by relevance. Filters below threshold and caps
 * at maxThreads.
 */
export function surfaceThreads(
  request: string,
  context: AssessmentContext,
  signals: ComplexitySignals,
  capabilities: CapabilityMatch[],
  model: CapabilityModel,
): Thread[] {
  const knowledge = surfaceKnowledgeThreads(request, capabilities, model)
  const contextThreads = surfaceContextThreads(context, signals)
  const inference = surfaceInferenceThreads(request)

  const all = [...knowledge, ...contextThreads, ...inference]

  // Sort by relevance, filter below threshold, cap
  return all
    .filter((t) => t.relevance >= DIALOGUE_DEFAULTS.relevanceThreshold)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, DIALOGUE_DEFAULTS.maxThreads)
}

/**
 * Identify what's still ambiguous given the threads surfaced.
 *
 * Open questions are framed as observations, not interrogations.
 */
export function identifyAmbiguity(
  request: string,
  threads: Thread[],
  context: AssessmentContext,
): string[] {
  const questions: string[] = []

  // What's the output format/purpose?
  const hasOutputClarity = /\b(?:blog|article|doc|email|deck|report|draft)\b/i.test(request)
  if (!hasOutputClarity) {
    questions.push("What form should the output take?")
  }

  // Who's the audience?
  const hasAudienceClarity = /\b(?:for\s+(?:the|my|our)|audience|reader)\b/i.test(request) || context.pillar === "Consulting"
  if (!hasAudienceClarity) {
    questions.push("Who's this for?")
  }

  // What's the scope/depth?
  const hasDepthClarity = /\b(?:quick|deep|comprehensive|brief|high-?level|detailed)\b/i.test(request)
  if (!hasDepthClarity) {
    questions.push("How deep should we go?")
  }

  // If we have knowledge threads, the domain is clear; otherwise ask
  const hasKnowledgeThreads = threads.some((t) => t.source === "knowledge")
  if (!hasKnowledgeThreads && !context.keywords?.length) {
    questions.push("What domain are we exploring?")
  }

  return questions
}
