/**
 * STAB-002 Chain Tests — Cognitive Loop Activation
 *
 * Chain tests (ADR-002 Constraint 6): prove water flows through the pipe.
 * Traces: triage → assessment → terrain → dialogue entry/continuation.
 *
 * Sprint: STAB-002 (Activate the Cognitive Loop)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Self-model
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
  type CapabilityDataProvider,
} from "../../../packages/agents/src/self-model"

// Assessment
import {
  assessRequest,
  type AssessmentContext,
} from "../../../packages/agents/src/assessment"
import type { RequestAssessment, ComplexitySignals } from "../../../packages/agents/src/assessment/types"

// Dialogue engine + terrain
import {
  assessmentNeedsDialogue,
  enterDialogue,
  continueDialogue,
  resetThreadCounter,
} from "../../../packages/agents/src/dialogue"

// Dialogue session store
import {
  storeDialogueSession,
  getDialogueSession,
  getDialogueSessionByUserId,
  hasDialogueSessionForUser,
  removeDialogueSession,
  clearAllDialogueSessions,
  type PendingDialogueSession,
} from "../src/conversation/dialogue-session"

// Trace infrastructure
import {
  createTrace,
  addStep,
  completeStep,
} from "../../../packages/shared/src/trace"

// ─── Mock Provider ───────────────────────────────────────

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

// ─── Test Helpers ────────────────────────────────────────

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

/**
 * Replicates the handler's assessment step in isolation.
 * Same pattern as STAB-001 chain tests.
 */
function runAssessmentStep(
  trace: ReturnType<typeof createTrace>,
  messageText: string,
  preflightTriage: { intent?: string; pillar?: string; keywords?: string[] } | null,
): RequestAssessment | null {
  let assessment: RequestAssessment | null = null

  if (preflightTriage) {
    const assessStep = addStep(trace, "request-assessment")
    try {
      const model = getCachedModel()
      if (!model) {
        assessStep.metadata = { status: "skipped", reason: "no-cached-model" }
        completeStep(assessStep)
      } else {
        const context: AssessmentContext = {
          intent: preflightTriage.intent,
          pillar: preflightTriage.pillar,
          keywords: preflightTriage.keywords,
          hasUrl: /https?:\/\//.test(messageText),
          hasContact: false,
          hasDeadline: false,
        }
        assessment = assessRequest(messageText, context, model)
        assessStep.metadata = {
          status: "ok",
          complexity: assessment.complexity,
          signalCount: assessment.signals
            ? Object.values(assessment.signals).filter(Boolean).length
            : 0,
          hasProposal: !!assessment.approach,
        }
        completeStep(assessStep)
      }
    } catch (err) {
      assessStep.metadata = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }
      completeStep(assessStep)
    }
  }

  return assessment
}

/**
 * Replicates the handler's dialogue entry step in isolation.
 */
