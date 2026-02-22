/**
 * Bridge Extractor — extracts SPA content via Chrome Extension bridge.
 *
 * When the Atlas Bridge + Chrome Extension are running, this provides
 * browser-mediated content extraction using Jim's authenticated sessions.
 * Falls through to Jina/HTTP if the bridge is unavailable.
 *
 * Flow:
 *   POST http://localhost:{BRIDGE_PORT}/tool-dispatch
 *     → Bridge sends tool_request via WebSocket to Extension
 *     → Extension opens tab, waits for hydration, extracts content
 *     → Result flows back through the chain
 */

import type { ExtractionResult, ExtractionStatus } from "./content-extractor"
import type { ContentSource } from "./content-router"
import { logger } from "../logger"

// ─── Config ──────────────────────────────────────────────

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "3848", 10)
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`
const BRIDGE_TOOL_TIMEOUT_MS = 30_000

// ─── Bridge Health ───────────────────────────────────────

interface BridgeStatus {
  status: string
  clients: number
  claude: string
}

/**
 * Check if the bridge is running and has a connected Chrome Extension.
 * Returns true only if at least one browser client is connected.
 */
export async function isBridgeAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const res = await fetch(`${BRIDGE_URL}/status`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return false

    const data = (await res.json()) as BridgeStatus
    return data.clients > 0
  } catch {
    return false
  }
}

// ─── Bridge Extraction ──────────────────────────────────

interface BridgeToolResponse {
  id: string
  result?: {
    url: string
    title: string
    content: string
    contentLength: number
    truncated: boolean
    platform: string
    hydrationSelector: string
    hydrationFound: boolean
    hydrationWaitMs: number
    extractionMode: string
    extractionSource: string
    tabClosed: boolean
  }
  error?: string
}

/**
 * Extract content from a URL via the Chrome Extension bridge.
 *
 * Opens a background tab in Chrome, waits for SPA hydration,
 * extracts the rendered text content, and closes the tab.
 */
export async function extractWithBridge(
  url: string,
  source: ContentSource,
): Promise<ExtractionResult> {
  const id = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const body = {
    id,
    name: "atlas_browser_open_and_read",
    input: {
      url,
      extractionMode: "full",
      closeAfter: true,
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TOOL_TIMEOUT_MS)

  try {
    const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logger.error("[BridgeExtractor] Bridge returned error", {
        url,
        status: res.status,
        body: text.substring(0, 200),
      })
      return bridgeFailure(url, source, `Bridge returned ${res.status}: ${text}`)
    }

    const data = (await res.json()) as BridgeToolResponse

    if (data.error) {
      logger.error("[BridgeExtractor] Tool execution error", {
        url,
        error: data.error,
      })
      return bridgeFailure(url, source, data.error)
    }

    if (!data.result) {
      return bridgeFailure(url, source, "Bridge returned empty result")
    }

    const result = data.result

    // Check if we got meaningful content
    const contentLength = result.content?.trim().length || 0
    if (contentLength < 50) {
      logger.warn("[BridgeExtractor] Content too short — possible login wall", {
        url,
        contentLength,
        platform: result.platform,
        hydrationFound: result.hydrationFound,
      })
      return {
        url,
        status: "degraded" as ExtractionStatus,
        method: "Browser",
        source,
        title: result.title || "",
        description: "",
        content: result.content || "",
        extractedAt: new Date(),
        error: `Browser extraction returned only ${contentLength} chars — possible login wall`,
        fallbackUsed: false,
      }
    }

    logger.info("[BridgeExtractor] Extraction successful", {
      url,
      source,
      platform: result.platform,
      contentLength: result.contentLength,
      truncated: result.truncated,
      hydrationFound: result.hydrationFound,
      hydrationWaitMs: result.hydrationWaitMs,
      extractionSource: result.extractionSource,
    })

    return {
      url,
      status: "success" as ExtractionStatus,
      method: "Browser",
      source,
      title: result.title || "",
      description: "",
      content: result.content,
      extractedAt: new Date(),
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return bridgeFailure(url, source, `Bridge extraction timed out after ${BRIDGE_TOOL_TIMEOUT_MS}ms`)
    }
    return bridgeFailure(url, source, `Bridge unreachable: ${err.message}`)
  } finally {
    clearTimeout(timeout)
  }
}

function bridgeFailure(
  url: string,
  source: ContentSource,
  error: string,
): ExtractionResult {
  return {
    url,
    status: "failed",
    method: "Browser",
    source,
    title: "",
    description: "",
    content: "",
    extractedAt: new Date(),
    error,
    fallbackUsed: false,
  }
}
