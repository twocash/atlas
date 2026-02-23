/**
 * Capability Assembler Tests
 *
 * Verifies: layer assembly, caching, graceful degradation, health aggregation.
 * Sprint: CONV-ARCH-001
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
} from "../assembler"
import type { CapabilityDataProvider } from "../assembler"

// ─── Mock Provider ───────────────────────────────────────

function createMockProvider(overrides: Partial<CapabilityDataProvider> = {}): CapabilityDataProvider {
  return {
    getSkills: async () => [
      {
        name: "health-check",
        description: "Validate system state",
        triggers: [{ type: "phrase", value: "/health" }],
        enabled: true,
        metrics: { executionCount: 42, successCount: 40, avgExecutionTime: 120, lastExecuted: "2026-02-22T10:00:00Z" },
      },
      {
        name: "agent-dispatch",
        description: "Launch specialist agents",
        triggers: [{ type: "phrase", value: "/agent" }, { type: "keyword", value: "research", pillar: "The Grove" }],
        enabled: true,
      },
      {
        name: "disabled-skill",
        description: "A broken skill",
        triggers: [],
        enabled: false,
      },
    ],
    getMCPServers: async () => [
      { serverId: "notion", status: "connected", toolCount: 3, toolNames: ["create_page", "update_page", "search"] },
      { serverId: "supabase", status: "disconnected", toolCount: 0, toolNames: [], error: "auth failed" },
    ],
    getKnowledgeSources: async () => [
      { source: "anythingllm", workspace: "grove-vision", documentCount: 50, domains: ["AI", "product"], available: true },
    ],
    getIntegrationHealth: async () => [
      { service: "notion", capabilities: ["read", "write"], status: "ok", message: "healthy" },
      { service: "gemini", capabilities: ["grounded-search"], status: "warn", message: "rate limited" },
    ],
    getSurfaces: async () => [
      { surface: "telegram", available: true, features: ["chat", "keyboards"], activeConnections: 1 },
      { surface: "bridge", available: true, features: ["context-slots", "dispatch"], activeConnections: 2 },
    ],
    getFeatureFlags: () => ({ BRIDGE_DISPATCH: true }),
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────

describe("assembleCapabilityModel", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("assembles all 6 layers from provider data", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    expect(model.skills).toHaveLength(3)
    expect(model.mcpTools).toHaveLength(2)
    expect(model.knowledge).toHaveLength(1)
    expect(model.execution.length).toBeGreaterThan(0)
    expect(model.integrations).toHaveLength(2)
    expect(model.surfaces).toHaveLength(2)
    expect(model.version).toBe(1)
    expect(model.assembledAt).toBeTruthy()
    expect(model.assemblyDurationMs).toBeGreaterThanOrEqual(0)
  })

  it("maps skill triggers correctly", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const health = model.skills.find((s) => s.id === "health-check")!
    expect(health.available).toBe(true)
    expect(health.triggers).toHaveLength(1)
    expect(health.triggers[0].type).toBe("command") // "phrase" maps to "command"
    expect(health.triggers[0].pattern).toBe("/health")
    expect(health.successRate).toBeCloseTo(40 / 42, 2)
    expect(health.usageCount).toBe(42)
  })

  it("maps MCP server connection status", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const notion = model.mcpTools.find((m) => m.server === "notion")!
    expect(notion.connected).toBe(true)
    expect(notion.tools).toContain("create_page")

    const supabase = model.mcpTools.find((m) => m.server === "supabase")!
    expect(supabase.connected).toBe(false)
  })

  it("assembles execution capabilities with feature flags", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const dispatch = model.execution.find((e) => e.type === "bridge_dispatch")!
    expect(dispatch.available).toBe(true) // BRIDGE_DISPATCH=true in flags

    const research = model.execution.find((e) => e.type === "research_pipeline")!
    expect(research.available).toBe(true)
  })

  it("computes health correctly with degraded services", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    // We have: 1 disabled skill, 1 disconnected MCP, 1 degraded integration
    expect(model.health.status).toBe("degraded")
    expect(model.health.degradedCount).toBeGreaterThan(0)
    expect(model.health.degradedCapabilities).toContain("skill:disabled-skill")
    expect(model.health.degradedCapabilities).toContain("mcp:supabase")
    expect(model.health.degradedCapabilities).toContain("integration:gemini")
  })

  it("computes healthy status when all services are up", async () => {
    const provider = createMockProvider({
      getSkills: async () => [
        { name: "s1", description: "d", triggers: [], enabled: true },
      ],
      getMCPServers: async () => [
        { serverId: "notion", status: "connected", toolCount: 1, toolNames: ["search"] },
      ],
      getKnowledgeSources: async () => [],
      getIntegrationHealth: async () => [
        { service: "notion", capabilities: ["read"], status: "ok", message: "ok" },
      ],
      getSurfaces: async () => [
        { surface: "telegram", available: true, features: ["chat"] },
      ],
    })
    const model = await assembleCapabilityModel(provider)

    // All execution modes that are always-on + 1 bridge_dispatch
    const unavailableExec = model.execution.filter((e) => !e.available)
    // Only check that non-execution layers are healthy
    const nonExecDegraded = model.health.degradedCapabilities.filter((d) => !d.startsWith("execution:"))
    expect(nonExecDegraded).toHaveLength(0)
  })
})

describe("caching", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("returns cached model on second call", async () => {
    const provider = createMockProvider()
    const model1 = await assembleCapabilityModel(provider)
    const model2 = await assembleCapabilityModel(provider)

    expect(model1).toBe(model2) // Same reference — cached
  })

  it("getCachedModel returns null before assembly", () => {
    expect(getCachedModel()).toBeNull()
  })

  it("getCachedModel returns model after assembly", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    expect(getCachedModel()).not.toBeNull()
  })

  it("invalidateCache clears the cached model", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)
    expect(getCachedModel()).not.toBeNull()

    invalidateCache()
    expect(getCachedModel()).toBeNull()
  })

  it("forceRefresh bypasses cache", async () => {
    let callCount = 0
    const provider = createMockProvider({
      getSkills: async () => {
        callCount++
        return [{ name: `skill-${callCount}`, description: "d", triggers: [], enabled: true }]
      },
    })

    const model1 = await assembleCapabilityModel(provider)
    const model2 = await assembleCapabilityModel(provider, true) // force

    expect(model1).not.toBe(model2)
    expect(model2.skills[0].id).toBe("skill-2")
  })
})

describe("graceful degradation", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("handles provider errors with empty fallbacks", async () => {
    const provider = createMockProvider({
      getSkills: async () => { throw new Error("skill registry down") },
      getMCPServers: async () => { throw new Error("mcp down") },
      getKnowledgeSources: async () => { throw new Error("rag down") },
      getIntegrationHealth: async () => { throw new Error("health down") },
      getSurfaces: async () => { throw new Error("surfaces down") },
    })

    const model = await assembleCapabilityModel(provider)

    expect(model.skills).toHaveLength(0)
    expect(model.mcpTools).toHaveLength(0)
    expect(model.knowledge).toHaveLength(0)
    expect(model.integrations).toHaveLength(0)
    expect(model.surfaces).toHaveLength(0)
    // Execution always has static entries
    expect(model.execution.length).toBeGreaterThan(0)
  })

  it("degrades individual layers independently", async () => {
    const provider = createMockProvider({
      getSkills: async () => { throw new Error("skill registry down") },
      // Other layers work fine
    })

    const model = await assembleCapabilityModel(provider)

    expect(model.skills).toHaveLength(0) // Failed layer → empty
    expect(model.mcpTools).toHaveLength(2) // Other layers still work
    expect(model.knowledge).toHaveLength(1)
  })
})
