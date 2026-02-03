/**
 * Notion URL Callback Handler
 *
 * Handles keyboard actions for Notion pages:
 * - Work Queue: Process, Mark Done, Update
 * - Feed: Create Task, Details
 * - Unknown: Track, Log, Read
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  getPendingNotionAction,
  removePendingNotionAction,
  updateWorkQueueStatus,
  getPageContentForContext,
  formatNotionPreview,
  type NotionPageInfo,
} from '../conversation/notion-url';
import { createAuditTrail, type AuditEntry } from '../conversation/audit';
import { addToConversationContext } from '../conversation/context-manager';
import { safeAnswerCallback, safeAcknowledgeCallback } from '../utils/telegram-helpers';

/**
 * Handle Notion callback queries
 */
export async function handleNotionCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('notion:')) return;

  const parts = data.split(':');
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: 'Invalid action' });
    return;
  }

  const [, requestId, action] = parts;

  const pending = getPendingNotionAction(requestId);
  if (!pending) {
    await safeAnswerCallback(ctx, 'Request expired. Please share the link again.', {
      fallbackMessage: '⏱️ That request expired. Please share the link again.'
    });
    return;
  }

  // Acknowledge the callback
  await safeAcknowledgeCallback(ctx);

  const { pageInfo } = pending;

  logger.info('Handling Notion callback', { requestId, action, pageType: pageInfo.type });

  try {
    switch (action) {
      // ========================================
      // Work Queue Actions
      // ========================================
      case 'process':
        await handleProcess(ctx, pending);
        break;

      case 'done':
        await handleMarkDone(ctx, pending);
        break;

      case 'update':
        await handleUpdate(ctx, pending);
        break;

      // ========================================
      // Feed Actions
      // ========================================
      case 'create_task':
        await handleCreateTask(ctx, pending);
        break;

      // ========================================
      // Unknown Page Actions
      // ========================================
      case 'track':
        await handleTrackInWQ(ctx, pending);
        break;

      case 'log':
        await handleLogToFeed(ctx, pending);
        break;

      case 'read':
        await handleJustRead(ctx, pending);
        break;

      // ========================================
      // Common Actions
      // ========================================
      case 'details':
        await handleShowDetails(ctx, pending);
        break;

      case 'dismiss':
        await handleDismiss(ctx, pending);
        break;

      default:
        await ctx.reply('Unknown action');
    }
  } catch (error) {
    logger.error('Error handling Notion callback', { error, action, requestId });
    await ctx.reply('Error processing action. Please try again.');
  }
}

/**
 * Process a Work Queue item - dispatch agent to work on it
 */
