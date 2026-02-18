/**
 * POV Library Fetcher — Slot 3 Wiring
 *
 * Queries the POV Library in Notion by Domain Coverage + Status=Active.
 * Extracts structured fields for epistemic positioning.
 *
 * SDK ID: ea3d86b7-cdb8-403e-ba03-edc410ae6498
 */

import { Client } from "@notionhq/client"
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

const POV_LIBRARY_DB_ID = "ea3d86b7-cdb8-403e-ba03-edc410ae6498"

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
 * If multiple entries match, scores by keyword overlap and returns the best.
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

  const notion = getNotionClient()
  if (!notion) return null

  try {
    // Build filter: Domain Coverage contains ANY of the mapped domains AND Status = Active
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
      console.info(`[POV] No active entries found for pillar "${pillar}"`)
      return null
    }

    // If multiple matches, score by keyword overlap
    const entries = response.results.map((page) => extractPovContent(page))
    const best = keywords.length > 0
      ? pickBestMatch(entries, keywords)
      : entries[0]

    if (best) {
      console.info(`[POV] Found entry: "${best.title}" for pillar "${pillar}"`)
    }

    return best
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
