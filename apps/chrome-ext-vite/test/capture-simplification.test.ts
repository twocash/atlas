/**
 * Capture Simplification — Unit Tests (Gate 1.8)
 *
 * Tests the simplified capture flow:
 *   1. Context extraction: URL → domain, basic context assembly
 *   2. Domain classification: pattern matching → pillar assignment
 *   3. Capture routing: domain → pillar → cognitive router integration
 *   4. Menu simplification: 2 menu items, correct IDs
 */
import { describe, it, expect, mock } from "bun:test"

import {
  extractDomain,
  extractBasicContext,
} from "../src/lib/capture-context-extractor"

import {
  classifyDomain,
  routeCapture,
  routeQuickCapture,
} from "../src/lib/capture-router"

import {
  createCaptureMenus,
  MENU_IDS,
} from "../src/lib/capture-menus"

import type { CaptureContext } from "../src/types/capture"

// ─── 1. Context Extraction ──────────────────────────────────

describe("extractDomain", () => {
  it("extracts domain from standard URL", () => {
    expect(extractDomain("https://github.com/repo/issues")).toBe("github.com")
  })

  it("strips www prefix", () => {
    expect(extractDomain("https://www.linkedin.com/feed")).toBe("linkedin.com")
  })

  it("handles subdomains", () => {
    expect(extractDomain("https://news.ycombinator.com")).toBe("news.ycombinator.com")
  })

  it("handles URLs with ports", () => {
    expect(extractDomain("http://localhost:3000/page")).toBe("localhost")
  })

  it("handles malformed URLs gracefully", () => {
    const domain = extractDomain("not-a-url")
    expect(domain).toBeTruthy()
  })
})

describe("extractBasicContext", () => {
  it("extracts context from OnClickData + tab", () => {
    const info = {
      menuItemId: "atlas-capture",
      pageUrl: "https://github.com/anthropics/claude",
      selectionText: "selected text here",
    } as chrome.contextMenus.OnClickData

    const tab = {
      title: "anthropics/claude - GitHub",
      url: "https://github.com/anthropics/claude",
    } as chrome.tabs.Tab

    const context = extractBasicContext(info, tab)
    expect(context.url).toBe("https://github.com/anthropics/claude")
    expect(context.domain).toBe("github.com")
    expect(context.title).toBe("anthropics/claude - GitHub")
    expect(context.selectedText).toBe("selected text here")
  })

  it("prefers linkUrl over pageUrl", () => {
    const info = {
      menuItemId: "atlas-capture",
      pageUrl: "https://linkedin.com/feed",
      linkUrl: "https://arxiv.org/abs/2401.12345",
    } as chrome.contextMenus.OnClickData

    const context = extractBasicContext(info, undefined)
    expect(context.url).toBe("https://arxiv.org/abs/2401.12345")
    expect(context.domain).toBe("arxiv.org")
  })

  it("falls back to tab URL when no pageUrl", () => {
    const info = {
      menuItemId: "atlas-capture",
    } as chrome.contextMenus.OnClickData

    const tab = {
      url: "https://medium.com/article",
      title: "Some Article",
    } as chrome.tabs.Tab

    const context = extractBasicContext(info, tab)
    expect(context.url).toBe("https://medium.com/article")
  })

  it("handles missing selection text", () => {
    const info = {
      menuItemId: "atlas-capture",
      pageUrl: "https://github.com",
    } as chrome.contextMenus.OnClickData

    const context = extractBasicContext(info, undefined)
    expect(context.selectedText).toBeUndefined()
  })
})

// ─── 2. Domain Classification ───────────────────────────────

describe("classifyDomain", () => {
  it("classifies GitHub as grove", () => {
    const result = classifyDomain("github.com")
    expect(result.pillar).toBe("the-grove")
    expect(result.tier).toBe("grove")
    expect(result.matched).toBe(true)
    expect(result.ambiguous).toBe(false)
  })

  it("classifies arxiv as grove", () => {
    const result = classifyDomain("arxiv.org")
    expect(result.pillar).toBe("the-grove")
    expect(result.tier).toBe("grove")
    expect(result.matched).toBe(true)
  })

  it("classifies LinkedIn as consulting", () => {
    const result = classifyDomain("linkedin.com")
    expect(result.pillar).toBe("consulting")
    expect(result.tier).toBe("consulting")
    expect(result.matched).toBe(true)
  })

  it("classifies Amazon as personal", () => {
    const result = classifyDomain("amazon.com")
    expect(result.pillar).toBe("personal")
    expect(result.tier).toBe("general")
    expect(result.matched).toBe(true)
  })

  it("classifies Home Depot as home-garage", () => {
    const result = classifyDomain("homedepot.com")
    expect(result.pillar).toBe("home-garage")
    expect(result.tier).toBe("general")
    expect(result.matched).toBe(true)
  })

  it("marks medium.com as ambiguous", () => {
    const result = classifyDomain("medium.com")
    expect(result.ambiguous).toBe(true)
    expect(result.matched).toBe(false)
  })

  it("marks youtube.com as ambiguous", () => {
    const result = classifyDomain("youtube.com")
    expect(result.ambiguous).toBe(true)
  })

  it("marks substack.com as ambiguous", () => {
    const result = classifyDomain("substack.com")
    expect(result.ambiguous).toBe(true)
  })

  it("defaults unknown domains to personal", () => {
    const result = classifyDomain("random-site.io")
    expect(result.pillar).toBe("personal")
    expect(result.matched).toBe(false)
    expect(result.ambiguous).toBe(false)
  })

  it("handles subdomain matching", () => {
    const result = classifyDomain("news.ycombinator.com")
    expect(result.pillar).toBe("the-grove")
    expect(result.matched).toBe(true)
  })
})

