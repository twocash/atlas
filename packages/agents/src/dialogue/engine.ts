/**
 * Dialogue Engine — Collaborative exploration for rough terrain.
 *
 * When a request has too many unknowns for a linear plan, the
 * DialogueEngine helps Atlas and Jim figure it out together.
 *
 * Key behavior:
 *   - Atlas contributes OBSERVATIONS (threads), not just questions
 *   - Open-ended framing, not multiple choice
 *   - Maximum 4 turns before best-guess proposal
 *   - Resolves to executable request + approach proposal
 *
 * Architecture constraint: "Dialogue is collaborative exploration,
 * not interrogation." (Manifesto Part III Layer 2, ADR-002)
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 */

import type { CapabilityModel, CapabilityMatch } from "../self-model/types"
import type { RequestAssessment, AssessmentContext, ApproachProposal, ApproachStep } from "../assessment/types"
import type { DialogueState, DialogueResult, Thread } from "./types"
import { DIALOGUE_DEFAULTS } from "./types"
import { surfaceThreads, identifyAmbiguity, resetThreadCounter } from "./thread-surfacer"

// ─── Message Composition ────────────────────────────────

/**
 * Compose the exploration message for Jim.
 *
 * Format: threads as numbered observations, then an open-ended
 * framing question. NOT a menu of choices.
 */
function composeExplorationMessage(
  threads: Thread[],
  openQuestions: string[],
  turnCount: number,
): { message: string; question: string } {
  const parts: string[] = []

  // First turn: surface what Atlas sees
  if (turnCount === 1 && threads.length > 0) {
    parts.push("I see threads connecting:")
    threads.forEach((t, i) => {
      parts.push(`  (${i + 1}) ${t.insight}`)
    })
    parts.push("")
  }

  // Frame the open question based on what's ambiguous
  let question: string
  if (openQuestions.length >= 3) {
    // Very ambiguous — ask about purpose/framing
    question = "Are we exploring for a specific output, or still shaping the idea?"
  } else if (openQuestions.length === 2) {
    // Somewhat ambiguous — narrow the angle
    question = `${openQuestions[0]} And ${openQuestions[1].toLowerCase()}`
  } else if (openQuestions.length === 1) {
    question = openQuestions[0]
  } else {
    question = "What angle feels right?"
  }

  parts.push(question)

  return {
    message: parts.join("\n"),
    question,
  }
}

/**
 * Compose a follow-up message for subsequent turns.
 */
function composeFollowUpMessage(
  newThreads: Thread[],
  openQuestions: string[],
  turnCount: number,
): { message: string; question: string } {
  const parts: string[] = []

  if (newThreads.length > 0) {
    parts.push("Building on that:")
    newThreads.forEach((t, i) => {
      parts.push(`  - ${t.insight}`)
    })
    parts.push("")
  }

  let question: string
  if (openQuestions.length > 0) {
    question = openQuestions[0]
  } else {
    question = "I think I have enough to propose an approach. Want me to go?"
  }

  parts.push(question)

  return {
    message: parts.join("\n"),
    question,
  }
}

// ─── Response Analysis ──────────────────────────────────

/** Patterns indicating the response clarifies output format */
const OUTPUT_PATTERNS = [
  { pattern: /\b(?:blog|article|post|piece|thinkpiece)\b/i, value: "blog" },
  { pattern: /\b(?:doc|document|report|paper|brief)\b/i, value: "document" },
  { pattern: /\b(?:email|message|note)\b/i, value: "email" },
  { pattern: /\b(?:pitch|deck|presentation|slides)\b/i, value: "pitch" },
  { pattern: /\b(?:research|analysis|deep\s*dive)\b/i, value: "research" },
]

/** Patterns indicating audience */
const AUDIENCE_PATTERNS = [
  { pattern: /\b(?:client|customer|prospect)\b/i, value: "client" },
  { pattern: /\b(?:team|internal|us)\b/i, value: "internal" },
  { pattern: /\b(?:public|everyone|community)\b/i, value: "public" },
]

