/**
 * Tool Executor — handles tool_request messages from the bridge.
 *
 * Each tool executes a read-only browser operation:
 *   - DOM tools use chrome.scripting.executeScript on the active tab
 *   - State tools read from extension-local state
 *   - LinkedIn tools extract structured data from LinkedIn pages
 *
 * Returns a ToolResponse that the hook sends back via WebSocket.
 */

// ─── Types (mirrored from bridge — no shared package in extension) ──

export interface ToolRequest {
  type: "tool_request"
  id: string
  name: string
  input: Record<string, unknown>
  timestamp: number
}

export interface ToolResponse {
  type: "tool_response"
  id: string
  result?: unknown
  error?: string
}

// ─── Constants ──────────────────────────────────────────────

const CONTENT_MAX_CHARS = 50_000

// ─── Main Dispatcher ────────────────────────────────────────

export async function executeToolRequest(
  request: ToolRequest,
  extensionState?: { bridgeStatus: string; claudeStatus: string },
): Promise<ToolResponse> {
  try {
    const result = await dispatch(request.name, request.input, extensionState)
    return { type: "tool_response", id: request.id, result }
  } catch (err: any) {
    return { type: "tool_response", id: request.id, error: err.message || String(err) }
  }
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  extensionState?: { bridgeStatus: string; claudeStatus: string },
): Promise<unknown> {
  switch (name) {
    case "atlas_read_current_page":
      return readCurrentPage(input)
    case "atlas_get_dom_element":
      return getDomElement(input)
    case "atlas_get_console_errors":
      return getConsoleErrors(input)
    case "atlas_get_extension_state":
      return getExtensionState(extensionState)
    case "atlas_query_selectors":
      return querySelectors(input)
    case "atlas_get_linkedin_context":
      return getLinkedInContext(input)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error("No active tab found")
  return tab
}

async function executeInTab<T>(tabId: number, func: (...args: any[]) => T, args?: unknown[]): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: args ?? [],
  })

  if (!results || results.length === 0) {
    throw new Error("Script execution returned no results")
  }

  const frame = results[0] as { result: T; error?: { message: string } }
  if (frame.error) {
    throw new Error(frame.error.message || "Script execution error")
  }

  return frame.result
}

// ─── Tool Implementations ───────────────────────────────────

async function readCurrentPage(input: Record<string, unknown>) {
  const maxLength = (input.maxLength as number) || CONTENT_MAX_CHARS
  const tab = await getActiveTab()

  const data = await executeInTab(tab.id!, (max: number) => {
    const text = document.body.innerText || ""
    return {
      title: document.title,
      content: text.slice(0, max),
      contentLength: text.length,
      truncated: text.length > max,
    }
  }, [maxLength])

  return {
    url: tab.url || "",
    ...data,
  }
}

async function getDomElement(input: Record<string, unknown>) {
  const selector = input.selector as string
  if (!selector) throw new Error("Missing required parameter: selector")

  const tab = await getActiveTab()

  return executeInTab(tab.id!, (sel: string) => {
    const el = document.querySelector(sel)
    if (!el) {
      return { found: false, selector: sel }
    }

    const rect = el.getBoundingClientRect()
    const attrs: Record<string, string> = {}
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value
    }

    return {
      found: true,
      selector: sel,
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent || "").slice(0, 1000),
      attributes: attrs,
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      childCount: el.children.length,
    }
  }, [selector])
}

async function getConsoleErrors(_input: Record<string, unknown>) {
  // Console errors can't be captured retroactively without DevTools protocol.
  // For MVP, we return a notice. A future version could inject a listener on page load.
  return {
    errors: [],
    count: 0,
    note: "Console error capture requires a pre-injected listener. " +
      "Use atlas_get_dom_element or atlas_query_selectors to inspect the page directly.",
  }
}

