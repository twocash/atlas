/**
 * Slot 7: Session Context — Unit Tests
 *
 * Verifies assembleSessionSlot() builds correct slot content,
 * measures tokens without arbitrary limits, and integrates
 * with budget enforcement at priority 10 (trimmed first).
 *
 * Sprint: SLOT-7 (ATLAS-SLOT7-001)
 */

import { describe, test, expect } from "bun:test"
import { assembleSessionSlot, type SessionSlotMetrics } from "../src/context/assembler"
import { createSlot, enforceTokenBudget, estimateTokens } from "../src/context/slots"
import { SLOT_PRIORITIES, SLOT_TOKEN_BUDGETS } from "../src/types/orchestration"
import type { SessionContext } from "../src/types/orchestration"

// ─── Fixtures ─────────────────────────────────────────────

const FULL_SESSION: SessionContext = {
  sessionId: "test-uuid-1234",
  turnNumber: 3,
  priorIntentHash: "hash-abc",
  intentSequence: ["explore", "research", "draft"],
  priorFindings: "The article argues that AI governance requires distributed consensus mechanisms. Key finding: 78% of enterprises lack formal AI policy frameworks.",
  currentDepth: "standard",
  thesisHook: "Governance gap creates market opportunity for tooling",
  topic: "AI governance tooling landscape",
}

const MINIMAL_SESSION: SessionContext = {
  sessionId: "test-uuid-minimal",
  turnNumber: 1,
  intentSequence: [],
}

// ─── Slot Assembly ────────────────────────────────────────

describe("assembleSessionSlot", () => {
  test("returns populated slot when session context provided", () => {
    const { slot, metrics } = assembleSessionSlot(FULL_SESSION)
    expect(slot.id).toBe("session")
    expect(slot.populated).toBe(true)
    expect(slot.tokens).toBeGreaterThan(0)
    expect(slot.source).toBe("conversation-state")
  })

  test("returns empty slot when no session context", () => {
    const { slot, metrics } = assembleSessionSlot(undefined)
    expect(slot.id).toBe("session")
    expect(slot.populated).toBe(false)
    expect(slot.tokens).toBe(0)
    expect(metrics.totalTokens).toBe(0)
  })

  test("includes topic, turn, depth, intent sequence, thesis, and prior findings", () => {
    const { slot } = assembleSessionSlot(FULL_SESSION)
    expect(slot.content).toContain("Topic: AI governance tooling landscape")
    expect(slot.content).toContain("Turn: 3")
    expect(slot.content).toContain("Depth: standard")
    expect(slot.content).toContain("explore → research → draft")
    expect(slot.content).toContain("Thesis: Governance gap")
    expect(slot.content).toContain("Prior findings:")
    expect(slot.content).toContain("78% of enterprises")
  })

  test("handles minimal session (first turn, no prior data)", () => {
    const { slot, metrics } = assembleSessionSlot(MINIMAL_SESSION)
    expect(slot.populated).toBe(true)
    expect(slot.content).toContain("Turn: 1")
    expect(slot.content).not.toContain("Intent sequence:")
    expect(slot.content).not.toContain("Prior findings:")
    expect(metrics.priorFindingsTokens).toBe(0)
    expect(metrics.intentSequenceTokens).toBe(0)
  })
})

// ─── Token Metrics ────────────────────────────────────────

describe("session slot token metrics", () => {
  test("measures total tokens accurately", () => {
    const { slot, metrics } = assembleSessionSlot(FULL_SESSION)
    // Metrics totalTokens should match slot tokens (may differ from content
    // tokens if slot budget truncated, but for normal sizes they match)
    expect(metrics.totalTokens).toBe(slot.tokens)
    expect(metrics.totalTokens).toBeGreaterThan(0)
  })

  test("measures priorFindings tokens separately", () => {
    const { metrics } = assembleSessionSlot(FULL_SESSION)
    const expectedTokens = estimateTokens(FULL_SESSION.priorFindings!)
    expect(metrics.priorFindingsTokens).toBe(expectedTokens)
    expect(metrics.priorFindingsTokens).toBeGreaterThan(0)
  })

  test("measures intentSequence tokens separately", () => {
    const { metrics } = assembleSessionSlot(FULL_SESSION)
    const expectedTokens = estimateTokens(FULL_SESSION.intentSequence.join(" → "))
    expect(metrics.intentSequenceTokens).toBe(expectedTokens)
    expect(metrics.intentSequenceTokens).toBeGreaterThan(0)
  })

  test("wasTrimmed is false for normal-sized sessions", () => {
    const { metrics } = assembleSessionSlot(FULL_SESSION)
    expect(metrics.wasTrimmed).toBe(false)
  })

  test("wasTrimmed is true when content exceeds slot budget", () => {
    const bigSession: SessionContext = {
      ...FULL_SESSION,
      priorFindings: "x".repeat(5000), // Exceeds 1000-token budget (4000 chars)
    }
    const { metrics } = assembleSessionSlot(bigSession)
    expect(metrics.wasTrimmed).toBe(true)
  })
})

// ─── Budget Enforcement ───────────────────────────────────

describe("session slot budget enforcement", () => {
  test("session slot has priority 10 in config", () => {
    expect(SLOT_PRIORITIES.session).toBe(10)
  })

  test("session slot has 1000-token budget in config", () => {
    expect(SLOT_TOKEN_BUDGETS.session).toBe(1000)
  })

  test("session trimmed FIRST when total budget exceeded", () => {
    // Build slots that exceed 8000 total — session (priority 10) should be trimmed first
    const { slot: sessionSlot } = assembleSessionSlot(FULL_SESSION)

    const slots = [
      { id: "intent" as const, source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.intent, populated: true },
      { id: "voice" as const, source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.voice, populated: true },
      { id: "browser" as const, source: "t", content: "x", tokens: 1500, priority: SLOT_PRIORITIES.browser, populated: true },
      { id: "output" as const, source: "t", content: "x", tokens: 500, priority: SLOT_PRIORITIES.output, populated: true },
      { id: "domain_rag" as const, source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.domain_rag, populated: true },
      { ...sessionSlot, tokens: 500 }, // Ensure session is populated
    ]
    // Total = 8500, exceeds 8000

    const budgeted = enforceTokenBudget(slots)
    const session = budgeted.find(s => s.id === "session")!
    const intent = budgeted.find(s => s.id === "intent")!
    const output = budgeted.find(s => s.id === "output")!

    // Session (priority 10) trimmed first
    expect(session.populated).toBe(false)
    expect(session.tokens).toBe(0)
    // High-priority slots survive
    expect(intent.populated).toBe(true)
    expect(output.populated).toBe(true)
  })
})
