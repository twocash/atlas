/**
 * Socratic Interview Config — Notion fetch + cache layer
 *
 * Reads Socratic interview configuration from Notion database.
 * Each entry has properties (metadata) + page body (prompt/rule content).
 * In-memory cache with 5min TTL, stale-cache fallback on error.
 *
 * Pattern mirrors prompt-manager.ts but is self-contained for the
 * Socratic engine's config needs.
 */

import { Client } from '@notionhq/client';
import type {
  SocraticConfig,
  SocraticConfigEntry,
  ConfigEntryType,
  Surface,
  ContextSlot,
} from './types';

// ==========================================
// Constants
// ==========================================

/** Socratic Interview Config database ID */
const DATABASE_ID = '25a3f30643fd49eeb11b6f26761475bd';

/** Cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

// ==========================================
// Cache
// ==========================================

interface CachedConfig {
  config: SocraticConfig;
  cachedAt: number;
}

let cachedEntry: CachedConfig | null = null;

// ==========================================
// Notion Client
// ==========================================

let notionClient: Client | null = null;

function getNotionClient(): Client | null {
  if (notionClient) return notionClient;

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.warn('[SocraticConfig] NOTION_API_KEY not set');
    return null;
  }

  notionClient = new Client({ auth: apiKey });
  return notionClient;
}

// ==========================================
// Notion Parsing
// ==========================================

/**
 * Extract page body content as text from Notion blocks.
 * Same pattern as prompt-manager.ts fetchPageContent.
 */
async function fetchPageContent(notion: Client, pageId: string): Promise<string> {
  try {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    const parts: string[] = [];

    for (const block of response.results) {
      const b = block as any;
      let text = '';

      switch (b.type) {
        case 'paragraph':
          text = b.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          break;
        case 'heading_1':
          text = '# ' + (b.heading_1?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'heading_2':
          text = '## ' + (b.heading_2?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'heading_3':
          text = '### ' + (b.heading_3?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'bulleted_list_item':
          text = '- ' + (b.bulleted_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'numbered_list_item':
          text = '1. ' + (b.numbered_list_item?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'quote':
          text = '> ' + (b.quote?.rich_text?.map((t: any) => t.plain_text).join('') || '');
          break;
        case 'code': {
          const code = b.code?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          text = '```\n' + code + '\n```';
          break;
        }
        case 'callout':
          text = b.callout?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          break;
        case 'table_row': {
          const cells = b.table_row?.cells || [];
          text = '| ' + cells.map((cell: any[]) =>
            cell.map((t: any) => t.plain_text).join('')
          ).join(' | ') + ' |';
          break;
        }
        default:
          break;
      }

      if (text) {
        parts.push(text);
      }
    }

    return parts.join('\n');
  } catch (error) {
    console.error(`[SocraticConfig] Failed to fetch page body for ${pageId}:`, error);
    return '';
  }
}

/**
 * Parse a Notion page into a SocraticConfigEntry.
 */
function parseEntry(page: any, bodyContent: string): SocraticConfigEntry {
  const props = page.properties as Record<string, any>;

  // Parse multi_select arrays
  const surfaces: Surface[] = (props['Surface']?.multi_select || [])
    .map((s: any) => s.name as Surface);

  const contextSlots: ContextSlot[] = (props['Context Slots']?.multi_select || [])
    .map((s: any) => s.name as ContextSlot);

  return {
    id: page.id,
    name: props['Name']?.title?.[0]?.text?.content || '',
    slug: props['Slug']?.rich_text?.[0]?.text?.content || '',
    type: (props['Type']?.select?.name || 'interview_prompt') as ConfigEntryType,
    surfaces,
    active: props['Active']?.checkbox ?? false,
    priority: props['Priority']?.number ?? 100,
    conditions: props['Conditions']?.rich_text?.[0]?.text?.content || '',
    contextSlots,
    confidenceFloor: props['Confidence Floor']?.number ?? 0,
    skill: props['Skill']?.rich_text?.[0]?.text?.content || '',
    content: bodyContent,
  };
}

// ==========================================
// Fetch from Notion
// ==========================================

/**
 * Fetch all active entries from the Socratic Interview Config database.
 * Fetches page bodies for each entry (batch at startup, not per-request).
 */
export async function fetchSocraticConfig(): Promise<SocraticConfig> {
  const notion = getNotionClient();
  if (!notion) {
    throw new Error('[SocraticConfig] Notion client not available');
  }

  // Query all active entries
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: 'Active',
      checkbox: { equals: true },
    },
    page_size: 100,
  });

  // Fetch page body for each entry
  const entries: SocraticConfigEntry[] = [];
  for (const page of response.results) {
    try {
      const content = await fetchPageContent(notion, page.id);
      entries.push(parseEntry(page, content));
    } catch (e) {
      console.warn(`[SocraticConfig] Failed to fetch body for ${page.id}:`, e);
      entries.push(parseEntry(page, ''));
    }
  }

  // Organize by type
  const config: SocraticConfig = {
    interviewPrompts: {},
    contextRules: [],
    answerMaps: {},
    thresholds: [],
    fetchedAt: new Date().toISOString(),
  };

  for (const entry of entries) {
    switch (entry.type) {
      case 'interview_prompt':
        config.interviewPrompts[entry.slug] = entry;
        break;
      case 'context_rule':
        config.contextRules.push(entry);
        break;
      case 'answer_map':
        config.answerMaps[entry.slug] = entry;
        break;
      case 'threshold':
        config.thresholds.push(entry);
        break;
    }
  }

  // Sort rules and thresholds by priority (lower = higher precedence)
  config.contextRules.sort((a, b) => a.priority - b.priority);
  config.thresholds.sort((a, b) => a.priority - b.priority);

  return config;
}

// ==========================================
// Cache Operations
// ==========================================

/**
 * Get cached config if fresh (within TTL).
 */
export function getCachedConfig(): SocraticConfig | null {
  if (!cachedEntry) return null;

  const age = Date.now() - cachedEntry.cachedAt;
  if (age > CACHE_TTL_MS) return null;

  return cachedEntry.config;
}

/**
 * Fetch from Notion and update cache. Returns the fresh config.
 */
export async function refreshSocraticConfig(): Promise<SocraticConfig> {
  const config = await fetchSocraticConfig();
  cachedEntry = { config, cachedAt: Date.now() };

  console.log('[SocraticConfig] Config refreshed:', {
    interviewPrompts: Object.keys(config.interviewPrompts).length,
    contextRules: config.contextRules.length,
    answerMaps: Object.keys(config.answerMaps).length,
    thresholds: config.thresholds.length,
  });

  return config;
}

/**
 * Get config: from cache if fresh, else fetch from Notion.
 * Falls back to stale cache on Notion error. Returns null if everything fails.
 */
export async function getSocraticConfig(): Promise<SocraticConfig | null> {
  // Try cache first
  const cached = getCachedConfig();
  if (cached) return cached;

  // Cache miss or stale — try fresh fetch
  try {
    return await refreshSocraticConfig();
  } catch (e) {
    console.error('[SocraticConfig] Failed to fetch config:', e);

    // Try stale cache as last resort
    if (cachedEntry?.config) {
      console.warn('[SocraticConfig] Using stale cache as fallback');
      return cachedEntry.config;
    }

    return null;
  }
}

/**
 * Invalidate the cache (for testing or forced refresh).
 */
export function invalidateCache(): void {
  cachedEntry = null;
}

/**
 * Inject a config directly (for testing).
 */
export function injectConfig(config: SocraticConfig): void {
  cachedEntry = { config, cachedAt: Date.now() };
}
