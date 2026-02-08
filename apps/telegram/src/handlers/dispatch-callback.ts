/**
 * Dispatch Callback Handler
 *
 * Processes inline keyboard callbacks for low-confidence routing decisions.
 * When Atlas is uncertain whether to route to Pit Crew or Work Queue,
 * the user makes the choice via inline keyboard.
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  getPendingDispatch,
  removePendingDispatch,
  parseDispatchCallbackData,
} from '../conversation/dispatch-choice';
import { safeAnswerCallback } from '../utils/telegram-helpers';

// Import dispatcher routing functions directly
import { Client } from '@notionhq/client';
import { executeMcpTool, getMcpStatus } from '../mcp';

const DB_WORK_QUEUE = '3d679030-b76b-43bd-92d8-1ac51abb4a28';
const DEV_PIPELINE_DATABASE_ID = 'ce6fbf1b-ee30-433d-a9e6-b338552de7c9';

// Notion client (lazy loaded)
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error('NOTION_API_KEY environment variable is required');
    }
    _notion = new Client({ auth: apiKey });
  }
  return _notion;
}

/**
 * Handle dispatch routing choice callback queries
 */
export async function handleDispatchCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const parsed = parseDispatchCallbackData(data);
  if (!parsed) {
    logger.warn('Invalid dispatch callback data', { data });
    await ctx.answerCallbackQuery({ text: 'Invalid action' });
    return;
  }

  const { requestId, action, category } = parsed;

  // Get pending dispatch
  const pending = getPendingDispatch(requestId);
  if (!pending) {
    await safeAnswerCallback(ctx, 'Request expired. Please try again.', {
      fallbackMessage: '⏱️ That request expired. Please try again.'
    });
    try {
      await ctx.deleteMessage();
    } catch {
      // Message may already be deleted
    }
    return;
  }

  switch (action) {
    case 'route':
      await handleRouteChoice(ctx, requestId, pending, category!);
      break;

    case 'cancel':
      await handleCancel(ctx, requestId, pending);
      break;
  }
}

/**
 * Handle user's routing choice
 */
