/**
 * Atlas Shared Configuration
 *
 * Common configuration used across all Atlas components.
 */

// Machine identity for multi-node deployments
export const ATLAS_NODE = process.env.ATLAS_NODE_NAME || 'default';

/**
 * Format Atlas name with machine identity and optional source
 */
export function formatAtlasName(source?: 'telegram' | 'cli'): string {
  const base = ATLAS_NODE === 'default' ? 'Atlas' : `Atlas [${ATLAS_NODE}]`;
  if (source === 'telegram') return 'Atlas [Telegram]';
  if (source === 'cli') return 'Atlas [CLI]';
  return base;
}

// Notion DATA SOURCE IDs (from CLAUDE.md)
// CRITICAL: Use DATA SOURCE IDs, not database page IDs!
export const ATLAS_DBS = {
  // Active databases - DATA SOURCE IDs
  FEED: 'a7493abb-804a-4759-b6ac-aeca62ae23b8',
  WORK_QUEUE: '6a8d9c43-b084-47b5-bc83-bc363640f2cd',
  // NO INBOX - Telegram IS the inbox

  // Legacy (reference only - DO NOT USE)
  INBOX_DEPRECATED: 'f6f638c9-6aee-42a7-8137-df5b6a560f50',
  INBOX_1_LEGACY: 'c298b60934d248beb2c50942436b8bfe',
  MEMORY: '2eb780a78eef81fc8694e59d126fe159',
} as const;

// The Four Pillars
export const PILLARS = ['Personal', 'The Grove', 'Consulting', 'Home/Garage'] as const;
export type Pillar = typeof PILLARS[number];

// Request types for Feed entries
export const REQUEST_TYPES = [
  'Research', 'Draft', 'Build', 'Schedule',
  'Answer', 'Process', 'Quick', 'Triage', 'Chat'
] as const;
export type RequestType = typeof REQUEST_TYPES[number];

// Feed sources
export const FEED_SOURCES = [
  'Telegram', 'Notion Comment', 'Scheduled',
  'Claude Code', 'CLI', 'Legacy Inbox'
] as const;
export type FeedSource = typeof FEED_SOURCES[number];

// Feed status
export const FEED_STATUSES = ['Received', 'Processing', 'Routed', 'Done', 'Dismissed'] as const;
export type FeedStatus = typeof FEED_STATUSES[number];

// Work Queue status
export const WQ_STATUSES = ['Captured', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'] as const;
export type WQStatus = typeof WQ_STATUSES[number];
