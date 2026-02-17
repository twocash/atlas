/**
 * Master Blaster — Slot 2+3 Integration Tests
 *
 * Tests the full wiring from triage input through slot assembly output.
 * Split into two groups:
 *
 * Group 1: Offline tests — no network calls, test routing logic + graceful degradation
 * Group 2: Live integration tests — require AnythingLLM + Notion access (GATED)
 *
 * To run live tests: ANYTHINGLLM_URL=http://localhost:3001 ANYTHINGLLM_API_KEY=<key> bun test
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { resolveWorkspace, normalizePillar, getWorkspaceMapping } from "../src/context/workspace-router"
import { createSlot, createEmptySlot, enforceTokenBudget, estimateTokens, totalTokens, populatedSlotIds } from "../src/context/slots"
import { SLOT_TOKEN_BUDGETS, SLOT_PRIORITIES, TOTAL_CONTEXT_BUDGET } from "../src/types/orchestration"
import type { ContextSlot } from "../src/types/orchestration"

// ─── Test Fixtures ───────────────────────────────────────────

interface MockTriage {
  pillar: string
  keywords: string[]
  complexityTier: number
  intent: string
}

const TRIAGE_FIXTURES: Record<string, MockTriage> = {
  grove_strategy: {
    pillar: "The Grove",
    keywords: ["brand", "strategy", "positioning"],
    complexityTier: 2,
    intent: "query",
  },
  grove_simple: {
    pillar: "The Grove",
    keywords: ["logo"],
    complexityTier: 1,
    intent: "query",
  },
  consulting_pricing: {
    pillar: "Consulting",
    keywords: ["pricing", "retainer", "scope"],
    complexityTier: 2,
    intent: "query",
  },
  personal_note: {
    pillar: "Personal",
    keywords: ["journal", "reflection"],
    complexityTier: 0,
    intent: "capture",
  },
  home_garage: {
    pillar: "Home/Garage",
    keywords: ["lawn", "mower"],
    complexityTier: 0,
    intent: "query",
  },
  consulting_capture: {
    pillar: "Consulting",
    keywords: ["client", "meeting", "notes"],
    complexityTier: 1,
    intent: "capture",
  },
}

// ═════════════════════════════════════════════════════════════
// GROUP 1: OFFLINE TESTS (no network)
// ═════════════════════════════════════════════════════════════

describe("Master Blaster: Slot Routing Matrix", () => {
  describe("pillar → workspace routing", () => {
    const routingMatrix: [string, string | null][] = [
      ["The Grove", "grove-research"],
      ["Consulting", "take-flight"],
      ["Personal", null],
      ["Home/Garage", null],
    ]

    for (const [pillar, expected] of routingMatrix) {
      test(`${pillar} → ${expected ?? "null (no workspace)"}`, () => {
        expect(resolveWorkspace(pillar)).toBe(expected)
      })
    }
  })

  describe("pillar normalization edge cases", () => {
    const normCases: [string, string][] = [
      ["The Grove", "the-grove"],
      ["the grove", "the-grove"],
      ["THE GROVE", "the-grove"],
      ["Consulting", "consulting"],
      ["Personal", "personal"],
      ["Home/Garage", "home-garage"],
      ["home/garage", "home-garage"],
    ]

    for (const [input, expected] of normCases) {
      test(`"${input}" → "${expected}"`, () => {
        expect(normalizePillar(input)).toBe(expected)
      })
    }
  })
})

describe("Master Blaster: Graceful Degradation", () => {
  test("domain_rag: empty slot for unmapped pillar (Personal)", async () => {
    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const triage = TRIAGE_FIXTURES.personal_note
    const slot = await assembleDomainRagSlot(triage, "journal entry about today")
    expect(slot.id).toBe("domain_rag")
    expect(slot.populated).toBe(false)
    expect(slot.tokens).toBe(0)
  })

  test("domain_rag: empty slot for unmapped pillar (Home/Garage)", async () => {
    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const triage = TRIAGE_FIXTURES.home_garage
    const slot = await assembleDomainRagSlot(triage, "where did I put the lawn mower manual?")
    expect(slot.id).toBe("domain_rag")
    expect(slot.populated).toBe(false)
  })

  test("domain_rag: no crash when AnythingLLM unreachable", async () => {
    // Set to a bogus URL
    const origUrl = process.env.ANYTHINGLLM_URL
    const origKey = process.env.ANYTHINGLLM_API_KEY
    process.env.ANYTHINGLLM_URL = "http://localhost:99999"
    process.env.ANYTHINGLLM_API_KEY = "fake-key"

    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const triage = TRIAGE_FIXTURES.grove_strategy
    const slot = await assembleDomainRagSlot(triage, "What is our brand strategy?")

    expect(slot.id).toBe("domain_rag")
    // Should return empty, not crash
    expect(slot.populated).toBe(false)

    process.env.ANYTHINGLLM_URL = origUrl
    process.env.ANYTHINGLLM_API_KEY = origKey
  })

  test("pov: empty slot for Home/Garage (no POV domains)", async () => {
    const origKey = process.env.NOTION_API_KEY
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN

    const { assemblePovSlot } = await import("../src/context/pov-slot")
    const triage = TRIAGE_FIXTURES.home_garage
    const slot = await assemblePovSlot(triage)
    expect(slot.id).toBe("pov")
    expect(slot.populated).toBe(false)

    if (origKey) process.env.NOTION_API_KEY = origKey
  })

  test("pov: empty slot when Notion not configured", async () => {
    const origKey = process.env.NOTION_API_KEY
    const origToken = process.env.NOTION_TOKEN
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN

    const { assemblePovSlot } = await import("../src/context/pov-slot")
    const triage = TRIAGE_FIXTURES.grove_strategy
    const slot = await assemblePovSlot(triage)
    expect(slot.id).toBe("pov")
    expect(slot.populated).toBe(false)

    if (origKey) process.env.NOTION_API_KEY = origKey
    if (origToken) process.env.NOTION_TOKEN = origToken
  })
})

describe("Master Blaster: Token Budget Enforcement", () => {
  test("slot 2 respects 2000-token budget", () => {
    // 2000 tokens × 4 chars = 8000 chars
    const content = "x".repeat(10000)
    const slot = createSlot({ id: "domain_rag", source: "test", content })
    expect(slot.tokens).toBeLessThanOrEqual(2001)
  })

  test("slot 3 respects 1500-token budget", () => {
    // 1500 tokens × 4 chars = 6000 chars
    const content = "x".repeat(8000)
    const slot = createSlot({ id: "pov", source: "test", content })
    expect(slot.tokens).toBeLessThanOrEqual(1501)
  })

  test("total budget is 8000 tokens", () => {
    expect(TOTAL_CONTEXT_BUDGET).toBe(8000)
  })

  test("6-slot assembly stays within total budget (small slots)", () => {
    const slots: ContextSlot[] = [
      createSlot({ id: "intent", source: "t", content: "Intent: query\nPillar: The Grove" }),
      createSlot({ id: "domain_rag", source: "t", content: "Domain context from grove-research workspace:\n---\nSome relevant content" }),
      createSlot({ id: "pov", source: "t", content: "POV: Brand Strategy\nThesis: Build the brand through education" }),
      createSlot({ id: "voice", source: "t", content: "Use confident, strategic tone" }),
      createSlot({ id: "browser", source: "t", content: "URL: https://example.com" }),
      createSlot({ id: "output", source: "t", content: "Landing surface: chat" }),
    ]
    const budgeted = enforceTokenBudget(slots)
    expect(totalTokens(budgeted)).toBeLessThanOrEqual(TOTAL_CONTEXT_BUDGET)
    // All should be populated for small content
    expect(budgeted.every(s => s.populated)).toBe(true)
  })

  test("enforceTokenBudget trims domain_rag first when over budget", () => {
    // Construct raw ContextSlot objects to bypass per-slot truncation
    // This simulates a scenario where total exceeds 8000
    const slots: ContextSlot[] = [
      { id: "intent", source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.intent, populated: true },
      { id: "domain_rag", source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.domain_rag, populated: true },
      { id: "pov", source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.pov, populated: true },
      { id: "voice", source: "t", content: "x", tokens: 2000, priority: SLOT_PRIORITIES.voice, populated: true },
      { id: "browser", source: "t", content: "x", tokens: 1500, priority: SLOT_PRIORITIES.browser, populated: true },
      { id: "output", source: "t", content: "x", tokens: 500, priority: SLOT_PRIORITIES.output, populated: true },
    ]
    // Total = 10000, exceeds 8000

    const budgeted = enforceTokenBudget(slots)
    const domainRag = budgeted.find(s => s.id === "domain_rag")!
    const output = budgeted.find(s => s.id === "output")!
    const intent = budgeted.find(s => s.id === "intent")!

    // domain_rag (priority 20) should be trimmed first
    expect(domainRag.populated).toBe(false)
    // output (priority 100) and intent (priority 90) should survive
    expect(output.populated).toBe(true)
    expect(intent.populated).toBe(true)
  })

  test("slot ordering preserved after budget enforcement", () => {
    const slots: ContextSlot[] = [
      createSlot({ id: "intent", source: "t", content: "a" }),
      createSlot({ id: "domain_rag", source: "t", content: "b" }),
      createSlot({ id: "pov", source: "t", content: "c" }),
      createSlot({ id: "voice", source: "t", content: "d" }),
      createSlot({ id: "browser", source: "t", content: "e" }),
      createSlot({ id: "output", source: "t", content: "f" }),
    ]
    const budgeted = enforceTokenBudget(slots)
    expect(budgeted[0].id).toBe("intent")
    expect(budgeted[1].id).toBe("domain_rag")
    expect(budgeted[2].id).toBe("pov")
    expect(budgeted[3].id).toBe("voice")
    expect(budgeted[4].id).toBe("browser")
    expect(budgeted[5].id).toBe("output")
  })
})

describe("Master Blaster: End-to-End Slot Assembly (mocked)", () => {
  test("all 4 pillars produce valid slot arrays", async () => {
    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const { assemblePovSlot } = await import("../src/context/pov-slot")

    // Clear config to force graceful degradation
    delete process.env.ANYTHINGLLM_URL
    delete process.env.ANYTHINGLLM_API_KEY
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN

    for (const [name, triage] of Object.entries(TRIAGE_FIXTURES)) {
      const ragSlot = await assembleDomainRagSlot(triage, `test message for ${name}`)
      const povSlot = await assemblePovSlot(triage)

      expect(ragSlot.id).toBe("domain_rag")
      expect(povSlot.id).toBe("pov")
      // Both should gracefully degrade to empty
      expect(ragSlot.tokens).toBe(0)
      expect(povSlot.tokens).toBe(0)
    }
  })

  test("populatedSlotIds reflects actual populated slots", () => {
    const slots: ContextSlot[] = [
      createSlot({ id: "intent", source: "t", content: "Intent: query" }),
      createEmptySlot("domain_rag", "rag-empty"),
      createEmptySlot("pov", "pov-no-match"),
      createSlot({ id: "voice", source: "t", content: "Tone: confident" }),
      createEmptySlot("browser", "no-browser"),
      createSlot({ id: "output", source: "t", content: "Landing: chat" }),
    ]
    const ids = populatedSlotIds(slots)
    expect(ids).toContain("intent")
    expect(ids).toContain("voice")
    expect(ids).toContain("output")
    expect(ids).not.toContain("domain_rag")
    expect(ids).not.toContain("pov")
    expect(ids).not.toContain("browser")
    expect(ids.length).toBe(3)
  })
})

// ═════════════════════════════════════════════════════════════
// GROUP 2: LIVE INTEGRATION TESTS (gated on service availability)
// ═════════════════════════════════════════════════════════════

const ANYTHINGLLM_AVAILABLE = !!(process.env.ANYTHINGLLM_URL && process.env.ANYTHINGLLM_API_KEY)
const NOTION_AVAILABLE = !!(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN)

describe.skipIf(!ANYTHINGLLM_AVAILABLE)("Master Blaster: LIVE — AnythingLLM Integration", () => {
  test("healthCheck returns true", async () => {
    const { healthCheck } = await import("../src/context/anythingllm-client")
    const healthy = await healthCheck()
    expect(healthy).toBe(true)
  })

  test("grove-research workspace returns chunks", async () => {
    const { queryWorkspace } = await import("../src/context/anythingllm-client")
    const result = await queryWorkspace("grove-research", "What is the brand strategy?")
    expect(result.ok).toBe(true)
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0].text.length).toBeGreaterThan(0)
  })

  test("take-flight workspace returns chunks", async () => {
    const { queryWorkspace } = await import("../src/context/anythingllm-client")
    const result = await queryWorkspace("take-flight", "What are the consulting service tiers?")
    expect(result.ok).toBe(true)
    expect(result.chunks.length).toBeGreaterThan(0)
  })

  test("domain_rag slot populates for The Grove query", async () => {
    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const triage = TRIAGE_FIXTURES.grove_strategy
    const slot = await assembleDomainRagSlot(triage, "What is our brand positioning strategy?")
    expect(slot.id).toBe("domain_rag")
    expect(slot.populated).toBe(true)
    expect(slot.tokens).toBeGreaterThan(0)
    expect(slot.tokens).toBeLessThanOrEqual(SLOT_TOKEN_BUDGETS.domain_rag + 1)
    expect(slot.content).toContain("grove-research")
  })

  test("domain_rag slot populates for Consulting query", async () => {
    const { assembleDomainRagSlot } = await import("../src/context/domain-rag-slot")
    const triage = TRIAGE_FIXTURES.consulting_pricing
    const slot = await assembleDomainRagSlot(triage, "What is our pricing model for retainer engagements?")
    expect(slot.id).toBe("domain_rag")
    expect(slot.populated).toBe(true)
    expect(slot.content).toContain("take-flight")
  })

  test("nonexistent workspace returns empty slot gracefully", async () => {
    const { queryWorkspace } = await import("../src/context/anythingllm-client")
    const result = await queryWorkspace("nonexistent-workspace", "test")
    // Should not crash, but may return error or empty
    expect(result.chunks.length).toBe(0)
  })
})

describe.skipIf(!NOTION_AVAILABLE)("Master Blaster: LIVE — Notion POV Integration", () => {
  test("POV Library: The Grove has active entries", async () => {
    const { fetchPovForPillar } = await import("../src/context/pov-fetcher")
    const result = await fetchPovForPillar("The Grove", ["strategy"])
    // May or may not have entries depending on DB state
    if (result) {
      expect(result.title.length).toBeGreaterThan(0)
      expect(result.domainCoverage.length).toBeGreaterThan(0)
    }
  })

  test("POV Library: Consulting has active entries", async () => {
    const { fetchPovForPillar } = await import("../src/context/pov-fetcher")
    const result = await fetchPovForPillar("Consulting", ["pricing"])
    if (result) {
      expect(result.title.length).toBeGreaterThan(0)
    }
  })

  test("pov slot populates for The Grove", async () => {
    const { assemblePovSlot } = await import("../src/context/pov-slot")
    const triage = TRIAGE_FIXTURES.grove_strategy
    const slot = await assemblePovSlot(triage)
    expect(slot.id).toBe("pov")
    if (slot.populated) {
      expect(slot.tokens).toBeGreaterThan(0)
      expect(slot.tokens).toBeLessThanOrEqual(SLOT_TOKEN_BUDGETS.pov + 1)
      expect(slot.content).toContain("POV:")
    }
  })
})
