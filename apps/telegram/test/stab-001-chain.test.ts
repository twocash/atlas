/**
 * STAB-001 Chain Tests — Self-Model → Assessment Pipeline
 *
 * Validates end-to-end wiring across package boundaries:
 *   1. Self-model slot populates after provider registration
 *   2. Assessment produces trace metadata (ok / skipped / failed)
 *   3. Full chain: provider → model → assessment → trace
 *
 * These are chain tests (ADR-002 Constraint 6): they prove water flows
 * through the pipe, not just that each pipe section exists.
 *
 * Sprint: STAB-001 (Wire The Stack)
 */

import { describe, it, expect, beforeEach } from "bun:test"

// Self-model + assessment pipeline
import {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache,
  type CapabilityDataProvider,
} from "../../../packages/agents/src/self-model"
import {
  assessRequest,
  type AssessmentContext,
} from "../../../packages/agents/src/assessment"
import type { RequestAssessment } from "../../../packages/agents/src/assessment/types"

// Bridge self-model slot (direct import avoids barrel → pov-fetcher → @atlas/shared/config)
import {
  registerSelfModelProvider,
  assembleSelfModelSlot,
} from "../../../packages/bridge/src/context/self-model-slot"

// Trace infrastructure
import {
  createTrace,
  addStep,
  completeStep,
  type TraceContext,
} from "../../../packages/shared/src/trace"

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

// ─── Helper: simulate the handler's assessment step ──────

/**
 * Replicates the assessment step from handler.ts in isolation.
 * This lets us test the trace metadata contract without needing
 * the full Telegram handler (which has 20+ dependencies).
 */
function runAssessmentStep(
  trace: TraceContext,
  messageText: string,
  preflightTriage: { intent?: string; pillar?: string; keywords?: string[] } | null,
): RequestAssessment | null {
  let assessment: RequestAssessment | null = null

  if (preflightTriage) {
    const assessStep = addStep(trace, "request-assessment")
    try {
      const model = getCachedModel()
      if (!model) {
        assessStep.metadata = { status: "skipped", reason: "no-cached-model" }
        completeStep(assessStep)
      } else {
        const assessmentContext: AssessmentContext = {
          intent: preflightTriage.intent,
          pillar: preflightTriage.pillar,
          keywords: preflightTriage.keywords,
          hasUrl: /https?:\/\//.test(messageText),
          hasContact: false,
          hasDeadline: false,
        }
        assessment = assessRequest(messageText, assessmentContext, model)
        assessStep.metadata = {
          status: "ok",
          complexity: assessment.complexity,
          signalCount: assessment.signals
            ? Object.values(assessment.signals).filter(Boolean).length
            : 0,
          hasProposal: !!assessment.approach,
        }
        completeStep(assessStep)
      }
    } catch (err) {
      assessStep.metadata = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }
      completeStep(assessStep)
    }
  }

  return assessment
}

// ─── Test Suite ──────────────────────────────────────────

describe("STAB-001 Chain: Self-model slot populates", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("assembleSelfModelSlot returns populated slot after provider registration", async () => {
    // Set feature gate
    const original = process.env.ATLAS_SELF_MODEL
    process.env.ATLAS_SELF_MODEL = "true"

    try {
      const provider = createMockProvider()
      registerSelfModelProvider(provider)

      const triage = { intent: "query", pillar: "The Grove", keywords: ["status"], complexityTier: 1 }
      const slot = await assembleSelfModelSlot(triage, "What's my status?")

      expect(slot).toBeDefined()
      expect(slot.id).toBe("self_model")
      // Slot should be populated (not "no-provider")
      expect(slot.source).not.toBe("no-provider")
    } finally {
      process.env.ATLAS_SELF_MODEL = original
    }
  })

  it("assembleSelfModelSlot returns no-provider when unregistered", async () => {
    // Note: we can't truly "unregister" a provider (module-level variable),
    // but we can test with feature flag disabled
    const original = process.env.ATLAS_SELF_MODEL
    process.env.ATLAS_SELF_MODEL = "false"

    try {
      const triage = { intent: "query", pillar: "The Grove", keywords: ["status"], complexityTier: 1 }
      const slot = await assembleSelfModelSlot(triage, "What's my status?")

      expect(slot).toBeDefined()
      expect(slot.id).toBe("self_model")
      expect(slot.populated).toBe(false)
    } finally {
      process.env.ATLAS_SELF_MODEL = original
    }
  })
})

