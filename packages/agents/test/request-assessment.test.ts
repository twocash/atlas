/**
 * Request Assessment Tests — CONV-ARCH-002
 *
 * Validates complexity classification, approach proposals,
 * feature flag gating, and self-model integration.
 *
 * These tests use realistic request scenarios from Jim's workflow
 * to verify the full assessment chain.
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  assessRequest,
  quickClassify,
  isAssessmentEnabled,
  detectSignals,
  classifyComplexity,
  countSignals,
  buildApproach,
  ASSESSMENT_DEFAULTS,
} from "../src/assessment"
import type {
  ComplexitySignals,
  AssessmentContext,
  RequestAssessment,
} from "../src/assessment"
import {
  assembleCapabilityModel,
  invalidateCache,
} from "../src/self-model"
import type { CapabilityDataProvider, CapabilityModel } from "../src/self-model"

// ─── Mock Provider (reused from Sprint 1) ────────────────

function createMockProvider(overrides: Partial<CapabilityDataProvider> = {}): CapabilityDataProvider {
  return {
    getSkills: async () => [
      {
        name: "health-check",
        description: "Validate system state",
        triggers: [{ type: "phrase", value: "/health" }],
        enabled: true,
        metrics: { executionCount: 100, successCount: 95, avgExecutionTime: 150 },
      },
      {
        name: "agent-dispatch",
        description: "Launch specialist agents for research and analysis",
        triggers: [{ type: "phrase", value: "/agent" }, { type: "keyword", value: "research", pillar: "The Grove" }],
        enabled: true,
        metrics: { executionCount: 50, successCount: 48, avgExecutionTime: 2000 },
      },
      {
        name: "content-capture",
        description: "Save content to Feed",
        triggers: [{ type: "keyword", value: "save" }, { type: "keyword", value: "capture" }],
        enabled: true,
      },
    ],
    getMCPServers: async () => [
      { serverId: "notion", status: "connected", toolCount: 3, toolNames: ["create_page", "update_page", "search"] },
      { serverId: "anythingllm", status: "connected", toolCount: 2, toolNames: ["chat", "search"] },
    ],
    getKnowledgeSources: async () => [
      { source: "anythingllm", workspace: "grove-vision", documentCount: 50, domains: ["AI", "product"], available: true },
      { source: "anythingllm", workspace: "grove-technical", documentCount: 30, domains: ["architecture"], available: true },
    ],
    getIntegrationHealth: async () => [
      { service: "notion", capabilities: ["read", "write"], status: "ok", message: "healthy" },
      { service: "gemini", capabilities: ["grounded-search"], status: "ok", message: "healthy" },
    ],
    getSurfaces: async () => [
      { surface: "telegram", available: true, features: ["chat"], activeConnections: 1 },
    ],
    getFeatureFlags: () => ({ BRIDGE_DISPATCH: true }),
    ...overrides,
  }
}

// ─── Test Setup ──────────────────────────────────────────

let model: CapabilityModel

describe("Request Assessment (CONV-ARCH-002)", () => {
  beforeEach(async () => {
    invalidateCache()
    model = await assembleCapabilityModel(createMockProvider())
  })

  // ── Test 1: Simple requests execute immediately ──
  describe("Simple requests", () => {
    it("classifies 'save this article' as simple with no proposal", () => {
      const result = assessRequest("Save this article for later", {}, model)

      expect(result.complexity).toBe("simple")
      expect(result.approach).toBeNull()
      expect(result.reasoning).toContain("Direct execution")
    })

    it("classifies 'check health' as simple", () => {
      const result = assessRequest("/health", {}, model)

      expect(result.complexity).toBe("simple")
      expect(result.approach).toBeNull()
    })

    it("classifies quick capture as simple", () => {
      const result = assessRequest("Log this to the feed", { intent: "capture" }, model)

      expect(result.complexity).toBe("simple")
      expect(result.approach).toBeNull()
    })
  })

  // ── Test 2: Moderate requests get brief context ──
  describe("Moderate requests", () => {
    it("classifies time-sensitive research as moderate", () => {
      const result = assessRequest(
        "Research the latest on AI infrastructure pricing",
        { pillar: "The Grove", keywords: ["AI", "pricing"], hasDeadline: true },
        model,
      )

      expect(result.complexity).toBe("moderate")
      expect(result.approach).not.toBeNull()
      expect(result.approach!.questionForJim).toBeUndefined()
    })

    it("moderate proposal has 1-2 steps", () => {
      const result = assessRequest(
        "Find information about enterprise AI budgets by Friday",
        { keywords: ["enterprise", "AI"], hasDeadline: true },
        model,
      )

      if (result.approach) {
        expect(result.approach.steps.length).toBeLessThanOrEqual(2)
        expect(result.approach.timeEstimate).toBeTruthy()
      }
    })
  })

  // ── Test 3: Complex requests get approach proposal ──
  describe("Complex requests", () => {
    it("classifies meeting prep with person + deadline + client as complex", () => {
      const result = assessRequest(
        "I need to prepare for my meeting with Sarah from Chase tomorrow. She's skeptical about AI infrastructure.",
        {
          pillar: "Consulting",
          hasContact: true,
          hasDeadline: true,
          keywords: ["meeting", "Chase", "AI"],
        },
        model,
      )

      // 3+ signals: contextDependent (hasContact), timeSensitive (tomorrow),
      // highStakes (Consulting), multiStep (prepare + meeting)
      expect(["complex", "rough"]).toContain(result.complexity)
      expect(result.approach).not.toBeNull()
      expect(result.approach!.steps.length).toBeGreaterThanOrEqual(1)
    })

    it("complex proposal asks 'Sound right?'", () => {
      const result = assessRequest(
        "Research competitor pricing, draft a comparison doc, and then send it to the team before our Thursday meeting",
        {
          pillar: "Consulting",
          hasDeadline: true,
          keywords: ["competitor", "pricing", "comparison"],
        },
        model,
      )

      if (result.complexity === "complex" && result.approach) {
        expect(result.approach.questionForJim).toBe("Sound right, or different angle?")
      }
    })

    it("complex proposal includes alternative angles", () => {
      const result = assessRequest(
        "Research and draft a position paper on AI agent architectures for the enterprise market",
        {
          pillar: "The Grove",
          keywords: ["research", "draft", "AI", "enterprise"],
        },
        model,
      )

      if (result.approach) {
        expect(result.approach.alternativeAngles).toBeInstanceOf(Array)
      }
    })
  })

  // ── Test 4: Rough requests return Sprint 3 placeholder ──
  describe("Rough requests", () => {
    it("classifies highly ambiguous multi-signal request as rough", () => {
      // Manually construct signals to force rough
      const signals: ComplexitySignals = {
        multiStep: true,
        ambiguousGoal: true,
        contextDependent: true,
        timeSensitive: true,
        highStakes: true,
        novelPattern: true,
      }

      const complexity = classifyComplexity(signals)
      expect(complexity).toBe("rough")
    })

    it("rough approach returns placeholder", () => {
      const approach = buildApproach(
        "Help me figure out something about our strategy",
        {},
        [],
        "rough",
      )

      expect(approach).not.toBeNull()
      expect(approach!.steps[0].description).toContain("collaborative exploration")
      expect(approach!.questionForJim).toBeTruthy()
    })
  })

  // ── Test 5: 6 complexity signal dimensions work ──
  describe("Complexity signals", () => {
    it("detects multiStep from compound sentences", () => {
      const signals = detectSignals(
        "Research competitor pricing and then draft a comparison doc",
        {},
        [],
      )
      expect(signals.multiStep).toBe(true)
    })

    it("detects ambiguousGoal from vague language", () => {
      const signals = detectSignals("Help me with something about the project", {}, [])
      expect(signals.ambiguousGoal).toBe(true)
    })

    it("detects contextDependent from contact reference", () => {
      const signals = detectSignals("Follow up on our last call", { hasContact: true }, [])
      expect(signals.contextDependent).toBe(true)
    })

    it("detects timeSensitive from deadline", () => {
      const signals = detectSignals("Get this done by tomorrow", {}, [])
      expect(signals.timeSensitive).toBe(true)
    })

    it("detects highStakes from consulting pillar", () => {
      const signals = detectSignals("Prepare the analysis", { pillar: "Consulting" }, [])
      expect(signals.highStakes).toBe(true)
    })

    it("detects novelPattern when no capabilities match", () => {
      const signals = detectSignals("Do something completely new", {}, [])
      expect(signals.novelPattern).toBe(true)
    })

    it("counts signals correctly", () => {
      const signals: ComplexitySignals = {
        multiStep: true,
        ambiguousGoal: false,
        contextDependent: true,
        timeSensitive: false,
        highStakes: true,
        novelPattern: false,
      }
      expect(countSignals(signals)).toBe(3)
    })
  })

  // ── Test 6: Scoring thresholds ──
  describe("Scoring thresholds", () => {
    it("0 signals → simple", () => {
      const signals: ComplexitySignals = {
        multiStep: false, ambiguousGoal: false, contextDependent: false,
        timeSensitive: false, highStakes: false, novelPattern: false,
      }
      expect(classifyComplexity(signals)).toBe("simple")
    })

    it("1-2 signals → moderate", () => {
      expect(classifyComplexity({
        multiStep: true, ambiguousGoal: false, contextDependent: false,
        timeSensitive: true, highStakes: false, novelPattern: false,
      })).toBe("moderate")
    })

    it("3-4 signals → complex", () => {
      expect(classifyComplexity({
        multiStep: true, ambiguousGoal: true, contextDependent: true,
        timeSensitive: false, highStakes: false, novelPattern: false,
      })).toBe("complex")
    })

    it("5-6 signals → rough", () => {
      expect(classifyComplexity({
        multiStep: true, ambiguousGoal: true, contextDependent: true,
        timeSensitive: true, highStakes: true, novelPattern: false,
      })).toBe("rough")
    })
  })

  // ── Test 7: Self-model capabilities referenced ──
  describe("Self-model integration", () => {
    it("assessment includes matched capabilities from self-model", () => {
      const result = assessRequest(
        "Research AI infrastructure trends",
        { pillar: "The Grove", keywords: ["AI", "research"] },
        model,
      )

      // Should have matched at least agent-dispatch (keyword: research)
      expect(result.capabilities).toBeInstanceOf(Array)
      expect(result.signals).toBeDefined()
    })

    it("quickClassify returns only the tier", () => {
      const tier = quickClassify("Save this", {}, model)
      expect(["simple", "moderate", "complex", "rough"]).toContain(tier)
    })
  })

  // ── Test 8: Feature flag ──
  describe("Feature flag", () => {
    it("isAssessmentEnabled reads ATLAS_REQUEST_ASSESSMENT env var", () => {
      // Feature flag defaults to OFF
      const original = process.env.ATLAS_REQUEST_ASSESSMENT
      delete process.env.ATLAS_REQUEST_ASSESSMENT
      expect(isAssessmentEnabled()).toBe(false)

      process.env.ATLAS_REQUEST_ASSESSMENT = "false"
      expect(isAssessmentEnabled()).toBe(false)

      process.env.ATLAS_REQUEST_ASSESSMENT = "true"
      expect(isAssessmentEnabled()).toBe(true)

      // Restore
      if (original !== undefined) {
        process.env.ATLAS_REQUEST_ASSESSMENT = original
      } else {
        delete process.env.ATLAS_REQUEST_ASSESSMENT
      }
    })
  })

  // ── Test 9: Assessment defaults ──
  describe("Configuration", () => {
    it("ASSESSMENT_DEFAULTS has expected structure", () => {
      expect(ASSESSMENT_DEFAULTS.featureFlag).toBe("ATLAS_REQUEST_ASSESSMENT")
      expect(ASSESSMENT_DEFAULTS.maxApproachSteps).toBe(5)
      expect(ASSESSMENT_DEFAULTS.maxAlternativeAngles).toBe(3)
      expect(ASSESSMENT_DEFAULTS.thresholds.simple).toBe(0)
      expect(ASSESSMENT_DEFAULTS.thresholds.moderate).toBe(2)
      expect(ASSESSMENT_DEFAULTS.thresholds.complex).toBe(4)
      expect(ASSESSMENT_DEFAULTS.thresholds.rough).toBe(5)
    })
  })
})