async function handleProcess(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  // Update status to Active
  await updateWorkQueueStatus(pageInfo.pageId, 'Active');

  // Inject context for agent
  const contextContent = getPageContentForContext(pageInfo);
  const userId = ctx.from?.id;
  if (userId) {
    addToConversationContext(userId, {
      role: 'system',
      content: `[TASK CONTEXT]\nProcessing Work Queue item:\n${contextContent}`,
    });
  }

  // Update the message
  await ctx.editMessageText(
    `🔄 <b>Processing...</b>\n\n` +
    `<b>${pageInfo.title}</b>\n` +
    `Status: Active\n\n` +
    `Task context has been loaded. You can now give instructions for this task, or I'll work on it based on its type (${pageInfo.requestType || 'Unknown'}).`,
    { parse_mode: 'HTML' }
  );

  // If it's a Research task, we could auto-dispatch an agent
  // For now, we inject context and let the user guide next steps
  if (pageInfo.requestType === 'Research') {
    await ctx.reply(
      `📚 This is a <b>Research</b> task. I can:\n` +
      `• Research the topic and summarize findings\n` +
      `• Create a document with analysis\n` +
      `• Find relevant sources\n\n` +
      `What would you like me to focus on?`,
      { parse_mode: 'HTML' }
    );
  } else if (pageInfo.requestType === 'Build') {
    await ctx.reply(
      `🔧 This is a <b>Build</b> task. I can:\n` +
      `• Write code based on the requirements\n` +
      `• Fix bugs described in the task\n` +
      `• Create tests\n\n` +
      `What's the priority?`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(pending.requestId);
  logger.info('Work Queue item set to Active and context injected', { pageId: pageInfo.pageId });
}

/**
 * Mark a Work Queue item as Done
 */
async function handleMarkDone(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  const success = await updateWorkQueueStatus(pageInfo.pageId, 'Done');

  if (success) {
    await ctx.editMessageText(
      `✅ <b>Marked as Done</b>\n\n` +
      `<b>${pageInfo.title}</b>\n` +
      `Status: Done`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText(
      `❌ Failed to update status. Please try again or update manually in Notion.`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(pending.requestId);
}

/**
 * Show update options for a Work Queue item
 */
async function handleUpdate(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo, requestId } = pending;

  // Build status selection keyboard
  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard();
  keyboard.text('📥 Captured', `notion:${requestId}:status:Captured`);
  keyboard.text('📋 Triaged', `notion:${requestId}:status:Triaged`);
  keyboard.row();
  keyboard.text('🔄 Active', `notion:${requestId}:status:Active`);
  keyboard.text('⏸️ Paused', `notion:${requestId}:status:Paused`);
  keyboard.row();
  keyboard.text('🚫 Blocked', `notion:${requestId}:status:Blocked`);
  keyboard.text('✅ Done', `notion:${requestId}:status:Done`);
  keyboard.row();
  keyboard.text('🚀 Shipped', `notion:${requestId}:status:Shipped`);
  keyboard.text('❌ Cancel', `notion:${requestId}:dismiss`);

  await ctx.editMessageText(
    `📝 <b>Update Status</b>\n\n` +
    `<b>${pageInfo.title}</b>\n` +
    `Current: ${pageInfo.status || 'Unknown'}\n\n` +
    `Select new status:`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
}

/**
 * Create a Work Queue task from a Feed item
 */
async function handleCreateTask(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  // Create Work Queue entry from Feed item
  const entry: AuditEntry = {
    entry: pageInfo.title,
    pillar: pageInfo.pillar || 'The Grove',
    requestType: pageInfo.requestType || 'Research',
    source: 'Telegram',
    author: 'Atlas [Telegram]',
    confidence: 1.0,
    keywords: pageInfo.keywords || [],
    workType: 'from feed entry',
    userId: ctx.from?.id || 0,
    messageText: `Created from Feed: ${pageInfo.title}`,
    hasAttachment: false,
  };

  const result = await createAuditTrail(entry);

  if (result) {
    await ctx.editMessageText(
      `✅ <b>Task Created</b>\n\n` +
      `<b>${pageInfo.title}</b>\n\n` +
      `📋 Work Queue: ${result.workQueueUrl}`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText(
      `❌ Failed to create task. Please try again.`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(pending.requestId);
}

/**
 * Track an unknown Notion page in Work Queue
 */
async function handleTrackInWQ(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  const entry: AuditEntry = {
    entry: pageInfo.title,
    pillar: 'The Grove', // Default, user can change
    requestType: 'Research', // Default
    source: 'Telegram',
    author: 'Atlas [Telegram]',
    confidence: 0.8,
    keywords: [],
    workType: 'from notion page',
    userId: ctx.from?.id || 0,
    messageText: `Tracking Notion page: ${pageInfo.url}`,
    hasAttachment: false,
    url: pageInfo.url,
  };

  const result = await createAuditTrail(entry);

  if (result) {
    await ctx.editMessageText(
      `✅ <b>Tracked in Work Queue</b>\n\n` +
      `<b>${pageInfo.title}</b>\n\n` +
      `📋 Work Queue: ${result.workQueueUrl}`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText(
      `❌ Failed to track. Please try again.`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(pending.requestId);
}

/**
 * Log an unknown Notion page to Feed
 */
async function handleLogToFeed(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  const entry: AuditEntry = {
    entry: `Logged: ${pageInfo.title}`,
    pillar: 'The Grove',
    requestType: 'Quick',
    source: 'Telegram',
    author: 'Atlas [Telegram]',
    confidence: 1.0,
    keywords: [],
    workType: 'notion page log',
    userId: ctx.from?.id || 0,
    messageText: `Logged Notion page: ${pageInfo.url}`,
    hasAttachment: false,
    url: pageInfo.url,
  };

  const result = await createAuditTrail(entry);

  if (result) {
    await ctx.editMessageText(
      `✅ <b>Logged to Feed</b>\n\n` +
      `<b>${pageInfo.title}</b>\n\n` +
      `📰 Feed: ${result.feedUrl}`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText(
      `❌ Failed to log. Please try again.`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(pending.requestId);
}

/**
 * Just read a Notion page and inject into context
 */
async function handleJustRead(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  // Inject into conversation context
  const contextContent = getPageContentForContext(pageInfo);
  const userId = ctx.from?.id;
  if (userId) {
    addToConversationContext(userId, {
      role: 'system',
      content: `[NOTION PAGE CONTEXT]\n${contextContent}`,
    });
  }

  await ctx.editMessageText(
    `📖 <b>Page loaded into context</b>\n\n` +
    `<b>${pageInfo.title}</b>\n\n` +
    `You can now ask questions about this page or reference it in our conversation.`,
    { parse_mode: 'HTML' }
  );

  removePendingNotionAction(pending.requestId);
}

/**
 * Show full details of a Notion page
 */
async function handleShowDetails(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  const { pageInfo } = pending;

  let details = formatNotionPreview(pageInfo);

  if (pageInfo.content && pageInfo.content.length > 0) {
    const truncContent = pageInfo.content.length > 500
      ? pageInfo.content.substring(0, 497) + '...'
      : pageInfo.content;
    details += `\n\n<b>Content:</b>\n<code>${truncContent}</code>`;
  }

  details += `\n\n🔗 ${pageInfo.url}`;

  // Also inject into context
  const userId = ctx.from?.id;
  if (userId) {
    addToConversationContext(userId, {
      role: 'system',
      content: `[NOTION PAGE CONTEXT]\n${getPageContentForContext(pageInfo)}`,
    });
  }

  await ctx.editMessageText(details, { parse_mode: 'HTML' });
  removePendingNotionAction(pending.requestId);
}

/**
 * Dismiss the Notion action
 */
async function handleDismiss(
  ctx: Context,
  pending: { requestId: string; pageInfo: NotionPageInfo }
): Promise<void> {
  await ctx.deleteMessage();
  removePendingNotionAction(pending.requestId);
}

/**
 * Handle status update (called from Update flow)
 */
export async function handleNotionStatusUpdate(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.includes(':status:')) return;

  const parts = data.split(':');
  if (parts.length < 4) return;

  const [, requestId, , status] = parts;
  await ctx.answerCallbackQuery();

  const pending = getPendingNotionAction(requestId);
  if (!pending) {
    await ctx.reply('Request expired.');
    return;
  }

  const validStatuses = ['Done', 'Shipped', 'Active', 'Captured', 'Blocked', 'Paused', 'Triaged'];
  if (!validStatuses.includes(status)) {
    await ctx.reply('Invalid status');
    return;
  }

  const success = await updateWorkQueueStatus(
    pending.pageInfo.pageId,
    status as 'Done' | 'Shipped' | 'Active' | 'Captured' | 'Blocked' | 'Paused'
  );

  if (success) {
    const statusIcons: Record<string, string> = {
      'Done': '✅',
      'Shipped': '🚀',
      'Active': '🔄',
      'Captured': '📥',
      'Triaged': '📋',
      'Blocked': '🚫',
      'Paused': '⏸️',
    };

    await ctx.editMessageText(
      `${statusIcons[status] || '📋'} <b>Status Updated</b>\n\n` +
      `<b>${pending.pageInfo.title}</b>\n` +
      `Status: ${status}`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText(
      `❌ Failed to update status. Please try again.`,
      { parse_mode: 'HTML' }
    );
  }

  removePendingNotionAction(requestId);
}
