/**
 * AnythingLLM HTTP Client — Slot 2 Wiring
 *
 * Query-mode client for AnythingLLM workspaces.
 * Auth via Bearer token, 3s timeout, graceful degradation.
 */

// ─── Types ───────────────────────────────────────────────

export interface AnythingLLMChunk {
  /** The text content of the retrieved chunk */
  text: string
  /** Source document name (if available) */
  title?: string
  /** Relevance score (if available) */
  score?: number
}

export interface AnythingLLMResponse {
  /** Retrieved text chunks from the workspace */
  chunks: AnythingLLMChunk[]
  /** Whether the query was successful */
  ok: boolean
  /** Error message if query failed */
  error?: string
}

// ─── Configuration ───────────────────────────────────────

const TIMEOUT_MS = 3000

function getConfig(): { url: string; apiKey: string } | null {
  const url = process.env.ANYTHINGLLM_URL
  const apiKey = process.env.ANYTHINGLLM_API_KEY
  if (!url || !apiKey) return null
  return { url: url.replace(/\/$/, ""), apiKey }
}

// ─── Health Check ────────────────────────────────────────

/**
 * Check if AnythingLLM server is reachable and authenticated.
 */
export async function healthCheck(): Promise<boolean> {
  const config = getConfig()
  if (!config) {
    console.warn("[AnythingLLM] Not configured — missing ANYTHINGLLM_URL or ANYTHINGLLM_API_KEY")
    return false
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(`${config.url}/api/v1/auth`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    return response.ok
  } catch (err) {
    console.warn("[AnythingLLM] Health check failed:", (err as Error).message)
    return false
  }
}

// ─── Workspace Query ─────────────────────────────────────

/**
 * Query an AnythingLLM workspace in query mode.
 * Returns retrieved chunks, or empty array on any error.
 *
 * @param slug - Workspace slug (e.g. "grove-research", "take-flight")
 * @param message - The query text to search for
 */
export async function queryWorkspace(
  slug: string,
  message: string,
): Promise<AnythingLLMResponse> {
  const config = getConfig()
  if (!config) {
    return { chunks: [], ok: false, error: "Not configured" }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(
      `${config.url}/api/v1/workspace/${slug}/chat`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, mode: "query" }),
        signal: controller.signal,
      },
    )
    clearTimeout(timeout)

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      console.warn(`[AnythingLLM] Query failed (${response.status}): ${errorText}`)
      return { chunks: [], ok: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    // Extract chunks from AnythingLLM response format
    const chunks = parseChunks(data)
    console.info(`[AnythingLLM] Query "${slug}" returned ${chunks.length} chunks`)

    return { chunks, ok: true }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes("abort")) {
      console.warn(`[AnythingLLM] Query "${slug}" timed out (${TIMEOUT_MS}ms)`)
      return { chunks: [], ok: false, error: "Timeout" }
    }
    console.warn(`[AnythingLLM] Query "${slug}" failed:`, msg)
    return { chunks: [], ok: false, error: msg }
  }
}

// ─── Response Parsing ────────────────────────────────────

/**
 * Parse chunks from AnythingLLM response.
 * Handles both the direct response format and the contextual sources format.
 */
function parseChunks(data: unknown): AnythingLLMChunk[] {
  if (!data || typeof data !== "object") return []

  const obj = data as Record<string, unknown>

  // AnythingLLM query mode returns sources/context in various formats
  // Primary: { sources: [{ text, title, ... }] }
  if (Array.isArray(obj.sources)) {
    return obj.sources
      .filter((s: unknown) => s && typeof s === "object" && typeof (s as Record<string, unknown>).text === "string")
      .map((s: unknown) => {
        const src = s as Record<string, unknown>
        return {
          text: src.text as string,
          title: typeof src.title === "string" ? src.title : undefined,
          score: typeof src._distance === "number" ? 1 - (src._distance as number) : undefined,
        }
      })
  }

  // Fallback: { textResponse } as a single chunk
  if (typeof obj.textResponse === "string" && obj.textResponse.length > 0) {
    return [{ text: obj.textResponse }]
  }

  return []
}
