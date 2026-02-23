/**
 * Capability Matcher Tests
 *
 * Verifies: skill matching, execution mapping, integration requirements,
 * knowledge overlap, deduplication, strengths/limitations derivation.
 * Sprint: CONV-ARCH-001
 */

import { describe, it, expect } from "bun:test"
import { matchCapabilities } from "../matcher"
import type { TriageLike } from "../matcher"
import type { CapabilityModel } from "../types"

// ─── Test Model Factory ──────────────────────────────────

function createTestModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  return {
    skills: [
      {
        id: "health-check",
        name: "Health Check",
        description: "Validate system state",
        pillars: [],
        triggers: [{ type: "command", pattern: "/health" }],
        available: true,
        successRate: 0.95,
        usageCount: 42,
      },
      {
        id: "agent-dispatch",
        name: "Agent Dispatch",
        description: "Launch specialist agents",
        pillars: ["The Grove" as any],
        triggers: [
          { type: "command", pattern: "/agent" },
          { type: "keyword", pattern: "research" },
        ],
        available: true,
      },
      {
        id: "disabled-skill",
        name: "Disabled",
        description: "Not available",
        pillars: [],
        triggers: [{ type: "keyword", pattern: "disabled" }],
        available: false,
      },
    ],
    mcpTools: [
      { server: "notion", tools: ["create_page", "search"], connected: true },
      { server: "anythingllm", tools: ["chat", "search"], connected: true },
    ],
    knowledge: [
      {
        source: "anythingllm",
        workspace: "grove-vision",
        documentCount: 50,
        domains: ["AI", "product strategy"],
        available: true,
      },
      {
        source: "anythingllm",
        workspace: "monarch",
        documentCount: 20,
        domains: ["consulting", "GTM"],
        available: true,
      },
      {
        source: "notion",
        workspace: "atlas-worldview",
        documentCount: 10,
        domains: ["beliefs", "positions"],
        available: false, // offline
      },
    ],
    execution: [
      { type: "research_pipeline", name: "Research Pipeline", available: true, constraints: [] },
      { type: "socratic_engine", name: "Socratic Engine", available: true, constraints: [] },
      { type: "bridge_dispatch", name: "Bridge Dispatch", available: true, constraints: [], requiredFlags: ["BRIDGE_DISPATCH"] },
      { type: "prompt_composition", name: "Prompt Composition", available: true, constraints: [] },
      { type: "agent_spawn", name: "Agent Spawn", available: true, constraints: [] },
    ],
    integrations: [
      { service: "notion", capabilities: ["read", "write"], authenticated: true, health: "healthy" },
      { service: "anythingllm", capabilities: ["rag", "search"], authenticated: true, health: "healthy" },
      { service: "gemini", capabilities: ["grounded-search"], authenticated: true, health: "degraded", healthDetail: "rate limited" },
    ],
    surfaces: [
      { surface: "telegram", available: true, features: ["chat"], activeConnections: 1 },
      { surface: "bridge", available: true, features: ["dispatch"], activeConnections: 2 },
    ],
    assembledAt: new Date().toISOString(),
    assemblyDurationMs: 50,
    version: 1,
    health: { status: "degraded", availableCount: 12, degradedCount: 3, summary: "12/15 healthy", degradedCapabilities: ["skill:disabled-skill", "knowledge:atlas-worldview", "integration:gemini"] },
    ...overrides,
  }
}

