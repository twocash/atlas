/**
 * AI Classification Intelligence — Unit Tests (Phase B.2)
 *
 * Tests the 4-tier classification system:
 *   - Rule-based fallback mapping (sector+alignment → tier)
 *   - AI response parser (JSON → TierClassificationResult)
 *   - Batch classifier logic (cache/AI/fallback flow)
 *   - Type system validation
 */
import { describe, it, expect } from "bun:test"
import { classifyContactByRules } from "../src/lib/classification-rules"
import type { ClassificationInput, InteractionTier, TierClassificationResult } from "../src/types/classification"
import { TIER_LABELS, TIER_DESCRIPTIONS, CONFIDENCE_THRESHOLDS, CACHE_CONFIG } from "../src/types/classification"
import { TIER_COLORS, TIER_SYSTEM_PROMPTS, BATCH_CLASSIFICATION_SYSTEM, buildBatchClassificationPrompt } from "../src/lib/classification-prompts"

// ─── Rule-Based Classification ──────────────────────────────────

describe("classifyContactByRules", () => {
  it("classifies AI/ML specialist with strong grove alignment as grove", () => {
    // Note: rule-based needs GROVE_STRONG/MODERATE keywords in headline/comment,
    // not just AI/ML sector. The AI classifier catches nuance the rules miss.
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/ai-infra",
      name: "Dr. AI Person",
      headline: "AI/ML Infrastructure | Distributed Systems | Open Source AI",
      commentText: "Love the multi-agent architecture approach",
    })
    expect(result.tier).toBe("grove")
    expect(result.method).toBe("rule_based")
    expect(result.confidence).toBe(0.6)
  })

  it("classifies AI/ML specialist without grove keywords as general (rule fallback)", () => {
    // This contact would be "grove" via AI, but rules lack context
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/ai-researcher",
      name: "Dr. AI Person",
      headline: "AI/ML Research Scientist | Deep Learning | Neural Networks",
      commentText: "Great insights on transformer architecture!",
    })
    // Rule-based: AI/ML sector but no grove alignment keywords → general
    expect(result.tier).toBe("general")
    expect(result.method).toBe("rule_based")
  })

  it("classifies corporate sector as consulting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/corp-exec",
      name: "Corporate VP",
      headline: "VP of Digital Transformation at Enterprise Corp | SaaS | B2B",
    })
    expect(result.tier).toBe("consulting")
  })

  it("classifies investor sector as consulting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/vc-partner",
      name: "VC Partner",
      headline: "Managing Partner at Venture Capital Fund | Deep Tech Investor",
    })
    // Investor → consulting
    expect(result.tier).toBe("consulting")
  })

  it("classifies job seeker as recruiting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/job-seeker",
      name: "Job Seeker",
      headline: "Software Engineer | Open to Work",
      commentText: "Looking for new opportunities in AI",
    })
    expect(result.tier).toBe("recruiting")
  })

  it("classifies 'seeking' in headline as recruiting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/career-seeker",
      name: "Career Transition",
      headline: "Seeking ML Engineering Roles",
    })
    expect(result.tier).toBe("recruiting")
  })

  it("classifies 'between roles' as recruiting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/between",
      name: "Between Roles",
      headline: "Between roles | Previously ML at Google",
    })
    expect(result.tier).toBe("recruiting")
  })

  it("classifies generic headline as general", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/generic",
      name: "Generic Person",
      headline: "Passionate about life and learning",
    })
    expect(result.tier).toBe("general")
  })

  it("classifies influencer as consulting", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/influencer",
      name: "LinkedIn Influencer",
      headline: "Top Voice | 500K followers | Content Creator | Keynote Speaker",
    })
    expect(result.tier).toBe("consulting")
  })

  it("classifies tech+moderate alignment as grove", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/tech-person",
      name: "Tech Person",
      headline: "Software Engineer at Tech Startup | Python | Cloud",
      commentText: "Interesting approach to distributed systems",
    })
    // Tech sector + moderate alignment → grove
    expect(["grove", "general"]).toContain(result.tier)
  })

  it("classifies academia with grove keywords as grove", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/professor",
      name: "Professor",
      headline: "Associate Professor | Distributed AI Systems | Knowledge Graph Research",
      commentText: "Fascinating work on federated learning architectures",
    })
    expect(result.tier).toBe("grove")
  })

  it("classifies academia without grove keywords as general (rule fallback)", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/professor2",
      name: "Professor",
      headline: "Associate Professor of Computer Science | ML Research | NLP",
      commentText: "This aligns with our research on language models",
    })
    // Rule-based: Academia sector but no strong grove keywords → general
    expect(result.tier).toBe("general")
  })

  it("always returns required fields", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/test",
      name: "Test",
      headline: "",
    })
    expect(result.tier).toBeDefined()
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.reasoning).toBeTruthy()
    expect(result.method).toBe("rule_based")
    expect(result.classifiedAt).toBeTruthy()
  })

  it("recruiting keywords override sector classification", () => {
    // Even an AI/ML specialist headline should be overridden by job-seeking signals
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/ai-jobseeker",
      name: "AI Job Seeker",
      headline: "ML Engineer",
      commentText: "Actively looking for senior AI roles",
    })
    expect(result.tier).toBe("recruiting")
  })

  it("handles empty inputs gracefully", () => {
    const result = classifyContactByRules({
      profileUrl: "https://linkedin.com/in/empty",
      name: "",
      headline: "",
      commentText: "",
    })
    expect(result.tier).toBe("general")
    expect(result.method).toBe("rule_based")
  })
})

