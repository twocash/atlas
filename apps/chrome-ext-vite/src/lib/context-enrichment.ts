/**
 * Context Enrichment — Gate 1.7
 *
 * Fetches Notion contact page body + engagement records,
 * truncates to budget, and packages as ContentBlock[] for
 * Bridge dispatch when cognitive router picks `claude_code`.
 *
 * Parallel fetch: contact body + engagements run concurrently.
 */

import type { ContentBlock } from "~src/types/claude-sdk"
import type {
  EnrichedContext,
  ContextBudget,
} from "~src/types/context-enrichment"
import { DEFAULT_CONTEXT_BUDGET } from "~src/types/context-enrichment"
import {
  findContactByLinkedInUrl,
  getPageBlocks,
  blocksToText,
  queryDatabase,
  NOTION_DBS,
  type NotionPage,
} from "./notion-api"

// ─── Public API ──────────────────────────────────────────

/**
 * Enrich context for a Claude Code dispatch.
 *
 * 1. Finds the Notion contact by LinkedIn URL (prefetch cache)
 * 2. Parallel-fetches: page body blocks + last 5 engagements
 * 3. Truncates to budget
 * 4. Packages as ContentBlock[]
 */
export async function enrichContext(
  linkedInUrl: string,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): Promise<EnrichedContext> {
  const start = performance.now()

  // Step 1: Find contact
  const contact = await findContactByLinkedInUrl(linkedInUrl)

  if (!contact) {
    return emptyContext(performance.now() - start)
  }

  // Step 2: Parallel fetch — page body + engagements
  const [bodyResult, engagementsResult] = await Promise.allSettled([
    fetchContactBody(contact.id, budget.contactBodyMax),
    fetchRecentEngagements(contact.id, budget.engagementMax),
  ])

  const contactBody = bodyResult.status === "fulfilled" ? bodyResult.value : ""
  const engagements = engagementsResult.status === "fulfilled" ? engagementsResult.value : ""

  // Step 3: Truncate total to budget
  const { body: trimmedBody, eng: trimmedEng } = applyTotalBudget(
    contactBody,
    engagements,
    budget.totalMax,
  )

  // Step 4: Package as ContentBlock[]
  const contextBlocks = buildContextBlocks(trimmedBody, trimmedEng)
  const totalChars = trimmedBody.length + trimmedEng.length

  return {
    contactBody: trimmedBody,
    engagements: trimmedEng,
    contextBlocks,
    contactFound: true,
    totalChars,
    fetchTimeMs: Math.round(performance.now() - start),
  }
}

// ─── Internal ────────────────────────────────────────────

function emptyContext(elapsedMs: number): EnrichedContext {
  return {
    contactBody: "",
    engagements: "",
    contextBlocks: [],
    contactFound: false,
    totalChars: 0,
    fetchTimeMs: Math.round(elapsedMs),
  }
}

/** Fetch contact page body blocks → plain text, truncated. */
async function fetchContactBody(
  contactPageId: string,
  maxChars: number,
): Promise<string> {
  const blocks = await getPageBlocks(contactPageId)
  const text = blocksToText(blocks)
  return text.slice(0, maxChars)
}

/** Fetch last 5 engagements for a contact, formatted as text. */
async function fetchRecentEngagements(
  contactPageId: string,
  maxChars: number,
): Promise<string> {
  const pages = await queryDatabase(NOTION_DBS.ENGAGEMENTS, {
    property: "Contact",
    relation: { contains: contactPageId },
  }, {
    sorts: [{ property: "Date", direction: "descending" }],
    page_size: 5,
  })

  if (pages.length === 0) return ""

  const lines = pages.map(formatEngagement).filter(Boolean)
  const text = lines.join("\n")
  return text.slice(0, maxChars)
}

/** Format a single engagement record as a concise line (~200 chars). */
function formatEngagement(page: NotionPage): string {
  const props = page.properties as Record<string, any>

  const type = props["Type"]?.select?.name || "Unknown"
  const date = props["Date"]?.date?.start || ""
  const quality = props["Engagement Quality"]?.select?.name || ""
  const content = props["Their Content"]?.rich_text?.[0]?.text?.content || ""
  const status = props["Response Status"]?.select?.name || ""

  const parts = [type]
  if (date) parts.push(date)
  if (quality) parts.push(`[${quality}]`)
  if (status) parts.push(`(${status})`)

  let line = parts.join(" | ")
  if (content) {
    // Truncate content to fit ~200 char budget per record
    const remaining = 200 - line.length - 3 // " — " separator
    if (remaining > 20) {
      const snippet = content.length > remaining
        ? content.slice(0, remaining - 1) + "\u2026"
        : content
      line += " — " + snippet
    }
  }

  return line
}

/** Apply total budget, trimming engagements first if over. */
function applyTotalBudget(
  body: string,
  eng: string,
  totalMax: number,
): { body: string; eng: string } {
  const total = body.length + eng.length
  if (total <= totalMax) return { body, eng }

  // Trim engagements first (lower priority)
  const engBudget = Math.max(0, totalMax - body.length)
  const trimmedEng = eng.slice(0, engBudget)

  if (body.length + trimmedEng.length <= totalMax) {
    return { body, eng: trimmedEng }
  }

  // Still over — trim body too
  const bodyBudget = totalMax - trimmedEng.length
  return { body: body.slice(0, Math.max(0, bodyBudget)), eng: trimmedEng }
}

/** Package enriched context as ContentBlock[] for Bridge dispatch. */
function buildContextBlocks(body: string, engagements: string): ContentBlock[] {
  const blocks: ContentBlock[] = []

  if (body) {
    blocks.push({
      type: "text",
      text: `[Contact Context]\n${body}`,
    })
  }

  if (engagements) {
    blocks.push({
      type: "text",
      text: `[Recent Engagements]\n${engagements}`,
    })
  }

  return blocks
}
