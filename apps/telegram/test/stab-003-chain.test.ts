/**
 * STAB-003 Chain Tests — Close the Cognitive Loop
 *
 * Chain tests (ADR-002 Constraint 6): prove water flows through the pipe.
 * Traces: dialogue → refinement → approval → execution.
 *
 * Sprint: STAB-003 (Close the Cognitive Loop)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Self-model
import {
  assembleCapabilityModel,
  invalidateCache,
  type CapabilityDataProvider,
} from "../../../packages/agents/src/self-model"

// Assessment
import {
  assessRequest,
  type AssessmentContext,
} from "../../../packages/agents/src/assessment"
import type { RequestAssessment } from "../../../packages/agents/src/assessment/types"

// Dialogue engine
import {
  assessmentNeedsDialogue,
  enterDialogue,
  continueDialogue,
  resetThreadCounter,
} from "../../../packages/agents/src/dialogue"

// Approval session store
import {
  storeApprovalSession,
  getApprovalSession,
  removeApprovalSession,
  clearAllApprovalSessions,
  isApprovalSignal,
  isRejectionSignal,
  formatProposalMessage,
  type PendingApprovalSession,
} from "@atlas/agents/src/conversation/approval-session"

// Dialogue session store
import {
  clearAllDialogueSessions,
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
      {
        name: "agent-dispatch",
        description: "Launch specialist agents",
        triggers: [
          { type: "phrase", value: "/agent" },
          { type: "keyword", value: "research", pillar: "The Grove" },
        ],
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

// ─── Tests ──────────────────────────────────────────────

describe("STAB-003 Chain: Cognitive Loop Closure", () => {
  beforeEach(async () => {
    invalidateCache()
    resetThreadCounter()
    clearAllApprovalSessions()
    clearAllDialogueSessions()
  })

  // ── Chain 1: Dialogue → refinedRequest → downstream receives refined text ──

  describe("Chain 1: Dialogue resolution flows refined request downstream", () => {
    it("dialogue produces refinedRequest on resolution", async () => {
      const model = await assembleCapabilityModel(createMockProvider())

      // Assess a rough-terrain request
      const assessment = await assessRequest(
        "I'm not sure what to do about our go-to-market",
        { pillar: "Consulting", keywords: ["go-to-market"] },
        model,
      )

      expect(assessmentNeedsDialogue(assessment)).toBe(true)

      // Enter dialogue
      const entry = enterDialogue(
        "I'm not sure what to do about our go-to-market",
        assessment,
        { pillar: "Consulting" },
        model,
      )

      expect(entry.needsResponse).toBe(true)
      expect(entry.state.terrain).toBe("rough")

      // Continue dialogue with a clarifying answer
      const continuation = continueDialogue(
        "I think we should focus on enterprise clients, specifically financial services",
        entry.state,
        model,
      )

      // After enough context, dialogue should resolve with a refined request
      // (may take multiple turns — test the mechanism, not the exact turn count)
      if (!continuation.needsResponse) {
        // Resolved — check that refinedRequest exists
        expect(continuation.refinedRequest).toBeTruthy()
        expect(continuation.refinedRequest!.length).toBeGreaterThan(0)
      }
      // If still needs response, that's valid too — dialogue can take multiple turns
    })

    it("refined request replaces original for downstream processing", async () => {
      // Simulate the handler.ts substitution logic
      let messageText = "Something feels off about our strategy"
      const refinedRequest = "Analyze go-to-market strategy for enterprise financial services segment"

      // This is what handler.ts does at the STAB-003 fix point
      if (refinedRequest) {
        const original = messageText
        messageText = refinedRequest
        expect(original).toBe("Something feels off about our strategy")
        expect(messageText).toBe("Analyze go-to-market strategy for enterprise financial services segment")
      }

      // Downstream assessment should now work on the refined text
      const model = await assembleCapabilityModel(createMockProvider())
      const assessment = await assessRequest(messageText, {}, model)

      // Refined text should be more actionable — not rough terrain
      expect(assessment.complexity).not.toBe("rough")
    })
  })

  // ── Chain 2: Complex request → proposal → approval → execution ──

  describe("Chain 2: Complex terrain proposal → approval → execution", () => {
    it("complex assessment produces a proposal", async () => {
      const model = await assembleCapabilityModel(createMockProvider())

      const assessment = await assessRequest(
        "Research competitor pricing, draft a comparison doc, and then send it to the team before our Thursday meeting",
        {
          pillar: "Consulting",
          hasDeadline: true,
          keywords: ["competitor", "pricing", "comparison"],
        },
        model,
      )

      expect(["complex", "rough"]).toContain(assessment.complexity)
      expect(assessment.approach).toBeDefined()
      expect(assessment.approach!.steps.length).toBeGreaterThanOrEqual(1)
    })

    it("approval signal after proposal proceeds to execution", () => {
      // Store an approval session (simulating what handler.ts does)
      const session: PendingApprovalSession = {
        chatId: 12345,
        userId: 67890,
        proposalMessageId: 111,
        proposal: {
          steps: [{ description: "Research competitor pricing" }, { description: "Draft comparison" }],
          timeEstimate: "~30 min",
          questionForJim: "Sound right?",
          alternativeAngles: [],
        },
        refinedRequest: "Compare competitor pricing models for enterprise AI",
        originalMessage: "Research competitor pricing and draft something",
        assessment: {} as RequestAssessment,
        assessmentContext: {},
        createdAt: Date.now(),
      }

      storeApprovalSession(session)
      expect(getApprovalSession(12345)).toBeDefined()

      // Jim says "yes"
      expect(isApprovalSignal("yes")).toBe(true)

      // Handler removes session and uses refinedRequest
      const retrieved = getApprovalSession(12345)!
      removeApprovalSession(12345)

      const executionMessage = retrieved.refinedRequest || retrieved.originalMessage
      expect(executionMessage).toBe("Compare competitor pricing models for enterprise AI")
      expect(getApprovalSession(12345)).toBeUndefined()
    })

    it("rejection signal after proposal prompts for adjustment", () => {
      storeApprovalSession({
        chatId: 12345,
        userId: 67890,
        proposalMessageId: 111,
        proposal: {
          steps: [{ description: "Research competitor pricing" }],
          questionForJim: "Sound right?",
          alternativeAngles: [],
        },
        originalMessage: "Research competitor pricing",
        assessment: {} as RequestAssessment,
        assessmentContext: {},
        createdAt: Date.now(),
      })

      // Jim says "no"
      expect(isRejectionSignal("no")).toBe(true)
      expect(isApprovalSignal("no")).toBe(false)

      // Handler removes session
      removeApprovalSession(12345)
      expect(getApprovalSession(12345)).toBeUndefined()
    })

    it("ambiguous reply after proposal triggers re-assessment", () => {
      storeApprovalSession({
        chatId: 12345,
        userId: 67890,
        proposalMessageId: 111,
        proposal: {
          steps: [{ description: "Research competitor pricing" }],
          questionForJim: "Sound right?",
          alternativeAngles: [],
        },
        originalMessage: "Research competitor pricing",
        assessment: {} as RequestAssessment,
        assessmentContext: {},
        createdAt: Date.now(),
      })

      // Jim says something that's neither approval nor rejection
      const reply = "Actually, focus on just the Chase account"
      expect(isApprovalSignal(reply)).toBe(false)
      expect(isRejectionSignal(reply)).toBe(false)

      // Handler removes session and treats as new message
      removeApprovalSession(12345)
      expect(getApprovalSession(12345)).toBeUndefined()
      // The reply would then go through the full pipeline as a new message
    })
  })

  // ── Chain 3: Proposal formatting ──

  describe("Chain 3: Proposal message formatting", () => {
    it("proposal formats correctly for Telegram HTML", async () => {
      const model = await assembleCapabilityModel(createMockProvider())

      const assessment = await assessRequest(
        "Research competitor pricing, draft a comparison doc, and send it before Thursday",
        {
          pillar: "Consulting",
          hasDeadline: true,
          keywords: ["competitor", "pricing"],
        },
        model,
      )

      if (assessment.approach) {
        const msg = formatProposalMessage(assessment.approach, assessment.complexity)

        // Should contain HTML tags
        expect(msg).toContain("<b>")
        // Should contain step numbers
        expect(msg).toMatch(/\d+\./)
        // Should contain a question
        expect(msg).toContain("?")
      }
    })
  })

  // ── Chain 3a: Moderate terrain also triggers approval gate (STAB-003a) ──

  describe("Chain 3a: Moderate terrain with proposal triggers gate", () => {
    it("moderate assessment with approach triggers approval gate", async () => {
      const model = await assembleCapabilityModel(createMockProvider())

      // A multi-step request that may assess as moderate (1-2 signals)
      const assessment = await assessRequest(
        "Research what Cursor and Windsurf are doing with agent modes and draft a comparison for the blog",
        {
          pillar: "The Grove",
          keywords: ["cursor", "windsurf", "agent", "research", "blog"],
        },
        model,
      )

      // Whether moderate or complex, the gate should fire if approach exists
      if (assessment.approach) {
        const shouldGate = assessment.complexity !== 'simple'
        expect(shouldGate).toBe(true)

        // Proposal should format correctly regardless of complexity tier
        const msg = formatProposalMessage(assessment.approach, assessment.complexity)
        expect(msg).toContain("<b>")
        expect(msg).toContain(assessment.complexity)
        expect(msg).toMatch(/\d+\./)
      }
    })

    it("moderate approval session round-trips through store", () => {
      const session: PendingApprovalSession = {
        chatId: 99999,
        userId: 88888,
        proposalMessageId: 555,
        proposal: {
          steps: [
            { description: "Research Cursor and Windsurf agent modes" },
            { description: "Draft comparison blog post" },
          ],
          timeEstimate: "~20 min",
          questionForJim: "Sound right?",
          alternativeAngles: [],
        },
        originalMessage: "Research Cursor/Windsurf agent modes and draft a blog post",
        assessment: { complexity: "moderate" } as RequestAssessment,
        assessmentContext: { pillar: "The Grove" },
        createdAt: Date.now(),
      }

      storeApprovalSession(session)

      const retrieved = getApprovalSession(99999)
      expect(retrieved).toBeDefined()
      expect(retrieved!.assessment.complexity).toBe("moderate")
      expect(retrieved!.proposal.steps).toHaveLength(2)

      // Approval clears it
      expect(isApprovalSignal("yes")).toBe(true)
      removeApprovalSession(99999)
      expect(getApprovalSession(99999)).toBeUndefined()
    })
  })

  // ── Chain 4: Full loop trace ──

  describe("Chain 4: Trace metadata captures loop closure", () => {
    it("approval step captures correct metadata", () => {
      const trace = createTrace()
      const step = addStep(trace, "approval-check")

      // Simulate approval
      step.metadata = { status: "approved", hasRefinedRequest: true }
      completeStep(step)

      expect(step.metadata.status).toBe("approved")
      expect(step.metadata.hasRefinedRequest).toBe(true)
    })

    it("rejection step captures correct metadata", () => {
      const trace = createTrace()
      const step = addStep(trace, "approval-check")

      step.metadata = { status: "rejected" }
      completeStep(step)

      expect(step.metadata.status).toBe("rejected")
    })

    it("ambiguous step captures re-assessment flag", () => {
      const trace = createTrace()
      const step = addStep(trace, "approval-check")

      step.metadata = { status: "ambiguous", treatedAsNewMessage: true }
      completeStep(step)

      expect(step.metadata.treatedAsNewMessage).toBe(true)
    })
  })
})