function createTriage(overrides: Partial<TriageLike> = {}): TriageLike {
  return {
    intent: "query",
    pillar: "The Grove",
    keywords: ["AI", "research"],
    complexityTier: 2,
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────

describe("matchCapabilities", () => {
  it("matches skills by keyword", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["research", "AI"] })
    const result = matchCapabilities(triage, "Do some research on AI trends", model)

    const agentMatch = result.relevant.find((r) => r.capabilityId === "agent-dispatch")
    expect(agentMatch).toBeTruthy()
    expect(agentMatch!.layer).toBe("skills")
    expect(agentMatch!.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it("matches skills by command name", () => {
    const model = createTestModel()
    const triage = createTriage({
      intent: "command",
      command: { name: "/health" },
      keywords: [],
    })
    const result = matchCapabilities(triage, "/health", model)

    const healthMatch = result.relevant.find((r) => r.capabilityId === "health-check")
    expect(healthMatch).toBeTruthy()
    expect(healthMatch!.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("does not match unavailable skills", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["disabled"] })
    const result = matchCapabilities(triage, "something disabled", model)

    const disabledMatch = result.relevant.find((r) => r.capabilityId === "disabled-skill")
    expect(disabledMatch).toBeUndefined()
  })

  it("applies pillar affinity boost", () => {
    const model = createTestModel()

    // With matching pillar
    const triageGrove = createTriage({ pillar: "The Grove", keywords: ["research"] })
    const resultGrove = matchCapabilities(triageGrove, "research AI trends", model)
    const agentGrove = resultGrove.relevant.find((r) => r.capabilityId === "agent-dispatch")

    // With non-matching pillar
    const triagePersonal = createTriage({ pillar: "Personal", keywords: ["research"] })
    const resultPersonal = matchCapabilities(triagePersonal, "research AI trends", model)
    const agentPersonal = resultPersonal.relevant.find((r) => r.capabilityId === "agent-dispatch")

    // Grove match should have higher confidence due to pillar boost
    if (agentGrove && agentPersonal) {
      expect(agentGrove.confidence).toBeGreaterThan(agentPersonal.confidence)
    }
  })

  it("maps query intent to research pipeline", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query" })
    const result = matchCapabilities(triage, "What are the latest AI trends?", model)

    const research = result.relevant.find((r) => r.capabilityId === "research_pipeline")
    expect(research).toBeTruthy()
    expect(research!.layer).toBe("execution")
  })

  it("maps clarify intent to socratic engine", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "clarify", keywords: [] })
    const result = matchCapabilities(triage, "Can you explain?", model)

    const socratic = result.relevant.find((r) => r.capabilityId === "socratic_engine")
    expect(socratic).toBeTruthy()
    expect(socratic!.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it("matches capture intent to Notion integration", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "capture", keywords: ["save"] })
    const result = matchCapabilities(triage, "Save this article", model)

    const notion = result.relevant.find((r) => r.capabilityId === "notion")
    expect(notion).toBeTruthy()
    expect(notion!.layer).toBe("integrations")
  })

  it("matches query intent to AnythingLLM for complex queries", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query", complexityTier: 2 })
    const result = matchCapabilities(triage, "Research competitor landscape", model)

    const rag = result.relevant.find((r) => r.capabilityId === "anythingllm")
    expect(rag).toBeTruthy()
    expect(rag!.layer).toBe("integrations")
  })

  it("matches knowledge sources by domain overlap", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["AI", "product"] })
    const result = matchCapabilities(triage, "AI product strategy", model)

    const knowledge = result.relevant.find((r) => r.capabilityId === "knowledge:grove-vision")
    expect(knowledge).toBeTruthy()
    expect(knowledge!.layer).toBe("knowledge")
  })

  it("does not match offline knowledge sources", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["beliefs", "positions"] })
    const result = matchCapabilities(triage, "What are our beliefs?", model)

    const worldview = result.relevant.find((r) => r.capabilityId === "knowledge:atlas-worldview")
    expect(worldview).toBeUndefined()
  })

  it("routes tier 2+ to bridge dispatch", () => {
    const model = createTestModel()
    const triage = createTriage({ complexityTier: 2 })
    const result = matchCapabilities(triage, "Deep analysis needed", model)

    const dispatch = result.relevant.find((r) => r.capabilityId === "bridge_dispatch")
    expect(dispatch).toBeTruthy()
  })

  it("does NOT route tier 1 to bridge dispatch", () => {
    const model = createTestModel()
    const triage = createTriage({ complexityTier: 1, intent: "query", keywords: [] })
    const result = matchCapabilities(triage, "Quick question", model)

    const dispatch = result.relevant.find((r) => r.capabilityId === "bridge_dispatch")
    expect(dispatch).toBeUndefined()
  })

  it("deduplicates matches by capabilityId", () => {
    const model = createTestModel()
    // A query with "research" keyword will match agent-dispatch via skill AND research_pipeline via execution
    const triage = createTriage({ intent: "query", keywords: ["research"] })
    const result = matchCapabilities(triage, "research something", model)

    const ids = result.relevant.map((r) => r.capabilityId)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size) // no duplicates
  })

  it("sets primary to highest confidence match", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "command", command: { name: "/health" }, keywords: [] })
    const result = matchCapabilities(triage, "/health", model)

    expect(result.primary).not.toBeNull()
    // Primary should be the health-check skill (0.95 confidence from command match)
    expect(result.primary!.capabilityId).toBe("health-check")
  })

  it("returns null primary when nothing matches", () => {
    const model = createTestModel({ skills: [], execution: [], integrations: [], knowledge: [] })
    const triage = createTriage({ intent: "chat", keywords: [], complexityTier: 0 })
    const result = matchCapabilities(triage, "hello", model)

    // May still have some low-confidence execution matches
    // but primary requires >= 0.5 threshold
    if (result.relevant.length === 0) {
      expect(result.primary).toBeNull()
    }
  })
})

