/**
 * Self-Model Slot Builder Tests
 *
 * Verifies: section assembly, token budget enforcement, health warning
 * inclusion, empty/degraded state output, truncation behavior.
 * Sprint: CONV-ARCH-001
 */

import { describe, it, expect } from "bun:test"
import { buildSelfModelSlotContent, buildEmptySelfModelSlot } from "../slot"
import { SELF_MODEL_DEFAULTS } from "../types"
import type { CapabilityModel } from "../types"
import type { MatchResult } from "../matcher"

// ─── Factories ───────────────────────────────────────────

function createHealthyModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  return {
    skills: [],
    mcpTools: [],
    knowledge: [],
    execution: [],
    integrations: [],
    surfaces: [],
    assembledAt: new Date().toISOString(),
    assemblyDurationMs: 10,
    version: 1,
    health: {
      status: "healthy",
      availableCount: 5,
      degradedCount: 0,
      summary: "5/5 capabilities healthy",
      degradedCapabilities: [],
    },
    ...overrides,
  }
}

function createDegradedModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  return createHealthyModel({
    health: {
      status: "degraded",
      availableCount: 8,
      degradedCount: 3,
      summary: "8/11 capabilities healthy",
      degradedCapabilities: ["skill:disabled-skill", "knowledge:atlas-worldview", "integration:gemini"],
    },
    ...overrides,
  })
}

function createMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    primary: null,
    relevant: [],
    relevantCapabilityNames: [],
    strengths: [],
    limitations: [],
    ...overrides,
  }
}

// ─── Section Assembly ────────────────────────────────────

describe("buildSelfModelSlotContent", () => {
  it("builds all 4 sections when all data present", () => {
    const model = createDegradedModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["health-check", "research_pipeline"],
      strengths: ["2 skill(s) directly match this request"],
      limitations: ["gemini: rate limited"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).toContain("Relevant capabilities:")
    expect(slot.text).toContain("- health-check")
    expect(slot.text).toContain("- research_pipeline")
    expect(slot.text).toContain("Strengths for this request:")
    expect(slot.text).toContain("- 2 skill(s) directly match this request")
    expect(slot.text).toContain("Current limitations:")
    expect(slot.text).toContain("- gemini: rate limited")
    expect(slot.text).toContain("System health: 8/11 capabilities healthy")
    expect(slot.text).toContain("- skill:disabled-skill: degraded")
  })

  it("omits capabilities section when none match", () => {
    const model = createDegradedModel()
    const match = createMatchResult({
      strengths: ["Research pipeline available"],
      limitations: ["gemini: degraded"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).not.toContain("Relevant capabilities:")
    expect(slot.text).toContain("Strengths for this request:")
  })

  it("omits strengths section when none apply", () => {
    const model = createHealthyModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["health-check"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).toContain("Relevant capabilities:")
    expect(slot.text).not.toContain("Strengths for this request:")
  })

  it("omits limitations section when none apply", () => {
    const model = createHealthyModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["health-check"],
      strengths: ["1 skill(s) directly match"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).not.toContain("Current limitations:")
  })

  it("omits health warnings for healthy model", () => {
    const model = createHealthyModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["research_pipeline"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).not.toContain("System health:")
    expect(slot.healthWarnings).toHaveLength(0)
  })

  it("includes health warnings for degraded model", () => {
    const model = createDegradedModel()
    const match = createMatchResult()

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).toContain("System health: 8/11 capabilities healthy")
    expect(slot.healthWarnings).toContain("skill:disabled-skill")
    expect(slot.healthWarnings).toContain("integration:gemini")
    expect(slot.healthWarnings).toHaveLength(3)
  })

  it("includes health warnings for critical model", () => {
    const model = createHealthyModel({
      health: {
        status: "critical",
        availableCount: 2,
        degradedCount: 8,
        summary: "2/10 capabilities healthy",
        degradedCapabilities: ["mcp:notion", "mcp:supabase", "integration:gemini"],
      },
    })
    const match = createMatchResult()

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).toContain("System health: 2/10 capabilities healthy")
    expect(slot.healthWarnings).toHaveLength(3)
  })

  it("returns empty text when all sections empty and model healthy", () => {
    const model = createHealthyModel()
    const match = createMatchResult()

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text).toBe("")
    expect(slot.tokenEstimate).toBe(0)
    expect(slot.relevantCapabilities).toHaveLength(0)
    expect(slot.strengths).toHaveLength(0)
    expect(slot.limitations).toHaveLength(0)
  })

  it("populates structured arrays from match result", () => {
    const model = createHealthyModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["agent-dispatch", "research_pipeline"],
      strengths: ["Strong match", "Research available"],
      limitations: ["Rate limited"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.relevantCapabilities).toEqual(["agent-dispatch", "research_pipeline"])
    expect(slot.strengths).toEqual(["Strong match", "Research available"])
    expect(slot.limitations).toEqual(["Rate limited"])
  })
})

