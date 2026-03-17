/**
 * Playwright Browser Manager — Singleton headed browser for authenticated web automation.
 *
 * Architecture:
 *   Jim authenticates once at grove-node-1 (visible browser window).
 *   Cookies/localStorage persist to disk via Playwright's storageState.
 *   Subsequent launches reuse saved state — no re-auth needed until session expires.
 *
 * Usage:
 *   const mgr = getPlaywrightManager()
 *   const page = await mgr.launch("https://mail.google.com")
 *   // If auth needed, Jim logs in at the machine
 *   const authResult = await mgr.waitForAuth(page.id, { urlPattern: "mail.google.com/mail" })
 *   await mgr.saveState()
 *   const content = await mgr.getContent(page.id)
 *   await mgr.closePage(page.id)
 */

import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync, mkdirSync } from "fs"
import { reportFailure } from "@atlas/shared/error-escalation"
import type {
  PageHandle,
  BrowserSessionConfig,
  AuthWaitOptions,
  AuthWaitResult,
  ScreenshotResult,
  InteractAction,
} from "./types"

const __dir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_STATE_DIR = resolve(__dir, "../../data/browser-state")

// ─── Known Login Page Patterns ──────────────────────────────

const LOGIN_URL_PATTERNS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.linkedin.com",
  "auth0.com/login",
  "auth.atlassian.com",
  "github.com/login",
  "login.salesforce.com",
]

// ─── Singleton Manager ──────────────────────────────────────

let instance: PlaywrightManager | null = null

export function getPlaywrightManager(config?: BrowserSessionConfig): PlaywrightManager {
  if (!instance) {
    instance = new PlaywrightManager(config)
  }
  return instance
}

// ─── Manager Class ──────────────────────────────────────────

type PlaywrightModule = typeof import("playwright")

export class PlaywrightManager {
  private pw: PlaywrightModule | null = null
  private browser: import("playwright").Browser | null = null
  private context: import("playwright").BrowserContext | null = null
  private pages = new Map<string, import("playwright").Page>()
  private pageIdCounter = 0
  private stateDir: string
  private config: BrowserSessionConfig

  constructor(config?: BrowserSessionConfig) {
    this.config = {
      headed: true,
      viewportWidth: 1280,
      viewportHeight: 800,
      ...config,
    }
    this.stateDir = this.config.stateDir || DEFAULT_STATE_DIR

    // Ensure state directory exists
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────

  private async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected()) return

    // Lazy-load playwright to avoid import errors when not installed
    if (!this.pw) {
      this.pw = await import("playwright")
    }

    console.log("[playwright-manager] Launching Chromium (headed=%s)", this.config.headed)

    this.browser = await this.pw.chromium.launch({
      headless: !this.config.headed,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    })

    // Load saved state if available
    const statePath = this.getStatePath()
    const contextOptions: Record<string, unknown> = {
      viewport: {
        width: this.config.viewportWidth!,
        height: this.config.viewportHeight!,
      },
      // Make automation less detectable
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    if (existsSync(statePath)) {
      console.log("[playwright-manager] Loading saved browser state from %s", statePath)
      contextOptions.storageState = statePath
    }

    this.context = await this.browser.newContext(contextOptions)

    console.log("[playwright-manager] Browser ready")
  }

  private getStatePath(): string {
    return resolve(this.stateDir, "default-profile.json")
  }

  private generatePageId(): string {
    return `headed_${++this.pageIdCounter}_${Date.now()}`
  }

  // ─── Page Operations ────────────────────────────────────

