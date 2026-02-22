/**
 * Content Sources — Notion-backed content source configuration
 *
 * ADR-001 Compliance: Reads content source detection rules from Notion
 * instead of hardcoded TypeScript constants.
 *
 * Features:
 * - 5-minute TTL cache to prevent Notion fetch on every URL
 * - Stale-cache fallback when Notion is unreachable
 * - Hardcoded FALLBACK constants as circuit breaker
 * - Feature-flagged: only active when contentSourcesNotion=true
 */

import { Client } from '@notionhq/client';
import type { ContentSource, ExtractionMethod } from '../conversation/content-router';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';

// ─── Types ────────────────────────────────────────────────

export interface ContentSourceEntry {
  name: string;
  domainPatterns: string[];
  sourceType: ContentSource;
  extractionMethod: ExtractionMethod;
  browserRequired: boolean;
  sourceDefaults: Record<string, unknown>;
  priority: number;
  active: boolean;
}

// ─── Cache ────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  entries: ContentSourceEntry[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let notionClient: Client | null = null;

// ─── Fallback Constants ───────────────────────────────────
// Preserved from original hardcoded values as circuit breaker.
// These fire when Notion is unreachable AND cache is empty.

export const FALLBACK_SOURCES: ContentSourceEntry[] = [
  {
    name: 'threads',
    domainPatterns: ['threads.net', 'threads.com'],
    sourceType: 'threads',
    extractionMethod: 'Browser',
    browserRequired: true,
    sourceDefaults: {
      targetSelector: 'article',
      waitForSelector: 'article',
      withShadowDom: true,
      waitUntil: 'networkidle2',
      noCache: true,
      timeout: 45,
      retainImages: 'none',
      returnFormat: 'text',
    },
    priority: 10,
    active: true,
  },
  {
    name: 'twitter',
    domainPatterns: ['twitter.com', 'x.com'],
    sourceType: 'twitter',
    extractionMethod: 'Browser',
    browserRequired: true,
    sourceDefaults: {
      waitForSelector: 'article',
      targetSelector: 'article',
      timeout: 20,
      noCache: true,
      retainImages: 'none',
      removeSelector: 'nav, [role="banner"], aside',
    },
    priority: 20,
    active: true,
  },
  {
    name: 'linkedin',
    domainPatterns: ['linkedin.com'],
    sourceType: 'linkedin',
    extractionMethod: 'Browser',
    browserRequired: true,
    sourceDefaults: {
      waitForSelector: 'article',
      timeout: 15,
      noCache: true,
    },
    priority: 30,
    active: true,
  },
  {
    name: 'github',
    domainPatterns: ['github.com'],
    sourceType: 'github',
    extractionMethod: 'Fetch',
    browserRequired: false,
    sourceDefaults: {},
    priority: 40,
    active: true,
  },
  {
    name: 'youtube',
    domainPatterns: ['youtube.com', 'youtu.be'],
    sourceType: 'youtube',
    extractionMethod: 'Fetch',
    browserRequired: false,
    sourceDefaults: { timeout: 10 },
    priority: 50,
    active: true,
  },
  {
    name: 'article',
    domainPatterns: [],
    sourceType: 'article',
    extractionMethod: 'Fetch',
    browserRequired: false,
    sourceDefaults: {
      removeSelector: 'nav, footer, header, .sidebar, .advertisement, .ad, #cookie-banner',
    },
    priority: 100,
    active: true,
  },
  {
    name: 'generic',
    domainPatterns: [],
    sourceType: 'generic',
    extractionMethod: 'Fetch',
    browserRequired: false,
    sourceDefaults: { removeSelector: 'nav, footer, header' },
    priority: 999,
    active: true,
  },
];

// ─── Notion Fetcher ───────────────────────────────────────

function getNotionClient(): Client {
  if (!notionClient) {
    const token = process.env.NOTION_TOKEN;
    if (!token) throw new Error('NOTION_TOKEN not set');
    notionClient = new Client({ auth: token });
  }
  return notionClient;
}

function parseRichText(property: unknown): string {
  if (!property || typeof property !== 'object') return '';
  const prop = property as Record<string, unknown>;
  if (prop.type !== 'rich_text') return '';
  const richText = prop.rich_text as Array<{ plain_text: string }>;
  return richText?.map(rt => rt.plain_text).join('') || '';
}

function parseTitle(property: unknown): string {
  if (!property || typeof property !== 'object') return '';
  const prop = property as Record<string, unknown>;
  if (prop.type !== 'title') return '';
  const title = prop.title as Array<{ plain_text: string }>;
  return title?.map(t => t.plain_text).join('') || '';
}

function parseSelect(property: unknown): string {
  if (!property || typeof property !== 'object') return '';
  const prop = property as Record<string, unknown>;
  if (prop.type !== 'select' || !prop.select) return '';
  return (prop.select as { name: string }).name || '';
}

function parseCheckbox(property: unknown): boolean {
  if (!property || typeof property !== 'object') return false;
  const prop = property as Record<string, unknown>;
  if (prop.type !== 'checkbox') return false;
  return prop.checkbox === true;
}

function parseNumber(property: unknown): number {
  if (!property || typeof property !== 'object') return 999;
  const prop = property as Record<string, unknown>;
  if (prop.type !== 'number') return 999;
  return (prop.number as number) ?? 999;
}

