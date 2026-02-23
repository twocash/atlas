/**
 * Domain + Audience Inference Tests — STAB-002c
 *
 * Tests sync inference (inferDomainSync, inferAudienceSync),
 * async inference with mock PromptManager, and derivePillar mapping.
 */

import { describe, it, expect } from "bun:test"
import {
  inferDomainSync,
  inferAudienceSync,
  inferDomain,
  inferAudience,
  derivePillar,
  getDomainSlug,
} from "../src/assessment/domain-inferrer"
import {
  detectDomainCorrection,
  extractKeywords,
} from "../src/assessment/correction-logger"
import type { PromptManagerLike } from "../src/assessment/domain-inferrer"
import type { DomainType } from "../src/assessment/types"
import type { Pillar } from "../src/services/prompt-composition/types"

// ─── Domain Inference (Sync) ─────────────────────────────

describe("inferDomainSync", () => {
  it("'add milk' → personal (default)", () => {
    expect(inferDomainSync("add milk")).toBe("personal")
  })

  it("'Research concentration risk' → grove", () => {
    expect(inferDomainSync("Research concentration risk")).toBe("grove")
  })

  it("'grove infrastructure review' → grove", () => {
    expect(inferDomainSync("grove infrastructure review")).toBe("grove")
  })

  it("'Draft for the client' → consulting", () => {
    expect(inferDomainSync("Draft for the client")).toBe("consulting")
  })

  it("'Chase follow-up' → consulting", () => {
    expect(inferDomainSync("Chase follow-up")).toBe("consulting")
  })

  it("'DrumWave onboarding doc' → drumwave", () => {
    expect(inferDomainSync("DrumWave onboarding doc")).toBe("drumwave")
  })

  it("'drum.wave status' → drumwave", () => {
    expect(inferDomainSync("drum.wave status")).toBe("drumwave")
  })

  it("'gym schedule' → personal", () => {
    expect(inferDomainSync("gym schedule")).toBe("personal")
  })

  it("'family dinner plans' → personal", () => {
    expect(inferDomainSync("family dinner plans")).toBe("personal")
  })

  it("empty message → personal (default)", () => {
    expect(inferDomainSync("")).toBe("personal")
  })

  // URL-based domain inference
  it("URL with github.com → grove", () => {
    expect(inferDomainSync("Check this https://github.com/anthropics/sdk")).toBe("grove")
  })

  it("URL with arxiv.org → grove", () => {
    expect(inferDomainSync("Read https://arxiv.org/abs/2401.12345")).toBe("grove")
  })

  it("URL with drumwave.com → drumwave", () => {
    expect(inferDomainSync("Look at https://drumwave.com/dashboard")).toBe("drumwave")
  })

  it("URL with random site → personal (default)", () => {
    expect(inferDomainSync("Check https://amazon.com/deals")).toBe("personal")
  })
})

// ─── Audience Inference (Sync) ───────────────────────────

describe("inferAudienceSync", () => {
  it("'add milk' → self (default)", () => {
    expect(inferAudienceSync("add milk")).toBe("self")
  })

  it("'Draft a client brief' → client", () => {
    expect(inferAudienceSync("Draft a client brief about risk")).toBe("client")
  })

  it("'for the client' → client", () => {
    expect(inferAudienceSync("Write this for the client")).toBe("client")
  })

  it("'client deck' → client", () => {
    expect(inferAudienceSync("Build a client deck")).toBe("client")
  })

  it("'publish a blog post' → public", () => {
    expect(inferAudienceSync("publish a blog post about AI")).toBe("public")
  })

  it("'LinkedIn post' → public", () => {
    expect(inferAudienceSync("Write a LinkedIn post")).toBe("public")
  })

  it("'article about concentration' → public", () => {
    expect(inferAudienceSync("Draft an article about concentration")).toBe("public")
  })

  it("'team update for standup' → team", () => {
    expect(inferAudienceSync("Write a team update for standup")).toBe("team")
  })

  it("'internal doc' → team", () => {
    expect(inferAudienceSync("Create an internal doc about process")).toBe("team")
  })

  it("empty message → self (default)", () => {
    expect(inferAudienceSync("")).toBe("self")
  })
})

