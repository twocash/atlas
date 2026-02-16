/**
 * Phase 5 Orchestration Tests — context slots, triage routing,
 * prompt construction, and handler chain integration.
 *
 * Test groups:
 *   1. Slot Helpers — creation, token estimation, budget enforcement
 *   2. Prompt Construction — slot ordering, section formatting
 *   3. Triage Routing — tier→route mapping, kill switch
 *   4. Response Router — landing surface tracking
 *   5. Handler Chain — middleware ordering, next() behavior
 */

import { describe, it, expect } from "bun:test"

// ─── Direct imports (pure logic, no side effects) ────────────────

import {
  createSlot,
  createEmptySlot,
  enforceTokenBudget,
  totalTokens,
  populatedSlotIds,
  estimateTokens,
} from "../src/context/slots"

import {
  constructPrompt,
  buildClaudeMessage,
} from "../src/context/prompt-constructor"

import type { ContextSlot, SlotId, ComplexityTier } from "../src/types/orchestration"
import {
  TIER_ROUTES,
  SLOT_TOKEN_BUDGETS,
  SLOT_PRIORITIES,
  TOTAL_CONTEXT_BUDGET,
} from "../src/types/orchestration"

import {
  setSessionLandingSurface,
  getSessionLandingSurface,
  clearSessionLandingSurface,
} from "../src/handlers/response-router"

import type { AssemblyResult } from "../src/context/assembler"

// ═══════════════════════════════════════════════════════════════
// Group 1: Slot Helpers
// ═══════════════════════════════════════════════════════════════

