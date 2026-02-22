/**
 * POV Library Fetcher — Research Intelligence
 *
 * Queries the POV Library in Notion for entries matching a pillar
 * and/or thesis hook. Adapts the query pattern from
 * packages/bridge/src/context/pov-fetcher.ts with thesis-hook scoring.
 *
 * Sprint: ATLAS-RESEARCH-INTEL-001
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import type { POVContext } from '../types/research-v2';

// ─── Types ──────────────────────────────────────────────

export type PovFetchStatus = 'found' | 'no_match' | 'unreachable' | 'no_domains';

export interface PovFetchResult {
  status: PovFetchStatus;
  context: POVContext | null;
  error?: string;
}

// ─── Configuration ──────────────────────────────────────

const POV_LIBRARY_DB_ID = NOTION_DB.POV_LIBRARY;

/** Cache TTL in ms — defaults to 1 hour. POV entries change ~weekly. */
const POV_CACHE_TTL_MS = Number(process.env.POV_CACHE_TTL_MS) || 3_600_000;

// ─── In-Memory Cache ────────────────────────────────────

interface CacheEntry {
  results: unknown[];
  timestamp: number;
}

const povCache = new Map<string, CacheEntry>();

/** Clear the POV cache. Exported for test use. */
export function clearPovCache(): void {
  povCache.clear();
}

// ─── Pillar → Domain Mapping ────────────────────────────

/**
 * Map normalized pillar → POV Library "Domain Coverage" values.
 * Same mapping as packages/bridge/src/context/pov-fetcher.ts.
 */
const PILLAR_POV_DOMAINS: Record<string, string[]> = {
  'the grove': ['Grove Research', 'Grove Marketing'],
  'the-grove': ['Grove Research', 'Grove Marketing'],
  consulting: ['Consulting', 'DrumWave'],
  personal: ['Cross-cutting'],
  'home/garage': [],
  'home-garage': [],
};

function normalizePillar(pillar: string): string {
  return pillar.toLowerCase().trim();
}

// ─── Notion Client ──────────────────────────────────────

function getNotionClient(): Client | null {
  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) {
    console.warn('[POV-Research] Notion API key not configured');
    return null;
  }
  return new Client({ auth: token });
}

// ─── Fetcher ────────────────────────────────────────────

/**
 * Fetch POV Library context for research prompt composition.
 *
 * Supports two matching modes:
 * 1. Pillar-based: queries by Domain Coverage tags (like bridge version)
 * 2. Thesis-hook-based: fuzzy matches thesis hook against Title + Core Thesis
 *
 * When both are provided, thesis-hook scoring picks the best match
 * from pillar-filtered results.
 *
 * @param pillar - Pillar string (e.g., "The Grove")
 * @param thesisHook - Thesis hook slug (e.g., "epistemic_capture") or raw text
 * @param keywords - Additional keywords for relevance scoring
 */
export async function fetchPOVContext(
  pillar: string,
  thesisHook?: string,
  keywords: string[] = [],
): Promise<PovFetchResult> {
  const normalized = normalizePillar(pillar);
  const domains = PILLAR_POV_DOMAINS[normalized];

  if (!domains || domains.length === 0) {
    console.info(`[POV-Research] No domain mapping for pillar "${pillar}" — skipping`);
    return { status: 'no_domains', context: null };
  }

  // Fetch raw results (cached or fresh)
  const fetchResult = await getCachedResults(normalized, domains);
  if (fetchResult.error) {
    return { status: 'unreachable', context: null, error: fetchResult.error };
  }
  if (!fetchResult.results || fetchResult.results.length === 0) {
    return { status: 'no_match', context: null };
  }

  // Extract structured content from all results
  const entries = fetchResult.results.map(extractPovContent);

  // Score and pick best match
  const best = pickBestMatch(entries, thesisHook, keywords);

  if (best) {
    console.info(`[POV-Research] Found entry: "${best.title}" for pillar "${pillar}"${thesisHook ? `, hook="${thesisHook}"` : ''}`);
  }

  return {
    status: best ? 'found' : 'no_match',
    context: best,
  };
}

// ─── Cache Layer ────────────────────────────────────────

interface FetchInternalResult {
  results: unknown[] | null;
  error?: string;
}

async function getCachedResults(
  normalizedPillar: string,
  domains: string[],
): Promise<FetchInternalResult> {
  const cached = povCache.get(normalizedPillar);
  if (cached && (Date.now() - cached.timestamp) < POV_CACHE_TTL_MS) {
    console.info(`[POV-Research] Cache hit for "${normalizedPillar}"`);
    return { results: cached.results };
  }

  const result = await queryPovFromNotion(domains, normalizedPillar);
  if (result.results) {
    povCache.set(normalizedPillar, { results: result.results, timestamp: Date.now() });
  }
  return result;
}

