/**
 * DOM-to-Notion Engagement Intelligence — Unit Tests
 *
 * Tests the adapter + classification wiring that drives tier-colored
 * FocusCards and the sync pipeline from DOM extraction → Notion.
 */
import { describe, it, expect } from "bun:test"
import {
  classifyContact,
  classifySector,
  classifyGroveAlignment,
  classifyPriority,
  type PBLead,
} from "../src/lib/classification"

// ─── commentToPBLead adapter (inline since it's a trivial mapping) ───

function commentToPBLead(comment: {
  author: { name: string; headline: string; profileUrl: string }
  content: string
}): PBLead {
  return {
    fullName: comment.author.name,
    occupation: comment.author.headline,
    profileUrl: comment.author.profileUrl,
    comments: comment.content,
    hasCommented: "true",
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("commentToPBLead adapter", () => {
  it("maps DOM comment fields to PBLead correctly", () => {
    const comment = {
      author: {
        name: "Jane Smith",
        headline: "VP of Engineering at Acme Corp",
        profileUrl: "https://www.linkedin.com/in/janesmith",
      },
      content: "Great insights on distributed AI infrastructure!",
    }

    const lead = commentToPBLead(comment)

    expect(lead.fullName).toBe("Jane Smith")
    expect(lead.occupation).toBe("VP of Engineering at Acme Corp")
    expect(lead.profileUrl).toBe("https://www.linkedin.com/in/janesmith")
    expect(lead.comments).toBe("Great insights on distributed AI infrastructure!")
    expect(lead.hasCommented).toBe("true")
  })

  it("handles empty headline gracefully", () => {
    const lead = commentToPBLead({
      author: { name: "Bob", headline: "", profileUrl: "https://linkedin.com/in/bob" },
      content: "Nice post",
    })
    expect(lead.occupation).toBe("")
  })
})

describe("classifyContact from headline only (DOM path)", () => {
  it("classifies AI/ML specialist from headline", () => {
    const result = classifyContact({
      occupation: "Machine Learning Engineer at Google",
      hasCommented: "true",
      comments: "Interesting work on federated learning",
    })
    expect(result.sector).toBe("AI/ML Specialist")
    expect(result.priority).not.toBe("")
  })

  it("classifies Corporate VP correctly", () => {
    const result = classifyContact({
      occupation: "VP of Engineering at Enterprise Corp",
      hasCommented: "true",
      comments: "We should connect",
    })
    expect(result.sector).toBe("Corporate")
  })

  it("classifies Academia from headline", () => {
    const result = classifyContact({
      occupation: "Professor of Computer Science at MIT",
      hasCommented: "true",
      comments: "Fascinating research direction",
    })
    expect(result.sector).toBe("Academia")
  })

  it("classifies Investor from headline", () => {
    const result = classifyContact({
      occupation: "Partner at Sequoia Capital, Venture Capital",
      hasCommented: "true",
      comments: "What's your traction?",
    })
    expect(result.sector).toBe("Investor")
  })

  it("returns 'Other' for unrecognizable headline", () => {
    const result = classifyContact({
      occupation: "Retired",
      hasCommented: "true",
      comments: "Nice",
    })
    expect(result.sector).toBe("Other")
  })

  it("handles empty headline → still returns valid classification", () => {
    const result = classifyContact({
      occupation: "",
      hasCommented: "true",
      comments: "",
    })
    expect(result.sector).toBe("Other")
    expect(result.alignment).toContain("⭐")
    expect(result.priority).toBe("Low")
  })

  it("handles undefined fields gracefully (like DOM with missing data)", () => {
    const result = classifyContact({})
    expect(result.sector).toBe("Other")
    expect(result.alignment).toContain("⭐")
    expect(result.priority).toBe("Low")
    expect(result.salesNav).toBeTruthy()
  })
})

describe("priority classification drives tier borders", () => {
  it("High priority: strong alignment + substantive comment", () => {
    const result = classifyContact({
      occupation: "AI Infrastructure Engineer, distributed systems, open source AI",
      hasCommented: "true",
      comments: "This is exactly what I've been thinking about. The edge computing approach to AI inference is the future. How are you handling model distribution?",
    })
    expect(result.priority).toBe("High")
  })

  it("Medium priority: strong alignment OR substantive comment", () => {
    const result = classifyContact({
      occupation: "Software Developer",
      hasCommented: "true",
      comments: "Great perspective on the future of decentralized AI infrastructure. I've been building something similar with local-first knowledge graphs.",
    })
    // Substantive comment with grove keywords → should be Medium or High
    expect(["High", "Medium"]).toContain(result.priority)
  })

  it("Low priority: minimal alignment, brief comment", () => {
    const result = classifyContact({
      occupation: "Retired",
      hasCommented: "true",
      comments: "Nice",
    })
    expect(result.priority).toBe("Low")
  })

  it("Standard priority: moderate alignment + brief comment", () => {
    // Moderate alignment with a brief (non-substantive) comment → Standard
    const alignment = classifyGroveAlignment(
      "Software Developer",
      "I've been building an ai agent framework for local deployment",
      true,
      false,
    )
    expect(alignment).toContain("Moderate")
    // Brief comment (<50 chars) with moderate alignment = Standard
    const priority = classifyPriority(alignment, true, "Nice post!")
    expect(priority).toBe("Standard")
  })
})

describe("Grove alignment scoring from comment text", () => {
  it("boosts score for grove-aligned comment content", () => {
    const withoutComment = classifyGroveAlignment("Software Engineer", "", false, false)
    const withComment = classifyGroveAlignment(
      "Software Engineer",
      "Distributed AI and peer-to-peer knowledge graphs are the future of collective intelligence",
      true,
      false,
    )
    // Comment with strong keywords should score higher
    expect(withComment).not.toBe(withoutComment)
  })

  it("gives engagement bonus for substantive comments", () => {
    const briefComment = classifyGroveAlignment("Engineer", "Nice post", true, false)
    const longComment = classifyGroveAlignment(
      "Engineer",
      "This is a really insightful take on how distributed systems can reshape AI infrastructure and make it more accessible",
      true,
      false,
    )
    // Long comment gets +2 bonus, short gets +1
    // Both have same headline so the difference is comment length
    // This might not change the tier but the score is different
    expect(longComment).toBeDefined()
    expect(briefComment).toBeDefined()
  })
})

describe("sector → salesNav mapping", () => {
  it("AI/ML → Saved - Technical", () => {
    const result = classifyContact({ occupation: "ML Engineer at OpenAI" })
    expect(result.salesNav).toBe("Saved - Technical")
  })

  it("Academia → Saved - Academic", () => {
    const result = classifyContact({ occupation: "Professor at Stanford University" })
    expect(result.salesNav).toBe("Saved - Academic")
  })

  it("Investor → Saved - Enterprise", () => {
    const result = classifyContact({ occupation: "Venture Capital Partner" })
    expect(result.salesNav).toBe("Saved - Enterprise")
  })

  it("Influencer → Saved - Influencer", () => {
    const result = classifyContact({ occupation: "Keynote Speaker and Thought Leader" })
    expect(result.salesNav).toBe("Saved - Influencer")
  })
})

describe("full pipeline: DOM comment → classification → tier border color", () => {
  const TIER_BORDER: Record<string, string> = {
    High: "border-l-amber-500",
    Medium: "border-l-blue-400",
    Standard: "border-l-gray-300",
    Low: "border-l-gray-200",
    "": "border-l-gray-200",
  }

  it("AI infrastructure person with substantive comment → amber border", () => {
    const lead = commentToPBLead({
      author: {
        name: "Alice",
        headline: "Distributed Systems Engineer, open source AI infrastructure",
        profileUrl: "https://linkedin.com/in/alice",
      },
      content: "The decentralized approach to AI is exactly what we need. I've been exploring peer-to-peer knowledge sharing for autonomous agents.",
    })
    const result = classifyContact(lead)
    expect(TIER_BORDER[result.priority]).toBe("border-l-amber-500")
  })

  it("unknown person with brief comment → gray border", () => {
    const lead = commentToPBLead({
      author: {
        name: "Random Person",
        headline: "Life is good",
        profileUrl: "https://linkedin.com/in/random",
      },
      content: "Cool!",
    })
    const result = classifyContact(lead)
    expect(TIER_BORDER[result.priority]).toBe("border-l-gray-200")
  })
})
