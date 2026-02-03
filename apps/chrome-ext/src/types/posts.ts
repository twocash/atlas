/**
 * Post monitoring and historical tracking types
 */

export type PhantomSlot = 'primary' | null

export interface MonitoredPost {
  id: string                    // LinkedIn activity ID (extracted from URL)
  url: string                   // Full LinkedIn post URL
  title: string                 // Post title/preview (first ~80 chars)
  authorName: string            // Post author (usually "Jim Calhoun")
  publishedAt?: string          // ISO date when post was published
  addedAt: string               // ISO date when added to monitoring

  // Engagement stats (updated by PB scrapes + ETL)
  impressions: number
  reactions: number
  comments: number

  // Scrape tracking
  lastScrapedAt?: string        // ISO date of last PB scrape
  scrapeStatus: 'idle' | 'running' | 'completed' | 'failed'
  scrapeError?: string

  // PhantomBuster slot assignment
  phantomSlot: PhantomSlot      // Which PB phantom is watching this post
  pbContainerId?: string        // Container ID for tracking running scrapes
}

/**
 * PhantomBuster Configuration
 * Account: 2316148405398457
 *
 * WORKFLOW:
 *   1. Post on LinkedIn
 *   2. Paste URL in Google Sheet
 *   3. Done - Phantom runs daily, catches new comments
 *
 * Console: https://phantombuster.com/2316148405398457/phantoms/7765431788333726/console
 */
export const PB_PHANTOM_CONFIG = {
  id: '7765431788333726',
  name: 'LinkedIn Post Monitoring',
  s3Folder: 'hfcE11I3fKeElihMNTvccg',
  consoleUrl: 'https://phantombuster.com/2316148405398457/phantoms/7765431788333726/console',
  setupUrl: 'https://phantombuster.com/2316148405398457/phantoms/7765431788333726/setup',
} as const

// Legacy export for backward compatibility during migration
export const PB_PHANTOM_SLOTS = {
  A: PB_PHANTOM_CONFIG,
} as const

export interface PostsState {
  posts: MonitoredPost[]
  lastUpdated?: string
}

export const DEFAULT_POSTS_STATE: PostsState = {
  posts: [],
}

/**
 * Extract LinkedIn activity ID from various URL formats
 * Examples:
 *   - https://www.linkedin.com/posts/jimcalhoun_aiinfrastructure-activity-7421974761578336256-0P88
 *   - https://www.linkedin.com/feed/update/urn:li:activity:7421974761578336256
 */
export function extractActivityId(url: string): string | null {
  // Format 1: activity-XXXXX in path
  const activityMatch = url.match(/activity[_-](\d+)/)
  if (activityMatch) return activityMatch[1]

  // Format 2: urn:li:activity:XXXXX
  const urnMatch = url.match(/urn:li:activity:(\d+)/)
  if (urnMatch) return urnMatch[1]

  return null
}

/**
 * Normalize LinkedIn post URL to canonical form
 */
export function normalizePostUrl(url: string): string {
  // Strip UTM params and other tracking
  try {
    const parsed = new URL(url)
    parsed.search = ''
    return parsed.toString()
  } catch {
    return url
  }
}
