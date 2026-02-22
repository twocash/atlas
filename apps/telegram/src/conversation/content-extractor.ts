/**
 * Content Extractor — Tiered URL Content Extraction
 *
 * ATLAS-CEX-001: Replaces raw HTTP+regex extraction with intelligent routing:
 *   Tier 1: HTTP fetch + regex (fast, free — articles, blogs, docs)
 *   Tier 2: Jina Reader (browser rendering — SPAs, social media)
 *
 * Jina Reader docs: https://github.com/jina-ai/reader
 *
 * Circuit breaker: 3 consecutive Jina failures → HTTP fallback for 5 minutes.
 * Backward compatibility: toUrlContent() adapts ExtractionResult → UrlContent.
 */

import type { UrlContent } from "../types"
import type { ContentSource, ExtractionMethod } from "./content-router"
import { detectContentSource, determineExtractionMethod } from "./content-router"
import { logger } from "../logger"
import { loadCookiesForUrl, requestCookieRefresh } from "../utils/chrome-cookies"
import { isBridgeAvailable, extractWithBridge } from "./bridge-extractor"

// ─── Types ────────────────────────────────────────────────

export type ExtractionStatus = "success" | "degraded" | "failed"

export interface ExtractionResult {
  url: string
  status: ExtractionStatus
  method: ExtractionMethod
  source: ContentSource

  // Content
  title: string
  description: string
  /** Full markdown content (Jina) or body snippet (HTTP fallback) */
  content: string

  // Metadata
  publishedTime?: string
  tokenEstimate?: number
  extractedAt: Date

  // Error tracking
  error?: string
  /** true if Jina failed and HTTP was used instead */
  fallbackUsed?: boolean
}

export interface ExtractOptions {
  /** CSS selector to target specific content */
  targetSelector?: string
  /** CSS selector for elements to remove (reduces tokens) */
  removeSelector?: string
  /** CSS selector to wait for before extraction */
  waitForSelector?: string
  /** Cookies to forward for auth-walled sites (disables Jina cache) */
  cookies?: string
  /** Timeout in seconds for Jina page rendering */
  timeout?: number
  /** Force specific extraction method (bypasses content router) */
  forceMethod?: ExtractionMethod
  /** Skip Jina cache (default: false) */
  noCache?: boolean
}

// ─── Configuration ────────────────────────────────────────

const JINA_API_KEY = (process.env.JINA_API_KEY || "").trim()
const JINA_BASE_URL = "https://r.jina.ai/"
const JINA_TIMEOUT_MS = 30_000
const HTTP_TIMEOUT_MS = 10_000

// Circuit breaker
let consecutiveJinaFailures = 0
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_RESET_MS = 300_000 // 5 minutes
let circuitBreakerTrippedAt: number | null = null

// ─── Per-Source Defaults ──────────────────────────────────
// Informed by Jina Reader docs + spike testing (ATLAS-CEX-001)

interface SourceDefaults {
  waitForSelector?: string
  targetSelector?: string
  removeSelector?: string
  timeout?: number
  noCache?: boolean
  /** Strip images from Jina output — 'none' removes all images */
  retainImages?: string
  /** Response format — 'text' for plain text (no markdown image syntax) */
  returnFormat?: string
  /** Flatten Shadow DOM components — required for Meta SPAs (Threads, Instagram) */
  withShadowDom?: boolean
  /** Puppeteer-style wait strategy — 'networkidle0' waits for all background data to finish */
  waitUntil?: string
}

/** Sources that require browser rendering — HTTP fallback returns garbage (login page, not content) */
const SPA_SOURCES: ContentSource[] = ["threads", "twitter", "linkedin"]

/** Minimum content length for SPA sources to be considered real content (not boilerplate) */
const SPA_MIN_CONTENT_LENGTH = 100

