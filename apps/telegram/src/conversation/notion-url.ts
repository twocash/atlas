/**
 * Notion URL Intelligence - Telegram Surface Adapter
 *
 * Grammy-dependent presentation layer for Notion URL interactions.
 * Handles inline keyboards, HTML formatting, and Telegram ctx.reply() calls.
 *
 * Cognitive logic (URL parsing, Notion API, page fetching) lives in:
 *   @atlas/agents/src/conversation/notion-lookup.ts
 *
 * Extracted as part of Phase 4 CPE (Cognitive Pipeline Extraction).
 */

import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Re-export cognitive layer for consumers that import from this file
// ---------------------------------------------------------------------------

export {
  isNotionUrl,
  extractPageId,
  extractRichText,
  isPageInDatabase,
  fetchWorkQueueItem,
  fetchFeedItem,
  fetchUnknownPage,
  lookupNotionPage,
  updateWorkQueueStatus,
  getPageContentForContext,
} from '@atlas/agents/src/conversation/notion-lookup';

export type {
  NotionPageType,
  NotionPageInfo,
} from '@atlas/agents/src/conversation/notion-lookup';

// Import for local use
import {
  lookupNotionPage,
  type NotionPageInfo,
} from '@atlas/agents/src/conversation/notion-lookup';

// ---------------------------------------------------------------------------
// Pending Notion Action (surface-specific state)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Callback Detection
// ---------------------------------------------------------------------------

/**
 * Check if a string is a Notion callback
 */
export function isNotionCallback(data: string | undefined): boolean {
  return data?.startsWith('notion:') ?? false;
}

// ---------------------------------------------------------------------------
// Telegram Presentation (Grammy-dependent)
// ---------------------------------------------------------------------------

/**
 * Build object-aware keyboard for a Notion page
 */
export function buildNotionKeyboard(requestId: string, pageInfo: NotionPageInfo): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  switch (pageInfo.type) {
    case 'work_queue':
      // Work Queue actions
      keyboard.text('\u25b6\ufe0f Process', `notion:${requestId}:process`);
      keyboard.text('\u2705 Mark Done', `notion:${requestId}:done`);
      keyboard.row();
      keyboard.text('\ud83d\udcdd Update', `notion:${requestId}:update`);
      keyboard.text('\ud83d\udd0d Details', `notion:${requestId}:details`);
      break;

    case 'feed':
      // Feed actions
      keyboard.text('\ud83d\udccb Create Task', `notion:${requestId}:create_task`);
      keyboard.text('\ud83d\udd0d Details', `notion:${requestId}:details`);
      break;

    case 'unknown':
      // Unknown page actions
      keyboard.text('\ud83d\udccb Track in WQ', `notion:${requestId}:track`);
      keyboard.text('\ud83d\udcdd Log to Feed', `notion:${requestId}:log`);
      keyboard.row();
      keyboard.text('\ud83d\udd0d Just Read It', `notion:${requestId}:read`);
      break;
  }

  keyboard.row();
  keyboard.text('\u274c Dismiss', `notion:${requestId}:dismiss`);

  return keyboard;
}

/**
 * Format page info as a preview message (HTML for Telegram)
 */
export function formatNotionPreview(pageInfo: NotionPageInfo): string {
  let preview = '';

  switch (pageInfo.type) {
    case 'work_queue':
      const statusIcon = {
        'Done': '\u2705',
        'Shipped': '\ud83d\ude80',
        'Active': '\ud83d\udd04',
        'Captured': '\ud83d\udce5',
        'Triaged': '\ud83d\udccb',
        'Blocked': '\ud83d\udeab',
        'Paused': '\u23f8\ufe0f',
      }[pageInfo.status || ''] || '\ud83d\udccb';

      preview = `\ud83d\udccb <b>Work Queue Item</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      preview += `${statusIcon} Status: ${pageInfo.status || 'Unknown'}\n`;
      if (pageInfo.pillar) preview += `\ud83c\udfdb\ufe0f Pillar: ${pageInfo.pillar}\n`;
      if (pageInfo.requestType) preview += `\ud83d\udcc1 Type: ${pageInfo.requestType}\n`;
      if (pageInfo.priority) preview += `\u26a1 Priority: ${pageInfo.priority}\n`;
      if (pageInfo.assignee) preview += `\ud83d\udc64 Assignee: ${pageInfo.assignee}\n`;
      if (pageInfo.notes) {
        const truncNotes = pageInfo.notes.length > 150 ? pageInfo.notes.substring(0, 147) + '...' : pageInfo.notes;
        preview += `\n\ud83d\udcdd ${truncNotes}`;
      }
      break;

    case 'feed':
      preview = `\ud83d\udcf0 <b>Feed Entry</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      if (pageInfo.pillar) preview += `\ud83c\udfdb\ufe0f Pillar: ${pageInfo.pillar}\n`;
      if (pageInfo.requestType) preview += `\ud83d\udcc1 Type: ${pageInfo.requestType}\n`;
      if (pageInfo.author) preview += `\ud83d\udc64 Author: ${pageInfo.author}\n`;
      if (pageInfo.keywords && pageInfo.keywords.length > 0) {
        preview += `\ud83c\udff7\ufe0f ${pageInfo.keywords.join(', ')}\n`;
      }
      break;

    case 'unknown':
      preview = `\ud83d\udcc4 <b>Notion Page</b>\n\n`;
      preview += `<b>${pageInfo.title}</b>\n`;
      if (pageInfo.content) {
        const truncContent = pageInfo.content.length > 200 ? pageInfo.content.substring(0, 197) + '...' : pageInfo.content;
        preview += `\n${truncContent}`;
      }
      break;
  }

  return preview;
}

// ---------------------------------------------------------------------------
// Main Telegram Handler
// ---------------------------------------------------------------------------

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
