/**
 * Dialogue Module Tests — CONV-ARCH-003
 *
 * Validates terrain classification, thread surfacing, dialogue engine,
 * and the full collaborative exploration chain.
 *
 * Uses realistic scenarios from Jim's workflow to verify:
 *   - Terrain routing (clean/bumpy/rough)
 *   - Thread surfacing from knowledge, context, and inference
 *   - Multi-turn dialogue with response analysis
 *   - Max-turn best-guess proposal (ADR-008)
 *   - Ambiguity identification
 *
 * Sprint: CONV-ARCH-003 (Rough Terrain Dialogue)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  classifyTerrain,
  needsDialogue,
  assessmentNeedsDialogue,
  surfaceThreads,
  identifyAmbiguity,
  resetThreadCounter,
  enterDialogue,
  continueDialogue,
  isDialogueResolved,
  DIALOGUE_DEFAULTS,
} from "../src/dialogue"
import type {
  Terrain,
  Thread,
  DialogueState,
  DialogueResult,
} from "../src/dialogue"
import type {
  RequestAssessment,
  ComplexitySignals,
  AssessmentContext,
} from "../src/assessment"
import type { CapabilityModel, CapabilityMatch } from "../src/self-model"

// ─── Test Fixtures ──────────────────────────────────────

function makeSignals(overrides: Partial<ComplexitySignals> = {}): ComplexitySignals {
  return {
    ambiguousGoal: false,
    multiStep: false,
    contextDependent: false,
    novelPattern: false,
    timeSensitive: false,
    crossDomain: false,
    ...overrides,
  }
}

function makeAssessment(overrides: Partial<RequestAssessment> = {}): RequestAssessment {
  return {
    complexity: "simple",
    signals: makeSignals(),
    signalCount: 0,
    capabilities: [],
    approach: null,
    ...overrides,
  }
}

function makeContext(overrides: Partial<AssessmentContext> = {}): AssessmentContext {
  return {
    hasUrl: false,
    hasContact: false,
    hasDeadline: false,
    ...overrides,
  }
}

function makeModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  return {
    health: { healthy: 3, degraded: 0, offline: 0 },
    skills: [],
    mcpTools: [],
    knowledge: [
      {
        workspace: "grove-technical",
        available: true,
        documentCount: 45,
        domains: ["AI", "architecture", "agents"],
      },
      {
        workspace: "monarch",
        available: true,
        documentCount: 12,
        domains: ["consulting", "client"],
      },
    ],
    execution: [],
    integrations: [],
    surfaces: [],
    assembledAt: Date.now(),
    tokenBudget: 800,
    ...overrides,
  }
}

function makeCapabilities(caps: Partial<CapabilityMatch>[] = []): CapabilityMatch[] {
  return caps.map((c, i) => ({
    capabilityId: c.capabilityId ?? `cap-${i}`,
    layer: c.layer ?? "knowledge",
    confidence: c.confidence ?? 0.5,
    matchReason: c.matchReason ?? "test match",
    ...c,
  })) as CapabilityMatch[]
}

// ─── Terrain Classifier ─────────────────────────────────

describe("Terrain Classifier", () => {
  it("classifies simple requests as clean", () => {
    const assessment = makeAssessment({ complexity: "simple" })
    expect(classifyTerrain(assessment)).toBe("clean")
  })

  it("classifies moderate requests as clean", () => {
    const assessment = makeAssessment({ complexity: "moderate" })
    expect(classifyTerrain(assessment)).toBe("clean")
  })

  it("classifies rough requests as rough", () => {
    const assessment = makeAssessment({ complexity: "rough" })
    expect(classifyTerrain(assessment)).toBe("rough")
  })

  it("classifies complex + ambiguous + novel as rough", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: makeSignals({ ambiguousGoal: true, novelPattern: true }),
    })
    expect(classifyTerrain(assessment)).toBe("rough")
  })

  it("classifies complex without ambiguity as bumpy", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: makeSignals({ multiStep: true, contextDependent: true }),
    })
    expect(classifyTerrain(assessment)).toBe("bumpy")
  })

  it("needsDialogue returns true only for rough", () => {
    expect(needsDialogue("clean")).toBe(false)
    expect(needsDialogue("bumpy")).toBe(false)
    expect(needsDialogue("rough")).toBe(true)
  })

  it("assessmentNeedsDialogue is a convenience shortcut", () => {
    expect(assessmentNeedsDialogue(makeAssessment({ complexity: "simple" }))).toBe(false)
    expect(assessmentNeedsDialogue(makeAssessment({ complexity: "rough" }))).toBe(true)
  })
})

// ─── Thread Surfacer ────────────────────────────────────

describe("Thread Surfacer", () => {
  beforeEach(() => {
    resetThreadCounter()
  })

  it("surfaces knowledge threads from domain overlap", () => {
    const threads = surfaceThreads(
      "Research AI agent architecture patterns",
      makeContext(),
      makeSignals(),
      [],
      makeModel(),
    )

    const knowledgeThread = threads.find((t) => t.source === "knowledge")
    expect(knowledgeThread).toBeDefined()
    expect(knowledgeThread!.insight).toContain("grove-technical")
  })

  it("surfaces context threads from pillar", () => {
    const threads = surfaceThreads(
      "Something about consulting strategy",
      makeContext({ pillar: "Consulting" }),
      makeSignals(),
      [],
      makeModel(),
    )

    const contextThread = threads.find((t) => t.source === "context" && t.insight.includes("Consulting"))
    expect(contextThread).toBeDefined()
  })

  it("surfaces context threads from contact signals", () => {
    const threads = surfaceThreads(
      "Follow up with the client",
      makeContext({ hasContact: true }),
      makeSignals({ contextDependent: true }),
      [],
      makeModel(),
    )

    const contactThread = threads.find((t) => t.insight.includes("person/relationship"))
    expect(contactThread).toBeDefined()
  })

  it("surfaces context threads from deadline signals", () => {
    const threads = surfaceThreads(
      "Need this by Friday",
      makeContext({ hasDeadline: true }),
      makeSignals({ timeSensitive: true }),
      [],
      makeModel(),
    )

    const deadlineThread = threads.find((t) => t.insight.includes("Time pressure"))
    expect(deadlineThread).toBeDefined()
  })

  it("surfaces inference threads from cross-domain patterns", () => {
    const threads = surfaceThreads(
      "There's an intersection between the agent swarm work and the cost model",
      makeContext(),
      makeSignals(),
      [],
      makeModel(),
    )

    const inferenceThread = threads.find((t) => t.source === "inference")
    expect(inferenceThread).toBeDefined()
    expect(inferenceThread!.insight).toContain("cross-domain")
  })

  it("surfaces inference threads for multi-purpose intent", () => {
    const threads = surfaceThreads(
      "Write a blog post and also use it as a pitch deck for clients",
      makeContext(),
      makeSignals(),
      [],
      makeModel(),
    )

    const multiThread = threads.find((t) => t.source === "inference" && t.insight.includes("content + business"))
    expect(multiThread).toBeDefined()
  })

  it("respects maxThreads limit", () => {
    const threads = surfaceThreads(
      "Research AI agent architecture with consulting deadline and client URL",
      makeContext({ pillar: "Consulting", hasContact: true, hasDeadline: true, hasUrl: true }),
      makeSignals({ contextDependent: true, timeSensitive: true }),
      makeCapabilities([
        { capabilityId: "knowledge:grove-technical", layer: "knowledge", confidence: 0.8 },
        { capabilityId: "knowledge:monarch", layer: "knowledge", confidence: 0.6 },
      ]),
      makeModel(),
    )

    expect(threads.length).toBeLessThanOrEqual(DIALOGUE_DEFAULTS.maxThreads)
  })

  it("filters threads below relevance threshold", () => {
    const threads = surfaceThreads(
      "do something",
      makeContext(),
      makeSignals(),
      [],
      makeModel(),
    )

    threads.forEach((t) => {
      expect(t.relevance).toBeGreaterThanOrEqual(DIALOGUE_DEFAULTS.relevanceThreshold)
    })
  })

  it("sorts threads by relevance descending", () => {
    const threads = surfaceThreads(
      "Research AI architecture with client deadline and contact",
      makeContext({ pillar: "Consulting", hasContact: true, hasDeadline: true }),
      makeSignals({ contextDependent: true, timeSensitive: true }),
      [],
      makeModel(),
    )

    for (let i = 1; i < threads.length; i++) {
      expect(threads[i].relevance).toBeLessThanOrEqual(threads[i - 1].relevance)
    }
  })
})

// ─── Ambiguity Identification ───────────────────────────

describe("Ambiguity Identification", () => {
  beforeEach(() => {
    resetThreadCounter()
  })

  it("identifies missing output format", () => {
    const questions = identifyAmbiguity("help me with the agent swarm idea", [], makeContext())
    expect(questions.some((q) => q.includes("form"))).toBe(true)
  })

  it("does NOT flag output when format is explicit", () => {
    const questions = identifyAmbiguity("draft a blog post about agent swarms", [], makeContext())
    expect(questions.some((q) => q.includes("form"))).toBe(false)
  })

  it("identifies missing audience", () => {
    const questions = identifyAmbiguity("write something about AI pricing", [], makeContext())
    expect(questions.some((q) => q.includes("Who's this"))).toBe(true)
  })

  it("skips audience question when Consulting pillar is set", () => {
    const questions = identifyAmbiguity("write about pricing strategy", [], makeContext({ pillar: "Consulting" }))
    expect(questions.some((q) => q.includes("Who's this"))).toBe(false)
  })

  it("identifies missing depth clarity", () => {
    const questions = identifyAmbiguity("research AI agent costs", [], makeContext())
    expect(questions.some((q) => q.includes("deep"))).toBe(true)
  })

  it("skips depth question when explicitly stated", () => {
    const questions = identifyAmbiguity("do a quick research on AI pricing", [], makeContext())
    expect(questions.some((q) => q.includes("deep"))).toBe(false)
  })
})

// ─── Dialogue Engine ────────────────────────────────────

describe("Dialogue Engine", () => {
  let model: CapabilityModel

  beforeEach(() => {
    resetThreadCounter()
    model = makeModel()
  })

  it("enterDialogue returns initial state with turn 1", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true, novelPattern: true, crossDomain: true }),
      capabilities: [],
    })

    const result = enterDialogue(
      "There's something here about the intersection of agent swarms and our cost model but I haven't crystallized it",
      assessment,
      makeContext(),
      model,
    )

    expect(result.state.turnCount).toBe(1)
    expect(result.state.terrain).toBe("rough")
    expect(result.state.resolved).toBe(false)
    expect(result.needsResponse).toBe(true)
    expect(result.message.length).toBeGreaterThan(0)
  })

  it("enterDialogue surfaces threads in the message", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true }),
      capabilities: makeCapabilities([
        { capabilityId: "knowledge:grove-technical", layer: "knowledge", confidence: 0.7 },
      ]),
    })

    const result = enterDialogue(
      "Research AI architecture patterns and figure out the pricing angle",
      assessment,
      makeContext(),
      model,
    )

    // Should contain thread insights
    if (result.state.threads.length > 0) {
      expect(result.message).toContain("I see threads connecting:")
    }
  })

  it("continueDialogue updates context from response", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true }),
      capabilities: [],
    })

    const initial = enterDialogue(
      "Something about AI costs and business model",
      assessment,
      makeContext(),
      model,
    )

    const continued = continueDialogue(
      "I'm thinking a blog post for the public about how AI pricing is evolving",
      initial.state,
      model,
    )

    expect(continued.state.turnCount).toBe(2)
    expect(continued.state.resolvedContext.intent).toBe("blog")
  })

  it("resolves on affirmation", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true }),
      capabilities: [],
    })

    const initial = enterDialogue(
      "Help me figure out the agent architecture blog",
      assessment,
      makeContext(),
      model,
    )

    const resolved = continueDialogue(
      "Yes, go for it",
      initial.state,
      model,
    )

    expect(resolved.state.resolved).toBe(true)
    expect(resolved.proposal).toBeDefined()
    expect(resolved.refinedRequest).toBeDefined()
  })

  it("resolves when all questions are answered", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true }),
      capabilities: [],
    })

    const initial = enterDialogue(
      "Draft a blog post for the public about AI pricing — quick high-level overview",
      assessment,
      makeContext(),
      model,
    )

    // If request already has output, audience, and depth, openQuestions may be empty
    // In that case the first response should resolve quickly
    if (initial.state.openQuestions.length === 0) {
      const resolved = continueDialogue("sounds good", initial.state, model)
      expect(resolved.state.resolved).toBe(true)
    }
  })

  it("produces best-guess proposal at max turns (ADR-008)", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true, novelPattern: true }),
      capabilities: [],
    })

    // Start dialogue
    let result = enterDialogue(
      "There's something about agent swarms I can't quite put into words",
      assessment,
      makeContext(),
      model,
    )

    // Simulate turns up to maxTurns without resolving
    for (let turn = 2; turn <= DIALOGUE_DEFAULTS.maxTurns; turn++) {
      result = continueDialogue(
        "Hmm, I'm not sure yet. Let me think about it more.",
        result.state,
        model,
      )
    }

    // Should have resolved with a best-guess proposal
    expect(result.state.resolved).toBe(true)
    expect(result.proposal).toBeDefined()
    expect(result.proposal!.steps.length).toBeGreaterThan(0)
    expect(result.proposal!.questionForJim).toBeDefined()
    expect(result.message).toContain("best read")
  })

  it("accumulates keywords across turns", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true }),
      capabilities: [],
    })

    const initial = enterDialogue(
      "Something about pricing",
      assessment,
      makeContext(),
      model,
    )

    const turn2 = continueDialogue(
      "Specifically around agent infrastructure costs",
      initial.state,
      model,
    )

    expect(turn2.state.resolvedContext.keywords).toBeDefined()
    expect(turn2.state.resolvedContext.keywords!.length).toBeGreaterThan(0)
  })

  it("adds inference threads from refinements", () => {
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({ ambiguousGoal: true, novelPattern: true }),
      capabilities: [],
    })

    const initial = enterDialogue(
      "Something about the intersection between agent swarms and the cost model",
      assessment,
      makeContext(),
      model,
    )

    const continued = continueDialogue(
      "Not a blog, but however I want it to be more like a strategy memo",
      initial.state,
      model,
    )

    // Should accumulate threads
    expect(continued.state.threads.length).toBeGreaterThanOrEqual(initial.state.threads.length)
  })

  it("isDialogueResolved reflects state", () => {
    const unresolved: DialogueState = {
      terrain: "rough",
      turnCount: 1,
      threads: [],
      resolvedContext: {},
      openQuestions: ["What form?"],
      currentQuestion: "What form?",
      resolved: false,
    }

    const resolved: DialogueState = { ...unresolved, resolved: true }

    expect(isDialogueResolved(unresolved)).toBe(false)
    expect(isDialogueResolved(resolved)).toBe(true)
  })
})

// ─── Full Chain (Constraint 6) ──────────────────────────

describe("Full Dialogue Chain", () => {
  beforeEach(() => {
    resetThreadCounter()
  })

  it("terrain classification → enter → continue → resolve", () => {
    const model = makeModel()

    // Step 1: Classify terrain
    const assessment = makeAssessment({
      complexity: "rough",
      signals: makeSignals({
        ambiguousGoal: true,
        novelPattern: true,
        crossDomain: true,
        multiStep: true,
        contextDependent: true,
      }),
      signalCount: 5,
      capabilities: makeCapabilities([
        { capabilityId: "knowledge:grove-technical", layer: "knowledge", confidence: 0.8, matchReason: "AI domain match" },
      ]),
    })

    const terrain = classifyTerrain(assessment)
    expect(terrain).toBe("rough")
    expect(needsDialogue(terrain)).toBe(true)

    // Step 2: Enter dialogue
    const entry = enterDialogue(
      "I've been thinking about the overlap between our agent swarm architecture and how we price AI consulting — there's something here but I can't crystallize it yet",
      assessment,
      makeContext({ pillar: "The Grove" }),
      model,
    )

    expect(entry.state.turnCount).toBe(1)
    expect(entry.state.threads.length).toBeGreaterThan(0)
    expect(entry.needsResponse).toBe(true)

    // Step 3: Jim clarifies intent
    const turn2 = continueDialogue(
      "I think it's a blog post — about how agent infrastructure costs map to consulting value",
      entry.state,
      model,
    )

    expect(turn2.state.turnCount).toBe(2)
    expect(turn2.state.resolvedContext.intent).toBe("blog")

    // Step 4: Jim confirms
    const turn3 = continueDialogue(
      "Yeah, let's go with that. A deep dive blog post.",
      turn2.state,
      model,
    )

    expect(turn3.state.resolved).toBe(true)
    expect(turn3.proposal).toBeDefined()
    expect(turn3.refinedRequest).toBeDefined()
    expect(turn3.proposal!.steps.length).toBeGreaterThan(0)
  })

  it("bumpy terrain does NOT enter dialogue", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: makeSignals({ multiStep: true, contextDependent: true }),
    })

    const terrain = classifyTerrain(assessment)
    expect(terrain).toBe("bumpy")
    expect(needsDialogue(terrain)).toBe(false)
  })
})