const SOURCE_DEFAULTS: Partial<Record<ContentSource, SourceDefaults>> = {
  threads: {
    // CEX-002: Jim's tuned Jina recipe for Meta Threads SPA.
    // Login wall renders INSTEAD of content — <main> never appears.
    // article targets the actual post even behind login blur.
    // Cookies must include Domain=.threads.net to survive Meta's redirect chains.
    // networkidle2 waits for JS data fetching to finish before extraction.
    targetSelector: 'article',      // Target post element (survives login wall)
    waitForSelector: 'article',     // Wait for post element to render
    withShadowDom: true,            // Flatten Meta's Shadow DOM components
    waitUntil: 'networkidle2',      // Wait for JS data fetching to stop
    noCache: true,
    timeout: 45,                    // Long timeout: SPA hydration + networkidle2 + Shadow DOM
    retainImages: 'none',           // Strip all images — profile pics slip through quality gate
    returnFormat: 'text',           // Plain text — no markdown image syntax to slip through
  },
  twitter: {
    waitForSelector: "article",
    targetSelector: "article",
    timeout: 20,             // More time for SPA hydration (was 15)
    noCache: true,
    retainImages: 'none',    // Strip all images from output
    removeSelector: 'nav, [role="banner"], aside',
  },
  linkedin: {
    waitForSelector: "article",
    timeout: 15,
    noCache: true,
  },
  youtube: {
    timeout: 10,
  },
  article: {
    removeSelector: "nav, footer, header, .sidebar, .advertisement, .ad, #cookie-banner",
  },
  generic: {
    removeSelector: "nav, footer, header",
  },
}

// ─── Content Quality Utilities ────────────────────────────

/**
 * Strip non-textual content from markdown so only real human-readable text remains.
 *
 * ATLAS-CEX-001: Jina Reader returns profile picture markdown (`![alt](https://cdn-url...)`)
 * that exceeds the SPA_MIN_CONTENT_LENGTH threshold but contains zero textual content.
 * The quality gate must measure TEXTUAL length, not raw byte length.
 */
export function stripNonTextContent(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // ![alt](url) — markdown images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // [text](url) → keep text only (BEFORE bare URL strip)
    .replace(/https?:\/\/\S+/g, '')             // bare URLs
    .replace(/<[^>]*>/g, '')                     // HTML tags
    .trim()
}

// ─── Circuit Breaker ──────────────────────────────────────

function isCircuitBreakerOpen(): boolean {
  if (consecutiveJinaFailures < CIRCUIT_BREAKER_THRESHOLD) return false
  if (!circuitBreakerTrippedAt) return false

  // Auto-reset after cooldown
  if (Date.now() - circuitBreakerTrippedAt > CIRCUIT_BREAKER_RESET_MS) {
    consecutiveJinaFailures = 0
    circuitBreakerTrippedAt = null
    logger.info("[ContentExtractor] Circuit breaker reset after cooldown")
    return false
  }

  return true
}

function recordJinaSuccess(): void {
  consecutiveJinaFailures = 0
  circuitBreakerTrippedAt = null
}

function recordJinaFailure(): void {
  consecutiveJinaFailures++
  if (consecutiveJinaFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerTrippedAt = Date.now()
    logger.warn(
      `[ContentExtractor] Circuit breaker OPEN after ${consecutiveJinaFailures} consecutive Jina failures`,
    )
  }
}

/** Reset circuit breaker state — exported for tests */
export function resetCircuitBreaker(): void {
  consecutiveJinaFailures = 0
  circuitBreakerTrippedAt = null
}

// ─── Jina Reader Extraction (Tier 2) ─────────────────────