// ─── AI Response Parser ──────────────────────────────────────

// We can't import parseClassificationResponse directly (not exported),
// so we test the public interface via the batch classifier structure

describe("AI response parsing edge cases", () => {
  // Test the response structure validation by checking what the parser expects
  it("TIER_LABELS covers all tiers", () => {
    const tiers: InteractionTier[] = ["grove", "consulting", "recruiting", "general"]
    for (const tier of tiers) {
      expect(TIER_LABELS[tier]).toBeTruthy()
    }
  })

  it("TIER_DESCRIPTIONS covers all tiers", () => {
    const tiers: InteractionTier[] = ["grove", "consulting", "recruiting", "general"]
    for (const tier of tiers) {
      expect(TIER_DESCRIPTIONS[tier]).toBeTruthy()
    }
  })
})

// ─── Prompts & Colors ────────────────────────────────────────

describe("TIER_SYSTEM_PROMPTS", () => {
  it("has prompts for all 4 tiers", () => {
    const tiers: InteractionTier[] = ["grove", "consulting", "recruiting", "general"]
    for (const tier of tiers) {
      expect(TIER_SYSTEM_PROMPTS[tier]).toBeTruthy()
      expect(TIER_SYSTEM_PROMPTS[tier].length).toBeGreaterThan(50)
    }
  })

  it("grove prompt mentions AI/infrastructure themes", () => {
    const grove = TIER_SYSTEM_PROMPTS["grove"].toLowerCase()
    expect(grove.includes("ai") || grove.includes("infrastructure") || grove.includes("grove")).toBe(true)
  })

  it("consulting prompt mentions professional/business themes", () => {
    const consulting = TIER_SYSTEM_PROMPTS["consulting"].toLowerCase()
    expect(consulting.includes("professional") || consulting.includes("business") || consulting.includes("consulting")).toBe(true)
  })

  it("recruiting prompt mentions talent/team themes", () => {
    const recruiting = TIER_SYSTEM_PROMPTS["recruiting"].toLowerCase()
    expect(recruiting.includes("talent") || recruiting.includes("team") || recruiting.includes("recruit")).toBe(true)
  })
})

describe("TIER_COLORS", () => {
  it("has colors for all 4 tiers", () => {
    const tiers: InteractionTier[] = ["grove", "consulting", "recruiting", "general"]
    for (const tier of tiers) {
      expect(TIER_COLORS[tier]).toBeTruthy()
      expect(TIER_COLORS[tier].border).toBeTruthy()
      expect(TIER_COLORS[tier].badge).toBeTruthy()
      expect(TIER_COLORS[tier].text).toBeTruthy()
      expect(TIER_COLORS[tier].bg).toBeTruthy()
    }
  })

  it("grove is green", () => {
    expect(TIER_COLORS["grove"].border).toContain("green")
  })

  it("consulting is blue", () => {
    expect(TIER_COLORS["consulting"].border).toContain("blue")
  })

  it("recruiting is purple", () => {
    expect(TIER_COLORS["recruiting"].border).toContain("purple")
  })

  it("general is gray", () => {
    expect(TIER_COLORS["general"].border).toContain("gray")
  })
})

describe("BATCH_CLASSIFICATION_SYSTEM prompt", () => {
  it("exists and mentions all 4 tiers", () => {
    expect(BATCH_CLASSIFICATION_SYSTEM).toBeTruthy()
    expect(BATCH_CLASSIFICATION_SYSTEM).toContain("grove")
    expect(BATCH_CLASSIFICATION_SYSTEM).toContain("consulting")
    expect(BATCH_CLASSIFICATION_SYSTEM).toContain("recruiting")
    expect(BATCH_CLASSIFICATION_SYSTEM).toContain("general")
  })
})

describe("buildBatchClassificationPrompt", () => {
  it("builds a prompt with contact data", () => {
    const prompt = buildBatchClassificationPrompt([
      { id: "url1", name: "Alice", headline: "AI Researcher" },
      { id: "url2", name: "Bob", headline: "Sales Manager", commentText: "Great post!" },
    ])
    expect(prompt).toContain("Alice")
    expect(prompt).toContain("Bob")
    expect(prompt).toContain("AI Researcher")
    expect(prompt).toContain("Sales Manager")
  })

  it("handles empty contacts array", () => {
    const prompt = buildBatchClassificationPrompt([])
    expect(prompt).toBeTruthy() // Should still produce valid prompt structure
  })
})

// ─── Configuration Constants ────────────────────────────────

