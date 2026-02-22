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
    case "atlas_refresh_cookies":
      return refreshCookies(input)
    case "atlas_browser_open_and_read":
      return browserOpenAndRead(input)
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

// ─── Cookie Refresh ─────────────────────────────────────

const DEFAULT_COOKIE_DOMAINS = [
  ".threads.com",
  ".instagram.com",
  ".linkedin.com",
]

async function refreshCookies(input: Record<string, unknown>) {
  const domains = (input.domains as string[]) || DEFAULT_COOKIE_DOMAINS

  const results: Record<
    string,
    Array<{ name: string; value: string; domain: string; path: string; expirationDate?: number }>
  > = {}

  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain })
    results[domain] = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expirationDate: c.expirationDate,
    }))
  }

  return {
    domains: Object.keys(results),
    counts: Object.fromEntries(
      Object.entries(results).map(([d, c]) => [d, c.length]),
    ),
    cookies: results,
  }
}

// ─── Browser Open & Read ────────────────────────────────

/** Platform-specific hydration selectors — tells us the SPA has finished rendering. */
const HYDRATION_SELECTORS: Record<string, string> = {
  "threads.net": "div[role='main'], [data-pressable-container]",
  "twitter.com": "[data-testid='tweetText'], [data-testid='UserName']",
  "x.com": "[data-testid='tweetText'], [data-testid='UserName']",
  "linkedin.com": ".feed-shared-update-v2, .artdeco-card, .scaffold-layout__main",
  "instagram.com": "article, main",
  "youtube.com": "#content, ytd-watch-flexy",
}

const DEFAULT_HYDRATION_SELECTOR = "body"
const HYDRATION_POLL_INTERVAL = 500
const DEFAULT_HYDRATION_TIMEOUT = 10_000
const TAB_LOAD_TIMEOUT_MS = 15_000

/** Detect platform from URL hostname and return the hydration selector. */
function getHydrationSelector(url: string): { platform: string; selector: string } {
  try {
    const hostname = new URL(url).hostname
    // Match against known platforms (strip leading "www.")
    const bare = hostname.replace(/^www\./, "")
    for (const [domain, selector] of Object.entries(HYDRATION_SELECTORS)) {
      if (bare === domain || bare.endsWith(`.${domain}`)) {
        return { platform: domain, selector }
      }
    }
    return { platform: "generic", selector: DEFAULT_HYDRATION_SELECTOR }
  } catch {
    return { platform: "unknown", selector: DEFAULT_HYDRATION_SELECTOR }
  }
}

/** Wait for a tab to reach "complete" load status. */
function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tid === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve() // Proceed even on timeout — extraction may still work
    }, TAB_LOAD_TIMEOUT_MS)
  })
}

/** Poll for a CSS selector match in the tab (SPA hydration gate). */
async function waitForHydration(
  tabId: number,
  selector: string,
  timeout: number,
): Promise<{ found: boolean; waitMs: number }> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const found = await executeInTab(tabId, (sel: string) => {
        return document.querySelector(sel) !== null
      }, [selector])

      if (found) return { found: true, waitMs: Date.now() - start }
    } catch {
      // Script execution may fail while page is loading — retry
    }
    await new Promise<void>((r) => setTimeout(r, HYDRATION_POLL_INTERVAL))
  }

  return { found: false, waitMs: Date.now() - start }
}

async function browserOpenAndRead(input: Record<string, unknown>) {
  const url = input.url as string
  if (!url) throw new Error("Missing required parameter: url")

  const closeAfter = input.closeAfter !== false // default true
  const extractionMode = (input.extractionMode as string) || "full"
  const waitTimeout = (input.waitTimeout as number) || DEFAULT_HYDRATION_TIMEOUT

  // Determine hydration selector: explicit > platform default > generic
  const detected = getHydrationSelector(url)
  const waitFor = (input.waitFor as string) || detected.selector
  const platform = detected.platform

  let tabId: number | null = null

  try {
    // 1. Create background tab (doesn't steal focus)
    const tab = await chrome.tabs.create({ url, active: false })
    tabId = tab.id!

    // 2. Wait for basic page load
    await waitForTabLoad(tabId)

    // 3. Wait for SPA hydration
    const hydration = await waitForHydration(tabId, waitFor, waitTimeout)

    // 4. Extract content
    const maxLength = CONTENT_MAX_CHARS
    const data = await executeInTab(tabId, (mode: string, maxLen: number) => {
      let content = ""
      let source = "body"

      if (mode === "main") {
        const mainSelectors = [
          "article",
          "main",
          "[role='main']",
          "#content",
          ".post-content",
          ".article-body",
        ]
        for (const sel of mainSelectors) {
          const el = document.querySelector(sel)
          if (el && (el as HTMLElement).innerText?.trim().length > 100) {
            content = (el as HTMLElement).innerText
            source = sel
            break
          }
        }
      }

      if (!content) {
        content = document.body?.innerText || ""
        source = "body"
      }

      return {
        title: document.title,
        content: content.slice(0, maxLen),
        contentLength: content.length,
        truncated: content.length > maxLen,
        extractionSource: source,
      }
    }, [extractionMode, maxLength])

    // 5. Close tab if requested
    let tabClosed = false
    if (closeAfter && tabId) {
      try {
        await chrome.tabs.remove(tabId)
        tabClosed = true
      } catch {
        // Tab may already be closed by user
      }
    }

    return {
      url,
      ...data,
      platform,
      hydrationSelector: waitFor,
      hydrationFound: hydration.found,
      hydrationWaitMs: hydration.waitMs,
      extractionMode,
      tabClosed,
    }
  } catch (err: any) {
    // Cleanup: close tab on error
    if (closeAfter && tabId) {
      try { await chrome.tabs.remove(tabId) } catch { /* ignore */ }
    }
    throw err
  }
}

// ─── LinkedIn Context ───────────────────────────────────

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