function parseEntry(page: Record<string, unknown>): ContentSourceEntry | null {
  try {
    const props = page.properties as Record<string, unknown>;
    if (!props) return null;

    const name = parseTitle(props['Name']);
    const sourceType = parseSelect(props['Source Type']) as ContentSource;
    const extractionMethod = parseSelect(props['Extraction Method']) as ExtractionMethod;

    if (!name || !sourceType) return null;

    // Parse domain patterns from JSON string
    const patternsRaw = parseRichText(props['Domain Patterns']);
    let domainPatterns: string[] = [];
    try {
      domainPatterns = patternsRaw ? JSON.parse(patternsRaw) : [];
    } catch {
      logger.warn('Failed to parse domain patterns', { name, patternsRaw });
    }

    // Parse source defaults from JSON string
    const defaultsRaw = parseRichText(props['Source Defaults']);
    let sourceDefaults: Record<string, unknown> = {};
    try {
      sourceDefaults = defaultsRaw ? JSON.parse(defaultsRaw) : {};
    } catch {
      logger.warn('Failed to parse source defaults', { name, defaultsRaw });
    }

    return {
      name,
      domainPatterns,
      sourceType,
      extractionMethod: extractionMethod || 'Fetch',
      browserRequired: parseCheckbox(props['Browser Required']),
      sourceDefaults,
      priority: parseNumber(props['Priority']),
      active: parseCheckbox(props['Active']),
    };
  } catch (err) {
    logger.warn('Failed to parse content source entry', { error: err });
    return null;
  }
}

async function fetchFromNotion(): Promise<ContentSourceEntry[]> {
  const client = getNotionClient();

  const response = await client.databases.query({
    database_id: NOTION_DB.CONTENT_SOURCES,
    filter: {
      property: 'Active',
      checkbox: { equals: true },
    },
    sorts: [{ property: 'Priority', direction: 'ascending' }],
  });

  const entries: ContentSourceEntry[] = [];
  for (const page of response.results) {
    const entry = parseEntry(page as Record<string, unknown>);
    if (entry) entries.push(entry);
  }

  logger.info('Content sources fetched from Notion', {
    count: entries.length,
    sources: entries.map(e => e.name),
  });

  return entries;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Get content source entries with caching.
 * Returns cached entries if within TTL, fetches from Notion otherwise.
 * Falls back to stale cache → FALLBACK constants on failure.
 */
export async function getContentSources(): Promise<ContentSourceEntry[]> {
  // Check cache freshness
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.entries;
  }

  try {
    const entries = await fetchFromNotion();
    cache = { entries, fetchedAt: Date.now() };
    return entries;
  } catch (err) {
    logger.error('Failed to fetch content sources from Notion', {
      error: err instanceof Error ? err.message : String(err),
      hasStaleCacheEntries: cache?.entries.length ?? 0,
    });

    // Stale cache fallback
    if (cache) {
      logger.warn('Using stale cache for content sources');
      return cache.entries;
    }

    // Ultimate fallback: hardcoded constants
    logger.warn('Using FALLBACK constants for content sources (no cache available)');
    return FALLBACK_SOURCES;
  }
}

/**
 * Synchronous access to cached content sources.
 * Returns current cache or FALLBACK if cache is empty.
 * Use this in hot paths where async is not possible.
 */
export function getContentSourcesSync(): ContentSourceEntry[] {
  return cache?.entries ?? FALLBACK_SOURCES;
}

/**
 * Detect content source from URL using Notion-backed patterns.
 * Matches hostname against domain patterns in priority order.
 */
export function detectContentSourceFromEntries(
  url: string,
  entries: ContentSourceEntry[],
): ContentSourceEntry | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Check domain patterns in priority order (entries are pre-sorted)
    for (const entry of entries) {
      if (!entry.active) continue;
      for (const pattern of entry.domainPatterns) {
        if (hostname.includes(pattern)) {
          return entry;
        }
      }
    }

    // No domain match — return 'article' entry (the default for unrecognized domains)
    return entries.find(e => e.sourceType === 'article' && e.active) || null;
  } catch {
    return null;
  }
}

/**
 * Get the list of SPA sources that require browser rendering.
 * Synchronous — uses cached data or fallback.
 */
export function getSpaSourcesSync(): ContentSource[] {
  const entries = getContentSourcesSync();
  return entries
    .filter(e => e.browserRequired && e.active)
    .map(e => e.sourceType);
}

/**
 * Get source defaults for a specific content source.
 * Synchronous — uses cached data or fallback.
 */
export function getSourceDefaultsSync(source: ContentSource): Record<string, unknown> {
  const entries = getContentSourcesSync();
  const entry = entries.find(e => e.sourceType === source && e.active);
  return entry?.sourceDefaults ?? {};
}

/**
 * Pre-warm the cache. Call during startup.
 */
export async function warmContentSourcesCache(): Promise<void> {
  try {
    await getContentSources();
  } catch (err) {
    logger.warn('Content sources cache warm-up failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear cache (for testing)
 */
export function clearContentSourcesCache(): void {
  cache = null;
}

/**
 * Inject entries for testing (bypasses Notion)
 */
export function injectContentSources(entries: ContentSourceEntry[]): void {
  cache = { entries, fetchedAt: Date.now() };
}
