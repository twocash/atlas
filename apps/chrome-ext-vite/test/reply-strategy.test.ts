/**
 * Reply Strategy System — Unit Tests
 *
 * Tests the Notion-backed archetype + modifiers strategy system:
 *   1. Rules engine: condition evaluation, field extraction, first-match-wins
 *   2. Prompt composition: token budget, assembly order, fallback
 *   3. Strategy orchestration: full pipeline with mock config
 *   4. Laura Borges acceptance test case (per contract)
 */
import { describe, it, expect } from "bun:test"

import {
  evaluateCondition,
  evaluateRules,
  extractFields,
  parseAlignmentScore,
  type RuleEvaluation,
} from "../src/lib/strategy-rules"

import {
  composeReplyPrompt,
  type ComposedPrompt,
} from "../src/lib/reply-prompts"

import type { StrategyConfig, StrategyConfigEntry } from "../src/lib/strategy-config"
import type { CommentAuthor, LinkedInComment } from "../src/types/comments"

// ─── Test Fixtures ──────────────────────────────────────────────

function makeAuthor(overrides: Partial<CommentAuthor> = {}): CommentAuthor {
  return {
    name: "Test User",
    headline: "Software Engineer",
    profileUrl: "https://linkedin.com/in/testuser",
    linkedInDegree: "2nd",
    sector: "Technology",
    groveAlignment: "⭐⭐ Moderate Alignment",
    priority: "Medium",
    tier: "general",
    ...overrides,
  }
}

