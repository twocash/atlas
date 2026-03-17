import { describe, it, expect, mock, beforeEach } from "bun:test"

// Mock Notion client before importing
const mockQuery = mock(() => Promise.resolve({ results: [] }))

mock.module("@notionhq/client", () => ({
  Client: class {
    databases = { query: mockQuery }
  },
}))

process.env.NOTION_API_KEY = "test-key"

const { resumeByNativeId, resumeByThreadId } = await import("../src/thread/resume")

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(() => Promise.resolve({ results: [] }))
})

describe("resumeByNativeId", () => {
  it("derives thread_id and hydrates", async () => {
    const result = await resumeByNativeId("telegram", 8207593172)

    expect(result.thread.threadId).toBe("telegram:8207593172")
    expect(result.thread.surface).toBe("telegram")
    expect(result.hydration.threadId).toBe("telegram:8207593172")
  })

  it("returns empty contextBlock when no history", async () => {
    const result = await resumeByNativeId("bridge", "session-abc")

    expect(result.contextBlock).toBe("")
    expect(result.hydration.status).toBe("empty")
  })

  it("builds contextBlock with header for cold start", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            id: "page-1",
            properties: {
              Entry: { title: [{ plain_text: "Searched Gmail" }] },
              Date: { date: { start: "2026-03-17T01:00:00Z" } },
              Surface: { select: { name: "telegram" } },
            },
          },
        ],
      }),
    )

    const result = await resumeByNativeId("telegram", 12345, true)

    expect(result.coldStart).toBe(true)
    expect(result.contextBlock).toContain("resumed from persistent storage")
    expect(result.contextBlock).toContain("Searched Gmail")
    expect(result.contextBlock).toContain("(telegram)")
  })

  it("builds contextBlock with header for warm resume", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            id: "page-1",
            properties: {
              Entry: { title: [{ plain_text: "Previous turn" }] },
              Date: { date: { start: "2026-03-17T01:00:00Z" } },
            },
          },
        ],
      }),
    )

    const result = await resumeByNativeId("telegram", 12345, false)

    expect(result.coldStart).toBe(false)
    expect(result.contextBlock).toContain("Recent Thread History")
    expect(result.contextBlock).not.toContain("resumed from persistent storage")
  })
})

describe("resumeByThreadId", () => {
  it("hydrates directly from thread_id", async () => {
    const result = await resumeByThreadId("bridge:session-xyz")

    expect(result.thread.threadId).toBe("bridge:session-xyz")
    expect(result.thread.surface).toBe("bridge")
    expect(result.thread.surfaceNativeId).toBe("session-xyz")
  })

  it("works for cross-surface resume (bridge resuming telegram thread)", async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            id: "page-1",
            properties: {
              Entry: { title: [{ plain_text: "Original Telegram message" }] },
              Date: { date: { start: "2026-03-17T01:00:00Z" } },
              Surface: { select: { name: "telegram" } },
            },
          },
        ],
      }),
    )

    // Bridge resuming a thread that started on Telegram
    const result = await resumeByThreadId("telegram:8207593172", true)

    expect(result.contextBlock).toContain("resumed from persistent storage")
    expect(result.contextBlock).toContain("(telegram)")
    expect(result.contextBlock).toContain("Original Telegram message")
  })
})