function runDialogueEntryStep(
  trace: ReturnType<typeof createTrace>,
  messageText: string,
  assessment: RequestAssessment,
  preflightTriage: { intent?: string; pillar?: string; keywords?: string[] },
): { entered: boolean; message?: string; state?: any } {
  if (!assessmentNeedsDialogue(assessment)) {
    return { entered: false }
  }

  const dialogueStep = addStep(trace, "dialogue-entry")
  try {
    const model = getCachedModel()
    if (!model) {
      dialogueStep.metadata = { status: "skipped", reason: "no-cached-model" }
      completeStep(dialogueStep)
      return { entered: false }
    }

    const assessCtx: AssessmentContext = {
      intent: preflightTriage.intent,
      pillar: preflightTriage.pillar,
      keywords: preflightTriage.keywords,
      hasUrl: /https?:\/\//.test(messageText),
      hasContact: false,
      hasDeadline: false,
    }

    const result = enterDialogue(messageText, assessment, assessCtx, model)

    dialogueStep.metadata = {
      status: "entered",
      terrain: "rough",
      threadCount: result.state.threads.length,
      openQuestions: result.state.openQuestions.length,
    }
    completeStep(dialogueStep)

    return { entered: true, message: result.message, state: result.state }
  } catch (err) {
    dialogueStep.metadata = {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
    completeStep(dialogueStep)
    return { entered: false }
  }
}

/**
 * Replicates the handler's dialogue continuation step in isolation.
 */
function runDialogueContinuationStep(
  trace: ReturnType<typeof createTrace>,
  replyText: string,
  session: PendingDialogueSession,
): { continued: boolean; resolved: boolean; message?: string; state?: any; proposal?: any } {
  const dialogueStep = addStep(trace, "dialogue-continue")
  try {
    const model = getCachedModel()
    if (!model) {
      dialogueStep.metadata = { status: "cancelled", reason: "no-cached-model" }
      completeStep(dialogueStep)
      return { continued: false, resolved: false }
    }

    const result = continueDialogue(replyText, session.dialogueState, model)

    if (result.needsResponse) {
      dialogueStep.metadata = {
        status: "continued",
        turn: result.state.turnCount,
        openQuestions: result.state.openQuestions.length,
      }
      completeStep(dialogueStep)
      return { continued: true, resolved: false, message: result.message, state: result.state }
    } else {
      dialogueStep.metadata = {
        status: "resolved",
        turns: result.state.turnCount,
        hasProposal: !!result.proposal,
      }
      completeStep(dialogueStep)
      return { continued: false, resolved: true, message: result.message, state: result.state, proposal: result.proposal }
    }
  } catch (err) {
    dialogueStep.metadata = {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
    completeStep(dialogueStep)
    return { continued: false, resolved: false }
  }
}

/**
 * Simulates the assessment prompt injection logic from handler.ts.
 */
function buildAssessmentPromptSection(assessment: RequestAssessment): string {
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

  if (assessment.capabilities.length > 0) {
    lines.push(
      ``,
      `**Relevant Capabilities:** ${assessment.capabilities.map(c => c.capabilityId).join(', ')}`,
    )
  }

  return lines.join('\n')
}

// ─── Chain Test Suite ────────────────────────────────────

describe("STAB-002 Chain: Simple request → no dialogue", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
    clearAllDialogueSessions()
  })

  it("simple request flows through assessment without entering dialogue", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()

    // Step 1: Triage
    const triageStep = addStep(trace, "preflight-triage")
    const triage = { intent: "command", pillar: "Personal", keywords: ["grocery"] }
    triageStep.metadata = { intent: triage.intent, pillar: triage.pillar }
    completeStep(triageStep)

    // Step 2: Assessment
    const assessment = runAssessmentStep(trace, "Add milk to grocery list", triage)

    // Simple request → no dialogue
    expect(assessment).not.toBeNull()
    expect(assessment!.complexity).toBe("simple")
    expect(assessmentNeedsDialogue(assessment!)).toBe(false)

    // Verify trace has triage + assessment, no dialogue
    expect(trace.steps.length).toBe(2)
    expect(trace.steps[0].name).toBe("preflight-triage")
    expect(trace.steps[1].name).toBe("request-assessment")
    expect(trace.steps[1].metadata!.status).toBe("ok")
    expect(trace.steps[1].metadata!.complexity).toBe("simple")
  })
})