async function extractWithJina(
  url: string,
  source: ContentSource,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const jinaUrl = `${JINA_BASE_URL}${url}`

  // Merge per-source defaults with caller overrides (caller wins)
  const defaults = SOURCE_DEFAULTS[source] || {}
  const effectiveOpts = { ...defaults, ...options }

  const headers: Record<string, string> = {
    Accept: "application/json",
  }

  // Auth
  if (JINA_API_KEY) {
    headers["Authorization"] = `Bearer ${JINA_API_KEY}`
  }

  // DOM targeting
  if (effectiveOpts.targetSelector) headers["x-target-selector"] = effectiveOpts.targetSelector
  if (effectiveOpts.removeSelector) headers["x-remove-selector"] = effectiveOpts.removeSelector
  if (effectiveOpts.waitForSelector) headers["x-wait-for-selector"] = effectiveOpts.waitForSelector
  if (effectiveOpts.withShadowDom) headers["x-with-shadow-dom"] = "true"
  if (effectiveOpts.waitUntil) headers["x-wait-until"] = effectiveOpts.waitUntil

  // Cookies (for auth-walled platforms — Threads, X, LinkedIn)
  if (effectiveOpts.cookies) {
    headers["x-set-cookie"] = effectiveOpts.cookies
    headers["x-no-cache"] = "true" // Cookie requests must bypass cache
  }

  // Cache control
  if (effectiveOpts.noCache) headers["x-no-cache"] = "true"

  // Content filtering (ATLAS-CEX-001: strip images, control output format)
  if (effectiveOpts.retainImages) headers["x-retain-images"] = effectiveOpts.retainImages
  if (effectiveOpts.returnFormat) headers["x-return-format"] = effectiveOpts.returnFormat

  // Render timeout
  if (effectiveOpts.timeout) headers["x-timeout"] = String(effectiveOpts.timeout)

  // Client-side timeout must exceed Jina's server-side x-timeout to avoid
  // aborting before Jina responds. Add 15s headroom for network + networkidle0.
  const clientTimeoutMs = effectiveOpts.timeout
    ? (effectiveOpts.timeout * 1000) + 15_000
    : JINA_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), clientTimeoutMs)

  try {
    logger.debug("[ContentExtractor] Jina request", {
      url,
      source,
      hasAuth: !!JINA_API_KEY,
      hasCookies: !!options.cookies,
    })

    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      throw new Error(`Jina HTTP ${response.status}: ${errorText.slice(0, 200)}`)
    }

    const data = (await response.json()) as {
      code?: number
      status?: number
      data?: {
        url?: string
        title?: string
        description?: string
        content?: string
        text?: string
        publishedTime?: string
        usage?: { tokens?: number }
      }
    }

    // Jina returns content in .content (markdown) or .text (when x-return-format: text)
    const content = data.data?.content || data.data?.text || ""
    const title = data.data?.title || ""
    const description = data.data?.description || ""

    // Empty content = likely login wall or Cloudflare challenge
    if (!content && !title) {
      logger.warn("[ContentExtractor] Jina returned empty content", { url, source })
      return {
        url,
        status: "degraded",
        method: "Browser",
        source,
        title,
        description,
        content,
        publishedTime: data.data?.publishedTime,
        tokenEstimate: data.data?.usage?.tokens,
        extractedAt: new Date(),
        error: "Jina returned empty content (possible login wall or Cloudflare block)",
      }
    }

    // SPA content quality gate: Jina returned a title (from <title> tag) but
    // minimal/no real content. For SPA sources this means the page shell rendered
    // but post content didn't hydrate — the "content" is profile boilerplate.
    // Treating this as success causes downstream research to target the author
    // instead of the post topic (ATLAS-CEX-001 P0 bug).
    //
    // ATLAS-CEX-001 P0 refinement: Measure TEXTUAL content after stripping images,
    // bare URLs, and HTML tags. Jina can return profile picture markdown that exceeds
    // the raw length threshold but contains zero actual text.
    const textualContent = stripNonTextContent(content)
    if (SPA_SOURCES.includes(source) && textualContent.length < SPA_MIN_CONTENT_LENGTH) {
      logger.warn("[ContentExtractor] SPA content quality gate FAILED — textual content too short (likely boilerplate)", {
        url,
        source,
        titleLen: title.length,
        rawContentLen: content.length,
        textualContentLen: textualContent.length,
        contentPreview: content.substring(0, 80),
      })
      return {
        url,
        status: "degraded",
        method: "Browser",
        source,
        title,
        description,
        content,
        publishedTime: data.data?.publishedTime,
        tokenEstimate: data.data?.usage?.tokens,
        extractedAt: new Date(),
        error: `Jina returned only ${content.length} chars for ${source} (likely profile boilerplate, not post content)`,
      }
    }

    recordJinaSuccess()

    logger.info("[ContentExtractor] Jina extraction successful", {
      url,
      source,
      titleLen: title.length,
      contentLen: content.length,
      tokens: data.data?.usage?.tokens,
    })

    return {
      url,
      status: "success",
      method: "Browser",
      source,
      title,
      description,
      content,
      publishedTime: data.data?.publishedTime,
      tokenEstimate: data.data?.usage?.tokens,
      extractedAt: new Date(),
    }
  } catch (error) {
    clearTimeout(timeoutId)
    recordJinaFailure()

    const message = error instanceof Error ? error.message : "Unknown Jina error"
    logger.error("[ContentExtractor] Jina extraction failed", { url, error: message })

    return {
      url,
      status: "failed",
      method: "Browser",
      source,
      title: "",
      description: "",
      content: "",
      extractedAt: new Date(),
      error: message,
    }
  }
}