async function getExtensionState(
  extensionState?: { bridgeStatus: string; claudeStatus: string },
) {
  const tab = await getActiveTab().catch(() => null)

  return {
    currentView: "sidepanel",
    bridgeStatus: extensionState?.bridgeStatus || "unknown",
    claudeStatus: extensionState?.claudeStatus || "unknown",
    tabUrl: tab?.url,
    tabTitle: tab?.title,
  }
}

async function querySelectors(input: Record<string, unknown>) {
  const selectors = input.selectors as string[]
  if (!selectors || !Array.isArray(selectors)) {
    throw new Error("Missing required parameter: selectors (array of CSS selectors)")
  }

  const tab = await getActiveTab()

  return executeInTab(tab.id!, (sels: string[]) => {
    return {
      results: sels.map((sel) => {
        try {
          const matches = document.querySelectorAll(sel)
          const first = matches[0]
          return {
            selector: sel,
            found: matches.length > 0,
            count: matches.length,
            firstText: first ? (first.textContent || "").slice(0, 200) : undefined,
          }
        } catch (e: any) {
          return {
            selector: sel,
            found: false,
            count: 0,
            error: e.message,
          }
        }
      }),
    }
  }, [selectors])
}

async function getLinkedInContext(input: Record<string, unknown>) {
  const tab = await getActiveTab()
  const url = tab.url || ""

  if (!url.includes("linkedin.com")) {
    throw new Error("Current tab is not a LinkedIn page")
  }

  const includeComments = (input.includeComments as boolean) || false

  return executeInTab(tab.id!, (withComments: boolean) => {
    const url = window.location.href
    const path = window.location.pathname

    // Detect page type
    let pageType: string = "unknown"
    if (path.startsWith("/in/")) pageType = "profile"
    else if (path === "/feed/" || path === "/feed") pageType = "feed"
    else if (path.includes("/posts/") || path.includes("/pulse/")) pageType = "post"
    else if (path.startsWith("/company/")) pageType = "company"
    else if (path.startsWith("/search/")) pageType = "search"

    const data: Record<string, unknown> = { pageType, url }

    // Profile data
    if (pageType === "profile") {
      const nameEl = document.querySelector("h1.text-heading-xlarge")
      const headlineEl = document.querySelector(".text-body-medium.break-words")
      const locationEl = document.querySelector(".text-body-small.inline.t-black--light.break-words")

      data.name = nameEl?.textContent?.trim() || null
      data.headline = headlineEl?.textContent?.trim() || null
      data.location = locationEl?.textContent?.trim() || null
    }

    // Post data
    if (pageType === "post" || pageType === "feed") {
      const posts = document.querySelectorAll(".feed-shared-update-v2")
      const postData: unknown[] = []

      const limit = pageType === "post" ? 1 : 5
      for (let i = 0; i < Math.min(posts.length, limit); i++) {
        const post = posts[i]
        const authorEl = post.querySelector(".update-components-actor__name")
        const textEl = post.querySelector(".feed-shared-update-v2__description, .update-components-text")
        const socialEl = post.querySelector(".social-details-social-counts")

        const entry: Record<string, unknown> = {
          author: authorEl?.textContent?.trim() || null,
          text: (textEl?.textContent?.trim() || "").slice(0, 500),
          socialCounts: socialEl?.textContent?.trim() || null,
        }

        if (withComments) {
          const commentEls = post.querySelectorAll(".comments-comment-entity")
          const comments: unknown[] = []
          for (let j = 0; j < Math.min(commentEls.length, 10); j++) {
            const c = commentEls[j]
            const cAuthor = c.querySelector(".comments-comment-meta__description-title")
            const cText = c.querySelector(".comments-comment-item__main-content, .update-components-text")
            comments.push({
              author: cAuthor?.textContent?.trim() || null,
              text: (cText?.textContent?.trim() || "").slice(0, 300),
            })
          }
          entry.comments = comments
        }

        postData.push(entry)
      }
      data.posts = postData
    }

    return data
  }, [includeComments])
}
