/**
 * STAB-003 Unit Tests — Close the Cognitive Loop
 *
 * Tests for:
 *   1. Approval session store (CRUD, TTL, cleanup)
 *   2. Approval signal matching (positive, negative, ambiguous)
 *   3. Proposal formatting
 *
 * Sprint: STAB-003 (Close the Cognitive Loop)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Approval session store
import {
  storeApprovalSession,
  getApprovalSession,
  getApprovalSessionByUserId,
  hasApprovalSessionForUser,
  removeApprovalSession,
  getApprovalSessionCount,
  clearAllApprovalSessions,
  isApprovalSignal,
  isRejectionSignal,
  formatProposalMessage,
  type PendingApprovalSession,
} from "../src/conversation/approval-session"

import type { RequestAssessment } from "../../../packages/agents/src/assessment/types"
import type { ApproachProposal } from "../../../packages/agents/src/assessment/types"

// ─── Test Helpers ────────────────────────────────────────

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

function makeSession(overrides: Partial<PendingApprovalSession> = {}): PendingApprovalSession {
  return {
    chatId: 12345,
    userId: 67890,
    proposalMessageId: 111,
    proposal: makeProposal(),
    originalMessage: "Research competitor pricing and draft a comparison",
    assessment: makeAssessment(),
    assessmentContext: {},
    createdAt: Date.now(),
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────

describe("STAB-003: Close the Cognitive Loop", () => {
  beforeEach(() => {
    clearAllApprovalSessions()
  })

  // ── 1. Approval Session Store ──

  describe("Approval Session Store", () => {
    it("stores and retrieves by chatId", () => {
      const session = makeSession()
      storeApprovalSession(session)

      const retrieved = getApprovalSession(12345)
      expect(retrieved).toBeDefined()
      expect(retrieved!.chatId).toBe(12345)
      expect(retrieved!.userId).toBe(67890)
      expect(retrieved!.proposal.steps).toHaveLength(2)
    })

    it("retrieves by userId", () => {
      storeApprovalSession(makeSession())

      const retrieved = getApprovalSessionByUserId(67890)
      expect(retrieved).toBeDefined()
      expect(retrieved!.chatId).toBe(12345)
    })

    it("hasApprovalSessionForUser returns true when session exists", () => {
      storeApprovalSession(makeSession())
      expect(hasApprovalSessionForUser(67890)).toBe(true)
    })

    it("hasApprovalSessionForUser returns false when no session", () => {
      expect(hasApprovalSessionForUser(99999)).toBe(false)
    })

    it("removes session", () => {
      storeApprovalSession(makeSession())
      expect(getApprovalSession(12345)).toBeDefined()

      removeApprovalSession(12345)
      expect(getApprovalSession(12345)).toBeUndefined()
    })

    it("latest session wins per chat", () => {
      storeApprovalSession(makeSession({ proposalMessageId: 111 }))
      storeApprovalSession(makeSession({ proposalMessageId: 222 }))

      const retrieved = getApprovalSession(12345)
      expect(retrieved!.proposalMessageId).toBe(222)
    })

    it("counts active sessions", () => {
      storeApprovalSession(makeSession({ chatId: 1, userId: 1 }))
      storeApprovalSession(makeSession({ chatId: 2, userId: 2 }))

      expect(getApprovalSessionCount()).toBe(2)
    })

    it("clearAll removes everything", () => {
      storeApprovalSession(makeSession({ chatId: 1, userId: 1 }))
      storeApprovalSession(makeSession({ chatId: 2, userId: 2 }))

      clearAllApprovalSessions()
      expect(getApprovalSessionCount()).toBe(0)
    })
  })

  // ── 2. TTL Expiry ──

  describe("TTL Expiry", () => {
    it("expired session returns undefined on get", () => {
      const session = makeSession({ createdAt: Date.now() - 6 * 60 * 1000 }) // 6 min ago
      storeApprovalSession(session)

      expect(getApprovalSession(12345)).toBeUndefined()
    })

    it("expired session returns false on hasForUser", () => {
      const session = makeSession({ createdAt: Date.now() - 6 * 60 * 1000 })
      storeApprovalSession(session)

      expect(hasApprovalSessionForUser(67890)).toBe(false)
    })

    it("non-expired session (4 min) still accessible", () => {
      const session = makeSession({ createdAt: Date.now() - 4 * 60 * 1000 })
      storeApprovalSession(session)

      expect(getApprovalSession(12345)).toBeDefined()
    })

    it("storing cleans expired sessions", () => {
      // Store an expired session
      storeApprovalSession(makeSession({ chatId: 1, userId: 1, createdAt: Date.now() - 6 * 60 * 1000 }))
      // Store a fresh session — should clean the expired one
      storeApprovalSession(makeSession({ chatId: 2, userId: 2 }))

      expect(getApprovalSessionCount()).toBe(1)
    })
  })

  // ── 3. Approval Signal Matching ──

  describe("Approval Signal Matching", () => {
    const approvalCases = [
      "yes", "Yeah", "yep", "YUP", "sure", "ok", "okay",
      "go", "do it", "sounds good", "looks good",
      "let's go", "lets go", "proceed", "approved", "approve",
      "right", "correct", "exactly", "perfect",
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

  // ── 4. Refined Request Storage ──

  describe("Refined Request Storage", () => {
    it("stores and retrieves refinedRequest", () => {
      const session = makeSession({
        refinedRequest: "Compare competitor pricing models for enterprise AI infrastructure",
      })
      storeApprovalSession(session)

      const retrieved = getApprovalSession(12345)
      expect(retrieved!.refinedRequest).toBe(
        "Compare competitor pricing models for enterprise AI infrastructure"
      )
    })

    it("session without refinedRequest has undefined", () => {
      storeApprovalSession(makeSession())

      const retrieved = getApprovalSession(12345)
      expect(retrieved!.refinedRequest).toBeUndefined()
    })
  })

  // ── 5. Proposal Formatting ──

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
  })
})