// ─── 3. Capture Routing ─────────────────────────────────────

function makeContext(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    url: "https://github.com/anthropics/claude",
    domain: "github.com",
    title: "anthropics/claude - GitHub",
    ...overrides,
  }
}

describe("routeCapture", () => {
  it("auto-dispatches grove-aligned domains", () => {
    const result = routeCapture(makeContext({ domain: "github.com" }))
    expect(result.pillar).toBe("the-grove")
    expect(result.classifiedBy).toBe("pattern_match")
    expect(result.socraticQuestion).toBeUndefined()
    expect(result.routingDecision).toBeDefined()
  })

  it("auto-dispatches consulting-aligned domains", () => {
    const result = routeCapture(makeContext({ domain: "linkedin.com" }))
    expect(result.pillar).toBe("consulting")
    expect(result.classifiedBy).toBe("pattern_match")
  })

  it("auto-dispatches personal domains", () => {
    const result = routeCapture(makeContext({ domain: "amazon.com" }))
    expect(result.pillar).toBe("personal")
    expect(result.classifiedBy).toBe("pattern_match")
  })

  it("auto-dispatches home-garage domains", () => {
    const result = routeCapture(makeContext({ domain: "homedepot.com" }))
    expect(result.pillar).toBe("home-garage")
    expect(result.classifiedBy).toBe("pattern_match")
  })

  it("returns Socratic question for ambiguous domains", () => {
    const result = routeCapture(makeContext({ domain: "medium.com" }))
    expect(result.classifiedBy).toBe("socratic")
    expect(result.socraticQuestion).toBeTruthy()
    expect(result.socraticQuestion).toContain("medium.com")
  })

  it("returns Socratic question for unknown domains", () => {
    const result = routeCapture(makeContext({ domain: "obscure-site.xyz" }))
    expect(result.classifiedBy).toBe("socratic")
    expect(result.socraticQuestion).toContain("obscure-site.xyz")
  })

  it("includes cognitive routing decision", () => {
    const result = routeCapture(makeContext({ domain: "github.com" }))
    expect(result.routingDecision.backend).toBeDefined()
    expect(result.routingDecision.taskTier).toBeDefined()
    expect(result.routingDecision.resolvedTier).toBe("grove")
  })

  it("consulting domains get consulting tier in routing", () => {
    const result = routeCapture(makeContext({ domain: "linkedin.com" }))
    expect(result.routingDecision.resolvedTier).toBe("consulting")
  })
})

describe("routeQuickCapture", () => {
  it("returns personal pillar with fallback classification", () => {
    const result = routeQuickCapture()
    expect(result.pillar).toBe("personal")
    expect(result.classifiedBy).toBe("fallback")
    expect(result.socraticQuestion).toBeUndefined()
  })

  it("includes routing decision", () => {
    const result = routeQuickCapture()
    expect(result.routingDecision).toBeDefined()
    expect(result.routingDecision.resolvedTier).toBe("general")
  })
})

// ─── 4. Menu Simplification ────────────────────────────────

describe("capture menus", () => {
  it("exports correct menu IDs", () => {
    expect(MENU_IDS.ROOT).toBe("atlas-root")
    expect(MENU_IDS.CAPTURE).toBe("atlas-capture")
    expect(MENU_IDS.QUICK).toBe("atlas-quick")
    expect(MENU_IDS.SEPARATOR).toBe("atlas-separator")
  })

  it("createCaptureMenus creates exactly 4 items (root, capture, separator, quick)", () => {
    const createCalls: Array<{ id: string; title?: string }> = []
    const removeAllCalled = { value: false }

    // Mock chrome.contextMenus
    globalThis.chrome = {
      contextMenus: {
        removeAll: (cb: () => void) => {
          removeAllCalled.value = true
          cb()
        },
        create: (props: any) => {
          createCalls.push(props)
        },
      },
    } as any

    createCaptureMenus()

    expect(removeAllCalled.value).toBe(true)
    expect(createCalls.length).toBe(4)
    expect(createCalls[0].id).toBe("atlas-root")
    expect(createCalls[1].id).toBe("atlas-capture")
    expect(createCalls[2].id).toBe("atlas-separator")
    expect(createCalls[3].id).toBe("atlas-quick")
  })
})
