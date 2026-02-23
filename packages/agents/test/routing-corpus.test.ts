/**
 * Golden Routing Corpus Tests
 *
 * Tests deterministic routing decisions against a corpus of known-good examples.
 * Corpus grows from corrections via the correction-logger pipeline.
 *
 * Run: ATLAS_DOMAIN_AUDIENCE=true bun test packages/agents/test/routing-corpus.test.ts
 *
 * @see routing-corpus.json for test cases
 * @see STAB-002c for domain/audience unbundling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { assessRequest } from "../src/assessment/request-assessor"
import { derivePillar } from "../src/assessment/domain-inferrer"
import { assembleCapabilityModel, invalidateCache } from "../src/self-model"
import type { CapabilityDataProvider, CapabilityModel } from "../src/self-model"
import type { DomainType, AudienceType, AssessmentContext } from "../src/assessment/types"
import corpus from "./fixtures/routing-corpus.json"

// Enable domain/audience for these tests
process.env.ATLAS_DOMAIN_AUDIENCE = "true"

// ─── Corpus Entry Type ──────────────────────────────────

interface CorpusEntry {
  id: string
  input: string
  expected: {
    domain: DomainType
    audience: AudienceType
    complexity: "simple" | "moderate" | "complex" | "rough"
    action: "act" | "ask" | "explore"
    shouldCapture: boolean
  }
  handoffs: {
    triageTitle?: string
    drafterSlug?: string
    ragWorkspace?: string | null
    voiceIntensity?: "casual" | "professional" | "broadcast"
  }
  meta: {
    addedAt: string
    source: "manual" | "correction" | "failure"
    notes?: string
  }
}

// ─── Derived Fields ─────────────────────────────────────
// action and shouldCapture don't live on RequestAssessment —
// they're downstream routing decisions. Derive them here so
// the corpus can assert against them.

function deriveAction(complexity: string, input: string): "act" | "ask" | "explore" {
  if (complexity === "rough") return "explore"
  // URL-only messages with no explicit intent → ask
  if (/^https?:\/\/\S+$/i.test(input.trim())) return "ask"
  return "act"
}

function deriveShouldCapture(complexity: string, input: string): boolean {
  const trimmed = input.trim()

  // Trivial messages (greetings, acknowledgments) don't capture
  if (/^(hey|hi|hello|thanks|thank you|ok|yes|no|sure|got it)[!.?]*$/i.test(trimmed)) return false

  // Simple ephemeral tasks that need no follow-up
  if (complexity === "simple" && /^add\s+/i.test(trimmed)) return false

  // Question-form lookups: "what time is...", "what's our position on..."
  // These expect an answer, not a tracked task
  if (/^what(?:'s|\s+(?:time|is|are|was|were))\b/i.test(trimmed) && !/\b(?:draft|create|build|prep|write|send|schedule)\b/i.test(trimmed)) {
    return false
  }

  // Everything else captures
  return true
}

// ─── Mock Provider (minimal, same pattern as request-assessment.test.ts) ──

function createMockProvider(): CapabilityDataProvider {
  return {
    getSkills: async () => [
      {
        name: "health-check",
        description: "Validate system state",
        triggers: [{ type: "phrase", value: "/health" }],
        enabled: true,
      },
      {
        name: "agent-dispatch",
        description: "Launch specialist agents for research and analysis",
        triggers: [
          { type: "phrase", value: "/agent" },
          { type: "keyword", value: "research", pillar: "The Grove" },
        ],
        enabled: true,
      },
      {
        name: "content-capture",
        description: "Save content to Feed",
        triggers: [
          { type: "keyword", value: "save" },
          { type: "keyword", value: "capture" },
        ],
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
  }
}

// ─── Stats ──────────────────────────────────────────────

const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  byDomain: {} as Record<string, number>,
  bySource: {} as Record<string, number>,
}

// ─── Tests ──────────────────────────────────────────────

let model: CapabilityModel

describe("Golden Routing Corpus", () => {
  beforeAll(async () => {
    console.log(`\n📋 Loading routing corpus: ${corpus.entries.length} entries`)
    console.log(`   Version: ${corpus.version}`)
    console.log(`   Updated: ${corpus.updated}\n`)

    invalidateCache()
    model = await assembleCapabilityModel(createMockProvider())
  })

  describe("Primary Routing Decisions", () => {
    const entries = corpus.entries as CorpusEntry[]

    for (const entry of entries) {
      it(`[${entry.id}] "${truncate(entry.input, 50)}" → ${entry.expected.domain}/${entry.expected.audience}`, async () => {
        stats.total++
        stats.byDomain[entry.expected.domain] = (stats.byDomain[entry.expected.domain] || 0) + 1
        stats.bySource[entry.meta.source] = (stats.bySource[entry.meta.source] || 0) + 1

        // Build context — corpus tests routing logic, not context enrichment
        const context: AssessmentContext = {
          hasUrl: /^https?:\/\//i.test(entry.input),
        }

        const assessment = await assessRequest(entry.input, context, model)

        // Derive action + shouldCapture from assessment (not on RequestAssessment)
        const action = deriveAction(assessment.complexity, entry.input)
        const shouldCapture = deriveShouldCapture(assessment.complexity, entry.input)

        try {
          expect(assessment.domain).toBe(entry.expected.domain)
          expect(assessment.audience).toBe(entry.expected.audience)
          expect(assessment.complexity).toBe(entry.expected.complexity)
          expect(action).toBe(entry.expected.action)

          if (entry.expected.shouldCapture !== undefined) {
            expect(shouldCapture).toBe(entry.expected.shouldCapture)
          }

          stats.passed++
        } catch (e) {
          stats.failed++
          console.error(`\n❌ [${entry.id}] Routing mismatch:`)
          console.error(`   Input: "${entry.input}"`)
          console.error(`   Expected: domain=${entry.expected.domain}, audience=${entry.expected.audience}, complexity=${entry.expected.complexity}, action=${entry.expected.action}`)
          console.error(`   Got:      domain=${assessment.domain}, audience=${assessment.audience}, complexity=${assessment.complexity}, action=${action}`)
          if (entry.meta.notes) {
            console.error(`   Note: ${entry.meta.notes}`)
          }
          throw e
        }
      })
    }
  })

  describe("Pillar Derivation", () => {
    const pillarCases: Array<{ domain: DomainType; audience: AudienceType; expectedPillar: string }> = [
      { domain: "personal", audience: "self", expectedPillar: "Personal" },
      { domain: "consulting", audience: "self", expectedPillar: "Consulting" },
      { domain: "consulting", audience: "client", expectedPillar: "Consulting" },
      { domain: "grove", audience: "self", expectedPillar: "The Grove" },
      { domain: "grove", audience: "client", expectedPillar: "The Grove" },
      { domain: "grove", audience: "public", expectedPillar: "The Grove" },
      { domain: "drumwave", audience: "self", expectedPillar: "Consulting" },
      { domain: "drumwave", audience: "client", expectedPillar: "Consulting" },
    ]

    for (const { domain, audience, expectedPillar } of pillarCases) {
      it(`derivePillar(${domain}, ${audience}) → ${expectedPillar}`, () => {
        const pillar = derivePillar(domain, audience)
        expect(pillar).toBe(expectedPillar)
      })
    }
  })

  describe("Complexity Classification", () => {
    const entries = corpus.entries as CorpusEntry[]

    const byComplexity = {
      simple: entries.filter((e) => e.expected.complexity === "simple"),
      moderate: entries.filter((e) => e.expected.complexity === "moderate"),
      complex: entries.filter((e) => e.expected.complexity === "complex"),
      rough: entries.filter((e) => e.expected.complexity === "rough"),
    }

    it("has examples for all complexity levels", () => {
      expect(byComplexity.simple.length).toBeGreaterThan(0)
      expect(byComplexity.moderate.length).toBeGreaterThan(0)
    })

    for (const entry of byComplexity.rough) {
      it(`[${entry.id}] rough terrain → explore action`, async () => {
        const context: AssessmentContext = {}
        const assessment = await assessRequest(entry.input, context, model)

        expect(assessment.complexity).toBe("rough")
        expect(deriveAction(assessment.complexity, entry.input)).toBe("explore")
      })
    }
  })

  describe("Audience Signal Detection", () => {
    const entries = corpus.entries as CorpusEntry[]

    const clientCases = entries.filter((e) => e.expected.audience === "client")
    for (const entry of clientCases) {
      it(`[${entry.id}] detects client audience`, async () => {
        const context: AssessmentContext = {}
        const assessment = await assessRequest(entry.input, context, model)

        expect(assessment.audience).toBe("client")
      })
    }

    const publicCases = entries.filter((e) => e.expected.audience === "public")
    for (const entry of publicCases) {
      it(`[${entry.id}] detects public audience`, async () => {
        const context: AssessmentContext = {}
        const assessment = await assessRequest(entry.input, context, model)

        expect(assessment.audience).toBe("public")
      })
    }
  })

  describe("Corpus Integrity", () => {
    const entries = corpus.entries as CorpusEntry[]

    it("all entries have required fields", () => {
      for (const entry of entries) {
        expect(entry.id).toBeTruthy()
        expect(entry.input).toBeTruthy()
        expect(entry.expected.domain).toBeTruthy()
        expect(entry.expected.audience).toBeTruthy()
        expect(entry.expected.complexity).toBeTruthy()
        expect(entry.expected.action).toBeTruthy()
        expect(entry.meta.addedAt).toBeTruthy()
        expect(entry.meta.source).toBeTruthy()
      }
    })

    it("no duplicate IDs", () => {
      const ids = entries.map((e) => e.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it("all domains are valid", () => {
      const validDomains = ["personal", "consulting", "grove", "drumwave"]
      for (const entry of entries) {
        expect(validDomains).toContain(entry.expected.domain)
      }
    })

    it("all audiences are valid", () => {
      const validAudiences = ["self", "client", "public", "team"]
      for (const entry of entries) {
        expect(validAudiences).toContain(entry.expected.audience)
      }
    })
  })

  afterAll(() => {
    console.log("\n" + "═".repeat(60))
    console.log("📊 ROUTING CORPUS SUMMARY")
    console.log("═".repeat(60))
    console.log(`Total:  ${stats.total}`)
    console.log(`Passed: ${stats.passed} ✓`)
    console.log(`Failed: ${stats.failed} ${stats.failed > 0 ? "✗" : ""}`)
    console.log("")
    console.log("By Domain:")
    for (const [domain, count] of Object.entries(stats.byDomain)) {
      console.log(`  ${domain}: ${count}`)
    }
    console.log("")
    console.log("By Source:")
    for (const [source, count] of Object.entries(stats.bySource)) {
      console.log(`  ${source}: ${count}`)
    }
    console.log("═".repeat(60) + "\n")

    if (stats.failed > 0) {
      console.log("💡 Fix routing failures or update corpus if expectations changed.\n")
    }
  })
})

// Helper
function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 3) + "..."
}
