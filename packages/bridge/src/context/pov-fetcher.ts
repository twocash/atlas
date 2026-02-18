/**
 * POV Library Fetcher — Slot 3 Wiring
 *
 * Queries the POV Library in Notion by Domain Coverage + Status=Active.
 * Extracts structured fields for epistemic positioning.
 */

import { Client } from "@notionhq/client"
import { NOTION_DB } from "@atlas/shared/config"
import { normalizePillar } from "./workspace-router"

// ─── Types ───────────────────────────────────────────────

export interface PovContent {
  /** POV entry title */
  title: string
  /** Core thesis statement */
  coreThesis: string
  /** Evidence standards/requirements */
  evidenceStandards: string
  /** Rhetorical patterns to employ */
  rhetoricalPatterns: string
  /** Counter-arguments that have been addressed */
  counterArguments: string
  /** Boundary conditions / limitations */
  boundaryConditions: string
  /** Domain coverage tags from Notion */
  domainCoverage: string[]
}

// ─── Configuration ───────────────────────────────────────

const POV_LIBRARY_DB_ID = NOTION_DB.POV_LIBRARY

/** Cache TTL in ms — defaults to 1 hour. POV entries change ~weekly. */
const POV_CACHE_TTL_MS = Number(process.env.POV_CACHE_TTL_MS) || 3_600_000

// ─── In-Memory Cache ────────────────────────────────────

interface CacheEntry {
  results: unknown[]
  timestamp: number
}

const povCache = new Map<string, CacheEntry>()

/** Clear the POV cache. Exported for test use. */
export function clearPovCache(): void {
  povCache.clear()
}

/**
 * Map pillar → POV Library "Domain Coverage" values.
 */
const PILLAR_POV_DOMAINS: Record<string, string[]> = {
  "the-grove": ["Grove Research", "Grove Marketing"],
  consulting: ["Consulting", "DrumWave"],
  personal: ["Cross-cutting"],
  "home-garage": [],  // No POV entries for home/garage
}

// ─── Notion Client ───────────────────────────────────────

function getNotionClient(): Client | null {
  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN
  if (!token) {
    console.warn("[POV] Notion API key not configured")
    return null
  }
  return new Client({ auth: token })
}

// ─── Fetcher ─────────────────────────────────────────────

/**
 * Fetch POV Library entries matching a triage pillar.
 * Uses an in-memory cache keyed on normalized pillar to avoid redundant Notion calls.
 * Keyword scoring happens post-cache so the same cached results serve any keyword set.
 *
 * @param pillar - Pillar string from TriageResult (e.g. "The Grove")
 * @param keywords - Keywords from triage for relevance scoring
 */
export async function fetchPovForPillar(
  pillar: string,
  keywords: string[] = [],
): Promise<PovContent | null> {
  const normalizedPillar = normalizePillar(pillar)
  const domains = PILLAR_POV_DOMAINS[normalizedPillar]

  if (!domains || domains.length === 0) {
    console.info(`[POV] No domain mapping for pillar "${pillar}" — skipping`)
    return null
  }

  // Fetch raw results (cached or fresh)
  const results = await getCachedPovResults(normalizedPillar, domains)
  if (!results || results.length === 0) {
    return null
  }

  // Score by keyword overlap (post-cache)
  const entries = results.map((page) => extractPovContent(page))
  const best = keywords.length > 0
    ? pickBestMatch(entries, keywords)
    : entries[0]

  if (best) {
    console.info(`[POV] Found entry: "${best.title}" for pillar "${pillar}"`)
  }

  return best
}

/**
 * Return cached Notion results for a pillar, or query fresh and populate cache.
 */
