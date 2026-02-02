/**
 * Content Router - Universal Content Analysis
 *
 * Intelligently routes URLs to the appropriate extraction method:
 * - Social media (Threads, Twitter, LinkedIn) → Browser extraction via Chrome Extension
 * - Articles/blogs → Basic fetch with readability
 * - GitHub repos → GitHub API extraction
 * - YouTube → YouTube API extraction
 * - Generic URLs → Basic fetch + OG tags
 *
 * This prevents "blind" fetching and ensures Atlas uses the Chrome Extension's
 * hydration gates for SPA-heavy social media sites.
 */

import { logger } from '../logger';

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

/**
 * Detect the content source from a URL
 * Determines which extraction strategy to use
 */
export function detectContentSource(url: string): ContentSource {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Social media - requires browser extraction with hydration gates
    if (hostname.includes('threads.net')) return 'threads';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('linkedin.com')) return 'linkedin';

    // Platforms with APIs or special handling
    if (hostname.includes('github.com')) return 'github';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';

    // Default to article extraction (readability)
    return 'article';
  } catch (error) {
    logger.warn('Failed to parse URL for content detection', { url, error });
    return 'generic';
  }
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
 * Social media ALWAYS requires browser extraction because:
 * - SPAs need hydration (content loads via JavaScript)
 * - Auth walls may block unauthenticated fetches
 * - Chrome Extension has logged-in sessions
 */
export function determineExtractionMethod(source: ContentSource): ExtractionMethod {
  // Social media requires browser extraction with hydration gates
  const browserRequired: ContentSource[] = ['threads', 'twitter', 'linkedin'];

  if (browserRequired.includes(source)) {
    return 'Browser';
  }

  // Everything else uses standard fetch
  return 'Fetch';
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