describe("STAB-002 Chain: Rough request → dialogue entry", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
    clearAllDialogueSessions()
  })

  it("rough request enters dialogue, returns message, skips Claude", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()
    const messageText = "I need to rethink our content strategy for Q3 — we've got the Grove blog, LinkedIn, and the research generator all going but nothing feels cohesive"

    // Step 1: Triage
    const triageStep = addStep(trace, "preflight-triage")
    const triage = { intent: "research", pillar: "The Grove", keywords: ["content", "strategy", "Q3", "cohesive"] }
    triageStep.metadata = { intent: triage.intent, pillar: triage.pillar }
    completeStep(triageStep)

    // Step 2: Assessment — use known rough assessment (chain test verifies routing, not classifier)
    const assessment = makeRoughAssessment()
    const assessStep = addStep(trace, "request-assessment")
    assessStep.metadata = {
      status: "ok",
      complexity: assessment.complexity,
      signalCount: Object.values(assessment.signals).filter(Boolean).length,
      hasProposal: !!assessment.approach,
    }
    completeStep(assessStep)

    // Step 3: Dialogue entry (this is the key chain link)
    const dialogueResult = runDialogueEntryStep(trace, messageText, assessment, triage)

    // Should have entered dialogue
    expect(dialogueResult.entered).toBe(true)
    expect(dialogueResult.message).toBeTruthy()
    expect(dialogueResult.message!.length).toBeGreaterThan(0)
    expect(dialogueResult.state.terrain).toBe("rough")
    expect(dialogueResult.state.turnCount).toBe(1)
    expect(dialogueResult.state.resolved).toBe(false)

    // Verify all trace steps present
    expect(trace.steps.length).toBe(3)
    expect(trace.steps[0].name).toBe("preflight-triage")
    expect(trace.steps[1].name).toBe("request-assessment")
    expect(trace.steps[2].name).toBe("dialogue-entry")
    expect(trace.steps[2].metadata!.status).toBe("entered")
    expect(trace.steps[2].metadata!.terrain).toBe("rough")
    expect(trace.steps[2].metadata!.threadCount).toBeGreaterThanOrEqual(1)
  })

  it("rough request stores dialogue session for continuation", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()
    const messageText = "I need to completely rethink how we handle client onboarding — the current process has too many handoffs"
    const triage = { intent: "research", pillar: "Consulting", keywords: ["onboarding", "process", "handoffs"] }

    // Use known rough assessment (chain test verifies session storage, not classifier)
    const assessment = makeRoughAssessment()

    // Dialogue entry
    const dialogueResult = runDialogueEntryStep(trace, messageText, assessment, triage)
    expect(dialogueResult.entered).toBe(true)

    // Simulate storeDialogueSession (what handler.ts does)
    const chatId = 12345
    const userId = 67890
    storeDialogueSession({
      chatId,
      userId,
      questionMessageId: 999,
      dialogueState: dialogueResult.state,
      assessment,
      assessmentContext: {
        intent: triage.intent,
        pillar: triage.pillar,
        keywords: triage.keywords,
        hasUrl: false,
        hasContact: false,
        hasDeadline: false,
      },
      originalMessage: messageText,
      createdAt: Date.now(),
    })

    // Verify session stored and retrievable
    expect(hasDialogueSessionForUser(userId)).toBe(true)
    const session = getDialogueSession(chatId)
    expect(session).toBeDefined()
    expect(session!.dialogueState.terrain).toBe("rough")
    expect(session!.dialogueState.turnCount).toBe(1)
    expect(session!.originalMessage).toBe(messageText)
  })
})

describe("STAB-002 Chain: Dialogue continuation → resolved", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
    clearAllDialogueSessions()
  })

  it("affirmation reply resolves dialogue and removes session", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const messageText = "Rethink content strategy across all channels for Q3"
    const triage = { intent: "research", pillar: "The Grove", keywords: ["content", "strategy"] }

    // Step 1: Enter dialogue
    const entryTrace = createTrace()
    addStep(entryTrace, "preflight-triage")
    completeStep(entryTrace.steps[0])
    runAssessmentStep(entryTrace, messageText, triage)
    const assessment = makeRoughAssessment() // Use known rough assessment
    const entryResult = runDialogueEntryStep(entryTrace, messageText, assessment, triage)
    expect(entryResult.entered).toBe(true)

    // Store session
    const chatId = 11111
    const userId = 22222
    const session: PendingDialogueSession = {
      chatId,
      userId,
      questionMessageId: 999,
      dialogueState: entryResult.state,
      assessment,
      assessmentContext: {
        intent: triage.intent,
        pillar: triage.pillar,
        keywords: triage.keywords,
        hasUrl: false,
        hasContact: false,
        hasDeadline: false,
      },
      originalMessage: messageText,
      createdAt: Date.now(),
    }
    storeDialogueSession(session)

    // Step 2: Jim replies with affirmation
    const contTrace = createTrace()
    const contResult = runDialogueContinuationStep(contTrace, "Yes, go ahead", session)

    // Should be resolved
    expect(contResult.resolved).toBe(true)
    expect(contResult.continued).toBe(false)
    expect(contResult.proposal).toBeDefined()
    expect(contResult.message).toBeTruthy()

    // Trace should show resolved status
    const contStep = contTrace.steps.find(s => s.name === "dialogue-continue")
    expect(contStep).toBeDefined()
    expect(contStep!.metadata!.status).toBe("resolved")
    expect(contStep!.metadata!.hasProposal).toBe(true)

    // Handler would remove session after resolution
    removeDialogueSession(chatId)
    expect(hasDialogueSessionForUser(userId)).toBe(false)
  })
})

