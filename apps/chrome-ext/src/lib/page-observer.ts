/**
 * PageObserver — Detects LinkedIn SPA navigation and page state changes.
 *
 * Uses a dual detection strategy (validated by folkX reverse-engineering):
 *   1. MutationObserver on document.body for real-time SPA detection
 *   2. Interval polling (50ms, 1s timeout) as fallback
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
  /** Polling interval in ms (default: 50) */
  pollInterval?: number
  /** Polling timeout in ms (default: 1000) */
  pollTimeout?: number
  /** Whether to observe comments section appearance (default: true) */
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

function commentsVisible(): boolean {
  return COMMENTS_SELECTORS.some(
    (sel) => document.querySelector(sel) !== null,
  )
}

// ─── PageObserver Class ───────────────────────────────────

export class PageObserver {
  private callback: PageObserverCallback
  private options: Required<PageObserverOptions>
  private observer: MutationObserver | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastUrl: string = ""
  private lastCommentsVisible: boolean = false
  private running: boolean = false

  constructor(callback: PageObserverCallback, options: PageObserverOptions = {}) {
    this.callback = callback
    this.options = {
      pollInterval: options.pollInterval ?? 50,
      pollTimeout: options.pollTimeout ?? 1000,
      watchComments: options.watchComments ?? true,
    }
  }

  /**
   * Start observing. Sets up MutationObserver + polling fallback.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.lastUrl = window.location.href

    // Check current page state immediately
    this.checkPageState()

    // MutationObserver for SPA navigation detection
    this.observer = new MutationObserver((_mutations) => {
      this.checkPageState()
    })
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Polling fallback (folkX pattern: 50ms interval)
    this.pollTimer = setInterval(() => {
      this.checkPageState()
    }, this.options.pollInterval)
  }

  /**
   * Stop observing. Cleans up observer and polling.
   */
  stop(): void {
    this.running = false

    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * Check page state and emit events if conditions changed.
   */
  private checkPageState(): void {
    const currentUrl = window.location.href

    // URL changed → page navigation
    if (currentUrl !== this.lastUrl) {
      this.lastUrl = currentUrl
      this.lastCommentsVisible = false
      this.callback("page-changed", currentUrl)

      // Check if new page is a post
      if (isPostPage(currentUrl)) {
        this.callback("post-detected", currentUrl)
      }
    }

    // Comments section appeared
    if (this.options.watchComments) {
      const nowVisible = commentsVisible()
      if (nowVisible && !this.lastCommentsVisible) {
        this.lastCommentsVisible = true
        this.callback("comments-visible", currentUrl)
      } else if (!nowVisible && this.lastCommentsVisible) {
        this.lastCommentsVisible = false
      }
    }
  }

  /**
   * One-shot: wait for an element matching a selector to appear.
   * Uses polling with configurable timeout.
   */
  waitFor(selector: string, timeout?: number): Promise<Element | null> {
    const pollMs = this.options.pollInterval
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
