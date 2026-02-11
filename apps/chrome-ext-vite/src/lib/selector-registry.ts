/**
 * SelectorRegistry — Multi-layer DOM selector strategy system.
 *
 * Each element type (comment container, commenter name, etc.) has
 * ordered extraction layers: Semantic → Structural → Heuristic.
 *
 * The registry is a single versioned configuration object — all
 * LinkedIn selectors live here, not scattered across content scripts.
 *
 * folkX-informed: CSS + XPath parallel strategies, ARIA-first targeting,
 * normalize-space class matching for resilience against whitespace changes.
 */

import type {
  SelectorEntry,
  SelectorLayer,
  SelectorMatch,
  SelectorRegistry,
  HealthCheckResult,
} from "~src/types/selectors"

// ─── Registry Version ─────────────────────────────────────

export const REGISTRY_VERSION = "1.0.0"

// ─── The Registry ─────────────────────────────────────────

export const SELECTOR_REGISTRY: SelectorRegistry = {
  // ── Canary (health check) ────────────────────────────────
  "page-canary": {
    name: "page-canary",
    layers: [
      {
        type: "css",
        selector: ".scaffold-layout",
        description: "LinkedIn main scaffold container (stable across pages)",
      },
      {
        type: "css",
        selector: ".scaffold-layout__main",
        description: "LinkedIn main content area",
      },
      {
        type: "css",
        selector: ".feed-shared-update-v2",
        description: "Feed post container (present on post detail pages)",
      },
      {
        type: "css",
        selector: "#main",
        description: "Main content landmark",
      },
      {
        type: "xpath",
        selector: "//main | //div[@role='main']",
        description: "ARIA main landmark",
      },
    ],
    canary: true,
  },

  // NOTE: Not a canary — comments section may be collapsed until user clicks.
  // Used as a lookup entry, not a health gate.
  "comments-section": {
    name: "comments-section",
    layers: [
      {
        type: "css",
        selector: ".comments-comments-list",
        description: "LinkedIn comments list container",
      },
      {
        type: "css",
        selector: "[data-finite-scroll-hotkey-context='COMMENTS']",
        description: "Comments scroll context attribute",
      },
      {
        type: "xpath",
        selector: "//section[contains(@class,'comments')]",
        description: "Section element containing 'comments' class",
      },
    ],
    canary: false,
  },

  // ── Comment Container ────────────────────────────────────
  "comment-container": {
    name: "comment-container",
    layers: [
      {
        type: "css",
        selector: "article.comments-comment-entity",
        description: "Article element with comment entity class",
      },
      {
        type: "css",
        selector: ".comments-comment-item",
        description: "Comment item class (older DOM versions)",
      },
      {
        type: "xpath",
        selector: "//article[contains(@class,'comments-comment')] | //div[contains(@class,'comments-comment-item')]",
        description: "Comment article or div with comment class patterns",
      },
      {
        type: "heuristic",
        selector: "//div[.//a[contains(@href,'/in/')] and .//span[contains(@class,'time')]]",
        description: "Container with profile link + timestamp child elements",
      },
    ],
    canary: false,
  },

  // ── Commenter Name ───────────────────────────────────────
  "commenter-name": {
    name: "commenter-name",
    layers: [
      {
        type: "css",
        selector: ".comments-comment-meta__description-title",
        description: "Name title span within comment-meta description (2025+ DOM)",
      },
      {
        type: "css",
        selector: ".comments-post-meta__name-text a span[aria-hidden='true']",
        description: "Name text span within post-meta (legacy DOM)",
      },
      {
        type: "css",
        selector: "a.comments-comment-meta__description-container",
        description: "Description container anchor (fallback to link text)",
      },
      {
        type: "heuristic",
        selector: ".//a[contains(@href,'/in/')][1]",
        description: "First anchor tag linking to a LinkedIn profile",
      },
    ],
    canary: false,
  },

  // ── Commenter Headline ───────────────────────────────────
  "commenter-headline": {
    name: "commenter-headline",
    layers: [
      {
        type: "css",
        selector: ".comments-comment-meta__description-subtitle",
        description: "Subtitle div within comment-meta description (2025+ DOM)",
      },
      {
        type: "css",
        selector: ".comments-post-meta__headline",
        description: "Headline element within post-meta (legacy DOM)",
      },
      {
        type: "xpath",
        selector: ".//div[contains(@class,'description-subtitle')] | .//span[contains(@class,'headline')]",
        description: "Description subtitle or headline class",
      },
    ],
    canary: false,
  },

  // ── Commenter Profile URL ────────────────────────────────
  "commenter-profile-url": {
    name: "commenter-profile-url",
    layers: [
      {
        type: "css",
        selector: "a.comments-comment-meta__description-container[href*='/in/']",
        description: "Description container anchor with profile href (2025+ DOM)",
      },
      {
        type: "css",
        selector: ".comments-post-meta__name-text a[href*='/in/']",
        description: "Profile anchor within post-meta name (legacy DOM)",
      },
      {
        type: "xpath",
        selector: ".//a[contains(@href,'/in/')][1]",
        description: "First anchor with /in/ profile path",
      },
    ],
    canary: false,
  },

  // ── Comment Text ─────────────────────────────────────────
  "comment-text": {
    name: "comment-text",
    layers: [
      {
        type: "css",
        selector: ".comments-comment-entity__content .feed-shared-inline-show-more-text",
        description: "Inline show-more text within comment entity content (2025+ DOM)",
      },
      {
        type: "css",
        selector: ".comments-comment-entity__content span.break-words",
        description: "Break-words span within comment entity content",
      },
      {
        type: "css",
        selector: ".comments-comment-item__main-content .update-components-text",
        description: "Update components text within comment main content (legacy DOM)",
      },
      {
        type: "xpath",
        selector: ".//section[contains(@class,'comment-entity__content')]//span[contains(@class,'break-words')] | .//section[contains(@class,'comment-entity__content')]//span[@dir='ltr']",
        description: "Text span within comment entity content section",
      },
      {
        type: "heuristic",
        selector: ".//section[contains(@class,'content')]//span[string-length(normalize-space()) > 10]",
        description: "Longest text span within content section (>10 chars)",
      },
    ],
    canary: false,
  },

  // ── Comment Timestamp ────────────────────────────────────
  "comment-timestamp": {
    name: "comment-timestamp",
    layers: [
      {
        type: "css",
        selector: "time.comments-comment-meta__data",
        description: "Time element with comment-meta data class (2025+ DOM)",
      },
      {
        type: "css",
        selector: "time.comments-comment-item__timestamp",
        description: "Time element with timestamp class (legacy DOM)",
      },
      {
        type: "xpath",
        selector: ".//time | .//span[contains(@class,'timestamp')]",
        description: "Time element or span with timestamp class",
      },
      {
        type: "heuristic",
        selector: ".//span[contains(text(),'ago') or contains(text(),'hr') or contains(text(),'min') or contains(text(),'day') or contains(text(),'wk') or contains(text(),'mo')]",
        description: "Span containing relative time patterns (ago, hr, min, etc.)",
      },
    ],
    canary: false,
  },

  // ── Reply Indicator (thread nesting) ─────────────────────
  "reply-indicator": {
    name: "reply-indicator",
    layers: [
      {
        type: "css",
        selector: ".comments-comment-entity--reply",
        description: "Comment entity with reply modifier class",
      },
      {
        type: "css",
        selector: ".comments-reply-item",
        description: "Reply item class (nested comment, legacy DOM)",
      },
      {
        type: "xpath",
        selector: ".//article[contains(@class,'reply')] | ./parent::*[contains(@class,'replies')]",
        description: "Article with reply class or parent with replies class",
      },
    ],
    canary: false,
  },
}

