/**
 * Notion API client for syncing contacts and engagements
 */

import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "./storage"

const storage = new Storage({ area: "local" })

// Notion Database IDs — canonical source: @atlas/shared/config (NOTION_DB)
// Chrome extension cannot import from @atlas/shared (Node.js package)
export const NOTION_DBS = {
  CONTACTS: '08b9f73264b24e4b82d4c842f5a11cc8',
  ENGAGEMENTS: '25e138b54d1645a3a78b266451585de9',
  POSTS: '46448a0166ce42d1bdadc69cad0c7576',
  FEED: '90b2b33f-4b44-4b42-870f-8d62fb8cbf18',
  WORK_QUEUE: '3d679030-b76b-43bd-92d8-1ac51abb4a28',
  REPLY_STRATEGY_CONFIG: 'ae8f00f271aa4fe48c6432f4cd8f6e4f',
  SOCRATIC_INTERVIEW_CONFIG: '25a3f30643fd49eeb11b6f26761475bd',
} as const

const NOTION_API_BASE = 'https://api.notion.com/v1'

async function getApiKey(): Promise<string | null> {
  return storage.get<string>(STORAGE_KEYS.NOTION_KEY)
}

async function notionFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = await getApiKey()
  if (!apiKey) {
    throw new Error("Notion API key not configured")
  }

  return fetch(`${NOTION_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
      ...options.headers,
    },
  })
}

/**
 * Query a Notion database with a filter (handles pagination)
 */
export async function queryDatabase(
  dbId: string,
  filter?: Record<string, unknown>,
  options?: { sorts?: Array<Record<string, unknown>>; page_size?: number }
): Promise<NotionPage[]> {
  const allResults: NotionPage[] = []
  let hasMore = true
  let cursor: string | undefined = undefined

  while (hasMore) {
    const body: Record<string, unknown> = {}
    if (filter) body.filter = filter
    if (cursor) body.start_cursor = cursor
    if (options?.sorts) body.sorts = options.sorts
    if (options?.page_size) body.page_size = options.page_size

    const resp = await notionFetch(`/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Notion query failed: ${resp.status} - ${text.slice(0, 200)}`)
    }

    const data = await resp.json()
    allResults.push(...(data.results as NotionPage[]))
    hasMore = data.has_more
    cursor = data.next_cursor
  }

  return allResults
}

/**
 * Create a page in a Notion database
 */
export async function createPage(
  dbId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  const resp = await notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Notion create failed: ${resp.status} - ${text.slice(0, 200)}`)
  }

  return resp.json()
}

/**
 * Update a Notion page
 */
