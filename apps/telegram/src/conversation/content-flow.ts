/**
 * Content Flow - Surface adapter for Universal Content Analysis (Telegram)
 *
 * Grammy-dependent surface layer that wires cognitive content detection
 * (from @atlas/agents) to Telegram's Context object for message handling.
 *
 * Cognitive logic (detection, confirmation tracking) lives in:
 *   packages/agents/src/conversation/content-detection.ts
 *
 * This file handles:
 * - triggerContentConfirmation (ctx.reply, ctx.replyWithChatAction)
 * - maybeHandleAsContentShare (ctx.message)
 * - triggerInstantClassification (ctx.from, ctx.chat, ctx.message)
 * - triggerMediaConfirmation (ctx.from, ctx.chat, ctx.message)
 *
 * Extracted as part of Cognitive Pipeline Extraction (CPE Phase 4).
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  routeForAnalysis,
  extractDomain,
  type ContentSource,
} from '@atlas/agents/src/conversation/content-router';
import { isNotionUrl, extractNotionContent } from '@atlas/agents/src/conversation/notion-extractor';
import type { Pillar } from './types';
import type { MediaContext } from '@atlas/agents/src/media/processor';
import type { AttachmentInfo } from '@atlas/agents/src/conversation/attachments';
import { socraticInterview } from './socratic-adapter';
import { getFeatureFlags } from '../config/features';
import { checkUrl } from '../utils/url-dedup';
import { triageMessage, type TriageResult } from '@atlas/agents/src/cognitive/triage-skill';
import { extractContent, toUrlContent } from '@atlas/agents/src/conversation/content-extractor';
import { preReadContent } from '@atlas/agents/src/conversation/content-pre-reader';
import { reportExtractionFailure } from '../../../../packages/shared/src/extraction-failure-reporter';
import { getSpaSourcesSync } from '../config/content-sources';
import { storeContentContext, storeTriage } from '@atlas/agents/src/conversation/conversation-state';

// ==========================================
// Re-exports from cognitive module
// ==========================================

import {
  detectContentShare,
  markConfirmationSent,
  hasConfirmationSent,
} from '@atlas/agents/src/conversation/content-detection';

export { detectContentShare, markConfirmationSent, hasConfirmationSent, confirmationTracker } from '@atlas/agents/src/conversation/content-detection';
export type { ContentDetectionResult } from '@atlas/agents/src/conversation/content-detection';

// ==========================================
// Surface Adapter Functions (Grammy-dependent)
// ==========================================

/**
 * Trigger the content confirmation flow
 *
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar -> Action -> Voice) instead of the old confirmation keyboard.
 *
 * TRIAGE INTELLIGENCE (2026-02-06): When triageSkill flag is enabled,
 * uses unified Haiku triage for smart title generation and pillar suggestion.
 *
 * Returns true if the flow was triggered, false otherwise.
 */
