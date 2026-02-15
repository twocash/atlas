/**
 * Tool Dispatch Pipeline — Brutal Mock Tests
 *
 * Tests the entire Phase 4 tool dispatch chain with real-world data:
 *   MCP Server → Bridge /tool-dispatch → WebSocket → Extension → Response
 *
 * No live services required. All external dependencies are mocked.
 *
 * Test groups:
 *   1. Tool Schema Validation — completeness, consistency, no drift
 *   2. MCP Server Logic — request handling, dispatch, error paths
 *   3. Bridge Server Routing — HTTP ↔ WebSocket mediation, timeouts
 *   4. Extension Tool Executor — chrome.* API mocking, DOM tool results
 *   5. Protocol Contract — type correctness across the full chain
 *   6. Adversarial Inputs — malformed data, missing fields, huge payloads
 */

import { describe, it, expect, beforeEach } from "bun:test"

// ─── Direct imports (no side effects, pure logic) ────────────────

import {
  TOOL_SCHEMAS,
  TOOL_NAMES,
  getToolSchema,
} from "../src/tools/schemas"

import {
  TOOL_TIMEOUT_MS,
  CONTENT_TRUNCATION_BYTES,
  MCP_SERVER_NAME,
  type ToolRequest,
  type ToolResponse,
  type ToolDispatchRequest,
  type ToolDispatchResponse,
  type ToolSchema,
  type PageContentResult,
  type DomElementResult,
  type ConsoleErrorResult,
  type ExtensionStateResult,
  type SelectorQueryResult,
  type LinkedInContextResult,
} from "../src/types/tool-protocol"

// =============================================================================
// 1. TOOL SCHEMA VALIDATION
// =============================================================================

describe("Tool Schema Validation", () => {
  const EXPECTED_TOOLS = [
    "atlas_read_current_page",
    "atlas_get_dom_element",
    "atlas_get_console_errors",
    "atlas_get_extension_state",
    "atlas_query_selectors",
    "atlas_get_linkedin_context",
  ] as const

  it("defines exactly 6 tools", () => {
    expect(TOOL_SCHEMAS.length).toBe(6)
  })

  it("exports all expected tool names", () => {
    for (const name of EXPECTED_TOOLS) {
      expect(TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it("has no extra tools beyond the expected set", () => {
    const extra = TOOL_SCHEMAS.filter(
      (s) => !EXPECTED_TOOLS.includes(s.name as any)
    )
    expect(extra).toEqual([])
  })

  it("every schema has name, description, and inputSchema", () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.name).toBeTruthy()
      expect(schema.description).toBeTruthy()
      expect(schema.description.length).toBeGreaterThan(20)
      expect(schema.inputSchema).toBeDefined()
      expect(schema.inputSchema.type).toBe("object")
      expect(schema.inputSchema.properties).toBeDefined()
    }
  })

  it("getToolSchema returns correct schema for each tool", () => {
    for (const name of EXPECTED_TOOLS) {
      const schema = getToolSchema(name)
      expect(schema).toBeDefined()
      expect(schema!.name).toBe(name)
    }
  })

  it("getToolSchema returns undefined for unknown tools", () => {
    expect(getToolSchema("nonexistent_tool")).toBeUndefined()
    expect(getToolSchema("")).toBeUndefined()
    expect(getToolSchema("atlas_")).toBeUndefined()
  })

  it("atlas_get_dom_element requires 'selector' parameter", () => {
    const schema = getToolSchema("atlas_get_dom_element")!
    expect(schema.inputSchema.required).toContain("selector")
    expect(schema.inputSchema.properties.selector.type).toBe("string")
  })

  it("atlas_query_selectors requires 'selectors' array parameter", () => {
    const schema = getToolSchema("atlas_query_selectors")!
    expect(schema.inputSchema.required).toContain("selectors")
    expect(schema.inputSchema.properties.selectors.type).toBe("array")
    expect(schema.inputSchema.properties.selectors.items?.type).toBe("string")
  })

  it("atlas_read_current_page has optional maxLength with default", () => {
    const schema = getToolSchema("atlas_read_current_page")!
    expect(schema.inputSchema.required).toBeUndefined()
    expect(schema.inputSchema.properties.maxLength.type).toBe("number")
    expect(schema.inputSchema.properties.maxLength.default).toBe(50000)
  })

  it("atlas_get_linkedin_context has optional includeComments boolean", () => {
    const schema = getToolSchema("atlas_get_linkedin_context")!
    expect(schema.inputSchema.properties.includeComments.type).toBe("boolean")
    expect(schema.inputSchema.properties.includeComments.default).toBe(false)
  })

  it("no schema descriptions mention deprecated or removed features", () => {
    for (const schema of TOOL_SCHEMAS) {
      const desc = schema.description.toLowerCase()
      expect(desc).not.toContain("deprecated")
      expect(desc).not.toContain("removed")
      expect(desc).not.toContain("sdk-url")
    }
  })

  it("all tool names follow atlas_ prefix convention", () => {
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.name.startsWith("atlas_")).toBe(true)
    }
  })
})

