/**
 * Types for headed browser automation.
 *
 * The headed browser runs a visible Chromium instance that Jim can interact
 * with for authentication. After auth, Atlas takes programmatic control.
 */

export interface PageHandle {
  id: string
  url: string
  title: string
  createdAt: number
}

export interface BrowserSessionConfig {
  /** Launch headed (visible) or headless. Defaults to true (headed). */
  headed?: boolean
  /** Directory for persisted storage state (cookies, localStorage). */
  stateDir?: string
  /** Viewport width. Defaults to 1280. */
  viewportWidth?: number
  /** Viewport height. Defaults to 800. */
  viewportHeight?: number
}

export interface AuthWaitOptions {
  /** CSS selector that signals auth is complete (e.g., inbox element). */
  selector?: string
  /** URL pattern that signals auth is complete (substring match). */
  urlPattern?: string
  /** URL patterns that signal auth is required (login pages). */
  loginPatterns?: string[]
  /** Max time to wait in ms. Defaults to 120_000 (2 minutes). */
  timeout?: number
  /** Poll interval in ms. Defaults to 2000. */
  pollInterval?: number
}

export interface AuthWaitResult {
  authenticated: boolean
  finalUrl: string
  timedOut: boolean
  waitedMs: number
}

export interface ScreenshotResult {
  /** Base64-encoded PNG data */
  data: string
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
}

export interface InteractAction {
  type: "click" | "type" | "select" | "press"
  selector?: string
  value?: string
  /** Key to press (for type: "press"). e.g., "Enter", "Tab" */
  key?: string
}
