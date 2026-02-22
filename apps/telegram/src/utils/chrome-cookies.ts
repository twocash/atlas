/**
 * Chrome Cookies — Reads saved browser cookies from disk for content extraction.
 *
 * Cookie files are written by the Bridge server (POST /cookie-refresh) after
 * the Chrome extension reads them via chrome.cookies API.
 *
 * File format: data/cookies/<domain>.json
 *   { domain, refreshedAt, count, cookies: [{ name, value, domain, path }] }
 *
 * The loadCookiesForUrl() function maps a URL to its domain, reads the cookie
 * file, and returns a formatted cookie string for Jina Reader's x-set-cookie header.
 */

import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync, existsSync } from "fs"
import { logger } from "../logger"

// ─── Config ──────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const COOKIE_DIR = resolve(__dir, "../../data/cookies")

/** Max age before cookies are considered stale and should be refreshed */
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Domain Mapping ──────────────────────────────────────

/** Maps URL hostnames to cookie file domains */
const DOMAIN_MAP: Record<string, string> = {
  "threads.com": "threads.com",
  "www.threads.com": "threads.com",
  "threads.net": "threads.com",
  "www.threads.net": "threads.com",
  "instagram.com": "instagram.com",
  "www.instagram.com": "instagram.com",
  "linkedin.com": "linkedin.com",
  "www.linkedin.com": "linkedin.com",
}

/**
 * Maps cookie file domains → Jina injection domain scope.
 * CEX-002: Jina's headless browser treats cookies without Domain= as host-only,
 * which get dropped on Meta's redirect chains (threads.net → www.threads.net).
 * Explicit domain scoping makes cookies "sticky" across subdomains and redirects.
 */
const COOKIE_INJECTION_DOMAIN: Record<string, string> = {
  "threads.com": ".threads.net",      // Cookies captured on .com, injected for .net
  "instagram.com": ".instagram.com",
  "linkedin.com": ".linkedin.com",
}

// ─── Types ───────────────────────────────────────────────

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  expirationDate?: number
}

interface CookieFile {
  domain: string
  refreshedAt: string
  count: number
  cookies: CookieEntry[]
}

export interface CookieLoadResult {
  /** Formatted cookie string for x-set-cookie header */
  cookieString: string
  /** Number of cookies loaded */
  count: number
  /** Whether the cookies are stale (older than 24h) */
  stale: boolean
  /** When cookies were last refreshed */
  refreshedAt: string
}

// ─── Public API ──────────────────────────────────────────

/**
 * Load saved cookies for a URL, formatted for Jina Reader's x-set-cookie header.
 * Returns null if no cookie file exists for the URL's domain.
 */
export function loadCookiesForUrl(url: string): CookieLoadResult | null {
  try {
    const hostname = new URL(url).hostname
    const cookieDomain = DOMAIN_MAP[hostname]

    if (!cookieDomain) {
      return null
    }

    const filepath = resolve(COOKIE_DIR, `${cookieDomain}.json`)

    if (!existsSync(filepath)) {
      logger.debug("[Cookies] No cookie file found", { domain: cookieDomain, filepath })
      return null
    }

    const raw = readFileSync(filepath, "utf-8")
    const data: CookieFile = JSON.parse(raw)

    if (!data.cookies || data.cookies.length === 0) {
      logger.warn("[Cookies] Cookie file is empty", { domain: cookieDomain })
      return null
    }

    // CEX-002: Format cookies with domain scoping for Jina's headless browser.
    // Without Domain= attribute, cookies become host-only and get dropped on
    // Meta's redirect chains (threads.net → www.threads.net).
    // Comma-separated per Jina's standard header folding for x-set-cookie.
    const injectionDomain = COOKIE_INJECTION_DOMAIN[cookieDomain]
    const cookieString = injectionDomain
      ? data.cookies
          .map((c) => `${c.name}=${c.value}; Domain=${injectionDomain}; Path=/; Secure; HttpOnly`)
          .join(", ")
      : data.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ")

    const refreshedAt = data.refreshedAt || new Date(0).toISOString()
    const age = Date.now() - new Date(refreshedAt).getTime()
    const stale = age > COOKIE_MAX_AGE_MS

    if (stale) {
      logger.warn("[Cookies] Cookies are stale", {
        domain: cookieDomain,
        refreshedAt,
        ageHours: Math.round(age / 3600000),
      })
    }

    logger.debug("[Cookies] Loaded cookies", {
      domain: cookieDomain,
      count: data.cookies.length,
      stale,
    })

    return {
      cookieString,
      count: data.cookies.length,
      stale,
      refreshedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error("[Cookies] Failed to load cookies", { url, error: message })
    return null
  }
}

/**
 * Request the Bridge to refresh cookies from Chrome.
 * Returns true if refresh succeeded, false otherwise.
 */
export async function requestCookieRefresh(domains?: string[]): Promise<boolean> {
  const bridgePort = process.env.BRIDGE_PORT || "3848"
  const bridgeUrl = `http://localhost:${bridgePort}/cookie-refresh`

  try {
    logger.info("[Cookies] Requesting cookie refresh from Bridge", { domains })

    const res = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(domains ? { domains } : {}),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logger.error("[Cookies] Bridge cookie refresh failed", {
        status: res.status,
        body: text.slice(0, 200),
      })
      return false
    }

    const result = (await res.json()) as { ok: boolean; summary?: string; error?: string }
    if (result.ok) {
      logger.info("[Cookies] Cookie refresh succeeded", { summary: result.summary })
      return true
    }

    logger.error("[Cookies] Cookie refresh returned error", { error: result.error })
    return false
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error("[Cookies] Bridge unreachable for cookie refresh", { error: message })
    return false
  }
}
