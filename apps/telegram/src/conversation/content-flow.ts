/**
 * Content Flow - Integration layer for Universal Content Analysis
 *
 * Detects when a message is primarily a URL share and triggers
 * the interactive classification keyboard instead of full Claude processing.
 *
 * This provides Jim with one-tap confirmation for content classification.
 */

import type { Context } from 'grammy';
import { logger } from '../logger';
import {
  routeForAnalysis,
  extractUrlsFromText,
  detectContentSource,
  extractDomain,
  type ContentSource,
} from './content-router';
import { isNotionUrl, handleNotionUrl } from './notion-url';
import type { Pillar } from './types';
import type { MediaContext } from './media';
import type { AttachmentInfo } from './attachments';
import { socraticInterview } from './socratic-adapter';
import { getFeatureFlags } from '../config/features';
import { checkUrl } from '../utils/url-dedup';
import { triageMessage, type TriageResult } from '../cognitive/triage-skill';
import { extractContent, toUrlContent } from './content-extractor';
import { preReadContent } from './content-pre-reader';
import { reportExtractionFailure, type ExtractionChainTrace } from '../../../../packages/shared/src/extraction-failure-reporter';
import { getSpaSourcesSync } from '../config/content-sources';

// ==========================================
// Bug #1 Fix: Duplicate Confirmation Guard
// ==========================================

/**
 * Tracks message IDs that have already had confirmations sent.
 * Prevents duplicate confirmation keyboards from race conditions.
 * Entries auto-expire after TTL_MS.
 */
const confirmationsSent = new Map<number, number>(); // messageId -> timestamp
const CONFIRMATION_TTL_MS = 30_000; // 30 seconds

/**
 * Mark a message as having sent a confirmation.
 * Used to prevent duplicate keyboards when multiple paths detect the same content.
 */
export function markConfirmationSent(messageId: number): void {
  confirmationsSent.set(messageId, Date.now());

  // Cleanup expired entries (lazy cleanup on each mark)
  const now = Date.now();
  for (const [id, ts] of confirmationsSent) {
    if (now - ts > CONFIRMATION_TTL_MS) {
      confirmationsSent.delete(id);
    }
  }
}

/**
 * Check if a confirmation has already been sent for this message.
 * Returns true if a confirmation was sent within the TTL window.
 */
export function hasConfirmationSent(messageId: number): boolean {
  const ts = confirmationsSent.get(messageId);
  if (!ts) return false;

  // Check if within TTL
  if (Date.now() - ts > CONFIRMATION_TTL_MS) {
    confirmationsSent.delete(messageId);
    return false;
  }

  return true;
}

/**
 * Export tracker for testing/inspection
 */
export const confirmationTracker = {
  size: () => confirmationsSent.size,
  clear: () => confirmationsSent.clear(),
};

/**
 * Result of content detection
 */
export interface ContentDetectionResult {
  isContentShare: boolean;  // Is this primarily a content share?
  urls: string[];           // Extracted URLs
  primaryUrl?: string;      // Main URL to process
  needsBrowser: boolean;    // Does extraction require browser?
}

/**
 * Detect if a message is primarily a URL/content share
 *
 * A message is a "content share" if:
 * - It contains 1-2 URLs
 * - The non-URL text is minimal (< 50 chars of context)
 * - OR the message is JUST a URL
 */
export function detectContentShare(text: string): ContentDetectionResult {
  const urls = extractUrlsFromText(text);

  if (urls.length === 0) {
    return { isContentShare: false, urls: [], needsBrowser: false };
  }

  // Get the primary URL (first one)
  const primaryUrl = urls[0];

  // Remove URLs from text to check remaining context
  let remainingText = text;
  for (const url of urls) {
    remainingText = remainingText.replace(url, '').trim();
  }

  // Content share if:
  // 1. Just a URL (or URLs)
  // 2. URL with minimal context (< 50 chars)
  // 3. Looks like a "check this out" pattern
  const isContentShare =
    urls.length > 0 &&
    (remainingText.length < 50 ||
     /^(check|look|see|read|watch|this|here|fyi|interesting|cool|nice)/i.test(remainingText));

  // Determine if browser extraction is needed
  const source = detectContentSource(primaryUrl);
  const needsBrowser = getSpaSourcesSync().includes(source);

  return {
    isContentShare,
    urls,
    primaryUrl,
    needsBrowser,
  };
}

/**
 * Trigger the content confirmation flow
 *
 * V3 UPDATE (2026-02-05): Now routes to V3 Progressive Profiling flow
 * (Pillar → Action → Voice) instead of the old confirmation keyboard.
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

  // URL dedup check — skip if this URL already has a Feed entry
  const dedup = await checkUrl(url);
  if (dedup.isDuplicate) {
    const verb = dedup.wasSkipped ? 'skipped' : 'captured';
    logger.info('URL dedup: blocking duplicate content confirmation', {
      url, source: dedup.source, existingFeedId: dedup.existingFeedId, wasSkipped: dedup.wasSkipped,
    });
    await ctx.reply(
      `Already ${verb}. ${dedup.existingFeedId ? '📋' : '⏭️'}`,
      { reply_to_message_id: messageId },
    );
    return true; // Handled — don't show keyboard
  }

  // Each enrichment step is individually fault-tolerant.
  // The keyboard MUST always show — enrichment failures degrade gracefully.
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

  // Route analysis — non-fatal, use fallback if it fails
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
  let urlContent;
  try {
    await ctx.replyWithChatAction('typing');
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
  } catch (fetchError) {
    logger.error('URL extraction THREW in content-flow — no content available', {
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
      // If pre-read fails, we continue without it — not a blocking error
    } catch (err) {
      logger.warn('Haiku pre-read failed, continuing without summary', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  // Detect if this is a content share
  const detection = detectContentShare(text);

  if (!detection.isContentShare || !detection.primaryUrl) {
    return false; // Not a content share, continue normal processing
  }

  // NOTION URL INTELLIGENCE: Check if this is a Notion URL first
  // Notion URLs get special object-aware handling
  if (isNotionUrl(detection.primaryUrl)) {
    logger.info('Detected Notion URL, routing to Notion handler', { url: detection.primaryUrl });
    const handled = await handleNotionUrl(ctx, detection.primaryUrl);
    if (handled) {
      return true; // Notion handler took over
    }
    // If Notion handler failed, fall through to generic URL handling
    logger.warn('Notion URL handler failed, falling back to generic handling');
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
 * (Pillar → Action → Voice) instead of the old instant classification keyboard.
 *
 * Flow:
 * 1. User shares image/document/video
 * 2. Show V3 pillar keyboard
 * 3. User taps pillar → action → voice
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
 * (Pillar → Action → Voice) instead of the old confirmation keyboard.
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