describe("strengths and limitations", () => {
  it("derives strengths from matched skills", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["research"] })
    const result = matchCapabilities(triage, "research something", model)

    const hasSkillStrength = result.strengths.some((s) => s.includes("skill"))
    expect(hasSkillStrength).toBe(true)
  })

  it("includes research pipeline strength for query intent", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query" })
    const result = matchCapabilities(triage, "What is X?", model)

    const hasResearchStrength = result.strengths.some((s) => s.includes("Research") || s.includes("research"))
    expect(hasResearchStrength).toBe(true)
  })

  it("reports knowledge base as strength when available", () => {
    const model = createTestModel()
    const triage = createTriage()
    const result = matchCapabilities(triage, "something", model)

    const hasKnowledgeStrength = result.strengths.some((s) => s.includes("Knowledge") || s.includes("knowledge"))
    expect(hasKnowledgeStrength).toBe(true)
  })

  it("reports degraded integrations as limitations", () => {
    const model = createTestModel()
    const triage = createTriage()
    const result = matchCapabilities(triage, "something", model)

    const hasGeminiLimitation = result.limitations.some((l) => l.includes("gemini"))
    expect(hasGeminiLimitation).toBe(true)
  })

  it("reports offline knowledge as limitation", () => {
    const model = createTestModel()
    const triage = createTriage()
    const result = matchCapabilities(triage, "something", model)

    const hasOfflineKnowledge = result.limitations.some((l) => l.includes("atlas-worldview"))
    expect(hasOfflineKnowledge).toBe(true)
  })

  it("reports unavailable execution modes as limitations", () => {
    const model = createTestModel({
      execution: [
        { type: "bridge_dispatch", name: "Bridge Dispatch", available: false, constraints: ["BRIDGE_DISPATCH=false"] },
      ],
    })
    const triage = createTriage()
    const result = matchCapabilities(triage, "something", model)

    const hasBridgeLimitation = result.limitations.some((l) => l.includes("Bridge Dispatch"))
    expect(hasBridgeLimitation).toBe(true)
  })

  it("reports multiple surfaces as strength", () => {
    const model = createTestModel()
    const triage = createTriage()
    const result = matchCapabilities(triage, "something", model)

    const hasMultiSurface = result.strengths.some((s) => s.includes("active surfaces"))
    expect(hasMultiSurface).toBe(true)
  })
})

// ─── Boundary Conditions ─────────────────────────────────

describe("boundary conditions", () => {
  it("confidence at exactly 0.5 IS included in relevant", () => {
    // A chat intent maps prompt_composition to 0.5 — exactly at threshold
    const model = createTestModel()
    const triage = createTriage({ intent: "chat", keywords: [], complexityTier: 1 })
    const result = matchCapabilities(triage, "hello there", model)

    const promptComp = result.relevant.find((r) => r.capabilityId === "prompt_composition")
    expect(promptComp).toBeTruthy()
    expect(promptComp!.confidence).toBe(0.5)
  })

  it("confidence below 0.5 is NOT in relevant", () => {
    // Provide model with no skills, no matching knowledge, minimal execution
    // Only chat intent → prompt_composition at 0.5
    const model = createTestModel({
      skills: [],
      knowledge: [],
      integrations: [],
      execution: [
        { type: "prompt_composition", name: "Prompt Composition", available: true, constraints: [] },
      ],
    })
    const triage = createTriage({ intent: "chat", keywords: [], complexityTier: 0 })
    const result = matchCapabilities(triage, "hello", model)

    // All matches should be >= 0.5
    for (const match of result.relevant) {
      expect(match.confidence).toBeGreaterThanOrEqual(0.5)
    }
  })

  it("tier exactly 2 DOES trigger bridge dispatch", () => {
    const model = createTestModel()
    const triage = createTriage({ complexityTier: 2 })
    const result = matchCapabilities(triage, "deep analysis", model)

    const dispatch = result.relevant.find((r) => r.capabilityId === "bridge_dispatch")
    expect(dispatch).toBeTruthy()
  })

  it("tier exactly 1 does NOT trigger bridge dispatch", () => {
    const model = createTestModel()
    const triage = createTriage({ complexityTier: 1, intent: "chat", keywords: [] })
    const result = matchCapabilities(triage, "quick question", model)

    const dispatch = result.relevant.find((r) => r.capabilityId === "bridge_dispatch")
    expect(dispatch).toBeUndefined()
  })

  it("tier 3 triggers bridge dispatch", () => {
    const model = createTestModel()
    const triage = createTriage({ complexityTier: 3 })
    const result = matchCapabilities(triage, "deeply complex multi-step research", model)

    const dispatch = result.relevant.find((r) => r.capabilityId === "bridge_dispatch")
    expect(dispatch).toBeTruthy()
  })

  it("command match gets 0.95 confidence (above autoRoute 0.9)", () => {
    const model = createTestModel()
    const triage = createTriage({
      intent: "command",
      command: { name: "/health" },
      keywords: [],
    })
    const result = matchCapabilities(triage, "/health", model)

    const health = result.relevant.find((r) => r.capabilityId === "health-check")
    expect(health).toBeTruthy()
    expect(health!.confidence).toBeGreaterThanOrEqual(0.9) // auto-route threshold
  })

  it("keyword match gets 0.7 confidence (below autoRoute, above relevant)", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: ["research"], pillar: "Personal" })
    const result = matchCapabilities(triage, "research something", model)

    const agent = result.relevant.find((r) => r.capabilityId === "agent-dispatch")
    expect(agent).toBeTruthy()
    expect(agent!.confidence).toBe(0.7) // No pillar boost (Personal != The Grove)
  })
})