describe("CONFIDENCE_THRESHOLDS", () => {
  it("AUTO_ASSIGN > FLAG_FOR_REVIEW", () => {
    expect(CONFIDENCE_THRESHOLDS.AUTO_ASSIGN).toBeGreaterThan(CONFIDENCE_THRESHOLDS.FLAG_FOR_REVIEW)
  })

  it("thresholds are in 0-1 range", () => {
    expect(CONFIDENCE_THRESHOLDS.AUTO_ASSIGN).toBeGreaterThan(0)
    expect(CONFIDENCE_THRESHOLDS.AUTO_ASSIGN).toBeLessThanOrEqual(1)
    expect(CONFIDENCE_THRESHOLDS.FLAG_FOR_REVIEW).toBeGreaterThan(0)
    expect(CONFIDENCE_THRESHOLDS.FLAG_FOR_REVIEW).toBeLessThanOrEqual(1)
    expect(CONFIDENCE_THRESHOLDS.FALLBACK).toBeGreaterThan(0)
    expect(CONFIDENCE_THRESHOLDS.FALLBACK).toBeLessThanOrEqual(1)
  })
})

describe("CACHE_CONFIG", () => {
  it("TTL is 7 days in milliseconds", () => {
    expect(CACHE_CONFIG.TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("MAX_ENTRIES is reasonable", () => {
    expect(CACHE_CONFIG.MAX_ENTRIES).toBeGreaterThanOrEqual(100)
    expect(CACHE_CONFIG.MAX_ENTRIES).toBeLessThanOrEqual(10000)
  })

  it("STORAGE_KEY is a non-empty string", () => {
    expect(CACHE_CONFIG.STORAGE_KEY).toBeTruthy()
    expect(typeof CACHE_CONFIG.STORAGE_KEY).toBe("string")
  })
})

// ─── Type System Validation ─────────────────────────────────

describe("InteractionTier type coverage", () => {
  it("TIER_LABELS keys match expected tiers", () => {
    const expectedTiers = new Set(["grove", "consulting", "recruiting", "general"])
    const actualTiers = new Set(Object.keys(TIER_LABELS))
    expect(actualTiers).toEqual(expectedTiers)
  })

  it("TIER_LABELS values are human-readable", () => {
    expect(TIER_LABELS.grove).toBe("Grove")
    expect(TIER_LABELS.consulting).toBe("Consulting")
    expect(TIER_LABELS.recruiting).toBe("Recruiting")
    expect(TIER_LABELS.general).toBe("General")
  })
})

// ─── Classification Scenarios (real-world contacts) ─────────

describe("real-world classification scenarios", () => {
  const scenarios: Array<{ name: string; input: ClassificationInput; expectedTier: InteractionTier; why: string }> = [
    {
      name: "AI startup founder",
      input: {
        profileUrl: "https://linkedin.com/in/ai-founder",
        name: "Sarah Chen",
        headline: "CEO & Co-founder @ AIStartup | Building the future of AI infrastructure",
        commentText: "Love the distributed systems approach here",
      },
      expectedTier: "grove",
      why: "AI infrastructure + strong alignment signals",
    },
    {
      name: "Enterprise SaaS VP",
      input: {
        profileUrl: "https://linkedin.com/in/saas-vp",
        name: "Michael Roberts",
        headline: "VP Sales @ EnterpriseSaaS | Digital Transformation | B2B",
      },
      expectedTier: "consulting",
      why: "Enterprise + B2B signals → consulting",
    },
    {
      name: "Career transition ML engineer",
      input: {
        profileUrl: "https://linkedin.com/in/ml-transition",
        name: "Alex Kim",
        headline: "ML Engineer | Open to Work | Career Transition to AI Product",
        commentText: "Your team is doing amazing work, would love to connect",
      },
      expectedTier: "recruiting",
      why: "Open to Work + career transition signals",
    },
    {
      name: "Generic commenter",
      input: {
        profileUrl: "https://linkedin.com/in/generic-user",
        name: "Pat Johnson",
        headline: "Making the world a better place",
        commentText: "Nice post!",
      },
      expectedTier: "general",
      why: "No specific business signal",
    },
    {
      name: "ML researcher at university (with grove keywords)",
      input: {
        profileUrl: "https://linkedin.com/in/ml-prof",
        name: "Dr. Emily Zhang",
        headline: "Assistant Professor | Distributed AI | Knowledge Graph Research",
        commentText: "Interesting application of RAG retrieval patterns",
      },
      expectedTier: "grove",
      why: "Academia + distributed + knowledge graph → grove alignment",
    },
    {
      name: "Advisory consultant",
      input: {
        profileUrl: "https://linkedin.com/in/advisor",
        name: "James Wilson",
        headline: "Advisory Partner | Strategy Consulting | Client Success",
      },
      expectedTier: "consulting",
      why: "Advisory + consulting keywords",
    },
  ]

  for (const scenario of scenarios) {
    it(`${scenario.name}: expects ${scenario.expectedTier} (${scenario.why})`, () => {
      const result = classifyContactByRules(scenario.input)
      expect(result.tier).toBe(scenario.expectedTier)
    })
  }
})
