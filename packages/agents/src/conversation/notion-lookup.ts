/**
 * Notion URL Intelligence - Cognitive Layer
 *
 * Pure Notion API logic for detecting, parsing, and fetching Notion pages.
 * No Grammy or Telegram dependencies - this is the cognitive core.
 *
 * Extracted from apps/telegram/src/conversation/notion-url.ts (Phase 4 CPE).
 *
 * Detects Notion URLs and provides object-aware handling:
 * - Work Queue items: status, pillar, priority, assignee, notes
 * - Feed items: pillar, type, author, confidence, keywords
 * - Unknown pages: title, content blocks
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Locally-defined Pillar to avoid coupling to Telegram types */
type Pillar = 'Personal' | 'The Grove' | 'Consulting' | 'Home/Garage';

/** Generic request type - used loosely across surfaces */
type RequestType = string;

/**
 * Types of Notion pages we recognize
 */
export type NotionPageType = 'work_queue' | 'feed' | 'unknown';

/**
 * Structured info about a Notion page
 */
export interface NotionPageInfo {
  pageId: string;
  type: NotionPageType;
  title: string;
  url: string;

  // Work Queue specific
  status?: string;
  pillar?: Pillar;
  requestType?: RequestType;
  priority?: string;
  assignee?: string;
  notes?: string;

  // Feed specific
  author?: string;
  confidence?: number;
  keywords?: string[];

  // Raw content for context injection
  content?: string;
}

// ---------------------------------------------------------------------------
// Notion Client (lazy singleton)
// ---------------------------------------------------------------------------

let notionClient: Client | null = null;

function getNotion(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

// Canonical IDs from @atlas/shared/config
const FEED_DATABASE_ID = NOTION_DB.FEED;
const WORK_QUEUE_DATABASE_ID = NOTION_DB.WORK_QUEUE;

// ---------------------------------------------------------------------------
// URL Detection & Parsing
// ---------------------------------------------------------------------------

/**
 * Detect if a URL is a Notion URL
 */
export function isNotionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('notion.so') || parsed.hostname.includes('notion.site');
  } catch {
    return false;
  }
}

/**
 * Extract page ID from a Notion URL
 *
 * Handles formats:
 * - notion.so/Page-Title-abc123def456
 * - notion.so/abc123def456
 * - notion.so/workspace/Page-Title-abc123def456
 */
