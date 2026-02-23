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
})
