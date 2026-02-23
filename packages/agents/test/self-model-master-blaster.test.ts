/**
 * Self-Model Master Blaster Tests
 *
 * 8 critical tests that FAIL HARD — no skip, no catch-and-continue.
 * These validate the self-model infrastructure on every Master Blaster run.
 *
 * Tests verify: assembly, degradation reporting (ADR-008), slot budget,
 * knowledge indexing, telemetry derivation, caching, and health classification.
 *
 * Sprint: CONV-ARCH-001 (Post-Sprint Addendum)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
  matchCapabilities,
  buildSelfModelSlotContent,
  buildEmptySelfModelSlot,
} from "../src/self-model"
import type { CapabilityDataProvider } from "../src/self-model"
import { SELF_MODEL_DEFAULTS, MATCH_THRESHOLDS } from "../src/self-model/types"

// ─── Mock Provider ───────────────────────────────────────

function createMockProvider(overrides: Partial<CapabilityDataProvider> = {}): CapabilityDataProvider {
  return {
    getSkills: async () => [
      {
        name: "health-check",
        description: "Validate system state",
        triggers: [{ type: "phrase", value: "/health" }],
        enabled: true,
        metrics: { executionCount: 100, successCount: 95, avgExecutionTime: 150, lastExecuted: "2026-02-22T10:00:00Z" },
      },
      {
        name: "agent-dispatch",
        description: "Launch specialist agents",
        triggers: [{ type: "phrase", value: "/agent" }, { type: "keyword", value: "research", pillar: "The Grove" }],
        enabled: true,
        metrics: { executionCount: 50, successCount: 48, avgExecutionTime: 2000 },
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
      { source: "anythingllm", workspace: "grove-technical", documentCount: 30, domains: ["architecture", "code"], available: true },
      { source: "anythingllm", workspace: "monarch", documentCount: 20, domains: ["consulting", "strategy"], available: false },
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

// ─── Tests ───────────────────────────────────────────────

describe("Self-Model Master Blaster", () => {
  beforeEach(() => {
    invalidateCache()
  })

  // ── Test 1: Assembles capability model with all 6 layers ──
  it("assembles capability model with all 6 layers populated", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    expect(model.skills.length).toBeGreaterThan(0)
    expect(model.mcpTools.length).toBeGreaterThan(0)
    expect(model.knowledge.length).toBeGreaterThan(0)
    expect(model.execution.length).toBeGreaterThan(0)
    expect(model.integrations.length).toBeGreaterThan(0)
    expect(model.surfaces.length).toBeGreaterThan(0)
    expect(model.version).toBe(SELF_MODEL_DEFAULTS.modelVersion)
    expect(model.assembledAt).toBeTruthy()
    expect(model.assemblyDurationMs).toBeGreaterThanOrEqual(0)
  })

  // ── Test 2: Reports degraded MCP tools (ADR-008) ──
  it("reports degraded MCP tools per ADR-008 — no silent degradation", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    // supabase is disconnected — must appear in degraded list
    const degraded = model.health.degradedCapabilities
    expect(degraded.some((d) => d.includes("supabase"))).toBe(true)

    // Model status must reflect degradation
    expect(model.health.status).not.toBe("healthy")
    expect(model.health.degradedCount).toBeGreaterThan(0)

    // Degraded summary must be human-readable
    expect(model.health.summary).toMatch(/\d+\/\d+ capabilities healthy/)
  })

  // ── Test 3: Returns degraded slot when model is null ──
  it("returns empty slot content when model is unavailable", () => {
    const slot = buildEmptySelfModelSlot()

    expect(slot.relevantCapabilities).toEqual([])
    expect(slot.strengths).toEqual([])
    expect(slot.limitations).toEqual([])
    expect(slot.healthWarnings).toEqual([])
    expect(slot.text).toBe("")
    expect(slot.tokenEstimate).toBe(0)
  })

  // ── Test 4: Respects 500-token slot budget ──
  it("enforces 500-token slot budget on assembled slot content", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const triage = { intent: "query", pillar: "The Grove", keywords: ["AI", "product"], complexityTier: 2 }
    const matchResult = matchCapabilities(triage, "research AI product strategy", model)
    const slot = buildSelfModelSlotContent(model, matchResult)

    const maxChars = SELF_MODEL_DEFAULTS.slotTokenBudget * 4 // 500 tokens * 4 chars/token = 2000 chars
    expect(slot.text.length).toBeLessThanOrEqual(maxChars)
    expect(slot.tokenEstimate).toBeLessThanOrEqual(SELF_MODEL_DEFAULTS.slotTokenBudget)
  })

  // ── Test 5: Includes AnythingLLM workspaces in knowledge layer ──
  it("includes AnythingLLM workspaces in knowledge layer", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const llmSources = model.knowledge.filter((k) => k.source === "anythingllm")
    expect(llmSources.length).toBeGreaterThanOrEqual(2)

    // grove-vision must be available
    const groveVision = llmSources.find((k) => k.workspace === "grove-vision")
    expect(groveVision).toBeTruthy()
    expect(groveVision!.available).toBe(true)
    expect(groveVision!.domains.length).toBeGreaterThan(0)

    // monarch is offline — must be marked unavailable
    const monarch = model.knowledge.find((k) => k.workspace === "monarch")
    expect(monarch).toBeTruthy()
    expect(monarch!.available).toBe(false)
  })

  // ── Test 6: Computes valid skill success rates from telemetry ──
  it("computes valid skill success rates from telemetry data", async () => {
    const provider = createMockProvider()
    const model = await assembleCapabilityModel(provider)

    const healthCheck = model.skills.find((s) => s.id === "health-check")
    expect(healthCheck).toBeTruthy()
    expect(healthCheck!.successRate).toBeDefined()
    expect(healthCheck!.successRate).toBe(0.95) // 95/100
    expect(healthCheck!.usageCount).toBe(100)
    expect(healthCheck!.averageExecutionMs).toBe(150)

    const agentDispatch = model.skills.find((s) => s.id === "agent-dispatch")
    expect(agentDispatch).toBeTruthy()
    expect(agentDispatch!.successRate).toBe(0.96) // 48/50

    // Skill with no metrics should not have successRate
    const disabled = model.skills.find((s) => s.id === "disabled-skill")
    expect(disabled).toBeTruthy()
    expect(disabled!.successRate).toBeUndefined()
  })

  // ── Test 7: Caches model within TTL window ──
  it("caches model within TTL and returns cached on second call", async () => {
    const provider = createMockProvider()

    const model1 = await assembleCapabilityModel(provider)
    const model2 = await assembleCapabilityModel(provider) // should return cached

    // Same object reference — cache hit
    expect(model2).toBe(model1)
    expect(model2.assembledAt).toBe(model1.assembledAt)

    // getCachedModel should also return it
    const cached = getCachedModel()
    expect(cached).toBe(model1)

    // After invalidation, getCachedModel returns null
    invalidateCache()
    expect(getCachedModel()).toBeNull()

    // Small delay so assembledAt differs on force refresh
    await new Promise((r) => setTimeout(r, 5))

    // Force refresh bypasses cache
    const model3 = await assembleCapabilityModel(provider, true)
    expect(model3).not.toBe(model1) // different object
    expect(model3.assembledAt).not.toBe(model1.assembledAt)
  })

  // ── Test 8: Classifies health status correctly ──
  it("classifies health status: healthy / degraded / critical", async () => {
    // Scenario A: All healthy
    const healthyProvider = createMockProvider({
      getMCPServers: async () => [
        { serverId: "notion", status: "connected", toolCount: 3, toolNames: ["a", "b", "c"] },
      ],
      getKnowledgeSources: async () => [
        { source: "anythingllm", workspace: "grove-vision", documentCount: 50, domains: ["AI"], available: true },
      ],
      getIntegrationHealth: async () => [
        { service: "notion", capabilities: ["read"], status: "ok", message: "healthy" },
      ],
      getSkills: async () => [
        { name: "health-check", description: "test", triggers: [], enabled: true },
      ],
    })
    invalidateCache()
    const healthyModel = await assembleCapabilityModel(healthyProvider)
    expect(healthyModel.health.status).toBe("healthy")
    expect(healthyModel.health.degradedCount).toBe(0)

    // Scenario B: Some degraded (< half)
    invalidateCache()
    const degradedModel = await assembleCapabilityModel(createMockProvider())
    // Mock has: 1 disabled skill, 1 disconnected MCP, 1 offline knowledge, 1 degraded integration
    expect(degradedModel.health.status).toBe("degraded")
    expect(degradedModel.health.degradedCount).toBeGreaterThan(0)
    expect(degradedModel.health.degradedCount).toBeLessThanOrEqual(
      degradedModel.health.availableCount + degradedModel.health.degradedCount
    )

    // Scenario C: Critical (> half degraded)
    const criticalProvider = createMockProvider({
      getSkills: async () => [
        { name: "s1", description: "x", triggers: [], enabled: false },
        { name: "s2", description: "x", triggers: [], enabled: false },
      ],
      getMCPServers: async () => [
        { serverId: "a", status: "disconnected", toolCount: 0, toolNames: [] },
        { serverId: "b", status: "disconnected", toolCount: 0, toolNames: [] },
      ],
      getKnowledgeSources: async () => [
        { source: "anythingllm", workspace: "x", documentCount: 0, domains: [], available: false },
      ],
      getIntegrationHealth: async () => [
        { service: "notion", capabilities: [], status: "error", message: "dead" },
      ],
      getSurfaces: async () => [
        { surface: "telegram", available: false, features: [] },
      ],
    })
    invalidateCache()
    const criticalModel = await assembleCapabilityModel(criticalProvider)
    expect(criticalModel.health.status).toBe("critical")
    expect(criticalModel.health.degradedCount).toBeGreaterThan(
      criticalModel.health.availableCount
    )
  })
})