async function getCachedPovResults(
  normalizedPillar: string,
  domains: string[],
): Promise<unknown[] | null> {
  const cached = povCache.get(normalizedPillar)
  if (cached && (Date.now() - cached.timestamp) < POV_CACHE_TTL_MS) {
    console.info(`[POV] Cache hit for "${normalizedPillar}"`)
    return cached.results
  }

  const results = await queryPovFromNotion(domains, normalizedPillar)
  if (results) {
    povCache.set(normalizedPillar, { results, timestamp: Date.now() })
  }
  return results
}

/**
 * Query Notion POV Library for active entries matching the given domains.
 */
async function queryPovFromNotion(
  domains: string[],
  pillarLabel: string,
): Promise<unknown[] | null> {
  const notion = getNotionClient()
  if (!notion) return null

  try {
    const domainFilters = domains.map((domain) => ({
      property: "Domain Coverage",
      multi_select: { contains: domain },
    }))

    const response = await notion.databases.query({
      database_id: POV_LIBRARY_DB_ID,
      filter: {
        and: [
          {
            or: domainFilters,
          },
          {
            property: "Status",
            select: { equals: "Active" },
          },
        ],
      },
    })

    if (response.results.length === 0) {
      console.info(`[POV] No active entries found for pillar "${pillarLabel}"`)
      return null
    }

    return response.results
  } catch (err) {
    console.warn("[POV] Notion query failed:", (err as Error).message)
    return null
  }
}

// ─── Content Extraction ──────────────────────────────────

/**
 * Extract structured POV content from a Notion page object.
 */
function extractPovContent(page: unknown): PovContent {
  const props = (page as Record<string, unknown>).properties as Record<string, unknown> | undefined

  return {
    title: extractTitle(props),
    coreThesis: extractRichText(props, "Core Thesis"),
    evidenceStandards: extractRichText(props, "Evidence Standards"),
    rhetoricalPatterns: extractRichText(props, "Rhetorical Patterns"),
    counterArguments: extractRichText(props, "Counter-Arguments Addressed"),
    boundaryConditions: extractRichText(props, "Boundary Conditions"),
    domainCoverage: extractMultiSelect(props, "Domain Coverage"),
  }
}

function extractTitle(props: Record<string, unknown> | undefined): string {
  if (!props) return "Untitled"
  // Try "Name" first (common Notion default), then "Title"
  for (const key of ["Name", "Title", "name", "title"]) {
    const prop = props[key] as Record<string, unknown> | undefined
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      return (prop.title as Array<{ plain_text?: string }>)
        .map((t) => t.plain_text ?? "")
        .join("")
        || "Untitled"
    }
  }
  return "Untitled"
}

function extractRichText(
  props: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  if (!props) return ""
  const prop = props[propertyName] as Record<string, unknown> | undefined
  if (prop?.type === "rich_text" && Array.isArray(prop.rich_text)) {
    return (prop.rich_text as Array<{ plain_text?: string }>)
      .map((t) => t.plain_text ?? "")
      .join("")
  }
  return ""
}

function extractMultiSelect(
  props: Record<string, unknown> | undefined,
  propertyName: string,
): string[] {
  if (!props) return []
  const prop = props[propertyName] as Record<string, unknown> | undefined
  if (prop?.type === "multi_select" && Array.isArray(prop.multi_select)) {
    return (prop.multi_select as Array<{ name?: string }>)
      .map((opt) => opt.name ?? "")
      .filter(Boolean)
  }
  return []
}

// ─── Keyword Scoring ─────────────────────────────────────

/**
 * Pick the best POV entry by keyword overlap with triage keywords.
 */
function pickBestMatch(entries: PovContent[], keywords: string[]): PovContent | null {
  if (entries.length === 0) return null
  if (entries.length === 1) return entries[0]

  const lowerKeywords = keywords.map((k) => k.toLowerCase())

  let best = entries[0]
  let bestScore = 0

  for (const entry of entries) {
    const text = [
      entry.title,
      entry.coreThesis,
      entry.rhetoricalPatterns,
    ].join(" ").toLowerCase()

    const score = lowerKeywords.filter((kw) => text.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  return best
}
