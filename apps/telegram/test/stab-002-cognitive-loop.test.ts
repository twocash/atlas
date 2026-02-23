/**
 * STAB-002 Unit Tests — Cognitive Loop Activation
 *
 * Tests for:
 *   1. Dialogue session store (CRUD, TTL, cleanup)
 *   2. Assessment prompt injection (system prompt augmentation)
 *   3. Dialogue entry/continuation routing logic
 *
 * Sprint: STAB-002 (Activate the Cognitive Loop)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Dialogue session store
import {
  storeDialogueSession,
  getDialogueSession,
  getDialogueSessionByUserId,
  hasDialogueSessionForUser,
  removeDialogueSession,
  getDialogueSessionCount,
  clearAllDialogueSessions,
  type PendingDialogueSession,
} from "../src/conversation/dialogue-session"

// Dialogue engine + terrain classifier
import {
  assessmentNeedsDialogue,
  enterDialogue,
  continueDialogue,
  resetThreadCounter,
} from "../../../packages/agents/src/dialogue"

// Assessment + self-model
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
  type CapabilityDataProvider,
} from "../../../packages/agents/src/self-model"
import {
  assessRequest,
  type AssessmentContext,
} from "../../../packages/agents/src/assessment"
import type { RequestAssessment, ComplexitySignals } from "../../../packages/agents/src/assessment/types"
import type { DialogueState } from "../../../packages/agents/src/dialogue/types"

// ─── Test Helpers ────────────────────────────────────────

function createMockProvider(): CapabilityDataProvider {
  return {
    getSkills: async () => [
      {
        name: "health-check",
        description: "Validate system state",
        triggers: [{ type: "phrase", value: "/health" }],
        enabled: true,
      },
    ],
    getMCPServers: async () => [
      {
        serverId: "notion",
        status: "connected",
        toolCount: 2,
        toolNames: ["create_page", "search"],
      },
    ],
    getKnowledgeSources: async () => [
      {
        source: "anythingllm" as const,
        workspace: "grove-vision",
        documentCount: 50,
        domains: ["AI"],
        available: true,
      },
    ],
    getIntegrationHealth: async () => [
      {
        service: "notion",
        capabilities: ["feed", "work-queue"],
        status: "ok" as const,
        message: "Configured",
      },
    ],
    getSurfaces: async () => [
      {
        surface: "telegram" as const,
        available: true,
        features: ["conversation"],
      },
    ],
    getFeatureFlags: () => ({ ATLAS_SELF_MODEL: true }),
  }
}

function makeAssessment(overrides: Partial<RequestAssessment> = {}): RequestAssessment {
  return {
    complexity: "simple",
    approach: null,
    capabilities: [],
    reasoning: "Simple request",
    signals: {
      multiStep: false,
      ambiguousGoal: false,
      contextDependent: false,
      timeSensitive: false,
      highStakes: false,
      novelPattern: false,
    },
    ...overrides,
  }
}

function makeRoughAssessment(): RequestAssessment {
  return makeAssessment({
    complexity: "rough",
    reasoning: "Multiple unknowns, ambiguous goal, novel pattern",
    signals: {
      multiStep: true,
      ambiguousGoal: true,
      contextDependent: true,
      timeSensitive: false,
      highStakes: true,
      novelPattern: true,
    },
    approach: {
      steps: [
        { description: "Research the topic", estimatedSeconds: 120 },
        { description: "Draft synthesis", estimatedSeconds: 180 },
      ],
      timeEstimate: "~5 minutes",
      alternativeAngles: ["Start narrow"],
      questionForJim: "What angle feels right?",
    },
  })
}

function makeDialogueSession(overrides: Partial<PendingDialogueSession> = {}): PendingDialogueSession {
  return {
    chatId: 12345,
    userId: 67890,
    questionMessageId: 111,
    dialogueState: {
      terrain: "rough",
      turnCount: 1,
      threads: [
        { id: "t1", insight: "Content strategy spans multiple channels", source: "inference", relevance: 0.8 },
      ],
      resolvedContext: { intent: "research", pillar: "The Grove" },
      openQuestions: ["What form should this take?"],
      currentQuestion: "What angle feels right?",
      resolved: false,
    },
    assessment: makeRoughAssessment(),
    assessmentContext: {
      intent: "research",
      pillar: "The Grove",
      keywords: ["content", "strategy"],
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    },
    originalMessage: "I need to rethink our content strategy for Q3",
    createdAt: Date.now(),
    ...overrides,
  }
}

// ─── Dialogue Session Store ──────────────────────────────

describe("STAB-002: Dialogue session store", () => {
  beforeEach(() => {
    clearAllDialogueSessions()
  })

  it("stores and retrieves session by chatId", () => {
    const session = makeDialogueSession()
    storeDialogueSession(session)

    const retrieved = getDialogueSession(12345)
    expect(retrieved).toBeDefined()
    expect(retrieved!.chatId).toBe(12345)
    expect(retrieved!.userId).toBe(67890)
    expect(retrieved!.dialogueState.terrain).toBe("rough")
  })

  it("retrieves session by userId", () => {
    const session = makeDialogueSession()
    storeDialogueSession(session)

    const retrieved = getDialogueSessionByUserId(67890)
    expect(retrieved).toBeDefined()
    expect(retrieved!.chatId).toBe(12345)
  })

  it("hasDialogueSessionForUser returns true when session exists", () => {
    storeDialogueSession(makeDialogueSession())
    expect(hasDialogueSessionForUser(67890)).toBe(true)
    expect(hasDialogueSessionForUser(99999)).toBe(false)
  })

  it("removes session by chatId", () => {
    storeDialogueSession(makeDialogueSession())
    expect(hasDialogueSessionForUser(67890)).toBe(true)

    removeDialogueSession(12345)
    expect(hasDialogueSessionForUser(67890)).toBe(false)
  })

  it("expires sessions after TTL", () => {
    const session = makeDialogueSession({
      createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago (> 10 min TTL)
    })
    storeDialogueSession(session)

    // TTL check happens on retrieval
    expect(getDialogueSession(12345)).toBeUndefined()
    expect(hasDialogueSessionForUser(67890)).toBe(false)
  })

  it("latest session wins for same chatId", () => {
    storeDialogueSession(makeDialogueSession({ originalMessage: "first" }))
    storeDialogueSession(makeDialogueSession({ originalMessage: "second" }))

    const retrieved = getDialogueSession(12345)
    expect(retrieved!.originalMessage).toBe("second")
  })

  it("getDialogueSessionCount cleans expired and returns correct count", () => {
    storeDialogueSession(makeDialogueSession({ chatId: 1, userId: 1 }))
    storeDialogueSession(makeDialogueSession({
      chatId: 2,
      userId: 2,
      createdAt: Date.now() - 11 * 60 * 1000, // expired
    }))
    storeDialogueSession(makeDialogueSession({ chatId: 3, userId: 3 }))

    expect(getDialogueSessionCount()).toBe(2) // expired one cleaned
  })
})

// ─── Assessment Prompt Injection ─────────────────────────

describe("STAB-002: Assessment prompt injection", () => {
  it("simple assessment produces minimal injection", () => {
    const assessment = makeAssessment({ complexity: "simple", reasoning: "Quick task" })

    // Simulate the injection logic from handler.ts
    const lines = [
      `\n\n---\n\n## Request Assessment`,
      ``,
      `**Complexity:** ${assessment.complexity}`,
      `**Reasoning:** ${assessment.reasoning}`,
    ]

    if (assessment.approach) {
      lines.push(``, `**Proposed Approach:**`)
    }

    const result = lines.join("\n")
    expect(result).toContain("## Request Assessment")
    expect(result).toContain("**Complexity:** simple")
    expect(result).toContain("**Reasoning:** Quick task")
    expect(result).not.toContain("Proposed Approach")
  })

  it("complex assessment includes approach steps", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      reasoning: "Multi-step with deadline",
      approach: {
        steps: [
          { description: "Research competitors", estimatedSeconds: 120 },
          { description: "Draft analysis", estimatedSeconds: 180 },
        ],
        timeEstimate: "~5 minutes",
        alternativeAngles: [],
        questionForJim: "Should I focus on pricing or features?",
      },
    })

    const lines = [
      `\n\n---\n\n## Request Assessment`,
      ``,
      `**Complexity:** ${assessment.complexity}`,
      `**Reasoning:** ${assessment.reasoning}`,
    ]

    if (assessment.approach) {
      lines.push(
        ``,
        `**Proposed Approach:**`,
        ...assessment.approach.steps.map((s, i) => `${i + 1}. ${s.description}`),
      )
      if (assessment.approach.timeEstimate) {
        lines.push(`**Estimated Time:** ${assessment.approach.timeEstimate}`)
      }
      if (assessment.approach.questionForJim) {
        lines.push(``, `**Before proceeding, ask Jim:** ${assessment.approach.questionForJim}`)
      }
    }

    const result = lines.join("\n")
    expect(result).toContain("**Complexity:** complex")
    expect(result).toContain("1. Research competitors")
    expect(result).toContain("2. Draft analysis")
    expect(result).toContain("**Estimated Time:** ~5 minutes")
    expect(result).toContain("**Before proceeding, ask Jim:** Should I focus on pricing or features?")
  })

  it("assessment with capabilities surfaces them", () => {
    const assessment = makeAssessment({
      capabilities: [
        { capabilityId: "notion-search", layer: "integration", confidence: 0.9, matchReason: "Database query", alternatives: [] },
        { capabilityId: "research-agent", layer: "skill", confidence: 0.8, matchReason: "Research task", alternatives: [] },
      ],
    })

    const lines: string[] = []
    if (assessment.capabilities.length > 0) {
      lines.push(
        ``,
        `**Relevant Capabilities:** ${assessment.capabilities.map(c => c.capabilityId).join(', ')}`,
      )
    }

    const result = lines.join("\n")
    expect(result).toContain("**Relevant Capabilities:** notion-search, research-agent")
  })
})

// ─── Terrain Classification & Dialogue Routing ───────────

describe("STAB-002: Terrain classification routing", () => {
  it("simple assessment does not need dialogue", () => {
    const assessment = makeAssessment({ complexity: "simple" })
    expect(assessmentNeedsDialogue(assessment)).toBe(false)
  })

  it("moderate assessment does not need dialogue", () => {
    const assessment = makeAssessment({ complexity: "moderate" })
    expect(assessmentNeedsDialogue(assessment)).toBe(false)
  })

  it("complex assessment without ambiguity does not need dialogue", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: {
        multiStep: true,
        ambiguousGoal: false,
        contextDependent: true,
        timeSensitive: true,
        highStakes: false,
        novelPattern: false,
      },
    })
    expect(assessmentNeedsDialogue(assessment)).toBe(false)
  })

  it("rough assessment needs dialogue", () => {
    const assessment = makeRoughAssessment()
    expect(assessmentNeedsDialogue(assessment)).toBe(true)
  })

  it("complex + ambiguous + novel pattern needs dialogue", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: {
        multiStep: true,
        ambiguousGoal: true,
        contextDependent: true,
        timeSensitive: false,
        highStakes: false,
        novelPattern: true,
      },
    })
    expect(assessmentNeedsDialogue(assessment)).toBe(true)
  })
})

// ─── Assessment Gates Audit Trail (STAB-002b) ────────────

describe("STAB-002b: Assessment gates audit trail", () => {
  // The gate: skip audit ONLY when simple AND Claude already used tools.
  // This prevents double-write without causing zero-write.

  it("simple + tools used → SKIP audit (double-write prevention)", () => {
    const assessment = makeAssessment({ complexity: "simple" })
    const toolsUsed = ["notion-create-page"]
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(true)
  })

  it("simple + NO tools → audit RUNS (fallback, no zero-write)", () => {
    const assessment = makeAssessment({ complexity: "simple" })
    const toolsUsed: string[] = []
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(false)
  })

  it("moderate + tools used → audit RUNS (tracking needed)", () => {
    const assessment = makeAssessment({ complexity: "moderate" })
    const toolsUsed = ["notion-create-page"]
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(false)
  })

  it("complex assessment → audit RUNS regardless of tools", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      signals: {
        multiStep: true,
        ambiguousGoal: false,
        contextDependent: true,
        timeSensitive: true,
        highStakes: false,
        novelPattern: false,
      },
    })
    const toolsUsed = ["notion-create-page", "notion-search"]
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(false)
  })

  it("rough assessment → audit RUNS (but typically unreachable)", () => {
    const assessment = makeRoughAssessment()
    const toolsUsed: string[] = []
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(false)
  })

  it("null assessment (feature off) → audit RUNS (backward compat)", () => {
    const assessment: RequestAssessment | null = null
    const toolsUsed = ["notion-create-page"]
    const skipAudit = assessment?.complexity === "simple" && toolsUsed.length > 0
    expect(skipAudit).toBe(false)
  })

  it("actionTaken reflects tool use even when audit skipped", () => {
    const auditResult = null // skipped
    const toolsUsed = ["notion-create-page"]
    const mediaContext = null
    const actionTaken = !!auditResult || toolsUsed.length > 0 || !!mediaContext
    expect(actionTaken).toBe(true) // DONE reaction from tool use
  })

  it("actionTaken is false when no audit and no tools (pure chat)", () => {
    const auditResult = null
    const toolsUsed: string[] = []
    const mediaContext = null
    const actionTaken = !!auditResult || toolsUsed.length > 0 || !!mediaContext
    expect(actionTaken).toBe(false) // CHAT reaction
  })
})

// ─── Dialogue Engine Integration ─────────────────────────

describe("STAB-002: Dialogue engine integration", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
  })

  it("enterDialogue returns message and state for rough terrain", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)
    const model = getCachedModel()!

    const assessment = makeRoughAssessment()
    const context: AssessmentContext = {
      intent: "research",
      pillar: "The Grove",
      keywords: ["content", "strategy", "Q3"],
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    }

    const result = enterDialogue(
      "I need to rethink our content strategy for Q3",
      assessment,
      context,
      model,
    )

    expect(result.needsResponse).toBe(true)
    expect(result.message).toBeTruthy()
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.state.terrain).toBe("rough")
    expect(result.state.turnCount).toBe(1)
    expect(result.state.threads.length).toBeGreaterThanOrEqual(1)
    expect(result.state.resolved).toBe(false)
  })

  it("continueDialogue with affirmation resolves the dialogue", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)
    const model = getCachedModel()!

    const assessment = makeRoughAssessment()
    const context: AssessmentContext = {
      intent: "research",
      pillar: "The Grove",
      keywords: ["content", "strategy"],
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    }

    // Enter dialogue
    const entry = enterDialogue("Rethink content strategy for Q3", assessment, context, model)

    // Continue with affirmation
    const result = continueDialogue("Yes, go ahead", entry.state, model)

    expect(result.state.resolved).toBe(true)
    expect(result.proposal).toBeDefined()
    expect(result.message).toBeTruthy()
  })

  it("continueDialogue with more context continues exploration", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)
    const model = getCachedModel()!

    const assessment = makeRoughAssessment()
    const context: AssessmentContext = {
      intent: undefined, // ambiguous
      pillar: "The Grove",
      keywords: ["content"],
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    }

    // Enter dialogue
    const entry = enterDialogue("Rethink content strategy", assessment, context, model)

    // Continue with partial context (not affirmation, still ambiguous)
    const result = continueDialogue(
      "I'm thinking blog posts but also need to consider the LinkedIn presence",
      entry.state,
      model,
    )

    // Should either continue or resolve depending on engine logic
    expect(result.state.turnCount).toBe(2)
    expect(result.message).toBeTruthy()
  })
})
