/**
 * Master Blaster — Capture Routing Integration Tests (Gate 1.8)
 *
 * 19 real-world URL patterns testing the full capture pipeline:
 * domain extraction → classification → pillar assignment → routing decision.
 *
 * Uses domain pattern matching, NOT specific URL resolution.
 * Each test case validates: pillar, classification method, tier, and Socratic behavior.
 */
import { describe, it, expect } from "bun:test"

import { extractDomain } from "../src/lib/capture-context-extractor"
import { classifyDomain, routeCapture } from "../src/lib/capture-router"
import type { CaptureContext } from "../src/types/capture"
import type { CapturePillar, DomainClassification } from "../src/types/capture"

// ─── Test Helper ────────────────────────────────────────────

interface MasterBlasterCase {
  url: string
  expectedPillar: CapturePillar
  expectedClassification: DomainClassification
  expectedTier: string
  shouldHaveSocratic: boolean
  description: string
}

function runCase(tc: MasterBlasterCase) {
  const domain = extractDomain(tc.url)
  const context: CaptureContext = {
    url: tc.url,
    domain,
    title: `Test Page — ${domain}`,
  }

  const result = routeCapture(context)

  expect(result.pillar).toBe(tc.expectedPillar)
  expect(result.classifiedBy).toBe(tc.expectedClassification)
  expect(result.routingDecision.resolvedTier).toBe(tc.expectedTier)

  if (tc.shouldHaveSocratic) {
    expect(result.socraticQuestion).toBeTruthy()
  } else {
    expect(result.socraticQuestion).toBeUndefined()
  }
}

// ─── Master Blaster Cases ───────────────────────────────────

const MASTER_BLASTER_CASES: MasterBlasterCase[] = [
  // === GROVE-ALIGNED (AI, Research, Developer) ===
  {
    url: "https://github.com/anthropics/claude-code",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "GitHub repo — core developer tool",
  },
  {
    url: "https://arxiv.org/abs/2401.12345",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "arXiv paper — academic research",
  },
  {
    url: "https://huggingface.co/meta-llama/Llama-3-8B",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "Hugging Face model — AI infrastructure",
  },
  {
    url: "https://news.ycombinator.com/item?id=12345678",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "Hacker News — tech discourse",
  },
  {
    url: "https://stackoverflow.com/questions/12345",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "Stack Overflow — developer Q&A",
  },
  {
    url: "https://x.com/karpathy/status/1234567890",
    expectedPillar: "the-grove",
    expectedClassification: "pattern_match",
    expectedTier: "grove",
    shouldHaveSocratic: false,
    description: "X/Twitter — tech discourse",
  },

  // === CONSULTING-ALIGNED (Professional, Business) ===
  {
    url: "https://www.linkedin.com/feed/update/urn:li:activity:1234567890",
    expectedPillar: "consulting",
    expectedClassification: "pattern_match",
    expectedTier: "consulting",
    shouldHaveSocratic: false,
    description: "LinkedIn feed — professional network",
  },
  {
    url: "https://hbr.org/2024/01/the-future-of-work",
    expectedPillar: "consulting",
    expectedClassification: "pattern_match",
    expectedTier: "consulting",
    shouldHaveSocratic: false,
    description: "Harvard Business Review — business strategy",
  },
  {
    url: "https://www.crunchbase.com/organization/anthropic",
    expectedPillar: "consulting",
    expectedClassification: "pattern_match",
    expectedTier: "consulting",
    shouldHaveSocratic: false,
    description: "Crunchbase — company data",
  },

  // === PERSONAL (Shopping, Entertainment) ===
  {
    url: "https://www.amazon.com/dp/B09V3KXJPB",
    expectedPillar: "personal",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "Amazon product — shopping",
  },
  {
    url: "https://www.reddit.com/r/LocalLLaMA/comments/abc123",
    expectedPillar: "personal",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "Reddit — social/community",
  },
  {
    url: "https://www.netflix.com/watch/12345678",
    expectedPillar: "personal",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "Netflix — entertainment",
  },

  // === HOME/GARAGE (DIY, Home Improvement) ===
  {
    url: "https://www.homedepot.com/p/Milwaukee-Drill/123456",
    expectedPillar: "home-garage",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "Home Depot — home improvement",
  },
  {
    url: "https://www.lowes.com/pd/DEWALT-20V-MAX/5001234567",
    expectedPillar: "home-garage",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "Lowes — home improvement",
  },
  {
    url: "https://www.autozone.com/batteries/starting-battery/123",
    expectedPillar: "home-garage",
    expectedClassification: "pattern_match",
    expectedTier: "general",
    shouldHaveSocratic: false,
    description: "AutoZone — automotive",
  },

  // === AMBIGUOUS (Multi-pillar content) ===
  {
    url: "https://medium.com/@author/building-ai-agents-abc123",
    expectedPillar: "the-grove", // Default for ambiguous
    expectedClassification: "socratic",
    expectedTier: "general",
    shouldHaveSocratic: true,
    description: "Medium article — ambiguous, could be any pillar",
  },
  {
    url: "https://substack.com/@author/post-about-startups",
    expectedPillar: "the-grove",
    expectedClassification: "socratic",
    expectedTier: "general",
    shouldHaveSocratic: true,
    description: "Substack — ambiguous, newsletter platform",
  },
  {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    expectedPillar: "the-grove",
    expectedClassification: "socratic",
    expectedTier: "general",
    shouldHaveSocratic: true,
    description: "YouTube — ambiguous, multi-purpose video",
  },

  // === UNKNOWN (No pattern match) ===
  {
    url: "https://obscure-startup.io/product",
    expectedPillar: "personal",
    expectedClassification: "socratic",
    expectedTier: "general",
    shouldHaveSocratic: true,
    description: "Unknown domain — Socratic with domain hint",
  },
]

// ─── Tests ──────────────────────────────────────────────────

describe("Master Blaster: Capture Routing (19 real-world URLs)", () => {
  for (const tc of MASTER_BLASTER_CASES) {
    it(`${tc.description}: ${extractDomain(tc.url)}`, () => {
      runCase(tc)
    })
  }
})

// ─── Summary Stats ──────────────────────────────────────────

describe("Master Blaster: Coverage stats", () => {
  it("has exactly 19 test cases", () => {
    expect(MASTER_BLASTER_CASES.length).toBe(19)
  })

  it("covers all 4 pillars", () => {
    const pillars = new Set(MASTER_BLASTER_CASES.map(tc => tc.expectedPillar))
    expect(pillars.has("the-grove")).toBe(true)
    expect(pillars.has("consulting")).toBe(true)
    expect(pillars.has("personal")).toBe(true)
    expect(pillars.has("home-garage")).toBe(true)
  })

  it("covers all 3 classification methods", () => {
    const methods = new Set(MASTER_BLASTER_CASES.map(tc => tc.expectedClassification))
    expect(methods.has("pattern_match")).toBe(true)
    expect(methods.has("socratic")).toBe(true)
    // fallback is tested via routeQuickCapture in capture-simplification.test.ts
  })

  it("has both Socratic and non-Socratic cases", () => {
    const socraticCases = MASTER_BLASTER_CASES.filter(tc => tc.shouldHaveSocratic)
    const directCases = MASTER_BLASTER_CASES.filter(tc => !tc.shouldHaveSocratic)
    expect(socraticCases.length).toBeGreaterThan(0)
    expect(directCases.length).toBeGreaterThan(0)
  })
})
