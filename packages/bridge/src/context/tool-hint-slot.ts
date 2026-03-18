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
  const id = process.env.TOOL_ROUTING_CONFIG_DB || NOTION_DB.TOOL_ROUTING_CONFIG || undefined
  console.log(`[tool-hint] getDatabaseId: env=${process.env.TOOL_ROUTING_CONFIG_DB}, config=${NOTION_DB.TOOL_ROUTING_CONFIG}, resolved=${id}`)
  return id
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

// ─── Keyword Matching (Deterministic Layer — Free) ───────

/**
 * Match P1-suggest tools against the user's message text.
 * Pure keyword match — no LLM cost. This is the deterministic floor.
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

// ─── Haiku Classification (Ratchet Layer — Cheap) ────────

/**
 * When keywords miss, Haiku classifies intent → tool family.
 * Fractions of a cent per call. Results logged to Feed 2.0 for
 * future ratcheting down to deterministic keywords.
 *
 * The Ratchet: Haiku interprets → logs standardized form → patterns
 * compile down to keyword rules over time.
 */
async function haikuClassifyToolIntent(
  messageText: string,
  tools: ToolRoutingEntry[],
): Promise<{ matched: ToolRoutingEntry[]; classification: string } | null> {
  if (process.env.ATLAS_TOOL_HINT_HAIKU === "false") return null

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const client = new Anthropic()

    // Build tool family summary for Haiku
    const families = new Map<string, string[]>()
    for (const t of tools) {
      if (!t.active || !t.toolFamily) continue
      if (!families.has(t.toolFamily)) families.set(t.toolFamily, [])
      families.get(t.toolFamily)!.push(`${t.toolId}: ${t.description}`)
    }

    const familyList = [...families.entries()]
      .map(([family, items]) => `${family}:\n${items.join("\n")}`)
      .join("\n\n")

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `You classify user messages into tool families. Return ONLY a JSON object: {"family":"<family-name>","confidence":<0-1>,"reasoning":"<one line>"}

Available tool families:
${familyList}

If the message is asking to visit, open, go to, check, or interact with a website → "headed-browser"
If the message is asking to research, analyze, investigate a topic → "research"
If no tool family fits → {"family":"none","confidence":0,"reasoning":"no match"}`,
      messages: [{ role: "user", content: messageText }],
    })

    const text = response.content[0]?.type === "text" ? response.content[0].text : ""
    const parsed = JSON.parse(text)

    if (!parsed.family || parsed.family === "none" || parsed.confidence < 0.6) {
      console.log(`[tool-hint] Haiku: no confident match (${parsed.family}, ${parsed.confidence})`)
      return null
    }

    console.log(`[tool-hint] Haiku classified: ${parsed.family} (${parsed.confidence}) — ${parsed.reasoning}`)

    // Match tools by family
    const matched = tools.filter(
      (t) => t.active && t.toolFamily === parsed.family && t.hintTemplate,
    )

    // Log to Feed 2.0 for ratcheting (fire-and-forget)
    logHaikuClassification(messageText, parsed).catch(() => {})

    return matched.length > 0 ? { matched, classification: text } : null
  } catch (err) {
    console.warn("[tool-hint] Haiku classification failed:", (err as Error).message)
    return null
  }
}

/**
 * Log Haiku classification to Feed 2.0 for future ratcheting.
 * These logs are the training signal — when enough "check my email" → headed-browser
 * classifications accumulate, the pattern compiles down to a keyword rule.
 */
async function logHaikuClassification(
  messageText: string,
  classification: { family: string; confidence: number; reasoning: string },
): Promise<void> {
  const notion = getNotionClient()
  if (!notion) return

  const dbId = process.env.FEED_DB || "90b2b33f-4b44-4b42-870f-8d62fb8cbf18"
  const ts = new Date().toISOString()

  try {
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        Entry: { title: [{ text: { content: `Tool hint: ${classification.family} (${classification.confidence})`.slice(0, 100) } }] },
        Pillar: { select: { name: "The Grove" } },
        "Request Type": { select: { name: "Quick" } },
        Source: { select: { name: "Bridge" } },
        Author: { select: { name: "Atlas [grove-node-1]" } },
        Status: { select: { name: "Logged" } },
        Date: { date: { start: ts } },
        Keywords: {
          multi_select: [
            { name: "tool-hint" },
            { name: "haiku-classify" },
            { name: classification.family },
          ],
        },
        Notes: {
          rich_text: [{
            text: {
              content: JSON.stringify({
                message: messageText.slice(0, 200),
                family: classification.family,
                confidence: classification.confidence,
                reasoning: classification.reasoning,
                timestamp: ts,
              }, null, 2).slice(0, 2000),
            },
          }],
        },
      },
    })
  } catch {
    // Non-fatal — telemetry loss is acceptable
  }
}

// ─── Slot Assembly ───────────────────────────────────────

/**
 * Assemble the tool hint context slot (Slot 10).
 *
 * Ratchet architecture:
 * 1. Keywords first (deterministic, free) — compiled patterns
 * 2. Haiku fallback (cheap, ~0.001$) — interprets what keywords miss
 * 3. Log every Haiku classification to Feed 2.0 (training signal)
 * 4. Over time: frequent Haiku patterns → new keyword rules (ratchet down)
 *
 * @param messageText - The user's message
 */
export async function assembleToolHintSlot(
  messageText: string,
): Promise<ContextSlot> {
  console.log(`[tool-hint] assembleToolHintSlot called, enabled=${isToolHintEnabled()}, message="${messageText.slice(0, 60)}"`)
  if (!isToolHintEnabled()) {
    return createEmptySlot("tool_hint", "feature-disabled")
  }

  try {
    const tools = await loadToolRoutingConfig()
    if (tools.length === 0) {
      return createEmptySlot("tool_hint", "no-config")
    }

    // Layer 1: Deterministic keyword match (free)
    let matched = matchToolKeywords(messageText, tools)
    let source = "keyword"

    // Layer 2: Haiku classification fallback (cheap)
    if (matched.length === 0) {
      console.log(`[tool-hint] No keyword match — falling back to Haiku classification`)
      const haikuResult = await haikuClassifyToolIntent(messageText, tools)
      if (haikuResult) {
        matched = haikuResult.matched
        source = "haiku"
      }
    }

    console.log(`[tool-hint] ${tools.length} tools loaded, ${matched.length} matched (${source})`)
    if (matched.length === 0) {
      return createEmptySlot("tool_hint", "no-match")
    }

    const hintText = matched
      .filter((t) => t.hintTemplate)
      .map((t) => t.hintTemplate)
      .join("\n\n")

    if (!hintText) {
      return createEmptySlot("tool_hint", "no-hint-template")
    }

    console.log(`[tool-hint] Injecting hint (${hintText.length} chars, ${source}) for tools: ${matched.map(t => t.toolId).join(", ")}`)

    return createSlot({
      id: "tool_hint",
      source: `tool-routing-${source}-${matched.map((t) => t.toolFamily).join("+")}`,
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