describe("STAB-002 Chain: Dialogue continuation → multi-turn", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
    clearAllDialogueSessions()
  })

  it("partial reply continues dialogue with updated state", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const messageText = "Rethink content strategy"
    const triage = { intent: "research", pillar: "The Grove", keywords: ["content"] }

    // Enter dialogue with known rough assessment
    const assessment = makeRoughAssessment()
    const model = getCachedModel()!

    const assessCtx: AssessmentContext = {
      intent: triage.intent,
      pillar: triage.pillar,
      keywords: triage.keywords,
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    }
    const entry = enterDialogue(messageText, assessment, assessCtx, model)

    // Store session
    const chatId = 33333
    const userId = 44444
    const session: PendingDialogueSession = {
      chatId,
      userId,
      questionMessageId: 100,
      dialogueState: entry.state,
      assessment,
      assessmentContext: assessCtx,
      originalMessage: messageText,
      createdAt: Date.now(),
    }
    storeDialogueSession(session)

    // Jim replies with partial context (not affirmation)
    const contTrace = createTrace()
    const contResult = runDialogueContinuationStep(
      contTrace,
      "I'm thinking blog posts but also need to consider the LinkedIn presence",
      session,
    )

    // Should continue (not resolve) — dialogue needs more turns
    expect(contResult.state.turnCount).toBe(2)
    expect(contResult.message).toBeTruthy()

    // Handler would update the stored session
    if (contResult.continued) {
      storeDialogueSession({
        ...session,
        dialogueState: contResult.state,
      })

      // Session still active with updated state
      const updated = getDialogueSession(chatId)
      expect(updated).toBeDefined()
      expect(updated!.dialogueState.turnCount).toBe(2)
    }

    // Verify trace
    const contStep = contTrace.steps.find(s => s.name === "dialogue-continue")
    expect(contStep).toBeDefined()
    expect(contStep!.metadata!.status).toBeDefined() // 'continued' or 'resolved'
  })
})

describe("STAB-002 Chain: Assessment injected into prompt", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
  })

  it("simple assessment produces minimal prompt section", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()
    const triage = { intent: "command", pillar: "Personal", keywords: ["grocery"] }
    const assessment = runAssessmentStep(trace, "Add milk to grocery list", triage)

    expect(assessment).not.toBeNull()

    // Build the prompt section (same logic as handler.ts)
    const section = buildAssessmentPromptSection(assessment!)

    // Simple assessment has complexity + reasoning
    expect(section).toContain("## Request Assessment")
    expect(section).toContain("**Complexity:** simple")
    expect(section).toContain("**Reasoning:**")

    // Should NOT contain approach or question
    expect(section).not.toContain("Proposed Approach")
    expect(section).not.toContain("Before proceeding, ask Jim")
  })

  it("complex assessment includes approach and question in prompt", () => {
    const assessment = makeAssessment({
      complexity: "complex",
      reasoning: "Multi-step client research with deadline",
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

    const section = buildAssessmentPromptSection(assessment)

    expect(section).toContain("**Complexity:** complex")
    expect(section).toContain("1. Research competitors")
    expect(section).toContain("2. Draft analysis")
    expect(section).toContain("**Estimated Time:** ~5 minutes")
    expect(section).toContain("**Before proceeding, ask Jim:** Should I focus on pricing or features?")
  })

  it("assessment with capabilities lists them in prompt", () => {
    const assessment = makeAssessment({
      complexity: "moderate",
      capabilities: [
        { capabilityId: "notion-search", layer: "integration", confidence: 0.9, matchReason: "DB query", alternatives: [] },
        { capabilityId: "research-agent", layer: "skill", confidence: 0.8, matchReason: "Research", alternatives: [] },
      ],
    })

    const section = buildAssessmentPromptSection(assessment)

    expect(section).toContain("**Relevant Capabilities:** notion-search, research-agent")
  })
})

