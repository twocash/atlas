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

/**
 * Notion Database IDs — SDK format (for all code hitting api.notion.com).
 *
 * These are the canonical source of truth. Import from here instead of
 * declaring local constants. Both dashed and dashless formats work with
 * the Notion API; we standardize on dashed for readability.
 */
export const NOTION_DB = {
  FEED: '90b2b33f-4b44-4b42-870f-8d62fb8cbf18',
  WORK_QUEUE: '3d679030-b76b-43bd-92d8-1ac51abb4a28',
  DEV_PIPELINE: 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9',
  CONTACTS: '08b9f732-64b2-4e4b-82d4-c842f5a11cc8',
  ENGAGEMENTS: '25e138b5-4d16-45a3-a78b-266451585de9',
  POSTS: '46448a01-66ce-42d1-bdad-c69cad0c7576',
  REPLY_STRATEGY: 'ae8f00f2-71aa-4fe4-8c64-32f4cd8f6e4f',
  SOCRATIC_CONFIG: '25a3f306-43fd-49ee-b11b-6f26761475bd',
  SKILLS_REGISTRY: '33268058-1a19-451a-9c22-35a603b6dc26',
  TOKEN_LEDGER: 'e32b5588-daee-4a31-ad45-7bbd2c7f4398',
  WORKER_RESULTS: '671f6a0a-7574-4fb2-81f9-8424d7c4dd59',
  POV_LIBRARY: 'ea3d86b7-cdb8-403e-ba03-edc410ae6498',
  SYSTEM_PROMPTS: '2fc780a7-8eef-8196-b29b-db4a6adfdc27',
} as const;

/** Which Atlas surface uses a database */
export type DbSurface = 'telegram' | 'bridge' | 'shared';

/** How critical a database is to its surface's operation */
export type DbCriticality = 'critical' | 'enrichment';

export interface DbMeta {
  /** Human-readable label */
  label: string;
  /** Which surface(s) depend on this database */
  surfaces: DbSurface[];
  /** Critical = startup-blocking, Enrichment = degrade gracefully */
  criticality: DbCriticality;
}

/**
 * Metadata for each NOTION_DB entry — surface ownership + criticality.
 *
 * Used by the database access validator to determine startup behavior:
 *   - critical databases block startup on failure
 *   - enrichment databases log warnings + create Feed alerts
 */
export const NOTION_DB_META: Record<keyof typeof NOTION_DB, DbMeta> = {
  FEED:            { label: 'Feed 2.0',           surfaces: ['shared'],   criticality: 'critical' },
  WORK_QUEUE:      { label: 'Work Queue 2.0',     surfaces: ['shared'],   criticality: 'critical' },
  DEV_PIPELINE:    { label: 'Dev Pipeline',        surfaces: ['shared'],   criticality: 'enrichment' },
  CONTACTS:        { label: 'Contacts',            surfaces: ['bridge'],   criticality: 'enrichment' },
  ENGAGEMENTS:     { label: 'Engagements',         surfaces: ['bridge'],   criticality: 'enrichment' },
  POSTS:           { label: 'Posts',               surfaces: ['bridge'],   criticality: 'enrichment' },
  REPLY_STRATEGY:  { label: 'Reply Strategy',      surfaces: ['bridge'],   criticality: 'enrichment' },
  SOCRATIC_CONFIG: { label: 'Socratic Config',     surfaces: ['shared'],   criticality: 'enrichment' },
  SKILLS_REGISTRY: { label: 'Skills Registry',     surfaces: ['telegram'], criticality: 'enrichment' },
  TOKEN_LEDGER:    { label: 'Token Ledger',        surfaces: ['telegram'], criticality: 'enrichment' },
  WORKER_RESULTS:  { label: 'Worker Results',      surfaces: ['telegram'], criticality: 'enrichment' },
  POV_LIBRARY:     { label: 'POV Library',         surfaces: ['bridge'],   criticality: 'enrichment' },
  SYSTEM_PROMPTS:  { label: 'System Prompts',      surfaces: ['shared'],   criticality: 'critical' },
};

/**
 * Notion MCP Data Source IDs — for collection:// URLs ONLY.
 *
 * These are NOT interchangeable with SDK IDs above. MCP Data Source IDs
 * are used exclusively with the Notion MCP server's query-database-view
 * and similar tools. SDK IDs are for api.notion.com calls.
 */
export const NOTION_MCP = {
  FEED: 'a7493abb-804a-4759-b6ac-aeca62ae23b8',
  WORK_QUEUE: '6a8d9c43-b084-47b5-bc83-bc363640f2cd',
  DEV_PIPELINE: '1460539c-7002-447a-a8b7-17bba06c6559',
  SYSTEM_PROMPTS: '2fc780a7-8eef-816a-ab6a-000be58429f2',
} as const;

/** @deprecated Use NOTION_DB instead. Alias retained for backward compatibility during migration. */
export const ATLAS_DBS = {
  FEED: NOTION_DB.FEED,
  WORK_QUEUE: NOTION_DB.WORK_QUEUE,

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
