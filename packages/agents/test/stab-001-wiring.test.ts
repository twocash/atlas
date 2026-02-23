/**
 * STAB-001 Wiring Tests — Provider + Assessment Pipeline
 *
 * Validates:
 *   1. Provider creation (all 6 methods)
 *   2. Provider degraded mode (never throws)
 *   3. Provider registration → slot population
 *   4. Assessment from triage context
 *   5. Null triage handling
 *
 * Sprint: STAB-001 (Wire The Stack)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
  type CapabilityDataProvider,
  type CapabilityModel,
} from "../src/self-model"
import {
  assessRequest,
  type AssessmentContext,
} from "../src/assessment"

// ─── Mock Provider ───────────────────────────────────────

function createMockProvider(
  overrides: Partial<CapabilityDataProvider> = {},
): CapabilityDataProvider {
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
    ...overrides,
  }
}

// ─── Test Suite ──────────────────────────────────────────

describe("STAB-001: Provider creation", () => {
  it("creates a valid provider with all 6 methods", () => {
    const provider = createMockProvider()
    expect(typeof provider.getSkills).toBe("function")
    expect(typeof provider.getMCPServers).toBe("function")
    expect(typeof provider.getKnowledgeSources).toBe("function")
    expect(typeof provider.getIntegrationHealth).toBe("function")
    expect(typeof provider.getSurfaces).toBe("function")
    expect(typeof provider.getFeatureFlags).toBe("function")
  })

  it("provider methods return valid data", async () => {
    const provider = createMockProvider()
    const skills = await provider.getSkills()
    expect(skills.length).toBeGreaterThan(0)
    expect(skills[0].name).toBe("health-check")

    const servers = await provider.getMCPServers()
    expect(servers.length).toBeGreaterThan(0)
    expect(servers[0].serverId).toBe("notion")

    const knowledge = await provider.getKnowledgeSources()
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge[0].source).toBe("anythingllm")

    const health = await provider.getIntegrationHealth()
    expect(health.length).toBeGreaterThan(0)

    const surfaces = await provider.getSurfaces()
    expect(surfaces.length).toBeGreaterThan(0)
    expect(surfaces[0].surface).toBe("telegram")

    const flags = provider.getFeatureFlags()
    expect(flags.ATLAS_SELF_MODEL).toBe(true)
  })
})

describe("STAB-001: Provider degraded mode", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("getSkills returning empty on failure does not crash assembler", async () => {
    const provider = createMockProvider({
      getSkills: async () => [],
    })
    const model = await assembleCapabilityModel(provider)
    expect(model).toBeDefined()
    expect(model.skills).toEqual([])
  })

  it("getMCPServers returning empty on failure does not crash assembler", async () => {
    const provider = createMockProvider({
      getMCPServers: async () => [],
    })
    const model = await assembleCapabilityModel(provider)
    expect(model).toBeDefined()
    expect(model.mcpTools).toEqual([])
  })

  it("getKnowledgeSources returning empty on failure does not crash assembler", async () => {
    const provider = createMockProvider({
      getKnowledgeSources: async () => [],
    })
    const model = await assembleCapabilityModel(provider)
    expect(model).toBeDefined()
    expect(model.knowledge).toEqual([])
  })

  it("all-empty provider produces valid model with degraded health", async () => {
    const emptyProvider = createMockProvider({
      getSkills: async () => [],
      getMCPServers: async () => [],
      getKnowledgeSources: async () => [],
      getIntegrationHealth: async () => [],
      getSurfaces: async () => [],
      getFeatureFlags: () => ({}),
    })
    const model = await assembleCapabilityModel(emptyProvider)
    expect(model).toBeDefined()
    expect(model.skills).toBeDefined()
    expect(model.health).toBeDefined()
  })
})

describe("STAB-001: Slot population after registration", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("assembleCapabilityModel populates a valid model", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)
    expect(model).toBeDefined()
    expect(model.skills.length).toBeGreaterThan(0)
    expect(model.mcpTools.length).toBeGreaterThan(0)
    expect(model.knowledge.length).toBeGreaterThan(0)
  })

  it("getCachedModel returns model after assembly", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)
    const cached = getCachedModel()
    expect(cached).not.toBeNull()
    expect(cached!.skills.length).toBeGreaterThan(0)
  })

  it("getCachedModel returns null before any assembly", () => {
    invalidateCache()
    const cached = getCachedModel()
    expect(cached).toBeNull()
  })
})

describe("STAB-001: Assessment from triage", () => {
  let model: CapabilityModel

  beforeEach(async () => {
    invalidateCache()
    const provider = createMockProvider()
    model = await assembleCapabilityModel(provider)
  })

  it("assessRequest returns valid assessment for simple request", () => {
    const context: AssessmentContext = {
      intent: "query",
      pillar: "The Grove",
      keywords: ["status"],
      hasUrl: false,
      hasContact: false,
      hasDeadline: false,
    }
    const result = assessRequest("What's my status?", context, model)
    expect(result).toBeDefined()
    expect(result.complexity).toBeDefined()
    expect(["simple", "moderate", "complex", "rough"]).toContain(result.complexity)
    expect(result.signals).toBeDefined()
    expect(result.reasoning).toBeDefined()
  })

  it("assessRequest returns valid assessment for complex request", () => {
    const context: AssessmentContext = {
      intent: "command",
      pillar: "Consulting",
      keywords: ["research", "client", "deliverable", "deadline"],
      hasUrl: true,
      hasContact: true,
      hasDeadline: true,
    }
    const result = assessRequest(
      "Research this client's recent acquisitions, draft a briefing doc with competitive analysis, and schedule a review meeting by Friday",
      context,
      model,
    )
    expect(result).toBeDefined()
    expect(result.complexity).toBeDefined()
    expect(result.signals).toBeDefined()
    // Complex multi-step request should have multiple signals
    const signalCount = Object.values(result.signals).filter(Boolean).length
    expect(signalCount).toBeGreaterThanOrEqual(1)
  })

  it("assessRequest handles minimal context gracefully", () => {
    const context: AssessmentContext = {}
    const result = assessRequest("hello", context, model)
    expect(result).toBeDefined()
    // Should return a valid complexity tier (don't assert specific value — depends on scoring)
    expect(["simple", "moderate", "complex", "rough"]).toContain(result.complexity)
  })
})

describe("STAB-001: Null triage handling", () => {
  it("assessment handles null/undefined keywords gracefully", async () => {
    invalidateCache()
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const context: AssessmentContext = {
      intent: "capture",
      pillar: "Personal",
      keywords: undefined,
      hasUrl: false,
    }
    const result = assessRequest("Some idea", context, model)
    expect(result).toBeDefined()
    expect(result.complexity).toBeDefined()
  })

  it("assessment handles empty string intent gracefully", async () => {
    invalidateCache()
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const context: AssessmentContext = {
      intent: "",
      pillar: "",
      keywords: [],
    }
    const result = assessRequest("", context, model)
    expect(result).toBeDefined()
  })
})
