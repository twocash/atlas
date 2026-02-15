/**
 * Intent-First Callback Handler
 *
 * Processes inline keyboard callbacks for the intent-first capture flow.
 * 3-step progressive flow: intent → depth → audience → confirm
 *
 * Callback format: intent:{requestId}:{action}:{value}
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  getPendingContent,
  updatePendingContent,
  removePendingContent,
  parseIntentCallbackData,
  buildIntentKeyboard,
  buildDepthKeyboard,
  buildAudienceKeyboard,
  buildIntentConfirmKeyboard,
  derivePillarFromContext,
  detectSourceType,
  type PendingContent,
} from '../conversation/content-confirm';
import { createAuditTrail, type AuditEntry } from '../conversation/audit';
import { buildContentPayload } from '../conversation/content-router';
import type { Pillar, IntentType, DepthLevel, AudienceType, StructuredContext } from '../conversation/types';
import { logAction, isFeatureEnabled } from '../skills';
import { safeAnswerCallback } from '../utils/telegram-helpers';
import { registerSkip } from '../utils/url-dedup';
import {
  runResearchAgentWithNotifications,
  sendCompletionNotification,
} from '../services/research-executor';
import type { ResearchConfig } from '../../../../packages/agents/src';
import {
  composeFromStructuredContext,
  inferFormat as composeInferFormat,
  type StructuredCompositionInput,
} from '../../../../packages/agents/src/services/prompt-composition';
import { getSkillRegistry, initializeSkillRegistry } from '../skills/registry';
import { executeSkill } from '../skills/executor';

// ==========================================
// Intent Icons
// ==========================================

const INTENT_ICONS: Record<string, string> = {
  research: '🔍',
  draft: '✏️',
  save: '📌',
  analyze: '📊',
  capture: '📸',
  engage: '💬',
};

const DEPTH_ICONS: Record<string, string> = {
  quick: '⚡',
  standard: '📊',
  deep: '🔬',
};

const AUDIENCE_ICONS: Record<string, string> = {
  self: '🙋',
  client: '💼',
  public: '🌐',
  team: '👥',
};

const PILLAR_ICONS: Record<Pillar, string> = {
  'Personal': '👤',
  'The Grove': '🌳',
  'Consulting': '💼',
  'Home/Garage': '🏠',
};

// ==========================================
// Main Handler
// ==========================================

/**
 * Handle intent-first callback queries
 */
export async function handleIntentCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const parsed = parseIntentCallbackData(data);
  if (!parsed) {
    logger.warn('Invalid intent callback data', { data });
    await ctx.answerCallbackQuery({ text: 'Invalid action' });
    return;
  }

  const { requestId, action, value } = parsed;

  // Get pending content
  const pending = getPendingContent(requestId);
  if (!pending) {
    await safeAnswerCallback(ctx, 'Request expired. Please share again.', {
      fallbackMessage: '⏱️ That request expired. Please share the content again.'
    });
    try { await ctx.deleteMessage(); } catch { /* already deleted */ }
    return;
  }

  switch (action) {
    case 'intent':
      await handleIntentSelection(ctx, requestId, pending, value as IntentType);
      break;
    case 'depth':
      await handleDepthSelection(ctx, requestId, pending, value as DepthLevel);
      break;
    case 'audience':
      await handleAudienceSelection(ctx, requestId, pending, value as AudienceType);
      break;
    case 'confirm':
      await handleIntentConfirm(ctx, requestId, pending);
      break;
    case 'back':
      await handleBack(ctx, requestId, pending, value as string);
      break;
    case 'skip':
      await handleIntentSkip(ctx, requestId, pending);
      break;
  }
}

// ==========================================
// Step 1: Intent Selection
// ==========================================

async function handleIntentSelection(
  ctx: Context,
  requestId: string,
  pending: PendingContent,
  intent: IntentType
): Promise<void> {
  const icon = INTENT_ICONS[intent] || '📋';
  await ctx.answerCallbackQuery({ text: `${icon} ${intent}` });

  // Store intent, advance to depth
  updatePendingContent(requestId, {
    intent,
    flowState: 'depth',
  });

  // Show depth keyboard
  const title = pending.analysis?.title || pending.originalText.substring(0, 60);
  const message =
    `${icon} <b>${capitalize(intent)}</b>\n` +
    `📝 ${escapeHtml(title)}\n\n` +
    `<b>How deep?</b>`;

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: buildDepthKeyboard(requestId),
    });
  } catch (error) {
    logger.warn('Failed to show depth keyboard', { error, requestId });
  }

  logger.info('Intent selected', { requestId, intent });
}