// ─── derivePillar ────────────────────────────────────────

describe("derivePillar", () => {
  it("personal → Personal", () => {
    expect(derivePillar("personal")).toBe("Personal")
  })

  it("consulting → Consulting", () => {
    expect(derivePillar("consulting")).toBe("Consulting")
  })

  it("grove → The Grove", () => {
    expect(derivePillar("grove")).toBe("The Grove")
  })

  it("drumwave → Consulting (client engagement)", () => {
    expect(derivePillar("drumwave")).toBe("Consulting")
  })

  it("audience does not affect pillar", () => {
    expect(derivePillar("grove", "client")).toBe("The Grove")
    expect(derivePillar("grove", "public")).toBe("The Grove")
    expect(derivePillar("grove", "self")).toBe("The Grove")
  })
})

// ─── getDomainSlug ───────────────────────────────────────

describe("getDomainSlug", () => {
  it("grove → the-grove", () => {
    expect(getDomainSlug("grove")).toBe("the-grove")
  })

  it("consulting → consulting", () => {
    expect(getDomainSlug("consulting")).toBe("consulting")
  })

  it("drumwave → consulting", () => {
    expect(getDomainSlug("drumwave")).toBe("consulting")
  })

  it("personal → personal", () => {
    expect(getDomainSlug("personal")).toBe("personal")
  })
})

// ─── Async Inference with Mock PromptManager ─────────────

describe("inferDomain (async)", () => {
  const mockPM: PromptManagerLike = {
    async getPrompt(slug: string) {
      if (slug === "config.domain-inference-rules") {
        return {
          content: JSON.stringify({
            keyword_rules: [
              { pattern: "special-test-keyword", domain: "grove" },
            ],
            url_domain_rules: [],
            default: "personal",
          }),
        }
      }
      return null
    },
  }

  it("uses custom rules from PromptManager", async () => {
    const result = await inferDomain("special-test-keyword here", mockPM)
    expect(result).toBe("grove")
  })

  it("falls back to default when no match", async () => {
    const result = await inferDomain("hello world", mockPM)
    expect(result).toBe("personal")
  })

  it("uses default rules when PromptManager is undefined", async () => {
    const result = await inferDomain("grove research")
    expect(result).toBe("grove")
  })
})

describe("inferAudience (async)", () => {
  const mockPM: PromptManagerLike = {
    async getPrompt(slug: string) {
      if (slug === "config.audience-inference-rules") {
        return {
          content: JSON.stringify({
            keyword_rules: [
              { pattern: "vip-audience", audience: "client" },
            ],
            default: "self",
          }),
        }
      }
      return null
    },
  }

  it("uses custom rules from PromptManager", async () => {
    const result = await inferAudience("vip-audience report", mockPM)
    expect(result).toBe("client")
  })

  it("falls back to default when no match", async () => {
    const result = await inferAudience("just a note", mockPM)
    expect(result).toBe("self")
  })
})

// ─── Chain Test: message → domain + audience → derivePillar ─

describe("Full chain: message → domain + audience → pillar", () => {
  const cases: Array<{
    message: string
    expectedDomain: DomainType
    expectedAudience: string
    expectedPillar: Pillar
  }> = [
    {
      message: "add milk",
      expectedDomain: "personal",
      expectedAudience: "self",
      expectedPillar: "Personal",
    },
    {
      message: "Research this for a client",
      expectedDomain: "consulting",
      expectedAudience: "client",
      expectedPillar: "Consulting",
    },
    {
      message: "Write a LinkedIn post about concentration risk",
      expectedDomain: "grove",
      expectedAudience: "public",
      expectedPillar: "The Grove",
    },
    {
      message: "Draft a client brief about AI infrastructure",
      expectedDomain: "grove",
      expectedAudience: "client",
      expectedPillar: "The Grove",
    },
    {
      message: "DrumWave team update",
      expectedDomain: "drumwave",
      expectedAudience: "team",
      expectedPillar: "Consulting",
    },
    {
      message: "gym routine for the week",
      expectedDomain: "personal",
      expectedAudience: "self",
      expectedPillar: "Personal",
    },
  ]

  for (const { message, expectedDomain, expectedAudience, expectedPillar } of cases) {
    it(`"${message}" → domain=${expectedDomain}, audience=${expectedAudience}, pillar=${expectedPillar}`, () => {
      const domain = inferDomainSync(message)
      const audience = inferAudienceSync(message)
      const pillar = derivePillar(domain)

      expect(domain).toBe(expectedDomain)
      expect(audience).toBe(expectedAudience)
      expect(pillar).toBe(expectedPillar)
    })
  }
})