export async function updatePage(
  pageId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  const resp = await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Notion update failed: ${resp.status} - ${text.slice(0, 200)}`)
  }

  return resp.json()
}

/**
 * Find a contact by memberId (stored in Notes as "PB:XXXXX")
 */
export async function findContactByMemberId(memberId: string): Promise<NotionPage | null> {
  const results = await queryDatabase(NOTION_DBS.CONTACTS, {
    property: 'Notes',
    rich_text: { starts_with: `PB:${memberId}` },
  })
  return results[0] || null
}

// Cache for URL lookups (reduce API calls)
const contactUrlCache = new Map<string, NotionPage | null>()
let cachePrefetched = false

/**
 * Prefetch all contacts and build URL cache (call once before sync)
 */
export async function prefetchContactCache(): Promise<void> {
  if (cachePrefetched) return

  console.log('[Notion] Prefetching all contacts for cache...')
  try {
    // Query without filter to get all contacts
    const allContacts = await queryDatabase(NOTION_DBS.CONTACTS)
    console.log(`[Notion] Cached ${allContacts.length} contacts`)

    for (const contact of allContacts) {
      const contactUrl = contact.properties?.['LinkedIn URL']?.url || ''
      if (!contactUrl) continue

      // Normalize and cache
      const normalized = contactUrl
        .toLowerCase()
        .replace('http://', 'https://')
        .replace('https://www.linkedin.com', 'https://linkedin.com')
        .replace(/\/$/, '')

      contactUrlCache.set(normalized, contact)
    }

    cachePrefetched = true
  } catch (e) {
    console.error('[Notion] Failed to prefetch cache:', e)
  }
}

/**
 * Clear the contact cache (call after sync completes or on errors)
 */
export function clearContactCache(): void {
  contactUrlCache.clear()
  cachePrefetched = false
}

/**
 * Find a contact by LinkedIn URL (with normalization and caching)
 */
export async function findContactByLinkedInUrl(url: string): Promise<NotionPage | null> {
  // Normalize input
  const normalized = url
    .toLowerCase()
    .replace('http://', 'https://')
    .replace('https://www.linkedin.com', 'https://linkedin.com')
    .replace(/\/$/, '')

  // Check cache (should be prefetched)
  if (contactUrlCache.has(normalized)) {
    return contactUrlCache.get(normalized)!
  }

  // If not prefetched, do it now
  if (!cachePrefetched) {
    await prefetchContactCache()
    return contactUrlCache.get(normalized) || null
  }

  return null
}

/**
 * Find a post by LinkedIn URL
 */
export async function findPostByUrl(url: string): Promise<NotionPage | null> {
  const results = await queryDatabase(NOTION_DBS.POSTS, {
    property: 'LinkedIn URL',
    url: { equals: url },
  })
  return results[0] || null
}

/**
 * Get engagements that need replies
 */
export async function getEngagementsNeedingReply(): Promise<NotionPage[]> {
  return queryDatabase(NOTION_DBS.ENGAGEMENTS, {
    property: 'Response Status',
    select: { equals: 'Needs Reply' },
  })
}

/**
 * Get engagements for a specific post that have been handled (Posted or No Reply Needed).
 * Used by Layer 2 (Gate 1.5) Notion reconciliation to avoid re-tagging
 * comments that Jim already replied to in a previous session.
 *
 * Returns pages with Contact relation and Response Status for building
 * a reconciliation lookup map.
 */
export async function getEngagementsByPost(postPageId: string): Promise<NotionPage[]> {
  return queryDatabase(NOTION_DBS.ENGAGEMENTS, {
    and: [
      { property: 'Post', relation: { contains: postPageId } },
      {
        or: [
          { property: 'Response Status', select: { equals: 'Posted' } },
          { property: 'Response Status', select: { equals: 'No Reply Needed' } },
        ],
      },
    ],
  })
}

/**
 * Check if an engagement already exists for a contact + post combination
 */
export async function findEngagement(
  contactPageId: string,
  postPageId: string,
  engType: 'comment' | 'like'
): Promise<NotionPage | null> {
  const typeFilter = engType === 'comment' ? 'Commented on Our Post' : 'Liked'

  const results = await queryDatabase(NOTION_DBS.ENGAGEMENTS, {
    and: [
      { property: 'Contact', relation: { contains: contactPageId } },
      { property: 'Post', relation: { contains: postPageId } },
      { property: 'Type', select: { equals: typeFilter } },
    ],
  })
  return results[0] || null
}

/**
 * Check if API key is configured
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey()
  return !!key && key.length > 10
}

// --- Notion Property Helpers ---

export function richText(content: string): { rich_text: Array<{ text: { content: string } }> } {
  return { rich_text: [{ text: { content: content.slice(0, 2000) } }] }
}

export function title(content: string): { title: Array<{ text: { content: string } }> } {
  return { title: [{ text: { content: content.slice(0, 2000) } }] }
}

export function select(name: string): { select: { name: string } } {
  return { select: { name } }
}

export function multiSelect(names: string[]): { multi_select: Array<{ name: string }> } {
  return { multi_select: names.map((name) => ({ name })) }
}

export function url(value: string): { url: string } {
  return { url: value }
}

export function date(isoDate: string): { date: { start: string } } {
  return { date: { start: isoDate.slice(0, 10) } }
}

export function relation(pageIds: string[]): { relation: Array<{ id: string }> } {
  return { relation: pageIds.map((id) => ({ id })) }
}

export function number(value: number): { number: number } {
  return { number: value }
}

export function checkbox(value: boolean): { checkbox: boolean } {
  return { checkbox: value }
}

// --- Block Content (Page Body) ---

/**
 * Fetch child blocks of a Notion page (page body content).
 * Returns flat array of block objects. Handles pagination.
 */
export async function getPageBlocks(pageId: string): Promise<any[]> {
  const allBlocks: any[] = []
  let cursor: string | undefined

  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (cursor) params.set('start_cursor', cursor)

    const resp = await notionFetch(`/blocks/${pageId}/children?${params}`)
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Notion blocks fetch failed: ${resp.status} - ${text.slice(0, 200)}`)
    }

    const data = await resp.json()
    allBlocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)

  return allBlocks
}