// ─── HTTP Extraction (Tier 1) ─────────────────────────────

async function extractWithHttp(
  url: string,
  source: ContentSource,
): Promise<ExtractionResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Atlas-Bot/1.0 (Content Classification)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        url,
        status: "failed",
        method: "Fetch",
        source,
        title: "",
        description: "",
        content: "",
        extractedAt: new Date(),
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const html = await response.text()
    const title = extractTitleFromHtml(html)
    const description = extractDescriptionFromHtml(html)
    const content = extractBodyFromHtml(html)

    return {
      url,
      status: "success",
      method: "Fetch",
      source,
      title,
      description,
      content,
      extractedAt: new Date(),
    }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : "Unknown error"

    return {
      url,
      status: "failed",
      method: "Fetch",
      source,
      title: "",
      description: "",
      content: "",
      extractedAt: new Date(),
      error: message,
    }
  }
}

// ─── HTML Helpers (same logic as url.ts) ──────────────────

function extractTitleFromHtml(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) return titleMatch[1].trim()
  const ogMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  )
  if (ogMatch) return ogMatch[1].trim()
  return ""
}

function extractDescriptionFromHtml(html: string): string {
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
  )
  if (descMatch) return descMatch[1].trim()
  const ogMatch = html.match(
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
  )
  if (ogMatch) return ogMatch[1].trim()
  return ""
}

function extractBodyFromHtml(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  text = text.replace(/<[^>]+>/g, " ")
  text = text.replace(/\s+/g, " ").trim()
  return text.substring(0, 500)
}

// ─── URL Normalization ────────────────────────────────────

/** Strip tracking params from Threads URLs (xmt, slof are session/tracking tokens) */
function normalizeUrl(url: string, source: ContentSource): string {
  if (source === "threads") {
    try {
      const u = new URL(url)
      // threads.com → threads.net (Meta's canonical domain)
      // Using .com causes redirect loops or instant login walls
      if (u.hostname === "threads.com" || u.hostname === "www.threads.com") {
        u.hostname = "www.threads.net"
      }
      u.searchParams.delete("xmt")
      u.searchParams.delete("slof")
      return u.toString()
    } catch {
      return url
    }
  }
  return url
}

// ─── Login Wall Detection ────────────────────────────────

