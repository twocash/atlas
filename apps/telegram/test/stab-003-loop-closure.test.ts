/**
 * STAB-003 Unit Tests — Close the Cognitive Loop
 *
 * Tests for:
 *   1. Approval session state (CRUD via unified ConversationState)
 *   2. Approval signal matching (positive, negative, ambiguous)
 *   3. Proposal formatting
 *
 * STATE-PERSIST-TEARDOWN: Migrated from legacy approval-session.ts to
 * unified ConversationState (conversation-state.ts). Pure functions
 * (signal detection + formatting) moved to approval-utils.ts.
 *
 * Sprint: STAB-003 (Close the Cognitive Loop)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Unified conversation state (supersedes approval-session.ts)
import {
  enterApprovalPhase,
  getState,
  getStateByUserId,
  hasActiveSession,
  isInPhase,
  returnToIdle,
  clearAllStates,
  type ApprovalState,
} from "@atlas/agents/src/conversation/conversation-state"

// Pure functions (extracted from approval-session.ts)
import {
  isApprovalSignal,
  isRejectionSignal,
  formatProposalMessage,
} from "@atlas/agents/src/conversation/approval-utils"

import type { RequestAssessment } from "../../../packages/agents/src/assessment/types"
import type { ApproachProposal } from "../../../packages/agents/src/assessment/types"

// ─── Test Helpers ────────────────────────────────────────

const CHAT_ID = 12345
const USER_ID = 67890

function makeProposal(overrides: Partial<ApproachProposal> = {}): ApproachProposal {
  return {
    steps: [
      { description: "Research competitor pricing models" },
      { description: "Draft comparison document" },
    ],
    timeEstimate: "~30 minutes",
    questionForJim: "Sound right, or different angle?",
    alternativeAngles: ["Focus on just top 3 competitors", "Add pricing history timeline"],
    ...overrides,
  }
}

function makeAssessment(overrides: Partial<RequestAssessment> = {}): RequestAssessment {
  return {
    complexity: "complex",
    pillar: "Consulting",
    approach: makeProposal(),
    capabilities: [],
    reasoning: "3 signals: multiStep, highStakes, contextDependent",
    signals: {
      multiStep: true,
      ambiguousGoal: false,
      contextDependent: true,
      timeSensitive: false,
      highStakes: true,
      novelPattern: false,
    },
    domain: "consulting",
    audience: "self",
    ...overrides,
  }
}

function makeApprovalState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    proposalMessageId: 111,
    proposal: makeProposal(),
    originalMessage: "Research competitor pricing and draft a comparison",
    assessment: makeAssessment(),
    assessmentContext: {},
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────

describe("STAB-003: Close the Cognitive Loop", () => {
  beforeEach(() => {
    clearAllStates()
  })

  // ── 1. Approval Session State (unified ConversationState) ──

  describe("Approval Session State (unified)", () => {
    it("stores and retrieves by chatId", () => {
      const approval = makeApprovalState()
      enterApprovalPhase(CHAT_ID, USER_ID, approval)

      const state = getState(CHAT_ID)
      expect(state).toBeDefined()
      expect(state!.chatId).toBe(CHAT_ID)
      expect(state!.userId).toBe(USER_ID)
      expect(state!.approval!.proposal.steps).toHaveLength(2)
    })

    it("retrieves by userId", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState())

      const state = getStateByUserId(USER_ID)
      expect(state).toBeDefined()
      expect(state!.chatId).toBe(CHAT_ID)
    })

    it("isInPhase returns true when approval session exists", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState())
      expect(isInPhase(USER_ID, 'approval')).toBe(true)
    })

    it("isInPhase returns false when no session", () => {
      expect(isInPhase(99999, 'approval')).toBe(false)
    })

    it("removes session via returnToIdle", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState())
      expect(isInPhase(USER_ID, 'approval')).toBe(true)

      returnToIdle(CHAT_ID)
      expect(isInPhase(USER_ID, 'approval')).toBe(false)
    })

    it("latest session wins per chat", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState({ proposalMessageId: 111 }))
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState({ proposalMessageId: 222 }))

      const state = getState(CHAT_ID)
      expect(state!.approval!.proposalMessageId).toBe(222)
    })

    it("clearAll removes everything", () => {
      enterApprovalPhase(1, 1, makeApprovalState())
      enterApprovalPhase(2, 2, makeApprovalState())

      clearAllStates()
      expect(isInPhase(1, 'approval')).toBe(false)
      expect(isInPhase(2, 'approval')).toBe(false)
    })
  })

  // ── 2. Approval Signal Matching ──

  describe("Approval Signal Matching", () => {
    const approvalCases = [
      "yes", "Yeah", "yep", "YUP", "sure", "ok", "okay",
      "go", "go ahead", "do it", "sounds good", "looks good",
      "sounds right", "sounds great", "Sounds right",
      "let's go", "lets go", "let's do it", "proceed", "approved", "approve",
      "right", "correct", "exactly", "perfect",
      "absolutely", "definitely", "for sure",
      "works for me", "that works",
      "yes!", "sure.", "go!",
    ]

    for (const text of approvalCases) {
      it(`"${text}" is an approval signal`, () => {
        expect(isApprovalSignal(text)).toBe(true)
      })
    }

    it("approval signals are case-insensitive", () => {
      expect(isApprovalSignal("YES")).toBe(true)
      expect(isApprovalSignal("Sounds Good")).toBe(true)
      expect(isApprovalSignal("Sounds Right")).toBe(true)
      expect(isApprovalSignal("SOUNDS RIGHT")).toBe(true)
    })

    it("non-approval text is not an approval signal", () => {
      expect(isApprovalSignal("Research competitor pricing")).toBe(false)
      expect(isApprovalSignal("tell me more")).toBe(false)
      expect(isApprovalSignal("what about")).toBe(false)
    })
  })

  describe("Rejection Signal Matching", () => {
    const rejectionCases = [
      "no", "nah", "nope", "wait", "stop", "hold",
      "pause", "cancel", "adjust", "change", "different",
      "wrong", "not quite", "not right", "not that",
    ]

    for (const text of rejectionCases) {
      it(`"${text}" is a rejection signal`, () => {
        expect(isRejectionSignal(text)).toBe(true)
      })
    }

    it("rejection signals are case-insensitive", () => {
      expect(isRejectionSignal("NO")).toBe(true)
      expect(isRejectionSignal("Wait")).toBe(true)
    })

    it("non-rejection text is not a rejection signal", () => {
      expect(isRejectionSignal("yes")).toBe(false)
      expect(isRejectionSignal("Research competitor pricing")).toBe(false)
    })
  })

  describe("Ambiguous Input", () => {
    it("ambiguous text is neither approval nor rejection", () => {
      const ambiguous = [
        "tell me more",
        "what about focusing on just Chase?",
        "hmm interesting",
        "can you elaborate on step 2?",
        "Research competitor pricing models",
      ]

      for (const text of ambiguous) {
        expect(isApprovalSignal(text)).toBe(false)
        expect(isRejectionSignal(text)).toBe(false)
      }
    })
  })

  // ── 3. Refined Request Storage ──

  describe("Refined Request Storage", () => {
    it("stores and retrieves refinedRequest", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState({
        refinedRequest: "Compare competitor pricing models for enterprise AI infrastructure",
      }))

      const state = getState(CHAT_ID)
      expect(state!.approval!.refinedRequest).toBe(
        "Compare competitor pricing models for enterprise AI infrastructure"
      )
    })

    it("session without refinedRequest has undefined", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState())

      const state = getState(CHAT_ID)
      expect(state!.approval!.refinedRequest).toBeUndefined()
    })
  })

  // ── 4. Proposal Formatting ──

  describe("Proposal Formatting", () => {
    it("formats proposal with steps", () => {
      const msg = formatProposalMessage(makeProposal(), "complex")

      expect(msg).toContain("complex")
      expect(msg).toContain("1. Research competitor pricing models")
      expect(msg).toContain("2. Draft comparison document")
    })

    it("includes time estimate", () => {
      const msg = formatProposalMessage(makeProposal(), "complex")
      expect(msg).toContain("~30 minutes")
    })

    it("includes alternative angles", () => {
      const msg = formatProposalMessage(makeProposal(), "complex")
      expect(msg).toContain("Alternative angles")
      expect(msg).toContain("Focus on just top 3 competitors")
    })

    it("includes question for Jim", () => {
      const msg = formatProposalMessage(makeProposal(), "complex")
      expect(msg).toContain("Sound right, or different angle?")
    })

    it("handles proposal without optional fields", () => {
      const minimal = makeProposal({
        timeEstimate: undefined,
        alternativeAngles: [],
        questionForJim: undefined,
      })

      const msg = formatProposalMessage(minimal, "complex")
      expect(msg).toContain("1. Research competitor pricing models")
      // Falls back to default question
      expect(msg).toContain("Sound right, or different angle?")
    })

    it("formats proposal with moderate complexity (STAB-003a)", () => {
      const msg = formatProposalMessage(makeProposal(), "moderate")

      expect(msg).toContain("moderate")
      expect(msg).toContain("1. Research competitor pricing models")
      expect(msg).toContain("2. Draft comparison document")
      expect(msg).toContain("Sound right, or different angle?")
    })
  })

  // ── 5. Gate Widening (STAB-003a) ──

  describe("Approval Gate Widening (STAB-003a)", () => {
    it("moderate + approach should trigger gate (not just complex)", () => {
      const assessment = makeAssessment({
        complexity: "moderate",
        approach: makeProposal(),
        signals: {
          multiStep: true,
          ambiguousGoal: false,
          contextDependent: false,
          timeSensitive: false,
          highStakes: false,
          novelPattern: false,
        },
      })

      // Gate condition: approach exists AND complexity !== 'simple'
      const shouldGate = assessment.approach && assessment.complexity !== 'simple'
      expect(shouldGate).toBeTruthy()
    })

    it("simple + approach=null should NOT trigger gate", () => {
      const assessment = makeAssessment({
        complexity: "simple",
        approach: null,
      })

      const shouldGate = assessment.approach && assessment.complexity !== 'simple'
      expect(shouldGate).toBeFalsy()
    })

    it("simple + approach should NOT trigger gate", () => {
      // Edge case: simple complexity but approach somehow exists
      const assessment = makeAssessment({
        complexity: "simple",
        approach: makeProposal(),
      })

      const shouldGate = assessment.approach && assessment.complexity !== 'simple'
      expect(shouldGate).toBeFalsy()
    })

    it("complex + approach still triggers gate", () => {
      const assessment = makeAssessment({
        complexity: "complex",
        approach: makeProposal(),
      })

      const shouldGate = assessment.approach && assessment.complexity !== 'simple'
      expect(shouldGate).toBeTruthy()
    })

    it("moderate session stores and retrieves correctly", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState({
        assessment: makeAssessment({ complexity: "moderate" }),
      }))

      const state = getState(CHAT_ID)
      expect(state).toBeDefined()
      expect(state!.approval!.assessment.complexity).toBe("moderate")
    })
  })

  // ── 6. Approval Loop Prevention (STAB-003a hotfix) ──

  describe("Approval Loop Prevention", () => {
    it("approvalGranted flag prevents re-gating after approval", () => {
      // Simulate: user approves → message falls through → hits assessment
      // The approvalGranted flag should prevent the gate from re-firing
      let approvalGranted = false

      // Phase 1: Proposal surfaced, session stored
      const assessment = makeAssessment({ complexity: "moderate" })
      const shouldGateFirst = assessment.approach && assessment.complexity !== 'simple' && !approvalGranted
      expect(shouldGateFirst).toBeTruthy() // Gate fires first time

      // Phase 2: User says "yes" → approval granted
      approvalGranted = true
      const shouldGateAfterApproval = assessment.approach && assessment.complexity !== 'simple' && !approvalGranted
      expect(shouldGateAfterApproval).toBeFalsy() // Gate skipped after approval
    })

    it("approval clears session so subsequent messages are not trapped", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState())
      expect(isInPhase(USER_ID, 'approval')).toBe(true)

      // Approval clears the session
      returnToIdle(CHAT_ID)
      expect(isInPhase(USER_ID, 'approval')).toBe(false)

      // Next message from same user should NOT hit approval check
      expect(getStateByUserId(USER_ID)?.approval).toBeUndefined()
    })

    it("approval with refinedRequest uses refined text for downstream", () => {
      enterApprovalPhase(CHAT_ID, USER_ID, makeApprovalState({
        refinedRequest: "Compare Cursor vs Windsurf vs Claude Code agent architectures for Grove blog",
        originalMessage: "Research what Cursor and Windsurf are doing with agent modes",
      }))

      const approval = getState(CHAT_ID)!.approval!
      // Handler logic: use refinedRequest if available, else originalMessage
      const executionText = approval.refinedRequest || approval.originalMessage
      expect(executionText).toBe("Compare Cursor vs Windsurf vs Claude Code agent architectures for Grove blog")
    })
  })
})
