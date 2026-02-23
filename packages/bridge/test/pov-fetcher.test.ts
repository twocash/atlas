/**
 * POV Fetcher — Unit Tests
 *
 * Tests domain resolution, caching, keyword scoring, and content extraction.
 * All Notion API calls are mocked. No network required.
 *
 * Sprint: SPRINT-2026-02-23-GTM-WIRING
 */

import { describe, test, expect, mock, beforeEach } from "bun:test"

// ─── Mock Notion Client ─────────────────────────────────────

const mockQuery = mock(() => Promise.resolve({ results: [] }))

mock.module("@notionhq/client", () => ({
  Client: class {
    databases = { query: mockQuery }
  },
}))

// Must import AFTER mock.module
const { fetchPovForPillar, clearPovCache } = await import(
  "../src/context/pov-fetcher"
)

// ─── Helpers ────────────────────────────────────────────────

/** Build a fake Notion page object with POV Library properties */
function fakePovPage(overrides: {
  title?: string
  coreThesis?: string
  domainCoverage?: string[]
  rhetoricalPatterns?: string
}) {
  return {
    id: "fake-page-id",
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: overrides.title ?? "Test POV Entry" }],
      },
      "Core Thesis": {
        type: "rich_text",
        rich_text: [
          { plain_text: overrides.coreThesis ?? "Default thesis statement" },
        ],
      },
      "Evidence Standards": {
        type: "rich_text",
        rich_text: [{ plain_text: "Peer-reviewed sources required" }],
      },
      "Rhetorical Patterns": {
        type: "rich_text",
        rich_text: [
          {
            plain_text:
              overrides.rhetoricalPatterns ?? "Authority + data-driven",
          },
        ],
      },
      "Counter-Arguments Addressed": {
        type: "rich_text",
        rich_text: [{ plain_text: "Cost objection" }],
      },
      "Boundary Conditions": {
        type: "rich_text",
        rich_text: [{ plain_text: "Enterprise only" }],
      },
      "Domain Coverage": {
        type: "multi_select",
        multi_select: (overrides.domainCoverage ?? ["Consulting"]).map(
          (name) => ({ name })
        ),
      },
    },
  }
}

// ─── Setup ──────────────────────────────────────────────────

beforeEach(() => {
  clearPovCache()
  mockQuery.mockClear()
  // Ensure Notion token is set for mock client
  process.env.NOTION_API_KEY = "test-token"
})

// ─── Domain Mapping ─────────────────────────────────────────