/** Patterns indicating affirmation / readiness to proceed */
const AFFIRMATION_PATTERNS = [
  /^(?:yes|yeah|yep|go|do\s+it|sounds?\s+good|exactly|perfect|that'?s?\s+(?:it|right))\b/i,
  /\bgo\s+(?:ahead|for\s+it)\b/i,
  /\blet'?s?\s+(?:go|do|roll)\b/i,
]

/**
 * Analyze Jim's response to extract context updates.
 */
function analyzeResponse(response: string): {
  outputType?: string
  audience?: string
  keywords: string[]
  isAffirmation: boolean
  refinements: string[]
} {
  const outputMatch = OUTPUT_PATTERNS.find((p) => p.pattern.test(response))
  const audienceMatch = AUDIENCE_PATTERNS.find((p) => p.pattern.test(response))
  const isAffirmation = AFFIRMATION_PATTERNS.some((p) => p.test(response))

  // Extract meaningful keywords (3+ letter words, not stopwords)
  const stopwords = new Set(["the", "and", "but", "for", "with", "that", "this", "from", "also", "just", "like", "about", "into", "more", "some"])
  const keywords = response
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopwords.has(w))

  // Extract refinement clauses (things Jim is narrowing)
  const refinements: string[] = []
  const butMatch = response.match(/\b(?:but|however|though|except)\s+(.+?)(?:\.|$)/i)
  if (butMatch) refinements.push(butMatch[1].trim())
  const alsoMatch = response.match(/\b(?:also|plus|and\s+also)\s+(.+?)(?:\.|$)/i)
  if (alsoMatch) refinements.push(alsoMatch[1].trim())

  return {
    outputType: outputMatch?.value,
    audience: audienceMatch?.value,
    keywords,
    isAffirmation,
    refinements,
  }
}

// ─── Best-Guess Proposal ────────────────────────────────

/**
 * Build a best-guess proposal when dialogue hits max turns.
 *
 * Uses whatever context has been accumulated to propose
 * the most reasonable approach. ADR-008: don't spin forever.
 */
function buildBestGuessProposal(
  originalRequest: string,
  state: DialogueState,
): ApproachProposal {
  const steps: ApproachStep[] = []

  // Step 1: Research based on whatever we know
  const knowledgeThreads = state.threads.filter((t) => t.source === "knowledge")
  if (knowledgeThreads.length > 0) {
    steps.push({
      description: `Research using ${knowledgeThreads.map((t) => t.capability || "available sources").join(", ")}`,
      estimatedSeconds: 120,
    })
  } else {
    steps.push({
      description: "Research the core topic with available sources",
      estimatedSeconds: 120,
    })
  }

  // Step 2: Draft based on inferred output type
  const intent = state.resolvedContext.intent
  if (intent) {
    steps.push({
      description: `Draft ${intent} based on findings`,
      estimatedSeconds: 180,
    })
  } else {
    steps.push({
      description: "Draft initial synthesis for your review",
      estimatedSeconds: 180,
    })
  }

  // Step 3: If there's a pillar, frame accordingly
  if (state.resolvedContext.pillar) {
    steps.push({
      description: `Frame for ${state.resolvedContext.pillar} positioning`,
      estimatedSeconds: 60,
    })
  }

  return {
    steps,
    timeEstimate: `~${Math.ceil(steps.reduce((s, step) => s + (step.estimatedSeconds ?? 60), 0) / 60)} minutes`,
    alternativeAngles: [
      "Start narrower and expand",
      "Start with the clearest piece and iterate",
    ],
    questionForJim: "This is my best read on the approach. Adjust or go?",
  }
}

// ─── Public API ─────────────────────────────────────────

/**
 * Enter dialogue mode for a rough-terrain request.
 *
 * This is the first turn. Atlas surfaces what it sees
 * and asks an open-ended framing question.
 *
 * @param request - The original request text
 * @param assessment - The request assessment from Sprint 2
 * @param context - Assessment context
 * @param model - Capability model from Sprint 1
 */
export function enterDialogue(
  request: string,
  assessment: RequestAssessment,
  context: AssessmentContext,
  model: CapabilityModel,
): DialogueResult {
  // Surface threads from all sources
  const threads = surfaceThreads(
    request,
    context,
    assessment.signals,
    assessment.capabilities,
    model,
  )

  // Identify what's still ambiguous
  const openQuestions = identifyAmbiguity(request, threads, context)

  // Compose the exploration message
  const { message, question } = composeExplorationMessage(threads, openQuestions, 1)

  const state: DialogueState = {
    terrain: "rough",
    turnCount: 1,
    threads,
    resolvedContext: { ...context },
    openQuestions,
    currentQuestion: question,
    resolved: false,
  }

  return {
    state,
    needsResponse: true,
    message,
  }
}

