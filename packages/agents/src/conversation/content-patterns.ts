/**
 * Content Patterns - Progressive Learning for Classification
 *
 * Queries Feed 2.0 to generate smart type suggestions based on
 * pillar + content type historical patterns.
 *
 * Example: "80% of Grove images are Build tasks" enables smart pre-selection
 * when Jim shares a new image to The Grove pillar.
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';
import type { Pillar, RequestType } from './types';

// Feed 2.0 database ID (from @atlas/shared/config)
const FEED_DB_ID = NOTION_DB.FEED;

// Initialize Notion client
let notion: Client | null = null;

function getNotion(): Client {
  if (!notion) {
    notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notion;
}

/**
 * Pattern query parameters
 */
export interface PatternQuery {
  pillar: Pillar;
  contentType: 'image' | 'document' | 'url' | 'video' | 'audio';
  source?: string;  // Optional: domain or file type
}

/**
 * Pattern query result with suggestion and confidence
 */
export interface PatternResult {
  suggestedType: RequestType;
  confidence: number;  // 0-1
  sampleCount: number;
  breakdown: Record<string, number>;  // Type -> count
}

// Cache patterns in memory (refresh every 10 min)
const patternCache = new Map<string, PatternResult>();
let lastRefresh = 0;
const CACHE_TTL = 10 * 60 * 1000;  // 10 minutes

/**
 * Get pattern-based suggestion for content classification
 *
 * Queries Feed 2.0 for confirmed classifications matching the pillar + content type,
 * then returns the most common request type with confidence.
 *
 * @param query - Pillar and content type to match
 * @returns Pattern result with suggestion, or null if no patterns found
 */
export async function getPatternSuggestion(
  query: PatternQuery
): Promise<PatternResult | null> {
  const cacheKey = `${query.pillar}:${query.contentType}:${query.source || 'any'}`;

  // Check cache
  if (Date.now() - lastRefresh < CACHE_TTL && patternCache.has(cacheKey)) {
    const cached = patternCache.get(cacheKey)!;
    logger.debug('Pattern cache hit', { cacheKey, suggestion: cached.suggestedType });
    return cached;
  }

  try {
    const client = getNotion();

    // Build base filter for Feed 2.0 query
    // Only include entries where Classification Confirmed = true
    const baseFilter = {
      and: [
        { property: 'Pillar', select: { equals: query.pillar } },
        { property: 'Content Type', select: { equals: query.contentType } },
        { property: 'Classification Confirmed', checkbox: { equals: true } },
        // Add source filter if provided
        ...(query.source ? [{
          property: 'Content Source',
          rich_text: { contains: query.source },
        }] : []),
      ],
    };

    // Query Feed 2.0 for confirmed classifications
    const response = await client.databases.query({
      database_id: FEED_DB_ID,
      filter: baseFilter as Parameters<typeof client.databases.query>[0]['filter'],
      page_size: 100,  // Last 100 confirmed entries
      sorts: [
        { property: 'Date', direction: 'descending' },
      ],
    });

    // Count request types
    const breakdown: Record<string, number> = {};
    for (const page of response.results) {
      const props = (page as { properties: Record<string, unknown> }).properties;
      const typeSelect = props['Request Type'] as { select?: { name?: string } } | undefined;
      const type = typeSelect?.select?.name || 'Quick';
      breakdown[type] = (breakdown[type] || 0) + 1;
    }

    // Find most common type
    const entries = Object.entries(breakdown);
    if (entries.length === 0) {
      logger.debug('No patterns found', { query });
      return null;
    }

    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);
    const [topType, topCount] = sorted[0];

    const result: PatternResult = {
      suggestedType: topType as RequestType,
      confidence: topCount / total,
      sampleCount: total,
      breakdown,
    };

    // Cache result
    patternCache.set(cacheKey, result);
    lastRefresh = Date.now();

    logger.info('Pattern suggestion generated', {
      query,
      suggestedType: result.suggestedType,
      confidence: result.confidence.toFixed(2),
      sampleCount: result.sampleCount,
    });

    return result;
  } catch (error) {
    logger.error('Pattern query failed', { error, query });
    return null;
  }
}

/**
 * Record classification feedback for pattern learning
 *
 * This is called when user confirms content classification.
 * The data is captured in the Feed 2.0 entry itself via pattern learning fields.
 *
 * @param pillar - Selected pillar
 * @param contentType - Type of content (image, document, etc.)
 * @param source - Source domain or file type
 * @param finalType - Final request type after user confirmation
 * @param wasAdjusted - Did user change the suggestion?
 * @param originalSuggestion - What Atlas initially suggested
 */
export function recordClassificationFeedback(
  pillar: Pillar,
  contentType: string,
  source: string,
  finalType: RequestType,
  wasAdjusted: boolean,
  originalSuggestion?: RequestType
): void {
  // This data is captured in Feed 2.0 entry creation via AuditEntry fields
  // The pattern learning happens via Feed 2.0 queries (getPatternSuggestion)

  logger.info('Classification feedback recorded', {
    pillar,
    contentType,
    source,
    finalType,
    wasAdjusted,
    originalSuggestion,
  });

  // Invalidate cache for this pattern to incorporate new data
  const cacheKey = `${pillar}:${contentType}:${source}`;
  patternCache.delete(cacheKey);

  // Also invalidate the "any" source variant
  const anyKey = `${pillar}:${contentType}:any`;
  patternCache.delete(anyKey);
}

/**
 * Get all patterns for a pillar (for debugging/reporting)
 */
export async function getAllPatternsForPillar(
  pillar: Pillar
): Promise<Record<string, PatternResult>> {
  const contentTypes = ['image', 'document', 'url', 'video', 'audio'] as const;
  const results: Record<string, PatternResult> = {};

  for (const contentType of contentTypes) {
    const pattern = await getPatternSuggestion({ pillar, contentType });
    if (pattern) {
      results[contentType] = pattern;
    }
  }

  return results;
}

/**
 * Clear pattern cache (for testing or after bulk imports)
 */
export function clearPatternCache(): void {
  patternCache.clear();
  lastRefresh = 0;
  logger.info('Pattern cache cleared');
}

/**
 * Get cache statistics
 */
export function getPatternCacheStats(): {
  size: number;
  lastRefresh: Date | null;
  ttlRemaining: number;
} {
  return {
    size: patternCache.size,
    lastRefresh: lastRefresh > 0 ? new Date(lastRefresh) : null,
    ttlRemaining: Math.max(0, CACHE_TTL - (Date.now() - lastRefresh)),
  };
}