async function handleRouteChoice(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingDispatch>,
  category: string
): Promise<void> {
  if (!pending) return;

  const isPitCrew = category === 'dev_bug' || category === 'feature';
  const destination = isPitCrew ? 'Pit Crew' : 'Work Queue';

  await ctx.answerCallbackQuery({ text: `Routing to ${destination}...` });

  try {
    // Update message to show routing in progress
    try {
      await ctx.editMessageText(
        `⏳ <b>Routing to ${destination}...</b>\n\n${pending.title}`,
        { parse_mode: 'HTML' }
      );
    } catch {
      // Message edit may fail
    }

    let result: { success: boolean; url?: string; error?: string };

    if (isPitCrew) {
      result = await routeToPitCrew(pending, category as 'dev_bug' | 'feature');
    } else {
      result = await routeToWorkQueue(pending, category as 'research' | 'content');
    }

    // Remove from pending
    removePendingDispatch(requestId);

    // Delete choice message
    try {
      await ctx.deleteMessage();
    } catch {
      // May already be deleted
    }

    // Send result message
    if (result.success && result.url) {
      const icon = isPitCrew ? (category === 'feature' ? '✨' : '🐛') : '📋';
      await ctx.reply(
        `${icon} <b>Dispatched to ${destination}</b>\n\n` +
        `${pending.title}\n\n` +
        `<a href="${result.url}">View in Notion</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } else {
      await ctx.reply(
        `❌ <b>Dispatch failed</b>\n\n${result.error || 'Unknown error'}`,
        { parse_mode: 'HTML' }
      );
    }

    logger.info('Dispatch choice completed', {
      requestId,
      category,
      destination,
      success: result.success,
    });

  } catch (error) {
    logger.error('Failed to process dispatch choice', { error, requestId });
    await ctx.reply('Dispatch failed. Please try again.');
  }
}

/**
 * Handle cancel action
 */
async function handleCancel(
  ctx: Context,
  requestId: string,
  pending: ReturnType<typeof getPendingDispatch>
): Promise<void> {
  if (!pending) return;

  removePendingDispatch(requestId);

  await ctx.answerCallbackQuery({ text: 'Cancelled' });

  try {
    await ctx.deleteMessage();
  } catch {
    // May already be deleted
  }

  await ctx.reply('❌ Dispatch cancelled');

  logger.info('Dispatch cancelled', { requestId });
}

/**
 * Route to Pit Crew (for chosen engineering work)
 */
async function routeToPitCrew(
  pending: NonNullable<ReturnType<typeof getPendingDispatch>>,
  category: 'dev_bug' | 'feature'
): Promise<{ success: boolean; url?: string; error?: string }> {
  const ticketType = category === 'feature' ? 'feature' : 'bug';

  // Check if Pit Crew MCP is connected
  const mcpStatus = getMcpStatus();
  const pitCrewStatus = mcpStatus['pit_crew'];

  if (pitCrewStatus?.status === 'connected') {
    try {
      const fullContext = `**Atlas Analysis:**\n${pending.reasoning}\n\n**Task Specification:**\n${pending.description}`;

      const result = await executeMcpTool('mcp__pit_crew__dispatch_work', {
        type: ticketType,
        title: pending.title,
        context: fullContext,
        priority: pending.priority,
      });

      if (result.success) {
        const mcpResult = result.result as { content?: Array<{ type: string; text?: string }> };
        const textContent = mcpResult?.content?.find(c => c.type === 'text');
        if (textContent?.text) {
          const parsed = JSON.parse(textContent.text);
          if (parsed.success && parsed.notion_url) {
            return { success: true, url: parsed.notion_url };
          }
        }
      }

      logger.warn('Pit Crew MCP dispatch failed, falling back to direct Notion', { error: result.error });
    } catch (err) {
      logger.warn('Pit Crew MCP error, falling back to direct Notion', { error: err });
    }
  }

  // Fallback: Create directly in Dev Pipeline with page body content
  try {
    const notion = getNotionClient();
    const typeLabel = ticketType === 'feature' ? 'Feature' : 'Bug';

    const response = await notion.pages.create({
      parent: { database_id: DEV_PIPELINE_DATABASE_ID },
      properties: {
        'Discussion': { title: [{ text: { content: pending.title } }] },
        'Type': { select: { name: typeLabel } },
        'Priority': { select: { name: pending.priority } },
        'Status': { select: { name: 'Dispatched' } },
        'Requestor': { select: { name: 'Atlas [Telegram]' } },
        'Handler': { select: { name: 'Pit Crew' } },
        'Thread': { rich_text: [{ text: { content: 'See page body for full context.' } }] },
        'Dispatched': { date: { start: new Date().toISOString().split('T')[0] } },
      },
      // Write content to PAGE BODY for editing/review
      children: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: '🤖 Atlas Analysis' } }],
          },
        },
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: pending.reasoning.substring(0, 2000) } }],
            icon: { type: 'emoji', emoji: '💡' },
          },
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: '📋 Task Specification' } }],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: pending.description.substring(0, 2000) } }],
          },
        },
        {
          object: 'block',
          type: 'divider',
          divider: {},
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: '🔧 Pit Crew Work' } }],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: '(Pit Crew will document implementation notes here)' }, annotations: { italic: true, color: 'gray' } }],
          },
        },
      ],
    });

    const url = (response as { url?: string }).url || '';
    return { success: true, url };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create Dev Pipeline item: ${errorMessage}` };
  }
}

/**
 * Route to Work Queue (for chosen operational work)
 */
async function routeToWorkQueue(
  pending: NonNullable<ReturnType<typeof getPendingDispatch>>,
  category: 'research' | 'content'
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const notion = getNotionClient();

    const typeMap: Record<string, string> = {
      'research': 'Research',
      'content': 'Draft',
    };

    const initialStatus = pending.requireReview ? 'Captured' : 'Triaged';

    const response = await notion.pages.create({
      parent: { database_id: DB_WORK_QUEUE },
      properties: {
        'Task': { title: [{ text: { content: pending.title } }] },
        'Status': { select: { name: initialStatus } },
        'Priority': { select: { name: pending.priority } },
        'Type': { select: { name: typeMap[category] || 'Research' } },
        'Pillar': { select: { name: pending.pillar } },
        'Assignee': { select: { name: 'Atlas [Telegram]' } },
        'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
      },
      children: [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: 'Atlas Reasoning' } }],
          },
        },
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: pending.reasoning } }],
            icon: { type: 'emoji', emoji: '🤖' },
          },
        },
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: 'Task Specification' } }],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: pending.description } }],
          },
        },
      ],
    });

    const url = (response as { url?: string }).url;
    if (!url) {
      return { success: false, error: `Created Work Queue item ${response.id} but failed to get URL` };
    }

    return { success: true, url };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create Work Queue item: ${errorMessage}` };
  }
}