// ==========================================
// Step 2: Depth Selection
// ==========================================

async function handleDepthSelection(
  ctx: Context,
  requestId: string,
  pending: PendingContent,
  depth: DepthLevel
): Promise<void> {
  const icon = DEPTH_ICONS[depth] || '📊';
  await ctx.answerCallbackQuery({ text: `${icon} ${depth}` });

  // Store depth, advance to audience
  updatePendingContent(requestId, {
    depth,
    flowState: 'audience',
  });

  const intentIcon = INTENT_ICONS[pending.intent || 'capture'] || '📋';
  const title = pending.analysis?.title || pending.originalText.substring(0, 60);
  const message =
    `${intentIcon} <b>${capitalize(pending.intent || 'capture')}</b> / ${icon} <b>${capitalize(depth)}</b>\n` +
    `📝 ${escapeHtml(title)}\n\n` +
    `<b>Who's this for?</b>`;

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: buildAudienceKeyboard(requestId),
    });
  } catch (error) {
    logger.warn('Failed to show audience keyboard', { error, requestId });
  }

  logger.info('Depth selected', { requestId, depth });
}

// ==========================================
// Step 3: Audience Selection
// ==========================================

async function handleAudienceSelection(
  ctx: Context,
  requestId: string,
  pending: PendingContent,
  audience: AudienceType
): Promise<void> {
  const icon = AUDIENCE_ICONS[audience] || '👤';
  await ctx.answerCallbackQuery({ text: `${icon} ${audience}` });

  // Assemble structured context
  const sourceType = detectSourceType(pending.url, pending.attachmentInfo?.type);
  const structuredContext: StructuredContext = {
    intent: pending.intent || 'capture',
    depth: pending.depth || 'standard',
    audience,
    source_type: sourceType,
    format: composeInferFormat(pending.intent || 'capture', pending.depth || 'standard'),
    voice_hint: null,
  };

  // Derive pillar from context
  const derivedPillar = derivePillarFromContext(structuredContext);

  // Store audience + assembled context + derived pillar, advance to confirm
  updatePendingContent(requestId, {
    audience,
    structuredContext,
    pillar: derivedPillar,
    flowState: 'confirm',
  });

  // Build confirmation preview
  const intentIcon = INTENT_ICONS[structuredContext.intent] || '📋';
  const depthIcon = DEPTH_ICONS[structuredContext.depth] || '📊';
  const pillarIcon = PILLAR_ICONS[derivedPillar] || '📁';
  const title = pending.analysis?.title || pending.originalText.substring(0, 60);

  const message =
    `<b>Ready to capture</b>\n\n` +
    `📝 ${escapeHtml(title)}\n\n` +
    `${intentIcon} <b>Intent:</b> ${capitalize(structuredContext.intent)}\n` +
    `${depthIcon} <b>Depth:</b> ${capitalize(structuredContext.depth)}\n` +
    `${icon} <b>Audience:</b> ${capitalize(audience)}\n` +
    `${pillarIcon} <b>Pillar:</b> ${derivedPillar} <i>(derived)</i>\n` +
    (structuredContext.format ? `📄 <b>Format:</b> ${capitalize(structuredContext.format)}\n` : '');

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: buildIntentConfirmKeyboard(requestId),
    });
  } catch (error) {
    logger.warn('Failed to show confirm keyboard', { error, requestId });
  }

  logger.info('Audience selected, context assembled', {
    requestId,
    audience,
    derivedPillar,
    structuredContext,
  });
}

// ==========================================
// Step 4: Confirm
// ==========================================