// ─── Correction Detection ───────────────────────────────

describe("detectDomainCorrection", () => {
  it("'that should have been grove' → corrected: grove", () => {
    const result = detectDomainCorrection("that should have been grove", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("grove")
  })

  it("'should be consulting' → corrected: consulting", () => {
    const result = detectDomainCorrection("should be consulting", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("consulting")
  })

  it("'that's grove not personal' → corrected: grove", () => {
    const result = detectDomainCorrection("that's grove not personal", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("grove")
  })

  it("'move this to consulting' → corrected: consulting", () => {
    const result = detectDomainCorrection("move this to consulting", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("consulting")
  })

  it("'reclassify to the grove' → corrected: grove", () => {
    const result = detectDomainCorrection("reclassify to the grove", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("grove")
  })

  it("'not personal it is consulting' → corrected: consulting", () => {
    const result = detectDomainCorrection("not personal it's consulting", "personal")
    expect(result).not.toBeNull()
    expect(result!.corrected).toBe("consulting")
  })

  it("no correction signal → null", () => {
    const result = detectDomainCorrection("add milk to the list", "personal")
    expect(result).toBeNull()
  })

  it("same domain correction → null (no-op)", () => {
    const result = detectDomainCorrection("should be personal", "personal")
    expect(result).toBeNull()
  })

  it("unknown domain alias → null", () => {
    const result = detectDomainCorrection("should be foobar", "personal")
    expect(result).toBeNull()
  })

  it("'wrong domain' alone → null (ambiguous)", () => {
    const result = detectDomainCorrection("wrong domain", "personal")
    expect(result).toBeNull()
  })
})

// ─── Keyword Extraction ────────────────────────────────

describe("extractKeywords", () => {
  it("extracts meaningful words, strips stop words", () => {
    const kw = extractKeywords("add milk to the grocery list")
    expect(kw).toContain("milk")
    expect(kw).toContain("grocery")
    expect(kw).toContain("list")
    expect(kw).not.toContain("the")
    expect(kw).not.toContain("to")
  })

  it("strips URLs", () => {
    const kw = extractKeywords("Check https://github.com/repo for details")
    expect(kw).not.toContain("https")
    expect(kw).not.toContain("github")
    expect(kw).toContain("check")
    expect(kw).toContain("details")
  })

  it("limits to 5 keywords", () => {
    const kw = extractKeywords("alpha bravo charlie delta echo foxtrot golf hotel india juliet")
    expect(kw.length).toBeLessThanOrEqual(5)
  })

  it("empty message → empty array", () => {
    expect(extractKeywords("")).toEqual([])
  })
})

// ─── Correction Chain Test ─────────────────────────────

describe("Correction chain: detect → keywords → derivePillar", () => {
  it("'add milk' classified personal, then 'that should have been consulting'", () => {
    const originalDomain: DomainType = "personal"
    const correctionMsg = "that should have been consulting"

    const correction = detectDomainCorrection(correctionMsg, originalDomain)
    expect(correction).not.toBeNull()
    expect(correction!.corrected).toBe("consulting")

    // Keywords from the original message would be extracted at correction time
    const originalKeywords = extractKeywords("add milk")
    expect(originalKeywords).toContain("milk")

    // Pillar derivation uses corrected domain
    const pillar = derivePillar(correction!.corrected)
    expect(pillar).toBe("Consulting")
  })
})
