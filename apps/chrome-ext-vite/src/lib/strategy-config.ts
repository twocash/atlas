/**
 * Reply Strategy Config — Notion fetch + cache layer
 *
 * Reads strategy configuration from Reply Strategy Config database.
 * Each entry has properties (metadata) + page body (prompt content).
 * Cached in chrome.storage.local with 1hr TTL.
 */

import { Storage } from '~src/lib/chrome-storage'
import {
  queryDatabase,
  getPageBlocks,
  blocksToText,
  NOTION_DBS,
  type NotionPage,
} from './notion-api'

const storage = new Storage({ area: 'local' })

// --- Types ---

export type ConfigEntryType = 'core_voice' | 'archetype' | 'modifier' | 'rule'

export interface StrategyConfigEntry {
  id: string
  name: string
  slug: string
  type: ConfigEntryType
  active: boolean
  priority: number
  conditions: string    // IF clause for rules
  archetype: string     // THEN clause for rules (archetype slug reference)
  content: string       // Page body text
}

export interface StrategyConfig {
  coreVoice: StrategyConfigEntry | null
  archetypes: Record<string, StrategyConfigEntry>   // keyed by slug
  modifiers: Record<string, StrategyConfigEntry>    // keyed by slug
  rules: StrategyConfigEntry[]                       // sorted by priority
  fetchedAt: string
}

interface CachedConfig {
  config: StrategyConfig
  cachedAt: number
}

// --- Constants ---

const CACHE_KEY = 'reply-strategy-config'
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour

// --- Cache Operations ---

export async function getCachedConfig(): Promise<StrategyConfig | null> {
  try {
    const cached = await storage.get<CachedConfig>(CACHE_KEY)
    if (!cached) return null

    const age = Date.now() - cached.cachedAt
    if (age > CACHE_TTL_MS) return null

    return cached.config
  } catch {
    return null
  }
}

export async function isCacheStale(): Promise<boolean> {
  try {
    const cached = await storage.get<CachedConfig>(CACHE_KEY)
    if (!cached) return true
    return Date.now() - cached.cachedAt > CACHE_TTL_MS
  } catch {
    return true
  }
}

async function setCachedConfig(config: StrategyConfig): Promise<void> {
  await storage.set(CACHE_KEY, { config, cachedAt: Date.now() } as CachedConfig)
}

// --- Notion Parsing ---

function parseEntry(page: NotionPage, bodyContent: string): StrategyConfigEntry {
  const props = page.properties as Record<string, any>

  return {
    id: page.id,
    name: props['Name']?.title?.[0]?.text?.content || '',
    slug: props['Slug']?.rich_text?.[0]?.text?.content || '',
    type: (props['Type']?.select?.name || 'archetype') as ConfigEntryType,
    active: props['Active']?.checkbox ?? false,
    priority: props['Priority']?.number ?? 100,
    conditions: props['Conditions']?.rich_text?.[0]?.text?.content || '',
    archetype: props['Archetype']?.rich_text?.[0]?.text?.content || '',
    content: bodyContent,
  }
}

// --- Fetch from Notion ---

export async function fetchStrategyConfig(): Promise<StrategyConfig> {
  // 1. Query all active entries
  const pages = await queryDatabase(NOTION_DBS.REPLY_STRATEGY_CONFIG, {
    property: 'Active',
    checkbox: { equals: true },
  })

  // 2. Fetch page body for each entry (batch — not per-reply)
  const entries: StrategyConfigEntry[] = []
  for (const page of pages) {
    try {
      const blocks = await getPageBlocks(page.id)
      const content = blocksToText(blocks)
      entries.push(parseEntry(page, content))
    } catch (e) {
      console.warn(`[Strategy] Failed to fetch body for ${page.id}:`, e)
      entries.push(parseEntry(page, ''))
    }
  }

  // 3. Organize by type
  const config: StrategyConfig = {
    coreVoice: null,
    archetypes: {},
    modifiers: {},
    rules: [],
    fetchedAt: new Date().toISOString(),
  }

  for (const entry of entries) {
    switch (entry.type) {
      case 'core_voice':
        config.coreVoice = entry
        break
      case 'archetype':
        config.archetypes[entry.slug] = entry
        break
      case 'modifier':
        config.modifiers[entry.slug] = entry
        break
      case 'rule':
        config.rules.push(entry)
        break
    }
  }

  // Sort rules by priority (lower = higher precedence)
  config.rules.sort((a, b) => a.priority - b.priority)

  return config
}

/**
 * Fetch from Notion and update cache. Returns the fresh config.
 */
export async function refreshStrategyConfig(): Promise<StrategyConfig> {
  const config = await fetchStrategyConfig()
  await setCachedConfig(config)
  console.log('[Strategy] Config refreshed:', {
    archetypes: Object.keys(config.archetypes).length,
    modifiers: Object.keys(config.modifiers).length,
    rules: config.rules.length,
    hasCoreVoice: !!config.coreVoice,
  })
  return config
}

/**
 * Get strategy config: from cache if fresh, else fetch from Notion.
 * Returns null if both fail (caller should fall back to GROVE_CONTEXT).
 */
export async function getStrategyConfig(): Promise<StrategyConfig | null> {
  // Try cache first
  const cached = await getCachedConfig()
  if (cached) return cached

  // Cache miss or stale — try fresh fetch
  try {
    return await refreshStrategyConfig()
  } catch (e) {
    console.error('[Strategy] Failed to fetch config:', e)

    // Try stale cache as last resort
    try {
      const stale = await storage.get<CachedConfig>(CACHE_KEY)
      if (stale?.config) {
        console.warn('[Strategy] Using stale cache as fallback')
        return stale.config
      }
    } catch (staleErr) {
      console.error('[Strategy] Stale cache read also failed:', staleErr)
    }

    return null
  }
}
