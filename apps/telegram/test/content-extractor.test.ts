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
    // Jina returns JSON — content must be >100 chars to pass SPA quality gate (ATLAS-CEX-001)
    const threadContent = "Full thread content extracted by Jina. This is a thoughtful post about the future of AI and how large language models will transform software development practices."
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              url: "https://www.threads.net/@user/post/abc123",
              title: "Thread Post Title",
              content: threadContent,
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
    expect(result.content).toBe(threadContent)
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

  it("passes correct Jina headers for Threads (article + shadow DOM + networkidle2 — CEX-002)", async () => {
    mockFetch.mockImplementationOnce((url: string, opts: any) => {
      // CEX-002: Jim's tuned recipe — article target survives login wall,
      // shadow DOM flattens Meta components, networkidle2 waits for JS data fetching
      expect(opts.headers["x-target-selector"]).toBe("article")
      expect(opts.headers["x-wait-for-selector"]).toBe("article")
      expect(opts.headers["x-with-shadow-dom"]).toBe("true")
      expect(opts.headers["x-wait-until"]).toBe("networkidle2")
      expect(opts.headers["x-no-cache"]).toBe("true")
      expect(opts.headers["x-timeout"]).toBe("45")
      expect(opts.headers["x-retain-images"]).toBe("none")
      expect(opts.headers["x-return-format"]).toBe("text")
      expect(opts.headers["Accept"]).toBe("application/json")

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: { title: "Thread", content: "Real post content from Jina with Shadow DOM flattening that is definitely long enough to pass the SPA quality gate threshold of 100 characters.", description: "" },
          }),
          { status: 200 },
        ),
      )
    })

    await extractContent("https://www.threads.net/@user/post/abc123")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("normalizes threads.com → threads.net before Jina request (CEX-002)", async () => {
    mockFetch.mockImplementationOnce((url: string, opts: any) => {
      // Should have rewritten threads.com to www.threads.net
      expect(url).toContain("www.threads.net")
      expect(url).not.toContain("threads.com")

      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: { title: "Thread", content: "Real post content from normalized URL that is definitely long enough to pass the SPA quality gate threshold of 100 characters minimum.", description: "" },
          }),
          { status: 200 },
        ),
      )
    })

    await extractContent("https://www.threads.com/@user/post/abc123")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ─── Cookie Domain Scoping (CEX-002) ─────────────────────

describe("Cookie domain scoping for Jina", () => {
  it("formats Threads cookies with Domain=.threads.net and comma separation (CEX-002)", async () => {
    // Import the cookie loader directly
    const { loadCookiesForUrl } = await import("../src/utils/chrome-cookies")
    const result = loadCookiesForUrl("https://www.threads.net/@user/post/abc123")

    if (!result) {
      // Skip if no cookie file exists (CI environments)
      console.log("  ⏭ No cookie file for threads.com — skipping domain scoping assertion")
      return
    }

    // CEX-002: Cookies MUST include Domain=.threads.net for Jina's headless browser.
    // Without domain scoping, cookies are host-only and get dropped on Meta's redirect chains.
    expect(result.cookieString).toContain("Domain=.threads.net")
    expect(result.cookieString).toContain("Path=/")
    expect(result.cookieString).toContain("Secure")
    expect(result.cookieString).toContain("HttpOnly")

    // Comma-separated (not semicolon-joined) per Jina's standard header folding
    expect(result.cookieString).toContain(", ")

    // Critical cookies must be present
    expect(result.cookieString).toContain("sessionid=")
    expect(result.cookieString).toContain("ds_user_id=")
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
  it("skips HTTP fallback for SPA sources when Jina fails (SPA guard — Part 2)", async () => {
    mockFetch.mockImplementation(() => {
      // All fetch calls fail (Jina + any cookie refresh attempt)
      return Promise.reject(new Error("Jina timeout"))
    })

    const result = await extractContent("https://www.threads.net/@user/post/abc123")
    // SPA sources: no HTTP fallback (would return login page garbage)
    expect(result.fallbackUsed).toBe(false)
    expect(result.status).toBe("failed")
    expect(result.error).toContain("Jina timeout") // Original error preserved in chain
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
              data: { title: "Back Online", content: "Real post content that is long enough to pass the SPA quality gate which requires at least 100 characters of actual content.", description: "" },
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
    const path = await import("path")
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../src/conversation/socratic-adapter.ts"),
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

// ─── SPA Content Quality Gate (ATLAS-CEX-001 P0) ────────

describe("SPA content quality gate", () => {
  it("REGRESSION: Threads boilerplate triggers degraded, NOT success (Boris Cherny bug)", async () => {
    // Jina returns a title (from <title> tag) but only author profile boilerplate
    // This is the EXACT bug: Jina 200 + title + short garbage → "success" → author biography research
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              url: "https://www.threads.net/@borischerny/post/abc123",
              title: "Boris Cherny on Threads",
              content: "Boris Cherny. 2 posts.", // Short boilerplate — NOT real post content
              description: "",
              usage: { tokens: 10 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await extractContent("https://www.threads.net/@borischerny/post/abc123")
    expect(result.status).toBe("degraded") // NOT "success"!
    expect(result.error).toContain("boilerplate")
    expect(result.source).toBe("threads")
  })

  it("REGRESSION: Threads boilerplate → toUrlContent maps to success=false", async () => {
    // The full chain: extractContent returns degraded → toUrlContent sees SPA + degraded → success=false
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              url: "https://www.threads.net/@user/post/xyz",
              title: "User Name on Threads",
              content: "User Name. 5 posts.",
              description: "",
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const extraction = await extractContent("https://www.threads.net/@user/post/xyz")
    const urlContent = toUrlContent(extraction)
    expect(urlContent.success).toBe(false) // Research will NOT use garbage bodySnippet
    expect(urlContent.error).toBeTruthy()
  })

  it("Threads with real post content (>100 chars) passes quality gate", async () => {
    const realPostContent = "I've been thinking about the future of TypeScript and how it will evolve with AI code generation. The key insight is that types become even more important when AI writes code — they're the specification language."
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              url: "https://www.threads.net/@user/post/real",
              title: "User Name on Threads",
              content: realPostContent,
              description: "",
              usage: { tokens: 50 },
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://www.threads.net/@user/post/real")
    expect(result.status).toBe("success") // Real content passes the gate
    expect(result.content).toBe(realPostContent)

    const urlContent = toUrlContent(result)
    expect(urlContent.success).toBe(true)
    expect(urlContent.bodySnippet).toBeTruthy()
  })

  it("Twitter boilerplate also triggers quality gate", async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              title: "@elonmusk on X",
              content: "Elon Musk. CEO.",
              description: "",
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://x.com/elonmusk/status/12345")
    expect(result.status).toBe("degraded")
    expect(result.source).toBe("twitter")
  })

  it("Non-SPA sources with short content still return success", async () => {
    // Articles/generic URLs don't need the SPA quality gate
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          '<html><head><title>Short Page</title></head><body>Brief.</body></html>',
          { status: 200 },
        ),
      ),
    )

    const result = await extractContent("https://example.com/short")
    expect(result.status).toBe("success") // Non-SPA, quality gate doesn't apply
    expect(result.source).toBe("article") // example.com routes to "article"
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