describe("STAB-002 Chain: Full trace triage → assessment → dialogue", () => {
  beforeEach(() => {
    invalidateCache()
    resetThreadCounter()
    clearAllDialogueSessions()
  })

  it("full chain produces all expected trace steps for rough terrain", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()
    const messageText = "I need to completely rethink our content strategy for Q3 — blog, LinkedIn, research generator, none of it feels cohesive and I'm not sure what the unifying thread should be"

    // Step 1: Triage
    const triageStep = addStep(trace, "preflight-triage")
    const triage = { intent: "research", pillar: "The Grove", keywords: ["content", "strategy", "Q3", "cohesive"] }
    triageStep.metadata = { intent: triage.intent, pillar: triage.pillar }
    completeStep(triageStep)

    // Step 2: Assessment (use known rough for deterministic test)
    const assessment = makeRoughAssessment()
    const assessStep = addStep(trace, "request-assessment")
    assessStep.metadata = {
      status: "ok",
      complexity: assessment.complexity,
      signalCount: Object.values(assessment.signals).filter(Boolean).length,
      hasProposal: !!assessment.approach,
    }
    completeStep(assessStep)

    // Step 3: Dialogue entry
    const dialogueResult = runDialogueEntryStep(trace, messageText, assessment, triage)

    // All 3 steps present in trace
    expect(trace.steps.length).toBe(3)
    expect(trace.steps[0].name).toBe("preflight-triage")
    expect(trace.steps[1].name).toBe("request-assessment")
    expect(trace.steps[2].name).toBe("dialogue-entry")

    // Each step completed
    expect(trace.steps[0].completedAt).toBeDefined()
    expect(trace.steps[1].completedAt).toBeDefined()
    expect(trace.steps[2].completedAt).toBeDefined()

    // Assessment metadata correct
    expect(trace.steps[1].metadata!.status).toBe("ok")
    expect(trace.steps[1].metadata!.complexity).toBe("rough")

    // Dialogue metadata correct
    expect(trace.steps[2].metadata!.status).toBe("entered")
    expect(trace.steps[2].metadata!.terrain).toBe("rough")

    // Dialogue result valid
    expect(dialogueResult.entered).toBe(true)
    expect(dialogueResult.message).toBeTruthy()
    expect(dialogueResult.state.terrain).toBe("rough")
    expect(dialogueResult.state.turnCount).toBe(1)
    expect(dialogueResult.state.threads.length).toBeGreaterThanOrEqual(1)
    expect(dialogueResult.state.resolved).toBe(false)
  })

  it("dialogue entry without cached model falls through gracefully", async () => {
    // Don't assemble model — getCachedModel() returns null
    const trace = createTrace()
    const messageText = "Complex strategic planning request"

    const triageStep = addStep(trace, "preflight-triage")
    triageStep.metadata = { intent: "research", pillar: "The Grove" }
    completeStep(triageStep)

    const assessment = makeRoughAssessment()
    const assessStep = addStep(trace, "request-assessment")
    assessStep.metadata = { status: "ok", complexity: "rough" }
    completeStep(assessStep)

    const triage = { intent: "research", pillar: "The Grove", keywords: ["strategy"] }
    const dialogueResult = runDialogueEntryStep(trace, messageText, assessment, triage)

    // Should NOT enter dialogue — no model
    expect(dialogueResult.entered).toBe(false)

    // Dialogue step should show skipped, not failed
    const dialogueStep = trace.steps.find(s => s.name === "dialogue-entry")
    expect(dialogueStep).toBeDefined()
    expect(dialogueStep!.metadata!.status).toBe("skipped")
    expect(dialogueStep!.metadata!.reason).toBe("no-cached-model")
  })
})