// ─── Token Budget ────────────────────────────────────────

describe("token budget enforcement", () => {
  it("stays within 500-token budget (2000 chars) for normal content", () => {
    const model = createDegradedModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["health-check", "agent-dispatch"],
      strengths: ["2 skills match"],
      limitations: ["gemini degraded"],
    })

    const slot = buildSelfModelSlotContent(model, match)
    const maxChars = SELF_MODEL_DEFAULTS.slotTokenBudget * 4 // 2000

    expect(slot.text.length).toBeLessThanOrEqual(maxChars)
    expect(slot.tokenEstimate).toBeLessThanOrEqual(SELF_MODEL_DEFAULTS.slotTokenBudget)
  })

  it("truncates with ellipsis when exceeding budget", () => {
    const model = createDegradedModel()
    // Generate enough content to exceed 2000 chars
    const manyCapabilities = Array.from({ length: 100 }, (_, i) => `capability-${i}-with-some-extra-padding-text`)
    const manyStrengths = Array.from({ length: 50 }, (_, i) => `Strength number ${i} is that we have capability ${i} available`)
    const manyLimitations = Array.from({ length: 50 }, (_, i) => `Limitation ${i}: service-${i} is degraded`)

    const match = createMatchResult({
      relevantCapabilityNames: manyCapabilities,
      strengths: manyStrengths,
      limitations: manyLimitations,
    })

    const slot = buildSelfModelSlotContent(model, match)
    const maxChars = SELF_MODEL_DEFAULTS.slotTokenBudget * 4

    expect(slot.text.length).toBeLessThanOrEqual(maxChars)
    expect(slot.text.endsWith("\u2026")).toBe(true) // Unicode ellipsis
    expect(slot.tokenEstimate).toBeLessThanOrEqual(SELF_MODEL_DEFAULTS.slotTokenBudget)
  })

  it("computes token estimate as ceil(length / 4)", () => {
    const model = createHealthyModel()
    const match = createMatchResult({
      relevantCapabilityNames: ["health-check"],
    })

    const slot = buildSelfModelSlotContent(model, match)
    const expectedTokens = Math.ceil(slot.text.length / 4)

    expect(slot.tokenEstimate).toBe(expectedTokens)
  })

  it("content just under budget is NOT truncated", () => {
    const model = createHealthyModel()
    // Create content that fits comfortably within 2000 chars
    const caps = Array.from({ length: 20 }, (_, i) => `cap-${i}`)
    const match = createMatchResult({
      relevantCapabilityNames: caps,
      strengths: ["One strength"],
    })

    const slot = buildSelfModelSlotContent(model, match)

    expect(slot.text.endsWith("\u2026")).toBe(false)
    expect(slot.text.length).toBeLessThan(SELF_MODEL_DEFAULTS.slotTokenBudget * 4)
  })
})

// ─── Empty Slot ──────────────────────────────────────────

describe("buildEmptySelfModelSlot", () => {
  it("returns zeroed structure", () => {
    const slot = buildEmptySelfModelSlot()

    expect(slot.relevantCapabilities).toEqual([])
    expect(slot.strengths).toEqual([])
    expect(slot.limitations).toEqual([])
    expect(slot.healthWarnings).toEqual([])
    expect(slot.text).toBe("")
    expect(slot.tokenEstimate).toBe(0)
  })

  it("text is empty string (not null or undefined)", () => {
    const slot = buildEmptySelfModelSlot()

    expect(typeof slot.text).toBe("string")
    expect(slot.text).toBe("")
  })
})