/**
 * Continue dialogue with Jim's response.
 *
 * Updates state based on what Jim said. Either:
 *   - Continues exploring (needsResponse: true)
 *   - Resolves to a proposal (needsResponse: false)
 *
 * ADR-008: After maxTurns, produces a best-guess proposal
 * rather than spinning indefinitely.
 *
 * @param response - Jim's response text
 * @param state - Current dialogue state
 * @param model - Capability model
 */
export function continueDialogue(
  response: string,
  state: DialogueState,
  model: CapabilityModel,
): DialogueResult {
  const newTurn = state.turnCount + 1
  const analysis = analyzeResponse(response)

  // Update resolved context from Jim's response
  const updatedContext = { ...state.resolvedContext }
  if (analysis.outputType) {
    updatedContext.intent = analysis.outputType
  }
  if (analysis.keywords.length > 0) {
    updatedContext.keywords = [
      ...(updatedContext.keywords ?? []),
      ...analysis.keywords,
    ]
  }

  // Remove answered questions from openQuestions
  let remainingQuestions = [...state.openQuestions]
  if (analysis.outputType) {
    remainingQuestions = remainingQuestions.filter((q) => !q.includes("form") && !q.includes("output"))
  }
  if (analysis.audience) {
    remainingQuestions = remainingQuestions.filter((q) => !q.includes("for"))
  }

  // Check if dialogue should resolve
  const shouldResolve =
    analysis.isAffirmation ||
    newTurn >= DIALOGUE_DEFAULTS.maxTurns ||
    remainingQuestions.length === 0

  if (shouldResolve) {
    const proposal = buildBestGuessProposal(response, {
      ...state,
      turnCount: newTurn,
      resolvedContext: updatedContext,
    })

    // Build refined request from accumulated context
    const refinedParts = [response]
    if (analysis.refinements.length > 0) {
      refinedParts.push(...analysis.refinements)
    }

    const resolvedState: DialogueState = {
      ...state,
      turnCount: newTurn,
      resolvedContext: updatedContext,
      openQuestions: remainingQuestions,
      currentQuestion: "",
      resolved: true,
    }

    const isMaxTurn = newTurn >= DIALOGUE_DEFAULTS.maxTurns && !analysis.isAffirmation
    const message = isMaxTurn
      ? `Got it. After ${newTurn} turns, here's my best read:\n\n${proposal.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}\n\n${proposal.timeEstimate}. ${proposal.questionForJim}`
      : `Got it — ${updatedContext.intent || "moving forward"}. ${proposal.steps.map((s, i) => `${i + 1}. ${s.description}`).join(". ")}. ${proposal.timeEstimate}.`

    return {
      state: resolvedState,
      needsResponse: isMaxTurn, // Max-turn proposals still ask for confirmation
      proposal,
      refinedRequest: refinedParts.join(". "),
      message,
    }
  }

  // Continue dialogue: surface new threads based on response
  const inferenceThreads: Thread[] = []
  if (analysis.refinements.length > 0) {
    inferenceThreads.push({
      id: `thread-followup-${newTurn}`,
      insight: `Narrowing: ${analysis.refinements[0]}`,
      source: "inference",
      relevance: 0.7,
    })
  }

  const allThreads = [...state.threads, ...inferenceThreads]
  const { message, question } = composeFollowUpMessage(inferenceThreads, remainingQuestions, newTurn)

  const updatedState: DialogueState = {
    ...state,
    turnCount: newTurn,
    threads: allThreads,
    resolvedContext: updatedContext,
    openQuestions: remainingQuestions,
    currentQuestion: question,
    resolved: false,
  }

  return {
    state: updatedState,
    needsResponse: true,
    message,
  }
}

/**
 * Check if a dialogue state has resolved.
 */
export function isDialogueResolved(state: DialogueState): boolean {
  return state.resolved
}
