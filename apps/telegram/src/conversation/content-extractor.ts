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

const JINA_API_KEY = process.env.JINA_API_KEY || ""
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
}

const SOURCE_DEFAULTS: Partial<Record<ContentSource, SourceDefaults>> = {
  threads: {
    waitForSelector: "article",
    targetSelector: "article",
    timeout: 15,
    noCache: true, // SPA content changes frequently
  },
  twitter: {
    waitForSelector: "article",
    targetSelector: "article",
    timeout: 15,
    noCache: true,
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

  // Cookies (for auth-walled platforms — Threads, X, LinkedIn)
  if (effectiveOpts.cookies) {
    headers["x-set-cookie"] = effectiveOpts.cookies
    headers["x-no-cache"] = "true" // Cookie requests must bypass cache
  }

  // Cache control
  if (effectiveOpts.noCache) headers["x-no-cache"] = "true"

  // Render timeout
  if (effectiveOpts.timeout) headers["x-timeout"] = String(effectiveOpts.timeout)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS)

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
        publishedTime?: string
        usage?: { tokens?: number }
      }
    }

    const content = data.data?.content || ""
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

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Extract content from a URL using the best available method.
 *
 * Routing logic:
 * - SPA sites (threads, twitter, linkedin) → Jina Reader (Tier 2)
 * - Everything else → HTTP fetch + regex (Tier 1)
 * - Jina failure → fallback to HTTP with status='degraded'
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

  // Tier 1: HTTP fetch for non-browser sources
  if (method === "Fetch") {
    return extractWithHttp(url, source)
  }

  // Tier 2: Jina Reader for browser-required sources
  if (isCircuitBreakerOpen()) {
    logger.warn("[ContentExtractor] Circuit breaker open — falling back to HTTP", {
      url,
      source,
    })
    const httpResult = await extractWithHttp(url, source)
    httpResult.fallbackUsed = true
    httpResult.error = `Jina circuit breaker open; ${httpResult.error || "HTTP fallback used"}`
    if (httpResult.status === "success") httpResult.status = "degraded"
    return httpResult
  }

  const jinaResult = await extractWithJina(url, source, options)

  // If Jina failed completely, try HTTP as degraded fallback
  if (jinaResult.status === "failed") {
    logger.warn("[ContentExtractor] Jina FAILED — degrading to HTTP fallback", {
      url,
      source,
      jinaError: jinaResult.error,
    })
    const httpResult = await extractWithHttp(url, source)
    httpResult.fallbackUsed = true
    if (httpResult.status === "success") {
      httpResult.status = "degraded"
      logger.warn("[ContentExtractor] HTTP fallback returned content but quality is DEGRADED (no JS rendering)", {
        url,
        source,
        title: httpResult.title?.substring(0, 80),
      })
    } else {
      logger.error("[ContentExtractor] BOTH Jina AND HTTP failed — no content extracted", {
        url,
        source,
        jinaError: jinaResult.error,
        httpError: httpResult.error,
      })
    }
    return httpResult
  }

  return jinaResult
}

/** Sources that require browser rendering — HTTP fallback returns garbage (login page, not content) */
const SPA_SOURCES: ContentSource[] = ["threads", "twitter", "linkedin"]

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
    fetchedAt: result.extractedAt,
    success: result.status !== "failed" && !isSpaGarbage,
    error: isSpaGarbage
      ? `${result.source} requires browser rendering — HTTP fallback returned login page, not content. ${result.error || ""}`
      : result.error,
  }
}
