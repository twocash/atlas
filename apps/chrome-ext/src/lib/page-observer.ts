/**
 * PageObserver — Detects LinkedIn SPA navigation and page state changes.
 *
 * SAFETY-FIRST design:
 *   - NO MutationObserver (avoids triggering LinkedIn anti-bot detection)
 *   - NO aggressive polling (was 50ms, now removed)
 *   - URL change detection via standard browser events (popstate, click intercept)
 *   - Slow poll fallback (2s) only for SPA pushState that doesn't fire popstate
 *   - DOM queries happen ONLY on explicit user action (Extract Comments button)
 *
 * Emits typed events: post-detected, comments-visible, page-changed
 */

// ─── Types ────────────────────────────────────────────────

export type PageObserverEvent =
  | "post-detected"
  | "comments-visible"
  | "page-changed"

export type PageObserverCallback = (event: PageObserverEvent, url: string) => void

interface PageObserverOptions {
  /** Slow-poll interval in ms for catching pushState navigation (default: 2000) */
  pollInterval?: number
  /** Timeout for waitFor() one-shot queries (default: 5000) */
  pollTimeout?: number
  /** Whether to observe comments section appearance (default: false) */
  watchComments?: boolean
}

// ─── URL Pattern Detection ────────────────────────────────

const POST_URL_PATTERNS = [
  /linkedin\.com\/feed\/update\/urn:li:activity:(\d+)/,
  /linkedin\.com\/posts\/[\w-]+-activity-(\d+)/,
  /linkedin\.com\/feed\/update\/urn:li:ugcPost:(\d+)/,
  /linkedin\.com\/pulse\//,
]

const FEED_URL_PATTERN = /linkedin\.com\/feed\/?(\?|$)/

/**
 * Check if a URL is a LinkedIn post detail page.
 */
export function isPostPage(url: string): boolean {
  return POST_URL_PATTERNS.some((p) => p.test(url))
}

/**
 * Check if a URL is the LinkedIn feed.
 */
export function isFeedPage(url: string): boolean {
  return FEED_URL_PATTERN.test(url)
}

/**
 * Extract the activity ID from a post URL, if possible.
 */
export function extractActivityId(url: string): string | null {
  for (const pattern of POST_URL_PATTERNS) {
    const match = url.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

// ─── Comment Section Detection ────────────────────────────

const COMMENTS_SELECTORS = [
  ".comments-comments-list",
  "[data-finite-scroll-hotkey-context='COMMENTS']",
  "section.comments-comment-list",
]

/**
 * Check if comments section is visible on the page.
 * Only call this on-demand (user action), never in a loop.
 */
export function commentsVisible(): boolean {
  return COMMENTS_SELECTORS.some(
    (sel) => document.querySelector(sel) !== null,
  )
}

// ─── PageObserver Class ───────────────────────────────────

export class PageObserver {
  private callback: PageObserverCallback
  private options: Required<PageObserverOptions>
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private popstateHandler: (() => void) | null = null
  private lastUrl: string = ""
  private running: boolean = false

  constructor(callback: PageObserverCallback, options: PageObserverOptions = {}) {
    this.callback = callback
    this.options = {
      pollInterval: options.pollInterval ?? 2000,
      pollTimeout: options.pollTimeout ?? 5000,
      watchComments: options.watchComments ?? false,
    }
  }

  /**
   * Start observing. Uses lightweight browser events + slow poll.
   *
   * NO MutationObserver — avoids triggering LinkedIn anti-bot detection.
   * Only detects URL changes via popstate + slow poll (for pushState).
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.lastUrl = window.location.href

    // Check current page state once
    this.checkUrlChange()

    // popstate fires on back/forward navigation
    this.popstateHandler = () => this.checkUrlChange()
    window.addEventListener("popstate", this.popstateHandler)

    // Slow poll (2s) catches pushState SPA navigation that doesn't fire popstate
    this.pollTimer = setInterval(() => {
      this.checkUrlChange()
    }, this.options.pollInterval)
  }

  /**
   * Stop observing. Cleans up event listeners and polling.
   */
  stop(): void {
    this.running = false

    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler)
      this.popstateHandler = null
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * Lightweight URL change check — no DOM queries, just string comparison.
   */
  private checkUrlChange(): void {
    const currentUrl = window.location.href

    if (currentUrl !== this.lastUrl) {
      this.lastUrl = currentUrl
      this.callback("page-changed", currentUrl)

      if (isPostPage(currentUrl)) {
        this.callback("post-detected", currentUrl)
      }
    }
  }

  /**
   * One-shot: wait for an element matching a selector to appear.
   * Uses 500ms polling with configurable timeout. Only for explicit user actions.
   */
  waitFor(selector: string, timeout?: number): Promise<Element | null> {
    const pollMs = 500 // Slow poll to avoid detection
    const timeoutMs = timeout ?? this.options.pollTimeout

    return new Promise((resolve) => {
      const start = Date.now()

      // Immediate check
      const immediate = document.querySelector(selector)
      if (immediate) {
        resolve(immediate)
        return
      }

      const timer = setInterval(() => {
        const el = document.querySelector(selector)
        if (el) {
          clearInterval(timer)
          resolve(el)
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer)
          resolve(null)
        }
      }, pollMs)
    })
  }

  get isRunning(): boolean {
    return this.running
  }

  get currentUrl(): string {
    return this.lastUrl
  }
}
