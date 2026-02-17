/**
 * Context Enrichment — Gate 1.7 Unit Tests
 *
 * Tests the enrichment pipeline:
 *   LinkedIn URL → Notion contact lookup → parallel fetch
 *   (page body + engagements) → budget truncation → ContentBlock[]
 *
 * All Notion API calls are mocked — no network access needed.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"

// ─── Mocks ──────────────────────────────────────────────────

// Mock notion-api before importing enrichContext
const mockFindContact = mock(() => Promise.resolve(null))
const mockGetPageBlocks = mock(() => Promise.resolve([]))
const mockBlocksToText = mock(() => "")
const mockQueryDatabase = mock(() => Promise.resolve([]))

mock.module("~src/lib/notion-api", () => ({
  findContactByLinkedInUrl: mockFindContact,
  getPageBlocks: mockGetPageBlocks,
  blocksToText: mockBlocksToText,
  queryDatabase: mockQueryDatabase,
  NOTION_DBS: {
    CONTACTS: "08b9f73264b24e4b82d4c842f5a11cc8",
    ENGAGEMENTS: "25e138b54d1645a3a78b266451585de9",
  },
}))

import { enrichContext } from "../src/lib/context-enrichment"
import { DEFAULT_CONTEXT_BUDGET } from "../src/types/context-enrichment"
import type { ContextBudget } from "../src/types/context-enrichment"

// ─── Fixtures ──────────────────────────────────────────────

const LINKEDIN_URL = "https://linkedin.com/in/test-user"

const MOCK_CONTACT = {
  id: "contact-page-id-123",
  properties: {
    Name: { title: [{ text: { content: "Test User" } }] },
  },
}

const MOCK_BLOCKS = [
  { type: "paragraph", paragraph: { rich_text: [{ text: { content: "About this contact." } }] } },
  { type: "heading_2", heading_2: { rich_text: [{ text: { content: "Background" } }] } },
  { type: "paragraph", paragraph: { rich_text: [{ text: { content: "More details here." } }] } },
]

const MOCK_ENGAGEMENTS = [
  {
    id: "eng-1",
    properties: {
      Type: { select: { name: "Commented on Our Post" } },
      Date: { date: { start: "2025-01-15" } },
      "Engagement Quality": { select: { name: "High" } },
      "Response Status": { select: { name: "Posted" } },
      "Their Content": { rich_text: [{ text: { content: "Great insights on AI!" } }] },
    },
  },
  {
    id: "eng-2",
    properties: {
      Type: { select: { name: "Liked" } },
      Date: { date: { start: "2025-01-10" } },
      "Engagement Quality": { select: { name: "Low" } },
      "Response Status": { select: { name: "No Reply Needed" } },
      "Their Content": { rich_text: [] },
    },
  },
]

// ─── Helpers ─────────────────────────────────────────────────

beforeEach(() => {
  mockFindContact.mockReset()
  mockGetPageBlocks.mockReset()
  mockBlocksToText.mockReset()
  mockQueryDatabase.mockReset()

  // Defaults
  mockFindContact.mockResolvedValue(null)
  mockGetPageBlocks.mockResolvedValue([])
  mockBlocksToText.mockReturnValue("")
  mockQueryDatabase.mockResolvedValue([])
})

// ─── 1. Contact Not Found ──────────────────────────────────

describe("contact not found", () => {
  it("returns empty context with contactFound=false", async () => {
    mockFindContact.mockResolvedValue(null)

    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contactFound).toBe(false)
    expect(result.contactBody).toBe("")
    expect(result.engagements).toBe("")
    expect(result.contextBlocks).toHaveLength(0)
    expect(result.totalChars).toBe(0)
    expect(result.fetchTimeMs).toBeGreaterThanOrEqual(0)
  })
})

// ─── 2. Contact Found — Full Enrichment ─────────────────────

describe("contact found — full enrichment", () => {
  beforeEach(() => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockGetPageBlocks.mockResolvedValue(MOCK_BLOCKS)
    mockBlocksToText.mockReturnValue("About this contact.\n## Background\nMore details here.")
    mockQueryDatabase.mockResolvedValue(MOCK_ENGAGEMENTS)
  })

  it("returns enriched context with contactFound=true", async () => {
    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contactFound).toBe(true)
    expect(result.contactBody).toBeTruthy()
    expect(result.engagements).toBeTruthy()
    expect(result.totalChars).toBeGreaterThan(0)
    expect(result.fetchTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("produces ContentBlock[] with contact context and engagements", async () => {
    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contextBlocks.length).toBeGreaterThanOrEqual(1)
    const texts = result.contextBlocks.map((b) => b.type === "text" ? b.text : "")

    // Should have contact context block
    const contactBlock = texts.find((t) => t.includes("[Contact Context]"))
    expect(contactBlock).toBeTruthy()

    // Should have engagements block
    const engBlock = texts.find((t) => t.includes("[Recent Engagements]"))
    expect(engBlock).toBeTruthy()
  })

  it("engagement text includes type and date", async () => {
    const result = await enrichContext(LINKEDIN_URL)
    expect(result.engagements).toContain("Commented on Our Post")
    expect(result.engagements).toContain("2025-01-15")
    expect(result.engagements).toContain("Liked")
  })

  it("calls getPageBlocks with contact page ID", async () => {
    await enrichContext(LINKEDIN_URL)
    expect(mockGetPageBlocks).toHaveBeenCalledWith("contact-page-id-123")
  })

  it("queries engagements by contact relation", async () => {
    await enrichContext(LINKEDIN_URL)
    expect(mockQueryDatabase).toHaveBeenCalledWith(
      "25e138b54d1645a3a78b266451585de9",
      expect.objectContaining({
        property: "Contact",
        relation: { contains: "contact-page-id-123" },
      }),
      expect.objectContaining({
        page_size: 5,
      }),
    )
  })
})

// ─── 3. Budget Truncation ────────────────────────────────────

describe("budget truncation", () => {
  it("truncates contact body to contactBodyMax", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    const longBody = "A".repeat(5000)
    mockBlocksToText.mockReturnValue(longBody)

    const budget: ContextBudget = { contactBodyMax: 100, engagementMax: 100, totalMax: 200 }
    const result = await enrichContext(LINKEDIN_URL, budget)

    expect(result.contactBody.length).toBeLessThanOrEqual(100)
  })

  it("truncates total to totalMax, engagements trimmed first", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockBlocksToText.mockReturnValue("B".repeat(2000))
    mockQueryDatabase.mockResolvedValue(MOCK_ENGAGEMENTS)

    const budget: ContextBudget = { contactBodyMax: 2000, engagementMax: 1000, totalMax: 2500 }
    const result = await enrichContext(LINKEDIN_URL, budget)

    expect(result.totalChars).toBeLessThanOrEqual(2500)
    // Contact body should be preserved (higher priority)
    expect(result.contactBody.length).toBeGreaterThan(result.engagements.length)
  })

  it("uses DEFAULT_CONTEXT_BUDGET when no budget specified", async () => {
    expect(DEFAULT_CONTEXT_BUDGET.contactBodyMax).toBe(2000)
    expect(DEFAULT_CONTEXT_BUDGET.engagementMax).toBe(1000)
    expect(DEFAULT_CONTEXT_BUDGET.totalMax).toBe(3000)
  })
})

// ─── 4. Parallel Fetch Resilience ────────────────────────────

describe("parallel fetch resilience", () => {
  it("still returns contact body if engagements fetch fails", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockBlocksToText.mockReturnValue("Contact body text")
    mockQueryDatabase.mockRejectedValue(new Error("Notion timeout"))

    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contactFound).toBe(true)
    expect(result.contactBody).toBe("Contact body text")
    expect(result.engagements).toBe("")
  })

  it("still returns engagements if page blocks fetch fails", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockGetPageBlocks.mockRejectedValue(new Error("Block fetch failed"))
    mockQueryDatabase.mockResolvedValue(MOCK_ENGAGEMENTS)

    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contactFound).toBe(true)
    expect(result.contactBody).toBe("")
    expect(result.engagements).toBeTruthy()
  })
})

// ─── 5. Empty Engagements ────────────────────────────────────

describe("no engagements", () => {
  it("returns context blocks without engagements block", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockBlocksToText.mockReturnValue("Some contact content")
    mockQueryDatabase.mockResolvedValue([])

    const result = await enrichContext(LINKEDIN_URL)

    expect(result.contextBlocks).toHaveLength(1)
    expect(result.contextBlocks[0].type).toBe("text")
    if (result.contextBlocks[0].type === "text") {
      expect(result.contextBlocks[0].text).toContain("[Contact Context]")
    }
    expect(result.engagements).toBe("")
  })
})

// ─── 6. ContentBlock Format ──────────────────────────────────

describe("ContentBlock format", () => {
  it("all blocks are TextBlock type", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockBlocksToText.mockReturnValue("Body text")
    mockQueryDatabase.mockResolvedValue(MOCK_ENGAGEMENTS)

    const result = await enrichContext(LINKEDIN_URL)

    for (const block of result.contextBlocks) {
      expect(block.type).toBe("text")
    }
  })

  it("returns empty blocks array when no content", async () => {
    mockFindContact.mockResolvedValue(MOCK_CONTACT)
    mockBlocksToText.mockReturnValue("")
    mockQueryDatabase.mockResolvedValue([])

    const result = await enrichContext(LINKEDIN_URL)
    expect(result.contextBlocks).toHaveLength(0)
  })
})