async function handleIntentConfirm(
  ctx: Context,
  requestId: string,
  pending: PendingContent
): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Creating entries...' });

  try {
    const structuredContext = pending.structuredContext;
    if (!structuredContext) {
      logger.error('No structured context on confirm', { requestId });
      await ctx.reply('Missing context. Please try again.');
      return;
    }

    // Build audit entry
    const auditEntry: AuditEntry = {
      entry: pending.analysis?.title || pending.originalText.substring(0, 100),
      pillar: pending.pillar,
      requestType: mapIntentToRequestType(structuredContext.intent),
      source: 'Telegram',
      author: 'Jim',

      confidence: 1.0,  // Human-confirmed via keyboard
      keywords: buildKeywords(pending, structuredContext),
      workType: `${structuredContext.intent} - ${structuredContext.depth}`,

      userId: pending.userId,
      messageText: pending.originalText,
      hasAttachment: !!pending.attachmentInfo,
      attachmentType: pending.attachmentInfo?.type,

      // URL fields
      url: pending.url,
      urlTitle: pending.analysis?.title,
      urlDomain: pending.analysis?.source !== 'generic' ? pending.analysis?.source : undefined,
      contentAuthor: pending.analysis?.author,
      extractionMethod: pending.analysis?.method,
      contentPayload: pending.analysis ? buildContentPayload(pending.analysis) : undefined,

      // Pattern learning
      contentType: mapSourceTypeToContentType(structuredContext.source_type),
      contentSource: pending.attachmentInfo?.fileName?.split('.').pop() || pending.analysis?.source,
      classificationConfirmed: true,

      // Intent-First structured context
      structuredContext,
    };

    // Create audit trail (Feed + Work Queue)
    const result = await createAuditTrail(auditEntry);

    // Remove from pending
    removePendingContent(requestId);

    // Delete confirmation message
    try { await ctx.deleteMessage(); } catch { /* already deleted */ }

    // Send success message
    if (result) {
      const pillarIcon = PILLAR_ICONS[pending.pillar] || '📁';
      const intentIcon = INTENT_ICONS[structuredContext.intent] || '📋';
      await ctx.reply(
        `${intentIcon} ${pillarIcon} <b>${capitalize(structuredContext.intent)}</b> → <b>${pending.pillar}</b>\n\n` +
        `<a href="${result.feedUrl}">Feed</a> | <a href="${result.workQueueUrl}">Work Queue</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } else {
      await ctx.reply('Logged (links unavailable)');
    }

    // Non-blocking skill logging — pass existingFeedId to prevent dual-write (Bug A fix)
    if (isFeatureEnabled('skillLogging')) {
      logAction({
        messageText: pending.originalText,
        pillar: pending.pillar,
        requestType: mapIntentToRequestType(structuredContext.intent),
        actionType: pending.attachmentInfo ? 'media' : 'extract',
        toolsUsed: [],
        userId: pending.userId,
        confidence: 1.0,
        classificationConfirmed: true,
        structuredContext,
        existingFeedId: result?.feedId,
      }).catch(err => {
        logger.warn('Skill action logging failed (non-fatal)', { error: err });
      });
    }

    logger.info('Intent-first content confirmed and logged', {
      requestId,
      intent: structuredContext.intent,
      depth: structuredContext.depth,
      audience: structuredContext.audience,
      pillar: pending.pillar,
      feedId: result?.feedId,
    });

    // PROMPT COMPOSITION: Build composed prompt from structured context (Phase 2)
    let compositionResult: Awaited<ReturnType<typeof composeFromStructuredContext>> | undefined;
    try {
      const compositionInput: StructuredCompositionInput = {
        intent: structuredContext.intent,
        depth: structuredContext.depth,
        audience: structuredContext.audience,
        source_type: structuredContext.source_type,
        format: structuredContext.format,
        voice_hint: structuredContext.voice_hint,
        content: pending.originalText,
        title: pending.analysis?.title,
        url: pending.url,
        pillar: pending.pillar as any,
      };

      compositionResult = await composeFromStructuredContext(compositionInput);
      logger.info('Prompt composed from structured context', {
        requestId,
        drafter: compositionResult.metadata.drafter,
        voice: compositionResult.metadata.voice,
        depth: compositionResult.metadata.depth,
        temperature: compositionResult.temperature,
        maxTokens: compositionResult.maxTokens,
      });
    } catch (composeErr) {
      logger.warn('Prompt composition failed, dispatch will use defaults', {
        error: composeErr instanceof Error ? composeErr.message : String(composeErr),
        requestId,
      });
    }

    // EXECUTION DISPATCH: Route through skill registry first, then fall back to Gemini
    if (pending.url && result?.feedId && result?.workQueueId) {
      dispatchSkillOrResearch(
        ctx, pending, structuredContext, result.feedId, result.workQueueId,
        result.feedUrl, result.workQueueUrl, compositionResult
      ).catch(err => {
        logger.error('Execution dispatch failed (non-fatal)', { error: err, requestId });
      });
    } else if (!pending.url && structuredContext.intent === 'research' && result?.workQueueId) {
      // Non-URL research (plain text query) → Gemini directly
      dispatchResearchAgent(
        ctx, pending, structuredContext, result.workQueueId, result.workQueueUrl, compositionResult
      ).catch(err => {
        logger.error('Research dispatch failed (non-fatal)', { error: err, requestId });
      });
    }
  } catch (error) {
    logger.error('Failed to create audit trail from intent-first confirmation', { error, requestId });
    await ctx.reply('Failed to log content. Please try again.');
  }
}

// ==========================================
// Navigation: Back
// ==========================================

async function handleBack(
  ctx: Context,
  requestId: string,
  pending: PendingContent,
  targetStep: string
): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Going back...' });

  const title = pending.analysis?.title || pending.originalText.substring(0, 60);

  switch (targetStep) {
    case 'intent': {
      updatePendingContent(requestId, { flowState: 'intent', intent: undefined });
      const message = `📝 ${escapeHtml(title)}\n\n<b>What's the play?</b>`;
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: buildIntentKeyboard(requestId),
        });
      } catch { /* edit failed */ }
      break;
    }
    case 'depth': {
      updatePendingContent(requestId, { flowState: 'depth', depth: undefined });
      const intentIcon = INTENT_ICONS[pending.intent || 'capture'] || '📋';
      const message =
        `${intentIcon} <b>${capitalize(pending.intent || 'capture')}</b>\n` +
        `📝 ${escapeHtml(title)}\n\n` +
        `<b>How deep?</b>`;
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: buildDepthKeyboard(requestId),
        });
      } catch { /* edit failed */ }
      break;
    }
    case 'audience': {
      updatePendingContent(requestId, { flowState: 'audience', audience: undefined });
      const intentIcon = INTENT_ICONS[pending.intent || 'capture'] || '📋';
      const depthIcon = DEPTH_ICONS[pending.depth || 'standard'] || '📊';
      const message =
        `${intentIcon} <b>${capitalize(pending.intent || 'capture')}</b> / ${depthIcon} <b>${capitalize(pending.depth || 'standard')}</b>\n` +
        `📝 ${escapeHtml(title)}\n\n` +
        `<b>Who's this for?</b>`;
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: buildAudienceKeyboard(requestId),
        });
      } catch { /* edit failed */ }
      break;
    }
  }

  logger.info('Intent-first back navigation', { requestId, targetStep });
}