export function extractPageId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Extract the last segment which contains the page ID
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const lastSegment = segments[segments.length - 1];

    // Page ID is the last 32 characters (without dashes) or after the last dash
    // Format: "Page-Title-abc123def456789012345678901234"
    const match = lastSegment.match(/([a-f0-9]{32})$/i);
    if (match) {
      // Format as UUID with dashes
      const id = match[1];
      return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    }

    // Try to find UUID format directly
    const uuidMatch = lastSegment.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuidMatch) {
      return uuidMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rich Text Extraction
// ---------------------------------------------------------------------------

/**
 * Extract text content from Notion rich text
 */
export function extractRichText(richText: any[]): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

// ---------------------------------------------------------------------------
// Database Membership Check
// ---------------------------------------------------------------------------

/**
 * Check if a page belongs to a specific database
 */
export async function isPageInDatabase(pageId: string, databaseId: string): Promise<boolean> {
  try {
    const page = await getNotion().pages.retrieve({ page_id: pageId });
    const parent = (page as any).parent;
    if (parent?.type === 'database_id') {
      // Normalize both IDs (remove dashes) for comparison
      const pageDbId = parent.database_id.replace(/-/g, '');
      const targetDbId = databaseId.replace(/-/g, '');
      return pageDbId === targetDbId;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fetch Functions
// ---------------------------------------------------------------------------

/**
 * Fetch Work Queue item details
 */
export async function fetchWorkQueueItem(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await getNotion().pages.retrieve({ page_id: pageId });
    const props = (page as any).properties;

    const title = extractRichText(props['Task']?.title || []) || 'Untitled Task';
    const status = props['Status']?.status?.name || props['Status']?.select?.name || 'Unknown';
    const pillar = props['Pillar']?.select?.name as Pillar | undefined;
    const requestType = props['Type']?.select?.name as RequestType | undefined;
    const priority = props['Priority']?.select?.name;
    const assignee = props['Assignee']?.select?.name;
    const notes = extractRichText(props['Notes']?.rich_text || []);

    // Fetch page content for context
    const blocks = await getNotion().blocks.children.list({ block_id: pageId, page_size: 50 });
    const content = blocks.results
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return extractRichText(block.paragraph?.rich_text || []);
        }
        if (block.type === 'bulleted_list_item') {
          return '• ' + extractRichText(block.bulleted_list_item?.rich_text || []);
        }
        if (block.type === 'numbered_list_item') {
          return '- ' + extractRichText(block.numbered_list_item?.rich_text || []);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    return {
      pageId,
      type: 'work_queue',
      title,
      url: (page as any).url,
      status,
      pillar,
      requestType,
      priority,
      assignee,
      notes,
      content: content || notes,
    };
  } catch (error) {
    logger.error('Failed to fetch Work Queue item', { error, pageId });
    return null;
  }
}

/**
 * Fetch Feed item details
 */
export async function fetchFeedItem(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await getNotion().pages.retrieve({ page_id: pageId });
    const props = (page as any).properties;

    const title = extractRichText(props['Entry']?.title || []) || 'Untitled Entry';
    const pillar = props['Pillar']?.select?.name as Pillar | undefined;
    const requestType = props['Request Type']?.select?.name as RequestType | undefined;
    const author = props['Author']?.select?.name;
    const confidence = props['Confidence']?.number;
    const keywords = props['Keywords']?.multi_select?.map((k: any) => k.name) || [];

    // Fetch page content for context
    const blocks = await getNotion().blocks.children.list({ block_id: pageId, page_size: 50 });
    const content = blocks.results
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return extractRichText(block.paragraph?.rich_text || []);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    return {
      pageId,
      type: 'feed',
      title,
      url: (page as any).url,
      pillar,
      requestType,
      author,
      confidence,
      keywords,
      content,
    };
  } catch (error) {
    logger.error('Failed to fetch Feed item', { error, pageId });
    return null;
  }
}

/**
 * Fetch unknown Notion page details
 */
export async function fetchUnknownPage(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await getNotion().pages.retrieve({ page_id: pageId });
    const props = (page as any).properties;

    // Try to find a title property
    let title = 'Untitled';
    for (const [, value] of Object.entries(props)) {
      if ((value as any).type === 'title') {
        title = extractRichText((value as any).title || []) || 'Untitled';
        break;
      }
    }

    // Fetch page content
    const blocks = await getNotion().blocks.children.list({ block_id: pageId, page_size: 50 });
    const content = blocks.results
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return extractRichText(block.paragraph?.rich_text || []);
        }
        if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
          const headingType = block.type as 'heading_1' | 'heading_2' | 'heading_3';
          return '## ' + extractRichText(block[headingType]?.rich_text || []);
        }
        if (block.type === 'bulleted_list_item') {
          return '• ' + extractRichText(block.bulleted_list_item?.rich_text || []);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    return {
      pageId,
      type: 'unknown',
      title,
      url: (page as any).url,
      content,
    };
  } catch (error) {
    logger.error('Failed to fetch Notion page', { error, pageId });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main Lookup Dispatcher
// ---------------------------------------------------------------------------

/**
 * Look up a Notion page and determine its type
 */
export async function lookupNotionPage(url: string): Promise<NotionPageInfo | null> {
  const pageId = extractPageId(url);
  if (!pageId) {
    logger.warn('Could not extract page ID from Notion URL', { url });
    return null;
  }

  logger.debug('Looking up Notion page', { pageId, url });

  // Check Work Queue first (most common use case)
  if (await isPageInDatabase(pageId, WORK_QUEUE_DATABASE_ID)) {
    logger.info('Notion URL is a Work Queue item', { pageId });
    return fetchWorkQueueItem(pageId);
  }

  // Check Feed
  if (await isPageInDatabase(pageId, FEED_DATABASE_ID)) {
    logger.info('Notion URL is a Feed item', { pageId });
    return fetchFeedItem(pageId);
  }

  // Unknown page - still fetch it
  logger.info('Notion URL is an unknown page', { pageId });
  return fetchUnknownPage(pageId);
}

// ---------------------------------------------------------------------------
// Status Update
// ---------------------------------------------------------------------------

/**
 * Update Work Queue item status
 */
export async function updateWorkQueueStatus(
  pageId: string,
  status: 'Done' | 'Shipped' | 'Active' | 'Captured' | 'Blocked' | 'Paused'
): Promise<boolean> {
  try {
    await getNotion().pages.update({
      page_id: pageId,
      properties: {
        'Status': {
          select: { name: status },
        },
      },
    });
    logger.info('Updated Work Queue status', { pageId, status });
    return true;
  } catch (error) {
    logger.error('Failed to update Work Queue status', { error, pageId, status });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

/**
 * Get page content for context injection
 */
export function getPageContentForContext(pageInfo: NotionPageInfo): string {
  let context = `[Notion ${pageInfo.type === 'work_queue' ? 'Work Queue Item' : pageInfo.type === 'feed' ? 'Feed Entry' : 'Page'}]\n`;
  context += `Title: ${pageInfo.title}\n`;

  if (pageInfo.type === 'work_queue') {
    context += `Status: ${pageInfo.status || 'Unknown'}\n`;
    if (pageInfo.pillar) context += `Pillar: ${pageInfo.pillar}\n`;
    if (pageInfo.requestType) context += `Type: ${pageInfo.requestType}\n`;
    if (pageInfo.priority) context += `Priority: ${pageInfo.priority}\n`;
  }

  if (pageInfo.content) {
    context += `\nContent:\n${pageInfo.content}`;
  }

  return context;
}
