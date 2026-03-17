/**
 * Tool Hint Slot Assembly — Slot 10 Wiring
 *
 * Declarative tool routing: reads tool metadata from Notion Tool Routing Config DB,
 * matches against user message keywords, and injects pre-written hint text.
 *
 * Zero LLM cost at runtime — pure keyword match against cached DB entries.
 * Haiku drafts the initial hint text offline; Jim edits as needed.
 *
 * Priority tiers:
 *   P1-suggest: Actively hint Claude to consider this tool
 *   P2-available: Include in self-model but don't hint
 *   P3-fallback: Only use if explicitly requested
 *
 * Sprint: Relay Context Enrichment + Dynamic Tool Hints
 */

import { Client } from "@notionhq/client"
import type { ContextSlot } from "../types/orchestration"
import { createSlot, createEmptySlot } from "./slots"
import { NOTION_DB } from "@atlas/shared/config"
import { reportFailure } from "@atlas/shared/error-escalation"

// ─── Types ───────────────────────────────────────────────

export type ToolPriority = "P1-suggest" | "P2-available" | "P3-fallback"

export interface ToolRoutingEntry {
  /** Unique identifier (e.g., "atlas_headed_launch") */
  toolId: string
  /** Tool family grouping (e.g., "headed-browser") */
  toolFamily: string
  /** Human-readable description */
  description: string
  /** Routing priority tier */
  priority: ToolPriority
  /** When to suggest this tool */
  whenToUse: string
  /** Comma-separated keywords for fast matching */
  routingKeywords: string[]
  /** Pre-written hint template (injected into prompt) */
  hintTemplate: string
  /** Whether this entry is active */
  active: boolean
}

// ─── Feature Gate ────────────────────────────────────────

function isToolHintEnabled(): boolean {
  return process.env.ATLAS_TOOL_HINTS !== "false"
}

// ─── Notion Client (lazy) ────────────────────────────────

let _notionClient: Client | null = null

function getNotionClient(): Client | null {
  if (_notionClient) return _notionClient
  const key = process.env.NOTION_API_KEY
  if (!key) return null
  _notionClient = new Client({ auth: key })
  return _notionClient
}

// ─── Cache ───────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  entries: ToolRoutingEntry[]
  expiresAt: number
}

let _cache: CacheEntry | null = null

// ─── Notion Fetch ────────────────────────────────────────

/**
 * Get the Tool Routing Config database ID from environment.
 * Set via TOOL_ROUTING_CONFIG_DB in root .env.
 */
function getDatabaseId(): string | undefined {
  return process.env.TOOL_ROUTING_CONFIG_DB || NOTION_DB.TOOL_ROUTING_CONFIG || undefined
}

/**
 * Parse a Notion page into a ToolRoutingEntry.
 */
function parseNotionPage(page: any): ToolRoutingEntry | null {
  try {
    const props = page.properties

    const toolId = props["Tool ID"]?.title?.[0]?.plain_text ?? ""
    if (!toolId) return null

    const toolFamily = props["Tool Family"]?.select?.name ?? ""
    const description = props["Description"]?.rich_text?.[0]?.plain_text ?? ""
    const priority = (props["Priority"]?.select?.name ?? "P2-available") as ToolPriority
    const whenToUse = props["When To Use"]?.rich_text?.[0]?.plain_text ?? ""
    const routingKeywordsRaw = props["Routing Keywords"]?.rich_text?.[0]?.plain_text ?? ""
    const hintTemplate = props["Hint Template"]?.rich_text?.[0]?.plain_text ?? ""
    const active = props["Active"]?.checkbox ?? false

    const routingKeywords = routingKeywordsRaw
      .split(",")
      .map((kw: string) => kw.trim().toLowerCase())
      .filter((kw: string) => kw.length > 0)

    return {
      toolId,
      toolFamily,
      description,
      priority,
      whenToUse,
      routingKeywords,
      hintTemplate,
      active,
    }
  } catch (err) {
    console.warn("[tool-hint] Failed to parse Notion page:", (err as Error).message)
    return null
  }
}

/**
 * Fetch all active tool routing entries from Notion.
 * Cache → Notion → empty array fallback.
 */
async function loadToolRoutingConfig(): Promise<ToolRoutingEntry[]> {
  // Check cache
  if (_cache && _cache.expiresAt > Date.now()) {
    return _cache.entries
  }

  const dbId = getDatabaseId()
  if (!dbId) {
    return []
  }

  const notion = getNotionClient()
  if (!notion) {
    return []
  }

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        property: "Active",
        checkbox: { equals: true },
      },
    })

    const entries: ToolRoutingEntry[] = []
    for (const page of response.results) {
      const entry = parseNotionPage(page)
      if (entry) entries.push(entry)
    }

    _cache = {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    }

    return entries
  } catch (err) {
    console.warn("[tool-hint] Notion fetch failed, using empty config:", (err as Error).message)
    reportFailure("tool-hint-config", err, {
      databaseId: dbId,
      suggestedFix: "Check TOOL_ROUTING_CONFIG_DB env var and Notion connectivity.",
    })

    // Cache empty result briefly to avoid hammering Notion
    _cache = {
      entries: [],
      expiresAt: Date.now() + 60_000, // 1 min on failure
    }

    return []
  }
}

// ─── Keyword Matching ────────────────────────────────────

/**
 * Match P1-suggest tools against the user's message text.
 * Pure keyword match — no LLM cost.
 */
function matchToolKeywords(
  messageText: string,
  tools: ToolRoutingEntry[],
): ToolRoutingEntry[] {
  const msgLower = messageText.toLowerCase()
  return tools.filter(
    (t) =>
      t.priority === "P1-suggest" &&
      t.active &&
      t.routingKeywords.some((kw) => msgLower.includes(kw)),
  )
}

// ─── Slot Assembly ───────────────────────────────────────

/**
 * Assemble the tool hint context slot (Slot 10).
 *
 * Runtime flow (zero LLM cost):
 * 1. Load P1-suggest tools from Notion (cached, 5min TTL)
 * 2. Keyword match against message text
 * 3. If match: inject pre-written hint template from DB
 *
 * @param messageText - The user's message
 */
export async function assembleToolHintSlot(
  messageText: string,
): Promise<ContextSlot> {
  if (!isToolHintEnabled()) {
    return createEmptySlot("tool_hint", "feature-disabled")
  }

  try {
    const tools = await loadToolRoutingConfig()
    if (tools.length === 0) {
      return createEmptySlot("tool_hint", "no-config")
    }

    const matched = matchToolKeywords(messageText, tools)
    if (matched.length === 0) {
      return createEmptySlot("tool_hint", "no-match")
    }

    const hintText = matched.map((t) => t.hintTemplate).join("\n\n")

    return createSlot({
      id: "tool_hint",
      source: `tool-routing-${matched.map((t) => t.toolFamily).join("+")}`,
      content: hintText,
    })
  } catch (err) {
    console.warn("[tool-hint] Slot assembly failed:", (err as Error).message)
    return createEmptySlot("tool_hint", "assembly-error")
  }
}

/**
 * Invalidate the tool routing config cache.
 * Useful after adding new tools to the Notion DB.
 */
export function invalidateToolHintCache(): void {
  _cache = null
}
