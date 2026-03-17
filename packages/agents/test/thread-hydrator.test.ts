import { describe, it, expect, mock, beforeEach } from "bun:test"

// Mock Notion client before importing hydrator
const mockQuery = mock(() => Promise.resolve({ results: [] }))

mock.module("@notionhq/client", () => ({
  Client: class {
    databases = { query: mockQuery }
  },
}))

// Must import AFTER mock.module
const { hydrateThread } = await import("../src/thread/thread-hydrator")

// Ensure NOTION_API_KEY is set for tests
process.env.NOTION_API_KEY = "test-key"

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(() => Promise.resolve({ results: [] }))
})

describe("hydrateThread", () => {
  it("returns empty status when no Feed entries match", async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ results: [] }))

    const result = await hydrateThread("telegram:12345")

    expect(result.threadId).toBe("telegram:12345")
    expect(result.status).toBe("empty")
    expect(result.turns).toHaveLength(0)
    expect(result.returned).toBe(0)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("returns success with parsed turns when Feed entries exist", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            id: "page-1",
            properties: {
              Entry: { title: [{ plain_text: "Searched Gmail for Bernard" }] },
              Date: { date: { start: "2026-03-17T01:20:00Z" } },
              "Action Type": { select: { name: "tool" } },
              Pillar: { select: { name: "Personal" } },
              "Intent Hash": { rich_text: [{ plain_text: "abc123" }] },
              Surface: { select: { name: "telegram" } },
            },
          },
          {
            id: "page-2",
            properties: {
              Entry: { title: [{ plain_text: "URL share: threads.com post" }] },
              Date: { date: { start: "2026-03-17T01:15:00Z" } },
              "Action Type": { select: { name: "classify" } },
              Pillar: { select: { name: "The Grove" } },
            },
          },
        ],
      }),
    )

    const result = await hydrateThread("telegram:12345")

    expect(result.status).toBe("success")
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].feedId).toBe("page-1")
    expect(result.turns[0].entry).toBe("Searched Gmail for Bernard")
    expect(result.turns[0].actionType).toBe("tool")
    expect(result.turns[0].surface).toBe("telegram")
    expect(result.turns[1].feedId).toBe("page-2")
    expect(result.turns[1].pillar).toBe("The Grove")
  })

  it("returns degraded when Notion query throws", async () => {
    mockQuery.mockImplementation(() =>
      Promise.reject(new Error("Notion API rate limited")),
    )

    const result = await hydrateThread("telegram:12345")

    expect(result.status).toBe("degraded")
    expect(result.error).toContain("rate limited")
    expect(result.turns).toHaveLength(0)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("skips malformed Feed entries without crashing", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            id: "page-good",
            properties: {
              Entry: { title: [{ plain_text: "Valid entry" }] },
              Date: { date: { start: "2026-03-17T00:00:00Z" } },
            },
          },
          {
            id: "page-bad",
            properties: {
              // Missing Entry title — should be skipped
              Entry: { title: [] },
            },
          },
        ],
      }),
    )

    const result = await hydrateThread("telegram:12345")

    expect(result.status).toBe("success")
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].entry).toBe("Valid entry")
  })

  it("respects maxTurns parameter", async () => {
    mockQuery.mockImplementation((args: any) => {
      expect(args.page_size).toBe(3)
      return Promise.resolve({ results: [] })
    })

    await hydrateThread("telegram:12345", 3)

    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it("queries Feed 2.0 with correct thread_id filter", async () => {
    mockQuery.mockImplementation((args: any) => {
      expect(args.filter).toEqual({
        property: "Thread ID",
        rich_text: { equals: "bridge:session-abc" },
      })
      expect(args.sorts).toEqual([
        { property: "Date", direction: "descending" },
      ])
      return Promise.resolve({ results: [] })
    })

    await hydrateThread("bridge:session-abc")

    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