export async function triggerContentConfirmation(
  ctx: Context,
  url: string,
  contextText: string = ''
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for content confirmation');
    return false;
  }

  // Bug #1 Fix: Check for duplicate confirmation
  const flags = getFeatureFlags();
  if (flags.duplicateConfirmationGuard && messageId) {
    if (hasConfirmationSent(messageId)) {
      logger.info('Duplicate confirmation blocked', { messageId, url });
      return true; // Return true to indicate message was handled
    }
    markConfirmationSent(messageId);
  }

  // URL dedup check -- skip if this URL already has a Feed entry
  const dedup = await checkUrl(url);
  if (dedup.isDuplicate) {
    const verb = dedup.wasSkipped ? 'skipped' : 'captured';
    logger.info('URL dedup: blocking duplicate content confirmation', {
      url, source: dedup.source, existingFeedId: dedup.existingFeedId, wasSkipped: dedup.wasSkipped,
    });
    await ctx.reply(
      `Already ${verb}. ${dedup.existingFeedId ? '\u{1F4CB}' : '\u{23ED}\u{FE0F}'}`,
      { reply_to_message_id: messageId },
    );
    return true; // Handled -- don't show keyboard
  }

  // Each enrichment step is individually fault-tolerant.
  // The keyboard MUST always show -- enrichment failures degrade gracefully.
  const fallbackTitle = contextText || `Content from ${extractDomain(url)}`;
  let title = fallbackTitle;
  let triageResult: TriageResult | undefined;

  if (flags.triageSkill) {
    try {
      const triageInput = contextText ? `${url}\n\n${contextText}` : url;
      triageResult = await triageMessage(triageInput);
      title = triageResult.title || fallbackTitle;

      logger.info('Triage skill completed', {
        url,
        intent: triageResult.intent,
        confidence: triageResult.confidence,
        suggestedPillar: triageResult.pillar,
        complexityTier: triageResult.complexityTier,
        source: triageResult.source,
        title,
        latencyMs: triageResult.latencyMs,
      });
    } catch (triageError) {
      logger.warn('Triage failed, using fallback title', {
        error: triageError instanceof Error ? triageError.message : String(triageError),
        url,
      });
    }
  }

  // Route analysis -- non-fatal, use fallback if it fails
  let route: { source: ContentSource; method: string; domain?: string; needsBrowser?: boolean } = {
    source: 'generic' as ContentSource,
    method: 'Fetch',
  };
  try {
    route = await routeForAnalysis(url);
    if (!flags.triageSkill) {
      title = contextText || `${route.source} content from ${extractDomain(url)}`;
      logger.info('Content share detected (triage skill disabled)', {
        url,
        source: route.source,
        title,
      });
    }
  } catch (routeError) {
    logger.warn('Route analysis failed, using fallback', {
      error: routeError instanceof Error ? routeError.message : String(routeError),
      url,
    });
  }

  // FETCH URL CONTENT: Tiered extraction (HTTP or Jina Reader) before routing
  // Notion URLs use API extraction (login-walled, HTTP fetch fails)
  let urlContent;
  try {
    await ctx.replyWithChatAction('typing');

    if (route.source === 'notion') {
      urlContent = await extractNotionContent(url);
    } else {
      const extraction = await extractContent(url);
      urlContent = toUrlContent(extraction);

      // CONSTRAINT 4: Log level matches severity
      if (extraction.status === 'failed' || !urlContent.success) {
        logger.error('URL extraction FAILED in content-flow', {
          url,
          method: extraction.method,
          source: extraction.source,
          status: extraction.status,
          error: urlContent.error || extraction.error,
          fallbackUsed: extraction.fallbackUsed,
        });
      } else if (extraction.fallbackUsed || extraction.status === 'degraded') {
        logger.warn('URL extraction DEGRADED in content-flow (fallback used)', {
          url,
          method: extraction.method,
          source: extraction.source,
          status: extraction.status,
          fallbackUsed: extraction.fallbackUsed,
        });
      } else {
        logger.info('URL content extracted for content-flow', {
          url,
          method: extraction.method,
          source: extraction.source,
          status: extraction.status,
          title: urlContent.title?.substring(0, 80),
          tokenEstimate: extraction.tokenEstimate,
        });
      }
    }
  } catch (fetchError) {
    logger.error('URL extraction THREW in content-flow -- no content available', {
      url,
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
    });
  }

  // CONSTRAINT 4: Auto-dispatch P1 to Dev Pipeline when SPA extraction chain fails
  if (urlContent && !urlContent.success && getSpaSourcesSync().includes(route.source)) {
    void reportExtractionFailure({
      url,
      source: route.source,
      jinaStatus: undefined,
      jinaError: urlContent.error,
      cookieRetryAttempted: false,
      cookieRetryResult: undefined,
      httpFallbackRan: false,
      httpFallbackResult: 'skipped',
      toUrlContentSuccess: false,
      triageTitle: triageResult?.title,
      cex001Blocked: true,
      timestamp: new Date().toISOString(),
    });
  }

  // HAIKU PRE-READ: Summarize extracted content before asking Jim
  if (urlContent?.success && urlContent.fullContent) {
    try {
      const preRead = await preReadContent(
        urlContent.fullContent,
        url,
        urlContent.title,
      );
      if (preRead.success) {
        urlContent.preReadSummary = preRead.summary;
        urlContent.preReadContentType = preRead.contentType;
      }
      // If pre-read fails, we continue without it -- not a blocking error
    } catch (err) {
      logger.warn('Haiku pre-read failed, continuing without summary', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // UNIFIED STATE: Persist content context so follow-up messages retain URL awareness.
  // Solves Bug #2 (URL context loss) and Bug #5 (pillar drift on re-triage).
  if (userId && chatId) {
    storeContentContext(chatId, userId, {
      url,
      title,
      preReadSummary: urlContent?.preReadSummary,
      prefetchedUrlContent: urlContent,
      capturedAt: Date.now(),
    });
    if (triageResult) {
      storeTriage(chatId, triageResult);
    }
    logger.debug('Content context persisted to unified state', {
      chatId,
      url,
      title,
      hasTriage: !!triageResult,
      hasPreRead: !!urlContent?.preReadSummary,
    });
  }

  // SOCRATIC INTERVIEW: Replace keyboard flow with conversational engine
  try {
    const handled = await socraticInterview(ctx, url, 'url', title, triageResult, urlContent);
    return handled;
  } catch (error) {
    logger.error('Socratic interview failed (critical)', { error, url });
    return false;
  }
}

/**
 * Check if a message should use content confirmation flow
 * and trigger it if appropriate.
 *
 * Returns true if the confirmation flow was triggered (message handled),
 * false if the message should continue through normal processing.
 */
export async function maybeHandleAsContentShare(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text || '';

  // Detect if this is a content share (pass surface-specific SPA sources provider)
  const detection = detectContentShare(text, getSpaSourcesSync);

  if (!detection.isContentShare || !detection.primaryUrl) {
    return false; // Not a content share, continue normal processing
  }

  // Get any non-URL context
  let context = text;
  for (const url of detection.urls) {
    context = context.replace(url, '').trim();
  }

  // Trigger the confirmation flow
  return await triggerContentConfirmation(ctx, detection.primaryUrl, context);
}

/**
 * Trigger classification for media (images, documents, etc.)
 *
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar -> Action -> Voice) instead of the old instant classification keyboard.
 *
 * Flow:
 * 1. User shares image/document/video
 * 2. Show V3 pillar keyboard
 * 3. User taps pillar -> action -> voice
 * 4. Feed + Work Queue created with attachment info
 */
export async function triggerInstantClassification(
  ctx: Context,
  attachment: AttachmentInfo
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for media classification');
    return false;
  }

  // Bug #1 Fix: Check for duplicate confirmation
  const flags = getFeatureFlags();
  if (flags.duplicateConfirmationGuard && messageId) {
    if (hasConfirmationSent(messageId)) {
      logger.info('Duplicate media confirmation blocked', { messageId, type: attachment.type });
      return true; // Return true to indicate message was handled
    }
    markConfirmationSent(messageId);
  }

  try {
    const caption = ctx.message?.caption || '';
    const title = attachment.fileName || caption || `${attachment.type} content`;

    // For media, we use the caption or filename as content, contentType as 'text'
    // since we don't have a URL. The V3 flow will handle it.
    const content = caption || `[${attachment.type}${attachment.fileName ? `: ${attachment.fileName}` : ''}]`;

    logger.info('Media share detected, routing to Socratic interview', {
      type: attachment.type,
      fileName: attachment.fileName,
      title,
    });

    // SOCRATIC INTERVIEW: Replace keyboard flow with conversational engine
    const handled = await socraticInterview(ctx, content, 'media', title);
    return handled;
  } catch (error) {
    logger.error('Failed to trigger intent-first media flow', { error, type: attachment.type });
    return false;
  }
}

/**
 * Trigger the content confirmation flow for MEDIA (images, docs, etc.)
 *
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar -> Action -> Voice) instead of the old confirmation keyboard.
 *
 * Note: This is called after Gemini analysis, so we include the analysis
 * in the title for context.
 */
export async function triggerMediaConfirmation(
  ctx: Context,
  attachment: AttachmentInfo,
  mediaContext: MediaContext,
  _suggestedPillar: Pillar
): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;

  if (!userId || !chatId) {
    logger.warn('Missing userId or chatId for media confirmation');
    return false;
  }

  // Bug #1 Fix: Check for duplicate confirmation
  const flags = getFeatureFlags();
  if (flags.duplicateConfirmationGuard && messageId) {
    if (hasConfirmationSent(messageId)) {
      logger.info('Duplicate media (Gemini) confirmation blocked', { messageId, type: attachment.type });
      return true; // Return true to indicate message was handled
    }
    markConfirmationSent(messageId);
  }

  try {
    const caption = ctx.message?.caption || '';

    // Use Gemini's description as context, truncated for title
    const geminiSummary = mediaContext.description.length > 100
      ? mediaContext.description.substring(0, 97) + '...'
      : mediaContext.description;

    const title = attachment.fileName || geminiSummary || `${mediaContext.type} content`;

    // Content includes both caption and Gemini's analysis
    const content = caption
      ? `${caption}\n\n[Gemini analysis: ${geminiSummary}]`
      : `[${mediaContext.type}: ${geminiSummary}]`;

    logger.info('Media with Gemini analysis, routing to Socratic interview', {
      type: mediaContext.type,
      fileName: attachment.fileName,
      title,
    });

    // SOCRATIC INTERVIEW: Replace keyboard flow with conversational engine
    await socraticInterview(ctx, content, 'media', title);

    return true;
  } catch (error) {
    logger.error('Failed to trigger V3 media flow', { error, type: mediaContext.type });
    return false;
  }
}
