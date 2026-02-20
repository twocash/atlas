/**
 * Content Extractor Tests — ATLAS-CEX-001
 *
 * Tests for tiered URL content extraction (HTTP + Jina Reader),
 * circuit breaker, backward compatibility adapter, and mapIntentToRequestType fix.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"

// Mock fetch before importing the module under test
const mockFetch = mock(() =>
  Promise.resolve(
    new Response("<html><head><title>Test Page</title></head><body>Hello world</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  ),
)
globalThis.fetch = mockFetch as any

import {
  extractContent,
  toUrlContent,
  resetCircuitBreaker,
  type ExtractionResult,
} from "../src/conversation/content-extractor"

beforeEach(() => {
  mockFetch.mockClear()
  resetCircuitBreaker()
})

// ─── Routing Logic ───────────────────────────────────────

describe("extractContent routing", () => {
  it("uses HTTP (Tier 1) for article URLs", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          '<html><head><title>Great Article</title><meta name="description" content="An article"></head><body>Article body text here</body></html>',
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://example.com/blog/post")
    expect(result.method).toBe("Fetch")
    expect(result.source).toBe("article")
    expect(result.status).toBe("success")
    expect(result.title).toBe("Great Article")
  })

  it("uses Jina (Tier 2) for Threads URLs", async () => {
    // Jina returns JSON
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              url: "https://www.threads.net/@user/post/abc123",
              title: "Thread Post Title",
              content: "Full thread content extracted by Jina",
              description: "A thread post",
              usage: { tokens: 150 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await extractContent("https://www.threads.net/@user/post/abc123")
    expect(result.method).toBe("Browser")
    expect(result.source).toBe("threads")
    expect(result.status).toBe("success")
    expect(result.title).toBe("Thread Post Title")
    expect(result.content).toBe("Full thread content extracted by Jina")
    expect(result.tokenEstimate).toBe(150)
  })

  it("uses Jina (Tier 2) for Twitter/X URLs", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              title: "Tweet Title",
              content: "Tweet content",
              description: "",
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://x.com/user/status/12345")
    expect(result.method).toBe("Browser")
    expect(result.source).toBe("twitter")
  })

  it("uses Jina (Tier 2) for LinkedIn URLs", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              title: "LinkedIn Post",
              content: "Post content",
              description: "",
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://www.linkedin.com/posts/user_abc123")
    expect(result.method).toBe("Browser")
    expect(result.source).toBe("linkedin")
  })

  it("passes correct Jina headers for Threads", async () => {
    mockFetch.mockImplementationOnce((url: string, opts: any) => {
      // Verify Jina-specific headers from SOURCE_DEFAULTS
      expect(opts.headers["x-wait-for-selector"]).toBe("article")
      expect(opts.headers["x-target-selector"]).toBe("article")
      expect(opts.headers["x-no-cache"]).toBe("true")
      expect(opts.headers["x-timeout"]).toBe("15")
      expect(opts.headers["Accept"]).toBe("application/json")

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: { title: "Thread", content: "Content", description: "" },
          }),
          { status: 200 },
        ),
      )
    })

    await extractContent("https://www.threads.net/@user/post/abc123")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ─── HTTP Extraction (Tier 1) ────────────────────────────

describe("HTTP extraction", () => {
  it("extracts title from <title> tag", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response("<html><head><title>My Page</title></head><body>Content</body></html>", {
          status: 200,
        }),
      ),
    )

    const result = await extractContent("https://example.com/page")
    expect(result.title).toBe("My Page")
    expect(result.status).toBe("success")
  })

  it("extracts description from meta tag", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          '<html><head><title>T</title><meta name="description" content="Page description here"></head><body></body></html>',
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://example.com/page")
    expect(result.description).toBe("Page description here")
  })

  it("returns failed status on HTTP error", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" })),
    )

    const result = await extractContent("https://example.com/missing")
    expect(result.status).toBe("failed")
    expect(result.error).toContain("404")
  })

  it("returns failed status on network error", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("Connection refused")))

    const result = await extractContent("https://example.com/down")
    expect(result.status).toBe("failed")
    expect(result.error).toBe("Connection refused")
  })
})

// ─── Jina Fallback ───────────────────────────────────────

describe("Jina fallback to HTTP", () => {
  it("falls back to HTTP when Jina fails", async () => {
    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First call: Jina fails
        return Promise.reject(new Error("Jina timeout"))
      }
      // Second call: HTTP fallback
      return Promise.resolve(
        new Response("<html><head><title>Fallback Title</title></head><body>Content</body></html>", {
          status: 200,
        }),
      )
    })

    const result = await extractContent("https://www.threads.net/@user/post/abc123")
    expect(result.fallbackUsed).toBe(true)
    expect(result.status).toBe("degraded")
    expect(result.title).toBe("Fallback Title")
    expect(callCount).toBe(2) // Jina attempt + HTTP fallback
  })

  it("returns degraded when Jina returns empty content", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { title: "", content: "", description: "" },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://www.threads.net/@user/post/abc123")
    expect(result.status).toBe("degraded")
    expect(result.error).toContain("empty content")
  })
})

// ─── Circuit Breaker ─────────────────────────────────────

describe("circuit breaker", () => {
  it("opens after 3 consecutive Jina failures", async () => {
    // Simulate 3 Jina failures + their HTTP fallbacks
    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      // Odd calls = Jina (fail), Even calls = HTTP fallback (succeed)
      if (callCount % 2 === 1) {
        return Promise.reject(new Error("Jina down"))
      }
      return Promise.resolve(
        new Response("<html><head><title>Fallback</title></head><body></body></html>", {
          status: 200,
        }),
      )
    })

    // Three Threads URLs to trigger 3 consecutive Jina failures
    await extractContent("https://www.threads.net/@a/post/1")
    await extractContent("https://www.threads.net/@b/post/2")
    await extractContent("https://www.threads.net/@c/post/3")

    // Reset mock for the 4th call — track via mockFetch.mock.calls
    mockFetch.mockClear()
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("<html><head><title>Circuit Open Fallback</title></head><body></body></html>", {
          status: 200,
        }),
      ),
    )

    // 4th Threads URL should skip Jina entirely (circuit open) — only 1 HTTP call
    const result = await extractContent("https://www.threads.net/@d/post/4")
    expect(result.fallbackUsed).toBe(true)
    expect(mockFetch.mock.calls.length).toBe(1) // Only HTTP, no Jina attempt
  })

  it("resets after resetCircuitBreaker()", async () => {
    // Trip the circuit breaker
    mockFetch.mockImplementation(() => Promise.reject(new Error("Jina down")))
    try { await extractContent("https://www.threads.net/@a/post/1") } catch {}
    try { await extractContent("https://www.threads.net/@b/post/2") } catch {}
    try { await extractContent("https://www.threads.net/@c/post/3") } catch {}

    resetCircuitBreaker()

    // After reset, Jina should be attempted again
    mockFetch.mockClear()
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://r.jina.ai/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { title: "Back Online", content: "Content", description: "" },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response("<html><head><title>HTTP</title></head><body></body></html>", { status: 200 }),
      )
    })

    const result = await extractContent("https://www.threads.net/@e/post/5")
    expect(result.title).toBe("Back Online")
    expect(result.status).toBe("success")
  })
})

// ─── toUrlContent Adapter ────────────────────────────────

describe("toUrlContent adapter", () => {
  it("converts ExtractionResult to UrlContent", () => {
    const extraction: ExtractionResult = {
      url: "https://example.com",
      status: "success",
      method: "Fetch",
      source: "generic",
      title: "Test Title",
      description: "Test Description",
      content: "A".repeat(1000), // Long content
      extractedAt: new Date("2026-02-20T00:00:00Z"),
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.url).toBe("https://example.com")
    expect(urlContent.title).toBe("Test Title")
    expect(urlContent.description).toBe("Test Description")
    expect(urlContent.bodySnippet.length).toBe(500) // Truncated to 500
    expect(urlContent.success).toBe(true)
    expect(urlContent.error).toBeUndefined()
    expect(urlContent.fetchedAt).toEqual(new Date("2026-02-20T00:00:00Z"))
  })

  it("maps failed status to success=false", () => {
    const extraction: ExtractionResult = {
      url: "https://example.com",
      status: "failed",
      method: "Fetch",
      source: "generic",
      title: "",
      description: "",
      content: "",
      extractedAt: new Date(),
      error: "Connection refused",
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(false)
    expect(urlContent.error).toBe("Connection refused")
  })

  it("maps degraded status to success=true for non-SPA sources", () => {
    const extraction: ExtractionResult = {
      url: "https://example.com/blog/post",
      status: "degraded",
      method: "Fetch",
      source: "article",
      title: "Article Title",
      description: "Good article content",
      content: "Full article text",
      extractedAt: new Date(),
      fallbackUsed: false,
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(true) // articles degrade gracefully
  })

  it("maps degraded SPA status to success=FALSE (CONSTRAINT 4: error > BS)", () => {
    // Threads + degraded = login page HTML, not real content
    const extraction: ExtractionResult = {
      url: "https://www.threads.net/@user/post/abc123",
      status: "degraded",
      method: "Browser",
      source: "threads",
      title: "Fallback Title",
      description: "",
      content: "Some content",
      extractedAt: new Date(),
      fallbackUsed: true,
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(false) // SPA degraded = FAILURE
    expect(urlContent.error).toContain("browser rendering")
    expect(urlContent.error).toContain("login page")
  })

  it("maps degraded Twitter to failure", () => {
    const extraction: ExtractionResult = {
      url: "https://x.com/user/status/12345",
      status: "degraded",
      method: "Browser",
      source: "twitter",
      title: "",
      description: "",
      content: "<html>Login page garbage</html>",
      extractedAt: new Date(),
      fallbackUsed: true,
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(false) // Twitter degraded = FAILURE
    expect(urlContent.error).toContain("twitter")
  })

  it("maps degraded LinkedIn to failure", () => {
    const extraction: ExtractionResult = {
      url: "https://www.linkedin.com/posts/user_abc",
      status: "degraded",
      method: "Browser",
      source: "linkedin",
      title: "",
      description: "",
      content: "Sign in to LinkedIn",
      extractedAt: new Date(),
      fallbackUsed: true,
    }

    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(false) // LinkedIn degraded = FAILURE
  })
})

// ─── mapIntentToRequestType Bug Fix ──────────────────────

describe("mapIntentToRequestType fix", () => {
  // We can't import the private function directly, so we test via
  // the socratic-adapter's exported behavior. For now, we do a
  // focused regex test on the source to confirm the fix is present.
  it("capture intent returns Process, not Research", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      "apps/telegram/src/conversation/socratic-adapter.ts",
      "utf-8",
    )

    // The fix: capture/save should return 'Process'
    const captureMatch = source.match(
      /case\s+'capture':\s*\n\s*case\s+'save':\s*return\s+'(\w+)'/,
    )
    expect(captureMatch).toBeTruthy()
    expect(captureMatch![1]).toBe("Process")

    // Verify 'Research' is NOT the fallthrough for capture
    const captureResearchBug = source.match(
      /case\s+'capture':\s*\n\s*case\s+'save':\s*\n\s*default:\s*return\s+'Research'/,
    )
    expect(captureResearchBug).toBeNull() // Bug pattern should NOT exist
  })
})

// ─── forceMethod Override ────────────────────────────────

describe("forceMethod option", () => {
  it("forces HTTP extraction even for SPA URLs", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response("<html><head><title>Forced HTTP</title></head><body>Content</body></html>", {
          status: 200,
        }),
      ),
    )

    const result = await extractContent("https://www.threads.net/@user/post/abc123", {
      forceMethod: "Fetch",
    })
    expect(result.method).toBe("Fetch")
    expect(result.title).toBe("Forced HTTP")
  })
})
