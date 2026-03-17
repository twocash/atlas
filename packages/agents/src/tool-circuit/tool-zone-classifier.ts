/**
 * Tool Zone Classifier — reads zone classifications from Notion Tool Routing Config DB.
 *
 * Declarative: every zone assignment lives in Notion, not code.
 * Cached: config fetched once per config_cache_ttl_ms (default 60s).
 * Surface-agnostic: lives in packages/agents, callable from any surface.
 *
 * ADR-001: Notion governs all. ADR-005: orchestration layer, not surface.
 */

import { Client } from "@notionhq/client"
import { NOTION_DB } from "@atlas/shared/config"

// ─── Types ───────────────────────────────────────────────

export type Zone = "green" | "yellow" | "red"

export interface ToolZoneConfig {
  /** Glob pattern (e.g., "mcp__claude_ai_Gmail__*") */
  toolPattern: string
  /** Zone classification */
  zone: Zone
  /** Human-readable rationale */
  description: string
  /** Approvals before Flywheel proposes Green promotion */
  autoPromoteThreshold: number
  /** Message template for Yellow approval requests */
  approvalMessageTemplate: string
  /** Message template for Red blocks */
  blockMessageTemplate: string
  /** Per-pattern kill switch */
  enabled: boolean
}

export interface ClassifyResult {
  zone: Zone
  config: ToolZoneConfig | null
  /** True if matched a specific config row; false = default zone */
  matched: boolean
}

// ─── Cache ───────────────────────────────────────────────

interface CacheEntry {
  configs: ToolZoneConfig[]
  expiresAt: number
}

let _cache: CacheEntry | null = null
const DEFAULT_CACHE_TTL_MS = 60_000

// ─── Notion Client ──────────────────────────────────────

let _notion: Client | null = null

function getNotion(): Client | null {
  if (_notion) return _notion
  const key = process.env.NOTION_API_KEY
  if (!key) return null
  _notion = new Client({ auth: key })
  return _notion
}

// ─── Notion Fetch ───────────────────────────────────────

function getDatabaseId(): string | undefined {
  return process.env.TOOL_ROUTING_CONFIG_DB || NOTION_DB.TOOL_ROUTING_CONFIG || undefined
}

function parseConfigRow(page: any): ToolZoneConfig | null {
  try {
    const props = page.properties
    const toolPattern = props["Tool ID"]?.title?.[0]?.plain_text ?? ""
    if (!toolPattern) return null

    const zone = (props["Zone"]?.select?.name?.toLowerCase() ?? "yellow") as Zone
    const description = props["Description"]?.rich_text?.[0]?.plain_text ?? ""
    const autoPromoteThreshold = props["Auto Promote Threshold"]?.number ?? 3
    const approvalMessageTemplate = props["Approval Message Template"]?.rich_text?.[0]?.plain_text ?? ""
    const blockMessageTemplate = props["Block Message Template"]?.rich_text?.[0]?.plain_text ?? ""
    const enabled = props["Active"]?.checkbox ?? true

    return {
      toolPattern,
      zone,
      description,
      autoPromoteThreshold,
      approvalMessageTemplate,
      blockMessageTemplate,
      enabled,
    }
  } catch {
    return null
  }
}

async function loadConfigs(): Promise<ToolZoneConfig[]> {
  if (_cache && _cache.expiresAt > Date.now()) {
    return _cache.configs
  }

  const dbId = getDatabaseId()
  if (!dbId) return []

  const notion = getNotion()
  if (!notion) return []

  try {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: { property: "Active", checkbox: { equals: true } },
    })

    const configs: ToolZoneConfig[] = []
    for (const page of response.results) {
      const config = parseConfigRow(page)
      if (config) configs.push(config)
    }

    _cache = { configs, expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS }
    return configs
  } catch (err) {
    console.warn("[tool-zone] Notion fetch failed:", (err as Error).message)
    // Cache empty briefly to avoid hammering
    _cache = { configs: [], expiresAt: Date.now() + 10_000 }
    return []
  }
}

// ─── Glob Matching ──────────────────────────────────────

/** Simple glob match: supports trailing * only (e.g., "mcp__gmail__*") */
function globMatch(pattern: string, toolName: string): boolean {
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1))
  }
  return toolName === pattern
}

// ─── Classify ───────────────────────────────────────────

/**
 * Classify a tool name into a zone.
 *
 * Reads from Notion Tool Routing Config DB (cached).
 * Returns the first matching enabled config row.
 * Default: green (unclassified tools execute freely).
 */
export async function classifyTool(toolName: string): Promise<ClassifyResult> {
  const configs = await loadConfigs()

  for (const config of configs) {
    if (config.enabled && globMatch(config.toolPattern, toolName)) {
      return { zone: config.zone, config, matched: true }
    }
  }

  // Default: green (unclassified tools auto-approve)
  return { zone: "green", config: null, matched: false }
}

/** Invalidate cache (e.g., after "always" promotes a pattern). */
export function invalidateZoneCache(): void {
  _cache = null
}
