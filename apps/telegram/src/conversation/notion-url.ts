/**
 * Notion URL Intelligence
 *
 * Detects Notion URLs and provides object-aware handling:
 * - Work Queue items → Process, Mark Done, Update options
 * - Feed items → Create Task, Add Context options
 * - Unknown pages → Track, Log, Read options
 *
 * Auto-injects page content into conversation context.
 */

import { Client } from '@notionhq/client';
import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { logger } from '../logger';
import type { Pillar, RequestType } from './types';

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// Canonical database IDs
const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

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

/**
 * Pending Notion URL interaction
 */
export interface PendingNotionAction {
  requestId: string;
  chatId: number;
  userId: number;
  messageId?: number;
  pageInfo: NotionPageInfo;
  timestamp: number;
  confirmMessageId?: number;
}

// Store pending Notion actions (keyed by requestId)
const pendingNotionActions = new Map<string, PendingNotionAction>();

/**
 * Generate a unique request ID
 */
export function generateNotionRequestId(): string {
  return `notion_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store a pending Notion action
 */
export function storePendingNotionAction(action: PendingNotionAction): void {
  pendingNotionActions.set(action.requestId, action);

  // Clean up old entries (older than 30 minutes)
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, pending] of pendingNotionActions) {
    if (pending.timestamp < cutoff) {
      pendingNotionActions.delete(id);
    }
  }
}

/**
 * Get a pending Notion action
 */
export function getPendingNotionAction(requestId: string): PendingNotionAction | undefined {
  return pendingNotionActions.get(requestId);
}

/**
 * Remove a pending Notion action
 */
export function removePendingNotionAction(requestId: string): void {
  pendingNotionActions.delete(requestId);
}

/**
 * Check if a string is a Notion callback
 */
export function isNotionCallback(data: string | undefined): boolean {
  return data?.startsWith('notion:') ?? false;
}

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

/**
 * Check if a page belongs to a specific database
 */
async function isPageInDatabase(pageId: string, databaseId: string): Promise<boolean> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
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

/**
 * Extract text content from Notion rich text
 */
function extractRichText(richText: any[]): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

/**
 * Fetch Work Queue item details
 */
async function fetchWorkQueueItem(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = (page as any).properties;

    const title = extractRichText(props['Task']?.title || []) || 'Untitled Task';
    const status = props['Status']?.status?.name || props['Status']?.select?.name || 'Unknown';
    const pillar = props['Pillar']?.select?.name as Pillar | undefined;
    const requestType = props['Type']?.select?.name as RequestType | undefined;
    const priority = props['Priority']?.select?.name;
    const assignee = props['Assignee']?.select?.name;
    const notes = extractRichText(props['Notes']?.rich_text || []);

    // Fetch page content for context
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
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
async function fetchFeedItem(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = (page as any).properties;

    const title = extractRichText(props['Entry']?.title || []) || 'Untitled Entry';
    const pillar = props['Pillar']?.select?.name as Pillar | undefined;
    const requestType = props['Request Type']?.select?.name as RequestType | undefined;
    const author = props['Author']?.select?.name;
    const confidence = props['Confidence']?.number;
    const keywords = props['Keywords']?.multi_select?.map((k: any) => k.name) || [];

    // Fetch page content for context
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
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
async function fetchUnknownPage(pageId: string): Promise<NotionPageInfo | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
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
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
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

/**
 * Build object-aware keyboard for a Notion page
 */
export function buildNotionKeyboard(requestId: string, pageInfo: NotionPageInfo): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  switch (pageInfo.type) {
    case 'work_queue':
      // Work Queue actions
      keyboard.text('▶️ Process', `notion:${requestId}:process`);
      keyboard.text('✅ Mark Done', `notion:${requestId}:done`);
      keyboard.row();
      keyboard.text('📝 Update', `notion:${requestId}:update`);
      keyboard.text('🔍 Details', `notion:${requestId}:details`);
      break;

    case 'feed':
      // Feed actions
      keyboard.text('📋 Create Task', `notion:${requestId}:create_task`);
      keyboard.text('🔍 Details', `notion:${requestId}:details`);
      break;

    case 'unknown':
      // Unknown page actions
      keyboard.text('📋 Track in WQ', `notion:${requestId}:track`);
      keyboard.text('📝 Log to Feed', `notion:${requestId}:log`);
      keyboard.row();
      keyboard.text('🔍 Just Read It', `notion:${requestId}:read`);
      break;
  }

  keyboard.row();
  keyboard.text('❌ Dismiss', `notion:${requestId}:dismiss`);

  return keyboard;
}

/**
 * Format page info as a preview message
 */
export function formatNotionPreview(pageInfo: NotionPageInfo): string {
  let preview = '';

  switch (pageInfo.type) {
    case 'work_queue':
      const statusIcon = {
        'Done': '✅',
        'Shipped': '🚀',
        'Active': '🔄',
        'Captured': '📥',
        'Triaged': '📋',
        'Blocked': '🚫',
        'Paused': '⏸️',
      }[pageInfo.status || ''] || '📋';

      preview = `📋 <b>Work Queue Item</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      preview += `${statusIcon} Status: ${pageInfo.status || 'Unknown'}\n`;
      if (pageInfo.pillar) preview += `🏛️ Pillar: ${pageInfo.pillar}\n`;
      if (pageInfo.requestType) preview += `📁 Type: ${pageInfo.requestType}\n`;
      if (pageInfo.priority) preview += `⚡ Priority: ${pageInfo.priority}\n`;
      if (pageInfo.assignee) preview += `👤 Assignee: ${pageInfo.assignee}\n`;
      if (pageInfo.notes) {
        const truncNotes = pageInfo.notes.length > 150 ? pageInfo.notes.substring(0, 147) + '...' : pageInfo.notes;
        preview += `\n📝 ${truncNotes}`;
      }
      break;

    case 'feed':
      preview = `📰 <b>Feed Entry</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      if (pageInfo.pillar) preview += `🏛️ Pillar: ${pageInfo.pillar}\n`;
      if (pageInfo.requestType) preview += `📁 Type: ${pageInfo.requestType}\n`;
      if (pageInfo.author) preview += `👤 Author: ${pageInfo.author}\n`;
      if (pageInfo.keywords && pageInfo.keywords.length > 0) {
        preview += `🏷️ ${pageInfo.keywords.join(', ')}\n`;
      }
      break;

    case 'unknown':
      preview = `📄 <b>Notion Page</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      if (pageInfo.content) {
        const truncContent = pageInfo.content.length > 200 ? pageInfo.content.substring(0, 197) + '...' : pageInfo.content;
        preview += `\n${truncContent}`;
      }
      break;
  }

  return preview;
}