/** Heuristics for detecting login walls in extracted content */
function isLikelyLoginWall(result: ExtractionResult): boolean {
  // Empty content from Jina = login wall or Cloudflare
  if ((result.status === "degraded" || result.status === "failed") && !result.content && !result.title) return true

  // Check for login-related strings in title/content
  const text = `${result.title} ${result.content}`.toLowerCase()
  const loginSignals = ["log in", "login", "sign in", "signin", "create an account", "join now"]
  const matchCount = loginSignals.filter((s) => text.includes(s)).length
  // Need at least 2 signals to avoid false positives on pages that mention "sign in" editorially
  return matchCount >= 2 && result.content.length < 500
}

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Extract content from a URL using the best available method.
 *
 * Routing logic:
 * - SPA sites (threads, twitter, linkedin):
 *     → Bridge + Chrome Extension (Tier 0) if available — best quality
 *     → Jina Reader (Tier 2) with auto-cookies as fallback
 * - Everything else → HTTP fetch + regex (Tier 1)
 * - Jina failure → fallback to HTTP with status='degraded'
 * - Login wall detected → auto-refresh cookies via Bridge → retry once
 * - Circuit breaker: 3 consecutive Jina failures → HTTP only for 5 min
 *
 * @param url - URL to extract content from
 * @param options - Extraction options (selectors, cookies, timeout)
 */
export async function extractContent(
  url: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const source = detectContentSource(url)
  const method = options.forceMethod || determineExtractionMethod(source)

  // Normalize URL (strip tracking params)
  const cleanUrl = normalizeUrl(url, source)

  // Tier 1: HTTP fetch for non-browser sources
  if (method === "Fetch") {
    return extractWithHttp(cleanUrl, source)
  }

  // Tier 0: Bridge + Chrome Extension (best quality for SPAs — uses Jim's authenticated sessions)
  if (method === "Browser") {
    try {
      const bridgeUp = await isBridgeAvailable()
      if (bridgeUp) {
        logger.info("[ContentExtractor] Bridge available — attempting browser extraction", {
          url: cleanUrl,
          source,
        })
        const bridgeResult = await extractWithBridge(cleanUrl, source)
        if (bridgeResult.status === "success") {
          return bridgeResult
        }
        // Bridge failed — log and fall through to Jina
        logger.warn("[ContentExtractor] Bridge extraction failed — falling through to Jina", {
          url: cleanUrl,
          source,
          error: bridgeResult.error,
        })
      }
    } catch (err: any) {
      logger.warn("[ContentExtractor] Bridge check failed — falling through to Jina", {
        url: cleanUrl,
        error: err.message,
      })
    }
  }

  // Tier 2: Jina Reader for browser-required sources
  if (isCircuitBreakerOpen()) {
    logger.warn("[ContentExtractor] Circuit breaker open — falling back to HTTP", {
      url: cleanUrl,
      source,
    })
    const httpResult = await extractWithHttp(cleanUrl, source)
    httpResult.fallbackUsed = true
    httpResult.error = `Jina circuit breaker open; ${httpResult.error || "HTTP fallback used"}`
    if (httpResult.status === "success") httpResult.status = "degraded"
    return httpResult
  }

  // Auto-load cookies for SPA sources (if available and not already provided)
  const effectiveOptions = { ...options }
  if (!effectiveOptions.cookies && SPA_SOURCES.includes(source)) {
    const cookieResult = loadCookiesForUrl(cleanUrl)
    if (cookieResult) {
      effectiveOptions.cookies = cookieResult.cookieString
      logger.info("[ContentExtractor] Auto-loaded cookies", {
        source,
        count: cookieResult.count,
        stale: cookieResult.stale,
      })
    }
  }

  const jinaResult = await extractWithJina(cleanUrl, source, effectiveOptions)

  // Login wall detection + auto-retry with fresh cookies
  if (
    SPA_SOURCES.includes(source) &&
    (jinaResult.status === "degraded" || jinaResult.status === "failed") &&
    isLikelyLoginWall(jinaResult)
  ) {
    logger.warn("[ContentExtractor] Login wall detected — requesting cookie refresh", {
      url: cleanUrl,
      source,
    })

    const refreshed = await requestCookieRefresh()

    if (refreshed) {
      // Reload cookies from disk
      const freshCookies = loadCookiesForUrl(cleanUrl)
      if (freshCookies) {
        logger.info("[ContentExtractor] Retrying with fresh cookies", {
          source,
          count: freshCookies.count,
        })

        const retryOptions = { ...effectiveOptions, cookies: freshCookies.cookieString }
        const retryResult = await extractWithJina(cleanUrl, source, retryOptions)

        if (retryResult.status === "success") {
          logger.info("[ContentExtractor] Cookie refresh retry SUCCEEDED", {
            url: cleanUrl,
            source,
          })
          return retryResult
        }

        // Still failing after refresh — report login issue
        logger.error("[ContentExtractor] Cookie refresh retry FAILED — login issue persists", {
          url: cleanUrl,
          source,
          error: retryResult.error,
        })
        retryResult.error =
          `Login wall detected. Cookies were refreshed but extraction still failed. ` +
          `Try logging into ${source} in Chrome. Original error: ${retryResult.error || "empty content"}`
        return retryResult
      }
    }

    // Couldn't refresh cookies — add login guidance to error
    jinaResult.error =
      `Login wall detected for ${source}. ` +
      `Cookie refresh ${refreshed ? "succeeded but no cookies found" : "failed (Bridge unreachable or no extension connected)"}. ` +
      `Try logging into ${source} in Chrome. Original error: ${jinaResult.error || "empty content"}`
  }

  // If Jina failed completely, try HTTP as degraded fallback
  if (jinaResult.status === "failed") {
    // SPA sources: HTTP fallback ALWAYS returns login page garbage — skip it
    if (SPA_SOURCES.includes(source)) {
      logger.error("[ContentExtractor] Jina FAILED for SPA source — no fallback available", {
        url: cleanUrl,
        source,
        method: "jina",
        error: jinaResult.error,
      })
      jinaResult.fallbackUsed = false
      return jinaResult // Return the failed result directly
    }

    // Non-SPA: HTTP fallback may work
    logger.warn("[ContentExtractor] Jina FAILED — degrading to HTTP fallback", {
      url: cleanUrl,
      source,
      jinaError: jinaResult.error,
    })
    const httpResult = await extractWithHttp(cleanUrl, source)
    httpResult.fallbackUsed = true
    if (httpResult.status === "success") {
      httpResult.status = "degraded"
      logger.warn("[ContentExtractor] HTTP fallback returned content but quality is DEGRADED (no JS rendering)", {
        url: cleanUrl,
        source,
        title: httpResult.title?.substring(0, 80),
      })
    } else {
      logger.error("[ContentExtractor] BOTH Jina AND HTTP failed — no content extracted", {
        url: cleanUrl,
        source,
        jinaError: jinaResult.error,
        httpError: httpResult.error,
      })
    }
    return httpResult
  }

  return jinaResult
}

