/**
 * Atlas Telegram Bot - Prompt Selection Callback Handler
 *
 * Handles the interactive Pillar → Action → Voice flow for content capture.
 * Uses inline keyboards for quick mobile selection.
 *
 * Callback format: ps:{dimension}:{value}
 * - ps:pillar:the-grove
 * - ps:action:research
 * - ps:voice:grove-analytical
 * - ps:shortcut (use learned defaults)
 * - ps:cancel
 * - ps:back:pillar (go back to step)
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { logger } from '../logger';

/**
 * Escape Markdown special characters to prevent parse errors
 * LinkedIn/Twitter URLs contain underscores which break Markdown parsing
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[\]])/g, '\\$1');
}

import {
  getSelection,
  updateSelection,
  selectPillar,
  selectAction,
  selectVoice,
  removeSelection,
  createSelection,
} from '../conversation/prompt-selection';
import type { TriageResult } from '../cognitive/triage-skill';
import { recordTriageFeedback } from '../cognitive/triage-patterns';
import { getFeatureFlags } from '../config/features';
import { logTriageAction } from '../skills/action-log';

import {
  // Types
  type Pillar,
  type ActionType,
  type PromptSelectionState,
  // Registry
  PILLAR_OPTIONS,
  getAvailableActions,
  getAvailableVoices,
  getPillarFromSlug,
  // Composition
  composePromptFromState,
} from '../../../../packages/agents/src';

// ==========================================
// Callback Detection
// ==========================================

/**
 * Check if callback data is a prompt selection callback
 */
export function isPromptSelectionCallback(data: string): boolean {
  return data.startsWith('ps:');
}

// ==========================================
// Keyboard Builders
// ==========================================

/**
 * Build pillar selection keyboard
 *
 * @param requestId - Unique request ID for callback routing
 * @param suggestedPillar - Optional pillar from triage skill to highlight
 */
export function buildPillarKeyboard(requestId: string, suggestedPillar?: Pillar): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Add pillar buttons (2 per row)
  PILLAR_OPTIONS.forEach((option, index) => {
    const slug = option.pillar.toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-');
    // Highlight suggested pillar with star
    const isSuggested = suggestedPillar && option.pillar === suggestedPillar;
    const label = isSuggested
      ? `⭐ ${option.emoji} ${option.label}`
      : `${option.emoji} ${option.label}`;
    keyboard.text(
      label,
      `ps:pillar:${requestId}:${slug}`
    );
    if ((index + 1) % 2 === 0) keyboard.row();
  });

  // Cancel button
  keyboard.row().text('❌ Cancel', `ps:cancel:${requestId}`);

  return keyboard;
}

/**
 * Build action selection keyboard
 */
export function buildActionKeyboard(
  requestId: string,
  pillar: Pillar,
  shortcutSuggestion?: { action: ActionType; voice: string }
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const actions = getAvailableActions(pillar);

  // If we have a shortcut suggestion, add it first
  if (shortcutSuggestion) {
    keyboard
      .text(
        `⚡ Your usual: ${shortcutSuggestion.action}`,
        `ps:shortcut:${requestId}`
      )
      .row();
  }

  // Add action buttons (2 per row)
  actions.forEach((action, index) => {
    keyboard.text(
      `${action.emoji || '📌'} ${action.label}`,
      `ps:action:${requestId}:${action.type}`
    );
    if ((index + 1) % 2 === 0) keyboard.row();
  });

  // Navigation buttons
  keyboard
    .row()
    .text('◀️ Back', `ps:back:${requestId}:pillar`)
    .text('❌ Cancel', `ps:cancel:${requestId}`);

  return keyboard;
}

/**
 * Build voice selection keyboard
 */
export function buildVoiceKeyboard(
  requestId: string,
  pillar: Pillar,
  action: ActionType
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const voices = getAvailableVoices(pillar, action);

  // Add voice buttons (2 per row)
  voices.forEach((voice, index) => {
    keyboard.text(
      `${voice.emoji || '🎙️'} ${voice.name}`,
      `ps:voice:${requestId}:${voice.id}`
    );
    if ((index + 1) % 2 === 0) keyboard.row();
  });

  // Navigation buttons
  keyboard
    .row()
    .text('◀️ Back', `ps:back:${requestId}:action`)
    .text('❌ Cancel', `ps:cancel:${requestId}`);

  return keyboard;
}

