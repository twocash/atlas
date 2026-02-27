/**
 * AnythingLLM HTTP Client — Slot 2 Wiring
 *
 * Query-mode client for AnythingLLM workspaces.
 * Auth via Bearer token, 5s timeout, graceful degradation.
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

// Increased from 12000ms — Ollama embedding cold-start after Docker restart can
// take 15-20s on first query. MCP server uses 30s; this should be generous
// enough to survive cold-start without blocking the pipeline. (BUG-005, BUG-006)
const TIMEOUT_MS = 20_000

function getConfig(): { url: string; apiKey: string } | null {
  const url = process.env.ANYTHINGLLM_URL?.trim()
  const apiKey = process.env.ANYTHINGLLM_API_KEY?.trim()
  if (!url || !apiKey) return null
  return { url: url.replace(/\/$/, ""), apiKey }
}

// ─── Health Check ────────────────────────────────────────

export interface WorkspaceHealth {
  slug: string
  docCount: number
  status: 'ok' | 'empty' | 'not_found' | 'error'
  message: string
}

export interface AnythingLLMHealthReport {
  configured: boolean
  reachable: boolean
  authenticated: boolean
  error?: string
  workspaces: WorkspaceHealth[]
}

/**
 * Comprehensive health check for AnythingLLM: auth + workspace doc counts.
 * Surface-agnostic — usable by any health check consumer.
 */
export async function healthCheck(): Promise<AnythingLLMHealthReport> {
  const config = getConfig()
  if (!config) {
    return {
      configured: false,
      reachable: false,
      authenticated: false,
      error: `Missing ${!process.env.ANYTHINGLLM_URL?.trim() ? 'ANYTHINGLLM_URL' : 'ANYTHINGLLM_API_KEY'}`,
      workspaces: [],
    }
  }

  console.info(`[AnythingLLM] Config: url=${config.url}, key=${config.apiKey.slice(0, 4)}...(${config.apiKey.length} chars)`)

  // Auth check
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const response = await fetch(`${config.url}/api/v1/auth`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        configured: true,
        reachable: true,
        authenticated: false,
        error: `Auth failed (HTTP ${response.status})`,
        workspaces: [],
      }
    }
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      authenticated: false,
      error: (err as Error).message,
      workspaces: [],
    }
  }

  // Workspace health — query each configured workspace for doc count
  const { getConfiguredWorkspaces } = await import("./workspace-router")
  const workspaces: WorkspaceHealth[] = []

  for (const slug of getConfiguredWorkspaces()) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(`${config.url}/api/v1/workspace/${slug}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (response.ok) {
        // AnythingLLM returns workspace as a single-element array: { workspace: [{ documents: [...] }] }
        const data = await response.json() as { workspace?: Array<{ documents?: unknown[] }> }
        const ws = Array.isArray(data?.workspace) ? data.workspace[0] : data?.workspace
        const docCount = (ws as { documents?: unknown[] })?.documents?.length ?? 0
        workspaces.push({
          slug,
          docCount,
          status: docCount > 0 ? 'ok' : 'empty',
          message: docCount > 0 ? `${slug}: ${docCount} docs` : `${slug}: 0 docs (empty)`,
        })
      } else {
        workspaces.push({
          slug,
          docCount: 0,
          status: 'not_found',
          message: `${slug}: not found (HTTP ${response.status})`,
        })
      }
    } catch {
      workspaces.push({
        slug,
        docCount: 0,
        status: 'error',
        message: `${slug}: query failed`,
      })
    }
  }

  return {
    configured: true,
    reachable: true,
    authenticated: true,
    workspaces,
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