/**
 * Convert ExtractionResult → UrlContent for backward compatibility.
 * Callers using the old fetchUrlContent() contract can use this adapter.
 *
 * CONSTRAINT 4 (Fail Fast, Fail Loud): For SPA sources, degraded status
 * means HTTP fallback returned a login page, not actual content.
 * That IS a failure — garbage content is worse than no content.
 */
export function toUrlContent(result: ExtractionResult): UrlContent {
  // SPA + degraded = login page HTML, not real content. Treat as failure.
  const isSpaGarbage =
    result.status === "degraded" && SPA_SOURCES.includes(result.source)

  if (isSpaGarbage) {
    logger.warn("[ContentExtractor] SPA degraded → FAILURE (HTTP fallback is garbage for SPAs)", {
      url: result.url,
      source: result.source,
      method: result.method,
      fallbackUsed: result.fallbackUsed,
    })
  }

  return {
    url: result.url,
    title: result.title,
    description: result.description,
    bodySnippet: result.content.substring(0, 500),
    fullContent: result.content || undefined,
    fetchedAt: result.extractedAt,
    success: result.status !== "failed" && !isSpaGarbage,
    error: isSpaGarbage
      ? `${result.source} requires browser rendering — HTTP fallback returned login page, not content. ${result.error || ""}`
      : result.error,
  }
}