// ==========================================
// Skip
// ==========================================

async function handleIntentSkip(
  ctx: Context,
  requestId: string,
  pending: PendingContent
): Promise<void> {
  // Register URL as skipped to prevent re-prompting within TTL window
  if (pending.url) {
    registerSkip(pending.url);
  }
  removePendingContent(requestId);
  await ctx.answerCallbackQuery({ text: 'Skipped' });
  try { await ctx.deleteMessage(); } catch { /* already deleted */ }
  await ctx.reply('Skipped');
  logger.info('Intent-first content skipped', { requestId, url: pending.url });
}

// ==========================================
// Skill-First Execution Dispatch
// ==========================================

/**
 * Route URL through skill registry first, fall back to Gemini research.
 *
 * Priority order:
 *   1. Domain-specific skills (threads-lookup, linkedin-lookup, twitter-lookup) — priority 100
 *   2. Generic url-extract skill — priority 10
 *   3. Gemini Research Agent — fallback for 'research' intent when no skill matches
 *
 * This mirrors the V3 prompt-selection-callback.ts:648-696 pattern.
 */
async function dispatchSkillOrResearch(
  ctx: Context,
  pending: PendingContent,
  structuredContext: StructuredContext,
  feedId: string,
  workItemId: string,
  feedUrl?: string,
  workQueueUrl?: string,
  compositionResult?: Awaited<ReturnType<typeof composeFromStructuredContext>>
): Promise<void> {
  const url = pending.url!;
  const title = pending.analysis?.title || pending.originalText.substring(0, 80);

  try {
    await initializeSkillRegistry();
    const registry = getSkillRegistry();

    const match = registry.findBestMatch(url, { pillar: pending.pillar as any });

    if (match) {
      logger.info('Skill matched for intent-first URL', {
        skill: match.skill.name,
        score: match.score,
        url,
        pillar: pending.pillar,
        intent: structuredContext.intent,
      });

      const depthMap: Record<string, string> = {
        quick: 'light', standard: 'standard', deep: 'deep',
      };

      await ctx.reply(
        `🔧 Running <b>${match.skill.name}</b> skill...\n\n` +
        `"${escapeHtml(title)}"`,
        { parse_mode: 'HTML' }
      );

      await executeSkill(match.skill, {
        userId: pending.userId,
        messageText: pending.originalText,
        pillar: pending.pillar as any,
        approvalLatch: true,  // User already confirmed via intent-first keyboard
        input: {
          url,
          title,
          pillar: pending.pillar,
          feedId,
          workQueueId: workItemId,
          workQueueUrl,
          feedUrl,
          depth: depthMap[structuredContext.depth] || 'standard',
          telegramChatId: pending.chatId,
          // Phase 2: composed prompt for skills that can use it
          composedPrompt: compositionResult?.prompt,
          composedTemperature: compositionResult?.temperature,
          composedMaxTokens: compositionResult?.maxTokens,
        },
      });

      logger.info('Skill execution completed from intent-first flow', {
        skill: match.skill.name,
        intent: structuredContext.intent,
        pillar: pending.pillar,
      });
      return;
    }
  } catch (skillError) {
    logger.error('Skill dispatch failed, falling back to research agent', {
      error: skillError instanceof Error ? skillError.message : String(skillError),
      url,
    });
  }

  // No skill matched (or skill failed) — fall back to Gemini for research intent
  if (structuredContext.intent === 'research') {
    await dispatchResearchAgent(ctx, pending, structuredContext, workItemId, workQueueUrl, compositionResult);
  } else {
    logger.info('No skill matched and intent is not research — skipping execution', {
      url,
      intent: structuredContext.intent,
    });
  }
}