// ─── Query Functions ──────────────────────────────────────

/**
 * Evaluate an XPath expression relative to a context node.
 * Returns an ordered array of matching elements.
 */
function evaluateXPath(expression: string, context: Node): Element[] {
  const results: Element[] = []
  try {
    const xpathResult = document.evaluate(
      expression,
      context,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    )
    for (let i = 0; i < xpathResult.snapshotLength; i++) {
      const node = xpathResult.snapshotItem(i)
      if (node instanceof Element) {
        results.push(node)
      }
    }
  } catch {
    // Invalid XPath — return empty
  }
  return results
}

/**
 * Resolve a selector entry against a context element.
 * Tries each layer in order; returns the first successful match.
 */
export function resolveSelector(
  entry: SelectorEntry,
  context: Element | Document = document,
): SelectorMatch | null {
  for (const layer of entry.layers) {
    let elements: Element[] = []

    if (layer.type === "css") {
      elements = Array.from(context.querySelectorAll(layer.selector))
    } else if (layer.type === "xpath" || layer.type === "heuristic") {
      elements = evaluateXPath(layer.selector, context)
    }

    if (elements.length > 0) {
      return { layer, elements }
    }
  }

  return null
}

/**
 * Resolve a selector entry and return just the first matched element.
 */
export function resolveSelectorFirst(
  entry: SelectorEntry,
  context: Element | Document = document,
): Element | null {
  const match = resolveSelector(entry, context)
  return match?.elements[0] ?? null
}

/**
 * Extract text content from the first element matching a selector entry.
 */
export function resolveSelectorText(
  entry: SelectorEntry,
  context: Element | Document = document,
): string | null {
  const el = resolveSelectorFirst(entry, context)
  return el?.textContent?.trim() ?? null
}

/**
 * Extract an href from the first anchor matching a selector entry.
 */
export function resolveSelectorHref(
  entry: SelectorEntry,
  context: Element | Document = document,
): string | null {
  const el = resolveSelectorFirst(entry, context)
  if (el instanceof HTMLAnchorElement) {
    return el.href
  }
  // Fallback: check if the element has an href attribute
  return el?.getAttribute("href") ?? null
}

// ─── Health Checks ────────────────────────────────────────

/**
 * Run all canary selectors to verify the page loaded correctly.
 * Returns results for each canary.
 */
export function runHealthChecks(
  context: Element | Document = document,
): HealthCheckResult[] {
  const now = new Date().toISOString()
  const results: HealthCheckResult[] = []

  for (const entry of Object.values(SELECTOR_REGISTRY)) {
    if (!entry.canary) continue

    const match = resolveSelector(entry, context)
    results.push({
      entry,
      passed: match !== null,
      matchedLayer: match?.layer,
      checkedAt: now,
    })

    // Update lastVerified if passed
    if (match) {
      entry.lastVerified = now
    }
  }

  return results
}

/**
 * Quick boolean: did all canaries pass?
 */
export function allCanariesPass(
  context: Element | Document = document,
): boolean {
  return runHealthChecks(context).every((r) => r.passed)
}

/**
 * Get a registry entry by name. Throws if not found.
 */
export function getEntry(name: string): SelectorEntry {
  const entry = SELECTOR_REGISTRY[name]
  if (!entry) {
    throw new Error(`SelectorRegistry: unknown entry "${name}"`)
  }
  return entry
}