function makeComment(overrides: Partial<LinkedInComment> = {}): LinkedInComment {
  return {
    id: "test-comment-1",
    postId: "test-post-1",
    postTitle: "Building AI Agents That Actually Work",
    content: "Great insights on multi-agent architecture!",
    author: makeAuthor(),
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function makeEntry(overrides: Partial<StrategyConfigEntry> = {}): StrategyConfigEntry {
  return {
    id: "entry-1",
    name: "Test Entry",
    slug: "test_entry",
    type: "archetype",
    active: true,
    priority: 50,
    conditions: "",
    archetype: "",
    content: "Test content for this entry.",
    ...overrides,
  }
}

function makeConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    coreVoice: makeEntry({
      type: "core_voice",
      name: "Core Voice",
      slug: "core_voice",
      content: "You speak with authentic warmth. Always be genuine.",
    }),
    archetypes: {
      thesis_engagement: makeEntry({
        slug: "thesis_engagement",
        name: "Thesis Engagement",
        content: "Engage deeply on ideas. Ask probing questions.",
      }),
      business_relationship: makeEntry({
        slug: "business_relationship",
        name: "Business Relationship",
        content: "Professional warmth. Reference shared context.",
      }),
      talent_nurture: makeEntry({
        slug: "talent_nurture",
        name: "Talent Nurture",
        content: "Be encouraging. Offer mentorship signals.",
      }),
      community_building: makeEntry({
        slug: "community_building",
        name: "Community Building",
        content: "Amplify their voice. Create belonging.",
      }),
      standard_engagement: makeEntry({
        slug: "standard_engagement",
        name: "Standard Engagement",
        content: "Warm acknowledgment. Concise and genuine.",
      }),
    },
    modifiers: {
      high_grove_alignment: makeEntry({
        type: "modifier",
        slug: "high_grove_alignment",
        name: "High Grove Alignment",
        conditions: 'groveAlignment >= 3',
        priority: 10,
        content: "Lean into shared AI vision. Reference grove themes.",
      }),
      first_interaction: makeEntry({
        type: "modifier",
        slug: "first_interaction",
        name: "First Interaction",
        conditions: 'relationshipStage == "New"',
        priority: 20,
        content: "Extra warmth for newcomers. Welcome them.",
      }),
      open_to_work: makeEntry({
        type: "modifier",
        slug: "open_to_work",
        name: "Open to Work",
        conditions: 'linkedInIsOpenToWork == "true"',
        priority: 30,
        content: "Acknowledge career transition. Offer encouragement.",
      }),
    },
    rules: [
      makeEntry({
        type: "rule",
        name: "High Grove AI Commenter",
        slug: "rule_high_grove",
        conditions: 'groveAlignment >= 3 && sector contains "AI"',
        archetype: "thesis_engagement",
        priority: 10,
      }),
      makeEntry({
        type: "rule",
        name: "Enterprise Decision Maker",
        slug: "rule_enterprise",
        conditions: 'strategicBucket == "Enterprise Clients"',
        archetype: "business_relationship",
        priority: 20,
      }),
      makeEntry({
        type: "rule",
        name: "Career Transition",
        slug: "rule_career",
        conditions: 'linkedInIsOpenToWork == "true"',
        archetype: "talent_nurture",
        priority: 30,
      }),
      makeEntry({
        type: "rule",
        name: "Active Community Member",
        slug: "rule_community",
        conditions: 'tier == "grove" && groveAlignment >= 2',
        archetype: "community_building",
        priority: 40,
      }),
    ],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── 1. Condition Evaluator ─────────────────────────────────────

describe("evaluateCondition", () => {
  const fields = {
    sector: "AI/ML",
    groveAlignment: 4,
    priority: "High",
    linkedInDegree: "1st",
    tier: "grove",
    strategicBucket: "Enterprise Clients",
    relationshipStage: "Engaged",
    linkedInIsOpenToWork: false,
    headline: "VP of AI Infrastructure",
    name: "Laura Borges",
  }

  it("evaluates string equality", () => {
    expect(evaluateCondition('sector == "AI/ML"', fields)).toBe(true)
    expect(evaluateCondition('sector == "Finance"', fields)).toBe(false)
  })

  it("evaluates string inequality", () => {
    expect(evaluateCondition('sector != "Finance"', fields)).toBe(true)
    expect(evaluateCondition('sector != "AI/ML"', fields)).toBe(false)
  })

  it("evaluates numeric comparisons", () => {
    expect(evaluateCondition("groveAlignment >= 3", fields)).toBe(true)
    expect(evaluateCondition("groveAlignment >= 5", fields)).toBe(false)
    expect(evaluateCondition("groveAlignment > 3", fields)).toBe(true)
    expect(evaluateCondition("groveAlignment > 4", fields)).toBe(false)
    expect(evaluateCondition("groveAlignment <= 4", fields)).toBe(true)
    expect(evaluateCondition("groveAlignment < 4", fields)).toBe(false)
  })

  it("evaluates contains (case-insensitive)", () => {
    expect(evaluateCondition('headline contains "AI"', fields)).toBe(true)
    expect(evaluateCondition('headline contains "ai"', fields)).toBe(true)
    expect(evaluateCondition('headline contains "blockchain"', fields)).toBe(false)
  })

  it("evaluates AND (&&)", () => {
    expect(evaluateCondition('groveAlignment >= 3 && sector == "AI/ML"', fields)).toBe(true)
    expect(evaluateCondition('groveAlignment >= 5 && sector == "AI/ML"', fields)).toBe(false)
  })

  it("evaluates OR (||)", () => {
    expect(evaluateCondition('sector == "Finance" || tier == "grove"', fields)).toBe(true)
    expect(evaluateCondition('sector == "Finance" || tier == "consulting"', fields)).toBe(false)
  })

  it("evaluates complex AND/OR combinations", () => {
    // OR has lower precedence: (A && B) || C
    expect(
      evaluateCondition('groveAlignment >= 5 && sector == "AI/ML" || tier == "grove"', fields)
    ).toBe(true) // first AND fails, but OR succeeds
  })

  it("evaluates boolean fields", () => {
    expect(evaluateCondition('linkedInIsOpenToWork == "false"', fields)).toBe(true)
    expect(evaluateCondition('linkedInIsOpenToWork == "true"', fields)).toBe(false)
  })

  it("returns false for empty condition", () => {
    expect(evaluateCondition("", fields)).toBe(false)
    expect(evaluateCondition("  ", fields)).toBe(false)
  })

  it("returns false for unknown field", () => {
    expect(evaluateCondition('unknownField == "value"', fields)).toBe(false)
  })

  it("returns false for malformed condition", () => {
    expect(evaluateCondition("just some text", fields)).toBe(false)
  })
})

// ─── 2. Field Extraction & Alignment Parsing ────────────────────

describe("parseAlignmentScore", () => {
  it("parses star emojis", () => {
    expect(parseAlignmentScore("⭐⭐⭐⭐ Strong Alignment")).toBe(4)
    expect(parseAlignmentScore("⭐⭐⭐ Good Alignment")).toBe(3)
    expect(parseAlignmentScore("⭐⭐ Moderate Alignment")).toBe(2)
    expect(parseAlignmentScore("⭐ Weak Alignment")).toBe(1)
  })

  it("falls back to keyword parsing when no stars", () => {
    expect(parseAlignmentScore("Strong Alignment")).toBe(4)
    expect(parseAlignmentScore("Good Alignment")).toBe(3)
    expect(parseAlignmentScore("Moderate Alignment")).toBe(2)
    expect(parseAlignmentScore("Weak Alignment")).toBe(1)
  })

  it("returns 0 for empty/unknown", () => {
    expect(parseAlignmentScore("")).toBe(0)
    expect(parseAlignmentScore("N/A")).toBe(0)
  })
})

describe("extractFields", () => {
  it("maps CommentAuthor to evaluable fields", () => {
    const author = makeAuthor({
      groveAlignment: "⭐⭐⭐ Good Alignment",
      strategicBucket: "Content Amplifiers",
      relationshipStage: "New",
      linkedInIsOpenToWork: true,
    })
    const fields = extractFields(author)
    expect(fields.sector).toBe("Technology")
    expect(fields.groveAlignment).toBe(3) // Parsed from stars
    expect(fields.strategicBucket).toBe("Content Amplifiers")
    expect(fields.relationshipStage).toBe("New")
    expect(fields.linkedInIsOpenToWork).toBe(true)
  })
})

// ─── 3. Rules Evaluation ────────────────────────────────────────

describe("evaluateRules", () => {
  const config = makeConfig()

  it("matches first rule by priority (thesis_engagement for high grove AI)", () => {
    const author = makeAuthor({
      groveAlignment: "⭐⭐⭐⭐ Strong Alignment",
      sector: "AI/ML",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("thesis_engagement")
    expect(result.confidence).toBe(0.9)
    expect(result.matchedRule).toBe("High Grove AI Commenter")
  })

  it("falls through to enterprise rule when grove rule doesn't match", () => {
    const author = makeAuthor({
      groveAlignment: "⭐ Weak Alignment",
      sector: "Finance",
      strategicBucket: "Enterprise Clients",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("business_relationship")
    expect(result.matchedRule).toBe("Enterprise Decision Maker")
  })

  it("matches talent_nurture for career transition", () => {
    const author = makeAuthor({
      linkedInIsOpenToWork: true,
      sector: "Design",
      groveAlignment: "",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("talent_nurture")
    expect(result.matchedRule).toBe("Career Transition")
  })

  it("falls back to standard_engagement when no rules match", () => {
    const author = makeAuthor({
      groveAlignment: "⭐ Weak Alignment",
      sector: "Retail",
      strategicBucket: "",
      linkedInIsOpenToWork: false,
      tier: "general",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("standard_engagement")
    expect(result.confidence).toBe(0.3)
    expect(result.matchedRule).toBe("fallback")
  })

  it("triggers modifiers alongside rule match", () => {
    const author = makeAuthor({
      groveAlignment: "⭐⭐⭐⭐ Strong Alignment",
      sector: "AI/ML",
      relationshipStage: "New",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("thesis_engagement")
    // Should trigger high_grove_alignment (score 4 >= 3) and first_interaction (New)
    expect(result.modifiers).toContain("high_grove_alignment")
    expect(result.modifiers).toContain("first_interaction")
    // Should NOT trigger open_to_work
    expect(result.modifiers).not.toContain("open_to_work")
  })
})

// ─── 4. Prompt Composition ──────────────────────────────────────

describe("composeReplyPrompt", () => {
  const config = makeConfig()
  const comment = makeComment()

  it("composes full prompt with strategy block", () => {
    const result = composeReplyPrompt(config, "thesis_engagement", [], comment)
    expect(result.usedFallback).toBe(false)
    expect(result.archetype).toBe("thesis_engagement")
    expect(result.systemPrompt).toContain("Core Voice")
    expect(result.systemPrompt).toContain("You speak with authentic warmth")
    expect(result.systemPrompt).toContain("Thesis Engagement")
    expect(result.systemPrompt).toContain("Engage deeply on ideas")
    expect(result.systemPrompt).toContain(comment.author.name)
    expect(result.systemPrompt).toContain(comment.postTitle)
  })

  it("includes modifiers in strategy block", () => {
    const result = composeReplyPrompt(
      config,
      "thesis_engagement",
      ["high_grove_alignment", "first_interaction"],
      comment
    )
    expect(result.systemPrompt).toContain("Context Modifiers")
    expect(result.systemPrompt).toContain("High Grove Alignment")
    expect(result.systemPrompt).toContain("First Interaction")
  })

  it("includes user instruction when provided", () => {
    const result = composeReplyPrompt(config, "standard_engagement", [], comment, "make it shorter")
    expect(result.systemPrompt).toContain("make it shorter")
  })

  it("falls back to GROVE_CONTEXT when no config", () => {
    const result = composeReplyPrompt(null, "fallback", [], comment)
    expect(result.usedFallback).toBe(true)
    expect(result.archetype).toBe("fallback")
    expect(result.systemPrompt).toContain("Grove") // From GROVE_CONTEXT
  })

  it("stays within token budget (2000 chars for strategy block)", () => {
    // Create a config with verbose content that would exceed budget
    const verboseConfig = makeConfig({
      coreVoice: makeEntry({
        type: "core_voice",
        content: "A".repeat(800), // 800 chars
      }),
      archetypes: {
        verbose: makeEntry({
          slug: "verbose",
          content: "B".repeat(800), // 800 chars
        }),
      },
      modifiers: {
        mod1: makeEntry({
          type: "modifier",
          slug: "mod1",
          name: "Modifier 1",
          conditions: "sector != \"\"",
          priority: 10,
          content: "C".repeat(600), // Would push past 2000
        }),
        mod2: makeEntry({
          type: "modifier",
          slug: "mod2",
          name: "Modifier 2",
          conditions: "sector != \"\"",
          priority: 20,
          content: "D".repeat(600),
        }),
      },
      rules: [],
    })

    const result = composeReplyPrompt(verboseConfig, "verbose", ["mod1", "mod2"], comment)
    // Strategy block should be truncated/trimmed to stay within budget
    expect(result.strategyBlock.length).toBeLessThanOrEqual(2100) // Allow small overhead from section headers
  })

  it("includes strategic bucket and relationship stage when available", () => {
    const enrichedComment = makeComment({
      author: makeAuthor({
        strategicBucket: "Enterprise Clients",
        relationshipStage: "Cultivating",
      }),
    })
    const result = composeReplyPrompt(config, "business_relationship", [], enrichedComment)
    expect(result.systemPrompt).toContain("Strategic Bucket: Enterprise Clients")
    expect(result.systemPrompt).toContain("Relationship Stage: Cultivating")
  })
})

// ─── 5. Laura Borges Acceptance Test Case ───────────────────────

describe("Laura Borges acceptance test", () => {
  const config = makeConfig()

  // Per contract: Laura Borges scenario
  // AI/ML sector, strong grove alignment → thesis_engagement archetype
  const laura = makeAuthor({
    name: "Laura Borges",
    headline: "AI/ML Infrastructure Lead | Multi-Agent Systems",
    sector: "AI/ML",
    groveAlignment: "⭐⭐⭐⭐ Strong Alignment",
    priority: "High",
    tier: "grove",
    strategicBucket: "",
    relationshipStage: "New",
  })

  const comment = makeComment({
    content: "Love the multi-agent architecture approach! We've been exploring similar patterns.",
    author: laura,
    postTitle: "Why Agent Coordination Needs a New Paradigm",
  })

  it("routes Laura to thesis_engagement archetype", () => {
    const result = evaluateRules(config.rules, laura, config.modifiers)
    expect(result.archetype).toBe("thesis_engagement")
    expect(result.matchedRule).toBe("High Grove AI Commenter")
    expect(result.confidence).toBe(0.9)
  })

  it("triggers high_grove_alignment + first_interaction modifiers", () => {
    const result = evaluateRules(config.rules, laura, config.modifiers)
    expect(result.modifiers).toContain("high_grove_alignment")
    expect(result.modifiers).toContain("first_interaction") // New relationship stage
  })

  it("composes prompt within 500-token budget", () => {
    const evaluation = evaluateRules(config.rules, laura, config.modifiers)
    const prompt = composeReplyPrompt(
      config,
      evaluation.archetype,
      evaluation.modifiers,
      comment
    )

    // Strategy block should be within 2000 chars (~500 tokens)
    expect(prompt.strategyBlock.length).toBeLessThanOrEqual(2000)
    expect(prompt.usedFallback).toBe(false)

    // Prompt should contain all strategy elements
    expect(prompt.systemPrompt).toContain("Core Voice")
    expect(prompt.systemPrompt).toContain("Thesis Engagement")
    expect(prompt.systemPrompt).toContain("High Grove Alignment")
    expect(prompt.systemPrompt).toContain("First Interaction")

    // Should have Laura's context
    expect(prompt.systemPrompt).toContain("Laura Borges")
    expect(prompt.systemPrompt).toContain("AI/ML Infrastructure Lead")
  })

  it("preserves GROVE_CONTEXT fallback when config unavailable", () => {
    const fallback = composeReplyPrompt(null, "fallback", [], comment)
    expect(fallback.usedFallback).toBe(true)
    expect(fallback.systemPrompt).toContain("Laura Borges")
    expect(fallback.systemPrompt).toContain("Reply ONLY with the draft text")
  })
})

// ─── 6. Edge Cases ──────────────────────────────────────────────

describe("edge cases", () => {
  it("handles author with empty/missing fields gracefully", () => {
    const bareAuthor = makeAuthor({
      sector: "",
      groveAlignment: "",
      priority: "",
      tier: "",
      strategicBucket: undefined,
      relationshipStage: undefined,
    })
    const fields = extractFields(bareAuthor)
    expect(fields.sector).toBe("")
    expect(fields.groveAlignment).toBe(0)
    expect(fields.strategicBucket).toBe("")
    expect(fields.relationshipStage).toBe("")
  })

  it("handles config with empty modifiers", () => {
    const config = makeConfig({ modifiers: {} })
    const author = makeAuthor({
      groveAlignment: "⭐⭐⭐⭐ Strong Alignment",
      sector: "AI/ML",
    })
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.modifiers).toEqual([])
    expect(result.archetype).toBe("thesis_engagement")
  })

  it("handles config with empty rules (falls back to standard_engagement)", () => {
    const config = makeConfig({ rules: [] })
    const author = makeAuthor()
    const result = evaluateRules(config.rules, author, config.modifiers)
    expect(result.archetype).toBe("standard_engagement")
    expect(result.matchedRule).toBe("fallback")
  })

  it("prompt composition with missing archetype slug uses empty content", () => {
    const config = makeConfig()
    const result = composeReplyPrompt(config, "nonexistent_archetype", [], makeComment())
    // Should still compose — just without archetype content
    expect(result.systemPrompt).toContain("Core Voice")
    expect(result.usedFallback).toBe(false)
  })
})