// ==========================================
// Main Handler
// ==========================================

/**
 * Handle prompt selection callback
 */
export async function handlePromptSelectionCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !isPromptSelectionCallback(data)) {
    return;
  }

  // Parse callback: ps:{type}:{requestId}:{value}
  const parts = data.split(':');
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: 'Invalid callback format' });
    return;
  }

  const [, type, requestId, value] = parts;

  // Acknowledge callback immediately
  await ctx.answerCallbackQuery();

  // Route to handler
  switch (type) {
    case 'pillar':
      await handlePillarSelection(ctx, requestId, value);
      break;
    case 'action':
      await handleActionSelection(ctx, requestId, value);
      break;
    case 'voice':
      await handleVoiceSelection(ctx, requestId, value);
      break;
    case 'shortcut':
      await handleShortcut(ctx, requestId);
      break;
    case 'back':
      await handleBack(ctx, requestId, value as 'pillar' | 'action');
      break;
    case 'cancel':
      await handleCancel(ctx, requestId);
      break;
    default:
      logger.warn('Unknown prompt selection callback type', { type, data });
      await ctx.reply('Unknown selection type. Please try again.');
  }
}

// ==========================================
// Step Handlers
// ==========================================

/**
 * Handle pillar selection
 */
async function handlePillarSelection(
  ctx: Context,
  requestId: string,
  pillarSlug: string
): Promise<void> {
  const state = getSelection(requestId);
  if (!state) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // Convert slug to pillar
  const pillar = getPillarFromSlug(pillarSlug);
  if (!pillar) {
    logger.warn('Invalid pillar slug', { pillarSlug, requestId });
    await ctx.reply('Invalid pillar selection. Please try again.');
    return;
  }

  // Update state
  const updated = selectPillar(requestId, pillar);
  if (!updated) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // TRIAGE FEEDBACK: Record whether user confirmed or corrected the suggestion
  const flags = getFeatureFlags();
  if (flags.triageSkill && state.triageResult) {
    const wasCorrection = state.suggestedPillar && pillar !== state.suggestedPillar;
    const correctedFields = wasCorrection ? { pillar } : null;

    // Reconstruct minimal triage result for feedback
    const triageForFeedback = {
      intent: state.triageResult.intent,
      confidence: state.triageResult.confidence,
      pillar: state.suggestedPillar || pillar,
      requestType: 'Research' as const, // Default, will be refined in action step
      keywords: state.triageResult.keywords || [],
      complexityTier: state.triageResult.complexityTier,
      source: state.triageResult.source,
    };

    recordTriageFeedback(state.content, triageForFeedback, correctedFields);

    logger.info('Triage feedback recorded', {
      requestId,
      selectedPillar: pillar,
      suggestedPillar: state.suggestedPillar,
      wasCorrection,
      triageSource: state.triageResult.source,
    });
  }

  logger.info('Pillar selected', { requestId, pillar });

  // Show action selection
  // TODO (Phase 3): Get shortcut suggestion from learning system
  const shortcutSuggestion = undefined;

  const keyboard = buildActionKeyboard(requestId, pillar, shortcutSuggestion);

  try {
    await ctx.editMessageText(
      `📌 *${pillar}* selected\n\n` +
      `What would you like to do?\n\n` +
      `_${updated.title || updated.content}_`,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  } catch (err) {
    // If edit fails, send new message
    logger.warn('Failed to edit message, sending new', { err });
    await ctx.reply(
      `📌 *${pillar}* selected\n\n` +
      `What would you like to do?\n\n` +
      `_${updated.title || updated.content}_`,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle action selection
 */
async function handleActionSelection(
  ctx: Context,
  requestId: string,
  actionType: string
): Promise<void> {
  const state = getSelection(requestId);
  if (!state || !state.pillar) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // Validate action type
  const action = actionType as ActionType;

  // Update state
  const updated = selectAction(requestId, action);
  if (!updated) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  logger.info('Action selected', { requestId, action, pillar: state.pillar });

  // Show voice selection
  const keyboard = buildVoiceKeyboard(requestId, state.pillar, action);

  try {
    await ctx.editMessageText(
      `📌 *${state.pillar}* → *${action}*\n\n` +
      `Select a voice:\n\n` +
      `_${updated.title || updated.content}_`,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.warn('Failed to edit message, sending new', { err });
    await ctx.reply(
      `📌 *${state.pillar}* → *${action}*\n\n` +
      `Select a voice:\n\n` +
      `_${updated.title || updated.content}_`,
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle voice selection - final step, execute composition
 */
async function handleVoiceSelection(
  ctx: Context,
  requestId: string,
  voiceId: string
): Promise<void> {
  const state = getSelection(requestId);
  if (!state || !state.pillar || !state.action) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // Update state with voice
  const updated = selectVoice(requestId, voiceId);
  if (!updated) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  logger.info('Voice selected, executing composition', {
    requestId,
    pillar: state.pillar,
    action: state.action,
    voice: voiceId,
  });

  // Remove the keyboard
  try {
    await ctx.deleteMessage();
  } catch {
    // Ignore if can't delete
  }

  // Execute the composition
  await executePromptComposition(ctx, updated);
}

/**
 * Handle shortcut - use learned defaults (Phase 3)
 */
async function handleShortcut(
  ctx: Context,
  requestId: string
): Promise<void> {
  const state = getSelection(requestId);
  if (!state) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // TODO (Phase 3): Implement shortcut handling
  // For now, just show a message
  await ctx.reply('⚡ Shortcuts will be available in a future update.');
}

/**
 * Handle back navigation
 */
async function handleBack(
  ctx: Context,
  requestId: string,
  toStep: 'pillar' | 'action'
): Promise<void> {
  const state = getSelection(requestId);
  if (!state) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // Update state to go back
  const updated = updateSelection(requestId, { step: toStep });
  if (!updated) {
    await ctx.reply('⚠️ Selection expired. Please try again.');
    return;
  }

  // Show appropriate keyboard
  if (toStep === 'pillar') {
    const keyboard = buildPillarKeyboard(requestId);
    try {
      await ctx.editMessageText(
        `Which pillar?\n\n_${updated.title || updated.content}_`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(
        `Which pillar?\n\n_${updated.title || updated.content}_`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    }
  } else if (toStep === 'action' && updated.pillar) {
    const keyboard = buildActionKeyboard(requestId, updated.pillar);
    try {
      await ctx.editMessageText(
        `📌 *${updated.pillar}* selected\n\n` +
        `What would you like to do?\n\n` +
        `_${updated.title || updated.content}_`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(
        `📌 *${updated.pillar}* selected\n\n` +
        `What would you like to do?\n\n` +
        `_${updated.title || updated.content}_`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    }
  }
}

/**
 * Handle cancel
 */
async function handleCancel(
  ctx: Context,
  requestId: string
): Promise<void> {
  removeSelection(requestId);

  try {
    await ctx.deleteMessage();
  } catch {
    // Ignore
  }

  await ctx.reply('❌ Selection cancelled.');
}

// ==========================================
// Composition Execution
// ==========================================

/**
 * Execute the prompt composition and create Notion entries
 */
async function executePromptComposition(
  ctx: Context,
  state: PromptSelectionState
): Promise<void> {
  const { pillar, action, voice, content, title, contentType } = state;

  // Send progress message
  const progressMsg = await ctx.reply(
    `🔄 Processing...\n\n` +
    `📌 ${pillar} → ${action}${voice ? ` → ${voice}` : ''}\n` +
    `📝 ${title || content.substring(0, 50)}...`
  );

  try {
    // Compose the prompt
    const result = await composePromptFromState(state);

    logger.info('Prompt composed successfully', {
      pillar,
      action,
      voice,
      drafter: result.metadata.drafter,
      promptLength: result.prompt.length,
    });

    // Import Notion client for creating entries
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    // Database IDs (canonical)
    const FEED_DB = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18';
    const WORK_QUEUE_DB = '3d679030-b76b-43bd-92d8-1ac51abb4a28';

    const entryTitle = title || content;

    // Map action to valid Request Type (from CLAUDE.md schema)
    // Valid types: Research, Build, Draft, Schedule, Answer, Process
    const requestTypeMap: Record<string, string> = {
      'research': 'Research',
      'analysis': 'Research',
      'draft': 'Draft',
      'build': 'Build',
      'task': 'Process',
      'reference': 'Research',
    };
    const requestType = requestTypeMap[action || ''] || 'Research';

    logger.info('Creating Feed entry', { entryTitle, pillar, requestType, action });

    // Create Feed entry
    const feedEntry = await notion.pages.create({
      parent: { database_id: FEED_DB },
      properties: {
        'Entry': { title: [{ text: { content: entryTitle } }] },
        'Pillar': { select: { name: pillar! } },
        'Source': { select: { name: 'Telegram' } },
        'Request Type': { select: { name: requestType } },
        'Author': { select: { name: 'Atlas [Telegram]' } },
        'Status': { select: { name: 'Captured' } },
        'Date': { date: { start: new Date().toISOString() } },
      },
    });

    logger.info('Feed entry created', { feedId: feedEntry.id });

    // Add source URL to Feed page body if URL
    if (contentType === 'url') {
      await notion.blocks.children.append({
        block_id: feedEntry.id,
        children: [
          {
            type: 'bookmark',
            bookmark: { url: content },
          },
        ],
      });
    }

    // Map action to Work Queue Type (from CLAUDE.md schema)
    // Valid types: Research, Build, Draft, Schedule, Answer, Process
    const wqTypeMap: Record<string, string> = {
      'research': 'Research',
      'analysis': 'Research',
      'draft': 'Draft',
      'build': 'Build',
      'task': 'Process',
      'reference': 'Research',
    };
    const wqType = wqTypeMap[action || ''] || 'Research';
    const priority = ['research', 'analysis', 'build'].includes(action || '') ? 'P1' : 'P2';

    logger.info('Creating Work Queue entry', { entryTitle, pillar, wqType, priority });

    // Create Work Queue entry
    const wqEntry = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DB },
      properties: {
        'Task': { title: [{ text: { content: entryTitle } }] },
        'Status': { select: { name: 'Captured' } },
        'Priority': { select: { name: priority } },
        'Type': { select: { name: wqType } },
        'Pillar': { select: { name: pillar! } },
        'Assignee': { select: { name: 'Atlas [Telegram]' } },
        'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });

    logger.info('Work Queue entry created', { wqId: wqEntry.id });

    // Add composed prompt metadata to Work Queue page body
    await notion.blocks.children.append({
      block_id: wqEntry.id,
      children: [
        ...(contentType === 'url' ? [{
          type: 'callout' as const,
          callout: {
            icon: { emoji: '🔗' as const },
            color: 'blue_background' as const,
            rich_text: [
              { type: 'text' as const, text: { content: 'Source: ' } },
              { type: 'text' as const, text: { content: content, link: { url: content } } },
            ],
          },
        }] : []),
        {
          type: 'callout' as const,
          callout: {
            icon: { emoji: '🎯' as const },
            color: 'purple_background' as const,
            rich_text: [{
              type: 'text' as const,
              text: {
                content: `Composition: ${result.metadata.drafter}${result.metadata.voice ? ` + ${result.metadata.voice}` : ''}`
              }
            }],
          },
        },
      ],
    });

    const notionUrl = (wqEntry as any).url;

    // Update progress message
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `🔄 Extracting content...\n\n` +
        `📌 ${pillar} → ${action}${voice ? ` → ${voice}` : ''}\n` +
        `📝 ${title || content.substring(0, 50)}...`
      );
    } catch {
      // Ignore edit failures
    }

    // Trigger skill execution for content extraction (if URL)
    if (contentType === 'url') {
      try {
        const { getSkillRegistry, initializeSkillRegistry } = await import('../skills/registry');
        const { executeSkill } = await import('../skills/executor');

        // Ensure registry is initialized
        await initializeSkillRegistry();
        const registry = getSkillRegistry();

        // Find matching skill
        const match = registry.findBestMatch(content, { pillar: pillar as any });

        if (match) {
          logger.info('Executing skill for prompt selection', {
            skill: match.skill.name,
            url: content,
            pillar,
            action,
            voice,
          });

          const userId = ctx.from?.id || 0;

          // Execute skill with composed prompt
          await executeSkill(match.skill, {
            userId,
            messageText: content,
            pillar: pillar as any,
            approvalLatch: true, // User already confirmed via interactive flow
            input: {
              url: content,
              title: title || content,
              pillar,
              feedId: feedEntry.id,
              workQueueId: wqEntry.id,
              workQueueUrl: notionUrl,
              feedUrl: (feedEntry as any).url,
              depth: action === 'research' ? 'deep' : 'standard',
              telegramChatId: userId,
              // Pass the composed prompt for the skill to use
              composedPrompt: {
                prompt: result.prompt,
                temperature: result.temperature,
                maxTokens: result.maxTokens,
                metadata: result.metadata,
              },
              v3Requested: !!result.prompt, // Only true when composition actually produced a prompt
            },
          });

          logger.info('Skill execution completed', {
            skill: match.skill.name,
            action,
            pillar,
          });
        } else {
          logger.warn('No skill matched for URL', { url: content, pillar });
        }
      } catch (skillError) {
        logger.error('Skill execution failed', {
          error: skillError,
          url: content,
          pillar,
          action,
        });
        // Don't fail the whole capture - entries are created, just no extraction
      }
    }

    // BUG #6: Process sub-intents if compound message
    const flags = getFeatureFlags();
    const subIntentResults: Array<{ intent: string; title: string; url?: string }> = [];

    if (flags.multiIntentParsing && state.triageResult?.isCompound && state.triageResult.subIntents) {
      logger.info('Processing compound message sub-intents', {
        primaryIntent: state.triageResult.intent,
        subIntentCount: state.triageResult.subIntents.length,
      });

      for (const subIntent of state.triageResult.subIntents) {
        try {
          const subTitle = subIntent.description.substring(0, 60);
          const subPillar = subIntent.pillar || pillar;

          // Create Feed entry for sub-intent
          const subFeedEntry = await notion.pages.create({
            parent: { database_id: FEED_DB },
            properties: {
              'Entry': { title: [{ text: { content: `[Sub] ${subTitle}` } }] },
              'Pillar': { select: { name: subPillar! } },
              'Source': { select: { name: 'Telegram' } },
              'Request Type': { select: { name: subIntent.intent === 'command' ? 'Process' : 'Research' } },
              'Author': { select: { name: 'Atlas [Telegram]' } },
              'Status': { select: { name: 'Captured' } },
              'Date': { date: { start: new Date().toISOString() } },
            },
          });

          // Create Work Queue entry for sub-intent
          const subWqEntry = await notion.pages.create({
            parent: { database_id: WORK_QUEUE_DB },
            properties: {
              'Task': { title: [{ text: { content: subTitle } }] },
              'Status': { select: { name: 'Captured' } },
              'Priority': { select: { name: 'P2' } },
              'Type': { select: { name: subIntent.intent === 'command' ? 'Process' : 'Research' } },
              'Pillar': { select: { name: subPillar! } },
              'Assignee': { select: { name: 'Atlas [Telegram]' } },
              'Queued': { date: { start: new Date().toISOString().split('T')[0] } },
            },
          });

          subIntentResults.push({
            intent: subIntent.intent,
            title: subTitle,
            url: (subWqEntry as any).url,
          });

          logger.info('Sub-intent captured', {
            intent: subIntent.intent,
            title: subTitle,
            feedId: subFeedEntry.id,
            wqId: subWqEntry.id,
          });
        } catch (subError) {
          logger.error('Failed to capture sub-intent', {
            error: subError,
            subIntent,
          });
          // Continue with other sub-intents
        }
      }
    }

    // Log triage action if triage was used (Phase 4: Action Logging)
    if (flags.triageSkill && state.triageResult) {
      const pillarCorrected = state.suggestedPillar && pillar !== state.suggestedPillar;
      try {
        await logTriageAction(
          content,
          pillar!,
          requestType as 'Research' | 'Build' | 'Draft' | 'Schedule' | 'Answer' | 'Process',
          state.userId,
          {
            intent: state.triageResult.intent,
            confidence: state.triageResult.confidence,
            complexityTier: state.triageResult.complexityTier,
            source: state.triageResult.source,
            suggestedPillar: state.suggestedPillar,
            title: state.title,
            keywords: state.triageResult.keywords,
          },
          {
            pillarCorrected: pillarCorrected || false,
            contentType: contentType === 'url' ? 'url' : undefined,
          }
        );
        logger.info('Triage action logged to Feed', {
          intent: state.triageResult.intent,
          pillarCorrected,
        });
      } catch (logError) {
        // Non-fatal - don't fail capture if logging fails
        logger.warn('Failed to log triage action', { error: logError });
      }
    }

    // Clean up the selection
    removeSelection(state.requestId);

    // Delete progress message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch {
      // Ignore
    }

    // Send success message
    let successMessage =
      `✅ *Captured!*\n\n` +
      `📌 ${pillar} → ${action}${voice ? ` → ${voice}` : ''}\n` +
      `📝 ${entryTitle.substring(0, 100)}${entryTitle.length > 100 ? '...' : ''}\n\n` +
      `🔗 [View in Notion](${notionUrl})`;

    // BUG #6: Include sub-intent confirmations if any
    if (subIntentResults.length > 0) {
      successMessage += `\n\n*Also captured:*\n`;
      for (const sub of subIntentResults) {
        successMessage += `• ${sub.title}${sub.url ? ` [→](${sub.url})` : ''}\n`;
      }
    }

    await ctx.reply(successMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    logger.error('Prompt composition execution failed', {
      error,
      pillar,
      action,
      voice,
    });

    removeSelection(state.requestId);

    await ctx.reply(
      `❌ Failed to process content.\n\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// ==========================================
// Entry Point for Initiating Selection
// ==========================================

/**
 * Start a new prompt selection flow
 *
 * Called when content is detected and needs interactive pillar selection.
 * Sends the initial pillar keyboard.
 *
 * TRIAGE INTELLIGENCE: When triageResult is provided, highlights the
 * suggested pillar in the keyboard.
 *
 * @param ctx - Grammy context
 * @param content - URL or text content
 * @param contentType - Type of content ('url' or 'text')
 * @param title - Optional title (from triage or extraction)
 * @param triageResult - Optional triage result for pillar suggestion
 */
export async function startPromptSelection(
  ctx: Context,
  content: string,
  contentType: 'url' | 'text',
  title?: string,
  triageResult?: TriageResult
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    logger.error('Missing chat or user ID for prompt selection');
    return;
  }

  // Create selection state with triage suggestion
  const state = createSelection({
    chatId,
    userId,
    content,
    contentType,
    title,
    suggestedPillar: triageResult?.pillar,
    triageResult: triageResult ? {
      intent: triageResult.intent,
      confidence: triageResult.confidence,
      complexityTier: triageResult.complexityTier,
      source: triageResult.source,
      keywords: triageResult.keywords,
      // Bug #6: Multi-intent support
      isCompound: triageResult.isCompound,
      subIntents: triageResult.subIntents?.map(sub => ({
        intent: sub.intent,
        description: sub.description,
        pillar: sub.pillar,
      })),
    } : undefined,
  });

  logger.info('Starting prompt selection flow', {
    requestId: state.requestId,
    content: content.substring(0, 50),
    contentType,
    suggestedPillar: triageResult?.pillar,
    triageSource: triageResult?.source,
  });

  // Build and send pillar keyboard (with suggested pillar highlighted)
  const keyboard = buildPillarKeyboard(state.requestId, triageResult?.pillar);

  // Escape Markdown in content to prevent parse errors (LinkedIn URLs have underscores)
  const displayText = escapeMarkdown(title || content.substring(0, 100));
  const ellipsis = content.length > 100 ? '...' : '';

  // Include triage confidence hint if available
  const confidenceHint = triageResult && triageResult.confidence >= 0.7
    ? `\n\n💡 _Suggested: ${triageResult.pillar}_`
    : '';

  const message = await ctx.reply(
    `Which pillar?\n\n_${displayText}${ellipsis}_${confidenceHint}`,
    { reply_markup: keyboard, parse_mode: 'Markdown' }
  );

  // Store message ID for editing
  updateSelection(state.requestId, { messageId: message.message_id });
}