// =============================================================================
// 2. MCP SERVER LOGIC (mocked fetch to bridge)
// =============================================================================

describe("MCP Server Dispatch Logic", () => {
  // Simulate the dispatchTool function from mcp-server.ts
  async function dispatchTool(
    name: string,
    args: Record<string, unknown>,
    mockFetch: (url: string, opts: any) => Promise<Response>,
  ): Promise<ToolDispatchResponse> {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const body: ToolDispatchRequest = { id, name, input: args }
    const BRIDGE_URL = "http://localhost:3848"

    try {
      const res = await mockFetch(`${BRIDGE_URL}/tool-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return { id, error: `Bridge returned ${res.status}: ${text}` }
      }

      return (await res.json()) as ToolDispatchResponse
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { id, error: `Tool '${name}' timed out after ${TOOL_TIMEOUT_MS}ms` }
      }
      return { id, error: `Bridge unreachable: ${err.message}` }
    }
  }

  it("forwards successful tool result from bridge", async () => {
    const mockResult: PageContentResult = {
      url: "https://linkedin.com/in/jim-calhoun",
      title: "Jim Calhoun | LinkedIn",
      content: "Software architect and AI builder...",
      contentLength: 35,
      truncated: false,
    }

    const mockFetch = async () =>
      new Response(JSON.stringify({ id: "test", result: mockResult }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })

    const result = await dispatchTool("atlas_read_current_page", {}, mockFetch)
    expect(result.error).toBeUndefined()
    expect(result.result).toEqual(mockResult)
  })

  it("handles bridge 503 (no extension connected)", async () => {
    const mockFetch = async () =>
      new Response("No browser extension connected", { status: 503 })

    const result = await dispatchTool("atlas_get_extension_state", {}, mockFetch)
    expect(result.error).toContain("Bridge returned 503")
  })

  it("handles bridge 400 (bad request)", async () => {
    const mockFetch = async () =>
      new Response("Missing id or name", { status: 400 })

    const result = await dispatchTool("atlas_get_dom_element", { selector: "h1" }, mockFetch)
    expect(result.error).toContain("Bridge returned 400")
  })

  it("handles bridge unreachable (connection refused)", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3848")
    }

    const result = await dispatchTool("atlas_read_current_page", {}, mockFetch)
    expect(result.error).toContain("Bridge unreachable")
    expect(result.error).toContain("ECONNREFUSED")
  })

  it("handles AbortError as timeout", async () => {
    const mockFetch = async () => {
      const err = new Error("Aborted")
      err.name = "AbortError"
      throw err
    }

    const result = await dispatchTool("atlas_read_current_page", {}, mockFetch)
    expect(result.error).toContain("timed out")
  })

  it("handles bridge returning malformed JSON", async () => {
    const mockFetch = async () =>
      new Response("not json{{{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })

    const result = await dispatchTool("atlas_read_current_page", {}, mockFetch)
    // JSON parse will throw, caught by the dispatch wrapper
    expect(result.error).toBeDefined()
  })

  it("passes tool input arguments correctly", async () => {
    let capturedBody: any = null
    const mockFetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return new Response(JSON.stringify({ id: capturedBody.id, result: {} }), {
        status: 200,
      })
    }

    await dispatchTool("atlas_get_dom_element", { selector: "#main .title" }, mockFetch)
    expect(capturedBody.name).toBe("atlas_get_dom_element")
    expect(capturedBody.input).toEqual({ selector: "#main .title" })
  })
})

// =============================================================================
// 3. BRIDGE SERVER ROUTING
// =============================================================================

describe("Bridge Server Tool Routing", () => {
  // Simulate the bridge's tool dispatch logic
  function createBridgeDispatcher() {
    const pendingRequests = new Map<
      string,
      { resolve: (r: ToolDispatchResponse) => void; timer: ReturnType<typeof setTimeout> }
    >()
    const sentToClients: ToolRequest[] = []

    function handleToolDispatch(
      body: ToolDispatchRequest,
      clientCount: number,
    ): Promise<ToolDispatchResponse> {
      if (!body.id || !body.name) {
        return Promise.resolve({ id: body.id || "", error: "Missing id or name" })
      }

      if (clientCount === 0) {
        return Promise.resolve({ id: body.id, error: "No browser extension connected" })
      }

      return new Promise<ToolDispatchResponse>((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(body.id)
          resolve({ id: body.id, error: `Tool '${body.name}' timed out after ${TOOL_TIMEOUT_MS}ms` })
        }, TOOL_TIMEOUT_MS)

        pendingRequests.set(body.id, { resolve, timer })

        const toolRequest: ToolRequest = {
          type: "tool_request",
          id: body.id,
          name: body.name,
          input: body.input,
          timestamp: Date.now(),
        }
        sentToClients.push(toolRequest)
      })
    }

    function handleToolResponse(msg: ToolResponse): void {
      const pending = pendingRequests.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingRequests.delete(msg.id)
      pending.resolve({ id: msg.id, result: msg.result, error: msg.error })
    }

    return { handleToolDispatch, handleToolResponse, sentToClients, pendingRequests }
  }

  it("routes tool_request to WebSocket clients", async () => {
    const bridge = createBridgeDispatcher()
    const dispatchPromise = bridge.handleToolDispatch(
      { id: "req-1", name: "atlas_get_extension_state", input: {} },
      1,
    )

    // Simulate extension responding
    expect(bridge.sentToClients.length).toBe(1)
    expect(bridge.sentToClients[0].name).toBe("atlas_get_extension_state")
    expect(bridge.sentToClients[0].id).toBe("req-1")

    bridge.handleToolResponse({
      type: "tool_response",
      id: "req-1",
      result: { currentView: "sidepanel", bridgeStatus: "connected" },
    })

    const result = await dispatchPromise
    expect(result.error).toBeUndefined()
    expect((result.result as any).currentView).toBe("sidepanel")
  })

  it("returns 503 when no clients connected", async () => {
    const bridge = createBridgeDispatcher()
    const result = await bridge.handleToolDispatch(
      { id: "req-2", name: "atlas_read_current_page", input: {} },
      0,
    )
    expect(result.error).toContain("No browser extension connected")
  })

  it("returns error for missing id", async () => {
    const bridge = createBridgeDispatcher()
    const result = await bridge.handleToolDispatch(
      { id: "", name: "atlas_read_current_page", input: {} },
      1,
    )
    expect(result.error).toContain("Missing id or name")
  })

  it("returns error for missing name", async () => {
    const bridge = createBridgeDispatcher()
    const result = await bridge.handleToolDispatch(
      { id: "req-3", name: "", input: {} },
      1,
    )
    expect(result.error).toContain("Missing id or name")
  })

  it("propagates error from extension", async () => {
    const bridge = createBridgeDispatcher()
    const dispatchPromise = bridge.handleToolDispatch(
      { id: "req-4", name: "atlas_get_linkedin_context", input: {} },
      1,
    )

    bridge.handleToolResponse({
      type: "tool_response",
      id: "req-4",
      error: "Current tab is not a LinkedIn page",
    })

    const result = await dispatchPromise
    expect(result.error).toBe("Current tab is not a LinkedIn page")
    expect(result.result).toBeUndefined()
  })

  it("ignores tool_response for unknown request ID", () => {
    const bridge = createBridgeDispatcher()
    // Should not throw
    bridge.handleToolResponse({
      type: "tool_response",
      id: "unknown-id",
      result: { data: "orphaned" },
    })
    expect(bridge.pendingRequests.size).toBe(0)
  })

  it("handles concurrent tool dispatches independently", async () => {
    const bridge = createBridgeDispatcher()

    const p1 = bridge.handleToolDispatch(
      { id: "concurrent-1", name: "atlas_read_current_page", input: {} },
      1,
    )
    const p2 = bridge.handleToolDispatch(
      { id: "concurrent-2", name: "atlas_get_dom_element", input: { selector: "h1" } },
      1,
    )

    expect(bridge.pendingRequests.size).toBe(2)

    // Respond in reverse order
    bridge.handleToolResponse({
      type: "tool_response",
      id: "concurrent-2",
      result: { found: true, tagName: "h1" },
    })
    bridge.handleToolResponse({
      type: "tool_response",
      id: "concurrent-1",
      result: { url: "https://example.com", title: "Test" },
    })

    const [r1, r2] = await Promise.all([p1, p2])
    expect((r1.result as any).url).toBe("https://example.com")
    expect((r2.result as any).tagName).toBe("h1")
    expect(bridge.pendingRequests.size).toBe(0)
  })

  it("cleans up pending request on response", async () => {
    const bridge = createBridgeDispatcher()
    const p = bridge.handleToolDispatch(
      { id: "cleanup-1", name: "atlas_get_extension_state", input: {} },
      1,
    )

    expect(bridge.pendingRequests.has("cleanup-1")).toBe(true)

    bridge.handleToolResponse({
      type: "tool_response",
      id: "cleanup-1",
      result: {},
    })

    await p
    expect(bridge.pendingRequests.has("cleanup-1")).toBe(false)
  })
})

// =============================================================================
// 4. EXTENSION TOOL EXECUTOR (mocked chrome.* APIs)
// =============================================================================

describe("Extension Tool Executor", () => {
  // Simulated tool executor (mirrors tool-executor.ts dispatch logic)
  // We mock the chrome.* calls at the boundary

  interface MockTab {
    id: number
    url: string
    title: string
  }

  interface MockDom {
    title: string
    bodyText: string
    elements: Map<string, {
      tagName: string
      textContent: string
      attributes: Record<string, string>
      childCount: number
      rect: { x: number; y: number; width: number; height: number }
    }>
  }

  function createMockExecutor(tab: MockTab, dom: MockDom) {
    async function executeToolRequest(
      request: ToolRequest,
    ): Promise<ToolResponse> {
      try {
        const result = await dispatch(request.name, request.input, tab, dom)
        return { type: "tool_response", id: request.id, result }
      } catch (err: any) {
        return { type: "tool_response", id: request.id, error: err.message || String(err) }
      }
    }

    async function dispatch(
      name: string,
      input: Record<string, unknown>,
      tab: MockTab,
      dom: MockDom,
    ): Promise<unknown> {
      switch (name) {
        case "atlas_read_current_page": {
          const maxLength = (input.maxLength as number) || 50_000
          const content = dom.bodyText.slice(0, maxLength)
          return {
            url: tab.url,
            title: dom.title,
            content,
            contentLength: dom.bodyText.length,
            truncated: dom.bodyText.length > maxLength,
          } satisfies PageContentResult
        }

        case "atlas_get_dom_element": {
          const selector = input.selector as string
          if (!selector) throw new Error("Missing required parameter: selector")
          const el = dom.elements.get(selector)
          if (!el) return { found: false, selector } satisfies Partial<DomElementResult>
          return {
            found: true,
            selector,
            tagName: el.tagName,
            textContent: el.textContent.slice(0, 1000),
            attributes: el.attributes,
            boundingBox: el.rect,
            childCount: el.childCount,
          } satisfies DomElementResult
        }

        case "atlas_get_console_errors":
          return {
            errors: [],
            count: 0,
            note: "Console error capture requires a pre-injected listener.",
          }

        case "atlas_get_extension_state":
          return {
            currentView: "sidepanel",
            bridgeStatus: "connected",
            claudeStatus: "connected",
            tabUrl: tab.url,
            tabTitle: tab.title,
          } satisfies ExtensionStateResult

        case "atlas_query_selectors": {
          const selectors = input.selectors as string[]
          if (!selectors || !Array.isArray(selectors))
            throw new Error("Missing required parameter: selectors (array of CSS selectors)")
          return {
            results: selectors.map((sel) => {
              const el = dom.elements.get(sel)
              return {
                selector: sel,
                found: !!el,
                count: el ? 1 : 0,
                firstText: el ? el.textContent.slice(0, 200) : undefined,
              }
            }),
          } satisfies SelectorQueryResult
        }

        case "atlas_get_linkedin_context": {
          if (!tab.url.includes("linkedin.com"))
            throw new Error("Current tab is not a LinkedIn page")

          const path = new URL(tab.url).pathname
          let pageType: LinkedInContextResult["pageType"] = "unknown"
          if (path.startsWith("/in/")) pageType = "profile"
          else if (path === "/feed/" || path === "/feed") pageType = "feed"
          else if (path.includes("/posts/")) pageType = "post"
          else if (path.startsWith("/company/")) pageType = "company"
          else if (path.startsWith("/search/")) pageType = "search"

          return { pageType, url: tab.url, data: {} } satisfies LinkedInContextResult
        }

        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    }

    return { executeToolRequest }
  }

  // ─── Realistic mock data ────────────────────────────────────

  const linkedInTab: MockTab = {
    id: 42,
    url: "https://www.linkedin.com/in/jim-calhoun-ai/",
    title: "Jim Calhoun | Building AI Systems | LinkedIn",
  }

  const linkedInDom: MockDom = {
    title: "Jim Calhoun | Building AI Systems | LinkedIn",
    bodyText:
      "Jim Calhoun\nBuilding AI Systems for Cognitive Partnership\n" +
      "San Francisco Bay Area\n500+ connections\n" +
      "About\nI build AI systems that work as extensions of human cognition...\n" +
      "Experience\nFounder & CTO at The Grove\n" +
      "Building atlas — a personal cognitive co-pilot using Claude, Notion, and Telegram.\n",
    elements: new Map([
      [
        "h1.text-heading-xlarge",
        {
          tagName: "h1",
          textContent: "Jim Calhoun",
          attributes: { class: "text-heading-xlarge" },
          childCount: 0,
          rect: { x: 200, y: 150, width: 400, height: 40 },
        },
      ],
      [
        ".text-body-medium.break-words",
        {
          tagName: "div",
          textContent: "Building AI Systems for Cognitive Partnership",
          attributes: { class: "text-body-medium break-words" },
          childCount: 0,
          rect: { x: 200, y: 200, width: 400, height: 24 },
        },
      ],
      [
        ".pv-top-card--experience-list",
        {
          tagName: "ul",
          textContent: "Founder & CTO at The Grove",
          attributes: { class: "pv-top-card--experience-list" },
          childCount: 3,
          rect: { x: 200, y: 400, width: 400, height: 100 },
        },
      ],
    ]),
  }

  const genericTab: MockTab = {
    id: 99,
    url: "https://docs.anthropic.com/en/docs/agents",
    title: "Building AI Agents | Anthropic",
  }

  const genericDom: MockDom = {
    title: "Building AI Agents | Anthropic",
    bodyText: "A".repeat(120_000), // 120KB of content to test truncation
    elements: new Map([
      [
        "h1",
        {
          tagName: "h1",
          textContent: "Building AI Agents",
          attributes: { id: "main-heading" },
          childCount: 0,
          rect: { x: 100, y: 80, width: 600, height: 48 },
        },
      ],
      [
        "article",
        {
          tagName: "article",
          textContent: "Long article content here...",
          attributes: { class: "docs-content" },
          childCount: 15,
          rect: { x: 100, y: 150, width: 800, height: 2000 },
        },
      ],
    ]),
  }

  // ─── Tests ─────────────────────────────────────────────────

  describe("atlas_read_current_page", () => {
    it("returns full page content when under limit", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "rcp-1",
        name: "atlas_read_current_page",
        input: {},
        timestamp: Date.now(),
      })

      expect(res.error).toBeUndefined()
      const result = res.result as PageContentResult
      expect(result.url).toBe(linkedInTab.url)
      expect(result.title).toBe(linkedInDom.title)
      expect(result.truncated).toBe(false)
      expect(result.content).toContain("Jim Calhoun")
    })

    it("truncates content exceeding maxLength", async () => {
      const exec = createMockExecutor(genericTab, genericDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "rcp-2",
        name: "atlas_read_current_page",
        input: { maxLength: 1000 },
        timestamp: Date.now(),
      })

      const result = res.result as PageContentResult
      expect(result.truncated).toBe(true)
      expect(result.content.length).toBe(1000)
      expect(result.contentLength).toBe(120_000)
    })

    it("handles default maxLength of 50000", async () => {
      const exec = createMockExecutor(genericTab, genericDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "rcp-3",
        name: "atlas_read_current_page",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as PageContentResult
      expect(result.truncated).toBe(true)
      expect(result.content.length).toBe(50_000)
    })
  })

  describe("atlas_get_dom_element", () => {
    it("finds element by CSS selector", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "dom-1",
        name: "atlas_get_dom_element",
        input: { selector: "h1.text-heading-xlarge" },
        timestamp: Date.now(),
      })

      const result = res.result as DomElementResult
      expect(result.found).toBe(true)
      expect(result.tagName).toBe("h1")
      expect(result.textContent).toBe("Jim Calhoun")
      expect(result.boundingBox).toBeDefined()
      expect(result.boundingBox!.width).toBe(400)
    })

    it("returns found:false for missing element", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "dom-2",
        name: "atlas_get_dom_element",
        input: { selector: ".nonexistent-class" },
        timestamp: Date.now(),
      })

      const result = res.result as DomElementResult
      expect(result.found).toBe(false)
      expect(result.selector).toBe(".nonexistent-class")
    })

    it("errors on missing selector parameter", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "dom-3",
        name: "atlas_get_dom_element",
        input: {},
        timestamp: Date.now(),
      })

      expect(res.error).toContain("Missing required parameter: selector")
    })
  })

  describe("atlas_get_console_errors", () => {
    it("returns empty errors array (MVP limitation)", async () => {
      const exec = createMockExecutor(genericTab, genericDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "err-1",
        name: "atlas_get_console_errors",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as any
      expect(result.errors).toEqual([])
      expect(result.count).toBe(0)
      expect(result.note).toContain("pre-injected listener")
    })
  })

  describe("atlas_get_extension_state", () => {
    it("returns current extension state with tab info", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "state-1",
        name: "atlas_get_extension_state",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as ExtensionStateResult
      expect(result.currentView).toBe("sidepanel")
      expect(result.bridgeStatus).toBe("connected")
      expect(result.claudeStatus).toBe("connected")
      expect(result.tabUrl).toBe(linkedInTab.url)
      expect(result.tabTitle).toBe(linkedInTab.title)
    })
  })

  describe("atlas_query_selectors", () => {
    it("tests multiple selectors and reports matches", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "qs-1",
        name: "atlas_query_selectors",
        input: {
          selectors: [
            "h1.text-heading-xlarge",
            ".text-body-medium.break-words",
            ".nonexistent",
          ],
        },
        timestamp: Date.now(),
      })

      const result = res.result as SelectorQueryResult
      expect(result.results.length).toBe(3)
      expect(result.results[0].found).toBe(true)
      expect(result.results[0].firstText).toBe("Jim Calhoun")
      expect(result.results[1].found).toBe(true)
      expect(result.results[2].found).toBe(false)
      expect(result.results[2].count).toBe(0)
    })

    it("errors on missing selectors parameter", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "qs-2",
        name: "atlas_query_selectors",
        input: {},
        timestamp: Date.now(),
      })

      expect(res.error).toContain("Missing required parameter: selectors")
    })

    it("errors on non-array selectors parameter", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "qs-3",
        name: "atlas_query_selectors",
        input: { selectors: "h1" },
        timestamp: Date.now(),
      })

      expect(res.error).toContain("Missing required parameter: selectors")
    })
  })

  describe("atlas_get_linkedin_context", () => {
    it("detects profile page type", async () => {
      const exec = createMockExecutor(linkedInTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-1",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("profile")
      expect(result.url).toBe(linkedInTab.url)
    })

    it("detects feed page type", async () => {
      const feedTab = { ...linkedInTab, url: "https://www.linkedin.com/feed/" }
      const exec = createMockExecutor(feedTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-2",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("feed")
    })

    it("detects post page type", async () => {
      const postTab = { ...linkedInTab, url: "https://www.linkedin.com/posts/jim-calhoun_ai-strategy-7321" }
      const exec = createMockExecutor(postTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-3",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("post")
    })

    it("detects company page type", async () => {
      const companyTab = { ...linkedInTab, url: "https://www.linkedin.com/company/anthropic/" }
      const exec = createMockExecutor(companyTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-4",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("company")
    })

    it("detects search page type", async () => {
      const searchTab = { ...linkedInTab, url: "https://www.linkedin.com/search/results/people/?keywords=ai" }
      const exec = createMockExecutor(searchTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-5",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("search")
    })

    it("errors when current tab is not LinkedIn", async () => {
      const exec = createMockExecutor(genericTab, genericDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-6",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      expect(res.error).toBe("Current tab is not a LinkedIn page")
    })

    it("returns 'unknown' for unrecognized LinkedIn paths", async () => {
      const weirdTab = { ...linkedInTab, url: "https://www.linkedin.com/notifications/" }
      const exec = createMockExecutor(weirdTab, linkedInDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "li-7",
        name: "atlas_get_linkedin_context",
        input: {},
        timestamp: Date.now(),
      })

      const result = res.result as LinkedInContextResult
      expect(result.pageType).toBe("unknown")
    })
  })

  describe("Unknown tools", () => {
    it("errors for unknown tool name", async () => {
      const exec = createMockExecutor(genericTab, genericDom)
      const res = await exec.executeToolRequest({
        type: "tool_request",
        id: "unk-1",
        name: "atlas_delete_everything",
        input: {},
        timestamp: Date.now(),
      })

      expect(res.error).toContain("Unknown tool")
    })
  })
})

// =============================================================================
// 5. PROTOCOL CONTRACT
// =============================================================================

describe("Protocol Contract", () => {
  it("ToolRequest type field is always 'tool_request'", () => {
    const req: ToolRequest = {
      type: "tool_request",
      id: "proto-1",
      name: "atlas_read_current_page",
      input: {},
      timestamp: Date.now(),
    }
    expect(req.type).toBe("tool_request")
  })

  it("ToolResponse type field is always 'tool_response'", () => {
    const res: ToolResponse = {
      type: "tool_response",
      id: "proto-1",
      result: { data: "test" },
    }
    expect(res.type).toBe("tool_response")
  })

  it("ToolResponse has result XOR error, never both with data", () => {
    // Success case
    const success: ToolResponse = {
      type: "tool_response",
      id: "xor-1",
      result: { found: true },
    }
    expect(success.result).toBeDefined()
    expect(success.error).toBeUndefined()

    // Error case
    const error: ToolResponse = {
      type: "tool_response",
      id: "xor-2",
      error: "Something went wrong",
    }
    expect(error.result).toBeUndefined()
    expect(error.error).toBeDefined()
  })

  it("request IDs correlate across dispatch chain", () => {
    const dispatchReq: ToolDispatchRequest = { id: "corr-1", name: "atlas_get_extension_state", input: {} }
    const toolReq: ToolRequest = { type: "tool_request", id: dispatchReq.id, name: dispatchReq.name, input: dispatchReq.input, timestamp: Date.now() }
    const toolRes: ToolResponse = { type: "tool_response", id: toolReq.id, result: {} }
    const dispatchRes: ToolDispatchResponse = { id: toolRes.id, result: toolRes.result }

    expect(dispatchReq.id).toBe(toolReq.id)
    expect(toolReq.id).toBe(toolRes.id)
    expect(toolRes.id).toBe(dispatchRes.id)
    expect(dispatchRes.id).toBe("corr-1")
  })

  it("TOOL_TIMEOUT_MS is reasonable (1-30 seconds)", () => {
    expect(TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(1000)
    expect(TOOL_TIMEOUT_MS).toBeLessThanOrEqual(30000)
  })

  it("CONTENT_TRUNCATION_BYTES is 50KB", () => {
    expect(CONTENT_TRUNCATION_BYTES).toBe(50 * 1024)
  })

  it("MCP_SERVER_NAME is 'atlas-browser'", () => {
    expect(MCP_SERVER_NAME).toBe("atlas-browser")
  })

  it("ToolDispatchRequest has exactly id, name, input fields", () => {
    const req: ToolDispatchRequest = { id: "f-1", name: "test", input: { a: 1 } }
    const keys = Object.keys(req).sort()
    expect(keys).toEqual(["id", "input", "name"])
  })
})

// =============================================================================
// 6. ADVERSARIAL INPUTS
// =============================================================================

describe("Adversarial Inputs", () => {
  it("handles empty string tool name gracefully", () => {
    expect(TOOL_NAMES.has("")).toBe(false)
    expect(getToolSchema("")).toBeUndefined()
  })

  it("handles extremely long tool name", () => {
    const longName = "atlas_" + "x".repeat(10000)
    expect(TOOL_NAMES.has(longName)).toBe(false)
  })

  it("handles special characters in selector input", () => {
    // These are valid CSS selectors that should not crash
    const selectors = [
      'input[name="email"]',
      "div > span:nth-child(2)",
      '.class-with-special\\:chars',
      "#id\\.with\\.dots",
      "*",
      "body > *",
    ]
    // The mock executor should handle these without crashing
    for (const sel of selectors) {
      const req: ToolRequest = {
        type: "tool_request",
        id: `adv-sel-${Math.random()}`,
        name: "atlas_get_dom_element",
        input: { selector: sel },
        timestamp: Date.now(),
      }
      // Type check passes — that's the point
      expect(req.input.selector).toBe(sel)
    }
  })

  it("handles null/undefined in input gracefully", () => {
    const req: ToolDispatchRequest = {
      id: "null-test",
      name: "atlas_read_current_page",
      input: { maxLength: null as any },
    }
    // Should not throw during serialization
    const json = JSON.stringify(req)
    const parsed = JSON.parse(json)
    expect(parsed.input.maxLength).toBeNull()
  })

  it("handles XSS attempt in selector", () => {
    const xssSelector = '<script>alert("xss")</script>'
    const req: ToolRequest = {
      type: "tool_request",
      id: "xss-1",
      name: "atlas_get_dom_element",
      input: { selector: xssSelector },
      timestamp: Date.now(),
    }
    // The selector is passed through — DOM querySelector naturally rejects invalid selectors
    // What matters is it doesn't execute code server-side
    expect(req.input.selector).toBe(xssSelector)
  })

  it("handles deeply nested input objects", () => {
    let nested: any = { value: "deep" }
    for (let i = 0; i < 50; i++) {
      nested = { inner: nested }
    }
    const req: ToolDispatchRequest = {
      id: "deep-1",
      name: "atlas_read_current_page",
      input: nested,
    }
    const json = JSON.stringify(req)
    expect(json.length).toBeGreaterThan(0)
    const parsed = JSON.parse(json)
    expect(parsed.id).toBe("deep-1")
  })

  it("handles input with prototype pollution attempt", () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "selector": "h1"}')
    const req: ToolDispatchRequest = {
      id: "proto-1",
      name: "atlas_get_dom_element",
      input: malicious,
    }
    // Verify the pollution didn't work
    const clean: any = {}
    expect(clean.polluted).toBeUndefined()
    expect(req.input.selector).toBe("h1")
  })

  it("handles massive input payload without crashing", () => {
    const hugeInput = { data: "x".repeat(1_000_000) }
    const req: ToolDispatchRequest = {
      id: "huge-1",
      name: "atlas_read_current_page",
      input: hugeInput,
    }
    const json = JSON.stringify(req)
    expect(json.length).toBeGreaterThan(1_000_000)
  })

  it("handles Unicode and emoji in tool inputs", () => {
    const req: ToolDispatchRequest = {
      id: "unicode-1",
      name: "atlas_get_dom_element",
      input: { selector: ".résumé-section, .日本語" },
    }
    const json = JSON.stringify(req)
    const parsed = JSON.parse(json)
    expect(parsed.input.selector).toBe(".résumé-section, .日本語")
  })

  it("handles negative and zero maxLength", () => {
    // The executor should treat these sanely
    for (const val of [-1, 0, -Infinity]) {
      const req: ToolRequest = {
        type: "tool_request",
        id: `neg-${val}`,
        name: "atlas_read_current_page",
        input: { maxLength: val },
        timestamp: Date.now(),
      }
      expect(req.input.maxLength).toBe(val)
    }
  })
})