// ─── Notion Query ───────────────────────────────────────

async function queryPovFromNotion(
  domains: string[],
  pillarLabel: string,
): Promise<FetchInternalResult> {
  const notion = getNotionClient();
  if (!notion) return { results: null, error: 'Notion API key not configured' };

  try {
    const domainFilters = domains.map(domain => ({
      property: 'Domain Coverage',
      multi_select: { contains: domain },
    }));

    const response = await notion.databases.query({
      database_id: POV_LIBRARY_DB_ID,
      filter: {
        and: [
          { or: domainFilters },
          { property: 'Status', select: { equals: 'Active' } },
        ],
      },
    });

    if (response.results.length === 0) {
      console.info(`[POV-Research] No active entries found for pillar "${pillarLabel}"`);
      return { results: null };
    }

    return { results: response.results };
  } catch (err) {
    const message = (err as Error).message;
    console.warn('[POV-Research] Notion query failed:', message);
    return { results: null, error: message };
  }
}

// ─── Content Extraction ─────────────────────────────────

function extractPovContent(page: unknown): POVContext {
  const props = (page as Record<string, unknown>).properties as Record<string, unknown> | undefined;

  return {
    title: extractTitle(props),
    coreThesis: extractRichText(props, 'Core Thesis'),
    evidenceStandards: extractRichText(props, 'Evidence Standards'),
    rhetoricalPatterns: extractRichText(props, 'Rhetorical Patterns'),
    counterArguments: extractRichText(props, 'Counter-Arguments Addressed'),
    boundaryConditions: extractRichText(props, 'Boundary Conditions'),
    domainCoverage: extractMultiSelect(props, 'Domain Coverage'),
  };
}

function extractTitle(props: Record<string, unknown> | undefined): string {
  if (!props) return 'Untitled';
  for (const key of ['Name', 'Title', 'name', 'title']) {
    const prop = props[key] as Record<string, unknown> | undefined;
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      return (prop.title as Array<{ plain_text?: string }>)
        .map(t => t.plain_text ?? '')
        .join('')
        || 'Untitled';
    }
  }
  return 'Untitled';
}

function extractRichText(
  props: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  if (!props) return '';
  const prop = props[propertyName] as Record<string, unknown> | undefined;
  if (prop?.type === 'rich_text' && Array.isArray(prop.rich_text)) {
    return (prop.rich_text as Array<{ plain_text?: string }>)
      .map(t => t.plain_text ?? '')
      .join('');
  }
  return '';
}

function extractMultiSelect(
  props: Record<string, unknown> | undefined,
  propertyName: string,
): string[] {
  if (!props) return [];
  const prop = props[propertyName] as Record<string, unknown> | undefined;
  if (prop?.type === 'multi_select' && Array.isArray(prop.multi_select)) {
    return (prop.multi_select as Array<{ name?: string }>)
      .map(opt => opt.name ?? '')
      .filter(Boolean);
  }
  return [];
}

// ─── Scoring ────────────────────────────────────────────

/**
 * Pick the best POV entry using thesis-hook scoring + keyword overlap.
 *
 * Scoring priority:
 * 1. Thesis hook match (slug or substring match on title + core thesis)
 * 2. Keyword overlap with title + thesis text
 * 3. First entry (Notion default sort)
 */
function pickBestMatch(
  entries: POVContext[],
  thesisHook?: string,
  keywords: string[] = [],
): POVContext | null {
  if (entries.length === 0) return null;
  if (entries.length === 1 && !thesisHook) return entries[0];

  let best = entries[0];
  let bestScore = 0;

  const hookTerms = thesisHook
    ? thesisHook.replace(/_/g, ' ').toLowerCase().split(/\s+/)
    : [];
  const lowerKeywords = keywords.map(k => k.toLowerCase());

  for (const entry of entries) {
    const searchText = [
      entry.title,
      entry.coreThesis,
      entry.rhetoricalPatterns,
    ].join(' ').toLowerCase();

    let score = 0;

    // Thesis hook scoring (weighted 3x)
    for (const term of hookTerms) {
      if (searchText.includes(term)) score += 3;
    }

    // Keyword scoring (weighted 1x)
    for (const kw of lowerKeywords) {
      if (searchText.includes(kw)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
}

// Exported for testing
export { pickBestMatch, extractPovContent, normalizePillar };