describe("Slot Helpers", () => {
  describe("estimateTokens", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0)
    })

    it("estimates ~4 chars per token", () => {
      const text = "a".repeat(100) // 100 chars ≈ 25 tokens
      expect(estimateTokens(text)).toBe(25)
    })

    it("rounds up fractional tokens", () => {
      expect(estimateTokens("abc")).toBe(1) // 3/4 = 0.75, ceil = 1
    })
  })

  describe("createSlot", () => {
    it("creates a populated slot with defaults", () => {
      const slot = createSlot({
        id: "intent",
        source: "triage-haiku",
        content: "Intent: query\nPillar: Personal",
      })

      expect(slot.id).toBe("intent")
      expect(slot.source).toBe("triage-haiku")
      expect(slot.populated).toBe(true)
      expect(slot.priority).toBe(SLOT_PRIORITIES.intent)
      expect(slot.tokens).toBeGreaterThan(0)
    })

    it("allows priority override", () => {
      const slot = createSlot({
        id: "browser",
        source: "extension",
        content: "URL: https://example.com",
        priority: 99,
      })

      expect(slot.priority).toBe(99)
    })

    it("truncates content exceeding token budget", () => {
      // Intent slot budget is 500 tokens ≈ 2000 chars
      const longContent = "x".repeat(5000)
      const slot = createSlot({
        id: "intent",
        source: "test",
        content: longContent,
      })

      // Should be truncated to ~500 tokens (2000 chars) + ellipsis
      expect(slot.content.length).toBeLessThan(longContent.length)
      expect(slot.content.endsWith("…")).toBe(true)
      expect(slot.tokens).toBeLessThanOrEqual(SLOT_TOKEN_BUDGETS.intent + 1) // +1 for ellipsis
    })

    it("respects custom maxTokens override", () => {
      const slot = createSlot({
        id: "domain_rag",
        source: "test",
        content: "a".repeat(100),
        maxTokens: 10, // 10 tokens ≈ 40 chars
      })

      expect(slot.content.length).toBeLessThanOrEqual(41) // 40 + ellipsis char
    })
  })

  describe("createEmptySlot", () => {
    it("creates an unpopulated slot", () => {
      const slot = createEmptySlot("pov", "pov-stub")

      expect(slot.id).toBe("pov")
      expect(slot.populated).toBe(false)
      expect(slot.content).toBe("")
      expect(slot.tokens).toBe(0)
      expect(slot.priority).toBe(SLOT_PRIORITIES.pov)
    })
  })

  describe("enforceTokenBudget", () => {
    function makeSlot(id: SlotId, tokens: number, priority: number): ContextSlot {
      return {
        id,
        source: "test",
        content: "x".repeat(tokens * 4),
        tokens,
        priority,
        populated: tokens > 0,
      }
    }

    it("returns slots unchanged if under budget", () => {
      const slots = [
        makeSlot("intent", 100, 90),
        makeSlot("voice", 200, 70),
        makeSlot("output", 50, 100),
      ]

      const result = enforceTokenBudget(slots)
      expect(totalTokens(result)).toBe(350)
      expect(result.every((s) => s.populated)).toBe(true)
    })

    it("trims lowest-priority slots first", () => {
      const slots = [
        makeSlot("intent", 3000, 90),
        makeSlot("domain_rag", 3000, 20),
        makeSlot("voice", 3000, 70),
        makeSlot("output", 3000, 100),
      ]

      // Total: 12000, budget: 8000
      const result = enforceTokenBudget(slots)

      // domain_rag (priority 20) should be trimmed first
      const ragSlot = result.find((s) => s.id === "domain_rag")!
      expect(ragSlot.populated).toBe(false)
      expect(ragSlot.tokens).toBe(0)

      // intent and output should survive
      const intentSlot = result.find((s) => s.id === "intent")!
      expect(intentSlot.populated).toBe(true)

      const outputSlot = result.find((s) => s.id === "output")!
      expect(outputSlot.populated).toBe(true)
    })

    it("preserves original slot ordering", () => {
      const slots = [
        makeSlot("intent", 3000, 90),
        makeSlot("domain_rag", 3000, 20),
        makeSlot("pov", 3000, 30),
        makeSlot("output", 3000, 100),
      ]

      const result = enforceTokenBudget(slots)
      expect(result[0].id).toBe("intent")
      expect(result[1].id).toBe("domain_rag")
      expect(result[2].id).toBe("pov")
      expect(result[3].id).toBe("output")
    })
  })

  describe("populatedSlotIds", () => {
    it("returns only populated slot IDs", () => {
      const slots: ContextSlot[] = [
        { id: "intent", source: "t", content: "x", tokens: 10, priority: 90, populated: true },
        { id: "domain_rag", source: "t", content: "", tokens: 0, priority: 20, populated: false },
        { id: "voice", source: "t", content: "y", tokens: 5, priority: 70, populated: true },
      ]

      expect(populatedSlotIds(slots)).toEqual(["intent", "voice"])
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 2: Prompt Construction
// ═══════════════════════════════════════════════════════════════

describe("Prompt Construction", () => {
  function makeAssembly(overrides?: Partial<AssemblyResult>): AssemblyResult {
    return {
      slots: [
        { id: "intent", source: "triage", content: "Intent: query\nUser message: hello", tokens: 10, priority: 90, populated: true },
        { id: "domain_rag", source: "stub", content: "", tokens: 0, priority: 20, populated: false },
        { id: "pov", source: "stub", content: "", tokens: 0, priority: 30, populated: false },
        { id: "voice", source: "composition", content: "Be concise and direct.", tokens: 5, priority: 70, populated: true },
        { id: "browser", source: "extension", content: "", tokens: 0, priority: 50, populated: false },
        { id: "output", source: "landing", content: "Landing surface: chat\n\nRespond directly in the chat.", tokens: 8, priority: 100, populated: true },
      ],
      triage: { intent: "query", confidence: 0.95, pillar: "Personal", requestType: "Research", keywords: [], complexityTier: 2 as ComplexityTier, source: "haiku" } as any,
      tier: 2 as ComplexityTier,
      route: "claude_code",
      slotsUsed: ["intent", "voice", "output"],
      totalContextTokens: 23,
      triageLatencyMs: 150,
      landingSurface: "chat",
      ...overrides,
    }
  }

  it("includes system preamble", () => {
    const prompt = constructPrompt(makeAssembly())
    expect(prompt).toContain("Atlas")
    expect(prompt).toContain("Chief of Staff")
  })

  it("includes populated slots in order", () => {
    const prompt = constructPrompt(makeAssembly())

    // Intent should come before voice, voice before output
    const intentIdx = prompt.indexOf("## Request")
    const voiceIdx = prompt.indexOf("## Voice & Style")
    const outputIdx = prompt.indexOf("## Output Instructions")

    expect(intentIdx).toBeGreaterThan(-1)
    expect(voiceIdx).toBeGreaterThan(intentIdx)
    expect(outputIdx).toBeGreaterThan(voiceIdx)
  })

  it("excludes unpopulated slots", () => {
    const prompt = constructPrompt(makeAssembly())
    expect(prompt).not.toContain("## Domain Knowledge")
    expect(prompt).not.toContain("## Epistemic Position")
    expect(prompt).not.toContain("## Browser Context")
  })

  it("includes browser context when populated", () => {
    const assembly = makeAssembly({
      slots: [
        { id: "intent", source: "triage", content: "Intent: query", tokens: 5, priority: 90, populated: true },
        { id: "domain_rag", source: "stub", content: "", tokens: 0, priority: 20, populated: false },
        { id: "pov", source: "stub", content: "", tokens: 0, priority: 30, populated: false },
        { id: "voice", source: "comp", content: "Be clear.", tokens: 3, priority: 70, populated: true },
        { id: "browser", source: "ext", content: "URL: https://linkedin.com/in/somebody", tokens: 10, priority: 50, populated: true },
        { id: "output", source: "land", content: "Landing surface: chat", tokens: 5, priority: 100, populated: true },
      ],
    })

    const prompt = constructPrompt(assembly)
    expect(prompt).toContain("## Browser Context")
    expect(prompt).toContain("linkedin.com")
  })

  describe("buildClaudeMessage", () => {
    it("wraps prompt in stream-json format", () => {
      const msg = buildClaudeMessage("Hello Claude")
      expect(msg.type).toBe("user")
      expect(msg.message.role).toBe("user")
      expect(msg.message.content).toBe("Hello Claude")
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 3: Triage Routing
// ═══════════════════════════════════════════════════════════════

describe("Triage Routing", () => {
  describe("TIER_ROUTES", () => {
    it("routes Tier 0 locally", () => {
      expect(TIER_ROUTES[0]).toBe("local")
    })

    it("routes Tier 1 locally", () => {
      expect(TIER_ROUTES[1]).toBe("local")
    })

    it("routes Tier 2 to Claude Code", () => {
      expect(TIER_ROUTES[2]).toBe("claude_code")
    })

    it("routes Tier 3 to Claude Code", () => {
      expect(TIER_ROUTES[3]).toBe("claude_code")
    })
  })

  describe("SLOT_PRIORITIES", () => {
    it("output has highest priority", () => {
      expect(SLOT_PRIORITIES.output).toBeGreaterThan(SLOT_PRIORITIES.intent)
    })

    it("intent has second-highest priority", () => {
      expect(SLOT_PRIORITIES.intent).toBeGreaterThan(SLOT_PRIORITIES.voice)
    })

    it("domain_rag has lowest priority", () => {
      expect(SLOT_PRIORITIES.domain_rag).toBeLessThan(SLOT_PRIORITIES.pov)
    })
  })

  describe("TOTAL_CONTEXT_BUDGET", () => {
    it("is 8000 tokens", () => {
      expect(TOTAL_CONTEXT_BUDGET).toBe(8000)
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 4: Response Router
// ═══════════════════════════════════════════════════════════════

describe("Response Router", () => {
  describe("session landing surface tracking", () => {
    it("defaults to chat when no surface is set", () => {
      expect(getSessionLandingSurface("unknown-session")).toBe("chat")
    })

    it("stores and retrieves landing surface", () => {
      setSessionLandingSurface("session-1", "notion_feed")
      expect(getSessionLandingSurface("session-1")).toBe("notion_feed")
    })

    it("clears landing surface", () => {
      setSessionLandingSurface("session-2", "notion_work_queue")
      clearSessionLandingSurface("session-2")
      expect(getSessionLandingSurface("session-2")).toBe("chat")
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// Group 5: Type Contracts
// ═══════════════════════════════════════════════════════════════

describe("Type Contracts", () => {
  it("SlotId has exactly 6 members", () => {
    const allIds: SlotId[] = ["intent", "domain_rag", "pov", "voice", "browser", "output"]
    expect(allIds.length).toBe(6)

    // Each has a budget and priority
    for (const id of allIds) {
      expect(SLOT_TOKEN_BUDGETS[id]).toBeGreaterThan(0)
      expect(SLOT_PRIORITIES[id]).toBeGreaterThan(0)
    }
  })

  it("ComplexityTier maps exhaustively to routes", () => {
    const tiers: ComplexityTier[] = [0, 1, 2, 3]
    for (const tier of tiers) {
      const route = TIER_ROUTES[tier]
      expect(route === "local" || route === "claude_code").toBe(true)
    }
  })
})