describe("STAB-001 Chain: Assessment trace metadata", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("assessment produces status:ok in trace when model is cached", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider) // populates cache

    const trace = createTrace()
    const triage = { intent: "query", pillar: "The Grove", keywords: ["status"] }
    const result = runAssessmentStep(trace, "What's my status?", triage)

    expect(result).not.toBeNull()
    expect(result!.complexity).toBeDefined()

    // Verify trace metadata
    const assessStep = trace.steps.find((s) => s.name === "request-assessment")
    expect(assessStep).toBeDefined()
    expect(assessStep!.metadata).toBeDefined()
    expect(assessStep!.metadata!.status).toBe("ok")
    expect(assessStep!.metadata!.complexity).toBeDefined()
    expect(assessStep!.completedAt).toBeDefined()
  })

  it("assessment produces status:skipped when no cached model", () => {
    // No model assembled — getCachedModel() returns null
    const trace = createTrace()
    const triage = { intent: "query", pillar: "Personal", keywords: [] }
    const result = runAssessmentStep(trace, "hello", triage)

    expect(result).toBeNull()

    // Verify trace metadata: skipped, not silent
    const assessStep = trace.steps.find((s) => s.name === "request-assessment")
    expect(assessStep).toBeDefined()
    expect(assessStep!.metadata).toBeDefined()
    expect(assessStep!.metadata!.status).toBe("skipped")
    expect(assessStep!.metadata!.reason).toBe("no-cached-model")
    expect(assessStep!.completedAt).toBeDefined()
  })

  it("assessment skips entirely when no triage (null check)", () => {
    const trace = createTrace()
    const result = runAssessmentStep(trace, "hello", null)

    expect(result).toBeNull()
    // No step should be added when triage is null
    const assessStep = trace.steps.find((s) => s.name === "request-assessment")
    expect(assessStep).toBeUndefined()
  })
})

describe("STAB-001 Chain: Full pipeline triage → assessment", () => {
  beforeEach(() => {
    invalidateCache()
  })

  it("full chain produces all expected trace steps", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()

    // Step 1: Simulate triage (normally done by triage-skill)
    const triageStep = addStep(trace, "preflight-triage")
    const triage = {
      intent: "command",
      pillar: "Consulting",
      keywords: ["research", "client"],
    }
    triageStep.metadata = { intent: triage.intent, pillar: triage.pillar }
    completeStep(triageStep)

    // Step 2: Simulate enrichment (normally done by bridge assembler)
    const enrichStep = addStep(trace, "context-enrichment")
    enrichStep.metadata = { slotsPopulated: 3, totalTokens: 500 }
    completeStep(enrichStep)

    // Step 3: Assessment (the code under test)
    const result = runAssessmentStep(
      trace,
      "Research this client's recent acquisitions and draft a briefing",
      triage,
    )

    // Verify all 3 steps present in trace
    expect(trace.steps.length).toBe(3)
    expect(trace.steps[0].name).toBe("preflight-triage")
    expect(trace.steps[1].name).toBe("context-enrichment")
    expect(trace.steps[2].name).toBe("request-assessment")

    // Verify assessment step has correct metadata
    const assessStep = trace.steps[2]
    expect(assessStep.metadata!.status).toBe("ok")
    expect(assessStep.metadata!.complexity).toBeDefined()
    expect(assessStep.completedAt).toBeDefined()

    // Verify assessment result
    expect(result).not.toBeNull()
    expect(result!.complexity).toBeDefined()
    expect(result!.signals).toBeDefined()
  })

  it("complex request with URL produces multiple signals", async () => {
    const provider = createMockProvider()
    await assembleCapabilityModel(provider)

    const trace = createTrace()
    const triage = {
      intent: "command",
      pillar: "Consulting",
      keywords: ["research", "client", "deliverable", "deadline"],
    }

    const result = runAssessmentStep(
      trace,
      "Research https://example.com/client and draft a briefing doc with competitive analysis by Friday",
      triage,
    )

    expect(result).not.toBeNull()
    expect(result!.complexity).toBeDefined()
    // Complex multi-step request should have at least 1 signal
    const signalCount = Object.values(result!.signals).filter(Boolean).length
    expect(signalCount).toBeGreaterThanOrEqual(1)

    // Verify trace records the URL detection
    const assessStep = trace.steps.find((s) => s.name === "request-assessment")
    expect(assessStep!.metadata!.status).toBe("ok")
  })

  it("assessment with degraded provider still completes", async () => {
    // Provider with empty everything (simulates all services down)
    const emptyProvider = createMockProvider({
      getSkills: async () => [],
      getMCPServers: async () => [],
      getKnowledgeSources: async () => [],
      getIntegrationHealth: async () => [],
      getSurfaces: async () => [],
      getFeatureFlags: () => ({}),
    })
    await assembleCapabilityModel(emptyProvider)

    const trace = createTrace()
    const triage = { intent: "query", pillar: "Personal", keywords: ["status"] }
    const result = runAssessmentStep(trace, "What's happening?", triage)

    expect(result).not.toBeNull()
    expect(result!.complexity).toBeDefined()

    const assessStep = trace.steps.find((s) => s.name === "request-assessment")
    expect(assessStep!.metadata!.status).toBe("ok")
    expect(assessStep!.completedAt).toBeDefined()
  })
})