describe("pov-fetcher domain mapping", () => {
  test("consulting pillar includes gtm-consulting domain", async () => {
    mockQuery.mockResolvedValueOnce({
      results: [
        fakePovPage({
          title: "GTM Consulting: CLO Market Position",
          coreThesis: "Card-linked offers create measurable attribution",
          domainCoverage: ["gtm-consulting"],
        }),
      ],
    })

    const result = await fetchPovForPillar("Consulting", [
      "CLO",
      "card-linked",
    ])

    expect(result.status).toBe("found")
    expect(result.content).not.toBeNull()
    expect(result.content!.title).toBe("GTM Consulting: CLO Market Position")
    expect(result.content!.domainCoverage).toContain("gtm-consulting")
  })

  test("consulting query includes gtm-consulting in domain filter", async () => {
    mockQuery.mockResolvedValueOnce({ results: [] })

    await fetchPovForPillar("Consulting")

    // Verify the Notion query includes gtm-consulting in the OR filter
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const callArgs = mockQuery.mock.calls[0][0] as {
      filter: { and: Array<{ or?: Array<{ property: string; multi_select: { contains: string } }> }> }
    }
    const orFilters = callArgs.filter.and[0].or!
    const domainValues = orFilters.map(
      (f: { multi_select: { contains: string } }) => f.multi_select.contains
    )

    expect(domainValues).toContain("Consulting")
    expect(domainValues).toContain("DrumWave")
    expect(domainValues).toContain("gtm-consulting")
  })

  test("the-grove pillar maps to Grove Research and Grove Marketing", async () => {
    mockQuery.mockResolvedValueOnce({ results: [] })

    await fetchPovForPillar("The Grove")

    const callArgs = mockQuery.mock.calls[0][0] as {
      filter: { and: Array<{ or?: Array<{ property: string; multi_select: { contains: string } }> }> }
    }
    const orFilters = callArgs.filter.and[0].or!
    const domainValues = orFilters.map(
      (f: { multi_select: { contains: string } }) => f.multi_select.contains
    )

    expect(domainValues).toContain("Grove Research")
    expect(domainValues).toContain("Grove Marketing")
  })

  test("home-garage returns no_domains (empty domain list)", async () => {
    const result = await fetchPovForPillar("Home/Garage")

    expect(result.status).toBe("no_domains")
    expect(result.content).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  test("unknown pillar returns no_domains", async () => {
    const result = await fetchPovForPillar("Nonexistent")

    expect(result.status).toBe("no_domains")
    expect(result.content).toBeNull()
  })
})

// ─── Caching ────────────────────────────────────────────────

describe("pov-fetcher caching", () => {
  test("second call uses cache (Notion queried only once)", async () => {
    mockQuery.mockResolvedValue({
      results: [fakePovPage({ title: "Cached Entry" })],
    })

    const first = await fetchPovForPillar("Consulting")
    const second = await fetchPovForPillar("Consulting")

    expect(first.status).toBe("found")
    expect(second.status).toBe("found")
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  test("clearPovCache forces fresh query", async () => {
    mockQuery.mockResolvedValue({
      results: [fakePovPage({ title: "Fresh Entry" })],
    })

    await fetchPovForPillar("Consulting")
    clearPovCache()
    await fetchPovForPillar("Consulting")

    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})

// ─── Keyword Scoring ────────────────────────────────────────

describe("pov-fetcher keyword scoring", () => {
  test("picks best match when multiple entries exist", async () => {
    mockQuery.mockResolvedValueOnce({
      results: [
        fakePovPage({
          title: "General Consulting POV",
          coreThesis: "Generic consulting value",
          domainCoverage: ["Consulting"],
        }),
        fakePovPage({
          title: "CLO Market Intelligence",
          coreThesis: "Card-linked offers drive measurable ROI",
          rhetoricalPatterns: "Data attribution, offer redemption rates",
          domainCoverage: ["gtm-consulting"],
        }),
      ],
    })

    const result = await fetchPovForPillar("Consulting", [
      "CLO",
      "card-linked",
      "attribution",
    ])

    expect(result.status).toBe("found")
    expect(result.content!.title).toBe("CLO Market Intelligence")
  })

  test("returns first entry when no keywords provided", async () => {
    mockQuery.mockResolvedValueOnce({
      results: [
        fakePovPage({ title: "First Entry" }),
        fakePovPage({ title: "Second Entry" }),
      ],
    })

    const result = await fetchPovForPillar("Consulting")

    expect(result.status).toBe("found")
    expect(result.content!.title).toBe("First Entry")
  })
})

// ─── Content Extraction ─────────────────────────────────────

describe("pov-fetcher content extraction", () => {
  test("extracts all structured fields from Notion page", async () => {
    mockQuery.mockResolvedValueOnce({
      results: [
        fakePovPage({
          title: "Full POV Entry",
          coreThesis: "The thesis",
          domainCoverage: ["gtm-consulting", "Consulting"],
        }),
      ],
    })

    const result = await fetchPovForPillar("Consulting")

    expect(result.content!.title).toBe("Full POV Entry")
    expect(result.content!.coreThesis).toBe("The thesis")
    expect(result.content!.evidenceStandards).toBe(
      "Peer-reviewed sources required"
    )
    expect(result.content!.rhetoricalPatterns).toBe("Authority + data-driven")
    expect(result.content!.counterArguments).toBe("Cost objection")
    expect(result.content!.boundaryConditions).toBe("Enterprise only")
    expect(result.content!.domainCoverage).toEqual([
      "gtm-consulting",
      "Consulting",
    ])
  })
})

// ─── Error Handling ─────────────────────────────────────────

describe("pov-fetcher error handling", () => {
  test("returns unreachable when Notion API throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("API rate limited"))

    const result = await fetchPovForPillar("Consulting")

    expect(result.status).toBe("unreachable")
    expect(result.error).toBe("API rate limited")
    expect(result.content).toBeNull()
  })

  test("returns no_match when query returns empty results", async () => {
    mockQuery.mockResolvedValueOnce({ results: [] })

    const result = await fetchPovForPillar("Consulting")

    expect(result.status).toBe("no_match")
    expect(result.content).toBeNull()
  })

  test("returns unreachable when no Notion token configured", async () => {
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN
    clearPovCache()

    const result = await fetchPovForPillar("Consulting")

    expect(result.status).toBe("unreachable")
    expect(result.error).toContain("not configured")
  })
})