/**
 * Handle a Notion URL - show object-aware options
 *
 * Returns true if handled, false if should continue to normal processing
 */
export async function handleNotionUrl(ctx: Context, url: string): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    return false;
  }

  try {
    // Look up the page
    const pageInfo = await lookupNotionPage(url);
    if (!pageInfo) {
      // Couldn't fetch page - let it go through normal URL processing
      logger.warn('Could not look up Notion page, falling back to normal processing', { url });
      return false;
    }

    // Generate request ID and store pending action
    const requestId = generateNotionRequestId();
    const pending: PendingNotionAction = {
      requestId,
      chatId,
      userId,
      messageId: ctx.message?.message_id,
      pageInfo,
      timestamp: Date.now(),
    };
    storePendingNotionAction(pending);

    // Build preview and keyboard
    const preview = formatNotionPreview(pageInfo);
    const keyboard = buildNotionKeyboard(requestId, pageInfo);

    // Send message with options
    const confirmMsg = await ctx.reply(preview, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      reply_to_message_id: ctx.message?.message_id,
    });

    pending.confirmMessageId = confirmMsg.message_id;
    storePendingNotionAction(pending);

    logger.info('Notion URL handled with object-aware options', {
      requestId,
      pageType: pageInfo.type,
      title: pageInfo.title,
    });

    return true;
  } catch (error) {
    logger.error('Failed to handle Notion URL', { error, url });
    return false;
  }
}

/**
 * Update Work Queue item status
 */
export async function updateWorkQueueStatus(
  pageId: string,
  status: 'Done' | 'Shipped' | 'Active' | 'Captured' | 'Blocked' | 'Paused'
): Promise<boolean> {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Status': {
          status: { name: status },
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