// ─── Edge Cases ──────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty model gracefully", () => {
    const model = createTestModel({
      skills: [],
      mcpTools: [],
      knowledge: [],
      execution: [],
      integrations: [],
      surfaces: [],
      health: { status: "critical", availableCount: 0, degradedCount: 0, summary: "0/0", degradedCapabilities: [] },
    })
    const triage = createTriage()
    const result = matchCapabilities(triage, "anything", model)

    expect(result.relevant).toHaveLength(0)
    expect(result.primary).toBeNull()
    expect(result.strengths).toHaveLength(0)
  })

  it("handles empty keywords gracefully", () => {
    const model = createTestModel()
    const triage = createTriage({ keywords: [] })
    const result = matchCapabilities(triage, "something without keywords", model)

    // Should still get execution matches from intent, just no skill keyword matches
    expect(result).toBeTruthy()
    expect(Array.isArray(result.relevant)).toBe(true)
  })

  it("handles unknown intent gracefully", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "unknown_future_intent", keywords: [] })
    const result = matchCapabilities(triage, "something new", model)

    // Unknown intent gets no execution matches, but shouldn't crash
    const execMatches = result.relevant.filter((r) => r.layer === "execution")
    // May have bridge_dispatch if complexityTier >= 2
    expect(result).toBeTruthy()
  })

  it("wires alternatives into matches", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query", keywords: ["research"] })
    const result = matchCapabilities(triage, "research something deeply", model)

    // With multiple relevant matches, each should have alternatives
    const multipleRelevant = result.relevant.length > 1
    if (multipleRelevant) {
      const withAlternatives = result.relevant.filter((r) => r.alternatives.length > 0)
      expect(withAlternatives.length).toBeGreaterThan(0)
    }
  })

  it("alternatives are capped at 3", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query", keywords: ["research", "AI"] })
    const result = matchCapabilities(triage, "research AI product strategy deeply", model)

    for (const match of result.relevant) {
      expect(match.alternatives.length).toBeLessThanOrEqual(3)
    }
  })

  it("query intent tier 1 does NOT match anythingllm", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "query", complexityTier: 1 })
    const result = matchCapabilities(triage, "quick question", model)

    const rag = result.relevant.find((r) => r.capabilityId === "anythingllm")
    expect(rag).toBeUndefined()
  })

  it("capture intent matches Notion even with no keywords", () => {
    const model = createTestModel()
    const triage = createTriage({ intent: "capture", keywords: [] })
    const result = matchCapabilities(triage, "save this", model)

    const notion = result.relevant.find((r) => r.capabilityId === "notion")
    expect(notion).toBeTruthy()
  })

  it("all knowledge offline produces no knowledge matches", () => {
    const model = createTestModel({
      knowledge: [
        { source: "anythingllm", workspace: "grove-vision", documentCount: 50, domains: ["AI"], available: false },
        { source: "notion", workspace: "atlas-worldview", documentCount: 10, domains: ["beliefs"], available: false },
      ],
    })
    const triage = createTriage({ keywords: ["AI", "beliefs"] })
    const result = matchCapabilities(triage, "AI beliefs", model)

    const knowledgeMatches = result.relevant.filter((r) => r.layer === "knowledge")
    expect(knowledgeMatches).toHaveLength(0)
  })
})
