/**
 * ThreadHydrator — queries Feed 2.0 by thread_id for conversation history.
 *
 * Compilation stage (Manifesto Part III, Layer 3): "The system assembles
 * what it needs. Context from memory. Historical patterns from the telemetry."
 *
 * This service hydrates conversation context from Feed 2.0 before context
 * assembly. ConversationState is the fast in-memory cache; Feed 2.0 is
 * the persistent truth.
 *
 * ADR-009: Thread history lives at the desk (Feed 2.0), not on the phone
 * line (ConversationState ephemeral memory).
 * ADR-001: MAX_HYDRATION_TURNS is Notion-governed.
 * ADR-008: Hydration failures surface as degraded context notes, never silent.
 */

import { Client } from "@notionhq/client"
import { NOTION_DB } from "@atlas/shared/config"
import { logger } from "../logger"
import { reportFailure } from "@atlas/shared/error-escalation"

// ─── Types ───────────────────────────────────────────────

export interface HydratedTurn {
  /** Feed entry ID */
  feedId: string
  /** Entry title/summary */
  entry: string
  /** When this turn happened */
  timestamp: string
  /** Action type (classify, query, tool, etc.) */
  actionType?: string
  /** Pillar classification */
  pillar?: string
  /** Intent hash for pattern matching */
  intentHash?: string
  /** Surface that originated this turn */
  surface?: string
}

export interface HydrationResult {
  /** Thread ID that was queried */
  threadId: string
  /** Hydrated conversation turns, most recent first */
  turns: HydratedTurn[]
  /** How many turns were requested vs returned */
  requested: number
  returned: number
  /** Whether hydration succeeded or degraded */
  status: "success" | "degraded" | "empty"
  /** Error message if degraded */
  error?: string
  /** Latency in milliseconds */
  latencyMs: number
}

// ─── Config ──────────────────────────────────────────────

/** Default max turns to hydrate. Overridden by Notion config if available. */
const DEFAULT_MAX_HYDRATION_TURNS = 10

/** Cache for Notion-governed MAX_HYDRATION_TURNS */
let _maxTurnsCache: { value: number; expiresAt: number } | null = null
const MAX_TURNS_CACHE_TTL_MS = 60_000

// ─── Notion Client ──────────────────────────────────────

let _notion: Client | null = null

function getNotion(): Client | null {
  if (_notion) return _notion
  const key = process.env.NOTION_API_KEY
  if (!key) return null
  _notion = new Client({ auth: key })
  return _notion
}

// ─── Max Turns Config (Notion-governed) ─────────────────

/**
 * Resolve MAX_HYDRATION_TURNS from Notion Tool Routing Config DB.
 * Falls back to DEFAULT_MAX_HYDRATION_TURNS if not configured.
 */
async function getMaxHydrationTurns(): Promise<number> {
  if (_maxTurnsCache && _maxTurnsCache.expiresAt > Date.now()) {
    return _maxTurnsCache.value
  }

  const notion = getNotion()
  const dbId = process.env.TOOL_ROUTING_CONFIG_DB || NOTION_DB.TOOL_ROUTING_CONFIG
  if (!notion || !dbId) return DEFAULT_MAX_HYDRATION_TURNS

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: "Tool ID",
        title: { equals: "max_hydration_turns" },
      },
    })

    if (response.results.length > 0) {
      const page = response.results[0] as any
      const value = page.properties?.["Auto Promote Threshold"]?.number
      if (typeof value === "number" && value > 0) {
        _maxTurnsCache = { value, expiresAt: Date.now() + MAX_TURNS_CACHE_TTL_MS }
        return value
      }
    }
  } catch (err) {
    logger.warn("[thread-hydrator] Failed to resolve MAX_HYDRATION_TURNS from Notion", {
      error: (err as Error).message,
    })
    reportFailure("thread-hydrator-config", err, {
      suggestedFix: "Check TOOL_ROUTING_CONFIG_DB env var and Notion connectivity. Falling back to default (10 turns).",
    })
  }

  _maxTurnsCache = { value: DEFAULT_MAX_HYDRATION_TURNS, expiresAt: Date.now() + MAX_TURNS_CACHE_TTL_MS }
  return DEFAULT_MAX_HYDRATION_TURNS
}

// ─── Hydration ──────────────────────────────────────────

/**
 * Hydrate conversation history from Feed 2.0 by thread_id.
 *
 * Returns recent turns for the thread, ordered by date descending
 * (most recent first). Used by the Compilation stage to assemble
 * context before inference.
 *
 * @param threadId - Canonical thread ID (e.g., "telegram:8207593172")
 * @param maxTurns - Override max turns (defaults to Notion-governed value)
 */
export async function hydrateThread(
  threadId: string,
  maxTurns?: number,
): Promise<HydrationResult> {
  const start = Date.now()
  const requested = maxTurns ?? await getMaxHydrationTurns()

  const notion = getNotion()
  if (!notion) {
    return {
      threadId,
      turns: [],
      requested,
      returned: 0,
      status: "degraded",
      error: "Notion client unavailable (no API key)",
      latencyMs: Date.now() - start,
    }
  }

  try {
    const response = await notion.databases.query({
      database_id: NOTION_DB.FEED,
      filter: {
        property: "Thread ID",
        rich_text: { equals: threadId },
      },
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: requested,
    })

    const turns: HydratedTurn[] = []
    for (const page of response.results) {
      const props = (page as any).properties
      const turn = parseFeedEntry(page.id, props)
      if (turn) turns.push(turn)
    }

    const latencyMs = Date.now() - start
    logger.info("[thread-hydrator] Hydration complete", {
      threadId,
      requested,
      returned: turns.length,
      latencyMs,
    })

    return {
      threadId,
      turns,
      requested,
      returned: turns.length,
      status: turns.length > 0 ? "success" : "empty",
      latencyMs,
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    const error = (err as Error).message
    logger.warn("[thread-hydrator] Hydration failed — degraded context", {
      threadId,
      error,
      latencyMs,
    })

    return {
      threadId,
      turns: [],
      requested,
      returned: 0,
      status: "degraded",
      error,
      latencyMs,
    }
  }
}

// ─── Feed Entry Parsing ─────────────────────────────────

function parseFeedEntry(pageId: string, props: any): HydratedTurn | null {
  try {
    const entry = props?.Entry?.title?.[0]?.plain_text ?? ""
    if (!entry) return null

    const timestamp = props?.Date?.date?.start ?? new Date().toISOString()
    const actionType = props?.["Action Type"]?.select?.name
    const pillar = props?.Pillar?.select?.name
    const intentHash = props?.["Intent Hash"]?.rich_text?.[0]?.plain_text
    const surface = props?.Surface?.select?.name

    return {
      feedId: pageId,
      entry,
      timestamp,
      actionType,
      pillar,
      intentHash,
      surface,
    }
  } catch {
    return null
  }
}