/**
 * Convert Notion blocks to plain text (preserving structure for LLM consumption).
 */
export function blocksToText(blocks: any[]): string {
  return blocks
    .map((block) => {
      const type = block.type as string
      const rich = block[type]?.rich_text
      const text = extractBlockText(rich)

      switch (type) {
        case 'paragraph':
          return text
        case 'heading_1':
          return `# ${text}`
        case 'heading_2':
          return `## ${text}`
        case 'heading_3':
          return `### ${text}`
        case 'bulleted_list_item':
          return `- ${text}`
        case 'numbered_list_item':
          return `1. ${text}`
        case 'quote':
          return `> ${text}`
        case 'callout':
          return `> ${text}`
        case 'code':
          return `\`\`\`\n${text}\n\`\`\``
        case 'divider':
          return '---'
        case 'toggle':
          return text
        default:
          return text
      }
    })
    .filter(Boolean)
    .join('\n')
}

function extractBlockText(richText: any[] | undefined): string {
  if (!richText || !Array.isArray(richText)) return ''
  return richText.map((t: any) => t.plain_text || t.text?.content || '').join('')
}

// --- Feed 2.0 Entry Creation ---

/**
 * Create a Feed 2.0 entry (e.g., for selector health alerts)
 */
export async function createFeedEntry(
  entryTitle: string,
  notes: string,
  type: string = "Alert"
): Promise<NotionPage> {
  return createPage(NOTION_DBS.FEED, {
    Entry: title(entryTitle),
    Type: select(type),
    Source: select("Chrome Extension"),
    Notes: richText(notes.slice(0, 2000)),
  })
}

// --- Action Feed Helpers ---

import type { ActionFeedEntry } from "~src/types/action-feed"

/**
 * Query pending Action Feed items (Pending or Snoozed)
 */
export async function queryPendingActionItems(): Promise<ActionFeedEntry[]> {
  const results = await queryDatabase(
    NOTION_DBS.FEED,
    {
      or: [
        { property: 'Action Status', select: { equals: 'Pending' } },
        { property: 'Action Status', select: { equals: 'Snoozed' } },
      ],
    },
    { sorts: [{ timestamp: 'created_time', direction: 'descending' }] }
  )
  return results.map(parseActionFeedEntry)
}

/**
 * Update Action properties on a Feed entry
 */
export async function updateFeedEntryAction(
  pageId: string,
  updates: Partial<{
    actionStatus: string
    actionData: Record<string, unknown>
    actionedAt: string
    actionedVia: string
  }>
): Promise<NotionPage> {
  const properties: Record<string, unknown> = {}

  if (updates.actionStatus) {
    properties['Action Status'] = { select: { name: updates.actionStatus } }
  }
  if (updates.actionData) {
    properties['Action Data'] = {
      rich_text: [{ text: { content: JSON.stringify(updates.actionData) } }],
    }
  }
  if (updates.actionedAt) {
    properties['Actioned At'] = { date: { start: updates.actionedAt } }
  }
  if (updates.actionedVia) {
    properties['Actioned Via'] = { select: { name: updates.actionedVia } }
  }

  return updatePage(pageId, properties)
}

function parseActionFeedEntry(page: NotionPage): ActionFeedEntry {
  const props = page.properties as Record<string, any>

  const actionDataRaw = props['Action Data']?.rich_text?.[0]?.text?.content || '{}'
  let actionData: Record<string, any> = {}
  try {
    actionData = JSON.parse(actionDataRaw)
  } catch {
    actionData = { message: 'Parse error' }
  }

  const pageId = page.id
  const cleanId = pageId.replace(/-/g, '')

  return {
    id: page.id,
    url: page.url || `https://notion.so/${cleanId}`,
    createdAt: (page as any).created_time || new Date().toISOString(),
    title: props['Entry']?.title?.[0]?.text?.content
      || props['Title']?.title?.[0]?.text?.content
      || 'Untitled',
    source: props['Source']?.select?.name || 'Unknown',
    actionStatus: props['Action Status']?.select?.name || 'Pending',
    actionType: props['Action Type']?.select?.name || 'Info',
    actionData,
    actionedAt: props['Actioned At']?.date?.start,
    actionedVia: props['Actioned Via']?.select?.name,
  }
}

// --- Types ---

export interface NotionPage {
  id: string
  properties: Record<string, unknown>
  url?: string
}

export interface NotionPropertyValue {
  type: string
  [key: string]: unknown
}
