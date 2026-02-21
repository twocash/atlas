/**
 * URL Deduplication Utility
 *
 * Prevents duplicate Feed 2.0 entries for the same URL within a time window.
 * Two layers:
 *   1. In-memory Map with TTL (fast, catches rapid resends)
 *   2. Notion query fallback (durable, catches cross-restart duplicates)
 *
 * Bug Contract: Feed 2.0 URL Deduplication Failures (Bug A + Bug B)
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';

// Feed 2.0 canonical ID (from @atlas/shared/config)
const FEED_DATABASE_ID = NOTION_DB.FEED;

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ==========================================
// URL Normalization
// ==========================================

/** Tracking parameters to strip during normalization */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid',
  'ref', 'source', 'si', 's',
  // Meta / Threads / Instagram tracking
  'xmt', 'igshid', 'ig_rid', 'ig_mid',
  // X / Twitter tracking
  't', 'ref_src', 'ref_url',
]);

/**
 * Normalize a URL for dedup comparison.
 * Strips tracking params, trailing slashes, fragments, forces lowercase host.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());

    // Lowercase host
    url.hostname = url.hostname.toLowerCase();

    // Strip tracking params
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    // Sort remaining params for stable comparison
    url.searchParams.sort();

    // Strip fragment
    url.hash = '';

    // Build normalized string, strip trailing slash from pathname
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Protocol + host + pathname + sorted query (no fragment)
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${pathname}${search ? '?' + search : ''}`;
  } catch {
    // If URL parsing fails, return trimmed lowercase original
    return raw.trim().toLowerCase();
  }
}

// ==========================================
// In-Memory Cache
// ==========================================

interface CacheEntry {
  feedId: string | null; // null means "skip registered" (user skipped this URL)
  timestamp: number;
}

/** Default TTL: 24 hours */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** In-memory URL → Feed entry cache */
const urlCache = new Map<string, CacheEntry>();

/** TTL for cache entries */
let cacheTtlMs = DEFAULT_TTL_MS;

/**
 * Set custom TTL (mainly for testing)
 */
export function setCacheTtl(ms: number): void {
  cacheTtlMs = ms;
}

/**
 * Clear the cache (mainly for testing)
 */
export function clearCache(): void {
  urlCache.clear();
}

/**
 * Evict expired entries (called periodically)
 */
function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of urlCache) {
    if (now - entry.timestamp > cacheTtlMs) {
      urlCache.delete(key);
    }
  }
}

// Evict every 5 minutes
const evictionInterval = setInterval(evictExpired, 5 * 60 * 1000);
// Don't hold the process open
if (evictionInterval.unref) evictionInterval.unref();

// ==========================================
// Public API
// ==========================================

export interface DedupCheckResult {
  isDuplicate: boolean;
  existingFeedId: string | null;
  source: 'cache' | 'notion' | 'none';
  wasSkipped: boolean;
}

/**
 * Check if a URL already has a Feed 2.0 entry.
 *
 * Layer 1: In-memory cache (instant)
 * Layer 2: Notion query (if not in cache, ~200ms)
 *
 * @param url - Raw URL to check
 * @returns Dedup result with existing Feed ID if found
 */
export async function checkUrl(url: string): Promise<DedupCheckResult> {
  const normalized = normalizeUrl(url);

  // Layer 1: In-memory cache
  const cached = urlCache.get(normalized);
  if (cached && (Date.now() - cached.timestamp < cacheTtlMs)) {
    logger.debug('URL dedup: cache hit', { url: normalized, feedId: cached.feedId });
    return {
      isDuplicate: true,
      existingFeedId: cached.feedId,
      source: 'cache',
      wasSkipped: cached.feedId === null,
    };
  }

  // Layer 2: Notion query
  try {
    const feedId = await queryFeedByUrl(normalized);
    if (feedId) {
      // Backfill cache
      urlCache.set(normalized, { feedId, timestamp: Date.now() });
      logger.debug('URL dedup: Notion hit', { url: normalized, feedId });
      return {
        isDuplicate: true,
        existingFeedId: feedId,
        source: 'notion',
        wasSkipped: false,
      };
    }
  } catch (error) {
    // Non-fatal: proceed without Notion check
    logger.warn('URL dedup: Notion query failed, proceeding without check', {
      url: normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    isDuplicate: false,
    existingFeedId: null,
    source: 'none',
    wasSkipped: false,
  };
}

/**
 * Register a URL after successful Feed entry creation.
 * Call this AFTER createAuditTrail succeeds.
 *
 * @param url - Raw URL that was just logged
 * @param feedId - The Feed 2.0 page ID that was created
 */
export function registerUrl(url: string, feedId: string): void {
  const normalized = normalizeUrl(url);
  urlCache.set(normalized, { feedId, timestamp: Date.now() });
  logger.debug('URL dedup: registered', { url: normalized, feedId });
}

/**
 * Register a URL as "skipped" (user chose to skip capture).
 * Prevents the same URL from prompting again within the TTL window.
 *
 * @param url - Raw URL that the user skipped
 */
export function registerSkip(url: string): void {
  const normalized = normalizeUrl(url);
  urlCache.set(normalized, { feedId: null, timestamp: Date.now() });
  logger.debug('URL dedup: skip registered', { url: normalized });
}

// ==========================================
// Notion Query
// ==========================================

/**
 * Query Feed 2.0 for an existing entry with matching Source URL.
 * Returns the page ID if found, null otherwise.
 */
async function queryFeedByUrl(normalizedUrl: string): Promise<string | null> {
  const response = await notion.databases.query({
    database_id: FEED_DATABASE_ID,
    filter: {
      property: 'Source URL',
      url: {
        equals: normalizedUrl,
      },
    },
    page_size: 1,
  });

  if (response.results.length > 0) {
    return response.results[0].id;
  }
  return null;
}