// ==========================================
// Research Agent Dispatch (Gemini fallback)
// ==========================================

/**
 * Dispatch the Research Agent after intent-first confirmation.
 * Fires non-blocking — audit trail is already created.
 * Used as fallback when no skill matches the URL.
 */
async function dispatchResearchAgent(
  ctx: Context,
  pending: PendingContent,
  structuredContext: StructuredContext,
  workItemId: string,
  workQueueUrl?: string,
  compositionResult?: Awaited<ReturnType<typeof composeFromStructuredContext>>
): Promise<void> {
  const chatId = pending.chatId;
  const rawUrl = pending.url;
  const title = pending.analysis?.title || pending.originalText.substring(0, 80);

  // Frame URL as a research question — bare URLs don't trigger Gemini grounding
  let query: string;
  if (rawUrl) {
    query = `Research and analyze the content at ${rawUrl}` +
      (title !== rawUrl ? ` ("${title}")` : '') +
      `. Summarize the key points, identify the author and context, and provide relevant background information.`;
  } else {
    query = pending.originalText;
  }

  // Map intent-first depth to research depth
  const depthMap: Record<string, 'light' | 'standard' | 'deep'> = {
    quick: 'light',
    standard: 'standard',
    deep: 'deep',
  };

  const config: ResearchConfig = {
    query,
    depth: depthMap[structuredContext.depth] || 'standard',
    pillar: pending.pillar as any,
    // Phase 2: inject composition system's instructions via voiceInstructions
    ...(compositionResult && {
      voice: 'custom' as const,
      voiceInstructions: compositionResult.prompt,
    }),
  };

  const depthLabel = config.depth === 'light' ? 'Quick' : config.depth === 'deep' ? 'Deep' : 'Standard';
  await ctx.reply(
    `🔬 Starting <b>${depthLabel}</b> research...\n\n` +
    `"${escapeHtml(title)}"`,
    { parse_mode: 'HTML' }
  );

  logger.info('Dispatching research agent from intent-first flow', {
    query: query.substring(0, 80),
    depth: config.depth,
    pillar: pending.pillar,
    workItemId,
  });

  const { agent, result } = await runResearchAgentWithNotifications(
    config,
    chatId,
    ctx.api,
    workItemId
  );

  await sendCompletionNotification(ctx.api, chatId, agent, result, workQueueUrl);
}

// ==========================================
// Helpers
// ==========================================

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Map intent to closest RequestType for backward compatibility
 */
function mapIntentToRequestType(intent: IntentType): import('../conversation/types').RequestType {
  const map: Record<IntentType, import('../conversation/types').RequestType> = {
    research: 'Research',
    draft: 'Draft',
    save: 'Quick',
    analyze: 'Research',
    capture: 'Quick',
    engage: 'Answer',
  };
  return map[intent] || 'Research';
}

/**
 * Map SourceType back to legacy contentType for pattern learning
 */
function mapSourceTypeToContentType(
  sourceType: import('../conversation/types').SourceType
): 'image' | 'document' | 'url' | 'video' | 'audio' | undefined {
  switch (sourceType) {
    case 'image': return 'image';
    case 'document': return 'document';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'url':
    case 'github':
    case 'linkedin': return 'url';
    case 'text': return undefined;
    default: return undefined;
  }
}

// inferFormat() removed — now owned by composition package (composeInferFormat)

/**
 * Build keywords from context
 */
function buildKeywords(pending: PendingContent, ctx: StructuredContext): string[] {
  const kw: string[] = [ctx.intent];
  if (ctx.depth !== 'standard') kw.push(ctx.depth);
  if (ctx.audience !== 'self') kw.push(ctx.audience);
  if (pending.analysis?.source && pending.analysis.source !== 'generic') {
    kw.push(pending.analysis.source);
  }
  if (pending.url) kw.push('link');
  return kw.slice(0, 5);
}