  async launch(url: string): Promise<PageHandle> {
    await this.ensureBrowser()

    const page = await this.context!.newPage()
    const id = this.generatePageId()

    console.log("[playwright-manager] Opening page %s → %s", id, url)

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })

    this.pages.set(id, page)

    // Listen for page close
    page.on("close", () => {
      this.pages.delete(id)
    })

    return {
      id,
      url: page.url(),
      title: await page.title(),
      createdAt: Date.now(),
    }
  }

  async getPage(id: string): Promise<import("playwright").Page | null> {
    return this.pages.get(id) || null
  }

  async closePage(id: string): Promise<boolean> {
    const page = this.pages.get(id)
    if (!page) return false

    try {
      await page.close()
    } catch {
      // Page may already be closed
    }
    this.pages.delete(id)
    return true
  }

  async getContent(id: string, selector?: string): Promise<string> {
    const page = this.pages.get(id)
    if (!page) throw new Error(`Page not found: ${id}`)

    if (selector) {
      const el = await page.$(selector)
      if (!el) return ""
      return await el.innerText()
    }

    const text = await page.innerText("body")
    // Truncate to 50KB
    return text.length > 50_000 ? text.slice(0, 50_000) + "\n\n[Content truncated...]" : text
  }

  async screenshot(id: string): Promise<ScreenshotResult> {
    const page = this.pages.get(id)
    if (!page) throw new Error(`Page not found: ${id}`)

    const buffer = await page.screenshot({ type: "png", fullPage: false })
    const viewport = page.viewportSize() || { width: 1280, height: 800 }

    return {
      data: buffer.toString("base64"),
      width: viewport.width,
      height: viewport.height,
    }
  }

  async interact(id: string, action: InteractAction): Promise<string> {
    const page = this.pages.get(id)
    if (!page) throw new Error(`Page not found: ${id}`)

    switch (action.type) {
      case "click":
        if (!action.selector) throw new Error("click requires a selector")
        await page.click(action.selector)
        await page.waitForTimeout(500) // Brief settle
        return `Clicked ${action.selector}`

      case "type":
        if (!action.selector || !action.value) throw new Error("type requires selector and value")
        await page.fill(action.selector, action.value)
        return `Typed "${action.value}" into ${action.selector}`

      case "select":
        if (!action.selector || !action.value) throw new Error("select requires selector and value")
        await page.selectOption(action.selector, action.value)
        return `Selected "${action.value}" in ${action.selector}`

      case "press":
        if (!action.key) throw new Error("press requires a key")
        if (action.selector) {
          await page.press(action.selector, action.key)
        } else {
          await page.keyboard.press(action.key)
        }
        return `Pressed ${action.key}`

      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }
  }

  // ─── Authentication ─────────────────────────────────────

  isLoginPage(url: string): boolean {
    return LOGIN_URL_PATTERNS.some((pattern) => url.includes(pattern))
  }

  async waitForAuth(id: string, opts?: AuthWaitOptions): Promise<AuthWaitResult> {
    const page = this.pages.get(id)
    if (!page) throw new Error(`Page not found: ${id}`)

    const timeout = opts?.timeout ?? 120_000
    const pollInterval = opts?.pollInterval ?? 2_000
    const startTime = Date.now()

    console.log("[playwright-manager] Waiting for authentication (timeout: %dms)", timeout)

    while (Date.now() - startTime < timeout) {
      const currentUrl = page.url()

      // Check URL pattern match
      if (opts?.urlPattern && currentUrl.includes(opts.urlPattern)) {
        console.log("[playwright-manager] Auth detected via URL pattern: %s", currentUrl)
        await this.saveState()
        return {
          authenticated: true,
          finalUrl: currentUrl,
          timedOut: false,
          waitedMs: Date.now() - startTime,
        }
      }

      // Check selector match
      if (opts?.selector) {
        try {
          const el = await page.$(opts.selector)
          if (el) {
            console.log("[playwright-manager] Auth detected via selector: %s", opts.selector)
            await this.saveState()
            return {
              authenticated: true,
              finalUrl: currentUrl,
              timedOut: false,
              waitedMs: Date.now() - startTime,
            }
          }
        } catch {
          // Selector check failed, continue polling
        }
      }

      // Default: check if we're no longer on a login page
      if (!opts?.urlPattern && !opts?.selector) {
        if (!this.isLoginPage(currentUrl)) {
          console.log("[playwright-manager] Auth detected — no longer on login page: %s", currentUrl)
          await this.saveState()
          return {
            authenticated: true,
            finalUrl: currentUrl,
            timedOut: false,
            waitedMs: Date.now() - startTime,
          }
        }
      }

      await page.waitForTimeout(pollInterval)
    }

    return {
      authenticated: false,
      finalUrl: page.url(),
      timedOut: true,
      waitedMs: Date.now() - startTime,
    }
  }

  // ─── State Persistence ──────────────────────────────────

  async saveState(): Promise<void> {
    if (!this.context) return

    const statePath = this.getStatePath()
    console.log("[playwright-manager] Saving browser state to %s", statePath)

    await this.context.storageState({ path: statePath })
  }

  // ─── Page Info ──────────────────────────────────────────

  getActivePages(): PageHandle[] {
    const result: PageHandle[] = []
    for (const [id, page] of this.pages) {
      try {
        result.push({
          id,
          url: page.url(),
          title: "", // Title requires async, return empty for status checks
          createdAt: 0,
        })
      } catch {
        // Page may have been closed
        this.pages.delete(id)
      }
    }
    return result
  }

  isRunning(): boolean {
    return this.browser?.isConnected() ?? false
  }

  // ─── Cleanup ────────────────────────────────────────────

  async close(): Promise<void> {
    for (const [id, page] of this.pages) {
      try { await page.close() } catch {}
      this.pages.delete(id)
    }

    if (this.context) {
      try { await this.context.close() } catch {}
      this.context = null
    }

    if (this.browser) {
      try { await this.browser.close() } catch {}
      this.browser = null
    }

    console.log("[playwright-manager] Browser closed")
  }
}

// ─── Process Cleanup ──────────────────────────────────────

async function cleanup() {
  if (instance) {
    await instance.close()
    instance = null
  }
}

process.on("SIGINT", async () => { await cleanup(); process.exit(0) })
process.on("SIGTERM", async () => { await cleanup(); process.exit(0) })
