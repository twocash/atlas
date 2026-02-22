/**
 * Content Router - Universal Content Analysis
 *
 * Browser-first: ALL URLs route through the full extraction chain:
 *   Bridge (Tier 0) → Jina Reader (Tier 2) → HTTP fetch (Tier 1 fallback)
 *
 * When contentSourcesNotion flag is ON, per-domain routing from Notion
 * Content Sources DB overrides the browser-first default for granular control.
 */

import { logger } from '../logger';
import { getFeatureFlags } from '../config/features';
import {
  getContentSourcesSync,
  detectContentSourceFromEntries,
} from '../config/content-sources';

/**
 * Content source types - determines extraction strategy
 */
export type ContentSource =
  | 'threads'
  | 'twitter'
  | 'linkedin'
  | 'github'
  | 'youtube'
  | 'article'
  | 'generic';

/**
 * Extraction methods available (Capitalized to match Notion select options)
 * - Fetch: Basic HTTP fetch + OG tags (fast, works for most articles)
 * - Browser: Chrome Extension with hydration gates (required for SPAs)
 * - Gemini: Gemini Vision for images/PDFs/videos
 */
export type ExtractionMethod = 'Fetch' | 'Browser' | 'Gemini';

/**
 * Structured content analysis result
 * This is what flows through the audit pipeline to Notion
 */
export interface ContentAnalysis {
  source: ContentSource;
  method: ExtractionMethod;

  // Extracted metadata
  title?: string;
  author?: string;
  description?: string;
  fullText?: string;

  // Social media specific
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
    retweets?: number;
  };

  // Timestamps
  publishedAt?: string;
  extractedAt: string;

  // For Progressive Learning - raw data for future re-analysis
  rawPayload?: Record<string, unknown>;
}

/**
 * Route result with extraction decision
 */
export interface RouteResult {
  source: ContentSource;
  method: ExtractionMethod;
  domain: string;
  needsBrowser: boolean;
}

// ─── Fallback Constants (ADR-001: preserved as circuit breaker) ────
// These are used when contentSourcesNotion flag is OFF or Notion is unreachable.

/** @internal Fallback domain detection — used when Notion lookup is disabled */
function detectContentSourceFallback(url: string): ContentSource {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes('threads.net') || hostname.includes('threads.com')) return 'threads';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('linkedin.com')) return 'linkedin';
    if (hostname.includes('github.com')) return 'github';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';

    return 'article';
  } catch (error) {
    logger.warn('Failed to parse URL for content detection', { url, error });
    return 'generic';
  }
}

/**
 * Detect the content source from a URL
 * Determines which extraction strategy to use.
 *
 * When contentSourcesNotion flag is enabled, matches against
 * Notion-backed domain patterns. Falls back to hardcoded constants.
 */
export function detectContentSource(url: string): ContentSource {
  if (!getFeatureFlags().contentSourcesNotion) {
    return detectContentSourceFallback(url);
  }

  const entries = getContentSourcesSync();
  const match = detectContentSourceFromEntries(url, entries);
  if (match) return match.sourceType;

  // No match in Notion entries — use fallback
  return detectContentSourceFallback(url);
}

/**
 * Extract domain from URL for filtering and pattern recognition
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove 'www.' prefix if present
    return hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Determine the best extraction method for a content source
 *
 * Default: Browser-first for ALL sources (Bridge → Jina → HTTP fallback).
 * When contentSourcesNotion flag is enabled, reads per-domain extraction
 * method from Notion Content Sources DB for granular routing.
 */
export function determineExtractionMethod(source: ContentSource): ExtractionMethod {
  if (getFeatureFlags().contentSourcesNotion) {
    const entries = getContentSourcesSync();
    const entry = entries.find(e => e.sourceType === source && e.active);
    if (entry) return entry.extractionMethod;
  }

  // Browser-first: all sources go through Bridge → Jina → HTTP fallback chain.
  // Enable contentSourcesNotion for granular per-domain routing from Notion.
  return 'Browser';
}

/**
 * Route a URL for content analysis
 * Returns the source type and recommended extraction method
 *
 * This is the main entry point - call this before any extraction
 */
export async function routeForAnalysis(url: string): Promise<RouteResult> {
  const source = detectContentSource(url);
  const method = determineExtractionMethod(source);
  const domain = extractDomain(url);
  const needsBrowser = method === 'Browser';

  logger.debug('Content routed for analysis', {
    url,
    source,
    method,
    domain,
    needsBrowser,
  });

  return {
    source,
    method,
    domain,
    needsBrowser,
  };
}

/**
 * Build a content payload for Context Injection
 * This JSON string is stored in Notion for future re-analysis
 */
export function buildContentPayload(analysis: ContentAnalysis): string {
  const payload = {
    source: analysis.source,
    method: analysis.method,
    title: analysis.title,
    author: analysis.author,
    description: analysis.description,
    engagement: analysis.engagement,
    publishedAt: analysis.publishedAt,
    extractedAt: analysis.extractedAt,
    // Truncate fullText to avoid Notion limits
    textPreview: analysis.fullText?.substring(0, 500),
  };

  return JSON.stringify(payload);
}

/**
 * Validate that a URL is well-formed and accessible
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Extract URLs from message text
 * Returns array of valid URLs found
 */
export function extractUrlsFromText(text: string): string[] {
  // Match URLs starting with http:// or https://
  const urlRegex = /https?:\/\/[^\s<>"\]]+/gi;
  const matches = text.match(urlRegex) || [];

  // Filter to only valid URLs and remove duplicates
  return [...new Set(matches.filter(isValidUrl))];
}
